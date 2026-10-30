// Precio sugerido para la oferta, con la estadística de Mercado (adjudicaciones parecidas de la PLACSP) y sin IA.
import { obtenerLicitacion, type Db } from '../store.js';
import { lotesDeLicitacion } from '../lotes.js';
import { consultaDe, OpcionesPrecios, ofertasEsperadas } from '../precios/index.js';
import { elegirSegmento } from '../precios/segmento.js';
import { proporcionHasta } from '../precios/estadistica.js';
import { umbralAnormal } from '../precios/escenarios.js';
import { percentil } from '../../../nucleo/estadistica.js';
import { guionVigente } from './guion.js';
import { ofertaParaLotes } from './guionLotes.js';

// Dos opciones sobre el presupuesto (el del lote si se va a uno solo, o el precio unitario máximo si se oferta
// por unidad):
// - equilibrio: la baja más pequeña que habría ganado en precio al menos el 80 % de las adjudicaciones
//   parecidas;
// - máxima probabilidad: la baja más alta sin caer en oferta anormalmente baja.
// Las dos quedan un punto por debajo del umbral de anormalidad (art. 85 RGLCAP con las ofertas esperadas; si el
// pliego fija el suyo, se avisa: manda el pliego).
const OBJETIVO_EQUILIBRIO = 0.8;
// Un punto de baja por debajo del umbral de anormalidad, por si el resto oferta algo distinto.
const MARGEN_ANORMAL = 0.01;

export type OpcionPrecio = { baja: number; importe: number; ganadas: number | null };
export type PrecioSugerido = {
  base: number;
  unidad: string | null;
  referencia: 'presupuesto' | 'lote' | 'precio_unitario';
  comparables: number;
  ofertas_esperadas: number;
  umbral_anormal: number | null;
  equilibrio: OpcionPrecio | null;
  maxima: OpcionPrecio | null;
  avisos: string[];
};

// Bajas en décimas de punto: 0,123 → 0,124 (arriba) o 0,123 (abajo).
const arriba = (b: number) => Math.ceil(b * 1000 - 1e-9) / 1000;
const abajo = (b: number) => Math.floor(b * 1000 + 1e-9) / 1000;

function opcion(baja: number, base: number, unitario: boolean, ordenadas: number[]): OpcionPrecio {
  const decimales = unitario ? 10_000 : 100;
  return {
    baja,
    importe: Math.round(base * (1 - baja) * decimales) / decimales,
    ganadas: proporcionHasta(ordenadas, baja),
  };
}

/**
 * Las dos opciones a partir de las bajas ganadoras parecidas (ordenadas de menor a mayor) y
 * el umbral de anormalidad (null si no lo hay). Sin bajas, ninguna.
 */
export function opcionesDePrecio(
  ordenadas: number[],
  umbral: number | null,
  base: number,
  unitario = false,
): { equilibrio: OpcionPrecio | null; maxima: OpcionPrecio | null } {
  if (!ordenadas.length || base <= 0) return { equilibrio: null, maxima: null };
  const tope = abajo(umbral === null ? (ordenadas.at(-1) ?? 0) : Math.max(0, umbral - MARGEN_ANORMAL));
  const objetivo = ordenadas[Math.max(0, Math.ceil(OBJETIVO_EQUILIBRIO * ordenadas.length) - 1)] ?? 0;
  return {
    equilibrio: opcion(Math.min(arriba(objetivo), tope), base, unitario, ordenadas),
    maxima: opcion(tope, base, unitario, ordenadas),
  };
}

type Base = {
  base: number | null;
  unidad: string | null;
  referencia: PrecioSugerido['referencia'];
  lote: string | undefined;
};

function baseDe(db: Db, id: string, lotes: string[]): Base {
  const g = guionVigente(db, id)?.datos;
  const oe = g ? ofertaParaLotes(g, lotes) : null;
  const lote = lotes.length === 1 ? lotes[0] : undefined;
  const unitario = oe?.precios_unitarios[0];
  if (unitario) return { base: unitario.maximo, unidad: unitario.unidad, referencia: 'precio_unitario', lote };
  const delLote = lote ? lotesDeLicitacion(db, id)?.lotes.find((x) => x.id === lote)?.presupuesto_sin_iva : null;
  if (delLote) return { base: delLote, unidad: null, referencia: 'lote', lote };
  return {
    base: oe?.presupuesto_base ?? obtenerLicitacion(db, id)?.presupuesto_sin_iva ?? null,
    unidad: null,
    referencia: 'presupuesto',
    lote,
  };
}

function avisosDe(db: Db, id: string, s: { comparables: number; lotes: string[] }): string[] {
  const g = guionVigente(db, id)?.datos;
  const pliego = g ? ofertaParaLotes(g, s.lotes)?.umbral_anormalidad : null;
  const varios = s.lotes.length > 1;
  return [
    s.comparables < 5 ? `Solo ${s.comparables} adjudicaciones parecidas: tómalo como orientación.` : null,
    varios ? 'Vamos a varios lotes: el precio se calcula para el contrato entero; ajústalo por lote.' : null,
    pliego
      ? `El pliego fija su umbral de anormalidad («${pliego.slice(0, 300)}${pliego.length > 300 ? '…' : ''}»): comprueba que la baja no lo pasa.`
      : null,
  ].filter((a): a is string => a !== null);
}

/** El precio sugerido de cada lote al que se va (clave «» sin lotes: el contrato entero). */
export function preciosSugeridos(
  db: Db,
  id: string,
  lotes: string[],
  minimo: number,
): Record<string, PrecioSugerido | null> {
  if (!lotes.length) return { '': precioSugerido(db, id, [], minimo) };
  return Object.fromEntries(lotes.map((l) => [l, precioSugerido(db, id, [l], minimo)]));
}

/** Precio sugerido para una licitación (con los lotes a los que se va); null si no hay presupuesto. */
export function precioSugerido(db: Db, id: string, lotes: string[], minimo: number): PrecioSugerido | null {
  const l = obtenerLicitacion(db, id);
  if (!l) return null;
  const b = baseDe(db, id, lotes);
  if (!b.base) return null;
  const o = OpcionesPrecios.parse({});
  const lote = b.lote ? (lotesDeLicitacion(db, id)?.lotes.find((x) => x.id === b.lote) ?? null) : null;
  const { observaciones } = elegirSegmento(db, consultaDe(l, o, lote), minimo);
  const ordenadas = observaciones.map((x) => x.baja).sort((x, y) => x - y);
  const ofertas = ofertasEsperadas(
    o,
    observaciones.map((x) => x.ofertas),
  );
  const umbral = ordenadas.length ? umbralAnormal(ofertas, percentil(ordenadas, 0.5) ?? 0) : null;
  return {
    base: b.base,
    unidad: b.unidad,
    referencia: b.referencia,
    comparables: ordenadas.length,
    ofertas_esperadas: ofertas,
    umbral_anormal: umbral,
    ...opcionesDePrecio(ordenadas, umbral, b.base, b.unidad !== null),
    avisos: avisosDe(db, id, { comparables: ordenadas.length, lotes }),
  };
}
