// Con la máquina cargada una sola medida se dispara por ruido del planificador. Se calienta una
// vez y se toma la mediana de varias vueltas: un pico aislado no falla, una regresión real
// (índice perdido) las encarece a todas y sigue fallando.
const VUELTAS = 5;

export function medirMediana<T>(fn: () => T): { ms: number; valor: T } {
  const valor = fn();
  const tiempos: number[] = [];
  for (let i = 0; i < VUELTAS; i += 1) {
    const inicio = performance.now();
    fn();
    tiempos.push(performance.now() - inicio);
  }
  tiempos.sort((a, b) => a - b);
  return { ms: Math.round(tiempos[Math.floor(VUELTAS / 2)] ?? 0), valor };
}
