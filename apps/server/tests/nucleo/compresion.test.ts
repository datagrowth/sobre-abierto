// La compresión de las respuestas no toca las peticiones con Range: un 206 comprimido no casaría
// con su Content-Range y el documento llegaría corrupto.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { comprimir } from '../../src/nucleo/http.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compresion-'));
const archivo = path.join(dir, 'nota.txt');
fs.writeFileSync(archivo, 'línea de una nota que se repite\n'.repeat(500));

const app = express();
app.use(comprimir());
app.get('/nota', (_req, res) => res.sendFile(archivo));
const server = escucharLocal(http.createServer(app));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// fetch descomprime solo y quita la cabecera: se pide con http para ver la respuesta tal cual.
function pedir(cabeceras: Record<string, string>): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = http.get(`${base}/nota`, { headers: cabeceras }, (res) => {
      res.resume();
      resolve(res);
    });
    req.on('error', reject);
  });
}

test('should_compress_a_whole_file_when_the_client_accepts_gzip', async () => {
  // Act
  const res = await pedir({ 'Accept-Encoding': 'gzip' });

  // Assert
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-encoding'], 'gzip');
});

test('should_not_compress_a_range_request', async () => {
  // Act
  const res = await pedir({ 'Accept-Encoding': 'gzip', Range: 'bytes=100-199' });

  // Assert
  assert.equal(res.statusCode, 206);
  assert.equal(res.headers['content-encoding'], undefined);
  assert.equal(res.headers['content-length'], '100');
});
