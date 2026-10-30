// Topes por oferta y 24 h: un bucle en una sola oferta no puede gastar el cupo del modelo de todas.
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { MOTIVO_TOPE } from '../../../nucleo/colaOrden.js';
import type { Trabajo } from '../../../nucleo/colaTipos.js';
import { dbLicitaciones } from '../db.js';
import type { Db } from '../store.js';
import { TIPO_LECCIONES } from './lecciones.js';
import { guardaPlazo } from './plazo.js';
import { TIPO_PROPUESTA_DECISIONES } from './propuestaDecisiones.js';

// Los bucles posibles son reintentos, rondas o encadenados. Lo que pide una persona sale siempre (lo ha visto y
// lo quiere); lo que pide la plataforma sola espera a que la ventana de 24 h deje sitio. Se cuentan los runs
// lanzados (trabajos_lanzamientos: cada reintento y relanzamiento es uno), así que sobrevive a un reinicio. Un
// trabajo lanzado antes de apuntarlos cuenta como uno.
/** Motivo de espera: la oferta está en sus últimas horas y las lecciones no compiten con ella. */
export const MOTIVO_PLAZO_CERCANO = 'plazo_cercano';
const DIA_MS = 86_400_000;
const desdeIso = (ahoraMs: number): string => new Date(ahoraMs - DIA_MS).toISOString();

/**
 * Las memorias de ensayo de la licitación y los Word de sus versiones: sus trabajos traen
 * memoria_id (apartados, fases y rondas) o documento (la autoevaluación).
 */
function ensayosDe(dbLic: Db, id: string): { memorias: number[]; documentos: string[] } {
  const memorias = (
    dbLic.prepare('SELECT id FROM memorias WHERE licitacion_id = ? AND ensayo = 1').all(id) as { id: number }[]
  ).map((m) => m.id);
  const documentos = (
    dbLic
      .prepare(
        `SELECT b.ruta FROM borradores b JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND m.ensayo = 1`,
      )
      .all(id) as { ruta: string }[]
  ).map((b) => b.ruta);
  return { memorias, documentos };
}

// Fragmento fijo: las listas van como parámetros JSON.
const SIN_ENSAYO = `AND (json_extract(payload, '$.memoria_id') IS NULL OR json_extract(payload, '$.memoria_id') NOT IN (SELECT value FROM json_each(?)))
  AND (json_extract(payload, '$.documento') IS NULL OR json_extract(payload, '$.documento') NOT IN (SELECT value FROM json_each(?)))`;

const LANZAMIENTOS = '(SELECT COUNT(*) FROM trabajos_lanzamientos l WHERE l.trabajo_id = t.id AND l.lanzado_en >= ?)';

/**
 * Runs de Hermes lanzados para la licitación `id` en las últimas 24 h (a mano o no), sin los de
 * su memoria de ensayo: el ensayo no puede dejar sin runs a la oferta de verdad.
 */
export function runsDeOfertaHoy(
  dbNucleo: DbNucleo,
  id: string,
  ahoraMs = Date.now(),
  dbLic: Db = dbLicitaciones(),
): number {
  const e = ensayosDe(dbLic, id);
  const desde = desdeIso(ahoraMs);
  return (
    dbNucleo
      .prepare(
        `SELECT COALESCE(SUM(MAX(${LANZAMIENTOS}, CASE WHEN t.lanzado_en >= ? THEN 1 ELSE 0 END)), 0) AS n
    FROM trabajos_ia t WHERE dominio = 'licitaciones' AND json_extract(payload, '$.id') = ?
    AND (t.lanzado_en >= ? OR ${LANZAMIENTOS} > 0) ${SIN_ENSAYO}`,
      )
      .get(desde, desde, id, desde, desde, JSON.stringify(e.memorias), JSON.stringify(e.documentos)) as { n: number }
  ).n;
}

/** Propuestas de decisiones que la plataforma pidió sola para la licitación `id` en las últimas 24 h. */
export function propuestasAutoHoy(dbNucleo: DbNucleo, id: string, ahoraMs = Date.now()): number {
  return (
    dbNucleo
      .prepare(
        `SELECT COUNT(*) AS n FROM trabajos_ia WHERE dominio = 'licitaciones' AND tipo = ?
    AND a_mano = 0 AND json_extract(payload, '$.id') = ? AND creado_en >= ?`,
      )
      .get(TIPO_PROPUESTA_DECISIONES, id, desdeIso(ahoraMs)) as { n: number }
  ).n;
}

/** ¿Puede la plataforma pedir sola otra propuesta de decisiones para esta licitación hoy? */
export function quedanPropuestasHoy(
  dbNucleo: DbNucleo,
  id: string,
  ahoraMs = Date.now(),
  tope = nucleo().config.licitaciones.propuestasDia,
): boolean {
  return propuestasAutoHoy(dbNucleo, id, ahoraMs) < tope;
}

function idDe(payload: string): string | null {
  try {
    const id = (JSON.parse(payload) as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Limitador de la cola para licitaciones: un trabajo automático de una oferta que ya gastó sus
 * runs del día espera (MOTIVO_TOPE). Lo pedido a mano y lo que no es de una oferta (la criba) no.
 */
export function limitadorLicitaciones(t: Trabajo): string | null {
  const id = t.a_mano ? null : idDe(t.payload);
  if (id === null) return null;
  const { db, config } = nucleo();
  if (t.tipo === TIPO_LECCIONES && guardaPlazo(dbLicitaciones(), id, 'lecciones').error?.code === 'plazo_insuficiente')
    return MOTIVO_PLAZO_CERCANO;
  return runsDeOfertaHoy(db, id) >= config.licitaciones.runsOfertaDia ? MOTIVO_TOPE : null;
}
