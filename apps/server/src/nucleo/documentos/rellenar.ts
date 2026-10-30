// Rellenar modelos de Word (anexos de los pliegos) sin tocar su texto. Puro: bytes de entrada y de salida.
import { strFromU8, strToU8, unzipSync, zipSync, type UnzipFileInfo } from 'fflate';
import { errorMessage, fail, ok, type Result } from '../result.js';

// Se localizan los huecos («……», «___», casillas «☐» y etiquetas como «con NIF») en el XML del .docx, se cambia
// solo el texto planificado (el valor va en el primer run del tramo y hereda su formato, aunque el hueco cruce
// varios w:r) y se comprueba que nada más cambió. También se saca un rango de párrafos a un .docx propio: los
// modelos suelen venir todos en un mismo documento de anexos.
const MAX_DOCX_BYTES = 30 * 1024 * 1024;
const MAX_DESCOMPRIMIDO = 200 * 1024 * 1024;
const DOCUMENTO = 'word/document.xml';

// Huecos: puntos o guiones bajos (con espacios entre medias), elipsis y casillas vacías.
const HUECO = /…+(?:[\s.…_]*[.…_])?|\.{3,}(?:[\s.…_]*[.…_])?|_{3,}(?:[\s.…_]*[.…_])?|☐|\[ ?\]|\( ?\)/gu;
const ETIQUETAS: { clave: string; re: RegExp }[] = [
  { clave: 'nombre', re: /\bD\.?\s*\/\s*D[ñn]a\.?|\bD\.ª|\bDon\s*\/\s*Doña\b|nombre y apellidos/giu },
  { clave: 'nif', re: /\b(?:N\.?\s?I\.?\s?F|D\.?\s?N\.?\s?I|C\.?\s?I\.?\s?F|N\.?\s?I\.?\s?E)\b\.?/gu },
  { clave: 'representacion', re: /en (?:nombre y )?representaci[oó]n de/giu },
  { clave: 'domicilio', re: /domicilio/giu },
  { clave: 'importe', re: /importe|euros|€|precio/giu },
  { clave: 'telefono', re: /tel[eé]fono/giu },
  { clave: 'correo', re: /correo electr[oó]nico|e-?mail/giu },
  { clave: 'lugar', re: /\blugar\b/giu },
  { clave: 'fecha', re: /\bfecha\b/giu },
  // La firma la pone una persona con su certificado: su hueco se queda en blanco.
  { clave: 'firma', re: /\bfdo\b\.?|\bfirmad[oa]\b|\bfirma\b(?: del (?:proponente|licitador|representante))?/giu },
];

export type Hueco = { tipo: 'puntos' | 'casilla' | 'etiqueta'; texto: string; inicio: number; etiqueta: string | null };
export type Parrafo = { indice: number; texto: string; en_tabla: boolean; huecos: Hueco[] };
export type Huecos = { parrafos: Parrafo[]; total: number; markdown: string };
export type Sustitucion = { parrafo: number; original: string; nuevo: string };
export type Relleno = { docx: Buffer; aplicadas: Sustitucion[]; noEncontradas: Sustitucion[] };

// ── XML mínimo: árbol de elementos con sus posiciones en el texto ──

export type Nodo = { nombre: string; inicio: number; finApertura: number; cierre: number; fin: number; hijos: Nodo[] };

const ETIQUETA_XML =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

export function arbol(xml: string): Nodo[] {
  const raiz: Nodo = { nombre: '', inicio: 0, finApertura: 0, cierre: xml.length, fin: xml.length, hijos: [] };
  const pila: Nodo[] = [raiz];
  for (const m of xml.matchAll(ETIQUETA_XML)) {
    if (!m[2]) continue;
    const padre = pila[pila.length - 1]!;
    const fin = m.index + m[0].length;
    if (m[1]) {
      if (pila.length > 1 && padre.nombre === m[2]) {
        padre.cierre = m.index;
        padre.fin = fin;
        pila.pop();
      }
      continue;
    }
    const nodo: Nodo = { nombre: m[2], inicio: m.index, finApertura: fin, cierre: fin, fin, hijos: [] };
    padre.hijos.push(nodo);
    if (!m[4]) pila.push(nodo);
  }
  return raiz.hijos;
}

