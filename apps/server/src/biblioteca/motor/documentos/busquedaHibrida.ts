// Búsqueda de la Biblioteca: une la de notas (título, ruta, frontmatter), la de texto (FTS5)
// y la de significado (embeddings).
import { buscarNotas as searchNotes, type ResultadoBusqueda } from '../busqueda.js';
import { tokenizar } from '../texto.js';
import { CARPETA_GDOCS } from '../carpetas.js';
import * as store from './almacen.js';
import { abrirIndiceLectura, busquedaSemantica } from './servicioIndice.js';

export type Pasaje = { page: number | null; text: string };

export type ResultadoBiblioteca = Omit<ResultadoBusqueda, 'matched_in'> & {
  kind: store.TipoArchivo;
  matched_in: (ResultadoBusqueda['matched_in'][number] | 'semantic')[];
  // Fragmentos del texto que mejor casan (sobre todo en documentos largos).
  passages: Pasaje[];
};

// Fusión por rango recíproco.
// Constante estándar de RRF: suaviza la diferencia entre los primeros puestos.
const RRF_K = 60;
const CANDIDATOS = 80;
const PASAJES_POR_ARCHIVO = 3;
const CARACTERES_FRAGMENTO = 220;
// e5 da similitudes altas incluso a textos sin relación (≈0,78–0,81, frente a
// ≈0,83–0,88 de lo relevante): por debajo de esto, o lejos del mejor, un trozo no
// cuenta como parecido.
const SIMILITUD_MINIMA = 0.8;
const SALTO_MAXIMO = 0.04;
// Solo las palabras largas buscan también sus derivadas («licitación» →
// «licitaciones»); en las cortas el prefijo mete ruido («ver» → «verdes»).
const MIN_CARACTERES_PREFIJO = 5;

/** Consulta FTS5 a partir de texto libre: términos sin stopwords unidos por OR. */
export function consultaFts(consulta: string): string | null {
  const terminos = tokenizar(consulta);
  if (terminos.length === 0) return null;
  return terminos.map((t) => (t.length >= MIN_CARACTERES_PREFIJO ? `"${t}"*` : `"${t}"`)).join(' OR ');
}

function trozosPorPalabras(db: store.BaseDatos, consulta: string, reserva: number): store.AciertoTrozo[] {
  const coincidencia = consultaFts(consulta);
  if (!coincidencia) return [];
  try {
    return store.buscarFts(db, coincidencia, reserva);
  } catch {
    return []; // índice a medio crear
  }
}

// Con carpeta, el umbral relativo se calcula dentro de la carpeta: lo mejor de
// fuera no debe dejar sin resultados a lo que se busca dentro.
async function trozosPorSentido(
  db: store.BaseDatos,
  consulta: string,
  reserva: number,
  prefijo: string | null,
): Promise<store.AciertoTrozo[]> {
  const aciertos = await busquedaSemantica(consulta, reserva);
  const porId = new Map(
    store
      .trozosPorId(
        db,
        aciertos.map((h) => h.id),
      )
      .map((c) => [c.id, c]),
  );
  const enAlcance = aciertos.filter((h) => {
    const c = porId.get(h.id);
    return c && (!prefijo || bajoPrefijo(c.path, prefijo));
  });
  const best = enAlcance[0]?.score ?? 0;
  return enAlcance
    .filter((h) => h.score >= SIMILITUD_MINIMA && h.score >= best - SALTO_MAXIMO)
    .map((h) => porId.get(h.id))
    .filter((c): c is store.AciertoTrozo => Boolean(c));
}

type Acumulado = {
  hit: ResultadoBiblioteca;
  score: number;
  chunks: Map<number, { chunk: store.AciertoTrozo; score: number }>;
};

function acumuladoDe(
  archivos: Map<string, Acumulado>,
  ruta: string,
  titulo: string,
  kind: store.TipoArchivo,
): Acumulado {
  let acumulado = archivos.get(ruta);
  if (!acumulado) {
    acumulado = {
      hit: { path: ruta, title: titulo, kind, score: 0, snippet: '', matched_in: [], passages: [] },
      score: 0,
      chunks: new Map(),
    };
    archivos.set(ruta, acumulado);
  }
  return acumulado;
}

function anadirTrozos(
  archivos: Map<string, Acumulado>,
  trozos: store.AciertoTrozo[],
  rotulo: 'body' | 'semantic',
): void {
  trozos.forEach((trozo, posicionRanking) => {
    const acumulado = acumuladoDe(archivos, trozo.path, trozo.title, trozo.kind);
    const prev = acumulado.chunks.get(trozo.id);
    acumulado.chunks.set(trozo.id, { chunk: trozo, score: (prev?.score ?? 0) + 1 / (RRF_K + posicionRanking) });
    if (!acumulado.hit.matched_in.includes(rotulo)) acumulado.hit.matched_in.push(rotulo);
  });
}

