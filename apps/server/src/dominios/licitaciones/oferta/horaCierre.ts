// Hora interna de cierre de la oferta: el plazo de la PLACSP menos el margen para revisar, firmar y subir.
import { instanteDeHoraEspana } from '../../../nucleo/fechas.js';
import type { Fase, NombreFase } from './comprobacionesTipos.js';
import { DURACION_MIN } from './plazo.js';

const HORA_MS = 3_600_000;
const MIN_MS = 60_000;

// El plazo es hora peninsular sin zona; el margen es LICITACIONES_MARGEN_FIRMA_HORAS y lo pasa quien llama
// (puro). En ISO con zona, para que la web la pinte en peninsular y en Canarias sin dudas.
/** null si no hay plazo o no se entiende. */
export function horaInternaCierre(plazo: string | null, margenHoras: number): string | null {
  const vence = plazo ? instanteDeHoraEspana(plazo) : null;
  return vence === null ? null : new Date(vence - margenHoras * HORA_MS).toISOString();
}

export type DuracionesFase = Record<NombreFase, number>;
/** Minutos por tipo de trabajo de la cola (medianasDuracion); null = pocas muestras. */
export type MedianasDuracion = Readonly<Record<string, number | null>>;

// El trabajo de la cola que mide cada fase entera. La memoria no tiene uno solo (encadena
// plan, redacción y crítica), así que sigue con lo presupuestado. Literales y no las
// constantes TIPO_* para no importar ficha.ts ni anexosTrabajo.ts desde aquí (el test comprueba que casan).
export const TIPO_DE_FASE: Readonly<Partial<Record<NombreFase, string>>> = {
  decidir: 'licitaciones.ficha',
  guion: 'licitaciones.guion',
  decisiones: 'licitaciones.decisiones',
  documentos: 'licitaciones.anexo',
};

/**
 * Lo que tarda Hermes en cada fase (minutos): la mediana real de su tipo de trabajo si hay
 * bastantes muestras y, si no, lo presupuestado en plazo.ts (la ficha decide, la propuesta de
 * decisiones, la memoria —encadena plan, redacción y crítica— y el relleno de anexos).
 * Bajar pliegos, montar el paquete y presentar no esperan a ningún run.
 */
export function duracionesFases(medianas: MedianasDuracion = {}): DuracionesFase {
  const presupuesto: DuracionesFase = {
    decidir: DURACION_MIN.ficha,
    pliegos: 0,
    guion: DURACION_MIN.guion,
    decisiones: DURACION_MIN.decisiones,
    memoria: DURACION_MIN.memoria,
    documentos: DURACION_MIN.anexo,
    paquete: 0,
    presentar: 0,
  };
  const reales = Object.entries(TIPO_DE_FASE).flatMap(([fase, tipo]) => {
    const m = tipo ? medianas[tipo] : null;
    return typeof m === 'number' ? [[fase, m] as const] : [];
  });
  return { ...presupuesto, ...Object.fromEntries(reales) };
}

/**
 * Lo que aún tiene que hacer Hermes en la cadena que falta: cada fase sin hacer lleva su run (la
 * propuesta de decisiones, la memoria, el relleno de anexos), aunque luego la cierre la persona.
 * Decidir no: en una oferta en preparación la ficha ya está y lo que queda de esa fase es de la persona.
 */
export function fasesPendientesDeHermes(fases: readonly Pick<Fase, 'nombre' | 'estado'>[]): NombreFase[] {
  return fases
    .filter((f) => f.nombre !== 'decidir' && f.estado !== 'hecho' && f.estado !== 'no_aplica')
    .map((f) => f.nombre);
}

/**
 * Hasta cuándo puede decidir la persona sin que Hermes llegue tarde: la hora interna de cierre
 * menos lo que le queda a Hermes en las fases pendientes. null sin hora de cierre.
 */
export function limiteParaDecidir(
  horaCierre: string | null,
  fasesPendientesDeHermes: readonly NombreFase[],
  duraciones: DuracionesFase = duracionesFases(),
): string | null {
  const cierre = horaCierre ? Date.parse(horaCierre) : NaN;
  if (Number.isNaN(cierre)) return null;
  const minutos = [...new Set(fasesPendientesDeHermes)].reduce((s, f) => s + duraciones[f], 0);
  return new Date(cierre - minutos * MIN_MS).toISOString();
}
