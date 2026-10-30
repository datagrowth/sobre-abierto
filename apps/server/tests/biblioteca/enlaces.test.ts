// La Biblioteca no sale de su carpeta por enlaces simbólicos ni uniones de Windows
// (Hermes comparte el volumen y tiene terminal: un `ln -s /drive-state/drive.json x.md`
// dejaría leer el token de Drive) ni se cuelga leyendo un FIFO.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-enlaces-'));
const vault = path.join(tmp, 'conocimiento');
const fuera = path.join(tmp, 'drive-state');
fs.mkdirSync(vault);
fs.mkdirSync(fuera);
process.env.VAULT_PATH = vault;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.NODE_ENV = 'test';

const SECRETO = 'refresh_token: 1//secreto-de-drive';
fs.writeFileSync(path.join(fuera, 'drive.md'), SECRETO);
fs.writeFileSync(path.join(fuera, 'drive.pdf'), SECRETO);
fs.writeFileSync(path.join(vault, 'normal.md'), '# Normal\n');

const { leerNota, leerNotaCruda, escribirNotaCruda, crearNota } = await import('../../src/biblioteca/motor/notas.js');
const { leerTexto } = await import('../../src/biblioteca/motor/documentos/lector.js');
const { escanearBiblioteca } = await import('../../src/biblioteca/motor/documentos/indexador.js');
const { comprobarRutaReal } = await import('../../src/biblioteca/motor/rutaReal.js');
const { crearAplicacionBiblioteca } = await import('../../src/biblioteca/aplicacion.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Una unión de Windows (en Linux, un enlace a carpeta): se puede crear sin permisos de admin.
const union = path.join(vault, 'enlace');
fs.symlinkSync(fuera, union, 'junction');

// Enlace a archivo: en Windows necesita permisos de admin o el modo desarrollador.
function enlaceArchivo(destino: string, enlace: string): boolean {
  try {
    fs.symlinkSync(destino, enlace, 'file');
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw err;
  }
}
const SIN_ENLACES = 'crear enlaces a archivos requiere permisos (EPERM en Windows); en Linux/CI se ejecuta';

async function rechaza(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

async function conServidor(fn: (base: string) => Promise<void>): Promise<void> {
  const server = escucharLocal(http.createServer(crearAplicacionBiblioteca()));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`);
  } finally {
    server.close();
  }
}

test('should_not_read_outside_the_vault_through_a_junction', async () => {
  assert.equal(await rechaza(() => leerTexto('enlace/drive.md')), true, 'biblioteca_leer siguió la unión');
  assert.equal(await rechaza(() => leerNota('enlace/drive.md')), true);
  assert.equal(await rechaza(() => leerNotaCruda('enlace/drive.md')), true);
  assert.equal((await leerTexto('normal.md')).texto, '# Normal\n');
});

test('should_not_serve_a_raw_file_outside_the_vault_through_a_junction', async () => {
  await conServidor(async (base) => {
    const r = await fetch(`${base}/files/raw?path=${encodeURIComponent('enlace/drive.pdf')}`);
    assert.notEqual(r.status, 200);
    assert.ok(!(await r.text()).includes('secreto-de-drive'));
  });
});

test('should_not_write_outside_the_vault_through_a_junction', async () => {
  assert.equal(await rechaza(() => escribirNotaCruda('enlace/nueva.md', 'x')), true);
  assert.equal(await rechaza(() => crearNota('enlace/otra.md', 'x')), true);
  assert.equal(
    await rechaza(() => escribirNotaCruda('enlace/sub/carpeta.md', 'x')),
    true,
    'tampoco creando carpetas debajo',
  );
  assert.equal(fs.existsSync(path.join(fuera, 'nueva.md')), false);
  assert.equal(fs.existsSync(path.join(fuera, 'otra.md')), false);
  assert.equal(fs.existsSync(path.join(fuera, 'sub')), false);
});

test('should_not_index_files_reached_through_links', async () => {
  const found = await escanearBiblioteca(vault);
  assert.ok(found.has('normal.md'));
  assert.ok(![...found.keys()].some((k) => k.startsWith('enlace/')));
});

test('should_reject_a_vault_root_that_is_itself_a_link', () => {
  assert.equal(comprobarRutaReal(union, path.join(union, 'drive.md')).error?.code, 'unsafe_path');
  assert.equal(comprobarRutaReal(vault, path.join(vault, 'normal.md')).error, null);
  assert.equal(comprobarRutaReal(vault, path.join(vault, 'no', 'existe.md')).error, null);
});

test('should_not_read_a_file_symlinked_outside_the_vault', async (t) => {
  if (!enlaceArchivo(path.join(fuera, 'drive.md'), path.join(vault, 'token.md'))) return t.skip(SIN_ENLACES);
  enlaceArchivo(path.join(fuera, 'drive.pdf'), path.join(vault, 'token.pdf'));
  assert.equal(await rechaza(() => leerTexto('token.md')), true, 'biblioteca_leer siguió el enlace');
  assert.equal(await rechaza(() => leerNota('token.md')), true);
  await conServidor(async (base) => {
    const r = await fetch(`${base}/files/raw?path=token.pdf`);
    assert.notEqual(r.status, 200);
    assert.ok(!(await r.text()).includes('secreto-de-drive'));
  });
});

test('should_not_follow_a_dangling_symlink_when_writing', async (t) => {
  const destino = path.join(fuera, 'creado-fuera.md');
  if (!enlaceArchivo(destino, path.join(vault, 'fantasma.md'))) return t.skip(SIN_ENLACES);
  assert.equal(await rechaza(() => escribirNotaCruda('fantasma.md', 'pisado')), true);
  assert.equal(fs.existsSync(destino), false);
});

test('should_not_hang_reading_a_fifo', { timeout: 5000 }, async (t) => {
  if (process.platform === 'win32') return t.skip('Windows no tiene FIFOs');
  execFileSync('mkfifo', [path.join(vault, 'cola.md')]);
  assert.equal(await rechaza(() => leerTexto('cola.md')), true);
  assert.equal(await rechaza(() => leerNota('cola.md')), true);
});

// Un .xml (el DEUC) se abre desde la búsqueda: como XML el navegador ejecutaría el XHTML que lleve dentro.
test('should_serve_an_xml_document_as_plain_text', async () => {
  fs.writeFileSync(
    path.join(vault, 'Deuc.xml'),
    '<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>',
  );
  await conServidor(async (base) => {
    const r = await fetch(`${base}/files/raw?path=Deuc.xml`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  });
});
