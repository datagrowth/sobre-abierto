// Mantiene el índice al día con la bóveda: lee lo nuevo o cambiado, quita lo borrado y calcula los vectores que faltan.
import fs from 'node:fs/promises';
import path from 'node:path';
import { CARPETAS_EXCLUIDAS, CARPETA_GDOCS } from '../carpetas.js';
import { frontmatterOVacio } from '../frontmatter.js';
import { leerArchivoRegular } from '../rutaReal.js';
import { trocearPaginas, type TrozoTexto } from './trozos.js';
import { CON_OCR, extraerDocumento, esDocumento } from './extraccion.js';
import { vectorizar } from './vectorizador.js';
import * as store from './almacen.js';

export type Hallazgos = { rel: string; abs: string; kind: store.TipoArchivo; mtime_ms: number; size: number };

async function recorrer(raiz: string, directorio: string, salida: Map<string, Hallazgos>): Promise<void> {
  let entradas;
  try {
    entradas = await fs.readdir(directorio, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entrada of entradas) {
    const absoluta = path.join(directorio, entrada.name);
    // Las entradas de readdir no siguen enlaces: un enlace simbólico (o una unión) no es
    // carpeta ni archivo y se ignora, para no indexar nada de fuera de la bóveda.
    if (entrada.isDirectory()) {
      const oculto = entrada.name.startsWith('.') && !(entrada.name === CARPETA_GDOCS && directorio === raiz);
      if (!oculto && !CARPETAS_EXCLUIDAS.has(entrada.name)) await recorrer(raiz, absoluta, salida);
      continue;
    }
    const esNota = entrada.name.toLowerCase().endsWith('.md');
    if (!entrada.isFile() || (!esNota && !esDocumento(entrada.name))) continue;
    const stat = await fs.lstat(absoluta).catch(() => null);
    if (!stat?.isFile()) continue;
    const relativa = path.relative(raiz, absoluta).split(path.sep).join('/');
    salida.set(relativa, {
      rel: relativa,
      abs: absoluta,
      kind: esNota ? 'note' : 'document',
      mtime_ms: Math.floor(stat.mtimeMs),
      size: stat.size,
    });
  }
}

// Corre en su propio hilo (worker.ts) para que un PDF de 300 páginas no frene el servidor.
/** Notas y documentos de la bóveda (sin propuestas, graphify ni carpetas ocultas salvo .gdocs). */
export async function escanearBiblioteca(raiz: string): Promise<Map<string, Hallazgos>> {
  const salida = new Map<string, Hallazgos>();
  await recorrer(raiz, raiz, salida);
  return salida;
}

function listaTexto(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function entradaNota(f: Hallazgos): Promise<{ row: Omit<store.FilaArchivo, 'chunks'>; chunks: TrozoTexto[] }> {
  // Entre el recorrido y la lectura el archivo pudo cambiarse por un enlace o un FIFO.
  const leido = await leerArchivoRegular(f.abs);
  if (leido.error) throw new Error(leido.error.message);
  const crudo = leido.data.contenido.toString('utf8');
  // Frontmatter mal formado o no admitido: se indexa el texto tal cual.
  const { data: fm, content: cuerpo } = frontmatterOVacio(crudo);
  const titulo =
    typeof fm['title'] === 'string' && fm['title'].trim()
      ? fm['title'].trim()
      : path.basename(f.rel, path.extname(f.rel));
  const fuente = [...listaTexto(fm['fuente']), ...listaTexto(fm['fuentes'])].join('\n') || null;
  const fila = {
    path: f.rel,
    kind: f.kind,
    title: titulo,
    mtime_ms: f.mtime_ms,
    size: f.size,
    pages: null,
    status: 'ok' as const,
    error: null,
    source: fuente,
  };
  return { row: fila, chunks: trocearPaginas([cuerpo], false) };
}

async function entradaDocumento(
  f: Hallazgos,
): Promise<{ row: Omit<store.FilaArchivo, 'chunks'>; chunks: TrozoTexto[] }> {
  const titulo = path.basename(f.rel, path.extname(f.rel));
  const base = { path: f.rel, kind: f.kind, title: titulo, mtime_ms: f.mtime_ms, size: f.size, source: null };
  const { data: datos, error } = await extraerDocumento(f.abs, CON_OCR);
  if (!datos) return { row: { ...base, pages: null, status: 'error', error }, chunks: [] };
  const estado = datos.scanned ? 'scanned' : 'ok';
  return {
    row: { ...base, pages: datos.paged ? datos.pages.length : null, status: estado, error: null },
    chunks: trocearPaginas(datos.pages, datos.paged),
  };
}

/** Lee un archivo y lo deja en el índice (con su error si no se pudo leer). */
export async function indexarHallazgos(db: store.BaseDatos, f: Hallazgos): Promise<void> {
  try {
    const { row: fila, chunks: trozos } = f.kind === 'note' ? await entradaNota(f) : await entradaDocumento(f);
    store.reemplazarArchivo(db, fila, trozos);
  } catch (err) {
    const titulo = path.basename(f.rel, path.extname(f.rel));
    const error = err instanceof Error ? err.message : String(err);
    store.reemplazarArchivo(
      db,
      {
        path: f.rel,
        kind: f.kind,
        title: titulo,
        mtime_ms: f.mtime_ms,
        size: f.size,
        pages: null,
        status: 'error',
        error,
        source: null,
      },
      [],
    );
  }
}

// Primero las notas y luego los documentos más recientes: lo último que llega es
// lo que antes se quiere encontrar.
function porPrioridad(a: Hallazgos, b: Hallazgos): number {
  if (a.kind !== b.kind) return a.kind === 'note' ? -1 : 1;
  return b.mtime_ms - a.mtime_ms;
}

export type ResultadoSincronizacion = { removed: string[]; changed: Hallazgos[] };

/** Qué hay que quitar y qué hay que (re)leer para que el índice refleje la bóveda. */
export function compararIndice(
  hallados: Map<string, Hallazgos>,
  conocidos: Map<string, { mtime_ms: number; size: number }>,
): ResultadoSincronizacion {
  const quitados = [...conocidos.keys()].filter((p) => !hallados.has(p));
  const cambiado = [...hallados.values()]
    .filter((f) => {
      const k = conocidos.get(f.rel);
      return !k || k.mtime_ms !== f.mtime_ms || k.size !== f.size;
    })
    .sort(porPrioridad);
  return { removed: quitados, changed: cambiado };
}

/** Vectores de los siguientes trozos pendientes. Devuelve cuántos calculó o el error del modelo. */
export async function vectorizarPendientes(
  db: store.BaseDatos,
  carpetaModelos: string,
  lote: number,
): Promise<{ done: { id: number; vec: Int8Array }[]; error: string | null }> {
  const pendientes = store.trozosPendientes(db, lote);
  if (pendientes.length === 0) return { done: [], error: null };
  const { data: datos, error } = await vectorizar(
    pendientes.map((c) => `${c.title}\n${c.text}`),
    'passage',
    carpetaModelos,
  );
  if (!datos) return { done: [], error };
  const done = pendientes.map((c, i) => ({ id: c.id, vec: datos[i]! }));
  store.guardarVectores(db, done);
  return { done, error: null };
}
