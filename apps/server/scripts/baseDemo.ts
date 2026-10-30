// Base local nueva con las 5 ofertas de los fixtures de las comprobaciones (sintéticos), para probar la web local.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { errorMessage, fail, ok, type Result } from '../src/nucleo/result.js';
import { prepararEntorno } from './respuestasE2E.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
// Dentro de .plataforma/, que git ya ignora.
export const DESTINO_POR_DEFECTO = path.resolve(AQUI, '..', '.plataforma', 'demo');
// Rutas donde vive la base real: el script se niega a escribir en ellas.
const PROHIBIDOS: readonly string[] = ['/opt/data', '/data'];

export type BaseDemo = { dir: string; ofertas: string[]; entorno: Record<string, string> };

// La ruta de verdad: lo que ya existe pasa por realpath (un enlace no se salta la lista) y lo que
// falta se añade tal cual. Con barras y, en Windows, sin distinguir mayúsculas, para comparar.
function rutaReal(abs: string): string {
  const resto: string[] = [];
  let existente = abs;
  while (!fs.existsSync(existente) && path.dirname(existente) !== existente) {
    resto.unshift(path.basename(existente));
    existente = path.dirname(existente);
  }
  let real = abs;
  try {
    real = path.join(fs.realpathSync(existente), ...resto);
  } catch {
    /* sin permiso para leerla: vale la resuelta */
  }
  const barras = real.split(path.sep).join('/');
  return process.platform === 'win32' ? barras.toLowerCase() : barras;
}

const dentroDe = (ruta: string, base: string): boolean => ruta === base || ruta.startsWith(`${base}/`);

// Nunca toca producción: solo crea carpetas dentro del destino, que debe estar vacío o no existir.
/**
 * El destino debe ser una carpeta que no exista o esté vacía, y no una ruta de la base real. Se
 * compara la ruta resuelta, no el texto: «data/demo» desde /opt o «/opt/x/../data» acaban en /opt/data.
 */
export function validarDestino(destino: string): Result<string> {
  const abs = path.resolve(destino);
  const real = rutaReal(abs);
  if (PROHIBIDOS.some((p) => dentroDe(real, rutaReal(path.resolve(p))))) {
    return fail('destino_prohibido', `${abs} es una ruta de la base real: elige una carpeta local nueva.`);
  }
  if (fs.existsSync(abs) && (!fs.statSync(abs).isDirectory() || fs.readdirSync(abs).length > 0)) {
    return fail(
      'destino_ocupado',
      `${abs} ya existe y no está vacío: la base demo es siempre nueva (bórrala o elige otra ruta).`,
    );
  }
  return ok(abs);
}

// Fija ella misma las variables de entorno (no lee ningún .env).
const VARIABLES = [
  'PLATAFORMA_DATA_DIR',
  'AGENTES_DIR',
  'SALIDAS_DIR',
  'VAULT_PATH',
  'LICITACIONES_ACTIVO',
  'LIBREOFFICE_ACTIVO',
  'HERMES_VAULT_CONFIG_PATH',
  'BIBLIOTECA_INDEX_DIR',
  'HERMES_HOME',
  'HOME',
] as const;

// Las personas son del núcleo y comunes a todas las ofertas: se siembran las de cada una sin
// borrar las anteriores, con el perfil de la empresa sin certificados (la verdad de hoy).
async function sembrarOfertas(): Promise<string[]> {
  const nucleo = await import('../src/nucleo/contexto.js');
  const lic = await import('../src/dominios/licitaciones/db.js');
  const fx = await import('../tests/helpers/comprobacionesFixtures.js');
  nucleo.iniciarNucleo();
  try {
    for (const oferta of fx.OFERTAS_COMPROBACIONES) {
      const f = fx.leerFixtureComprobaciones(oferta);
      fx.sembrarFixture(lic.dbLicitaciones(), nucleo.nucleo().db, {
        ...f,
        perfil: f.perfil && { ...f.perfil, certificados: [] },
      });
    }
    return [...fx.OFERTAS_COMPROBACIONES];
  } finally {
    lic.cerrarDbLicitaciones();
    nucleo.cerrarNucleo();
  }
}

/** Crea la base demo en `destino` (nuevo o vacío) y devuelve el entorno con el que arrancar la web local. */
export async function crearBaseDemo(destino: string): Promise<Result<BaseDemo>> {
  const valido = validarDestino(destino);
  if (valido.error) return valido;
  try {
    fs.mkdirSync(valido.data, { recursive: true });
    prepararEntorno(valido.data);
    const ofertas = await sembrarOfertas();
    const entorno = Object.fromEntries(VARIABLES.map((v) => [v, process.env[v] ?? '']));
    return ok({ dir: valido.data, ofertas, entorno });
  } catch (e) {
    return fail('siembra', errorMessage(e));
  }
}

// Uso: npm run demo:base -w @sobre-abierto/server -- [destino]
async function main(): Promise<number> {
  const { logger } = await import('../src/nucleo/log.js');
  const log = logger('demo-base');
  const r = await crearBaseDemo(process.argv[2] ?? DESTINO_POR_DEFECTO);
  if (r.error) {
    log.error('no se creó la base demo', { codigo: r.error.code, motivo: r.error.message });
    return 1;
  }
  log.info('base demo creada', { dir: r.data.dir, ofertas: r.data.ofertas.join(',') });
  process.stdout.write(`${VARIABLES.map((v) => `${v}=${r.data.entorno[v]}`).join('\n')}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
