// De dónde sale el modelo de un anexo: en qué pliego está (o el Word homónimo que lo trae suelto)
// y sus bytes como .docx.
import fsp from 'node:fs/promises';
import path from 'node:path';
import { docxConvertido } from '../../../nucleo/documentos/conversiones.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, type Raices } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import type { DocumentoConClave } from './documentos.js';

export const CONVERTIBLES = new Set(['.doc', '.rtf']);

export const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();
const sinExtension = (t: string) => comparable(t).replace(/\.[a-z0-9]{2,4}$/, '');

// ruta: la del pliego en Conocimiento («Conocimiento/…»), la clave de su análisis en modelos_pdf.
export type Modelo = { abs: string; ext: string; documento: string; ruta: string };

function pliegoDelModelo(db: Db, id: string, documento: string): string | null {
  const buscado = sinExtension(documento.replace(/^Conocimiento\//, ''));
  const filas = db
    .prepare("SELECT nombre, ruta FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL")
    .all(id) as { nombre: string; ruta: string }[];
  return (
    filas.find((f) => [f.nombre, path.posix.basename(f.ruta), f.ruta].some((x) => sinExtension(x) === buscado))?.ruta ??
    null
  );
}

// Con su subnumeración: «Anexo V.2» no es el «Anexo V.1» ni el «Anexo V».
const ANEXO_NUMERO = /\banexo\s+([ivxlcdm]+|\d+)((?:\.\d+)*)(\s*bis)?\b/i;
const EXT_HOMONIMO = new Set(['.docx', '.doc', '.rtf']);

/** La clave del anexo que nombra un modelo («Anexo V, LOTE 3» → «V»; «Anexo V.2 compromiso» → «V.2»; «Anexo III Bis» → «III BIS»), o null. */
export function numeroDeAnexo(modelo: string): string | null {
  const m = ANEXO_NUMERO.exec(modelo);
  return m ? `${m[1]}${m[2] ?? ''}${m[3] ? ' bis' : ''}`.toUpperCase() : null;
}

const sinSeparadores = (t: string) => comparable(t.replace(/[_\-.]+/g, ' '));

// Un archivo «Anexo V…» solo es el del modelo si tras el número no sigue otro (VI, V bis salvo que
// se pida) ni una subnumeración: «ANEXO V.1.docx» queda «anexo v 1», y no es el «Anexo V».
function nombreDeAnexo(nombre: string, numero: string): boolean {
  const t = sinSeparadores(nombre);
  const n = sinSeparadores(numero);
  if (!t.startsWith(`anexo ${n}`)) return false;
  const resto = t.slice(`anexo ${n}`.length);
  return (
    (resto === '' || !/^[a-z0-9]/.test(resto)) &&
    !/^\s*\d/.test(resto) &&
    (n.endsWith(' bis') || !/^\s*bis\b/.test(resto))
  );
}

// «lote 3» como palabra entera dentro del nombre (con guiones o guiones bajos como separadores).
function nombreConLote(nombre: string, lote: string): boolean {
  const palabras = ` ${comparable(nombre.replace(/[_\-.]+/g, ' '))} `;
  return palabras.includes(` lote ${comparable(lote)} `);
}

/**
 * El pliego Word con el mismo anexo que el modelo («ANEXO V.docx» para «Anexo V»): un modelo suelto
 * rellena mejor que localizarlo dentro del PDF del pliego. Ante varios, el del lote y luego el más corto.
 */
export function pliegoHomonimo(db: Db, id: string, modelo: string, lote: string | null): string | null {
  const numero = numeroDeAnexo(modelo);
  if (!numero) return null;
  const filas = db
    .prepare("SELECT nombre, ruta FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL")
    .all(id) as { nombre: string; ruta: string }[];
  const base = (x: string) => path.posix.basename(x).replace(/\.[A-Za-z0-9]{2,4}$/, '');
  const candidatos = filas.filter(
    (f) =>
      EXT_HOMONIMO.has(path.extname(f.ruta).toLowerCase()) &&
      [f.nombre, base(f.ruta)].some((x) => nombreDeAnexo(base(x), numero)),
  );
  const nombraLote = (f: { nombre: string; ruta: string }) =>
    lote !== null && [f.nombre, base(f.ruta)].some((x) => nombreConLote(x, lote));
  const rango = (f: { nombre: string; ruta: string }) => [nombraLote(f) ? 0 : 1, base(f.ruta).length] as const;
  candidatos.sort((x, y) => rango(x)[0] - rango(y)[0] || rango(x)[1] - rango(y)[1]);
  return candidatos[0]?.ruta ?? null;
}

// Si el guion ya señala un Word entre los pliegos, manda el guion: el homónimo solo sustituye a un
// modelo metido en el PDF, que es donde rellenar sale peor.
export function homonimoDe(db: Db, id: string, d: DocumentoConClave): string | null {
  const modelo = d.doc.origen?.modelo;
  if (d.doc.tipo === 'deuc' || !modelo) return null;
  const delGuion = d.doc.origen?.documento ? pliegoDelModelo(db, id, d.doc.origen.documento) : null;
  if (delGuion && EXT_HOMONIMO.has(path.extname(delGuion).toLowerCase())) return null;
  return pliegoHomonimo(db, id, modelo, d.lote);
}

export function modeloDe(db: Db, raices: Raices, id: string, d: DocumentoConClave): Result<Modelo> {
  if (d.doc.tipo === 'memoria')
    return fail('invalid_input', 'La memoria técnica se redacta en el paso 3: no es un modelo que rellenar.');
  const homonimo = homonimoDe(db, id, d);
  const documento = homonimo ? path.posix.basename(homonimo) : d.doc.origen?.documento;
  if (!documento) return fail('invalid_input', 'El guion no dice en qué documento está el modelo: rellénalo a mano.');
  const ruta = homonimo ?? pliegoDelModelo(db, id, documento);
  if (!ruta)
    return fail('invalid_input', `No encuentro «${documento}» entre los pliegos descargados de la licitación.`);
  const abs = documentoEnDisco(raices, `Conocimiento/${ruta}`);
  if (abs.error) return abs;
  const ext = path.extname(ruta).toLowerCase();
  if (ext !== '.docx' && ext !== '.pdf' && !CONVERTIBLES.has(ext))
    return fail(
      'invalid_input',
      `El modelo «${documento}» no es un documento de Word (.docx, .doc o .rtf) ni un PDF con campos: rellénalo a mano.`,
    );
  return ok({ abs: abs.data, ext, documento, ruta: `Conocimiento/${ruta}` });
}

export async function modeloDocx(
  db: Db,
  raices: Raices,
  id: string,
  d: DocumentoConClave,
): Promise<Result<{ bytes: Buffer; abs: string }>> {
  const m = modeloDe(db, raices, id, d);
  if (m.error) return m;
  const abs = CONVERTIBLES.has(m.data.ext) ? await docxConvertido(m.data.abs) : ok(m.data.abs);
  if (abs.error) return abs;
  try {
    return ok({ bytes: await fsp.readFile(abs.data), abs: abs.data });
  } catch (err) {
    return fail('io_error', `No se pudo leer el modelo: ${errorMessage(err)}`);
  }
}

/** El nombre corto del modelo («Anexo VII»): el del guion o, si no, el principio del nombre del documento. */
export function modeloBuscado(d: DocumentoConClave): string {
  return d.doc.origen?.modelo ?? /^anexo\s+[^\s.:,;-]+/i.exec(d.doc.nombre)?.[0] ?? d.doc.nombre;
}
