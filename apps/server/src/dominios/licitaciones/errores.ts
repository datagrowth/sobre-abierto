// Errores de procesamiento: oportunidades nuevas que el proceso automático ya no va a sacar adelante solas.
import type { Db as DbNucleo } from '../../nucleo/db.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import { emitir } from '../../nucleo/eventos.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import type { Db } from './store.js';
import { pedirFicha, RONDAS_FICHA, SQL_RONDAS_FICHA, TIPO_FICHA } from './ficha.js';
import { legibilidadDePliegos, listoParaFicha, motivoIlegible, type Legibilidad } from './pliegosIndice.js';

// Son pliegos que no se pudieron bajar, pliegos que la Biblioteca no puede leer o una ficha que Hermes no logró
// hacer en sus rondas. Sin marca se quedaban para siempre en «Nuevas» como si estuvieran esperando; con ella
// salen en la pestaña «Errores» con su motivo. La marca se recalcula en cada vuelta a partir del estado real,
// así que nunca se queda vieja.
export const ERRORES_PROCESO = ['pliegos_error', 'pliegos_ilegibles', 'ficha_fallida'] as const;
export type ErrorProceso = (typeof ERRORES_PROCESO)[number];
type Marca = { id: string; codigo: ErrorProceso; detalle: string | null };

const MAX_DETALLE = 300;
const recortar = (t: string | null): string | null => (t ? t.slice(0, MAX_DETALLE) : null);

// Un trabajo de ficha esperando turno o corriendo (manual «ficha-<id>-…» o automático
// «ficha-auto-<id>…»), por rango del índice único de clave.
const FICHA_VIVA = `EXISTS (SELECT 1 FROM nucleo.trabajos_ia t WHERE t.tipo = @tipo AND t.estado IN ('pendiente', 'lanzado')
  AND ((t.clave >= 'ficha-' || o.licitacion_id || '-' AND t.clave < 'ficha-' || o.licitacion_id || '.')
    OR (t.clave >= 'ficha-auto-' || o.licitacion_id AND t.clave < 'ficha-auto-' || o.licitacion_id || '.')))`;

const ULTIMO_FALLO_FICHA = `(SELECT t.error FROM nucleo.trabajos_ia t WHERE t.tipo = @tipo AND t.estado = 'fallido'
  AND t.clave >= 'ficha-auto-' || o.licitacion_id AND t.clave < 'ficha-auto-' || o.licitacion_id || '.' ORDER BY t.actualizado_en DESC LIMIT 1)`;

const ALGUNO = (condicion: string): string =>
  `EXISTS (SELECT 1 FROM pliegos p WHERE p.licitacion_id = o.licitacion_id AND ${condicion})`;
const PRIMER_ERROR_PLIEGO =
  "(SELECT p.error FROM pliegos p WHERE p.licitacion_id = o.licitacion_id AND p.estado = 'error' ORDER BY p.rowid LIMIT 1)";

type Fila = {
  id: string;
  rondas: number;
  viva: number;
  pliegos_error: number;
  pliegos_listos: number;
  error_pliego: string | null;
  error_ficha: string | null;
};

// Nuevas en plazo sin ficha aprobada: las únicas que el proceso automático debería estar moviendo.
// pliegos_error: ninguno se bajó ni queda por bajar; pliegos_listos: lo que la ficha automática espera.
function enProceso(dbLic: Db, ahoraMs: number): Fila[] {
  return dbLic
    .prepare(
      `SELECT o.licitacion_id AS id, ${SQL_RONDAS_FICHA} AS rondas, ${FICHA_VIVA} AS viva,
      (${ALGUNO("p.estado = 'error'")} AND NOT ${ALGUNO("p.estado IN ('pendiente', 'descargado', 'descomprimido')")}) AS pliegos_error,
      (${ALGUNO("p.estado = 'descargado' AND p.tipo IS NOT 'deuc'")} AND NOT ${ALGUNO("p.clase IN ('pcap', 'ppt') AND p.estado = 'pendiente'")}) AS pliegos_listos,
      ${PRIMER_ERROR_PLIEGO} AS error_pliego, ${ULTIMO_FALLO_FICHA} AS error_ficha
    FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'nueva' AND (l.fecha_limite IS NULL OR l.fecha_limite > @hoy)
      AND NOT EXISTS (SELECT 1 FROM fichas f WHERE f.licitacion_id = o.licitacion_id AND f.estado = 'aprobada')`,
    )
    .all({ tipo: TIPO_FICHA, hoy: horaLocalEspana(ahoraMs) }) as Fila[];
}

