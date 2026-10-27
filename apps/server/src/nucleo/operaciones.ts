// Operaciones que se hacen una sola vez (p. ej. reorganizar carpetas de Drive): su marca
// vive en nucleo.db para que un reinicio no las repita y la web vea cómo acabaron.
import { ahora, type Db } from './db.js';

export type Operacion<T> = { clave: string; estado: string; datos: T; actualizada_en: string };

/** Marca de una operación, o null si nunca se empezó. `leer` valida lo guardado. */
export function leerOperacion<T>(db: Db, clave: string, leer: (raw: unknown) => T): Operacion<T> | null {
  const f = db.prepare('SELECT * FROM operaciones_unicas WHERE clave = ?').get(clave) as
    { clave: string; estado: string; datos: string; actualizada_en: string } | undefined;
  if (!f) return null;
  let raw: unknown = null;
  try {
    raw = JSON.parse(f.datos);
  } catch {
    raw = null;
  }
  return { ...f, datos: leer(raw) };
}

export function guardarOperacion(db: Db, clave: string, estado: string, datos: unknown): void {
  db.prepare(
    `INSERT INTO operaciones_unicas (clave, estado, datos, actualizada_en) VALUES (?, ?, ?, ?)
    ON CONFLICT(clave) DO UPDATE SET estado = excluded.estado, datos = excluded.datos, actualizada_en = excluded.actualizada_en`,
  ).run(clave, estado, JSON.stringify(datos), ahora());
}
