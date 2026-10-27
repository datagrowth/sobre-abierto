// Escenarios de oferta: para cada baja candidata, el importe, las adjudicaciones ganadas y si sería anormalmente baja.
import { media, type Percentiles } from '../../../nucleo/estadistica.js';
import { proporcionHasta } from './estadistica.js';

// Se cuentan las adjudicaciones parecidas ganadas con una baja igual o menor. La anormalidad se mide con el
// umbral que fija el pliego si el guion lo trae y, si no, con la regla supletoria del art. 85 del RGLCAP
// (orientativa: manda el pliego, LCSP art. 149).
const redondear = (n: number, decimales = 4) => Math.round(n * 10 ** decimales) / 10 ** decimales;

// «Más de N puntos por debajo»: estrictamente, sin que el redondeo de coma flotante
// convierta un empate exacto (p. ej. 72 frente a 90 × 0,8) en anormal.
function porDebajo(precio: number, referencia: number, factor: number): boolean {
  const limite = referencia * factor;
  return precio < limite - 1e-9 * Math.max(1, Math.abs(limite));
}

function anormalUnica(precio: number, presupuesto: number): boolean {
  return porDebajo(precio, presupuesto, 0.75);
}

// Con 3 ofertas no cuenta para la media la más alta si supera la media en más de 10 puntos.
function mediaDeTres(precios: number[]): number {
  const m = media(precios) ?? 0;
  const max = Math.max(...precios);
  return max > m * 1.1 ? (media(precios.filter((_, i) => i !== precios.indexOf(max))) ?? m) : m;
}

// Con 4 o más, si alguna supera la media en más de 10 puntos, nueva media sin ellas
// (y si quedan menos de tres, con las tres más baratas).
function mediaDeCuatroOMas(precios: number[]): number {
  const m = media(precios) ?? 0;
  const restantes = precios.filter((p) => p <= m * 1.1);
  if (restantes.length === precios.length) return m;
  const base = restantes.length >= 3 ? restantes : [...precios].sort((a, b) => a - b).slice(0, 3);
  return media(base) ?? m;
}

/**
 * Art. 85 RGLCAP: ¿la oferta `indice` es anormalmente baja entre `precios`?
 * 1 oferta: baja de más de 25 puntos sobre el presupuesto. 2: más de 20 puntos por
 * debajo de la otra. 3: más de 10 puntos por debajo de la media (o baja de más de 25).
 * 4 o más: más de 10 puntos por debajo de la media corregida.
 */
export function esAnormal(precios: number[], indice: number, presupuesto: number): boolean {
  const precio = precios[indice];
  if (precio === undefined) return false;
  if (precios.length === 1) return anormalUnica(precio, presupuesto);
  if (precios.length === 2) return porDebajo(precio, precios[1 - indice] ?? precio, 0.8);
  if (precios.length === 3) return porDebajo(precio, mediaDeTres(precios), 0.9) || anormalUnica(precio, presupuesto);
  return porDebajo(precio, mediaDeCuatroOMas(precios), 0.9);
}

// Supuesto: el resto de licitadores oferta la baja mediana del segmento.
function anormalCon(baja: number, ofertas: number, bajaResto: number, presupuesto: number): boolean {
  const resto = Array.from({ length: Math.max(0, ofertas - 1) }, () => presupuesto * (1 - bajaResto));
  return esAnormal([presupuesto * (1 - baja), ...resto], 0, presupuesto);
}

/** Menor baja (en pasos de 0,1 puntos) a partir de la cual la oferta sería anormal, o null. */
export function umbralAnormal(ofertas: number, bajaResto: number): number | null {
  for (let milesimas = 0; milesimas <= 950; milesimas += 1) {
    const baja = milesimas / 1000;
    if (anormalCon(baja, ofertas, bajaResto, 1)) return baja;
  }
  return null;
}

