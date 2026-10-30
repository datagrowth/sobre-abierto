// El texto de la memoria tal como lo leen los compromisos con coste: línea a línea y con su contexto. Puro.
import type { ApartadoDatosData } from './memoriaRevision.js';

// Una cifra suelta no dice nada («30 min por subgrupo»): lo que la convierte en una dedicación fija es la
// cabecera de la tabla («Dedicación semanal») o el título del bloque, y lo que dice a quién llega el material es
// la lista que sigue a «envía a cada alumna:». Por eso se conservan los títulos ###/####, las cabeceras y las
// filas «| a | b |».
export type LineaCostes = {
  texto: string;
  apartado: number | null;
  // «1.2» bajo un encabezado con numeración con punto («## 1.2 Metodología»): la memoria se
  // numera así aunque el guion la cuente como su apartado 2. null bajo «## N.».
  seccion: string | null;
  titulo: string | null;
  tabla: number | null;
  cabecera: string[] | null;
  celdas: string[] | null;
  // La propia línea y, si abre una lista («…el material necesario:»), sus viñetas.
  contexto: string;
};

// Como secciones() de chequeosDocumento.ts: «## N. Título» abre el apartado N del guion. Dentro, la
// memoria puede numerar con punto («## 1.2 Metodología», «## 1.2. …»): eso no cambia el
// apartado del guion (el 2), solo cómo se nombra al pedir cambios («el apartado 1.2»).
const APARTADO = /^## (\d{1,2})(?:\.|((?:\.\d{1,2})+)\.?)\s/;
const TITULO = /^#{3,4}\s+(.+?)\s*$/;
const ENCABEZADO = /^#{1,6}\s/;
const FILA = /^\s*\|.*\|\s*$/;
const SEPARADOR = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;
const VINETA = /^\s*(?:[-*+]|\d{1,2}[.)])\s+/;

/** Las celdas de una fila «| a | b |», sin los bordes. */
const celdasDe = (fila: string): string[] =>
  fila
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

type Estado = {
  apartado: number | null;
  seccion: string | null;
  titulo: string | null;
  tabla: number;
  cabecera: string[] | null;
};

// Un encabezado cambia el apartado o el título y cierra la tabla; true si la línea era uno.
function encabezado(linea: string, e: Estado): boolean {
  if (!ENCABEZADO.test(linea)) return false;
  const ap = APARTADO.exec(linea);
  if (ap?.[2]) e.seccion = `${ap[1]}${ap[2]}`;
  else if (ap) {
    e.apartado = Number(ap[1]);
    e.seccion = null;
    e.titulo = null;
  } else if (/^## /.test(linea)) e.seccion = null;
  const t = TITULO.exec(linea);
  if (t) e.titulo = t[1]!.replace(/\*+/g, '').trim();
  e.cabecera = null;
  return true;
}

function lineaDe(texto: string, e: Estado, celdas: string[] | null): LineaCostes {
  return {
    texto,
    apartado: e.apartado,
    seccion: e.seccion,
    titulo: e.titulo,
    tabla: celdas ? e.tabla : null,
    cabecera: celdas ? e.cabecera : null,
    celdas,
    contexto: texto,
  };
}

// Las líneas con contenido: los encabezados y las cabeceras de tabla no comprometen nada, solo dan contexto.
function lineasSueltas(md: string): LineaCostes[] {
  const ls = md.split(/\r?\n/);
  const e: Estado = { apartado: null, seccion: null, titulo: null, tabla: 0, cabecera: null };
  const out: LineaCostes[] = [];
  for (let i = 0; i < ls.length; i += 1) {
    const l = ls[i]!;
    if (encabezado(l, e) || SEPARADOR.test(l)) continue;
    if (FILA.test(l) && SEPARADOR.test(ls[i + 1] ?? '')) {
      e.tabla += 1;
      e.cabecera = celdasDe(l);
      continue;
    }
    if (!FILA.test(l)) e.cabecera = null;
    if (l.trim()) out.push(lineaDe(l.trim(), e, FILA.test(l) && e.cabecera ? celdasDe(l) : null));
  }
  return out;
}

// Una línea que acaba en «:» presenta lo que sigue: sus viñetas son parte de lo que dice.
function conVinetas(ls: LineaCostes[]): LineaCostes[] {
  return ls.map((l, i) => {
    if (l.celdas || !l.texto.endsWith(':')) return l;
    const siguientes: string[] = [];
    for (let j = i + 1; j < ls.length && VINETA.test(ls[j]!.texto) && !ls[j]!.celdas; j += 1)
      siguientes.push(ls[j]!.texto);
    return siguientes.length ? { ...l, contexto: [l.texto, ...siguientes].join('\n') } : l;
  });
}

/** Las líneas de una memoria en markdown con su apartado, título, tabla y contexto. */
export const lineasParaCostes = (md: string): LineaCostes[] => conVinetas(lineasSueltas(md));

type Bloque = ApartadoDatosData['bloques'][number];

function tablaMd(t: NonNullable<Bloque['tabla']>): string[] {
  const fila = (cs: string[]) => `| ${cs.map((c) => c.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ')).join(' | ')} |`;
  return [fila(t.cabecera), `|${t.cabecera.map(() => '---').join('|')}|`, ...t.filas.map(fila)];
}

function bloqueMd(b: Bloque): string[] {
  return [
    ...(b.subtitulo ? [`### ${b.subtitulo}`] : []),
    ...b.parrafos,
    ...(b.lista ?? []).map((x) => `- ${x}`),
    ...(b.lista_numerada ?? []).map((x, i) => `${i + 1}. ${x}`),
    ...(b.tabla ? tablaMd(b.tabla) : []),
  ];
}

/**
 * Un apartado guardado como lo lee el detector: «## n. Título», los subtítulos como ###, las
 * listas como viñetas y las tablas como filas «| a | b |». Para las comprobaciones y el resumen, sin
 * tocar cómo se revisa el apartado (memoriaRevision.ts).
 */
export function textoParaCostes(d: Pick<ApartadoDatosData, 'titulo' | 'bloques'>, n?: number): string {
  const cabeza = n ? `## ${n}. ${d.titulo}` : `## ${d.titulo}`;
  return [cabeza, ...d.bloques.flatMap((b) => ['', ...bloqueMd(b)])].join('\n');
}