function anadirNotas(archivos: Map<string, Acumulado>, notas: ResultadoBusqueda[]): void {
  notas.forEach((nota, posicionRanking) => {
    const acumulado = acumuladoDe(archivos, nota.path, nota.title, 'note');
    acumulado.score += 1 / (RRF_K + posicionRanking);
    acumulado.hit.snippet = nota.snippet;
    for (const m of nota.matched_in) if (!acumulado.hit.matched_in.includes(m)) acumulado.hit.matched_in.push(m);
  });
}

function enUnaLinea(texto: string): string {
  const plano = texto.replace(/\s+/g, ' ').trim();
  return plano.length > CARACTERES_FRAGMENTO ? `${plano.slice(0, CARACTERES_FRAGMENTO)}…` : plano;
}

// Puntuación del archivo: su mejor trozo cuenta entero y los demás, un poco.
function terminar(acumulado: Acumulado): ResultadoBiblioteca {
  const ordenados = [...acumulado.chunks.values()].sort((a, b) => b.score - a.score);
  const puntuacionTrozo = ordenados.reduce((suma, c, i) => suma + c.score * (i === 0 ? 1 : 0.25), 0);
  const pasajes = ordenados
    .slice(0, PASAJES_POR_ARCHIVO)
    .map(({ chunk: trozo }) => ({ page: trozo.page, text: trozo.text }));
  const primero = pasajes[0];
  const fragmento =
    acumulado.hit.snippet ||
    (primero ? `${primero.page ? `[pág. ${primero.page}] ` : ''}${enUnaLinea(primero.text)}` : acumulado.hit.path);
  return {
    ...acumulado.hit,
    score: Math.round((acumulado.score + puntuacionTrozo) * 10_000) / 10_000,
    snippet: fragmento,
    passages: pasajes,
  };
}

/** «Licitaciones/2026» → «Licitaciones/2026/»; vacío o inválido → sin filtro. */
function prefijoCarpeta(carpeta: string | undefined): string | null {
  const partesZip = (carpeta ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (partesZip.length === 0 || partesZip.some((p) => p === '..' || p.startsWith('.'))) return null;
  return `${partesZip.join('/')}/`;
}

/**
 * ¿Está `rutaRelativa` dentro de la carpeta `prefijo` (con barra final)? También su copia de los
 * Google Docs en .gdocs/<carpeta>/: un Doc de esa carpeta está en ella aunque se lea de allí.
 */
export function bajoPrefijo(rutaRelativa: string, prefijo: string): boolean {
  return rutaRelativa.startsWith(prefijo) || rutaRelativa.startsWith(`${CARPETA_GDOCS}/${prefijo}`);
}

/**
 * ¿Está `rutaRelativa` dentro de alguna de esas carpetas? Sin distinguir mayúsculas: en
 * Windows y en Drive «colaboradores» y «Colaboradores» son la misma carpeta.
 */
export function enCarpetas(rutaRelativa: string, carpetas: readonly string[]): boolean {
  const p = rutaRelativa.toLowerCase();
  return carpetas.some((f) => {
    const prefijo = prefijoCarpeta(f)?.toLowerCase();
    return prefijo !== undefined && bajoPrefijo(p, prefijo);
  });
}

/**
 * Notas y documentos que mejor responden a una consulta, del más al menos relevante.
 * Con `folder`, solo lo que está dentro de esa carpeta de la Biblioteca; con `exclude`,
 * nada de lo que está en esas otras (p. ej. los CV, para quien no puede verlos).
 */
export async function buscarEnBiblioteca(
  consultaCruda: string,
  limite = 20,
  carpeta?: string,
  excluidas: readonly string[] = [],
): Promise<ResultadoBiblioteca[]> {
  const consulta = consultaCruda.trim().slice(0, 500);
  const limiteSeguro = Number.isFinite(limite) && limite > 0 && limite <= 100 ? Math.floor(limite) : 20;
  if (consulta.length < 2) return [];
  const prefijo = prefijoCarpeta(carpeta);
  const reserva = prefijo ? CANDIDATOS * 5 : CANDIDATOS;
  const archivos = new Map<string, Acumulado>();
  anadirNotas(archivos, await searchNotes(consulta, reserva));
  const db = abrirIndiceLectura();
  if (db) {
    anadirTrozos(archivos, trozosPorPalabras(db, consulta, reserva), 'body');
    anadirTrozos(archivos, await trozosPorSentido(db, consulta, reserva, prefijo), 'semantic');
  }
  const enAlcance = [...archivos.values()].filter(
    (acumulado) => (!prefijo || bajoPrefijo(acumulado.hit.path, prefijo)) && !enCarpetas(acumulado.hit.path, excluidas),
  );
  return enAlcance
    .map(terminar)
    .sort((a, b) => b.score - a.score)
    .slice(0, limiteSeguro);
}
