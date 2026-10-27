// Despliegue simulado: la pestaña abierta con la web A debe enterarse de que el servidor ya
// sirve la web B y sus escrituras deben rechazarse con 409.
// Se arranca el servidor real con datos temporales: nunca toca producción ni datos locales.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { build } from 'vite';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.resolve(WEB_DIR, '..', 'server');
// Misma forma que lee el servidor (nucleo/versionWeb.ts): el bundle de entrada en /assets/.
const ENTRADA = /(<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["'][^"']*\/assets\/)([^"']+\.js)(["'])/i;

function puertoLibre() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Copia del build A con el bundle de entrada renombrado: para el servidor es otra versión. */
function crearBuildB(dirA, dirB) {
  fs.cpSync(dirA, dirB, { recursive: true });
  const html = fs.readFileSync(path.join(dirB, 'index.html'), 'utf8');
  const bundleA = ENTRADA.exec(html)?.[2];
  if (!bundleA) throw new Error('el build no tiene bundle de entrada en /assets/');
  const bundleB = bundleA.replace(/\.js$/, '-nuevo.js');
  fs.copyFileSync(path.join(dirB, 'assets', bundleA), path.join(dirB, 'assets', bundleB));
  fs.writeFileSync(path.join(dirB, 'index.html'), html.replace(ENTRADA, `$1${bundleB}$3`));
  return { bundleA, bundleB };
}

/** Entorno aislado: sin login, sin ingesta y con todos los datos en el directorio temporal. */
function entorno(tmp, distDir, puerto) {
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

/** Node con el loader de tsx en un solo proceso: matarlo libera el puerto (tsx cli deja un hijo). */
async function arrancarServidor(tmp, distDir, puerto) {
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

async function pararServidor(proceso) {
  if (!proceso || proceso.exitCode !== null) return;
  const salida = once(proceso, 'exit');
  proceso.kill();
  await salida;
}

let tmp;
let servidor;

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-version-'));
  await build({ root: WEB_DIR, logLevel: 'error', build: { outDir: path.join(tmp, 'web-a'), emptyOutDir: true } });
});

test.afterAll(async () => {
  await pararServidor(servidor);
  // Windows tarda en soltar los ficheros de SQLite del proceso recién parado.
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('should_show_new_version_notice_and_reject_old_writes_after_redeploy', async ({ page }) => {
  const { bundleA } = crearBuildB(path.join(tmp, 'web-a'), path.join(tmp, 'web-b'));
  const puerto = await puertoLibre();
  servidor = await arrancarServidor(tmp, path.join(tmp, 'web-a'), puerto);
  await page.goto(`http://127.0.0.1:${puerto}/`);
  await expect(page.getByTestId('aviso-version')).toHaveCount(0);

  await pararServidor(servidor);
  servidor = await arrancarServidor(tmp, path.join(tmp, 'web-b'), puerto);

  // El socket se reconecta solo y recibe la versión nueva: no hace falta recargar.
  await expect(page.getByTestId('aviso-version')).toBeVisible({ timeout: 30_000 });
  const escritura = await page.evaluate(async (version) => {
    const res = await fetch('/api/licitaciones/e2e-version', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Web-Version': version },
      body: '{}',
    });
    return { status: res.status, body: await res.json() };
  }, bundleA);
  expect(escritura.status).toBe(409);
  expect(escritura.body.error).toBe('version_antigua');
});
