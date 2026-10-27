// Piezas de texto que comparten las secciones del dossier de la memoria.
import * as indice from '../../../biblioteca/motor/documentos/almacen.js';

// Recortar a un tope diciendo cómo seguir, las páginas de un documento indexado con su cita («[PCAP p. 7]») y
// los tramos de páginas. Nada se pierde en silencio: lo que no cabe dice dónde está.
export type Parte = { texto: string; truncado: boolean };
// Un documento ya leído del índice: su ruta, la etiqueta de sus citas y sus páginas (página 0:
// un documento sin páginas, como un Word).
export type DocumentoLeido = { ruta: string; etiqueta: string; paginas: Map<number, string> };

/** Corta un texto a su tope por un final de línea y dice cómo seguir; sin cortar, tal cual. */
export function recortar(texto: string, tope: number, comoSeguir: string): Parte {
  if (texto.length <= tope) return { texto, truncado: false };
  const nota = `\n[recortado: ${comoSeguir}]`;
  const corte = texto.lastIndexOf('\n', Math.max(0, tope - nota.length));
  const hasta = corte > tope / 2 ? corte : Math.max(0, tope - nota.length);
  return { texto: `${texto.slice(0, hasta).trimEnd()}${nota}`, truncado: true };
}

/** «3-5, 9»: páginas sueltas agrupadas en tramos. */
export function tramosDePaginas(ps: number[]): string {
  const orden = [...new Set(ps)].sort((a, b) => a - b);
  const tramos: [number, number][] = [];
  for (const p of orden) {
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && p === ultimo[1] + 1) ultimo[1] = p;
    else tramos.push([p, p]);
  }
  return tramos.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(', ');
}

/** Las páginas de un documento indexado. */
export function paginasDe(idx: indice.BaseDatos, ruta: string): Map<number, string> {
  const paginas = new Map<number, string>();
  for (const c of indice.trozosDeArchivo(idx, ruta))
    paginas.set(c.page ?? 0, `${paginas.get(c.page ?? 0) ?? ''}${paginas.has(c.page ?? 0) ? '\n' : ''}${c.text}`);
  return paginas;
}

export const marcaPagina = (p: DocumentoLeido, n: number): string =>
  n === 0 ? `[${p.etiqueta}]` : `[${p.etiqueta} p. ${n}]`;
export const textoPaginas = (p: DocumentoLeido, ns: number[]): string =>
  ns
    .filter((n) => p.paginas.has(n))
    .map((n) => `${marcaPagina(p, n)}\n${p.paginas.get(n)!.trim()}`)
    .join('\n\n');
export const comoLeer = (p: { ruta: string }, ns: number[]): string =>
  `sigue en biblioteca_leer ruta=«${p.ruta}»${ns.length && !(ns.length === 1 && ns[0] === 0) ? `, págs. ${tramosDePaginas(ns)}` : ''}`;
