// Subida de documentos desde la web a la Biblioteca: formatos admitidos, carpeta
// segura, sin pisar archivos y sin dejar temporales.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'subida-'));
const vault = path.join(tmp, 'conocimiento');
fs.mkdirSync(vault);
process.env.VAULT_PATH = vault;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { rutasSubida, carpetaSubida, nombreSubida } = await import('../../src/biblioteca/rutas/subida.js');

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use('/api/v1', rutasSubida);
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/upload`;
});

after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function subir(nombre: string, contenido: string, carpeta?: string): Promise<Response> {
  const form = new FormData();
  form.append('archivo', new Blob([contenido]), nombre);
  const q = carpeta === undefined ? '' : `?carpeta=${encodeURIComponent(carpeta)}`;
  return fetch(`${base}${q}`, { method: 'POST', body: form });
}

test('should_accept_only_safe_folders_and_readable_formats', () => {
  assert.equal(carpetaSubida('Licitaciones/2026').data, 'Licitaciones/2026');
  assert.equal(carpetaSubida(undefined).data, '');
  assert.equal(carpetaSubida('../fuera').error?.code, 'invalid_input');
  assert.equal(carpetaSubida('.oculta').error?.code, 'invalid_input');
  assert.equal(carpetaSubida('_Propuestas').error?.code, 'invalid_input');
  assert.equal(carpetaSubida('_Propuestas#').error?.code, 'invalid_input', 'se valida después de limpiar el nombre');
  assert.equal(carpetaSubida('Licitaciones/_propuestas').error?.code, 'invalid_input', 'sin distinguir mayúsculas');
  assert.equal(
    carpetaSubida('Licitaciones/#/2026').data,
    'Licitaciones/2026',
    'un tramo que queda vacío al limpiar no cuenta',
  );
  assert.equal(nombreSubida('C:\\Users\\x\\Pliego.pdf').data, 'Pliego.pdf');
  assert.equal(nombreSubida('script.exe').error?.code, 'invalid_input');
});

test('should_store_an_uploaded_document_in_the_chosen_folder', async () => {
  const r = await subir('Pliego técnico.pdf', '%PDF-1.4 hola', 'Licitaciones/2026');
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { ruta: 'Licitaciones/2026/Pliego técnico.pdf', bytes: 13 });
  assert.equal(
    fs.readFileSync(path.join(vault, 'Licitaciones', '2026', 'Pliego técnico.pdf'), 'utf8'),
    '%PDF-1.4 hola',
  );
});

test('should_never_overwrite_an_existing_file', async () => {
  const r = await subir('Pliego técnico.pdf', 'otra versión', 'Licitaciones/2026');
  assert.equal(((await r.json()) as { ruta: string }).ruta, 'Licitaciones/2026/Pliego técnico-1.pdf');
  assert.equal(
    fs.readFileSync(path.join(vault, 'Licitaciones', '2026', 'Pliego técnico.pdf'), 'utf8'),
    '%PDF-1.4 hola',
  );
});

test('should_reject_unsupported_empty_or_misplaced_uploads_without_leftovers', async () => {
  assert.equal((await subir('virus.exe', 'x')).status, 400);
  assert.equal((await subir('vacio.pdf', '')).status, 400);
  assert.equal((await subir('a.pdf', 'x', '../../fuera')).status, 400);
  assert.equal(
    (await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status,
    415,
  );
  const ocultos = fs
    .readdirSync(vault, { recursive: true })
    .map(String)
    .filter((f) => path.basename(f).startsWith('.subida-'));
  assert.deepEqual(ocultos, []);
});

const temporales = () =>
  fs
    .readdirSync(vault, { recursive: true })
    .map(String)
    .filter((f) => path.basename(f).startsWith('.subida-'));

async function hasta(cond: () => boolean, ms = 3000): Promise<boolean> {
  for (
    const fin = Date.now() + ms;
    Date.now() < fin;
    await new Promise((r) => {
      setTimeout(r, 20);
    })
  )
    if (cond()) return true;
  return cond();
}

const LIMITE = '----hermes-prueba';
const cabeceraArchivo = (nombre: string) =>
  `--${LIMITE}\r\nContent-Disposition: form-data; name="archivo"; filename="${nombre}"\r\nContent-Type: application/pdf\r\n\r\n`;

test('should_reject_a_truncated_multipart_without_leaving_the_temp_file', async () => {
  // Cuerpo HTTP completo pero sin el límite final: busboy lo da por mal formado a mitad del archivo.
  const r = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary=${LIMITE}` },
    body: `${cabeceraArchivo('cortado.pdf')}%PDF-1.4 a medias`,
  });
  assert.equal(r.status, 400);
  assert.equal(((await r.json()) as { error: string }).error, 'invalid_input');
  assert.ok(await hasta(() => temporales().length === 0), 'el temporal se borra');
  assert.equal(fs.existsSync(path.join(vault, 'cortado.pdf')), false);
});

test('should_remove_the_temp_file_when_the_client_aborts_the_upload', async () => {
  const { port } = server.address() as AddressInfo;
  const req = http.request({
    port,
    method: 'POST',
    path: '/api/v1/upload',
    headers: { 'content-type': `multipart/form-data; boundary=${LIMITE}`, 'content-length': 10_000_000 },
  });
  req.on('error', () => {
    /* el corte es lo que se prueba */
  });
  req.write(`${cabeceraArchivo('grande.pdf')}${'x'.repeat(64 * 1024)}`);
  assert.ok(await hasta(() => temporales().length === 1), 'el servidor empieza a escribir el temporal');
  req.destroy();
  assert.ok(await hasta(() => temporales().length === 0), 'al cortar, el temporal se borra');
});
