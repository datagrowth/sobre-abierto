// Las instrucciones del run que rellena un anexo: la tarea, la hoja de datos y el modelo (párrafos con
// huecos de un Word o campos de un formulario PDF) con los pasos para responder.
import fs from 'node:fs';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { nombreEmpresa } from '../../../nucleo/empresa.js';
import type { CampoPdf } from '../../../nucleo/documentos/formularioPdf.js';
import { localizarHuecos, markdownDeParrafos, type Huecos } from '../../../nucleo/documentos/rellenar.js';
import { errorMessage } from '../../../nucleo/result.js';
import { raicesActuales, textoDe } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import { documentoDelGuion, filaDocumento, type DocumentoConClave } from './documentos.js';
import { guionVigente } from './guion.js';
import { hojaDeDatos, hojaEnTexto } from './hojaDatos.js';
import { camposDelModelo, localizarModelo, rellenable } from './modelosPdf.js';
import type { PayloadAnexoData } from './anexosTrabajo.js';
import { modeloBuscado, modeloDe } from './anexosModelo.js';
import { type Transcrito, analisisDe, paginasDe, transcritoDe } from './anexosModeloPdf.js';
import { estadoElegibilidad, fichaDe, requisitoDeLaVia } from './anexosVia.js';

const MAX_MARKDOWN = 40_000;

function leerModelo(abs: string | null): Huecos | string {
  if (!abs) return 'no se encontró el modelo';
  try {
    const h = localizarHuecos(fs.readFileSync(abs));
    return h.error ? h.error.message : h.data;
  } catch (err) {
    return errorMessage(err).slice(0, 200);
  }
}

function cabeceraTranscrito(t: Transcrito): string {
  if (!t.tabla)
    return `TRANSCRITO DEL PDF «${t.pliego}» (${paginasDe(t)}): el texto puede tener saltos de línea distintos al original; rellena igual que un Word. `;
  return (
    `GENERADO A PARTIR DE LA TABLA DE REQUISITOS DEL PDF «${t.pliego}» (${paginasDe(t)}): una fila por requisito con su texto literal y su página. ` +
    'Rellena en cada fila «Cumplimiento» con una de las opciones de la cabecera y «Evidencia/fuente» con la evidencia que lo acredita (dato «Redacción», siempre con fuentes); ' +
    'deja el hueco vacío si no tienes evidencia. '
  );
}

function seccionModelo(abs: string | null, modelo: string, t: Transcrito | null): string {
  const h = leerModelo(abs);
  if (typeof h === 'string')
    return `DOCUMENTO DE MODELOS: no se pudo leer (${h}). No envíes nada: la persona lo pedirá otra vez.`;
  const loc = localizarModelo(h.parrafos, modelo);
  const transcrito = t ? cabeceraTranscrito(t) : '';
  const cabecera = `${transcrito}DOCUMENTO DE MODELOS (párrafos numerados; «⟵» señala los que tienen huecos; «|» los de una tabla).`;
  if (!loc) {
    const md = h.markdown.length > MAX_MARKDOWN ? `${h.markdown.slice(0, MAX_MARKDOWN)}\n[…recortado]` : h.markdown;
    return `${cabecera} No encontré el título de «${modelo}»: búscalo tú.\n${md}`;
  }
  return `${cabecera} «${modelo}» parece ir del párrafo ${loc.desde} al ${loc.hasta}: compruébalo con los títulos.\n${markdownDeParrafos(h.parrafos, Math.max(1, loc.desde - 2), loc.hasta + 2)}`;
}

function pasosAnexo(p: PayloadAnexoData): string {
  return [
    'CÓMO RELLENAR:',
    '1. desde_parrafo = el párrafo con el título del modelo («ANEXO …»); hasta_parrafo = el último párrafo antes del siguiente anexo. Usa la numeración de arriba.',
    '2. Una sustitución por cada hueco que la hoja permita rellenar: parrafo; original = el trozo literal del párrafo con su etiqueta y el hueco, copiado tal cual con sus puntos (p. ej. «con NIF ……»); nuevo = el mismo trozo con el dato en lugar del hueco («con NIF B12345678»); dato = la etiqueta de la hoja de la que sale («NIF»). Casillas: cambia «☐» por «☒» solo en los criterios automáticos a los que nos acogemos.',
    '3. El texto del modelo no se toca: ni se reescribe, ni se resume, ni se quitan opciones. Lugar y fecha, de la hoja («Empresa · Lugar» y «Firma · Fecha»). La firma, NUNCA: su hueco («Fdo.: ……») se queda en blanco (la plataforma rechaza cualquier texto en ella). El importe, solo si la hoja lo trae; si falta, deja su hueco vacío. Si el modelo trae un bloque por lote, rellena solo el del lote de la tarea y deja los demás intactos.',
    `4. Envía licitaciones_anexo (id=${p.id}, clave=${p.clave}, desde_parrafo, hasta_parrafo, sustituciones). La plataforma rellena el modelo, comprueba que solo cambian los huecos y lo guarda en Salidas como borrador para que una persona lo revise y lo firme. Si responde con un error, corrige exactamente lo que dice y reenvía el anexo entero.`,
    'No hagas nada más: no escribas en Salidas ni en la Biblioteca y no respondas en ningún canal.',
  ].join('\n');
}

