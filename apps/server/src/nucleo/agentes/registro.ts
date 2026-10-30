// Quién es cada agente: un token por agente.
import fs from 'node:fs';
import path from 'node:path';
import { safeEqual } from '../autenticacion.js';
import { leerAjustesPermisos, permisosDe, type Permisos } from './permisos.js';
import { logger } from '../log.js';

export type Agente = { nombre: string; permisos: Permisos };
type Entrada = Agente & { token: string };

// Fuentes, por orden:
//  1. <AGENTES_DIR>/<nombre>.token (los crea hermes-init para Hermes y cada perfil);
//  2. AGENTE_TOKEN_<NOMBRE> en el entorno (agentes de fuera, p. ej. Claude Code);
//  3. el token antiguo de la Biblioteca (BIBLIOTECA_TOKEN o .biblioteca-token) como «hermes».
const MIN_TOKEN = 24;
const NOMBRE = /^[a-z0-9][a-z0-9_-]{0,40}$/;
const RECARGA_MS = 10_000;
const log = logger('agentes');

let cache: { en: number; dir: string; entradas: Entrada[] } | null = null;

function leerToken(file: string): string | null {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    return t.length >= MIN_TOKEN ? t : null;
  } catch {
    return null;
  }
}

function desdeArchivos(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  let nombres: string[] = [];
  try {
    nombres = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const f of nombres) {
    const nombre = f.endsWith('.token') ? f.slice(0, -'.token'.length) : '';
    const token = NOMBRE.test(nombre) ? leerToken(path.join(dir, f)) : null;
    if (token) out.set(nombre, token);
  }
  return out;
}

function desdeEntorno(env: NodeJS.ProcessEnv): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith('AGENTE_TOKEN_') || !v || v.trim().length < MIN_TOKEN) continue;
    const nombre = k.slice('AGENTE_TOKEN_'.length).toLowerCase().replace(/_/g, '-');
    if (NOMBRE.test(nombre)) out.set(nombre, v.trim());
  }
  return out;
}

function tokenAntiguo(env: NodeJS.ProcessEnv): string | null {
  const directo = env.BIBLIOTECA_TOKEN?.trim();
  if (directo && directo.length >= MIN_TOKEN) return directo;
  const file =
    env.BIBLIOTECA_TOKEN_FILE ||
    path.join(env.HERMES_HOME || path.join(env.HOME || '', '.hermes'), '.biblioteca-token');
  return leerToken(file);
}

function cargar(dir: string, env: NodeJS.ProcessEnv): Entrada[] {
  const tokens = new Map([...desdeArchivos(dir), ...desdeEntorno(env)]);
  const antiguo = tokenAntiguo(env);
  if (antiguo && !tokens.has('hermes')) tokens.set('hermes', antiguo);
  const ajustes = leerAjustesPermisos(dir);
  if (ajustes.error) log.warn('permisos.json ignorado', { motivo: ajustes.error });
  if (ajustes.descartados.length)
    log.warn('permisos.json: dominios que no existen, ignorados', { dominios: ajustes.descartados.join(', ') });
  return [...tokens].map(([nombre, token]) => ({ nombre, token, permisos: permisosDe(nombre, ajustes.data) }));
}

export function agentesConocidos(dir: string, env: NodeJS.ProcessEnv = process.env): Agente[] {
  if (!cache || cache.dir !== dir || Date.now() - cache.en > RECARGA_MS) {
    cache = { en: Date.now(), dir, entradas: cargar(dir, env) };
  }
  return cache.entradas.map(({ nombre, permisos }) => ({ nombre, permisos }));
}

/** El agente dueño de un token, comparando en tiempo constante contra todos. */
export function agentePorToken(dir: string, token: string, env: NodeJS.ProcessEnv = process.env): Agente | null {
  agentesConocidos(dir, env);
  let encontrado: Agente | null = null;
  for (const e of cache?.entradas ?? []) {
    if (safeEqual(token, e.token) && !encontrado) encontrado = { nombre: e.nombre, permisos: e.permisos };
  }
  return encontrado;
}

export function olvidarAgentes(): void {
  cache = null;
}