export const hijo = (n: Nodo | undefined, nombre: string) => n?.hijos.find((h) => h.nombre === nombre);

export function cuerpo(xml: string): Nodo | null {
  return (
    hijo(
      arbol(xml).find((n) => n.nombre === 'w:document'),
      'w:body',
    ) ?? null
  );
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const desescapar = (s: string) =>
  s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (t, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : (ENTIDADES[e] ?? t),
  );
const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Párrafos del cuerpo en orden (también los de las tablas). Los de un cuadro de texto van
// con el párrafo que lo contiene: no se cuentan aparte.
function parrafosDe(n: Nodo, enTabla: boolean, out: { nodo: Nodo; en_tabla: boolean }[]): void {
  for (const h of n.hijos) {
    if (h.nombre === 'w:p') out.push({ nodo: h, en_tabla: enTabla });
    else parrafosDe(h, enTabla || h.nombre === 'w:tbl', out);
  }
}

// Lo que no es texto visible del párrafo: cuadros de texto, la alternativa de compatibilidad
// y los párrafos anidados.
const SIN_TEXTO = new Set(['w:txbxContent', 'mc:Fallback', 'w:p', 'w:del']);

export type Trozo = { nodo: Nodo; texto: string };

export function trozosDe(n: Nodo, xml: string, out: Trozo[]): Trozo[] {
  for (const h of n.hijos) {
    if (h.nombre === 'w:t')
      out.push({ nodo: h, texto: h.cierre > h.finApertura ? desescapar(xml.slice(h.finApertura, h.cierre)) : '' });
    else if (!SIN_TEXTO.has(h.nombre)) trozosDe(h, xml, out);
  }
  return out;
}

type ParrafoXml = { nodo: Nodo; en_tabla: boolean; trozos: Trozo[] };

function leerParrafos(xml: string): Result<{ body: Nodo; parrafos: ParrafoXml[] }> {
  const body = cuerpo(xml);
  if (!body) return fail('docx_invalido', 'El documento no tiene cuerpo (word/document.xml sin w:body).');
  const lista: { nodo: Nodo; en_tabla: boolean }[] = [];
  parrafosDe(body, false, lista);
  return ok({ body, parrafos: lista.map((p) => ({ ...p, trozos: trozosDe(p.nodo, xml, []) })) });
}

const textoDe = (p: ParrafoXml) => p.trozos.map((t) => t.texto).join('');

// ── Paquete .docx ──

export type Paquete = { archivos: Record<string, Uint8Array>; xml: string };

// Topes como en la lectura de la Biblioteca: un modelo pesa KB; un ZIP que declara gigas, no.
export function abrir(docx: Uint8Array): Result<Paquete> {
  if (docx.length > MAX_DOCX_BYTES)
    return fail('too_large', 'El documento pasa de 30 MB: no parece un modelo de anexo.');
  let total = 0;
  try {
    const archivos = unzipSync(docx, {
      filter: (f: UnzipFileInfo) => {
        total += Math.max(f.size, f.originalSize);
        if (total > MAX_DESCOMPRIMIDO) throw new Error('demasiado grande al descomprimir');
        return true;
      },
    });
    const doc = archivos[DOCUMENTO];
    if (!doc) return fail('docx_invalido', 'No es un .docx: falta word/document.xml.');
    return ok({ archivos, xml: strFromU8(doc) });
  } catch (err) {
    return fail('docx_invalido', `No se pudo abrir el .docx: ${errorMessage(err)}`);
  }
}

const cerrar = (p: Paquete, xml: string): Buffer => Buffer.from(zipSync({ ...p.archivos, [DOCUMENTO]: strToU8(xml) }));

// ── Huecos ──

function etiquetaAntes(texto: string, inicio: number): string | null {
  let mejor: { clave: string; fin: number } | null = null;
  for (const e of ETIQUETAS) {
    for (const m of texto.slice(0, inicio).matchAll(e.re)) {
      const fin = m.index + m[0].length;
      if (!mejor || fin >= mejor.fin) mejor = { clave: e.clave, fin };
    }
  }
  return mejor && inicio - mejor.fin <= 60 ? mejor.clave : null;
}

// Un párrafo que acaba en una etiqueta («Teléfono:») también es un hueco: el dato va detrás.
function etiquetaFinal(texto: string): string | null {
  const limpio = texto.replace(/[\s:]+$/u, '');
  const e = ETIQUETAS.find((x) => [...limpio.matchAll(x.re)].some((m) => m.index + m[0].length === limpio.length));
  return e?.clave ?? null;
}

/** Los huecos de un texto, con la etiqueta que tienen delante (si hay). */
export function huecosDe(texto: string): Hueco[] {
  const huecos: Hueco[] = [...texto.matchAll(HUECO)].map((m) => ({
    tipo: /^(?:☐|\[ ?\]|\( ?\))$/u.test(m[0]) ? 'casilla' : 'puntos',
    texto: m[0],
    inicio: m.index,
    etiqueta: etiquetaAntes(texto, m.index),
  }));
  const final = huecos.length ? null : etiquetaFinal(texto);
  return final ? [{ tipo: 'etiqueta', texto: '', inicio: texto.length, etiqueta: final }] : huecos;
}

const MAX_LINEA = 600;

function marcaHuecos(p: Parrafo): string {
  if (!p.huecos.length) return '';
  const etiquetas = [...new Set(p.huecos.flatMap((h) => (h.etiqueta ? [h.etiqueta] : [])))];
  return `  ⟵ ${p.huecos.length} ${p.huecos.length === 1 ? 'hueco' : 'huecos'}${etiquetas.length ? ` (${etiquetas.join(', ')})` : ''}`;
}

/** Los párrafos numerados en Markdown (todos o un rango), con los huecos señalados al final de la línea. */
export function markdownDeParrafos(parrafos: Parrafo[], desde = 1, hasta = Number.MAX_SAFE_INTEGER): string {
  return parrafos
    .filter((p) => p.indice >= desde && p.indice <= hasta)
    .map((p) => {
      const texto = p.texto.length > MAX_LINEA ? `${p.texto.slice(0, MAX_LINEA)}…[recortado]` : p.texto;
      return `[${p.indice}] ${p.en_tabla ? '| ' : ''}${texto}${marcaHuecos(p)}`;
    })
    .join('\n');
}

/** Párrafos con texto del documento (numerados desde 1, también los de tablas) y sus huecos. */
export function localizarHuecos(docx: Uint8Array): Result<Huecos> {
  const p = abrir(docx);
  if (p.error) return p;
  const l = leerParrafos(p.data.xml);
  if (l.error) return l;
  const parrafos = l.data.parrafos.flatMap((x, i) => {
    const texto = textoDe(x);
    return texto.trim() ? [{ indice: i + 1, texto, en_tabla: x.en_tabla, huecos: huecosDe(texto) }] : [];
  });
  return ok({ parrafos, total: l.data.parrafos.length, markdown: markdownDeParrafos(parrafos) });
}

// ── Extraer un rango ──

type Hijo = { nodo: Nodo; desde: number; hasta: number };

// Cada hijo del cuerpo con el rango de párrafos que contiene (0..-1 si no tiene ninguno).
function hijosConRango(body: Nodo, parrafos: ParrafoXml[]): Hijo[] {
  const posicion = new Map(parrafos.map((p, i) => [p.nodo, i + 1]));
  return body.hijos
    .filter((h) => h.nombre !== 'w:sectPr')
    .map((h) => {
      const dentro: { nodo: Nodo; en_tabla: boolean }[] = h.nombre === 'w:p' ? [{ nodo: h, en_tabla: false }] : [];
      if (h.nombre !== 'w:p') parrafosDe(h, false, dentro);
      const idx = dentro.map((d) => posicion.get(d.nodo) ?? 0).filter((n) => n > 0);
      return { nodo: h, desde: idx.length ? Math.min(...idx) : 0, hasta: idx.length ? Math.max(...idx) : -1 };
    });
}

/**
 * Un .docx con solo los párrafos `desde`..`hasta` (1-based, como localizarHuecos) del cuerpo.
 * Una tabla que cae en parte en el rango va entera. Estilos, numeración, cabeceras y la
 * sección final se conservan: es el mismo paquete con otro cuerpo.
 */
export function extraerParrafos(docx: Uint8Array, desde: number, hasta: number): Result<Buffer> {
  const p = abrir(docx);
  if (p.error) return p;
  const l = leerParrafos(p.data.xml);
  if (l.error) return l;
  const total = l.data.parrafos.length;
  if (!Number.isInteger(desde) || !Number.isInteger(hasta) || desde < 1 || hasta < desde || hasta > total) {
    return fail('invalid_input', `Rango de párrafos no válido (${desde}-${hasta}): el documento tiene ${total}.`);
  }
  const hijos = hijosConRango(l.data.body, l.data.parrafos);
  const dentro = hijos.map((h) => h.hasta >= desde && h.desde <= hasta && h.desde > 0);
  const primero = dentro.indexOf(true);
  const ultimo = dentro.lastIndexOf(true);
  const elegidos = hijos.filter((h, i) => dentro[i] || (h.desde === 0 && i > primero && i < ultimo));
  const { xml } = p.data;
  const sect = hijo(l.data.body, 'w:sectPr');
  const interior =
    elegidos.map((h) => xml.slice(h.nodo.inicio, h.nodo.fin)).join('') + (sect ? xml.slice(sect.inicio, sect.fin) : '');
  return ok(cerrar(p.data, xml.slice(0, l.data.body.finApertura) + interior + xml.slice(l.data.body.cierre)));
}

// ── Rellenar ──

// Cambia el tramo [s, e) del texto del párrafo: el valor va en el primer trozo del tramo y
// los demás pierden lo que caía dentro.
function sustituirEnTrozos(trozos: Trozo[], s: number, e: number, nuevo: string): void {
  let pos = 0;
  let puesto = false;
  for (const t of trozos) {
    const ini = pos;
    const fin = pos + t.texto.length;
    pos = fin;
    if (fin <= s || ini >= e || fin === ini) continue;
    const antes = puesto ? '' : t.texto.slice(0, Math.max(0, s - ini));
    const despues = e < fin ? t.texto.slice(e - ini) : '';
    t.texto = antes + (puesto ? '' : nuevo) + despues;
    puesto = true;
  }
}

/** Aplica las sustituciones al texto, en orden: cada una cambia la primera aparición que queda. */
function aplicarATexto(texto: string, subs: Pick<Sustitucion, 'original' | 'nuevo'>[]): string {
  return subs.reduce((t, s) => {
    const i = s.original ? t.indexOf(s.original) : -1;
    return i === -1 ? t : t.slice(0, i) + s.nuevo + t.slice(i + s.original.length);
  }, texto);
}

function aplicarEnParrafos(parrafos: ParrafoXml[], subs: Sustitucion[]): Omit<Relleno, 'docx'> {
  const aplicadas: Sustitucion[] = [];
  const noEncontradas: Sustitucion[] = [];
  for (const s of subs) {
    const p = parrafos[s.parrafo - 1];
    const i = p && s.original ? textoDe(p).indexOf(s.original) : -1;
    if (!p || i === -1) {
      noEncontradas.push(s);
      continue;
    }
    sustituirEnTrozos(p.trozos, i, i + s.original.length, s.nuevo);
    aplicadas.push(s);
  }
  return { aplicadas, noEncontradas };
}

// Reescribe solo el contenido de los w:t que cambiaron (de atrás adelante: las posiciones valen).
function reescribir(xml: string, trozos: { trozo: Trozo; antes: string }[]): string {
  const cambiados = trozos
    .filter((x) => x.trozo.texto !== x.antes)
    .sort((a, b) => b.trozo.nodo.inicio - a.trozo.nodo.inicio);
  let out = xml;
  for (const { trozo } of cambiados) {
    const n = trozo.nodo;
    out = `${out.slice(0, n.inicio)}<w:t xml:space="preserve">${escapar(trozo.texto)}</w:t>${out.slice(n.fin)}`;
  }
  return out;
}

/**
 * Rellena los huecos planificados: cada sustitución cambia la primera aparición de `original`
 * que queda en su párrafo (1-based). Las que no se encuentran no se aplican.
 */
export function rellenarDocx(docx: Uint8Array, sustituciones: Sustitucion[]): Result<Relleno> {
  const p = abrir(docx);
  if (p.error) return p;
  const l = leerParrafos(p.data.xml);
  if (l.error) return l;
  const trozos = l.data.parrafos.flatMap((x) => x.trozos.map((trozo) => ({ trozo, antes: trozo.texto })));
  const r = aplicarEnParrafos(l.data.parrafos, sustituciones);
  return ok({ docx: cerrar(p.data, reescribir(p.data.xml, trozos)), ...r });
}

// ── Seguro de literalidad ──

/** ¿`original` es un hueco del modelo (trae «……», «___» o una casilla, o acaba en una etiqueta)? */
export function esHueco(original: string): boolean {
  return huecosDe(original).length > 0;
}

/** El texto del modelo que trae `original` fuera de sus huecos, en orden. */
export function literalesDe(original: string): string[] {
  return original
    .split(HUECO)
    .map((t) => t.trim())
    .filter(Boolean);
}

function literalPerdido(s: Sustitucion): string | null {
  let pos = 0;
  for (const lit of literalesDe(s.original)) {
    const i = s.nuevo.indexOf(lit, pos);
    if (i === -1) return lit;
    pos = i + lit.length;
  }
  return null;
}

function problemasDeSustituciones(subs: Sustitucion[]): string[] {
  return subs.flatMap((s) => {
    if (!esHueco(s.original))
      return [
        `Párrafo ${s.parrafo}: «${s.original.slice(0, 120)}» no es un hueco del modelo (no trae «……», «___», una casilla ni acaba en una etiqueta): solo se rellenan huecos.`,
      ];
    const perdido = literalPerdido(s);
    return perdido
      ? [
          `Párrafo ${s.parrafo}: «${s.nuevo.slice(0, 120)}» cambia el texto del modelo «${perdido.slice(0, 120)}»: solo se rellenan los huecos y el texto del modelo se conserva literal.`,
        ]
      : [];
  });
}

const sinTextos = (xml: string) => xml.replace(/<w:t(?:\s[^>]*)?\/>|<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, '<w:t/>');

function problemasDeTexto(a: ParrafoXml[], b: ParrafoXml[], subs: Sustitucion[]): string[] {
  if (a.length !== b.length)
    return [
      `El documento rellenado tiene ${b.length} párrafos y el modelo ${a.length}: solo se rellenan huecos, no se añaden ni se quitan párrafos.`,
    ];
  return a.flatMap((p, i) => {
    const esperado = aplicarATexto(
      textoDe(p),
      subs.filter((s) => s.parrafo === i + 1),
    );
    return esperado === textoDe(b[i]!) ? [] : [`El párrafo ${i + 1} cambió fuera de los huecos planificados.`];
  });
}

/**
 * Seguro de literalidad: todo lo que cambia entre el modelo y el rellenado y no es un hueco
 * planificado (texto del modelo perdido, párrafos distintos de lo previsto, formato o
 * estructura). Vacío si el rellenado solo cambió lo planificado.
 */
export function diferenciasFueraDelPlan(
  original: Uint8Array,
  relleno: Uint8Array,
  sustituciones: Sustitucion[],
): string[] {
  const a = abrir(original);
  const b = abrir(relleno);
  if (a.error || b.error) return [`No se pudo comparar: ${(a.error ?? b.error)!.message}`];
  const pa = leerParrafos(a.data.xml);
  const pb = leerParrafos(b.data.xml);
  if (pa.error || pb.error) return [`No se pudo comparar: ${(pa.error ?? pb.error)!.message}`];
  const estructura =
    sinTextos(a.data.xml) === sinTextos(b.data.xml)
      ? []
      : ['El documento cambió fuera del texto de los huecos (formato o estructura).'];
  return [
    ...problemasDeSustituciones(sustituciones),
    ...problemasDeTexto(pa.data.parrafos, pb.data.parrafos, sustituciones),
    ...estructura,
  ];
}