type Escenario = {
  etiqueta: string;
  baja: number;
  importe: number;
  importe_unidad: number | null;
  ganadas_con_menos: number | null;
  anormal: boolean;
};

// regla: con qué se decide «anormal». «pliego»: la baja que fija el pliego; «literal»: el pliego
// trae su regla pero no se pudo leer como baja (se estima con el art. 85 y se enseña el literal);
// «art85»: el pliego remite al RGLCAP o no dice nada.
export type ReglaAnormal = 'pliego' | 'literal' | 'art85';
// unidad: con precios por unidad (alumno, hora, edición), en qué se dan también los importes.
export type UnidadEscenarios = { nombre: string; base: number };

export type Escenarios = {
  presupuesto: number;
  ofertas_esperadas: number;
  baja_resto: number;
  umbral_anormal: number | null;
  filas: Escenario[];
  regla: ReglaAnormal;
  umbral_literal: string | null;
  cita: string | null;
  unidad: UnidadEscenarios | null;
  umbral_unidad: number | null;
};

export type UmbralPliego = { baja: number | null; literal: string | null; cita?: string | null };

export type EntradaEscenarios = {
  presupuesto: number;
  percentiles: Percentiles;
  bajas: number[];
  ordenadas: number[];
  ofertas: number;
  umbralPliego?: UmbralPliego | null;
  unidad?: UnidadEscenarios | null;
};

function reglaDe(u: UmbralPliego | null | undefined): ReglaAnormal {
  if (u?.baja != null) return 'pliego';
  return u?.literal ? 'literal' : 'art85';
}

// «Inferiores en un 15 %»: anormal solo si la baja pasa del umbral, no si lo iguala.
const pasaDe = (baja: number, umbral: number) => baja > umbral + 1e-9;

// Precios por unidad con cuatro decimales, como el precio sugerido de la oferta.
const enUnidad = (u: UnidadEscenarios | null, baja: number) =>
  u ? Math.round(u.base * (1 - baja) * 10_000) / 10_000 : null;

function candidatasDe(e: EntradaEscenarios): { etiqueta: string; baja: number }[] {
  return [
    ...(Object.entries(e.percentiles) as [string, number | null][])
      .filter((x): x is [string, number] => x[1] !== null)
      .map(([k, baja]) => ({ etiqueta: k, baja })),
    ...e.bajas.map((baja) => ({ etiqueta: 'propuesta', baja })),
  ].sort((a, b) => a.baja - b.baja);
}

/**
 * Escenarios para los percentiles del segmento y las bajas que proponga el usuario. Si el
 * pliego fija su umbral como baja, manda ese y no el art. 85 (LCSP art. 149).
 */
export function escenarios(e: EntradaEscenarios): Escenarios {
  const bajaResto = e.percentiles.p50 ?? 0;
  const regla = reglaDe(e.umbralPliego);
  const delPliego = regla === 'pliego' ? e.umbralPliego!.baja! : null;
  const unidad = e.unidad ?? null;
  const filas = candidatasDe(e).map(({ etiqueta, baja }) => ({
    etiqueta,
    baja: redondear(baja),
    importe: Math.round(e.presupuesto * (1 - baja) * 100) / 100,
    importe_unidad: enUnidad(unidad, baja),
    ganadas_con_menos: proporcionHasta(e.ordenadas, baja),
    anormal: delPliego === null ? anormalCon(baja, e.ofertas, bajaResto, e.presupuesto) : pasaDe(baja, delPliego),
  }));
  const umbral = delPliego ?? umbralAnormal(e.ofertas, bajaResto);
  return {
    presupuesto: e.presupuesto,
    ofertas_esperadas: e.ofertas,
    baja_resto: bajaResto,
    umbral_anormal: umbral,
    filas,
    regla,
    umbral_literal: e.umbralPliego?.literal ?? null,
    cita: e.umbralPliego?.cita ?? null,
    unidad,
    umbral_unidad: umbral === null ? null : enUnidad(unidad, umbral),
  };
}
