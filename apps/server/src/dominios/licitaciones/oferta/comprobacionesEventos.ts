// Evento licitacion.comprobaciones: avisa de la versión nueva cuando cambia algo de una licitación.
import { escuchar, type Evento } from '../../../nucleo/eventos.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import { comprobacionesDe } from './comprobaciones.js';
import { avisarComprobaciones, TIPO_EVENTO_COMPROBACIONES } from './comprobacionesBloqueos.js';

// La web y la Mesa la vuelven a pedir. Espera 2 s por licitación porque un cambio suele llegar en ráfaga (guion,
// decisiones, documentos): una ráfaga, un aviso.
export const ESPERA_COMPROBACIONES_MS = 2_000;

const log = logger('licitaciones');

// El propio aviso de las comprobaciones no cuenta: si no, se avisaría a sí mismo sin parar.
const cambiaLaComprobaciones = (e: Evento): e is Evento & { recurso: string } =>
  e.dominio === 'licitaciones' &&
  e.recurso !== null &&
  e.tipo.startsWith('licitacion.') &&
  e.tipo !== TIPO_EVENTO_COMPROBACIONES;

function avisar(id: string): void {
  try {
    const c = comprobacionesDe(dbLicitaciones(), nucleo().db, id);
    if (c.data) avisarComprobaciones(id, c.data.version);
  } catch (err) {
    log.error('Comprobaciones sin recalcular tras un cambio', { id, error: errorMessage(err) });
  }
}

/** Escucha los cambios de las licitaciones y emite licitacion.comprobaciones. Devuelve cómo dejar de escuchar. */
export function registrarEventosComprobaciones(): () => void {
  const pendientes = new Map<string, ReturnType<typeof setTimeout>>();
  const dejar = escuchar('*', (e) => {
    if (!cambiaLaComprobaciones(e) || pendientes.has(e.recurso)) return;
    const id = e.recurso;
    const t = setTimeout(() => {
      pendientes.delete(id);
      avisar(id);
    }, ESPERA_COMPROBACIONES_MS);
    t.unref();
    pendientes.set(id, t);
  });
  return () => {
    dejar();
    for (const t of pendientes.values()) clearTimeout(t);
    pendientes.clear();
  };
}
