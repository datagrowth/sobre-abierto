// Servidor real (tsx src/index.ts) para los recorridos e2e: entorno aislado en un directorio
// temporal, sin login ni ingesta, y nunca contra producción ni datos locales.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SERVER_DIR = path.resolve(WEB_DIR, '..', 'server');

export function puertoLibre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Entorno aislado: sin login, sin ingesta y con todos los datos en el directorio temporal. */
export function entorno(tmp, distDir, puerto) {
  const dir = (nombre) => path.join(tmp, nombre);
  return {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    HOST: '127.0.0.1',
    APP_PORT: String(puerto),
    WEB_DIST_DIR: distDir,
    MONITOR_AUTH: 'off',
    MONITOR_BASIC_AUTH_USERNAME: '',
    MONITOR_BASIC_AUTH_PASSWORD: '',
    LICITACIONES_ACTIVO: '0',
    HERMES_BASE_URL: 'http://127.0.0.1:9',
    PLATAFORMA_DATA_DIR: dir('plataforma'),
    HERMES_HOME: dir('hermes'),
    VAULT_PATH: dir('boveda'),
    HERMES_VAULT_CONFIG_PATH: dir('hermes-vault.config.json'),
    BIBLIOTECA_INDEX_DIR: dir('indice'),
    BIBLIOTECA_MODELS_DIR: dir('modelos'),
    CONVERSIONES_DIR: dir('conversiones'),
    DRIVE_STATE_DIR: dir('drive'),
    SALIDAS_DIR: dir('salidas'),
    AGENTES_DIR: dir('agentes'),
  };
}

async function esperarSalud(url, proceso, salida) {
  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    if (proceso.exitCode !== null) throw new Error(`el servidor salió (${proceso.exitCode}):\n${salida.join('')}`);
    const res = await fetch(`${url}/healthz`).catch(() => null);
    if (res?.ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`el servidor no respondió a /healthz:\n${salida.join('')}`);
}

/** Ejecuta un script con el loader de tsx en el directorio del servidor (p. ej. para sembrar datos). */
export async function ejecutarConTsx(script, env) {
  const salida = [];
  const proceso = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd: SERVER_DIR,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proceso.stdout.on('data', (d) => salida.push(String(d)));
  proceso.stderr.on('data', (d) => salida.push(String(d)));
  const [codigo] = await once(proceso, 'exit');
  if (codigo !== 0) throw new Error(`${path.basename(script)} salió con ${codigo}:\n${salida.join('')}`);
}

/** Node con el loader de tsx en un solo proceso: matarlo libera el puerto (tsx cli deja un hijo). */
export async function arrancarServidor(tmp, distDir, puerto) {
  const salida = [];
  const proceso = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: SERVER_DIR,
    env: entorno(tmp, distDir, puerto),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proceso.stdout.on('data', (d) => salida.push(String(d)));
  proceso.stderr.on('data', (d) => salida.push(String(d)));
  await esperarSalud(`http://127.0.0.1:${puerto}`, proceso, salida);
  return proceso;
}

export async function pararServidor(proceso) {
  if (!proceso || proceso.exitCode !== null) return;
  const salida = once(proceso, 'exit');
  proceso.kill();
  await salida;
}
