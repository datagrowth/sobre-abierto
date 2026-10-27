// Huella de las herramientas MCP por agente y listados de Hermes: la huella sale de la respuesta
// real de tools/list (en proceso), cambia solo si cambia lo que ve el agente, y un POST /mcp con
// tools/list (también en lote) anota la huella de lo servido; initialize y tools/call no.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'huellas-'));
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(agentes);
const TOKEN = 'h'.repeat(40);
fs.writeFileSync(path.join(agentes, 'oferta-licitaciones.token'), TOKEN);
const TOKEN_VACIO = 'v'.repeat(40);
fs.writeFileSync(path.join(agentes, 'vacio.token'), TOKEN_VACIO);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { z } = await import('zod');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas, listarHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { huellaDe, guardarHuella, anotarHuellas, desfaseDe, desfasados, esListado, anotarListado } =
  await import('../../src/nucleo/mcp/huellas.js');
const { ok, fail } = await import('../../src/nucleo/result.js');

iniciarNucleo();
let campos: Record<string, ReturnType<typeof z.string>> = { id: z.string() };
anadirHerramientas((server, ag) => {
  if (ag.nombre === 'vacio') return;
  server.registerTool('prueba_guion', { description: 'Guarda el guion', inputSchema: z.object(campos) }, async () => ({
    content: [{ type: 'text', text: 'ok' }],
  }));
});

let server: http.Server;
let base = '';
const db = () => nucleo().db;
const agente = { nombre: 'oferta-licitaciones', permisos: {} };

