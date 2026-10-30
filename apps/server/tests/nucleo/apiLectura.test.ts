// API de lectura para BI: un token por integración que se guarda como hash y sale
// una vez, «Authorization: Bearer» y nada más (ni cookie ni token en la URL), solo GET, paginada,
// revocable al momento y gestionada solo por un admin. Los recursos de Licitaciones van sin personas.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'api-lectura-'));
process.env.PLATAFORMA_DATA_DIR = tmp;
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const api = await import('../../src/nucleo/apiLectura.js');
const { rolNecesario } = await import('../../src/nucleo/permisos.js');
const { crearUsuario } = await import('../../src/nucleo/usuarios.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const lectura = await import('../../src/dominios/licitaciones/apiLectura.js');
const { estadoMcp } = await import('../../src/nucleo/mcp/estado.js');

iniciarNucleo();
const db = nucleo().db;
let server: http.Server;
let base = '';
before(() => {
  const app = express();
  app.use('/api/v1', api.rutasApiLectura());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

api.registrarLectura('numeros', 'Del 1 al 25', () => Array.from({ length: 25 }, (_, i) => ({ n: i + 1 })));
const pedir = (ruta: string, token?: string, init: RequestInit = {}) =>
  fetch(`${base}${ruta}`, {
    ...init,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });

test('should_store_only_the_hash_and_show_the_token_once', () => {
  // Act
  const r = api.crearToken(db, 'Paco Admin', { nombre: 'Power BI' });

  // Assert
  assert.match(r.data!.token, /^hrm_[A-Za-z0-9_-]{43}$/);
  const guardado = db.prepare('SELECT hash FROM api_tokens WHERE id = ?').get(r.data!.id) as { hash: string };
  assert.notEqual(guardado.hash, r.data!.token);
  assert.doesNotMatch(JSON.stringify(api.listarTokens(db)), /hrm_|hash/, 'la lista no lleva ni el token ni su hash');
  assert.equal(api.crearToken(db, 'Paco', { nombre: 'x' }).error?.code, 'invalid_input');
});

test('should_read_a_resource_page_by_page_with_a_bearer_token', async () => {
  // Arrange
  const { token } = api.crearToken(db, 'Paco Admin', { nombre: 'Hoja de cálculo' }).data!;

  // Act
  const primera = (await (await pedir('/api/v1/numeros?limite=10', token)).json()) as {
    datos: { n: number }[];
    total: number;
    siguiente: number | null;
  };
  const ultima = (await (await pedir('/api/v1/numeros?desde=20&limite=10', token)).json()) as {
    datos: { n: number }[];
    siguiente: number | null;
  };
  const indice = (await (await pedir('/api/v1', token)).json()) as { recursos: { nombre: string }[] };

  // Assert
  assert.deepEqual([primera.datos.length, primera.total, primera.siguiente], [10, 25, 10]);
  assert.deepEqual([ultima.datos.map((d) => d.n), ultima.siguiente], [[21, 22, 23, 24, 25], null]);
  assert.ok(indice.recursos.some((x) => x.nombre === 'numeros'));
  assert.ok(api.listarTokens(db).find((t) => t.nombre === 'Hoja de cálculo')?.ultimo_uso, 'anota el último uso');
});

test('should_deny_without_a_valid_token_in_the_header_and_anything_but_get', async () => {
  // Arrange
  const { id, token } = api.crearToken(db, 'Paco Admin', { nombre: 'Para revocar' }).data!;

  // Act
  const sin = await pedir('/api/v1/numeros');
  const enUrl = await pedir(`/api/v1/numeros?token=${token}`);
  const escribir = await pedir('/api/v1/numeros', token, { method: 'POST' });
  const otro = await pedir('/api/v1/inventado', token);
  api.revocarToken(db, id);
  const revocado = await pedir('/api/v1/numeros', token);

  // Assert
  assert.equal(sin.status, 401);
  assert.match(sin.headers.get('www-authenticate') ?? '', /^Bearer/);
  assert.equal(enUrl.status, 401, 'el token en la URL no vale: quedaría en los logs');
  assert.equal(escribir.status, 405);
  assert.equal(otro.status, 404);
  assert.equal(revocado.status, 401, 'revocado, deja de valer al momento');
  assert.equal(api.revocarToken(db, id).error?.code, 'not_found');
});

test('should_reject_a_page_size_over_the_limit', async () => {
  const { token } = api.crearToken(db, 'Paco Admin', { nombre: 'Límite' }).data!;
  assert.equal((await pedir(`/api/v1/numeros?limite=${api.MAX_LIMITE + 1}`, token)).status, 400);
});

test('should_let_only_an_admin_manage_tokens', () => {
  assert.equal(rolNecesario('GET', '/api/plataforma/integraciones/tokens'), 'admin');
  assert.equal(rolNecesario('DELETE', '/api/plataforma/integraciones/tokens/3'), 'admin');
});

test('should_give_bi_the_tenders_without_people_or_internal_notes', async () => {
  // Arrange: una oferta en preparación con responsable y una presentada con notas.
  const dbL = dbLicitaciones();
  const elisa = (
    await crearUsuario(db, {
      email: 'elisa@example.com',
      nombre: 'Elisa Editora',
      rol: 'editor',
      contrasena: 'temporal-de-doce',
    })
  ).data!;
  const l = licitacion({
    titulo: 'Servicio de formación en IA',
    publicada: '2026-10-01',
    limite: '2026-11-12T14:00:00',
    presupuesto: 40_000,
  });
  guardarLicitacion(dbL, l);
  dbL
    .prepare(
      "INSERT INTO oportunidades (licitacion_id, estado, responsable_id, creada_en, actualizada_en) VALUES (?, 'presentada', ?, 'x', 'x')",
    )
    .run(l.id, elisa.id);
  dbL
    .prepare(
      `INSERT INTO propuestas (licitacion_id, lote, presentada_en, importe_ofertado, presupuesto, baja_ofertada, documentos, resultado, notas, lecciones, creada_en, actualizada_en)
    VALUES (?, '', '2026-10-10', 36600, 40000, 0.085, '["Salidas/x.docx"]', 'ganada', 'nota interna de Elisa', 'lección interna', 'x', 'x')`,
    )
    .run(l.id);
  dbL
    .prepare(
      `INSERT INTO indices_segmento (clave, nivel_cpv, n, confianza, datos, actualizado_en) VALUES ('80|8053|50|abi|-', 4, 31, 'media', '{}', 'x')`,
    )
    .run();

  // Act
  const todo = JSON.stringify([
    lectura.filasPipeline(dbL),
    lectura.filasPresentadas(dbL),
    lectura.filasIndices(dbL),
    lectura.filasLecciones(dbL),
  ]);
  const [segmento] = lectura.filasIndices(dbL);

  // Assert
  assert.match(todo, /Servicio de formación en IA/);
  assert.doesNotMatch(todo, /Elisa|nota interna|lección interna|Salidas\//);
  assert.deepEqual(
    [segmento?.tipo_contrato, segmento?.cpv, segmento?.procedimiento, segmento?.organo_nif, segmento?.n],
    ['80', '8053', 'abierto', null, 31],
  );
  assert.equal(segmento?.importe_referencia, Math.round(1.25 ** 50));
});

test('should_count_the_mcp_calls_of_the_last_day_and_the_last_one', () => {
  // Arrange
  const ahora = Date.parse('2026-10-23T10:00:00Z');
  const llamada = db.prepare(
    "INSERT INTO auditoria_agentes (agente, herramienta, dominio, resultado, creado_en) VALUES ('hermes', 'licitaciones_ver', 'licitaciones', 'ok', ?)",
  );
  llamada.run('2026-10-21T10:00:00.000Z');
  llamada.run('2026-10-23T09:00:00.000Z');

  // Act
  const e = estadoMcp(db, ahora);

  // Assert
  assert.deepEqual([e.ultima_llamada, e.llamadas_24h, e.agentes], ['2026-10-23T09:00:00.000Z', 1, 0]);
});
