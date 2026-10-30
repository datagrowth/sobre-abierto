// Con la ruta de la bóveda fijada por el servidor (VAULT_PATH, como en producción),
// ninguna sesión web la cambia ni sondea rutas del servidor: podría apuntar la Biblioteca
// a «/» o al volumen de Hermes (SOUL.md, skills) y leer o escribir ahí.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-ajustes-'));
const vault = path.join(tmp, 'conocimiento');
const otra = path.join(tmp, 'hermes-home');
fs.mkdirSync(vault);
fs.mkdirSync(otra);
fs.writeFileSync(path.join(otra, 'SOUL.md'), '# Alma de Hermes');
const configFile = path.join(tmp, 'hermes-vault.config.json');
process.env.VAULT_PATH = vault;
process.env.HERMES_VAULT_CONFIG_PATH = configFile;
delete process.env.HERMES_VAULT_MODE;
process.env.NODE_ENV = 'test';

const { obtenerRutaBiblioteca, rutaBibliotecaFijada } = await import('../../src/biblioteca/motor/configuracion.js');
const { crearAplicacionBiblioteca } = await import('../../src/biblioteca/aplicacion.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function conServidor(fn: (base: string) => Promise<void>): Promise<void> {
  const server = escucharLocal(http.createServer(crearAplicacionBiblioteca()));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`);
  } finally {
    server.close();
  }
}

const json = { 'content-type': 'application/json' };

test('should_refuse_to_change_the_vault_from_the_web_when_vault_path_is_fixed', async () => {
  await conServidor(async (base) => {
    const cambio = await fetch(`${base}/settings/vault`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: otra }),
    });
    assert.equal(cambio.status, 403);
    const crear = await fetch(`${base}/settings/vault/create`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: path.join(tmp, 'nueva') }),
    });
    assert.equal(crear.status, 403);
    assert.equal((await fetch(`${base}/settings/vault`, { method: 'DELETE' })).status, 403);
    const ajustes = (await (await fetch(`${base}/settings`)).json()) as { editable: boolean; vault_path: string };
    assert.equal(ajustes.editable, false);
    assert.equal(ajustes.vault_path, vault);
  });
  assert.equal(rutaBibliotecaFijada(), true);
  assert.equal(obtenerRutaBiblioteca(), vault);
  assert.equal(fs.existsSync(path.join(tmp, 'nueva')), false);
  assert.equal(fs.existsSync(configFile), false, 'no se guardó ninguna ruta');
});

test('should_not_probe_server_paths_when_vault_path_is_fixed', async () => {
  await conServidor(async (base) => {
    const r = await fetch(`${base}/settings/check`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ path: otra }),
    });
    assert.equal(r.status, 403);
    assert.ok(!(await r.text()).includes('markdown_count'));
  });
});
