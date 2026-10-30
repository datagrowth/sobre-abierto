// Un modelo en PDF se rellena según su análisis guardado (modelosPdf.ts): con formulario, transcrito a
// .docx o a mano; aquí, si se puede rellenar, por qué no y qué ruta lee el run.
import fs from 'node:fs';
import path from 'node:path';
import { carpetaConversiones } from '../../../nucleo/documentos/conversiones.js';
import { disponible } from '../../../nucleo/documentos/libreoffice.js';
import { localizarHuecos } from '../../../nucleo/documentos/rellenar.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Raices } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import type { DocumentoConClave } from './documentos.js';
import { AVISO_TABLA } from './tablaRequisitos.js';
import { falloDeAnalisis, huellaRecordada, modeloPdfGuardado, type ModeloPdf } from './modelosPdf.js';
import { licitacionesEnPreparacion } from './plazo.js';
import { CONVERTIBLES, type Modelo, modeloBuscado, modeloDe, modeloDocx } from './anexosModelo.js';

export const LEYENDO_PDF = 'Hermes está leyendo el modelo PDF: en un minuto se podrá rellenar.';

export const FUERA_DE_PREPARACION =
  'Hermes lee los modelos PDF de las ofertas en preparación con plazo: pon la licitación en preparación o rellénalo a mano.';

/**
 * El análisis guardado del modelo del documento dentro de su PDF, o null si aún no se analizó (o el
 * PDF cambió). Solo lee: el sha256 es el que calculó la vuelta (huellaRecordada); hashear aquí un
 * pliego de decenas de MB bloquearía cada carga de la checklist.
 */
export function analisisDe(db: Db, m: Modelo, d: DocumentoConClave): Result<ModeloPdf | null> {
  const sha256 = huellaRecordada(m.abs);
  return ok(sha256 ? modeloPdfGuardado(db, m.ruta, sha256, modeloBuscado(d)) : null);
}

const enPreparacion = (db: Db, id: string) => licitacionesEnPreparacion(db).some((l) => l.id === id);

// Sin análisis: falló hace poco (se reintenta), la vuelta aún no llegó o nunca llegará (fuera de preparación).
function motivoSinAnalisis(db: Db, id: string, m: Modelo, d: DocumentoConClave): string {
  const sha256 = huellaRecordada(m.abs);
  const fallo = sha256 ? falloDeAnalisis(m.ruta, sha256, modeloBuscado(d)) : null;
  if (fallo)
    return `Hermes no pudo leer el modelo PDF (${fallo.replace(/[.\s]+$/, '')}): lo intenta de nuevo en unos minutos.`;
  return enPreparacion(db, id) ? LEYENDO_PDF : FUERA_DE_PREPARACION;
}

// null si el PDF se puede rellenar (con campos o transcrito); si no, por qué.
function motivoDePdf(db: Db, id: string, m: Modelo, d: DocumentoConClave): string | null {
  const a = analisisDe(db, m, d).data;
  if (!a) return motivoSinAnalisis(db, id, m, d);
  return a.tipo === 'a_mano' ? (a.motivo ?? 'El modelo es un PDF sin campos: rellénalo a mano.') : null;
}

// Lo que se da al run de un modelo PDF: el PDF con campos tal cual o el .docx de su transcripción.
// Una transcripción que ya no está en disco se olvida para que la vuelta la rehaga.
export function rutaDePdf(db: Db, id: string, m: Modelo, d: DocumentoConClave): Result<string> {
  const motivo = motivoDePdf(db, id, m, d);
  if (motivo) return fail('invalid_input', motivo);
  const a = analisisDe(db, m, d).data!;
  if (a.tipo === 'campos') return ok(m.abs);
  if (a.docx && fs.existsSync(a.docx)) return ok(a.docx);
  db.prepare('DELETE FROM modelos_pdf WHERE ruta = ? AND sha256 = ? AND modelo = ?').run(a.ruta, a.sha256, a.modelo);
  return fail('invalid_input', LEYENDO_PDF);
}

// tabla: el .docx no es el texto del PDF sino la tabla de requisitos rehecha (tablaRequisitos.ts).
export type Transcrito = { abs: string; pliego: string; desde: number | null; hasta: number | null; tabla: boolean };

/** Si el modelo guardado para el run es la transcripción de un PDF (conversiones/transcritos/), de qué pliego y páginas; si no, null. */
export function transcritoDe(db: Db, abs: string | null): Transcrito | null {
  if (!abs || path.dirname(path.resolve(abs)) !== path.join(carpetaConversiones(), 'transcritos')) return null;
  const f = db
    .prepare(
      'SELECT ruta, desde_pagina, hasta_pagina, motivo FROM modelos_pdf WHERE docx = ? ORDER BY analizado_en DESC LIMIT 1',
    )
    .get(abs) as
    { ruta: string; desde_pagina: number | null; hasta_pagina: number | null; motivo: string | null } | undefined;
  return f
    ? {
        abs,
        pliego: path.posix.basename(f.ruta),
        desde: f.desde_pagina,
        hasta: f.hasta_pagina,
        tabla: f.motivo === AVISO_TABLA,
      }
    : null;
}

// «pág. 3» o «págs. 1-3».
export const paginasDe = (t: Transcrito) =>
  t.desde === null ? 'págs. del tramo' : t.desde === t.hasta ? `pág. ${t.desde}` : `págs. ${t.desde}-${t.hasta}`;
export const avisoTranscrito = (t: Transcrito) =>
  t.tabla
    ? AVISO_TABLA
    : `Transcrito del PDF del pliego («${t.pliego}», ${paginasDe(t)}): compáralo con el original antes de firmar.`;

// null si se puede rellenar; si no, por qué.
export async function motivoNoRellenable(
  db: Db,
  raices: Raices,
  id: string,
  d: DocumentoConClave,
): Promise<string | null> {
  if (!raices.salidas) return 'Falta SALIDAS_DIR en el servidor: el anexo rellenado se guarda en Salidas.';
  const m = modeloDe(db, raices, id, d);
  if (m.error) return m.error.message;
  if (m.data.ext === '.pdf') return motivoDePdf(db, id, m.data, d);
  if (CONVERTIBLES.has(m.data.ext) && (await disponible()).estado !== 'ok') {
    return `El modelo es un Word antiguo (${m.data.ext}): hace falta LibreOffice en el servidor para convertirlo (ver docs/operar/biblioteca.md → Documentos: LibreOffice).`;
  }
  return null;
}

/** La ruta del modelo listo para el run: un .docx (o su conversión) con huecos legibles, un PDF con campos o la transcripción .docx de un PDF sin campos. */
export async function modeloParaPedir(
  db: Db,
  raices: Raices,
  id: string,
  d: DocumentoConClave,
): Promise<Result<string>> {
  const m = modeloDe(db, raices, id, d);
  if (m.error) return m;
  if (m.data.ext === '.pdf') return rutaDePdf(db, id, m.data, d);
  const docx = await modeloDocx(db, raices, id, d);
  if (docx.error) return docx;
  const h = localizarHuecos(docx.data.bytes);
  return h.error ? fail('invalid_input', `No se puede leer el modelo: ${h.error.message}`) : ok(docx.data.abs);
}
