// Una memoria editada a mano en Word, vuelta a apartados. Pura: sin base de datos ni disco.
import type { ElementoDocx, ParrafoDocx } from '../../../nucleo/documentos/leerDocx.js';
import { textoComparable } from '../temas.js';
import { ApartadoDatos, type ApartadoDatosData } from './memoriaRevision.js';

export type ImagenGuardada = { ruta: string; ancho: number; alto: number };
export type ApartadosDeTexto = { datos: (ApartadoDatosData | null)[]; avisos: string[] };

// Se buscan los títulos del guion («1. Organización y metodología») entre los párrafos del documento y lo que
// hay entre uno y el siguiente es el apartado, en bloques y en el orden del documento: un subtítulo («1.2 …» o
// un estilo de título) abre bloque; los párrafos van como párrafos, las listas de Word como lista, las tablas
// como tabla y las imágenes (ya guardadas en Salidas) como imagen.
const MAX_BLOQUES = 40;
const MAX_PARRAFOS = 30;
const MAX_LISTA = 40;
const MAX_PARRAFO = 3000;
const MAX_COLUMNAS = 10;
const MAX_FILAS = 60;
const SUBTITULO = /^\d+\.\d+(?:\.\d+)*\.?\s+(\S.{1,198})$/;
const PIE = /^(figura|ilustraci[óo]n|imagen|gr[áa]fico)\s*\d*\s*[.:·-]/i;

const normal = (t: string) =>
  textoComparable(t)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const esParrafo = (e: ElementoDocx | undefined): e is ParrafoDocx => e?.tipo === 'parrafo';

// El título en el cuerpo es el párrafo entero; en el índice lleva detrás su página y no casa.
function esTitulo(e: ElementoDocx, n: number, titulo: string): boolean {
  if (!esParrafo(e) || e.lista) return false;
  const t = normal(e.texto);
  return t === normal(`${n}. ${titulo}`) || t === normal(titulo);
}

function secuenciaDesde(es: ElementoDocx[], titulos: string[], desde: number): (number | null)[] {
  let i = desde;
  return titulos.map((t, k) => {
    const j = es.findIndex((e, x) => x > i && esTitulo(e, k + 1, t));
    if (j === -1) return null;
    i = j;
    return j;
  });
}

const encontrados = (s: (number | null)[]) => s.filter((x) => x !== null).length;

/** Elemento de cada título (null si no está): la secuencia más completa y, a igualdad, la última (el cuerpo, no el índice). */
export function localizarTitulos(es: ElementoDocx[], titulos: string[]): (number | null)[] {
  const inicios = es.flatMap((e, x) => (esTitulo(e, 1, titulos[0] ?? '') ? [x - 1] : []));
  let mejor = secuenciaDesde(es, titulos, -1);
  for (const c of inicios) {
    const s = secuenciaDesde(es, titulos, c);
    if (encontrados(s) >= encontrados(mejor)) mejor = s;
  }
  return mejor;
}

type Tabla = { cabecera: string[]; filas: string[][] };
type Bloque = {
  subtitulo?: string;
  parrafos: string[];
  lista: string[];
  numerada: string[];
  tabla?: Tabla;
  imagen?: ImagenGuardada & { pie?: string };
};
const nuevo = (subtitulo?: string): Bloque => ({
  ...(subtitulo ? { subtitulo } : {}),
  parrafos: [],
  lista: [],
  numerada: [],
});

// El documento pinta cada bloque en este orden (párrafos, viñetas, lista numerada, tabla, imagen):
// lo que llega detrás de algo que se pinta después abre bloque, para no cambiar el orden del Word.
const FASES = { parrafo: 1, lista: 2, numerada: 3, tabla: 4, imagen: 5 } as const;
const fase = (b: Bloque) =>
  b.imagen ? 5 : b.tabla ? 4 : b.numerada.length ? 3 : b.lista.length ? 2 : b.parrafos.length ? 1 : 0;