before(async () => {
  const app = express();
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

after(() => {
  server.close();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function rpc(body: unknown, token = TOKEN): Promise<number> {
  const res = await fetch(base, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify(body),
  });
  await res.text();
  return res.status;
}

// El listado se anota al terminar la respuesta: se espera a que se escriba.
async function listadoDe(nombre: string): Promise<{ listado_en: string; huella: string } | null> {
  for (let i = 0; i < 20; i++) {
    const f = db().prepare('SELECT listado_en, huella FROM mcp_listados WHERE agente = ?').get(nombre) as
      { listado_en: string; huella: string } | undefined;
    if (f) return f;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

const T = (h: number) => `2026-10-14T${String(h).padStart(2, '0')}:00:00.000Z`;

test('should_hash_the_same_tools_equally_whatever_the_order_of_tools_and_keys', () => {
  const a = huellaDe([
    { name: 'b', description: 'B', inputSchema: { type: 'object', properties: { x: { type: 'string' } } } },
    { name: 'a', inputSchema: {} },
  ]);
  const b = huellaDe([
    { inputSchema: {}, name: 'a' },
    { inputSchema: { properties: { x: { type: 'string' } }, type: 'object' }, description: 'B', name: 'b' },
  ]);
  assert.equal(a, b);
  assert.notEqual(
    huellaDe([{ name: 'a', inputSchema: { properties: { y: {} } } }]),
    huellaDe([{ name: 'a', inputSchema: { properties: { x: {} } } }]),
  );
});

test('should_fingerprint_the_real_tools_list_of_an_agent_in_process', async () => {
  const antes = await listarHerramientas(agente);
  assert.equal(antes.error, null);
  assert.ok(antes.data?.some((h) => (h as { name: string }).name === 'prueba_guion'));
  campos = { id: z.string(), ofertas_economicas: z.string() };
  const despues = await listarHerramientas(agente);
  assert.notEqual(
    huellaDe(despues.data ?? []),
    huellaDe(antes.data ?? []),
    'un campo nuevo en el esquema cambia la huella',
  );
  campos = { id: z.string() };
});

test('should_not_block_on_first_start_without_previous_fingerprint', () => {
  assert.equal(guardarHuella(db(), 'nuevo', 'h1', '2026-10-14T10:00:00.000Z'), 'nueva');
  assert.equal(desfaseDe(db(), 'nuevo'), null, 'sin huella previa no se sabe qué lista tiene Hermes');
});

test('should_not_block_when_fingerprint_is_identical_after_restart', () => {
  assert.equal(guardarHuella(db(), 'nuevo', 'h1', '2026-10-14T11:00:00.000Z'), 'igual');
  assert.equal(desfaseDe(db(), 'nuevo'), null);
});

test('should_mark_agent_stale_when_fingerprint_changes_until_a_later_listing', () => {
  guardarHuella(db(), 'cambia', 'h1', T(9));
  anotarListado(db(), 'cambia', 'h1', T(9));
  assert.equal(guardarHuella(db(), 'cambia', 'h2', T(10)), 'cambiada');
  assert.deepEqual(desfaseDe(db(), 'cambia'), { agente: 'cambia', desde: T(10), listado_en: T(9) });
  assert.deepEqual(
    desfasados(db(), ['cambia', 'nuevo']).map((d) => d.agente),
    ['cambia'],
  );
  assert.equal(guardarHuella(db(), 'cambia', 'h2', T(12)), 'igual', 'un reinicio con la misma huella no mueve «desde»');
  assert.ok(desfaseDe(db(), 'cambia'), 'sigue desfasado: Hermes aún no ha pedido la lista');
  anotarListado(db(), 'cambia', 'h2', T(13));
  assert.equal(desfaseDe(db(), 'cambia'), null);
});

test('should_mark_agent_stale_when_its_permissions_change_while_running', async () => {
  guardarHuella(db(), 'permisos', 'h1', T(8));
  const conProponer = async () => ok([{ name: 'x' }, { name: 'proponer' }]);
  assert.deepEqual(
    await anotarHuellas(db(), [{ nombre: 'permisos', permisos: {} }], conProponer, T(9)),
    ['permisos'],
    'la vuelta de cada minuto ve el permiso nuevo',
  );
  assert.ok(desfaseDe(db(), 'permisos'), 'Hermes sigue con la lista sin el permiso');
});

test('should_not_block_after_a_monitor_restart_when_hermes_already_listed_the_hot_permission_change', async () => {
  const lista = [{ name: 'x' }, { name: 'proponer' }];
  anotarListado(db(), 'permisos', huellaDe(lista), T(10));
  assert.equal(desfaseDe(db(), 'permisos'), null);
  await anotarHuellas(db(), [{ nombre: 'permisos', permisos: {} }], async () => ok(lista), T(20));
  assert.equal(desfaseDe(db(), 'permisos'), null, 'el arranque del día siguiente no lo da por desfasado');
});

test('should_unblock_on_rollback_to_the_list_hermes_already_has', () => {
  guardarHuella(db(), 'rollback', 'h1', T(8));
  anotarListado(db(), 'rollback', 'h1', T(9));
  guardarHuella(db(), 'rollback', 'h2', T(10));
  assert.ok(desfaseDe(db(), 'rollback'), 'despliegue sin reiniciar Hermes');
  guardarHuella(db(), 'rollback', 'h1', T(11));
  assert.equal(desfaseDe(db(), 'rollback'), null, 'tras el rollback Hermes tiene justo la lista de ahora');
});

test('should_keep_previous_fingerprint_when_the_list_cannot_be_computed', async () => {
  guardarHuella(db(), 'roto', 'h1', '2026-10-14T09:00:00.000Z');
  const cambiadas = await anotarHuellas(
    db(),
    [
      { nombre: 'roto', permisos: {} },
      { nombre: 'sano', permisos: {} },
    ],
    async (a) => (a.nombre === 'roto' ? fail('mcp_listado', 'caído') : ok([{ name: 'x' }])),
    '2026-10-14T10:00:00.000Z',
  );
  assert.deepEqual(cambiadas, []);
  assert.equal(desfaseDe(db(), 'roto'), null);
  assert.equal(
    (db().prepare('SELECT huella FROM mcp_huellas WHERE agente = ?').get('roto') as { huella: string }).huella,
    'h1',
  );
});

test('should_detect_listing_methods_in_single_messages_and_batches', () => {
  assert.equal(esListado({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), true);
  assert.equal(
    esListado({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    false,
    'reconectar no recarga la lista de Hermes',
  );
  assert.equal(esListado({ jsonrpc: '2.0', method: 'tools/list' }), false, 'sin id no es una petición');
  assert.equal(esListado([{ method: 'notifications/initialized' }, { method: 'tools/list', id: 2 }]), true);
  assert.equal(esListado({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } }), false);
  assert.equal(esListado(null), false);
  assert.equal(esListado([]), false);
});

test('should_not_count_tools_call_as_a_listing', async () => {
  const status = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'prueba_guion', arguments: { id: 'x' } },
  });
  assert.equal(status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(db().prepare('SELECT 1 FROM mcp_listados WHERE agente = ?').get('oferta-licitaciones'), undefined);
});

test('should_not_count_an_initialize_as_a_listing', async () => {
  const status = await rpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hermes', version: '1' } },
  });
  assert.equal(status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(db().prepare('SELECT 1 FROM mcp_listados WHERE agente = ?').get('oferta-licitaciones'), undefined);
});

test('should_not_count_a_tools_list_answered_with_a_json_rpc_error', async () => {
  assert.equal(await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, TOKEN_VACIO), 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(db().prepare('SELECT 1 FROM mcp_listados WHERE agente = ?').get('vacio'), undefined);
});

test('should_count_a_json_rpc_batch_with_tools_list_as_a_listing_with_the_served_fingerprint', async () => {
  const marca = new Date().toISOString();
  await rpc([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }]);
  const listado = await listadoDe('oferta-licitaciones');
  assert.ok(listado && listado.listado_en >= marca, 'el lote anota el listado del agente del token');
  assert.equal(listado?.huella, huellaDe((await listarHerramientas(agente)).data ?? []));
});
