// Freno de elegibilidad: sin resolver un «impide» de elegibilidad, la cadena no gasta cuota en esa oferta.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage } from '../../../nucleo/result.js';
import type { Db } from '../store.js';
import { comprobacionesDe } from './comprobaciones.js';
import type { Bloqueo } from './comprobacionesTipos.js';

const log = logger('licitaciones');

export type Freno = { frenada: boolean; bloqueos: { clave: string; titulo: string }[] };

// Mientras las comprobaciones tengan un «impide» de elegibilidad que nadie ha resuelto ni ha dado por bueno
// («Vamos» o el riesgo aceptado), la cadena no gasta cuota en la memoria ni en los anexos de esa oferta: sin
// ENS, por ejemplo, serían horas de Hermes en una oferta que no se podía firmar. Lee las comprobaciones y no
// escribe nada. Un «Vamos» vale mientras la huella de su fila no cambie (comprobaciones.ts lo vuelve a abrir si
// cambia), así que otra rectificación u otro guion frenan de nuevo.
// «No comprobado» también frena: sin saber si la empresa cumple, gastar cuota es apostar (nunca «ok» lo que no se comprobó).
const GRAVEDADES_QUE_FRENAN: ReadonlySet<Bloqueo['gravedad']> = new Set(['impide', 'no_comprobado']);
// Lo que una persona ya dio por bueno. «Riesgo aceptado» solo llega a un «no_comprobado» (las comprobaciones
// no deja aceptar como riesgo un «impide»): quien lo aceptó con motivo no tiene por qué saber que
// además hace falta un «Vamos». El paquete por código (paqueteAuto.ts) suelta con lo mismo.
export const ESTADOS_QUE_SUELTAN: ReadonlySet<Bloqueo['estado']> = new Set(['vamos', 'resuelto', 'riesgo_aceptado']);

const frena = (b: Bloqueo): boolean =>
  b.categoria === 'elegibilidad' && GRAVEDADES_QUE_FRENAN.has(b.gravedad) && !ESTADOS_QUE_SUELTAN.has(b.estado);

/** ¿Está frenada la oferta por elegibilidad, y por qué filas? Sin poder calcular las comprobaciones (no existe la licitación) frena: no se comprobó nada. */
export function frenoDeElegibilidad(dbLic: Db, dbNucleo: DbNucleo, id: string, ahoraMs: number = Date.now()): Freno {
  const c = comprobacionesDe(dbLic, dbNucleo, id, ahoraMs);
  if (c.error) return { frenada: true, bloqueos: [] };
  const bloqueos = c.data.bloqueos.filter(frena).map(({ clave, titulo }) => ({ clave, titulo }));
  return { frenada: bloqueos.length > 0, bloqueos };
}

/**
 * El freno para lo que la plataforma hace sola, una oferta tras otra: si las comprobaciones lanzan (JSON
 * corrupto, SQLITE_BUSY) la oferta queda frenada, como si no hubiera comprobaciones, y las demás siguen.
 */
export function frenoSeguro(dbLic: Db, dbNucleo: DbNucleo, id: string, ahoraMs: number = Date.now()): Freno {
  try {
    return frenoDeElegibilidad(dbLic, dbNucleo, id, ahoraMs);
  } catch (err) {
    log.error('freno de elegibilidad sin leer: la oferta queda frenada', { licitacion: id, error: errorMessage(err) });
    return { frenada: true, bloqueos: [] };
  }
}