function destino(bloques: Bloque[], que: keyof typeof FASES): Bloque {
  const b = bloques.at(-1)!;
  const ocupado =
    (que === 'tabla' && b.tabla) ||
    (que === 'imagen' && b.imagen) ||
    (que === 'parrafo' && b.parrafos.length >= MAX_PARRAFOS) ||
    (que === 'lista' && b.lista.length >= MAX_LISTA) ||
    (que === 'numerada' && b.numerada.length >= MAX_LISTA);
  if ((fase(b) <= FASES[que] && !ocupado) || bloques.length >= MAX_BLOQUES) return b;
  bloques.push(nuevo());
  return bloques.at(-1)!;
}

function partir(t: string): string[] {
  if (t.length <= MAX_PARRAFO) return [t];
  const frases = t.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) ?? [t];
  const out: string[] = [''];
  for (const f of frases) {
    if ((out.at(-1)! + f).length > MAX_PARRAFO && out.at(-1)) out.push('');
    out[out.length - 1] = (out.at(-1)! + f).slice(0, MAX_PARRAFO);
  }
  return out.map((x) => x.trim()).filter(Boolean);
}

// Hasta 10 columnas y 60 filas por tabla (las demás filas, en otra tabla con la misma cabecera).
function tablas(filas: string[][]): Tabla[] {
  const columnas = Math.min(MAX_COLUMNAS, Math.max(...filas.map((f) => f.length)));
  const ajustar = (f: string[], max: number) =>
    Array.from({ length: columnas }, (_, i) =>
      (f[i] ?? '')
        .replace(/\s*\n\s*/g, ' · ')
        .trim()
        .slice(0, max),
    );
  const cabecera = ajustar(filas[0]!, 200).map((c) => c || '—');
  const cuerpo = filas.slice(1).map((f) => ajustar(f, 1000));
  const out: Tabla[] = [];
  for (let i = 0; i < Math.max(cuerpo.length, 1); i += MAX_FILAS)
    out.push({ cabecera, filas: cuerpo.slice(i, i + MAX_FILAS) });
  return out;
}

function anadirParrafo(
  bloques: Bloque[],
  p: ParrafoDocx,
  siguiente: ElementoDocx | undefined,
  imagenes: Map<string, ImagenGuardada>,
): void {
  for (const id of p.imagenes) {
    const img = imagenes.get(id);
    const pie = esParrafo(siguiente) && PIE.test(siguiente.texto) ? siguiente.texto.slice(0, 300) : undefined;
    if (img) destino(bloques, 'imagen').imagen = { ...img, ...(pie ? { pie } : {}) };
  }
  const t = p.texto;
  if (!t) return;
  const sub = SUBTITULO.exec(t);
  if (!p.lista && (sub || (p.titulo && t.length <= 200)) && bloques.length < MAX_BLOQUES) {
    bloques.push(nuevo((sub?.[1] ?? t).slice(0, 200)));
    return;
  }
  // Con su negrita y su cursiva (Markdown restringido), que el Word volverá a pintar.
  const m = p.marcado || t;
  if (p.numerada) {
    destino(bloques, 'numerada').numerada.push(m.slice(0, 1000));
    return;
  }
  if (p.lista || t.length < 20) {
    if (t.length >= 2) destino(bloques, 'lista').lista.push(m.slice(0, 1000));
    return;
  }
  for (const trozo of partir(m)) destino(bloques, 'parrafo').parrafos.push(trozo);
}

