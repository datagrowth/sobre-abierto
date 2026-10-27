// ¿Se pueden leer los pliegos bajados? Lo dice el índice de la Biblioteca, de donde sale el texto que lee Hermes.
import path from 'node:path';
import { abrirIndiceLectura } from '../../biblioteca/motor/documentos/servicioIndice.js';
import { esDocumento } from '../../biblioteca/motor/documentos/extraccion.js';
import * as indice from '../../biblioteca/motor/documentos/almacen.js';
import type { Db } from './store.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';

// Un PDF dañado, escaneado o en un formato que no se indexa no sirve para la ficha, y pedirla solo gastaría un
// run que acaba sin resultado.
type EstadoIndice = 'ok' | 'escaneado' | 'error' | 'sin_indexar' | 'formato_no_legible';
export type Legibilidad = {
  ruta: string;
  clase: string;
  estado_indice: EstadoIndice;
  paginas: number | null;
  error_indice: string | null;
};
export type ListoParaFicha = 'listo' | 'esperar' | 'ilegible';

const ESTADO: Record<indice.EstadoArchivo, EstadoIndice> = { ok: 'ok', scanned: 'escaneado', error: 'error' };
const ILEGIBLE: ReadonlySet<EstadoIndice> = new Set(['escaneado', 'error', 'formato_no_legible']);
const MAX_ILEGIBLES_ESTADO = 30;

/** Cómo está un documento en el índice de la Biblioteca. */
export function estadoEnIndice(db: indice.BaseDatos | null, ruta: string): Omit<Legibilidad, 'ruta' | 'clase'> {
  if (!esDocumento(ruta))
    return {
      estado_indice: 'formato_no_legible',
      paginas: null,
      error_indice: `La Biblioteca no lee archivos ${path.extname(ruta) || 'sin extensión'}.`,
    };
  const f = db ? indice.obtenerArchivo(db, ruta) : null;
  if (!f) return { estado_indice: 'sin_indexar', paginas: null, error_indice: null };
  const error = f.status === 'scanned' ? 'PDF escaneado (solo imagen, sin texto): hace falta OCR.' : f.error;
  return { estado_indice: ESTADO[f.status], paginas: f.pages, error_indice: error };
}

type FilaPliego = { ruta: string; clase: string };

/** Los pliegos descargados de una licitación con su estado en el índice. Sin índice, null. */
export function legibilidadDePliegos(
  db: Db,
  id: string,
  idx: indice.BaseDatos | null = abrirIndiceLectura(),
): Legibilidad[] | null {
  if (!idx) return null;
  // El DEUC (XML de la petición) no es un pliego que lea la ficha: como se indexa, contaría como legible.
  const filas = db
    .prepare(
      "SELECT ruta, clase FROM pliegos WHERE licitacion_id = ? AND estado = 'descargado' AND ruta IS NOT NULL AND tipo IS NOT 'deuc' ORDER BY rowid",
    )
    .all(id) as FilaPliego[];
  return filas.map((f) => ({ ...f, ...estadoEnIndice(idx, f.ruta) }));
}

/**
 * Si la ficha puede leerse ya: con PCAP, alguno legible (es donde están solvencia y
 * criterios); sin PCAP, algún PPT legible. Lo que aún no se ha indexado espera. Sin índice
 * (no hay Biblioteca) no se bloquea nada: decide Hermes.
 */
export function listoParaFicha(leg: Legibilidad[] | null): ListoParaFicha {
  if (!leg?.length) return 'listo';
  const pcap = leg.filter((l) => l.clase === 'pcap');
  const ppt = leg.filter((l) => l.clase === 'ppt');
  const base = pcap.length ? pcap : ppt.length ? ppt : leg;
  if (base.some((l) => l.estado_indice === 'ok')) return 'listo';
  return base.some((l) => l.estado_indice === 'sin_indexar') ? 'esperar' : 'ilegible';
}

/** Por qué no se puede pedir la ficha, en una frase con los documentos y su problema. */
export function motivoIlegible(leg: Legibilidad[]): string {
  const malos = leg
    .filter((l) => ILEGIBLE.has(l.estado_indice))
    .map((l) => `${path.posix.basename(l.ruta)}: ${l.error_indice ?? l.estado_indice}`);
  return `Los pliegos principales no se pueden leer (${malos.slice(0, 3).join('; ')}). Revisa el documento en Drive (o súbelo en PDF con texto) y vuelve a pedir la ficha.`;
}

export type PliegoIlegible = { licitacion: string; titulo: string; ruta: string; clase: string; problema: string };

/** Pliegos bajados de lo que sigue la empresa en plazo que no se pueden leer, para el Estado (la petición del DEUC no es para leerla). */
export function pliegosIlegibles(
  db: Db,
  idx: indice.BaseDatos | null = abrirIndiceLectura(),
  ahoraMs = Date.now(),
): PliegoIlegible[] {
  if (!idx) return [];
  const filas = db
    .prepare(
      `SELECT p.licitacion_id AS licitacion, l.titulo, p.ruta, p.clase FROM pliegos p
    JOIN oportunidades o ON o.licitacion_id = p.licitacion_id JOIN licitaciones l ON l.id = p.licitacion_id
    WHERE p.estado = 'descargado' AND p.ruta IS NOT NULL AND p.tipo IS NOT 'deuc' AND o.estado IN ('nueva', 'en_preparacion')
      AND (l.fecha_limite IS NULL OR l.fecha_limite > ?) ORDER BY COALESCE(l.fecha_limite, '9999')`,
    )
    .all(horaLocalEspana(ahoraMs)) as (FilaPliego & { licitacion: string; titulo: string })[];
  const out: PliegoIlegible[] = [];
  for (const f of filas) {
    const e = estadoEnIndice(idx, f.ruta);
    if (ILEGIBLE.has(e.estado_indice)) out.push({ ...f, problema: e.error_indice ?? e.estado_indice });
    if (out.length >= MAX_ILEGIBLES_ESTADO) break;
  }
  return out;
}
