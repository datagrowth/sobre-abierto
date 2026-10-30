// Disponibilidad calculada de cada persona, a partir de sus ofertas y de los contratos en ejecución.
import { errorMessage } from '../result.js';
import { logger } from '../log.js';

// No sale de lo que alguien declaró a mano. Los dominios aportan sus asignaciones (Licitaciones: el equipo de las
// decisiones de cada oferta) y aquí se resumen.
export const DISPONIBILIDADES = ['disponible', 'parcial', 'no_disponible'] as const;
export type EstadoDisponibilidad = (typeof DISPONIBILIDADES)[number];

// en_curso: oferta en preparación o presentada sin resolver (si adjudican a la empresa, trabaja en ella).
// en_ejecucion: contrato ganado que aún no ha terminado. ganada y perdida: ya resueltas.
export type EstadoAsignacion = 'en_preparacion' | 'presentada' | 'en_ejecucion' | 'ganada' | 'perdida';
export type Asignacion = {
  persona_id: number;
  dominio: string;
  recurso: string;
  expediente: string;
  titulo: string;
  rol: string;
  estado: EstadoAsignacion;
  hasta: string | null;
};
export type Disponibilidad = { estado: EstadoDisponibilidad; motivo: string; hasta: string | null };

type Fuente = () => Asignacion[];
const fuentes = new Map<string, Fuente>();
const log = logger('colaboradores');

export function registrarAsignaciones(dominio: string, fn: Fuente): void {
  fuentes.set(dominio, fn);
}

/** Todas las asignaciones de los dominios; un dominio que falla no deja sin las demás. */
export function asignaciones(): Asignacion[] {
  return [...fuentes].flatMap(([dominio, fn]) => {
    try {
      return fn();
    } catch (err) {
      log.warn('asignaciones sin leer', { dominio, error: errorMessage(err).slice(0, 200) });
      return [];
    }
  });
}

// Con dos ofertas abiertas a la vez ya no se puede contar con ella entera para una tercera.
const OFERTAS_PARA_PARCIAL = 2;

const enCurso = (a: Asignacion) => a.estado === 'en_preparacion' || a.estado === 'presentada';
const ultima = (fechas: (string | null)[]) =>
  fechas.some((f) => f === null)
    ? null
    : (fechas
        .filter((f): f is string => f !== null)
        .sort()
        .at(-1) ?? null);

function textoOfertas(n: number): string {
  return n === 1 ? '1 oferta en curso' : `${n} ofertas en curso`;
}

/** Disponibilidad de una persona a partir de sus asignaciones: en ejecución, no; con varias ofertas abiertas, parcial. */
export function disponibilidadDe(suyas: Asignacion[]): Disponibilidad {
  const ejecucion = suyas.filter((a) => a.estado === 'en_ejecucion');
  const abiertas = suyas.filter(enCurso).length;
  if (ejecucion.length) {
    return {
      estado: 'no_disponible',
      motivo: `En ejecución: ${ejecucion.map((a) => a.titulo).join(', ')}`,
      hasta: ultima(ejecucion.map((a) => a.hasta)),
    };
  }
  if (abiertas >= OFERTAS_PARA_PARCIAL) return { estado: 'parcial', motivo: textoOfertas(abiertas), hasta: null };
  return { estado: 'disponible', motivo: abiertas ? textoOfertas(abiertas) : '', hasta: null };
}

/** La disponibilidad de cada persona con asignaciones; quien no sale en ninguna está disponible. */
export function disponibilidades(todas: Asignacion[] = asignaciones()): Map<number, Disponibilidad> {
  const porPersona = new Map<number, Asignacion[]>();
  for (const a of todas) porPersona.set(a.persona_id, [...(porPersona.get(a.persona_id) ?? []), a]);
  return new Map([...porPersona].map(([id, suyas]) => [id, disponibilidadDe(suyas)]));
}

export const DISPONIBLE: Disponibilidad = { estado: 'disponible', motivo: '', hasta: null };
