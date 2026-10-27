// Hitos hacia atrás desde el plazo: cuatro fechas contadas desde la hora interna de cierre. Puro: sin E/S.
import { horaLocalEspana, instanteDeHoraEspana } from '../../../nucleo/fechas.js';
import {
  claveBloqueo,
  huellaDe,
  MINUTOS_POR_ACCION,
  type Bloqueo,
  type Fase,
  type NombreFase,
} from './comprobacionesTipos.js';

const DIA_MS = 86_400_000;

/**
 * El instante de `dias` días de calendario antes de `fin`, a la misma hora peninsular: D-7 de un
 * cierre a las 12:00 es a las 12:00 aunque entre medias cambie la hora (restar 7 × 24 h daría 13:00).
 */
export function diasAntes(fin: number, dias: number): number {
  const local = horaLocalEspana(fin);
  const dia = new Date(Date.parse(`${local.slice(0, 10)}T00:00:00Z`) - dias * DIA_MS).toISOString().slice(0, 10);
  return instanteDeHoraEspana(`${dia}${local.slice(10)}`) ?? fin - dias * DIA_MS;
}

// Se cuentan desde la hora interna de cierre de las comprobaciones (el plazo menos el margen de firma). No se
// guardan: si la PLACSP rectifica el plazo, se mueven solos. Un hito está hecho cuando su fase de las
// comprobaciones lo está; uno pasado sin hacer es un riesgo de las comprobaciones, que la persona puede aceptar
// con motivo, y su fecha ordena la Mesa y va al calendario de quien lleva la oferta.
const HITOS = [
  { clave: 'decidir', titulo: 'Decidir si vamos', dias: 10, fase: 'decidir' },
  { clave: 'decisiones', titulo: 'Decisiones y precio', dias: 7, fase: 'decisiones' },
  { clave: 'memoria', titulo: 'Memoria dada por buena', dias: 3, fase: 'memoria' },
  { clave: 'paquete', titulo: 'Paquete y firma', dias: 1, fase: 'paquete' },
] as const satisfies readonly { clave: string; titulo: string; dias: number; fase: NombreFase }[];

type ClaveHito = (typeof HITOS)[number]['clave'];
type EstadoHito = 'hecho' | 'pendiente' | 'vencido';
/** fecha: ISO en UTC, como la hora interna de cierre. */
export type Hito = { clave: ClaveHito; titulo: string; dias: number; fecha: string; estado: EstadoHito };

const HECHA: ReadonlySet<Fase['estado']> = new Set(['hecho', 'no_aplica']);

/** Los cuatro hitos de una oferta; ninguno sin hora interna de cierre. */
export function hitosDe(
  cierre: string | null,
  fases: readonly Pick<Fase, 'nombre' | 'estado'>[],
  ahoraMs: number,
): Hito[] {
  const fin = cierre ? Date.parse(cierre) : NaN;
  if (Number.isNaN(fin)) return [];
  const estadoFase = new Map(fases.map((f) => [f.nombre, f.estado]));
  return HITOS.map((h) => {
    const t = diasAntes(fin, h.dias);
    const hecha = HECHA.has(estadoFase.get(h.fase) ?? 'pendiente');
    const estado: EstadoHito = hecha ? 'hecho' : t <= ahoraMs ? 'vencido' : 'pendiente';
    return { clave: h.clave, titulo: h.titulo, dias: h.dias, fecha: new Date(t).toISOString(), estado };
  });
}

/** El primero sin hacer (vencido o pendiente), o null si están todos. */
export const proximoHito = (hitos: readonly Hito[]): Hito | null => hitos.find((h) => h.estado !== 'hecho') ?? null;

const fechaCorta = (iso: string): string => {
  const l = horaLocalEspana(Date.parse(iso));
  return `${l.slice(8, 10)}/${l.slice(5, 7)} a las ${l.slice(11, 16)}`;
};

const anteriores = (n: number): string =>
  n === 1 ? ' (y otro anterior sin hacer)' : n > 1 ? ` (y ${n} anteriores sin hacer)` : '';

/**
 * Una sola fila de riesgo con el último hito vencido: una oferta que entra tarde no se llena de
 * filas, y los anteriores se cuentan en el título. La huella lleva el hito y su fecha: si vence el
 * siguiente o el plazo se rectifica, lo que se aceptó deja de valer y la fila se vuelve a mirar.
 */
export function bloqueosDeHitos(hitos: readonly Hito[]): Bloqueo[] {
  const vencidos = hitos.filter((h) => h.estado === 'vencido');
  const h = vencidos.at(-1);
  if (!h) return [];
  return [
    {
      clave: claveBloqueo('hito_vencido', null),
      categoria: 'plazo',
      lote: null,
      gravedad: 'riesgo',
      titulo: `Vencido el hito «${h.titulo}»: tocaba el ${fechaCorta(h.fecha)} hora peninsular, ${h.dias === 1 ? 'un día' : `${h.dias} días`} antes del cierre interno${anteriores(vencidos.length - 1)}`,
      cita: null,
      actor: 'tu',
      accion: { tipo: 'aceptar_riesgo' },
      propuesta: null,
      minutos: MINUTOS_POR_ACCION.aceptar_riesgo,
      estado: 'abierto',
      huella: huellaDe('hito', h.clave, h.fecha),
    },
  ];
}
