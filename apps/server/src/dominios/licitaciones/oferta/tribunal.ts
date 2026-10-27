// Simulación de tribunal: la nota que el crítico ciego da a la memoria con el reparto de puntos del pliego. Puro.
import type { CriticaGuardada } from './critica.js';
import { tramoInferior } from './critica.js';
import type { GuionBaseData } from './guion.js';
import { memoriaValorable } from './guionRevision.js';

// Lleva su margen: lo que perdería si la mesa pusiera cada apartado un tramo por debajo del que eligió el
// crítico (la nota no es un número exacto y el crítico puede desviarse de un juez ciego). Por debajo del 70 % de
// los puntos de juicio de valor es un riesgo.
export const UMBRAL_TRIBUNAL = 0.7;

// minimo: con cada apartado un tramo más abajo (sin escala, su nota: no hay tramo con que bajar).
export type NotaTribunal = { total: number; maximo: number; minimo: number; bajo_umbral: boolean };

const redondo = (n: number): number => Math.round(n * 100) / 100;

/** La nota del crítico con su margen; null si la memoria no se puntúa o la crítica no tiene máximo. */
export function notaTribunal(
  c: Pick<CriticaGuardada, 'datos' | 'total' | 'maximo'>,
  memoria: GuionBaseData['memoria'],
): NotaTribunal | null {
  if (!memoria || !memoriaValorable(memoria) || !c.maximo) return null;
  const minimo = c.datos.apartados.reduce((s, x) => {
    const ap = memoria.apartados[x.apartado - 1];
    return s + (ap?.escala.length ? Math.min(x.puntos, tramoInferior(ap, x.tramo)) : x.puntos);
  }, 0);
  return {
    total: c.total,
    maximo: c.maximo,
    minimo: redondo(minimo),
    bajo_umbral: c.total < UMBRAL_TRIBUNAL * c.maximo,
  };
}

const n = (x: number): string => String(redondo(x)).replace('.', ',');

/** «20 de 45 (entre 14 y 20 si la mesa baja un tramo en cada apartado)». */
export function textoNota(t: NotaTribunal): string {
  const margen =
    t.minimo < t.total ? ` (entre ${n(t.minimo)} y ${n(t.total)} si la mesa baja un tramo en cada apartado)` : '';
  return `${n(t.total)} de ${n(t.maximo)}${margen}`;
}
