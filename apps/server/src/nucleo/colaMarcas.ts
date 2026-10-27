// Marcas de la cola de IA en nucleo.db: lo que antes vivía en memoria (la pausa por el límite de
// uso, las reactivaciones a mano) se olvidaba al reiniciar y la cola volvía a gastar runs.
import { ahora, type Db } from './db.js';

export const MARCA_PAUSA_LIMITE = 'pausa_limite_hasta';

/** Clave de la reactivación a mano de un tipo, o de un tipo para un recurso (el `id` del payload). */
export function claveReactivado(tipo: string, recurso?: string): string {
  return recurso === undefined ? `reactivado:${tipo}` : `reactivado:${tipo}:${recurso}`;
}

export function leerMarca(db: Db, clave: string): string | null {
  const f = db.prepare('SELECT valor FROM cola_marcas WHERE clave = ?').get(clave) as { valor: string } | undefined;
  return f?.valor ?? null;
}

export function ponerMarca(db: Db, clave: string, valor: string): void {
  db.prepare(
    `INSERT INTO cola_marcas (clave, valor, actualizada_en) VALUES (?, ?, ?)
    ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizada_en = excluded.actualizada_en`,
  ).run(clave, valor, ahora());
}

export function quitarMarca(db: Db, clave: string): void {
  db.prepare('DELETE FROM cola_marcas WHERE clave = ?').run(clave);
}
