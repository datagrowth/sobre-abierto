// Rondas de un trabajo automático de la oferta (guion, propuesta de decisiones) que falla del todo.
import type { Db as DbNucleo } from '../../../nucleo/db.js';

// La clave de cada trabajo es única para no pedirlo dos veces, así que si falla del todo (sus tres intentos)
// nunca se repetiría y la licitación quedaría parada sin que nadie lo sepa (p. ej. un guion sin propuesta de
// decisiones). Pasado un rato se pide otra vez con clave de ronda («<base>-r1», «-r2»), como mucho tres rondas:
// uno que falla siempre no gasta el modelo sin fin.
export const RONDAS = 3;
export const REINTENTO_RONDA_MS = 30 * 60_000;

/** La clave de la ronda `n`: la base en la primera y «<base>-r<n>» en las siguientes. */
export const claveDeRonda = (base: string, n: number): string => (n === 0 ? base : `${base}-r${n}`);

/**
 * La ronda que toca pedir: 0 si nunca se pidió; la siguiente si la última falló hace más de
 * REINTENTO_RONDA_MS y quedan rondas; null si está en curso, salió bien, alguien la canceló,
 * falló hace poco o ya se gastaron las tres. Busca por rango de clave (índice único).
 */
function rondasDe(dbNucleo: DbNucleo, base: string): { estado: string; actualizado_en: string }[] {
  return dbNucleo
    .prepare(
      `SELECT estado, actualizado_en FROM trabajos_ia
    WHERE clave = @base OR (clave >= @desde AND clave < @hasta) ORDER BY id DESC`,
    )
    .all({ base, desde: `${base}-r`, hasta: `${base}-s` }) as { estado: string; actualizado_en: string }[];
}

export function rondaQueToca(dbNucleo: DbNucleo, base: string, ahoraMs = Date.now()): number | null {
  const filas = rondasDe(dbNucleo, base);
  const ultima = filas[0];
  if (!ultima) return 0;
  if (ultima.estado !== 'fallido' || filas.length >= RONDAS) return null;
  return Date.parse(ultima.actualizado_en) <= ahoraMs - REINTENTO_RONDA_MS ? filas.length : null;
}

/**
 * ¿Queda alguna ronda por pedir? true si nunca se pidió o si la última falló y no se han gastado
 * las tres (aunque aún no toque el reintento). Lo que espera a este trabajo deja de esperarlo si
 * salió bien, si alguien lo canceló o si ya no se va a pedir más (lo que está en curso se mira aparte).
 */
export function quedanRondas(dbNucleo: DbNucleo, base: string): boolean {
  const filas = rondasDe(dbNucleo, base);
  return !filas.length || (filas[0]!.estado === 'fallido' && filas.length < RONDAS);
}
