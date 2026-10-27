// El estado de la oportunidad (presentada, ganada o perdida) a partir de todas sus propuestas.
import type { Db } from '../store.js';

// No sale de la última propuesta que cambió: en una licitación por lotes cada lote se adjudica en su fecha, y un
// lote perdido resuelto antes no debe tapar otro ganado después.
type EstadoPorPropuestas = 'presentada' | 'ganada' | 'perdida';
const PERDIDAS = new Set(['perdida', 'excluida']);

/** Ganada si alguna lo está; perdida si todas están decididas y alguna perdida; si no, presentada. */
function estadoPorPropuestas(resultados: string[]): EstadoPorPropuestas | null {
  if (!resultados.length) return null;
  if (resultados.includes('ganada')) return 'ganada';
  const decididas = resultados.every((r) => r !== 'pendiente');
  return decididas && resultados.some((r) => PERDIDAS.has(r)) ? 'perdida' : 'presentada';
}

/**
 * Recalcula la oportunidad a partir de sus propuestas. Solo si está en presentada, ganada o
 * perdida (los estados que llevan las propuestas): si una persona la movió a otro, manda ella.
 */
export function sincronizarOportunidad(db: Db, licitacionId: string, ts: string): void {
  const filas = db.prepare('SELECT resultado FROM propuestas WHERE licitacion_id = ?').all(licitacionId) as {
    resultado: string;
  }[];
  const estado = estadoPorPropuestas(filas.map((f) => f.resultado));
  if (!estado) return;
  db.prepare(
    `UPDATE oportunidades SET estado = ?, actualizada_en = ?
    WHERE licitacion_id = ? AND estado IN ('presentada', 'ganada', 'perdida') AND estado <> ?`,
  ).run(estado, ts, licitacionId, estado);
}
