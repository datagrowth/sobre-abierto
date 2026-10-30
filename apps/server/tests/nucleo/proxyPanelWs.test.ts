// WebSocket del panel de Hermes (el chat de la Consola) contra un Hermes simulado con login:
// un WebSocket legítimo llega a Hermes, y si Hermes se recreó y la cookie guardada ya no
// vale, el servidor inicia sesión otra vez antes del upgrade en vez de dejar el chat en negro.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';

let valida = 'v1';
let logins = 0;
const cookiesEnUpgrade: string[] = [];
const origenesEnUpgrade: string[] = [];
const hermes = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/auth/password-login') {
    logins += 1;
    res
      .writeHead(200, {
        'set-cookie': `hermes_session=${valida}; Path=/; HttpOnly`,
        'content-type': 'application/json',
      })
      .end('{}');
    return;
  }
  const ok = req.headers.cookie === `hermes_session=${valida}`;
  res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' }).end(ok ? '{"sessions":[]}' : '{}');
});
hermes.on('upgrade', (req, socket: Duplex) => {
  cookiesEnUpgrade.push(String(req.headers.cookie));
  origenesEnUpgrade.push(String(req.headers.origin));
  if (req.headers.cookie !== `hermes_session=${valida}`) {
    socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return;
  }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n',
  );
  socket.end();
});
hermes.keepAliveTimeout = 0;
await new Promise<void>((r) => hermes.listen(0, '127.0.0.1', r));
process.env.HERMES_BASE_URL = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`;
process.env.HERMES_DASHBOARD_BASIC_AUTH_USERNAME = 'monitor';
process.env.HERMES_DASHBOARD_BASIC_AUTH_PASSWORD = 'clave-del-dashboard';

const proxy = await import('../../src/nucleo/hermes/proxyPanel.js');
const hermesClient = await import('../../src/nucleo/hermes/clienteHermes.js');

let monitor: http.Server;
let puerto = 0;

before(async () => {
  monitor = http.createServer((_req, res) => {
    res.writeHead(404).end();
  });
  monitor.on('upgrade', (req, socket, head) => {
    if (!proxy.handleUpgrade(req, socket, head)) socket.destroy();
  });
  monitor.keepAliveTimeout = 0;
  await new Promise<void>((r) => monitor.listen(0, '127.0.0.1', r));
  puerto = (monitor.address() as AddressInfo).port;
});

after(() => {
  monitor.close();
  hermes.close();
});

function abrirWs(): Promise<number> {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port: puerto,
      path: '/hermes-panel/api/pty',
      headers: {
        host: `127.0.0.1:${puerto}`,
        origin: `http://127.0.0.1:${puerto}`,
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
}

test('should_open_a_legitimate_panel_websocket_against_hermes', async () => {
  assert.equal(await abrirWs(), 101);
  assert.equal(cookiesEnUpgrade.at(-1), 'hermes_session=v1');
  assert.equal(
    origenesEnUpgrade.at(-1),
    process.env.HERMES_BASE_URL,
    'Hermes ve su propio origen, no el del navegador (origin_mismatch)',
  );
  assert.equal(logins, 1);
});

test('should_log_in_again_before_the_upgrade_when_hermes_was_recreated', async () => {
  valida = 'v2'; // Hermes se recreó: la cookie que guarda el servidor (v1) ya no vale.
  hermesClient.olvidarComprobacion();
  assert.equal(await abrirWs(), 101, 'el chat abre en vez de quedarse en negro');
  assert.equal(cookiesEnUpgrade.at(-1), 'hermes_session=v2');
  assert.equal(logins, 2);
});
