// Fórmulas de los índices de mercado, puras y sin base de datos.
import { tramoDeOfertas, TRAMOS_OFERTAS } from '../precios/estadistica.js';
import { umbralAnormal, type ReglaAnormal } from '../precios/escenarios.js';

// Estadística ponderada por antigüedad, competencia esperada con el ajuste del órgano, baja esperada por tramos
// de ofertas, confianza, licitadores probables y concentración del órgano.
const ANIO_MS = 365.25 * 24 * 60 * 60_000;
// Peso de una adjudicación por su antigüedad: la mitad cada dos años.
const SEMIVIDA_ANIOS = 2;
// Peso del mercado frente al órgano al mezclar sus medianas (con 10 comparables del órgano, mitad y mitad).
const K_ORGANO = 10;
const MIN_ORGANO = 5;

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** w = 0,5^(años / 2), con los años entre la adjudicación y la fecha de referencia (nunca negativos). */
export function pesoAntiguedad(fecha: string | null, referenciaMs: number): number {
  const t = fecha ? Date.parse(fecha) : Number.NaN;
  if (!Number.isFinite(t)) return 0;
  return 0.5 ** (Math.max(0, (referenciaMs - t) / ANIO_MS) / SEMIVIDA_ANIOS);
}

export type Ponderado = { valor: number; peso: number };

/** Percentil ponderado: el primer valor cuyo peso acumulado llega a p del total. */
export function percentilPonderado(datos: Ponderado[], p: number): number | null {
  const validos = datos.filter((d) => d.peso > 0 && Number.isFinite(d.valor)).sort((a, b) => a.valor - b.valor);
  const total = validos.reduce((s, d) => s + d.peso, 0);
  if (!total) return null;
  let acumulado = 0;
  for (const d of validos) {
    acumulado += d.peso;
    if (acumulado >= p * total - 1e-12) return d.valor;
  }
  return validos.at(-1)?.valor ?? null;
}

type Rango = { p25: number | null; p50: number | null; p75: number | null };

function rangoPonderado(datos: Ponderado[]): Rango {
  return {
    p25: percentilPonderado(datos, 0.25),
    p50: percentilPonderado(datos, 0.5),
    p75: percentilPonderado(datos, 0.75),
  };
}

/** Una adjudicación comparable, ya con su peso y si es del mismo órgano. */
export type Comparable = {
  licitacion_id: string;
  lote: string;
  ofertas: number | null;
  baja: number | null;
  fecha: string | null;
  organo_nif: string | null;
  adjudicatario_nif: string | null;
  peso: number;
  mismo_organo: boolean;
};

export type Competencia = {
  ofertas: number | null;
  rango: Rango;
  p_un_licitador: number | null;
  n: number;
  n_organo: number;
  mediana_organo: number | null;
  ajustado_por_organo: boolean;
};

/**
 * Ofertas esperadas: mediana ponderada en los comparables; con 5 o más del órgano, se mezcla con
 * la suya: N̂ = (n_o · med_o + k · med_C) / (n_o + k). P(un licitador): peso de los que tuvieron una.
 */
export function competencia(c: Comparable[]): Competencia {
  const conOfertas = c.filter((x) => x.ofertas !== null && x.ofertas >= 1);
  const datos = conOfertas.map((x) => ({ valor: x.ofertas!, peso: x.peso }));
  const rango = rangoPonderado(datos);
  const delOrgano = conOfertas.filter((x) => x.mismo_organo);
  const medOrgano = percentilPonderado(
    delOrgano.map((x) => ({ valor: x.ofertas!, peso: x.peso })),
    0.5,
  );
  const ajustar = delOrgano.length >= MIN_ORGANO && medOrgano !== null && rango.p50 !== null;
  const ofertas = ajustar
    ? (delOrgano.length * medOrgano + K_ORGANO * rango.p50!) / (delOrgano.length + K_ORGANO)
    : rango.p50;
  const total = datos.reduce((s, d) => s + d.peso, 0);
  const unico = datos.filter((d) => d.valor === 1).reduce((s, d) => s + d.peso, 0);
  return {
    ofertas: ofertas === null ? null : Math.round(ofertas * 10) / 10,
    rango,
    p_un_licitador: total ? r4(unico / total) : null,
    n: conOfertas.length,
    n_organo: delOrgano.length,
    mediana_organo: medOrgano,
    ajustado_por_organo: ajustar,
  };
}