function apartado(titulo: string, es: ElementoDocx[], imagenes: Map<string, ImagenGuardada>): ApartadoDatosData | null {
  const bloques: Bloque[] = [nuevo()];
  es.forEach((e, i) => {
    if (esParrafo(e)) anadirParrafo(bloques, e, es[i + 1], imagenes);
    else if (e.filas.length >= 2) for (const t of tablas(e.filas)) destino(bloques, 'tabla').tabla = t;
    else for (const c of e.filas[0] ?? []) if (c.length >= 2) destino(bloques, 'lista').lista.push(c.slice(0, 1000));
  });
  const conTexto = bloques
    .filter((b) => b.parrafos.length || b.lista.length || b.numerada.length || b.tabla || b.imagen)
    .map((b) => ({
      ...(b.subtitulo ? { subtitulo: b.subtitulo } : {}),
      parrafos: b.parrafos,
      ...(b.lista.length ? { lista: b.lista } : {}),
      ...(b.numerada.length ? { lista_numerada: b.numerada } : {}),
      ...(b.tabla ? { tabla: b.tabla } : {}),
      ...(b.imagen ? { imagen: b.imagen } : {}),
    }));
  const d = ApartadoDatos.safeParse({ titulo, bloques: conTexto, cubre: [], compromisos: [], fuentes: [] });
  return d.success ? d.data : null;
}

// Lo que va antes del apartado 1 con estilo de título (p. ej. un «Resumen ejecutivo») no tiene
// sitio en la estructura del guion: se avisa de que no pasará a las versiones que se monten.
function anteriores(es: ElementoDocx[], primero: number | null): string[] {
  if (primero === null) return [];
  const t = es
    .slice(0, primero)
    .filter(
      (e): e is ParrafoDocx =>
        esParrafo(e) && e.titulo && Boolean(e.texto) && !/^([ií]ndice|contenido|tabla de contenido)/i.test(e.texto),
    );
  return t.length
    ? [
        `El Word tiene contenido antes del apartado 1 (${t
          .slice(0, 3)
          .map((x) => `«${x.texto}»`)
          .join(', ')}): está en el Word subido, pero no pasa a las versiones que monte la plataforma.`,
      ]
    : [];
}

// El cierre «En <lugar>, a <fecha>.» y su firma los pone la plataforma al montar cada versión
// si el pliego los pide: no son texto del último apartado (se repetirían).
const CIERRE = /^en\s.{1,120},\s+a\s+\d{1,2}\s+de\s+\p{L}+\s+de\s+\d{4}\.?$/iu;

function cierreTras(es: ElementoDocx[], desde: number | undefined): { i: number; texto: string } | null {
  if (desde === undefined) return null;
  const i = es.findIndex((e, x) => x > desde && esParrafo(e) && CIERRE.test(e.texto.trim()));
  const p = es[i];
  return esParrafo(p) ? { i, texto: p.texto.trim() } : null;
}

/** Los apartados del guion encontrados en el Word, con avisos de lo que no se encontró o quedó vacío. */
export function apartadosDeTexto(
  es: ElementoDocx[],
  titulos: string[],
  imagenes: Map<string, ImagenGuardada> = new Map(),
): ApartadosDeTexto {
  const pos = localizarTitulos(es, titulos);
  const avisos: string[] = anteriores(es, pos.find((x): x is number => x !== null) ?? null);
  const cierre = cierreTras(es, pos.filter((x): x is number => x !== null).at(-1));
  if (cierre)
    avisos.push(
      `El cierre «${cierre.texto}» y lo que le sigue no pasan a las versiones que monte la plataforma: ella pone el lugar, la fecha y la firma si el pliego los pide.`,
    );
  const datos = titulos.map((titulo, k) => {
    const desde = pos[k];
    if (desde === null || desde === undefined) {
      avisos.push(
        `No encuentro en el Word el apartado ${k + 1} («${titulo}»): queda sin texto y se rehará si pides cambios.`,
      );
      return null;
    }
    const hasta = pos.slice(k + 1).find((x): x is number => x !== null) ?? cierre?.i ?? es.length;
    const d = apartado(titulo, es.slice(desde + 1, hasta), imagenes);
    if (!d) avisos.push(`El apartado ${k + 1} («${titulo}») está vacío en el Word.`);
    return d;
  });
  return { datos, avisos };
}
