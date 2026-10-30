// Paquete de presentación regenerado por código cuando cambia una huella, con 0 runs.
import { logger } from '../../../nucleo/log.js';
import type { AppError } from '../../../nucleo/result.js';
import { comprobacionesDe } from './comprobaciones.js';
import type { Bloqueo } from './comprobacionesTipos.js';
import { ESTADOS_QUE_SUELTAN, frenoDeElegibilidad } from './frenoElegibilidad.js';
import { generarPaquete, paqueteVigente, type ContextoPaquete } from './paquete.js';
import { licitacionesEnPreparacion } from './plazo.js';

const log = logger('licitaciones');
// Cuando cambia una huella (el precio, las decisiones, un anexo) el paquete ya generado queda desfasado y se
// rehace solo. Nunca crea el primero (es una decisión de una persona), no se mete con una oferta frenada ni con
// una que tiene un «impide» abierto por otra causa, y deja pasar 10 minutos entre versiones: cada una es una
// carpeta nueva en Salidas y su copia en Drive. Un intento fallido también espera esos 10 minutos: sin guardar
// versión, la pausa no correría y cada vuelta volvería a crear y borrar la carpeta en Salidas mientras siga la
// causa (disco lleno, un dato que falta).
const ENTRE_VERSIONES_MS = 10 * 60_000;

// El último intento fallido por licitación, en memoria del proceso (como frenosAnotados en cadena.ts).
const fallos = new Map<string, { ms: number; codigo: string }>();

// Los «impide» de la categoría «firma» son del propio paquete (lo que se arregla regenerándolo).
const impideAjeno = (b: Bloqueo): boolean =>
  b.gravedad === 'impide' && b.categoria !== 'firma' && !ESTADOS_QUE_SUELTAN.has(b.estado);

function sinImpidesAbiertos(c: ContextoPaquete, id: string, ahoraMs: number): boolean {
  const comprobaciones = comprobacionesDe(c.db, c.dbNucleo, id, ahoraMs);
  return !comprobaciones.error && !comprobaciones.data.bloqueos.some(impideAjeno);
}

// Un fallo con hora posterior a la de ahora (el reloj volvió atrás) no deja la oferta parada.
const reciente = (desdeMs: number, ahoraMs: number): boolean =>
  ahoraMs >= desdeMs && ahoraMs - desdeMs < ENTRE_VERSIONES_MS;

function leToca(c: ContextoPaquete, id: string, ahoraMs: number): boolean {
  const vigente = paqueteVigente(c.db, id);
  if (!vigente?.desfasado || ahoraMs - Date.parse(vigente.creado_en) < ENTRE_VERSIONES_MS) return false;
  const fallo = fallos.get(id);
  if (fallo && reciente(fallo.ms, ahoraMs)) return false;
  return !frenoDeElegibilidad(c.db, c.dbNucleo, id, ahoraMs).frenada && sinImpidesAbiertos(c, id, ahoraMs);
}

// El aviso sale una vez por licitación y motivo; si se repite, en debug.
function anotarFallo(id: string, error: AppError, ahoraMs: number): void {
  const codigo = error.code;
  const repetido = fallos.get(id)?.codigo === codigo;
  fallos.set(id, { ms: ahoraMs, codigo });
  const datos = { licitacion: id, codigo, error: error.message };
  if (repetido) log.debug('paquete sin regenerar por código (sigue fallando)', datos);
  else log.warn('paquete sin regenerar por código', datos);
}

/** En cada vuelta: rehace el paquete desfasado de las ofertas en preparación a las que les toca. Devuelve cuántos. */
export async function regenerarPaquetesAuto(c: ContextoPaquete, ahoraMs = Date.now()): Promise<number> {
  let n = 0;
  for (const l of licitacionesEnPreparacion(c.db, ahoraMs)) {
    if (!leToca(c, l.id, ahoraMs)) continue;
    const r = await generarPaquete(c, l.id, ahoraMs);
    if (r.error) {
      anotarFallo(l.id, r.error, ahoraMs);
      continue;
    }
    fallos.delete(l.id);
    log.info('paquete regenerado por código', { licitacion: l.id, version: r.data.version, bloqueos: r.data.bloqueos });
    n += 1;
  }
  return n;
}
