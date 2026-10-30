// Texto de los documentos de la Biblioteca (PDF, Office, OpenDocument, texto, XML),
// página a página cuando el formato las tiene, para buscar en ellos y citarlos.
import path from 'node:path';
import { unzipSync, strFromU8, type UnzipFileInfo } from 'fflate';
import { leerArchivoRegular } from '../rutaReal.js';
import { docxConvertido } from '../../../nucleo/documentos/conversiones.js';
import { ocrDePdf, ocrDisponible } from '../../../nucleo/documentos/ocr.js';
import { fail, type Result } from '../../../nucleo/result.js';

// Formatos que solo se leen pasándolos a .docx con LibreOffice (los anexos de la PLACSP
// suelen llegar en .doc).
export const CONVERTIBLES = new Set(['.doc', '.rtf']);
export const EXTENSIONES_DOCUMENTO = new Set([
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.odt',
  '.odp',
  '.ods',
  '.txt',
  '.csv',
  '.xml',
  ...CONVERTIBLES,
]);
const NOMBRE_CONVERTIBLE: Record<string, string> = {
  '.doc': 'Documento de Word antiguo (.doc)',
  '.rtf': 'Documento RTF (.rtf)',
};

/** Qué decir cuando un .doc no se puede leer: sale en «pliegos ilegibles» y bloquea la ficha. */
function sinConversor(extension: string, estado: 'ausente' | 'apagado'): string {
  const apagado = estado === 'apagado' ? ' Está apagado con LIBREOFFICE_ACTIVO=0.' : '';
  return `${NOMBRE_CONVERTIBLE[extension] ?? `Documento ${extension}`}: hace falta LibreOffice en el servidor para leerlo (ver docs/operacion.md → Documentos: LibreOffice) o súbelo como .docx/.pdf.${apagado}`;
}
// Un pliego escaneado de cientos de páginas puede pasar de 50 MB; más que esto no
// se abre, para no quedarse sin memoria.
const MAX_BYTES_DOCUMENTO = 100 * 1024 * 1024;
// Tope de texto por documento (≈ 1.000 páginas densas).
const MAX_CARACTERES_TEXTO = 3_000_000;
const MAX_CARACTERES_HOJA = 200_000;
// Un DEUC o un XML de pliegos pesa KB; más de esto no es un documento que leer.
const MAX_BYTES_XML = 20 * 1024 * 1024;
// Lo que se descomprime de un Office u OpenDocument (cualquiera con acceso a la carpeta
// Conocimiento de Drive puede subirlo): un ZIP de unos KB puede contener o declarar gigas
// («bomba ZIP»). fflate reserva lo que declara cada entrada y no escribe más allá.
const MAX_PARTE_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_BYTES = 200 * 1024 * 1024;
// Un ZIP64 puede declarar miles de millones de entradas: recorrerlas ya bloquea el hilo.
const MAX_ZIP_ENTRADAS = 20_000;
// Menos texto que esto por página: casi seguro un PDF escaneado (solo imagen).
const CARACTERES_POR_PAGINA_ESCANEADA = 20;
// Cambia cuando cambia qué texto se da por legible: lo ya indexado se vuelve a juzgar una vez
// con el texto guardado (worker.ts), sin releer ni recalcular los vectores.
// 1: PDF con fuentes sin tabla de caracteres (texto de control y símbolos desplazados).
export const LECTURA_VERSION = 1;
export const TEXTO_ILEGIBLE =
  'PDF con el texto codificado (sus fuentes no traen tabla de caracteres): sale como símbolos, hace falta OCR o una copia con texto.';
// Con menos texto que esto no se juzga: una portada o un anexo de una línea.
const MIN_CARACTERES_JUICIO = 200;
// eslint-disable-next-line no-control-regex -- los caracteres de control son justo lo que se descarta
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const LETRA_O_CIFRA = /[\p{L}\p{N}]/gu;

/**
 * Texto que salió de un PDF pero no se puede leer. En un pliego así (a-20430425) salía
 * «\u0001\u0002\u0003…» y «(487*02)48+3.:2+.;4./+.8+,»: muchos caracteres de control o casi
 * nada de letras y cifras. Un texto normal pasa del 80 % de letras y cifras; una tabla de
 * importes, del 60 %.
 */
