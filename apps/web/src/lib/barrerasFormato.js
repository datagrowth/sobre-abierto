// Formato de «Qué nos falta» (sin React, con tests).
import { euros, plural } from './formato.js';

export const TIPOS_BARRERA = {
  certificacion: 'certificación',
  seguro: 'seguro',
  clasificacion: 'clasificación',
  habilitacion: 'habilitación',
  experiencia_personal: 'experiencia del personal',
};

// Qué se ve: por defecto, lo que nos deja fuera en varias licitaciones (las de una sola
// son muchas y tapan lo que de verdad abriría contratos).
export const FILTROS_BARRERAS = [
  { key: 'fuera2', label: 'Nos deja fuera en 2 o más' },
  { key: 'fuera1', label: 'Nos deja fuera' },
  { key: 'falta', label: 'Lo que nos falta' },
  { key: 'todo', label: 'Todo' },
];

export function filtrarBarreras(barreras, filtro) {
  if (filtro === 'fuera2') return barreras.filter((b) => b.nos_dejan_fuera >= 2);
  if (filtro === 'fuera1') return barreras.filter((b) => b.nos_dejan_fuera >= 1);
  if (filtro === 'falta') return barreras.filter(conFalta);
  return barreras;
}

const ORDEN_NIVELES = ['alta', 'media', 'básica', 'sin indicar'];

/** Categorías del ENS que piden → «alta en 7 · media en 12 · sin indicar en 3»; null si no aplica. */
export function textoNiveles(niveles) {
  const partes = ORDEN_NIVELES.filter((n) => niveles?.[n]).map((n) => `${n} en ${niveles[n]}`);
  return partes.length ? partes.join(' · ') : null;
}

/** Lo que alguna vez no tenemos o está por confirmar. */
export function conFalta(b) {
  return b.no_cumplimos > 0 || b.por_confirmar > 0;
}

/** «Lo piden 5 · no lo tenemos en 3 (650.000 € en juego) · 1 por confirmar» */
export function textoBarrera(b) {
  const partes = [
    `Lo ${b.licitaciones === 1 ? 'pide' : 'piden'} ${plural(b.licitaciones, 'licitación', 'licitaciones')}`,
  ];
  if (b.no_cumplimos)
    partes.push(
      `no lo tenemos en ${b.no_cumplimos}${b.importe_no_cumplimos ? ` (${euros(b.importe_no_cumplimos)} en juego)` : ''}`,
    );
  else partes.push('lo tenemos');
  if (b.por_confirmar) partes.push(`${b.por_confirmar} por confirmar`);
  return partes.join(' · ');
}

const capital = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');

/** «Monitorizacion de medios · 5 años · lo piden 2 licitaciones · nos dejó fuera en 1» (experiencia del personal). */
export function textoPersonal(p) {
  const partes = [capital(p.materia)];
  if (p.anios_exigidos) partes.push(plural(p.anios_exigidos, 'año', 'años'));
  partes.push(`lo ${p.licitaciones === 1 ? 'pide' : 'piden'} ${plural(p.licitaciones, 'licitación', 'licitaciones')}`);
  partes.push(p.nos_dejan_fuera ? `nos dejó fuera en ${p.nos_dejan_fuera}` : 'aún no nos dejó fuera');
  return partes.join(' · ');
}
