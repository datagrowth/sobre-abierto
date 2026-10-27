// Estadística descriptiva compartida por los dominios (bajas de licitaciones), en JS y sin dependencias.

const redondear = (n: number, decimales = 4) => Math.round(n * 10 ** decimales) / 10 ** decimales;

// Percentiles con interpolación lineal (el «tipo 7» de R y de Excel PERCENTIL.INC) y media.
/** Percentil p (0–1) de una lista ya ordenada de menor a mayor. */
export function percentil(ordenados: number[], p: number): number | null {
  if (!ordenados.length) return null;
  const pos = (ordenados.length - 1) * Math.min(1, Math.max(0, p));
  const bajo = Math.floor(pos);
  const alto = Math.ceil(pos);
  const a = ordenados[bajo] ?? 0;
  const b = ordenados[alto] ?? a;
  return a + (b - a) * (pos - bajo);
}

export function media(valores: number[]): number | null {
  return valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : null;
}

const PERCENTILES = { p10: 0.1, p25: 0.25, p50: 0.5, p75: 0.75, p90: 0.9 } as const;
export type Percentiles = Record<keyof typeof PERCENTILES, number | null>;

export function percentiles(ordenados: number[]): Percentiles {
  const out = {} as Percentiles;
  for (const [k, p] of Object.entries(PERCENTILES) as [keyof Percentiles, number][]) {
    const v = percentil(ordenados, p);
    out[k] = v === null ? null : redondear(v);
  }
  return out;
}
