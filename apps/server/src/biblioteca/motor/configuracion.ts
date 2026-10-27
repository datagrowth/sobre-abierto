// Configuración de la Biblioteca: dónde está la bóveda, quién puede cambiarla y cómo se valida y se guarda.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { entorno } from '../entorno.js';
import { logger } from '../../nucleo/log.js';

const log = logger('biblioteca.config');

// La configuración guardada solo tiene ya la ruta de la bóveda. Versiones
// anteriores guardaban también un LLM (con su API key) y el refresco del grafo.
type ConfiguracionGuardada = {
  vault_path?: string | null;
};

const CLAVES_OBSOLETAS = ['llm_backend', 'llm_api_key', 'graph_auto_refresh'];

type ConfiguracionResuelta = {
  vault_path: string | null;
};

const ARCHIVO_CONFIGURACION = process.env.HERMES_VAULT_CONFIG_PATH
  ? path.resolve(process.env.HERMES_VAULT_CONFIG_PATH)
  : path.resolve(process.cwd(), 'hermes-vault.config.json');

let enCache: ConfiguracionResuelta | null = null;

function resolverRutaBiblioteca(crudo: string | null | undefined): string | null {
  if (!crudo || crudo.trim() === '') return null;
  return path.resolve(crudo);
}

function cargarDeDisco(): ConfiguracionGuardada {
  try {
    const crudo = fs.readFileSync(ARCHIVO_CONFIGURACION, 'utf8');
    const analizado = JSON.parse(crudo) as ConfiguracionGuardada;
    if (analizado && typeof analizado === 'object') return analizado;
  } catch {
    // archivo no existe o malformado — ignorar
  }
  return {};
}

/**
 * ¿La ruta de la bóveda la fija el servidor? Con VAULT_PATH (producción) o en modo
 * servidor, la web no la cambia ni comprueba rutas: cualquier sesión podría apuntarla a
 * «/» o al volumen de Hermes (SOUL.md, skills) y leer o escribir ahí lo que pueda el
 * proceso. Sin VAULT_PATH (desarrollo local) se elige en Ajustes.
 */
export function rutaBibliotecaFijada(): boolean {
  return entorno.HERMES_VAULT_MODE === 'server' || entorno.VAULT_PATH !== null;
}

function construirResuelta(): ConfiguracionResuelta {
  const guardada = resolverRutaBiblioteca(cargarDeDisco().vault_path ?? null);
  // Con VAULT_PATH manda siempre el despliegue: una ruta guardada antes desde la web (que
  // ya no se puede cambiar) no puede dejar la bóveda apuntando a otro sitio para siempre.
  if (entorno.VAULT_PATH) {
    if (guardada && guardada !== entorno.VAULT_PATH)
      log.warn('se ignora la ruta de la bóveda guardada en los ajustes: manda VAULT_PATH', {
        vault_path: entorno.VAULT_PATH,
      });
    return { vault_path: entorno.VAULT_PATH };
  }
  return { vault_path: guardada };
}

/**
 * Quita del archivo de configuración lo que ya no se usa, sobre todo la API key del
 * LLM que configuraba el antiguo chat: no debe quedarse un secreto olvidado en disco.
 * Devuelve si se quitó algo: false si no había nada o si no se pudo escribir (el fallo
 * queda en el log y la próxima arrancada lo vuelve a intentar).
 */
export function descartarAjustesObsoletos(): boolean {
  const crudo = cargarDeDisco() as Record<string, unknown>;
  if (!CLAVES_OBSOLETAS.some((k) => k in crudo)) return false;
  for (const k of CLAVES_OBSOLETAS) delete crudo[k];
  return escribirOBorrar(crudo);
}

function obtener(): ConfiguracionResuelta {
  if (enCache === null) enCache = construirResuelta();
  return enCache;
}

export function obtenerRutaBiblioteca(): string | null {
  return obtener().vault_path;
}

export function obtenerArchivoConfiguracion(): string {
  return ARCHIVO_CONFIGURACION;
}

export type ResultadoComprobacion = {
  ok: boolean;
  resolved_path: string;
  exists: boolean;
  is_directory: boolean;
  markdown_count: number;
  reason?: string;
};

export type EstadoRutaBiblioteca = ResultadoComprobacion & {
  configured: boolean;
};

export function obtenerEstadoRutaBiblioteca(): EstadoRutaBiblioteca {
  const actual = obtenerRutaBiblioteca();
  if (!actual) {
    return {
      configured: false,
      ok: false,
      resolved_path: '',
      exists: false,
      is_directory: false,
      markdown_count: 0,
      reason: 'Ruta de bóveda no configurada.',
    };
  }
  return { configured: true, ...comprobarRutaBiblioteca(actual) };
}

