// Puntuación orientativa (0–100) del interés de un órgano para la empresa.

// Mide cuánto licita en el sector, con qué regularidad y si sus bajas son moderadas. Es una ordenación para
// mirar primero, no una predicción; los pesos están a la vista en la web.
const PESOS = { volumen: 0.45, recurrencia: 0.35, baja: 0.2 } as const;
// Una baja media del 30 % o más ya es guerra de precios: puntúa 0 en «baja».
const BAJA_DURA = 0.3;
// Sin periodo (todo el histórico) se mide la recurrencia sobre tres años.
const MESES_SIN_PERIODO = 36;

export type Interes = { puntos: number; volumen: number; recurrencia: number; baja: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
const acotar = (n: number) => Math.min(1, Math.max(0, n));

/**
 * volumen: importe licitado en escala logarítmica frente al mayor órgano del ranking;
 * recurrencia: meses con licitaciones del sector frente a un tercio del periodo (licitar
 * uno de cada tres meses ya es recurrente); baja: 1 sin baja, 0 desde BAJA_DURA. Sin
 * bajas conocidas, neutral (0,5).
 */
export function interes(
  o: { importe_licitado: number; meses_activos: number; baja_media: number | null },
  maxImporte: number,
  meses: number,
): Interes {
  const volumen = maxImporte > 0 ? acotar(Math.log1p(o.importe_licitado) / Math.log1p(maxImporte)) : 0;
  const recurrencia = acotar(o.meses_activos / Math.max(1, (meses || MESES_SIN_PERIODO) / 3));
  const baja = o.baja_media === null ? 0.5 : acotar(1 - o.baja_media / BAJA_DURA);
  const puntos = Math.round(100 * (PESOS.volumen * volumen + PESOS.recurrencia * recurrencia + PESOS.baja * baja));
  return { puntos, volumen: r2(volumen), recurrencia: r2(recurrencia), baja: r2(baja) };
}
