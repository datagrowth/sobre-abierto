// La subida a la carpeta Empresa por la API: si guardar la fila lanza (SQLITE_BUSY con otra
// escritura en nucleo.db), la petición se responde con 500 y no se queda colgada.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carpeta-empresa-ruta-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { rutasPlataforma } = await import('../../src/nucleo/rutas.js');

iniciarNucleo();
let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/plataforma', rutasPlataforma());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/plataforma`;
});

after(() => {
  server.close();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function formulario(): FormData {
  const f = new FormData();
  f.append('datos', JSON.stringify({ tipo: 'tgss', nombre: 'Certificado TGSS' }));
  f.append('archivo', new Blob([Buffer.from('%PDF-1.7 certificado')], { type: 'application/pdf' }), 'tgss.pdf');
  return f;
}

test('should_answer_500_when_saving_the_company_document_row_throws', async (t) => {
  // Arrange: la base del núcleo bloqueada (frontera) solo al registrar la fila.
  const db = nucleo().db;
  const original = db.prepare.bind(db);
  t.mock.method(db, 'prepare', (sql: string) => {
    if (sql.includes('INSERT INTO empresa_documentos')) throw new Error('SQLITE_BUSY: database is locked');
    return original(sql);
  });

  // Act
  const r = await fetch(`${base}/empresa/documentos`, {
    method: 'POST',
    body: formulario(),
    signal: AbortSignal.timeout(5000),
  });

  // Assert
  t.mock.restoreAll();
  assert.equal(r.status, 500);
  assert.deepEqual(await r.json(), { error: 'internal_error' });
});

test('should_answer_201_when_the_company_document_is_saved', async () => {
  // Act
  const r = await fetch(`${base}/empresa/documentos`, {
    method: 'POST',
    body: formulario(),
    signal: AbortSignal.timeout(5000),
  });

  // Assert
  assert.equal(r.status, 201);
  assert.match(((await r.json()) as { ruta: string }).ruta, /^Empresa\/tgss\/tgss(-\d+)?\.pdf$/);
});