type TramoBaja = { tramo: string; probabilidad: number; mediana: number | null; n: number };

export type Baja = {
  esperada: number | null;
  rango: Rango;
  n: number;
  tramos: TramoBaja[];
  umbral_anormal: number | null;
  // Con qué se decide el umbral: aquí siempre el art. 85; la licitación pone el del pliego si lo trae (index.ts).
  regla_umbral: ReglaAnormal;
  umbral_literal: string | null;
};

/**
 * Baja esperada: Σ P(N en el tramo t) · mediana(b | t), con la probabilidad de cada tramo de
 * ofertas en los comparables (ponderada) y la mediana de las bajas de ese tramo. Un tramo sin
 * bajas no cuenta y su probabilidad se reparte entre los demás. El rango es el P25-P75 de todas.
 * El umbral de anormalidad es el del art. 85 RGLCAP con las ofertas esperadas.
 */
export function baja(c: Comparable[], ofertasEsperadas: number | null): Baja {
  const conBaja = c.filter((x) => x.baja !== null);
  const rango = rangoPonderado(conBaja.map((x) => ({ valor: x.baja!, peso: x.peso })));
  const conOfertas = c.filter((x) => tramoDeOfertas(x.ofertas) !== null);
  const total = conOfertas.reduce((s, x) => s + x.peso, 0);
  const tramos = TRAMOS_OFERTAS.map((t) => {
    const delTramo = conOfertas.filter((x) => tramoDeOfertas(x.ofertas) === t.clave);
    const bajas = delTramo.filter((x) => x.baja !== null);
    return {
      tramo: t.clave,
      probabilidad: total ? r4(delTramo.reduce((s, x) => s + x.peso, 0) / total) : 0,
      mediana: percentilPonderado(
        bajas.map((x) => ({ valor: x.baja!, peso: x.peso })),
        0.5,
      ),
      n: bajas.length,
    };
  });
  const utiles = tramos.filter((t) => t.mediana !== null && t.probabilidad > 0);
  const masa = utiles.reduce((s, t) => s + t.probabilidad, 0);
  const esperada = masa ? r4(utiles.reduce((s, t) => s + t.probabilidad * t.mediana!, 0) / masa) : rango.p50;
  const n = ofertasEsperadas === null ? null : Math.max(1, Math.round(ofertasEsperadas));
  return {
    esperada,
    rango,
    n: conBaja.length,
    tramos,
    umbral_anormal: n === null || esperada === null ? null : umbralAnormal(n, esperada),
    regla_umbral: 'art85',
    umbral_literal: null,
  };
}

export type Confianza = 'alta' | 'media' | 'baja';

/** Alta: n ≥ 30 con CPV de 4 cifras o más. Media: n de 10 a 29 o retroceso a 3. Baja: n < 10 o a 2. */
export function confianza(n: number, cifrasCpv: number): Confianza {
  if (n < 10 || cifrasCpv <= 2) return 'baja';
  if (n >= 30 && cifrasCpv >= 4) return 'alta';
  return 'media';
}

export type Participacion = {
  licitacion_id: string;
  lote: string;
  empresa_nif: string;
  rol: string;
  fecha: string | null;
};

export type Probable = {
  nif: string;
  puntos: number;
  ganadas: number;
  presentadas: number;
  ganadas_organo: number;
  presentadas_organo: number;
  ultima: string | null;
  // Media de la baja de lo que ganó entre los comparables (sin dato si no ganó ninguno con baja creíble).
  baja_media: number | null;
};

/**
 * score(e) = Σ w(a) · (2 si ganó, 1 si solo licitó) · (1,5 si es del mismo órgano), sobre las
 * participaciones en los comparables (las excluidas no cuentan). Las `limite` primeras.
 */
