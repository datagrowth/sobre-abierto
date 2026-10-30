// Login del servidor: sesiones firmadas con un secreto propio, revocadas al cerrar sesión,
// límite de intentos por IP real y global, y el arranque que no deja producción abierta.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.MONITOR_BASIC_AUTH_USERNAME = 'paco';
process.env.MONITOR_BASIC_AUTH_PASSWORD = 'contraseña-de-prueba';
delete process.env.MONITOR_SESSION_SECRET;
delete process.env.MONITOR_PROXIES_DE_CONFIANZA;

const express = (await import('express')).default;
const auth = await import('../../src/nucleo/autenticacion.js');

let servidor: http.Server;
let base = '';

before(async () => {
  const app = express();
  app.use('/auth', auth.router);
  servidor = http.createServer(app);
  servidor.keepAliveTimeout = 0;
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
  servidor.close();
});

const login = (password: string, extra: Record<string, string> = {}) =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extra },
    body: JSON.stringify({ username: 'paco', password }),
  });
const sesion = async (cookie: string) =>
  (await (await fetch(`${base}/auth/session`, { headers: { cookie } })).json()) as { authenticated: boolean };
const cookieDe = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

test('should_issue_a_session_that_lasts_12_hours', async () => {
  const r = await login('contraseña-de-prueba');
  assert.equal(r.status, 204);
  assert.match(r.headers.get('set-cookie') ?? '', /Max-Age=43200/);
  assert.equal((await sesion(cookieDe(r))).authenticated, true);
});

test('should_revoke_the_session_on_logout', async () => {
  const cookie = cookieDe(await login('contraseña-de-prueba'));
  const otra = cookieDe(await login('contraseña-de-prueba'));
  assert.equal((await sesion(cookie)).authenticated, true);
  await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } });
  assert.equal((await sesion(cookie)).authenticated, false, 'la cookie cerrada ya no vale aunque no haya caducado');
  assert.equal((await sesion(otra)).authenticated, true, 'las demás sesiones siguen');
});

test('should_reject_a_token_signed_with_a_key_derived_from_the_credentials', async () => {
  const derivada = crypto.createHash('sha256').update('hermes-monitor\0paco\0contraseña-de-prueba').digest();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const firma = (cuerpo: string) => crypto.createHmac('sha256', derivada).update(cuerpo).digest('base64url');
  assert.equal((await sesion(`hermes_monitor_session=${exp}.${firma(String(exp))}`)).authenticated, false);
  assert.equal((await sesion(`hermes_monitor_session=${exp}.x.${firma(`${exp}.x`)}`)).authenticated, false);
});

test('should_take_the_socket_ip_unless_proxies_are_trusted_and_then_the_last_hop', () => {
  const req = {
    socket: { remoteAddress: '10.0.0.5' },
    headers: { 'x-forwarded-for': '6.6.6.6, 1.2.3.4' },
  } as unknown as http.IncomingMessage;
  assert.equal(auth.ipCliente(req, 0), '10.0.0.5');
  assert.equal(auth.ipCliente(req, 1), '1.2.3.4', 'lo que añadió Traefik, no lo que escribió el cliente');
  assert.equal(auth.ipCliente(req, 2), '6.6.6.6');
  assert.equal(auth.ipCliente(req, 5), '6.6.6.6');
  const sinCadena = { socket: { remoteAddress: '10.0.0.5' }, headers: {} } as unknown as http.IncomingMessage;
  assert.equal(auth.ipCliente(sinCadena, 1), '10.0.0.5');
});

const OPCIONES = {
  maxPorIp: 3,
  bloqueoIpMs: 1000,
  maxGlobal: 5,
  ventanaGlobalMs: 100,
  esperaGlobalMs: 50,
  esperaGlobalMaxMs: 150,
  tope: 4,
};

test('should_lock_an_ip_after_its_failures_and_unlock_it_when_the_lock_expires', () => {
  let ahora = 0;
  const l = auth.crearLimitador({ ...OPCIONES, maxGlobal: 1000 }, () => ahora);
  assert.equal(l.fallo('a'), null);
  assert.equal(l.fallo('a'), null);
  assert.equal(l.fallo('a'), 'ip');
  assert.equal(l.espera('a'), 1000);
  assert.equal(l.espera('b'), 0, 'otra IP no se bloquea');
  ahora = 1001;
  assert.equal(l.espera('a'), 0);
  assert.equal(l.fallo('a'), null, 'tras el bloqueo la cuenta empieza de cero');
});

test('should_slow_unknown_ips_after_too_many_failures_across_ips_with_a_growing_wait', () => {
  let ahora = 0;
  const l = auth.crearLimitador({ ...OPCIONES, tope: 1000 }, () => ahora);
  for (let i = 0; i < 4; i++) assert.equal(l.fallo(`ip${i}`), null);
  assert.equal(l.fallo('ip4'), 'global');
  assert.equal(l.espera('ip-nueva'), 50, 'el bloqueo global alcanza a todas las IP');
  ahora = 60;
  for (let i = 0; i < 5; i++) l.fallo(`otra${i}`);
  assert.equal(l.espera('ip-nueva'), 100, 'el siguiente bloqueo seguido espera el doble');
  ahora = 200;
  for (let i = 0; i < 5; i++) l.fallo(`mas${i}`);
  assert.equal(l.espera('ip-nueva'), 150, 'con tope');
});

