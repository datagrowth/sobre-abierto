// Acceso de solo lectura a las bases state.db de Hermes (la general y la de cada perfil) con better-sqlite3.
// Reutiliza una conexión por archivo, la reabre si Hermes rota la BD y las consultas devuelven siempre un array.
import Database from 'better-sqlite3';
import { stateDbPath } from './directorioHermes.js';
import { logger } from '../log.js';

const log = logger('base-estado-hermes');

export type Row = Record<string, unknown>;
type Param = string | number | null;

const conexiones = new Map<string, Database.Database>();

function db(ruta: string): Database.Database | null {
  const abierta = conexiones.get(ruta);
  if (abierta) return abierta;
  try {
    const nueva = new Database(ruta, { readonly: true, fileMustExist: true });
    nueva.pragma('busy_timeout = 3000');
    conexiones.set(ruta, nueva);
    return nueva;
  } catch {
    return null;
  }
}

function cerrar(ruta: string): void {
  try {
    conexiones.get(ruta)?.close();
  } catch {
    /* noop */
  }
  conexiones.delete(ruta);
}

function run(d: Database.Database, sql: string, params: Param[]): Row[] {
  return d.prepare(sql).all(...params) as Row[];
}

/** Consulta en la state.db de `ruta`. */
export function queryEn(ruta: string, sql: string, params: Param[] = []): Row[] {
  const d = db(ruta);
  if (!d) return [];
  try {
    return run(d, sql, params);
  } catch {
    // Conexión rota (p.ej. tras un checkpoint): cierra, reabre y reintenta una vez.
    cerrar(ruta);
    const d2 = db(ruta);
    if (!d2) return [];
    try {
      return run(d2, sql, params);
    } catch (e2) {
      const message = e2 instanceof Error ? e2.message : String(e2);
      if (!/no such table/i.test(message))
        log.error('error al consultar la base de estado de Hermes', { error: message.slice(0, 160) });
      return [];
    }
  }
}

/** Consulta en la state.db principal de Hermes. */
export function query(sql: string, params: Param[] = []): Row[] {
  return queryEn(stateDbPath, sql, params);
}