type Licitacion = { expediente: string; titulo: string; organo_nombre: string };

type Tarea = { d: DocumentoConClave; encabezado: string; hoja: string };

// Lo común a los dos modelos: la tarea (con el documento, la licitación y el lote) y la hoja de datos.
// El texto del medio cambia según el modelo sea un Word con huecos o un PDF con campos.
function tareaDeAnexo(db: Db, dbNucleo: DbNucleo, p: PayloadAnexoData, pdf: boolean): Tarea | string {
  const l = db.prepare('SELECT expediente, titulo, organo_nombre FROM licitaciones WHERE id = ?').get(p.id) as
    Licitacion | undefined;
  const g = guionVigente(db, p.id);
  const d = g ? documentoDelGuion(g.datos, p.clave) : null;
  if (!l || !d)
    return `Tarea de la plataforma de ${nombreEmpresa(db)}: el documento «${p.clave}» de la licitación ${p.id} ya no está en el guion de la oferta. No hagas nada.`;
  const o = d.doc.origen;
  const hoja = hojaDeDatos(db, dbNucleo, p.id, { lote: d.lote });
  const avisos = hoja.data?.avisos.length ? `\nAvisos de la hoja: ${hoja.data.avisos.join(' ')}` : '';
  const trae = pdf ? 'campos' : 'bloques';
  const loteDe = d.lote
    ? `, lote ${d.lote}: si el modelo trae ${trae} por lote, rellena solo ${pdf ? 'los' : 'el'} del lote ${d.lote} y deja los demás intactos`
    : '';
  const que = pdf
    ? 'Es un formulario PDF: se rellenan solo sus campos con los datos de la hoja y el resto no se toca; los campos de firma no se rellenan'
    : 'Se rellenan solo los huecos con los datos de la hoja; el texto del modelo se conserva literal';
  return {
    d,
    encabezado: `Tarea de la plataforma de ${nombreEmpresa(db)}: rellena el modelo «${d.doc.nombre}» (${modeloBuscado(d)}${o ? `, ${o.documento}${o.pagina ? ` pág. ${o.pagina}` : ''}` : ''}) de la oferta a la licitación ${p.id} — ${l.titulo}, ${l.organo_nombre}, expediente ${l.expediente}. Va en «${d.archivo}»${loteDe}. ${que} y nada se firma ni se presenta: lo revisa y lo firma una persona. Sigue la skill «licitaciones» (sección «Rellenar un anexo»).`,
    hoja: `HOJA DE DATOS (usa solo estos datos; lo que falte se deja en blanco):\n${hoja.data ? hojaEnTexto(hoja.data) : '(no disponible)'}${avisos}`,
  };
}

/** Las instrucciones del run de un modelo Word: el modelo con sus huecos, la hoja de datos y cómo responder. */
export function instruccionesAnexo(db: Db, dbNucleo: DbNucleo, p: PayloadAnexoData): string {
  const t = tareaDeAnexo(db, dbNucleo, p, false);
  if (typeof t === 'string') return t;
  const abs = filaDocumento(db, p.id, p.clave)?.anexo_modelo ?? null;
  const via = requisitoDeLaVia(fichaDe(db, p.id), t.d, (r) => estadoElegibilidad(db, p.id, r), ['abierta', 'cerrada'])
    ? [PASOS_VIA, '']
    : [];
  return [
    t.encabezado,
    '',
    t.hoja,
    '',
    seccionModelo(abs, modeloBuscado(t.d), transcritoDe(db, abs)),
    '',
    ...via,
    pasosAnexo(p),
  ].join('\n');
}

// La vía alternativa pide más que la hoja (medidas de seguridad equivalentes): lo que no salga de un documento no se escribe.
const PASOS_VIA =
  'VÍA ALTERNATIVA DE UN REQUISITO EXCLUYENTE: Busca en la Biblioteca (biblioteca_buscar) evidencias de medidas de seguridad equivalentes; usa «Redacción» solo con fuentes; si no hay evidencias, deja el hueco vacío y dilo en el aviso. Un hueco redactado lleva dato = «Redacción» y fuentes = los documentos de los que sale (ruta «Conocimiento/…» o «Salidas/…» y, si la sabes, la página).';

const MAX_TEXTO_PDF = 30_000;

