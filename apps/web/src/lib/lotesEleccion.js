// Reglas puras de la elección de lotes: hasta cuántos se pueden marcar y qué cambia
// respecto a lo guardado. Sin React para poder probarlas.

/** Quitar la marca se permite siempre; marcar solo mientras no se alcance el máximo del pliego. */
export function puedeMarcar(elegidos, id, maximo) {
  if (elegidos.includes(id)) return true;
  if (!Number.isInteger(maximo) || maximo < 1) return true;
  return elegidos.length < maximo;
}

/** @returns {{ quitados: string[], anadidos: string[] }} */
export function cambioDeLotes(antes = [], despues = []) {
  return {
    quitados: antes.filter((x) => !despues.includes(x)),
    anadidos: despues.filter((x) => !antes.includes(x)),
  };
}

export const textoMaximoLotes = (maximo) =>
  `Este pliego deja ir a ${maximo} ${maximo === 1 ? 'lote' : 'lotes'} como mucho.`;
