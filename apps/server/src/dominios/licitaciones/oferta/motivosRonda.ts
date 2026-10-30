// Motivos del crítico que se repiten de una ronda a otra. Puro.
import { textoComparable } from '../temas.js';

export type Motivo = { cita: string; motivo: string; arreglo: string };
export type MotivoMarcado = Motivo & { repetido: boolean };
export type FaltaMarcada = { texto: string; repetido: boolean };

// Si dos rondas reescriben los mismos apartados con los mismos motivos y el mismo arreglo, la nota no se mueve:
// el reescritor no sabía que lo que hizo la vez anterior no bastó. Un motivo que el crítico vuelve a señalar
// sobre un texto ya reescrito se marca «no resuelto» para que cambie el enfoque.
const comparable = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
// Las palabras con contenido (4+ letras): «de», «la», «sin» no dicen de qué va el motivo.
const palabras = (t: string) =>
  new Set(
    comparable(t)
      .split(' ')
      .filter((w) => w.length >= 4),
  );
// Con 3 palabras en común de 5 ya es el mismo reproche dicho de otra forma.
const SOLAPE = 0.6;

function parecidos(a: string, b: string): boolean {
  const x = palabras(a);
  const y = palabras(b);
  if (x.size < 3 || y.size < 3) return comparable(a) === comparable(b) && comparable(a).length > 0;
  return [...x].filter((w) => y.has(w)).length / Math.min(x.size, y.size) >= SOLAPE;
}

/** ¿Es el mismo motivo? La misma cita (de al menos 10 caracteres) o casi el mismo reproche. */
function mismoMotivo(a: Motivo, b: Motivo): boolean {
  const ca = comparable(a.cita);
  return (ca.length >= 10 && ca === comparable(b.cita)) || parecidos(a.motivo, b.motivo);
}

/** Los motivos de ahora, marcados si ya estaban en la crítica anterior del mismo apartado. */
export function marcarMotivos(ahora: Motivo[], antes: Motivo[]): MotivoMarcado[] {
  return ahora.map((m) => ({ ...m, repetido: antes.some((x) => mismoMotivo(m, x)) }));
}

/** Lo que falta ahora, marcado si ya faltaba en la crítica anterior. */
export function marcarFaltas(ahora: string[], antes: string[]): FaltaMarcada[] {
  return ahora.map((texto) => ({ texto, repetido: antes.some((x) => parecidos(texto, x)) }));
}

export const NO_RESUELTO =
  'NO RESUELTO (ya lo señaló la crítica anterior sobre el texto reescrito y el arreglo no bastó: cambia el enfoque, no repitas lo mismo con otras palabras)';