export function licitadoresProbables(
  comparables: Comparable[],
  participaciones: Participacion[],
  limite = 5,
): Probable[] {
  const porLote = new Map(comparables.map((c) => [`${c.licitacion_id}|${c.lote}`, c]));
  const porEmpresa = new Map<string, Probable>();
  const bajas = new Map<string, number[]>();
  for (const p of participaciones) {
    const c = porLote.get(`${p.licitacion_id}|${p.lote}`);
    if (!c || p.rol === 'excluida') continue;
    const gano = p.rol === 'adjudicataria';
    const e = porEmpresa.get(p.empresa_nif) ?? {
      nif: p.empresa_nif,
      puntos: 0,
      ganadas: 0,
      presentadas: 0,
      ganadas_organo: 0,
      presentadas_organo: 0,
      ultima: null,
      baja_media: null,
    };
    if (gano && c.baja !== null) bajas.set(p.empresa_nif, [...(bajas.get(p.empresa_nif) ?? []), c.baja]);
    e.puntos += c.peso * (gano ? 2 : 1) * (c.mismo_organo ? 1.5 : 1);
    e.presentadas += 1;
    e.ganadas += gano ? 1 : 0;
    e.presentadas_organo += c.mismo_organo ? 1 : 0;
    e.ganadas_organo += c.mismo_organo && gano ? 1 : 0;
    const fecha = p.fecha ?? c.fecha;
    if (fecha && (!e.ultima || fecha > e.ultima)) e.ultima = fecha;
    porEmpresa.set(p.empresa_nif, e);
  }
  const mediaDe = (v: number[] | undefined) => (v?.length ? r4(v.reduce((a, b) => a + b, 0) / v.length) : null);
  return [...porEmpresa.values()]
    .map((e) => ({ ...e, puntos: r4(e.puntos), baja_media: mediaDe(bajas.get(e.nif)) }))
    .sort((a, b) => b.puntos - a.puntos || (b.ultima ?? '').localeCompare(a.ultima ?? '') || a.nif.localeCompare(b.nif))
    .slice(0, limite);
}

type NivelConcentracion = 'baja' | 'media' | 'alta';

export type Concentracion = {
  primero: { nif: string; cuota: number } | null;
  hhi: number | null;
  nivel: NivelConcentracion | null;
  contratos: number;
  ultimas: { ganadas_primero: number; de: number };
};

export type AdjudicacionOrgano = { adjudicatario_nif: string; importe: number | null; fecha: string | null };

// Con la mitad o más de lo adjudicado en manos de uno, el órgano está concentrado.
export const CUOTA_CONCENTRADO = 0.5;
// Con menos contratos, una cuota alta no dice nada (uno solo es el 100 %): el mismo mínimo que el encaje.
export const MIN_CONTRATOS_CONCENTRADO = 4;
const ULTIMAS = 6;
// Umbrales habituales del HHI: por debajo de 1.500, poco concentrado; por encima de 2.500, muy concentrado.
const HHI_MEDIA = 1500;
const HHI_ALTA = 2500;

const nivelConcentracion = (hhi: number): NivelConcentracion =>
  hhi > HHI_ALTA ? 'alta' : hhi >= HHI_MEDIA ? 'media' : 'baja';

/** Cuota del primer adjudicatario y HHI (0-10.000) sobre el importe; y cuántas de las 6 últimas ganó él. */
export function concentracion(adjs: AdjudicacionOrgano[]): Concentracion {
  const conImporte = adjs.filter((a) => a.importe !== null && a.importe > 0);
  const total = conImporte.reduce((s, a) => s + a.importe!, 0);
  if (!total)
    return { primero: null, hhi: null, nivel: null, contratos: adjs.length, ultimas: { ganadas_primero: 0, de: 0 } };
  const porEmpresa = new Map<string, number>();
  for (const a of conImporte)
    porEmpresa.set(a.adjudicatario_nif, (porEmpresa.get(a.adjudicatario_nif) ?? 0) + a.importe!);
  const cuotas = [...porEmpresa]
    .map(([nif, importe]) => ({ nif, cuota: importe / total }))
    .sort((a, b) => b.cuota - a.cuota);
  const primero = cuotas[0]!;
  const ultimas = [...adjs].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? '')).slice(0, ULTIMAS);
  const hhi = Math.round(cuotas.reduce((s, c) => s + (c.cuota * 100) ** 2, 0));
  return {
    primero: { nif: primero.nif, cuota: r4(primero.cuota) },
    hhi,
    nivel: nivelConcentracion(hhi),
    contratos: adjs.length,
    ultimas: { ganadas_primero: ultimas.filter((a) => a.adjudicatario_nif === primero.nif).length, de: ultimas.length },
  };
}