export function comprobarRutaBiblioteca(rutaCruda: string): ResultadoComprobacion {
  const recortado = rutaCruda.trim();
  if (!recortado) {
    return {
      ok: false,
      resolved_path: '',
      exists: false,
      is_directory: false,
      markdown_count: 0,
      reason: 'Ruta vacía.',
    };
  }
  const resolved = path.resolve(recortado);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return {
      ok: false,
      resolved_path: resolved,
      exists: false,
      is_directory: false,
      markdown_count: 0,
      reason: 'La ruta no existe.',
    };
  }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      resolved_path: resolved,
      exists: true,
      is_directory: false,
      markdown_count: 0,
      reason: 'La ruta existe pero no es una carpeta.',
    };
  }

  let cuentaMarkdown = 0;
  try {
    const entradas = fs.readdirSync(resolved, { withFileTypes: true });
    cuentaMarkdown = entradas.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md')).length;
  } catch (err) {
    return {
      ok: false,
      resolved_path: resolved,
      exists: true,
      is_directory: true,
      markdown_count: 0,
      reason: `No se puede leer la carpeta: ${(err as Error).message}`,
    };
  }

  return { ok: true, resolved_path: resolved, exists: true, is_directory: true, markdown_count: cuentaMarkdown };
}

export class ErrorConfiguracion extends Error {
  constructor(
    mensaje: string,
    public readonly code: 'read_only_mode' | 'invalid_path' | 'io_error',
  ) {
    super(mensaje);
    this.name = 'ErrorConfiguracion';
  }
}

function escribirFusionada(cambios: ConfiguracionGuardada): void {
  const actual = cargarDeDisco();
  const fusionada: ConfiguracionGuardada = { ...actual, ...cambios };
  try {
    fs.writeFileSync(ARCHIVO_CONFIGURACION, JSON.stringify(fusionada, null, 2) + '\n', 'utf8');
  } catch (err) {
    throw new ErrorConfiguracion(`No se pudo escribir la configuración: ${(err as Error).message}`, 'io_error');
  }
  enCache = null;
}

export function fijarRutaBiblioteca(rutaCruda: string): { vault_path: string } {
  if (entorno.HERMES_VAULT_MODE === 'server') {
    throw new ErrorConfiguracion(
      'En modo servidor la ruta de la bóveda la configura el admin (variable de entorno + volumen). No se puede cambiar desde la UI.',
      'read_only_mode',
    );
  }
  const check = comprobarRutaBiblioteca(rutaCruda);
  if (!check.ok) {
    throw new ErrorConfiguracion(check.reason ?? 'Ruta no válida.', 'invalid_path');
  }
  escribirFusionada({ vault_path: check.resolved_path });
  return { vault_path: check.resolved_path };
}

/** Ruta sugerida para "crear carpeta de notas" — vacía y findable, sin datos personales. */
export function obtenerRutaSugerida(): string {
  const documentos = path.join(os.homedir(), 'Documents');
  const base = fs.existsSync(documentos) ? documentos : os.homedir();
  return path.join(base, 'Biblioteca de Conocimiento');
}

/** Crea la carpeta (si no existe) y la deja configurada como bóveda. Opt-in desde Ajustes. */
export function crearRutaBiblioteca(rutaCruda: string): { vault_path: string; created: boolean } {
  if (entorno.HERMES_VAULT_MODE === 'server') {
    throw new ErrorConfiguracion(
      'En modo servidor la ruta de la bóveda la configura el admin (no se crea desde la UI).',
      'read_only_mode',
    );
  }
  const recortado = (rutaCruda ?? '').trim();
  if (!recortado) {
    throw new ErrorConfiguracion('Ruta vacía.', 'invalid_path');
  }
  const resolved = path.resolve(recortado);
  let creada = false;
  try {
    if (!fs.existsSync(resolved)) {
      fs.mkdirSync(resolved, { recursive: true });
      creada = true;
    } else if (!fs.statSync(resolved).isDirectory()) {
      throw new ErrorConfiguracion('Ya existe un archivo con esa ruta (no es una carpeta).', 'invalid_path');
    }
  } catch (err) {
    if (err instanceof ErrorConfiguracion) throw err;
    throw new ErrorConfiguracion(`No se pudo crear la carpeta: ${(err as Error).message}`, 'io_error');
  }
  // fijarRutaBiblioteca valida que sea una carpeta legible y la persiste.
  const resultado = fijarRutaBiblioteca(resolved);
  return { ...resultado, created: creada };
}

// Sin claves, el archivo sobra: se borra. Si no se puede, queda como estaba y el fallo va al
// log (solo el código: el archivo puede llevar un secreto). Devuelve si quedó escrito.
function escribirOBorrar(configuracion: Record<string, unknown>): boolean {
  enCache = null;
  try {
    if (Object.keys(configuracion).length === 0) fs.rmSync(ARCHIVO_CONFIGURACION, { force: true });
    else fs.writeFileSync(ARCHIVO_CONFIGURACION, JSON.stringify(configuracion, null, 2) + '\n', 'utf8');
    return true;
  } catch (err) {
    log.error('no se pudo actualizar la configuración de la Biblioteca', {
      codigo: (err as NodeJS.ErrnoException).code ?? 'desconocido',
    });
    return false;
  }
}

export function restablecerRutaBiblioteca(): void {
  const actual = cargarDeDisco();
  delete actual.vault_path;
  escribirOBorrar(actual);
}
