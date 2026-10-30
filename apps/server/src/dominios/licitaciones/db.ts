// Conexión del hilo principal a licitaciones.db (el hilo de ingesta abre la suya).
import { nucleo } from '../../nucleo/contexto.js';
import { abrirLicitaciones, type Db } from './store.js';

let actual: { dir: string; db: Db } | null = null;

export function dbLicitaciones(): Db {
  const dir = nucleo().config.dataDir;
  if (actual?.dir !== dir) {
    actual?.db.close();
    actual = { dir, db: abrirLicitaciones(dir) };
  }
  return actual.db;
}

export function cerrarDbLicitaciones(): void {
  actual?.db.close();
  actual = null;
}
