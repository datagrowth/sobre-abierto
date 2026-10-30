// Índice de la Biblioteca en SQLite: archivos, trozos de texto, búsqueda por palabras (FTS5) y vector de cada trozo.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { TrozoTexto } from './trozos.js';

export type BaseDatos = Database.Database;
export type TipoArchivo = 'note' | 'document';
export type EstadoArchivo = 'ok' | 'error' | 'scanned';

export type FilaArchivo = {
  path: string;
  kind: TipoArchivo;
  title: string;
  mtime_ms: number;
  size: number;
  pages: number | null;
  chunks: number;
  status: EstadoArchivo;
  error: string | null;
  // Notas: documentos de los que salen (frontmatter «fuente»), uno por línea.
  source: string | null;
};

export type AciertoTrozo = {
  id: number;
  path: string;
  page: number | null;
  text: string;
  title: string;
  kind: TipoArchivo;
};

// Lo escribe el hilo del indexador y el servidor lo lee a la vez (modo WAL).
const ESQUEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, mtime_ms INTEGER NOT NULL,
  size INTEGER NOT NULL, pages INTEGER, chunks INTEGER NOT NULL, status TEXT NOT NULL, error TEXT, source TEXT);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY, path TEXT NOT NULL, ord INTEGER NOT NULL, page INTEGER,
  title TEXT NOT NULL, text TEXT NOT NULL, vec BLOB);
CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
CREATE INDEX IF NOT EXISTS chunks_pending ON chunks(id) WHERE vec IS NULL;
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, title, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text, title) VALUES (new.id, new.text, new.title); END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text, title) VALUES ('delete', old.id, old.text, old.title); END;
`;

export function rutaArchivoIndice(directorio: string): string {
  return path.join(directorio, 'biblioteca.db');
}

/** Abre (y crea si hace falta) el índice. Solo el indexador lo abre para escribir. */
export function abrirIndice(directorio: string, readonly = false): BaseDatos {
  if (!readonly) fs.mkdirSync(directorio, { recursive: true });
  const db = new Database(rutaArchivoIndice(directorio), { readonly, fileMustExist: readonly });
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(ESQUEMA);
  }
  return db;
}

export function leerMeta(db: BaseDatos, clave: string): string | null {
  const fila = db.prepare('SELECT value FROM meta WHERE key = ?').get(clave) as { value: string } | undefined;
  return fila?.value ?? null;
}

export function guardarMeta(db: BaseDatos, clave: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    clave,
    value,
  );
}

/** Vacía el índice (otra bóveda u otro modelo de embeddings). */
export function reiniciarIndice(db: BaseDatos): void {
  db.exec("DELETE FROM chunks; DELETE FROM files; INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild');");
}

export function estadosArchivos(db: BaseDatos): Map<string, { mtime_ms: number; size: number }> {
  const filas = db.prepare('SELECT path, mtime_ms, size FROM files').all() as {
    path: string;
    mtime_ms: number;
    size: number;
  }[];
  return new Map(filas.map((r) => [r.path, { mtime_ms: r.mtime_ms, size: r.size }]));
}

/** Sustituye un archivo y sus trozos de una vez. */
export function reemplazarArchivo(db: BaseDatos, fila: Omit<FilaArchivo, 'chunks'>, trozos: TrozoTexto[]): void {
  const insertar = db.prepare('INSERT INTO chunks (path, ord, page, title, text) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE path = ?').run(fila.path);
    db.prepare(
      `INSERT OR REPLACE INTO files (path, kind, title, mtime_ms, size, pages, chunks, status, error, source)
      VALUES (@path, @kind, @title, @mtime_ms, @size, @pages, @chunks, @status, @error, @source)`,
    ).run({ ...fila, chunks: trozos.length });
    trozos.forEach((c, i) => insertar.run(fila.path, i, c.page, fila.title, c.text));
  })();
}

/**
 * Pasa a error, sin trozos, los PDF indexados como legibles cuyo texto guardado no lo es.
 * Conserva fecha y tamaño: no se releen hasta que el archivo cambie. Devuelve cuántos.
 */
export function marcarIlegibles(db: BaseDatos, ilegible: (pages: string[]) => boolean, error: string): number {
  const pdfs = db
    .prepare("SELECT path FROM files WHERE kind = 'document' AND status = 'ok' AND lower(path) LIKE '%.pdf'")
    .all() as { path: string }[];
  const textos = db.prepare('SELECT text FROM chunks WHERE path = ? ORDER BY ord');
  const malos = pdfs.filter((f) => ilegible((textos.all(f.path) as { text: string }[]).map((c) => c.text)));
  db.transaction(() => {
    for (const f of malos) {
      db.prepare('DELETE FROM chunks WHERE path = ?').run(f.path);
      db.prepare("UPDATE files SET status = 'error', error = ?, chunks = 0 WHERE path = ?").run(error, f.path);
    }
  })();
  return malos.length;
}

/**
 * Quita del índice los archivos en error con esas extensiones (p. ej. los .doc que no se
 * pudieron convertir): en el siguiente recorrido cuentan como nuevos y se releen. Devuelve cuántos.
 */
export function olvidarArchivos(db: BaseDatos, extensiones: Iterable<string>): number {
  const exts = [...extensiones].map((e) => e.toLowerCase());
  if (exts.length === 0) return 0;
  const condicion = exts.map(() => 'lower(path) LIKE ?').join(' OR ');
  return db.prepare(`DELETE FROM files WHERE status = 'error' AND (${condicion})`).run(...exts.map((e) => `%${e}`))
    .changes;
}

/** Olvida los PDF escaneados o con el texto codificado para que se relean (al aparecer el OCR). Devuelve cuántos. */
export function olvidarParaOcr(db: BaseDatos, errorIlegible: string): number {
  return db
    .prepare(
      "DELETE FROM files WHERE kind = 'document' AND lower(path) LIKE '%.pdf' AND (status = 'scanned' OR (status = 'error' AND error = ?))",
    )
    .run(errorIlegible).changes;
}

export function quitarArchivo(db: BaseDatos, rutaRelativa: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM chunks WHERE path = ?').run(rutaRelativa);
    db.prepare('DELETE FROM files WHERE path = ?').run(rutaRelativa);
  })();
}

export function trozosPendientes(db: BaseDatos, limite: number): { id: number; title: string; text: string }[] {
  return db.prepare('SELECT id, title, text FROM chunks WHERE vec IS NULL ORDER BY id LIMIT ?').all(limite) as {
    id: number;
    title: string;
    text: string;
  }[];
}

export function guardarVectores(db: BaseDatos, elementos: { id: number; vec: Int8Array }[]): void {
  const actualizar = db.prepare('UPDATE chunks SET vec = ? WHERE id = ?');
  db.transaction(() => {
    for (const { id, vec: vector } of elementos)
      actualizar.run(Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength), id);
  })();
}

export function* todosVectores(db: BaseDatos): Generator<{ id: number; vec: Int8Array }> {
  const filas = db.prepare('SELECT id, vec FROM chunks WHERE vec IS NOT NULL').iterate() as Iterable<{
    id: number;
    vec: Buffer;
  }>;
  for (const fila of filas)
    yield { id: fila.id, vec: new Int8Array(fila.vec.buffer, fila.vec.byteOffset, fila.vec.byteLength) };
}

const COLUMNAS_ACIERTO = 'c.id, c.path, c.page, c.text, c.title, f.kind';

/** Trozos que mejor casan con una consulta FTS5, del mejor al peor. */
export function buscarFts(db: BaseDatos, coincidencia: string, limite: number): AciertoTrozo[] {
  return db
    .prepare(
      `SELECT ${COLUMNAS_ACIERTO} FROM chunks_fts
    JOIN chunks c ON c.id = chunks_fts.rowid JOIN files f ON f.path = c.path
    WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts, 1.0, 4.0) LIMIT ?`,
    )
    .all(coincidencia, limite) as AciertoTrozo[];
}

const marcas = (n: number) => Array.from({ length: n }, () => '?').join(',');

/** Como buscarFts, pero solo dentro de unos archivos (p. ej. los pliegos de una licitación). */
export function buscarFtsEnRutas(
  db: BaseDatos,
  coincidencia: string,
  rutasPosibles: string[],
  limite: number,
): AciertoTrozo[] {
  if (rutasPosibles.length === 0) return [];
  return db
    .prepare(
      `SELECT ${COLUMNAS_ACIERTO} FROM chunks_fts
    JOIN chunks c ON c.id = chunks_fts.rowid JOIN files f ON f.path = c.path
    WHERE chunks_fts MATCH ? AND c.path IN (${marcas(rutasPosibles.length)}) ORDER BY bm25(chunks_fts, 1.0, 4.0) LIMIT ?`,
    )
    .all(coincidencia, ...rutasPosibles, limite) as AciertoTrozo[];
}

/** Todos los trozos de unos archivos, en orden de lectura. */
export function trozosDeRutas(db: BaseDatos, rutasPosibles: string[]): AciertoTrozo[] {
  if (rutasPosibles.length === 0) return [];
  return db
    .prepare(
      `SELECT ${COLUMNAS_ACIERTO} FROM chunks c JOIN files f ON f.path = c.path
    WHERE c.path IN (${marcas(rutasPosibles.length)}) ORDER BY c.path, c.ord`,
    )
    .all(...rutasPosibles) as AciertoTrozo[];
}

/** Trozos de un documento entre dos páginas (incluidas). */
export function trozosDeArchivoPorPagina(
  db: BaseDatos,
  rutaRelativa: string,
  desde: number,
  hasta: number,
): { page: number | null; text: string }[] {
  return db
    .prepare('SELECT page, text FROM chunks WHERE path = ? AND page BETWEEN ? AND ? ORDER BY ord')
    .all(rutaRelativa, desde, hasta) as { page: number | null; text: string }[];
}

export function trozosPorId(db: BaseDatos, ids: number[]): AciertoTrozo[] {
  if (ids.length === 0) return [];
  const marcasFts = ids.map(() => '?').join(',');
  return db
    .prepare(`SELECT ${COLUMNAS_ACIERTO} FROM chunks c JOIN files f ON f.path = c.path WHERE c.id IN (${marcasFts})`)
    .all(...ids) as AciertoTrozo[];
}

export function trozosDeArchivo(db: BaseDatos, rutaRelativa: string): { page: number | null; text: string }[] {
  return db.prepare('SELECT page, text FROM chunks WHERE path = ? ORDER BY ord').all(rutaRelativa) as {
    page: number | null;
    text: string;
  }[];
}

/** Los primeros trozos de un documento, en orden de lectura (su cabecera). */
export function trozosIniciales(
  db: BaseDatos,
  rutaRelativa: string,
  limite: number,
): { page: number | null; text: string }[] {
  return db.prepare('SELECT page, text FROM chunks WHERE path = ? ORDER BY ord LIMIT ?').all(rutaRelativa, limite) as {
    page: number | null;
    text: string;
  }[];
}

/** Los archivos de una carpeta y sus subcarpetas (prefijo de ruta sin «/» final). */
export function archivosBajo(db: BaseDatos, carpeta: string, kind: TipoArchivo): FilaArchivo[] {
  const prefijo = `${carpeta}/`;
  return db
    .prepare('SELECT * FROM files WHERE kind = ? AND substr(path, 1, ?) = ? ORDER BY path')
    .all(kind, prefijo.length, prefijo) as FilaArchivo[];
}

export function obtenerArchivo(db: BaseDatos, rutaRelativa: string): FilaArchivo | null {
  return (db.prepare('SELECT * FROM files WHERE path = ?').get(rutaRelativa) as FilaArchivo | undefined) ?? null;
}

export function listarArchivos(db: BaseDatos, kind: TipoArchivo): FilaArchivo[] {
  return db.prepare('SELECT * FROM files WHERE kind = ? ORDER BY path').all(kind) as FilaArchivo[];
}

export type EstadisticasIndice = {
  notes: number;
  documents: number;
  errors: number;
  scanned: number;
  chunks: number;
  embedded: number;
};

export function estadisticasIndice(db: BaseDatos): EstadisticasIndice {
  return db
    .prepare(
      `SELECT
    (SELECT COUNT(*) FROM files WHERE kind = 'note') AS notes,
    (SELECT COUNT(*) FROM files WHERE kind = 'document') AS documents,
    (SELECT COUNT(*) FROM files WHERE status = 'error') AS errors,
    (SELECT COUNT(*) FROM files WHERE status = 'scanned') AS scanned,
    (SELECT COUNT(*) FROM chunks) AS chunks,
    (SELECT COUNT(*) FROM chunks WHERE vec IS NOT NULL) AS embedded`,
    )
    .get() as EstadisticasIndice;
}