export function textoIlegible(paginas: string[]): boolean {
  const visible = paginas.join('').replace(/\s/g, '');
  if (visible.length < MIN_CARACTERES_JUICIO) return false;
  const control = (visible.match(CONTROL) ?? []).length;
  const utiles = (visible.match(LETRA_O_CIFRA) ?? []).length;
  return control / visible.length > 0.05 || utiles / visible.length < 0.5;
}

type Extraido = {
  // Una entrada por página (PDF), diapositiva (pptx) u hoja (xlsx); una sola si no hay.
  pages: string[];
  paged: boolean;
  scanned: boolean;
  // El texto salió del OCR (ocr.ts): puede traer errores de lectura.
  ocr?: boolean;
};

export type ResultadoExtraccion = { data: Extraido | null; error: string | null };

export function esDocumento(nombreArchivo: string): boolean {
  return EXTENSIONES_DOCUMENTO.has(path.extname(nombreArchivo).toLowerCase());
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// String.fromCodePoint lanza RangeError fuera de rango: un «&#x110000;» no puede dejar el
// documento entero en error. Lo que no es un carácter válido se deja como estaba.
function codigoValido(codigo: number): boolean {
  return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff && !(codigo >= 0xd800 && codigo <= 0xdfff);
}

function decodificarEntidades(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const codigo = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return codigoValido(codigo) ? String.fromCodePoint(codigo) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

// El XML se recorre con indexOf, nunca con regex del tipo /<x\b[^>]*>[\s\S]*?<\/x>/:
// con muchas aperturas sin cerrar (o muchos «<» sin «>») cada intento recorre el resto
// del texto y un docx de unos MB tiene el indexador horas parado.

// ¿`tag` (lo que va entre «<» y «>») es la etiqueta `nombre`, seguida de algo que no
// sea letra, número o «_» (lo que en una regex sería \b)?
function esEtiqueta(etiquetaYaml: string, nombre: string): boolean {
  return (
    etiquetaYaml.startsWith(nombre) &&
    (etiquetaYaml.length === nombre.length || !/\w/.test(etiquetaYaml.charAt(nombre.length)))
  );
}

// Comentarios y CDATA: un comentario con «<TenderingCriterion>» no es un criterio y un
// «<![CDATA[Cifra >= 300.000 €]]>» no se corta en su «>». Los comentarios se quitan y el
// CDATA queda como texto escapado (decodificarEntidades lo devuelve tal cual). Con indexOf, sin regex.
function normalizarXml(xml: string): string {
  if (!xml.includes('<!')) return xml;
  const partes: string[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<!', i);
    if (lt === -1) {
      partes.push(xml.slice(i));
      break;
    }
    partes.push(xml.slice(i, lt));
    const comentario = xml.startsWith('<!--', lt);
    const cdata = !comentario && xml.startsWith('<![CDATA[', lt);
    if (!comentario && !cdata) {
      partes.push('<!');
      i = lt + 2;
      continue;
    }
    const inicio = lt + (comentario ? 4 : 9);
    const fin = xml.indexOf(comentario ? '-->' : ']]>', inicio);
    const cierre = fin === -1 ? xml.length : fin;
    if (cdata)
      partes.push(xml.slice(inicio, cierre).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    i = fin === -1 ? xml.length : fin + 3;
  }
  return partes.join('');
}

const OCULTAS = ['w:instrText', 'w:delText'] as const;
const TABULADORES = ['w:tab', 'text:tab'];
const SALTOS = ['w:br', 'a:br', 'text:line-break'];
const FIN_PARRAFO = new Set(['/w:p', '/a:p', '/text:p', '/text:h']);

// Qué deja en el texto una etiqueta de Word, PowerPoint u OpenDocument.
function textoDeEtiqueta(etiquetaYaml: string): string {
  if (FIN_PARRAFO.has(etiquetaYaml)) return '\n';
  if (!etiquetaYaml.endsWith('/')) return '';
  if (TABULADORES.some((n) => esEtiqueta(etiquetaYaml, n))) return '\t';
  return SALTOS.some((n) => esEtiqueta(etiquetaYaml, n)) ? '\n' : '';
}

/**
 * Recorre el XML etiqueta a etiqueta. `etiqueta` recibe lo que hay entre «<» y «>» y la
 * posición tras el «>»; devuelve lo que se añade al texto y dónde seguir. Espera el XML
 * ya normalizado: normalizarXml se aplica una vez en los puntos de entrada públicos.
 */
function recorrerXml(xml: string, etiqueta: (tag: string, tras: number) => { texto: string; seguir: number }): string {
  const partes: string[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const gt = lt === -1 ? -1 : xml.indexOf('>', lt + 1);
    // Sin «<» o sin «>» detrás no hay más etiquetas: el resto es texto.
    if (gt === -1) {
      partes.push(xml.slice(i));
      break;
    }
    partes.push(xml.slice(i, lt));
    // «<>» no es etiqueta (como en /<[^>]+>/): se queda como texto.
    if (gt === lt + 1) {
      partes.push('<>');
      i = gt + 1;
      continue;
    }
    const r = etiqueta(xml.slice(lt + 1, gt), gt + 1);
    partes.push(r.texto);
    i = r.seguir;
  }
  return partes.join('');
}

function quitarEtiquetas(xml: string): string {
  return recorrerXml(xml, (_tag, tras) => ({ texto: '', seguir: tras }));
}

// Quita espacios y tabuladores al final de cada línea (como /[ \t]+\n/g → '\n') sin regex.
function sinEspaciosFinales(texto: string): string {
  const lineas = texto.split('\n');
  return lineas
    .map((linea, i) => {
      if (i === lineas.length - 1) return linea;
      let fin = linea.length;
      while (fin > 0 && (linea[fin - 1] === ' ' || linea[fin - 1] === '\t')) fin--;
      return linea.slice(0, fin);
    })
    .join('\n');
}

// XML de Word, PowerPoint u OpenDocument → texto con saltos de párrafo. Los campos
// (instrText) y lo borrado con control de cambios (delText) no son texto del documento.
export function extraerTextoXml(origen: string): string {
  const xml = normalizarXml(origen);
  const sinCierre = new Set<string>();
  const texto = recorrerXml(xml, (etiquetaYaml, tras) => {
    const oculta = OCULTAS.find((n) => !sinCierre.has(n) && esEtiqueta(etiquetaYaml, n));
    if (!oculta) return { texto: textoDeEtiqueta(etiquetaYaml), seguir: tras };
    const cierre = xml.indexOf(`</${oculta}>`, tras);
    // Si no hay cierre aquí, tampoco lo habrá para las siguientes: no se vuelve a buscar.
    if (cierre === -1) {
      sinCierre.add(oculta);
      return { texto: '', seguir: tras };
    }
    return { texto: '', seguir: cierre + oculta.length + 3 };
  });
  return sinEspaciosFinales(decodificarEntidades(texto))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Elemento = { attrs: string; inner: string };

/**
 * Elementos `<nombre …>…</nombre>` y `<nombre …/>` en orden, en una pasada. Si una
 * apertura no tiene cierre, ninguna posterior lo tendrá: desde ahí solo cuentan los
 * que se cierran solos.
 */
function listarElementosXml(origen: string, nombre: string): Elemento[] {
  return elementosDe(normalizarXml(origen), nombre);
}

function elementosDe(xml: string, nombre: string): Elemento[] {
  const salida: Elemento[] = [];
  const apertura = `<${nombre}`;
  const cierre = `</${nombre}>`;
  const finNombre = apertura.length;
  let sinCierre = false;
  // El «>» hallado sirve a todas las aperturas que quedan antes de él: sin esto, miles de
  // «<Nombre…» seguidos con un solo «>» al final recorrían el resto del XML cada vez.
  let gt = -1;
  let i = xml.indexOf(apertura);
  while (i !== -1) {
    // Otro nombre con el mismo prefijo («<TenderingCriterionX»): no hace falta ni buscar el «>».
    const esNombre = i + finNombre >= xml.length || !/\w/.test(xml.charAt(i + finNombre));
    if (esNombre && gt < i) gt = xml.indexOf('>', i + finNombre);
    if (esNombre && gt === -1) break;
    let seguir = i + 1;
    if (esNombre && xml.charAt(gt - 1) === '/') {
      salida.push({ attrs: xml.slice(i + finNombre, gt - 1), inner: '' });
      seguir = gt + 1;
    } else if (esNombre && !sinCierre) {
      const fin = xml.indexOf(cierre, gt + 1);
      if (fin === -1) sinCierre = true;
      else {
        salida.push({ attrs: xml.slice(i + finNombre, gt), inner: xml.slice(gt + 1, fin) });
        seguir = fin + cierre.length;
      }
    }
    i = xml.indexOf(apertura, seguir);
  }
  return salida;
}

function numerada(nombres: string[], re: RegExp): string[] {
  const num = (n: string) => Number(re.exec(n)?.[1] ?? 0);
  return nombres.filter((n) => re.test(n)).sort((a, b) => num(a) - num(b));
}

function valorCelda(atributos: string, interior: string, compartidas: string[]): string {
  if (/\bt="s"/.test(atributos)) return compartidas[Number(/<v>([^<]*)<\/v>/.exec(interior)?.[1])] ?? '';
  if (/\bt="inlineStr"/.test(atributos)) return decodificarEntidades(quitarEtiquetas(interior));
  return decodificarEntidades(/<v>([^<]*)<\/v>/.exec(interior)?.[1] ?? '');
}

// Una hoja de Excel → filas con las celdas separadas por tabuladores.
export function hojaATexto(xml: string, compartidas: string[]): string {
  const filas: string[] = [];
  let tamano = 0;
  for (const fila of listarElementosXml(xml, 'row')) {
    const celdas = elementosDe(fila.inner, 'c')
      .map((c) => valorCelda(c.attrs, c.inner, compartidas).trim())
      .filter((v) => v !== '');
    if (celdas.length === 0) continue;
    const line = celdas.join('\t');
    filas.push(line);
    tamano += line.length + 1;
    if (tamano > MAX_CARACTERES_HOJA) break;
  }
  return filas.join('\n');
}

function paginasOffice(extension: string, archivos: Record<string, Uint8Array>): { pages: string[]; paged: boolean } {
  const nombres = Object.keys(archivos);
  const leer = (n: string) => strFromU8(archivos[n] ?? new Uint8Array());
  if (extension === '.docx') return { pages: [extraerTextoXml(leer('word/document.xml'))], paged: false };
  if (extension === '.pptx') {
    return {
      pages: numerada(nombres, /^ppt\/slides\/slide(\d+)\.xml$/).map((n) => extraerTextoXml(leer(n))),
      paged: true,
    };
  }
  if (extension === '.xlsx') {
    const compartidas = listarElementosXml(leer('xl/sharedStrings.xml'), 'si').map((si) =>
      decodificarEntidades(quitarEtiquetas(si.inner)),
    );
    return {
      pages: numerada(nombres, /^xl\/worksheets\/sheet(\d+)\.xml$/).map((n) => hojaATexto(leer(n), compartidas)),
      paged: true,
    };
  }
  return { pages: [extraerTextoXml(leer('content.xml'))], paged: false };
}

// Un XML suelto (el DEUC de la PLACSP llega como ESPDRequest .xml): el texto de cada
// elemento en su línea. Sin DTD ni entidades externas: solo las cinco de XML y las numéricas.
function xmlSueltoATexto(xml: string): string {
  const texto = recorrerXml(xml, (etiquetaYaml, tras) => ({
    texto: etiquetaYaml.startsWith('/') ? '\n' : '',
    seguir: tras,
  }));
  return decodificarEntidades(texto)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

// Prefijos de espacio de nombres fuera («cac:TenderingCriterion» → «TenderingCriterion»):
// cada órgano genera el DEUC con los suyos y con versiones distintas del ESPD.
const sinPrefijos = (xml: string): string => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
const textoDe = (interior: string): string =>
  decodificarEntidades(quitarEtiquetas(interior)).replace(/\s+/g, ' ').trim();
const primero = (xml: string, nombre: string): string => textoDe(elementosDe(xml, nombre)[0]?.inner ?? '');

type CriterioEspd = {
  tipo: 'exclusion' | 'seleccion' | 'otro';
  codigo: string;
  nombre: string;
  descripcion: string;
  detalle: string[];
};

// Hasta dónde llega la cabecera de un criterio (su nombre y descripción): después vienen la
// legislación y las preguntas, que tienen su propia «Description».
const FIN_CABECERA =
  /<(?:Legislation|LegislationReference|TenderingCriterionPropertyGroup|RequirementGroup|SubTenderingCriterion)[\s>/]/;

function tipoCriterio(codigo: string): CriterioEspd['tipo'] {
  if (/EXCLUSION/i.test(codigo)) return 'exclusion';
  return /SELECTION/i.test(codigo) ? 'seleccion' : 'otro';
}

// Lo que el órgano pide en cada criterio: la pregunta y, si la fija, la cifra o el texto esperado.
function detalleCriterio(interior: string): string[] {
  const props = [...elementosDe(interior, 'TenderingCriterionProperty'), ...elementosDe(interior, 'Requirement')];
  const lineas = props.map((p) => {
    const esperado = ['ExpectedDescription', 'ExpectedAmount', 'ExpectedValueNumeric', 'ExpectedCode', 'ExpectedID']
      .map((n) => primero(p.inner, n))
      .filter(Boolean);
    const pregunta = primero(p.inner, 'Description');
    return esperado.length > 0 ? `${pregunta}${pregunta ? ': ' : ''}${esperado.join(' · ')}` : pregunta;
  });
  return [...new Set(lineas.filter(Boolean))];
}

function criteriosEspd(xml: string): CriterioEspd[] {
  const elementos = [...elementosDe(xml, 'TenderingCriterion'), ...elementosDe(xml, 'Criterion')];
  return elementos.map((c) => {
    const fin = c.inner.search(FIN_CABECERA);
    const cabecera = fin === -1 ? c.inner : c.inner.slice(0, fin);
    const codigo = primero(cabecera, 'CriterionTypeCode') || primero(cabecera, 'TypeCode');
    return {
      tipo: tipoCriterio(codigo),
      codigo,
      nombre: primero(cabecera, 'Name'),
      descripcion: primero(cabecera, 'Description'),
      detalle: detalleCriterio(c.inner),
    };
  });
}

const TITULO_TIPO: Record<CriterioEspd['tipo'], string> = {
  exclusion: 'Criterios de exclusión',
  seleccion: 'Criterios de selección pedidos (solvencia)',
  otro: 'Otros criterios',
};

function bloqueCriterios(tipo: CriterioEspd['tipo'], criterios: CriterioEspd[]): string[] {
  const deTipo = criterios.filter((c) => c.tipo === tipo);
  if (deTipo.length === 0) return [];
  const lineas = deTipo.flatMap((c) => {
    const titulo = `- ${c.nombre || c.codigo}${c.descripcion ? `: ${c.descripcion}` : ''}`;
    // Las preguntas de exclusión son las mismas en todos los DEUC («¿Su respuesta?»): solo ruido.
    return tipo === 'exclusion' ? [titulo] : [titulo, ...c.detalle.map((d) => `  · ${d}`)];
  });
  return ['', `${TITULO_TIPO[tipo]} (${deTipo.length}):`, ...lineas];
}

/** Texto de un DEUC (ESPDRequest/ESPDResponse): el contrato y los criterios que pide el órgano. */
function espdATexto(xmlOriginal: string): string {
  const xml = sinPrefijos(xmlOriginal);
  const proyecto = elementosDe(xml, 'ProcurementProject')[0]?.inner ?? '';
  const lotes = elementosDe(xml, 'ProcurementProjectLot')
    .map((l) => primero(l.inner, 'ID'))
    .filter(Boolean);
  const criterios = criteriosEspd(xml);
  const cabecera = [
    'DEUC (Documento Europeo Único de Contratación, ESPD)',
    ['Expediente', primero(xml, 'ContractFolderID')],
    ['Órgano de contratación', primero(elementosDe(xml, 'ContractingParty')[0]?.inner ?? '', 'Name')],
    ['Contrato', primero(proyecto, 'Name')],
    ['Descripción', primero(proyecto, 'Description')],
    ['Lotes', lotes.join(', ')],
  ]
    .map((l) => (typeof l === 'string' ? l : l[1] ? `${l[0]}: ${l[1]}` : ''))
    .filter(Boolean);
  return [
    ...cabecera,
    ...(['seleccion', 'otro', 'exclusion'] as const).flatMap((t) => bloqueCriterios(t, criterios)),
  ].join('\n');
}

const ES_ESPD = /<(?:[\w.-]+:)?ESPD(?:Request|Response)[\s>]/;

function xmlATexto(origen: string): string {
  const xml = normalizarXml(origen);
  return ES_ESPD.test(xml.slice(0, 8192)) ? espdATexto(xml) : xmlSueltoATexto(xml);
}

const PARTES_ZIP =
  /^(word\/document\.xml|ppt\/slides\/slide\d+\.xml|xl\/sharedStrings\.xml|xl\/worksheets\/sheet\d+\.xml|content\.xml)$/;

async function extraerPdf(buf: Uint8Array): Promise<{ pages: string[]; paged: boolean }> {
  const { extractText: extraerTexto, getDocumentProxy: obtenerDocumentoPdf } = await import('unpdf');
  const pdf = await obtenerDocumentoPdf(buf);
  try {
    const { text: texto } = await extraerTexto(pdf, { mergePages: false });
    return { pages: texto.map((p) => p.replace(/[ \t]+\n/g, '\n').trim()), paged: true };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function acotado(paginas: string[]): string[] {
  let restante = MAX_CARACTERES_TEXTO;
  const salida: string[] = [];
  for (const pagina of paginas) {
    if (restante <= 0) break;
    salida.push(pagina.slice(0, restante));
    restante -= pagina.length;
  }
  return salida;
}

// Solo las partes con texto y con topes; se aborta lanzando desde el filtro, que es lo
// único que corta el recorrido de fflate (la excepción la recoge extraerDocumento).
function descomprimirPartes(buf: Uint8Array): Record<string, Uint8Array> {
  let entradas = 0;
  let total = 0;
  return unzipSync(buf, {
    filter: (f: UnzipFileInfo) => {
      if (++entradas > MAX_ZIP_ENTRADAS) throw new Error('demasiadas entradas en el archivo comprimido');
      if (!PARTES_ZIP.test(f.name)) return false;
      // Una entrada sin comprimir copia `size` bytes aunque declare otro tamaño.
      const bytes = Math.max(f.size, f.originalSize);
      total += bytes;
      if (bytes > MAX_PARTE_BYTES || total > MAX_ZIP_BYTES) throw new Error('demasiado grande al descomprimir');
      return true;
    },
  });
}

async function bytesDe(rutaAbsoluta: string): Promise<Uint8Array> {
  const leido = await leerArchivoRegular(rutaAbsoluta, MAX_BYTES_DOCUMENTO);
  if (leido.error)
    throw new Error(leido.error.code === 'too_large' ? 'demasiado grande (más de 100 MB)' : leido.error.message);
  return new Uint8Array(leido.data.contenido);
}

// Un .doc o .rtf se lee por su conversión a .docx (en caché); sin conversor, el error dice
// qué hacer en vez de «formato no soportado».
async function paginasConvertidas(
  rutaAbsoluta: string,
  extension: string,
): Promise<{ pages: string[]; paged: boolean }> {
  const conv = await docxConvertido(rutaAbsoluta);
  if (conv.error) {
    if (conv.error.code === 'conversor_ausente' || conv.error.code === 'conversor_apagado')
      throw new Error(sinConversor(extension, conv.error.code === 'conversor_apagado' ? 'apagado' : 'ausente'));
    throw new Error(`no se pudo convertir a .docx: ${conv.error.message}`);
  }
  return paginasOffice('.docx', descomprimirPartes(await bytesDe(conv.data)));
}

// Los .xml de la PLACSP no siempre son UTF-8: el prólogo dice ISO-8859-1 o windows-1252, o
// hay BOM UTF-16. Con strFromU8 las tildes salían rotas y el criterio no coincidía.
export function codificacionXml(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';
  const prologo = Buffer.from(buf.subarray(0, 200)).toString('latin1');
  const declarada = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(prologo)?.[1]?.toLowerCase() ?? 'utf-8';
  // Sin BOM el prólogo se lee como ASCII, así que el XML no es UTF-16 por mucho que lo
  // declare: decodificarlo como tal lo dejaría entero en basura.
  return declarada.startsWith('utf-16') ? 'utf-8' : declarada;
}

function decodificarXml(buf: Uint8Array): string {
  try {
    return new TextDecoder(codificacionXml(buf), { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}

// Un ZIP guardado como «.pdf» (pliegos bajados antes de mirar su firma): pdf.js solo diría
// «Invalid PDF structure» y Estado lo daba por «PDF dañado» sin más.
const ZIP_COMO_PDF = 'Es un ZIP guardado con extensión .pdf: no se puede leer como PDF.';

function firmaZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

async function leerPaginas(rutaAbsoluta: string, extension: string): Promise<{ pages: string[]; paged: boolean }> {
  if (CONVERTIBLES.has(extension)) return paginasConvertidas(rutaAbsoluta, extension);
  const buf = await bytesDe(rutaAbsoluta);
  if (extension === '.xml' && buf.length > MAX_BYTES_XML) throw new Error('XML demasiado grande (más de 20 MB)');
  if (extension === '.pdf' && firmaZip(buf)) throw new Error(ZIP_COMO_PDF);
  if (extension === '.pdf') return extraerPdf(buf);
  if (extension === '.txt' || extension === '.csv') return { pages: [strFromU8(buf)], paged: false };
  if (extension === '.xml') return { pages: [xmlATexto(decodificarXml(buf))], paged: false };
  return paginasOffice(extension, descomprimirPartes(buf));
}

// Los mensajes de pdf.js no dicen nada a quien mira el estado («Invalid PDF structure»): se
// explican, con el original entre paréntesis para buscarlo.
const ERRORES_PDF: [RegExp, string][] = [
  [
    /invalid pdf structure|invalid xref|missing pdf header|bad xref/i,
    'PDF dañado o que no es un PDF (por ejemplo, un Word o una página web con extensión .pdf)',
  ],
  [/password|encrypt/i, 'PDF protegido con contraseña'],
];

function explicarError(extension: string, mensaje: string): string {
  if (extension !== '.pdf') return mensaje;
  const conocido = ERRORES_PDF.find(([re]) => re.test(mensaje));
  return conocido ? `${conocido[1]} (${mensaje})` : mensaje;
}

const pocoTexto = (paginas: string[]): boolean =>
  paginas.reduce((n, p) => n + p.trim().length, 0) < CARACTERES_POR_PAGINA_ESCANEADA * Math.max(1, paginas.length);

// Un PDF escaneado o con el texto codificado se lee con OCR si lo hay; si no lo hay, falla o
// tampoco da texto legible, queda como estaba.
async function conOcr(rutaAbsoluta: string, ocr: LectorOcr): Promise<Extraido | null> {
  const r = await ocr(rutaAbsoluta);
  if (r.error || pocoTexto(r.data) || textoIlegible(r.data)) return null;
  return { pages: acotado(r.data), paged: true, scanned: false, ocr: true };
}

/** Las páginas de un PDF leídas con OCR. */
export type LectorOcr = (absPath: string) => Promise<Result<string[]>>;
/** No intenta el OCR: lo de por defecto. */
const SIN_OCR: LectorOcr = () => Promise.resolve(fail('ocr_apagado', 'Sin OCR en esta lectura.'));
/** El OCR del servidor, si lo hay (ocr.ts). */
export const CON_OCR: LectorOcr = async (rutaAbsoluta) => ocrDePdf(rutaAbsoluta, await ocrDisponible());

/**
 * Texto de un documento. Nunca lanza: un archivo dañado o cifrado vuelve como error. `ocr`: solo
 * el indexador, que lee cada archivo una vez, pasa CON_OCR; lo demás no, porque un PDF escaneado
 * tardaría minutos en cada lectura.
 */
export async function extraerDocumento(rutaAbsoluta: string, ocr: LectorOcr = SIN_OCR): Promise<ResultadoExtraccion> {
  const extension = path.extname(rutaAbsoluta).toLowerCase();
  if (!EXTENSIONES_DOCUMENTO.has(extension)) return { data: null, error: 'formato no soportado' };
  try {
    const { pages: paginas, paged: conPaginas } = await leerPaginas(rutaAbsoluta, extension);
    const texto = acotado(paginas);
    const escaneado = extension === '.pdf' && pocoTexto(texto);
    const leido = extension === '.pdf' && (escaneado || textoIlegible(texto)) ? await conOcr(rutaAbsoluta, ocr) : null;
    if (leido) return { data: leido, error: null };
    // Sin trozos: indexar símbolos no sirve para buscar ni para leer, y como error sale en
    // «pliegos ilegibles» y no se pide una ficha que no puede leerlo.
    if (extension === '.pdf' && !escaneado && textoIlegible(texto)) return { data: null, error: TEXTO_ILEGIBLE };
    return { data: { pages: texto, paged: conPaginas, scanned: escaneado }, error: null };
  } catch (err) {
    return { data: null, error: explicarError(extension, err instanceof Error ? err.message : String(err)) };
  }
}
