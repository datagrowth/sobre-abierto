// «Ver texto» de un apartado sobre la memoria de Villaejemplo del 14/10/2026
// (fixtures/comprobaciones/casoC.json, sintética): el texto de un apartado con su ronda y sus
// rechazos, y «no encontrado» fuera de rango.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';
import type { ApartadoTexto } from '../../src/dominios/licitaciones/oferta/apartadoTexto.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apartado-texto-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
const db = dbLicitaciones();
const casoC = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, casoC);
const v2 = casoC.memorias.find((m) => m.version === 2)!;
// El apartado 2 de la v2 (el de la fuga) va por la segunda ronda tras un rechazo del revisor.
db.prepare('UPDATE memoria_apartados SET ronda = 2, rechazos = 1 WHERE memoria_id = ? AND apartado = 2').run(v2.id);

let server: http.Server;
let base = '';
before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const url = (version: number, n: number | string) =>
  `${base}/api/licitaciones/licitaciones/${casoC.id}/oferta/memoria/${version}/apartados/${n}`;

test('should_return_the_text_of_one_section_with_its_round', async () => {
  // Arrange
  const esperado = v2.apartados.find((a) => a.apartado === 2)!;

  // Act
  const r = await fetch(url(2, 2));
  const a = (await r.json()) as ApartadoTexto;

  // Assert
  assert.equal(r.status, 200);
  assert.equal(a.titulo, esperado.titulo);
  assert.equal(a.estado, 'recibido');
  assert.equal(a.ronda, 2);
  assert.equal(a.rechazos, 1);
  assert.ok(a.texto && a.texto.length > 1000, 'trae el texto redactado del apartado');
  assert.ok(!a.texto.includes('**'), 'sin las marcas de formato');
});

test('should_return_not_found_for_a_section_out_of_range', async () => {
  // Act
  const [fuera, version, cero] = await Promise.all([fetch(url(2, 4)), fetch(url(9, 1)), fetch(url(2, 0))]);

  // Assert
  assert.equal(fuera.status, 404);
  assert.equal(version.status, 404);
  assert.equal(cero.status, 400);
});