test('should_not_slow_an_ip_that_logged_in_recently_when_the_global_limit_trips', () => {
  let ahora = 0;
  const l = auth.crearLimitador({ ...OPCIONES, tope: 1000 }, () => ahora);
  l.exito('empresa');
  for (let i = 0; i < 5; i++) l.fallo(`atacante${i}`);
  assert.equal(l.espera('desconocida'), 50);
  assert.equal(l.espera('empresa'), 0, 'quien entró hace poco no queda fuera');
  ahora = 25 * 3600_000;
  assert.ok(l.espera('empresa') >= 0);
});

test('should_lock_one_account_after_its_failures_from_several_ips_without_locking_others', () => {
  const l = auth.crearLimitador({ ...OPCIONES, maxPorIp: 100, maxPorCuenta: 3, maxGlobal: 1000 }, () => 0);
  assert.equal(l.fallo('a', 'Ana@x.es'), null);
  assert.equal(l.fallo('b', 'ana@x.es'), null);
  assert.equal(l.fallo('c', ' ANA@x.es'), 'cuenta', 'el límite es de la cuenta, sin importar la IP');
  assert.equal(l.espera('e', 'ana@x.es'), 1000);
  assert.equal(l.espera('e', 'luis@x.es'), 0, 'otra cuenta sigue entrando');
});

test('should_purge_expired_entries_and_cap_the_failures_map', () => {
  let ahora = 0;
  const l = auth.crearLimitador({ ...OPCIONES, maxGlobal: 1000 }, () => ahora);
  for (let i = 0; i < 10; i++) l.fallo(`ip${i}`);
  assert.equal(l.tamano(), 4, 'nunca pasa del tope');
  ahora = 5000;
  l.fallo('ultima');
  assert.equal(l.tamano(), 1, 'las caducadas se purgan');
});

test('should_refuse_to_start_in_production_without_login_unless_explicitly_off', () => {
  const prod = { NODE_ENV: 'production' };
  assert.equal(auth.validarAcceso(prod).error?.code, 'acceso_sin_login');
  assert.equal(
    auth.validarAcceso({ ...prod, MONITOR_BASIC_AUTH_USERNAME: 'a', MONITOR_BASIC_AUTH_PASSWORD: '' }).error?.code,
    'acceso_sin_login',
  );
  assert.equal(auth.validarAcceso({ ...prod, MONITOR_AUTH: 'off' }).data?.login, false);
  assert.equal(auth.validarAcceso({ NODE_ENV: 'development' }).error, null, 'en desarrollo sigue abierto');
  assert.equal(auth.validarAcceso({ MONITOR_AUTH: 'on' }).error?.code, 'acceso_sin_login');
});

test('should_require_its_own_session_secret_of_32_chars_in_production', () => {
  const prod = { NODE_ENV: 'production', MONITOR_BASIC_AUTH_USERNAME: 'a', MONITOR_BASIC_AUTH_PASSWORD: 'b' };
  assert.equal(auth.validarAcceso(prod).error?.code, 'acceso_sin_secreto');
  const corto = auth.validarAcceso({ ...prod, MONITOR_SESSION_SECRET: 'corto' });
  assert.equal(corto.error?.code, 'acceso_invalido');
  assert.doesNotMatch(corto.error?.message ?? '', /corto/, 'el error nombra la variable, no su valor');
  assert.equal(auth.validarAcceso({ ...prod, MONITOR_SESSION_SECRET: 's'.repeat(32) }).data?.login, true);
  assert.equal(
    auth.validarAcceso({ ...prod, MONITOR_SESSION_SECRET: 's'.repeat(32), MONITOR_PROXIES_DE_CONFIANZA: 'x' }).error
      ?.code,
    'acceso_invalido',
  );
});

test('should_say_in_estado_that_sessions_die_on_restart_without_an_own_secret', () => {
  const e = auth.estadoAcceso();
  assert.deepEqual([e.login, e.secreto], [true, 'aleatorio']);
  assert.equal(auth.huellaSecreto(), null);
});

// El último: deja bloqueada la IP de los tests.
test('should_lock_by_socket_ip_even_if_x_forwarded_for_changes_on_every_attempt', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await login('mala', { 'x-forwarded-for': `9.9.9.${i}` })).status, 401);
  }
  const r = await login('contraseña-de-prueba', { 'x-forwarded-for': '9.9.9.200' });
  assert.equal(r.status, 429, 'cambiar X-Forwarded-For no salta el bloqueo');
  assert.ok(Number(r.headers.get('retry-after')) > 0);
});
