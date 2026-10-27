// Variables de entorno del motor de la Biblioteca (modo y ruta de la bóveda), leídas y validadas una sola vez.
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../nucleo/log.js';

const log = logger('biblioteca.entorno');

export type Entorno = {
  NODE_ENV: 'development' | 'production' | 'test';
  VAULT_PATH: string | null;
  HERMES_VAULT_MODE: 'local' | 'server';
};

function resolverRutaBiblioteca(crudo: string | undefined): string | null {
  if (!crudo || crudo.trim() === '') return null;
  const resolved = path.resolve(crudo);
  if (!fs.existsSync(resolved)) {
    log.warn('VAULT_PATH apunta a una ruta inexistente: los endpoints de bóveda fallarán hasta que sea válida', {
      ruta: resolved,
    });
  }
  return resolved;
}

const entornoNodeCrudo = process.env.NODE_ENV ?? 'development';
const entornoNode = (['development', 'production', 'test'] as const).includes(entornoNodeCrudo as never)
  ? (entornoNodeCrudo as Entorno['NODE_ENV'])
  : 'development';

const modoCrudo = (process.env.HERMES_VAULT_MODE ?? 'local').toLowerCase();
const modo: Entorno['HERMES_VAULT_MODE'] = modoCrudo === 'server' ? 'server' : 'local';

export const entorno: Entorno = {
  NODE_ENV: entornoNode,
  VAULT_PATH: resolverRutaBiblioteca(process.env.VAULT_PATH),
  HERMES_VAULT_MODE: modo,
};