// Los campos del formulario (nombre exacto, tipo, opciones, página) y el texto de cada página, para emparejar etiquetas con campos.
async function seccionFormulario(abs: string): Promise<string> {
  const campos = await camposDelModelo(abs);
  if (campos.error)
    return `FORMULARIO: no se pudo leer (${campos.error.message}). No envíes nada: la persona lo pedirá otra vez.`;
  const linea = (c: CampoPdf) =>
    `- «${c.nombre}» (${c.tipo}${c.pagina ? `, pág. ${c.pagina}` : ''}${c.opciones.length ? `, opciones: ${c.opciones.map((o) => `«${o}»`).join(', ')}` : ''}${rellenable(c) ? '' : c.es_firma ? ' — FIRMA: no se rellena' : ' — no se rellena'}${c.valor !== null && c.valor !== '' && c.valor !== false ? `, ya trae «${String(c.valor).slice(0, 80)}»` : ''})`;
  const texto = await textoDe(abs).catch(() => null);
  const paginas = texto?.data
    ? texto.data.length > MAX_TEXTO_PDF
      ? `${texto.data.slice(0, MAX_TEXTO_PDF)}\n[…recortado]`
      : texto.data
    : '(no se pudo leer el texto del PDF)';
  return `CAMPOS DEL FORMULARIO (usa el nombre exacto):\n${campos.data.map(linea).join('\n')}\n\nTEXTO DEL PDF POR PÁGINAS (para saber qué pide cada campo):\n${paginas}`;
}

function pasosAnexoPdf(p: PayloadAnexoData): string {
  return [
    'CÓMO RELLENAR:',
    '1. Una entrada en «campos» por cada campo que la hoja permita rellenar: nombre = el nombre exacto del campo de la lista; valor = el dato (texto; true o false en las casillas; en un grupo de opciones o un desplegable, una de sus opciones tal cual); dato = la etiqueta de la hoja de la que sale («NIF»). Casillas: true solo en los criterios automáticos a los que nos acogemos.',
    '2. Los campos de firma y los de solo lectura NO se rellenan, ni el campo donde va el nombre de quien firma («Fdo.»): la plataforma rechaza cualquier texto en ellos. Lugar y fecha, de la hoja («Empresa · Lugar» y «Firma · Fecha»). El importe, solo si la hoja lo trae; si falta, no envíes ese campo. Si el formulario trae campos por lote, rellena solo los del lote de la tarea.',
    `3. Envía licitaciones_anexo (id=${p.id}, clave=${p.clave}, campos) sin desde_parrafo, hasta_parrafo ni sustituciones. La plataforma rellena el formulario sin aplanarlo, lo guarda en Salidas como borrador para que una persona lo revise y lo firme. Si responde con un error, corrige exactamente lo que dice y reenvía el anexo entero.`,
    'No hagas nada más: no escribas en Salidas ni en la Biblioteca y no respondas en ningún canal.',
  ].join('\n');
}

async function instruccionesAnexoPdf(db: Db, dbNucleo: DbNucleo, p: PayloadAnexoData, abs: string): Promise<string> {
  const t = tareaDeAnexo(db, dbNucleo, p, true);
  if (typeof t === 'string') return t;
  return [t.encabezado, '', t.hoja, '', await seccionFormulario(abs), '', pasosAnexoPdf(p)].join('\n');
}

// Un PDF transcrito se rellena como un Word: si al pedirlo se guardó el PDF (la regeneración por
// código lo vuelve a pedir así), el run lee y rellena su transcripción.
function modeloDelRun(db: Db, p: PayloadAnexoData): string | null {
  const abs = filaDocumento(db, p.id, p.clave)?.anexo_modelo ?? null;
  if (!abs?.toLowerCase().endsWith('.pdf')) return abs;
  const g = guionVigente(db, p.id);
  const d = g ? documentoDelGuion(g.datos, p.clave) : null;
  const m = d ? modeloDe(db, raicesActuales(), p.id, d) : null;
  const a = d && m?.data ? analisisDe(db, m.data, d).data : null;
  if (a?.tipo !== 'transcrito' || !a.docx) return abs;
  db.prepare('UPDATE oferta_documentos SET anexo_modelo = ? WHERE licitacion_id = ? AND clave = ?').run(
    a.docx,
    p.id,
    p.clave,
  );
  return a.docx;
}

/** Las instrucciones del run, según el modelo guardado al pedirlo sea un PDF con campos o un Word (o la transcripción de un PDF). */
export function instruccionesDeAnexo(db: Db, dbNucleo: DbNucleo, p: PayloadAnexoData): string | Promise<string> {
  const abs = modeloDelRun(db, p);
  return abs?.toLowerCase().endsWith('.pdf')
    ? instruccionesAnexoPdf(db, dbNucleo, p, abs)
    : instruccionesAnexo(db, dbNucleo, p);
}
