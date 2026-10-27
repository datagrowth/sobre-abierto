// Proxy del Panel de Hermes contra un Hermes simulado (la frontera HTTP): quita el
// prefijo, avisa a Hermes de la subruta, no deja pasar cabeceras del proxy de fuera,
// se queda con las cookies de sesión y responde 502 si Hermes no está.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

type Vista = {
  url: string;
  prefijo: string | undefined;
  autorizacion: string | undefined;
  reenviado: string | undefined;
};
let vista: Vista | null = null;
let origenVisto: string | undefined;
const hermes = http.createServer((req, res) => {
  vista = {
    url: req.url ?? '',
    prefijo: req.headers['x-forwarded-prefix'] as string | undefined,
    autorizacion: req.headers.authorization,
    reenviado: req.headers['x-forwarded-for'] as string | undefined,
  };
  origenVisto = req.headers.origin;
  const csp = req.url?.startsWith('/con-csp') ? { 'content-security-policy': "default-src 'self'" } : {};
  res.writeHead(200, { 'content-type': 'text/plain', 'set-cookie': 'hermes_session=nueva; Path=/; HttpOnly', ...csp });
  res.end('panel');
});
hermes.keepAliveTimeout = 0;
await new Promise<void>((r) => hermes.listen(0, '127.0.0.1', r));
process.env.HERMES_BASE_URL = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`;

const express = (await import('express')).default;
const proxy = await import('../../src/nucleo/hermes/proxyPanel.js');
const hermesClient = await import('../../src/nucleo/hermes/clienteHermes.js');

let monitor: http.Server;
let base = '';

before(async () => {
  const app = express();
  app.use(proxy.middleware);
  app.use(proxy.assetsDelPanel);
  app.use((_req, res) => {
    res.status(404).send('no es del panel');
  });
  monitor = http.createServer(app);
  monitor.on('upgrade', (req, socket, head) => {
    if (!proxy.handleUpgrade(req, socket, head)) socket.destroy();
  });
  monitor.keepAliveTimeout = 0;
  await new Promise<void>((r) => monitor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(monitor.address() as AddressInfo).port}`;
});

after(() => {
  monitor.close();
  hermes.close();
});

test('should_forward_the_panel_without_its_prefix_and_keep_hermes_cookies_out_of_the_browser', async () => {
  const r = await fetch(`${base}/hermes-panel/api/estado?x=1`, {
    headers: { authorization: 'Basic secreto', 'x-forwarded-for': '1.2.3.4' },
  });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'panel');
  assert.deepEqual(vista, {
    url: '/api/estado?x=1',
    prefijo: '/hermes-panel',
    autorizacion: undefined,
    reenviado: undefined,
  });
  assert.equal(r.headers.get('set-cookie'), null, 'la cookie de Hermes no llega al navegador');
  assert.match(hermesClient.getSessionCookie(), /hermes_session=nueva/, 'se guarda en la sesión del monitor');
});

test('should_ask_hermes_for_the_lazy_chunks_it_requests_without_the_prefix', async () => {
  // El terminal del chat (xterm) se carga bajo demanda desde /assets/, sin /hermes-panel.
  const r = await fetch(`${base}/assets/xterm-CXxU4Y2B.js`);
  assert.equal(r.status, 200);
  assert.equal(vista?.url, '/assets/xterm-CXxU4Y2B.js');
  assert.equal((await fetch(`${base}/assets/x.js`, { method: 'POST' })).status, 404, 'solo GET');
  assert.equal((await fetch(`${base}/assets/%2e%2e%2fsecreto`)).status, 400, 'sin salir de /assets/');
  assert.equal((await fetch(`${base}/assets/..%2fsecreto`)).status, 400);
});

test('should_send_hermes_its_own_origin_once_the_monitor_checked_it', async () => {
  await fetch(`${base}/hermes-panel/api/config`, {
    method: 'POST',
    headers: { origin: 'https://hermes.example.com' },
    body: '{}',
  });
  assert.equal(origenVisto, process.env.HERMES_BASE_URL, 'Hermes rechaza un Origin que no es el suyo');
  await fetch(`${base}/hermes-panel/api/estado`);
  assert.equal(origenVisto, undefined, 'sin Origin no se inventa uno');
});

test('should_redirect_the_bare_prefix_and_leave_other_routes_alone', async () => {
  const r = await fetch(`${base}/hermes-panel`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/hermes-panel/');
  assert.equal((await fetch(`${base}/api/otra`)).status, 404);
});

test('should_add_nosniff_and_frame_ancestors_to_hermes_responses_without_replacing_its_csp', async () => {
  const r = await fetch(`${base}/hermes-panel/con-csp`);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('content-security-policy'), "default-src 'self', frame-ancestors 'self'");
  const sinCsp = await fetch(`${base}/hermes-panel/api/estado`);
  assert.equal(sinCsp.headers.get('content-security-policy'), "frame-ancestors 'self'");
});

test('should_reject_a_panel_websocket_from_another_origin', async () => {
  const { port } = monitor.address() as AddressInfo;
  const estado = await new Promise<number>((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/hermes-panel/api/pty',
      headers: {
        host: 'hermes.example.com',
        origin: 'https://evil.example.com',
        connection: 'Upgrade',
        upgrade: 'websocket',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', // gitleaks:allow (nonce de ejemplo de la RFC 6455)
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
  assert.equal(estado, 403);
});

test('should_answer_502_when_hermes_does_not_respond', async () => {
  await new Promise<void>((r) => hermes.close(() => r()));
  const r = await fetch(`${base}/hermes-panel/`);
  assert.equal(r.status, 502);
  assert.match(await r.text(), /no responde/);
});
