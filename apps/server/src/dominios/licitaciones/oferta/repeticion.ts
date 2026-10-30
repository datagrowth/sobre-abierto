// Frases que se repiten por toda la memoria: los jueces las leen como relleno. Puro.
import { textoComparable } from '../temas.js';

// Por ejemplo, la etiqueta literal de cada rol («Primer perfil técnico…») unas 40 veces, y el mismo caso en
// todos los apartados. Se cuentan los n-gramas de 6 palabras o más en el documento entero y se avisa de los que
// pasan de 8 veces (solo aviso: una frase repetida no siempre es un defecto).
const PALABRAS_NGRAMA = 6;
const MAX_REPETICIONES = 8;
// Los más repetidos bastan para ver el patrón; el resto suele ser el mismo con otra palabra.
const MAX_AVISOS = 5;

export type Repeticion = { frase: string; veces: number; apartado: number };

const palabras = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

function contar(textos: string[], n: number): Map<string, { veces: number; apartado: number }> {
  const cuenta = new Map<string, { veces: number; apartado: number }>();
  textos.forEach((t, i) => {
    const ws = palabras(t);
    for (let k = 0; k + n <= ws.length; k += 1) {
      const g = ws.slice(k, k + n).join(' ');
      const x = cuenta.get(g);
      cuenta.set(g, x ? { ...x, veces: x.veces + 1 } : { veces: 1, apartado: i + 1 });
    }
  });
  return cuenta;
}

// Una frase de 10 palabras repetida da 5 n-gramas encadenados (cada uno comparte n-1 palabras con
// el siguiente): son la misma frase y se avisa una vez.
const ventanas = (g: string, n: number) => {
  const ws = g.split(' ');
  return ws.map((_, k) => ws.slice(k, k + n).join(' ')).filter((x) => x.split(' ').length === n);
};

/** Los n-gramas de PALABRAS_NGRAMA palabras que salen más de MAX_REPETICIONES veces (textos[i] es el apartado i+1). */
export function repeticionesEn(textos: string[], n = PALABRAS_NGRAMA, max = MAX_REPETICIONES): Repeticion[] {
  const candidatos = [...contar(textos, n).entries()]
    .filter(([, x]) => x.veces > max)
    .sort((a, b) => b[1].veces - a[1].veces);
  const vistas = new Set<string>();
  const out: Repeticion[] = [];
  for (const [frase, x] of candidatos) {
    const sub = ventanas(frase, n - 1);
    const encadenada = sub.some((s) => vistas.has(s));
    sub.forEach((s) => vistas.add(s));
    if (encadenada) continue;
    out.push({ frase, veces: x.veces, apartado: x.apartado });
    if (out.length >= MAX_AVISOS) break;
  }
  return out;
}
