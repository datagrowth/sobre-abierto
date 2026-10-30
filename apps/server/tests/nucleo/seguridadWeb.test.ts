// Defensas web del servidor montadas como en index.ts: mismo origen en lo que cambia estado
// (salvo los agentes con Bearer) y en los WebSockets de Socket.io, CORS y cabeceras.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Server } = await import('socket.io');
const web = await import('../../src/nucleo/seguridadWeb.js');

const HOST = 'plataforma.example.com';
let servidor: http.Server;
let puerto = 0;

before(async () => {
  const app = express();
  app.use(web.cabecerasSeguridad(['/hermes-panel']));
  app.use(web.exigirMismoOrigen(['https://otra-web.example.com']));
  app.get('/api/doc.pdf', (_req, res) => {
    res.type('application/pdf').send(Buffer.from('%PDF-1.4'));
  });
  app.all(
    ['/api/cosa', '/mcp', '/hermes-vault/agent/buscar', '/hermes-vault/notas', '/auth/login', '/hermes-panel/x'],
    (_req, res) => {
      res.json({ ok: true });
    },
  );
  servidor = http.createServer(app);
  const io = new Server(servidor);
  io.engine.use(web.mismoOrigenEnSocket([]));
  servidor.keepAliveTimeout = 0;
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  puerto = (servidor.address() as AddressInfo).port;
});

after(() => {
  servidor.close();
});

type Respuesta = { status: number; headers: http.IncomingHttpHeaders };

// http.request y no fetch: fetch no deja fijar Host ni Origin.
function pedir(metodo: string, ruta: string, cabeceras: Record<string, string> = {}): Promise<Respuesta> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers: { host: HOST, ...cabeceras } },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function abrirWebSocket(origen: string): Promise<number> {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: puerto,
      path: '/socket.io/?EIO=4&transport=websocket',
      headers: {
        host: HOST,
        origin: origen,
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': crypto.randomBytes(16).toString('base64'),
      },
    });
    req.on('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 0);
    });
    req.on('response', (res) => resolve(res.statusCode ?? 0));
    req.on('error', () => resolve(0));
    req.end();
  });
}

test('should_reject_with_403_a_post_from_another_subdomain', async () => {
  for (const ruta of ['/api/cosa', '/hermes-vault/notas', '/auth/login', '/hermes-panel/x']) {
    assert.equal((await pedir('POST', ruta, { origin: 'https://evil.example.com' })).status, 403, ruta);
  }
  assert.equal((await pedir('DELETE', '/api/cosa', { origin: 'null' })).status, 403);
});

test('should_let_through_a_post_from_its_own_origin_or_a_listed_one', async () => {
  assert.equal((await pedir('POST', '/api/cosa', { origin: `https://${HOST}` })).status, 200);
  assert.equal((await pedir('PUT', '/api/cosa', { origin: 'https://otra-web.example.com' })).status, 200);
});

test('should_fall_back_to_sec_fetch_site_only_when_origin_is_missing', async () => {
  assert.equal((await pedir('POST', '/api/cosa', { 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.equal((await pedir('POST', '/api/cosa', { 'sec-fetch-site': 'same-site' })).status, 403);
  assert.equal((await pedir('POST', '/api/cosa')).status, 403, 'sin ninguna de las dos se rechaza');
  assert.equal((await pedir('GET', '/api/cosa')).status, 200, 'leer no cambia estado');
});

test('should_not_check_the_origin_of_bearer_agent_routes', async () => {
  assert.equal((await pedir('POST', '/mcp', { origin: 'https://evil.example.com' })).status, 200);
  assert.equal((await pedir('POST', '/hermes-vault/agent/buscar')).status, 200);
});

test('should_reject_a_socket_io_websocket_from_another_origin', async () => {
  assert.notEqual(await abrirWebSocket('https://evil.example.com'), 101);
  assert.equal(await abrirWebSocket(`https://${HOST}`), 101);
});

test('should_reject_a_socket_io_polling_post_from_another_origin', async () => {
  const r = await pedir('POST', '/socket.io/?EIO=4&transport=polling&sid=x', { origin: 'https://evil.example.com' });
  assert.equal(r.status, 403);
});

test('should_send_security_headers_and_hsts_only_over_https', async () => {
  const r = await pedir('GET', '/api/cosa');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN');
  const csp = String(r.headers['content-security-policy']);
  for (const directiva of [
    "default-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ])
    assert.ok(csp.split('; ').includes(directiva), directiva);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe/);
  assert.equal(r.headers['strict-transport-security'], undefined);
  const https = await pedir('GET', '/api/cosa', { 'x-forwarded-proto': 'https' });
  assert.equal(https.headers['strict-transport-security'], 'max-age=15552000');
});

test('should_leave_only_frame_ancestors_in_the_csp_of_a_pdf_so_the_browser_viewer_works', async () => {
  const r = await pedir('GET', '/api/doc.pdf');
  assert.equal(r.headers['content-security-policy'], "frame-ancestors 'self'");
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
});

test('should_only_add_nosniff_and_frame_ancestors_on_the_hermes_panel', async () => {
  const r = await pedir('GET', '/hermes-panel/x');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['content-security-policy'], "frame-ancestors 'self'");
  assert.equal(r.headers['x-frame-options'], undefined);
  assert.equal(r.headers['referrer-policy'], undefined);
});

test('should_add_frame_ancestors_to_the_hermes_csp_without_replacing_it', () => {
  const conCsp: http.IncomingHttpHeaders = { 'content-security-policy': "default-src 'self'" };
  web.endurecerRespuestaDelPanel(conCsp);
  assert.equal(conCsp['content-security-policy'], "default-src 'self', frame-ancestors 'self'");
  assert.equal(conCsp['x-content-type-options'], 'nosniff');
  const propia: http.IncomingHttpHeaders = { 'content-security-policy': "frame-ancestors 'none'" };
  web.endurecerRespuestaDelPanel(propia);
  assert.equal(propia['content-security-policy'], "frame-ancestors 'none'");
});

test('should_read_frontend_url_as_a_list_of_origins_and_star_as_none', () => {
  assert.deepEqual(web.origenesPermitidos('*').data, []);
  assert.deepEqual(web.origenesPermitidos(undefined).data, []);
  assert.deepEqual(web.origenesPermitidos('https://a.example.com/, http://localhost:5173').data, [
    'https://a.example.com',
    'http://localhost:5173',
  ]);
  assert.equal(web.origenesPermitidos('javascript:alert(1)').error?.code, 'frontend_url_invalida');
});
