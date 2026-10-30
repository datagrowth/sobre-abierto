// Las fases de la memoria y la clave del trabajo de cada una (sin dependencias: las usan la
// máquina de estados y el estado para la web).
import type { FilaMemoria } from './ensamblado.js';

// ficha: la ficha de solución espera a que una persona la revise (fichaSolucion.ts); sin trabajo de IA.
// hechos: entre la crítica y la reescritura, corrige los hechos que cita el crítico (parcheHechos.ts).
export type FaseMemoria = 'dossier' | 'estrategia' | 'ficha' | 'redaccion' | 'critica' | 'hechos' | 'fin';
export const FASES_MEMORIA: readonly FaseMemoria[] = [
  'dossier',
  'estrategia',
  'ficha',
  'redaccion',
  'critica',
  'hechos',
  'fin',
];
export type FaseConTrabajo = 'estrategia' | 'redaccion' | 'critica' | 'hechos';
export const FASES_CON_TRABAJO: readonly FaseMemoria[] = ['estrategia', 'redaccion', 'critica', 'hechos'];

/** La clave base del trabajo de una fase (sus reintentos llevan «-r1», «-r2»: rondas.ts). */
export function claveDeFase(m: Pick<FilaMemoria, 'licitacion_id' | 'version' | 'ronda'>, fase: FaseConTrabajo): string {
  const base = `memoria-${m.licitacion_id}-v${m.version}`;
  if (fase === 'estrategia') return `${base}-estrategia`;
  if (fase === 'hechos') return `${base}-hechos-r${m.ronda}`;
  return fase === 'redaccion' ? `${base}-r${m.ronda}` : `${base}-critica-r${m.ronda}`;
}

/** La fase guardada de una memoria (la del dossier si no tiene ninguna válida). */
export const faseDe = (m: Pick<FilaMemoria, 'fase'>): FaseMemoria =>
  (FASES_MEMORIA as readonly string[]).includes(m.fase ?? '') ? (m.fase as FaseMemoria) : 'dossier';
