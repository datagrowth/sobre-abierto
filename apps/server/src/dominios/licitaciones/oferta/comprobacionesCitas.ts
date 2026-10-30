// La cita de una fila de las comprobaciones que sale de un requisito de la ficha, con su página.
import type { FichaDatosData } from '../ficha.js';
import type { EntradasComprobaciones } from './comprobacionesEntradas.js';
import type { Cita } from './comprobacionesTipos.js';

type RequisitoFicha = FichaDatosData['requisitos'][number];

// Es la frase literal del pliego que trae el requisito, comprobada en el pliego (citasPliego.ts). Sin cita
// literal, null: la regla pone la suya (la descripción, sin comprobar).
export function citaLiteral(e: Pick<EntradasComprobaciones, 'citas_requisitos'>, r: RequisitoFicha): Cita | null {
  if (!r.cita) return null;
  const c = e.citas_requisitos?.get(r) ?? null;
  return {
    documento: c?.documento ?? r.documento ?? 'Ficha',
    pagina: c?.pagina ?? r.pagina ?? null,
    texto: r.cita,
    comprobada: c?.estado === 'comprobada',
  };
}
