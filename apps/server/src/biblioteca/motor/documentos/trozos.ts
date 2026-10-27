// Trozos de texto que se indexan (búsqueda por palabras y por significado). Un
// trozo nunca cruza de página, para poder citar «pág. N».
export type TrozoTexto = { page: number | null; text: string };

// ≈ 300 tokens: cabe de sobra en el modelo de embeddings (512) y es un párrafo
// largo, suficiente para que un fragmento tenga sentido por sí solo.
export const CARACTERES_TROZO = 1200;
const MIN_CARACTERES_TROZO = 40;
// Cambia cuando cambia cómo se trocea: el índice guardado con otra versión se rehace.
// 2: los saltos de línea dentro de un párrafo se conservan (cada fila de una tabla, como
// el cuadro de características de un pliego, sigue siendo una línea).
export const VERSION_TROCEADO = 2;

// Un párrafo más largo que el trozo se corta por líneas; una línea que tampoco cabe, por
// frases, y una frase que tampoco cabe, a pelo.
function partirLargo(paragraph: string, max: number): string[] {
  const salida: string[] = [];
  let actual = '';
  const anadir = (pieza: string, separador: string) => {
    if (actual && actual.length + pieza.length + 1 > max) {
      salida.push(actual);
      actual = '';
    }
    actual = actual ? `${actual}${separador}${pieza}` : pieza;
  };
  for (const line of paragraph.split('\n')) {
    if (line.length <= max) {
      anadir(line, '\n');
      continue;
    }
    // La línea larga empieza en línea nueva; sus frases siguen en la misma.
    let separador = '\n';
    for (const oracion of line.split(/(?<=[.!?;:])\s+/)) {
      for (let s = oracion; s.length > 0; s = s.slice(max)) {
        anadir(s.slice(0, max), separador);
        separador = ' ';
      }
    }
  }
  if (actual) salida.push(actual);
  return salida;
}

// Espacios de más fuera, pero no los saltos de línea.
function normalizarParrafo(p: string): string {
  return p
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

/** Trozos de un texto: párrafos juntados hasta ~CARACTERES_TROZO. */
export function trocearTexto(texto: string, max = CARACTERES_TROZO): string[] {
  const parrafos = texto
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map(normalizarParrafo)
    .filter(Boolean)
    .flatMap((p) => (p.length > max ? partirLargo(p, max) : [p]));
  const trozos: string[] = [];
  let actual = '';
  for (const p of parrafos) {
    if (actual && actual.length + p.length + 2 > max) {
      trozos.push(actual);
      actual = '';
    }
    actual = actual ? `${actual}\n\n${p}` : p;
  }
  if (actual) trozos.push(actual);
  return trozos.filter((c) => c.length >= MIN_CARACTERES_TROZO || trozos.length === 1);
}

/** Trozos de un documento, con su número de página (desde 1) si lo tiene. */
export function trocearPaginas(paginas: string[], conPaginas: boolean): TrozoTexto[] {
  return paginas.flatMap((texto, i) => trocearTexto(texto).map((t) => ({ page: conPaginas ? i + 1 : null, text: t })));
}