export type LeerLegibilidad = (id: string) => Legibilidad[] | null;

function marcaDe(f: Fila, legibilidad: LeerLegibilidad): Marca | null {
  if (f.viva) return null;
  if (f.pliegos_error) return { id: f.id, codigo: 'pliegos_error', detalle: recortar(f.error_pliego) };
  if (f.rondas >= RONDAS_FICHA) return { id: f.id, codigo: 'ficha_fallida', detalle: recortar(f.error_ficha) };
  if (!f.pliegos_listos) return null;
  const leg = legibilidad(f.id);
  return leg && listoParaFicha(leg) === 'ilegible'
    ? { id: f.id, codigo: 'pliegos_ilegibles', detalle: recortar(motivoIlegible(leg)) }
    : null;
}

/**
 * Pone la marca de error a lo que está atascado y se la quita a lo que ya no lo está (y a lo que
 * dejó de ser una nueva en plazo). Devuelve cuántas marcas cambiaron.
 */
export function revisarErrores(
  dbLic: Db,
  ahoraMs = Date.now(),
  legibilidad: LeerLegibilidad = (id) => legibilidadDePliegos(dbLic, id),
): number {
  const marcas = enProceso(dbLic, ahoraMs)
    .map((f) => marcaDe(f, legibilidad))
    .filter((m): m is Marca => m !== null);
  const marcadas = new Set(marcas.map((m) => m.id));
  const conMarca = dbLic
    .prepare('SELECT licitacion_id AS id FROM oportunidades WHERE error_proceso IS NOT NULL')
    .all() as { id: string }[];
  const poner = dbLic.prepare(`UPDATE oportunidades SET error_proceso = @codigo, error_detalle = @detalle
    WHERE licitacion_id = @id AND (error_proceso IS NOT @codigo OR error_detalle IS NOT @detalle)`);
  const quitar = dbLic.prepare(
    'UPDATE oportunidades SET error_proceso = NULL, error_detalle = NULL WHERE licitacion_id = ?',
  );
  let cambios = 0;
  dbLic.transaction(() => {
    for (const m of marcas) cambios += poner.run(m).changes;
    for (const { id } of conMarca) if (!marcadas.has(id)) cambios += quitar.run(id).changes;
  })();
  if (cambios)
    emitir(dbLic, { tipo: 'licitacion.errores', dominio: 'licitaciones', recurso: null, datos: { cambios } });
  return cambios;
}

/**
 * «Reintentar» de la pestaña Errores: los pliegos con error vuelven a la cola de descarga y la
 * ficha fallida se pide otra vez (una ronda manual). Unos pliegos ilegibles no se leen mejor por
 * pedirlos otra vez: hace falta subir uno legible o descartar.
 */
export function reintentarProceso(dbNucleo: DbNucleo, dbLic: Db, id: string): Result<{ reintentado: ErrorProceso }> {
  const o = dbLic.prepare('SELECT error_proceso FROM oportunidades WHERE licitacion_id = ?').get(id) as
    { error_proceso: ErrorProceso | null } | undefined;
  if (!o) return fail('not_found', 'Esa licitación no es una oportunidad.');
  if (!o.error_proceso) return fail('invalid_input', 'Esta oportunidad no tiene ningún error de procesamiento.');
  if (o.error_proceso === 'pliegos_ilegibles')
    return fail(
      'invalid_input',
      'La Biblioteca no puede leer estos pliegos: sube uno legible desde «Pliegos» o descártala.',
    );
  if (o.error_proceso === 'ficha_fallida') {
    const r = pedirFicha(dbNucleo, dbLic, id);
    if (r.error) return fail(r.error.code, r.error.message);
  } else {
    dbLic
      .prepare(
        `UPDATE pliegos SET estado = 'pendiente', intentos = 0, error = NULL, proximo_intento_en = NULL, actualizado_en = ?
      WHERE licitacion_id = ? AND estado = 'error'`,
      )
      .run(new Date().toISOString(), id);
  }
  dbLic.prepare('UPDATE oportunidades SET error_proceso = NULL, error_detalle = NULL WHERE licitacion_id = ?').run(id);
  emitir(dbLic, {
    tipo: 'licitacion.reintento',
    dominio: 'licitaciones',
    recurso: id,
    datos: { error: o.error_proceso },
  });
  return ok({ reintentado: o.error_proceso });
}
