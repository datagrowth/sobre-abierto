// Límite de peticiones por agente (ventana deslizante de un minuto, en memoria).
const VENTANA_MS = 60_000;

export type Limitador = ((agente: string, ahoraMs?: number) => boolean) & {
  uso: (ahoraMs?: number) => Record<string, number>;
};

// Evita que un agente en bucle sature el servidor o el índice. `uso` dice cuántas lleva cada agente en el último
// minuto, para ver quién gasta el cupo.
export function crearLimitador(maxPorMinuto: number): Limitador {
  const usos = new Map<string, number[]>();
  const recientes = (agente: string, ahoraMs: number) =>
    (usos.get(agente) ?? []).filter((t) => ahoraMs - t < VENTANA_MS);
  const permitir = (agente: string, ahoraMs = Date.now()): boolean => {
    const r = recientes(agente, ahoraMs);
    const ok = r.length < maxPorMinuto;
    if (ok) r.push(ahoraMs);
    usos.set(agente, r);
    return ok;
  };
  const uso = (ahoraMs = Date.now()): Record<string, number> =>
    Object.fromEntries(
      [...usos.keys()].map((a) => [a, recientes(a, ahoraMs).length] as const).filter(([, n]) => n > 0),
    );
  return Object.assign(permitir, { uso });
}
