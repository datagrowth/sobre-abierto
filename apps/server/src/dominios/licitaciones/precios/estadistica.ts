// Estadística descriptiva de bajas, en JS y sin dependencias: dispersión, tendencia por
// año y relación con el número de ofertas. Percentiles y media son del núcleo.
import { media, percentil, percentiles, type Percentiles } from '../../../nucleo/estadistica.js';

export type Observacion = { baja: number; anio: number | null; ofertas: number | null };

const redondear = (n: number, decimales = 4) => Math.round(n * 10 ** decimales) / 10 ** decimales;

/** Desviación típica muestral (n − 1). */
function desviacion(valores: number[]): number | null {
  const m = media(valores);
  if (m === null || valores.length < 2) return null;
  return Math.sqrt(valores.reduce((s, v) => s + (v - m) ** 2, 0) / (valores.length - 1));
}

/** Proporción de valores menores o iguales que x (función de distribución empírica). */
export function proporcionHasta(ordenados: number[], x: number): number | null {
  if (!ordenados.length) return null;
  let n = 0;
  while (n < ordenados.length && (ordenados[n] ?? Number.POSITIVE_INFINITY) <= x + 1e-12) n += 1;
  return n / ordenados.length;
}

/** Pendiente por mínimos cuadrados (cambio de y por unidad de x), o null si no hay variación en x. */
function pendiente(puntos: { x: number; y: number }[]): number | null {
  if (puntos.length < 2) return null;
  const mx = media(puntos.map((p) => p.x)) ?? 0;
  const my = media(puntos.map((p) => p.y)) ?? 0;
  const sxx = puntos.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  return puntos.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
}

type Grupo = { clave: string; n: number; mediana: number | null; media: number | null };

function agrupar(obs: Observacion[], clave: (o: Observacion) => string | null): Map<string, number[]> {
  const grupos = new Map<string, number[]>();
  for (const o of obs) {
    const k = clave(o);
    if (k === null) continue;
    const lista = grupos.get(k) ?? [];
    lista.push(o.baja);
    grupos.set(k, lista);
  }
  return grupos;
}

function resumirGrupo(clave: string, bajas: number[]): Grupo {
  const ordenadas = [...bajas].sort((a, b) => a - b);
  const mediana = percentil(ordenadas, 0.5);
  const m = media(bajas);
  return {
    clave,
    n: bajas.length,
    mediana: mediana === null ? null : redondear(mediana),
    media: m === null ? null : redondear(m),
  };
}

function porAnio(obs: Observacion[]): Grupo[] {
  const grupos = agrupar(obs, (o) => (o.anio === null ? null : String(o.anio)));
  return [...grupos].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => resumirGrupo(k, v));
}

// Tramos de número de ofertas: a más competencia, más baja.
export const TRAMOS_OFERTAS = [
  { clave: '1', min: 1, max: 1 },
  { clave: '2-3', min: 2, max: 3 },
  { clave: '4-5', min: 4, max: 5 },
  { clave: '6-10', min: 6, max: 10 },
  { clave: '11+', min: 11, max: Number.POSITIVE_INFINITY },
] as const;

export function tramoDeOfertas(ofertas: number | null): string | null {
  if (ofertas === null || ofertas < 1) return null;
  return TRAMOS_OFERTAS.find((t) => ofertas >= t.min && ofertas <= t.max)?.clave ?? null;
}

function porOfertas(obs: Observacion[]): Grupo[] {
  const grupos = agrupar(obs, (o) => tramoDeOfertas(o.ofertas));
  return TRAMOS_OFERTAS.filter((t) => grupos.has(t.clave)).map((t) => resumirGrupo(t.clave, grupos.get(t.clave) ?? []));
}

export type Resumen = {
  n: number;
  percentiles: Percentiles;
  media: number | null;
  desviacion: number | null;
  rango_intercuartil: number | null;
  por_anio: Grupo[];
  tendencia_anual: number | null;
  por_ofertas: Grupo[];
};

/** Todo lo que se cuenta de una muestra de bajas. */
export function resumir(obs: Observacion[]): Resumen {
  const bajas = obs.map((o) => o.baja);
  const ordenadas = [...bajas].sort((a, b) => a - b);
  const p = percentiles(ordenadas);
  const conAnio = obs.filter((o) => o.anio !== null).map((o) => ({ x: o.anio ?? 0, y: o.baja }));
  const r = (v: number | null) => (v === null ? null : redondear(v));
  return {
    n: obs.length,
    percentiles: p,
    media: r(media(bajas)),
    desviacion: r(desviacion(bajas)),
    rango_intercuartil: p.p75 !== null && p.p25 !== null ? r(p.p75 - p.p25) : null,
    por_anio: porAnio(obs),
    tendencia_anual: r(pendiente(conAnio)),
    por_ofertas: porOfertas(obs),
  };
}
