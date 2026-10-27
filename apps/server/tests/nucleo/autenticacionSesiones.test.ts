// Sesiones del servidor que sobreviven a los despliegues: firmadas con el secreto propio, se
// renuevan solas mientras se usa el servidor (hasta un máximo desde el login), las de antes de los
// usuarios (sin persona) ya no valen y un cierre de sesión guardado en nucleo.db sigue cerrado al
// reiniciar. Sin usuarios en la base se entra con el acceso de emergencia (persona 0).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const SECRETO = 'secreto-de-prueba-de-las-sesiones-del-monitor-0123456789';
process.env.NODE_ENV = 'test';
process.env.MONITOR_BASIC_AUTH_USERNAME = 'paco';
process.env.MONITOR_BASIC_AUTH_PASSWORD = 'contraseña-de-prueba';
process.env.MONITOR_SESSION_SECRET = SECRETO;
delete process.env.MONITOR_PROXIES_DE_CONFIANZA;

const express = (await import('express')).default;
const auth = await import('../../src/nucleo/autenticacion.js');
const { abrirNucleo } = await import('../../src/nucleo/db.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sesiones-'));
let servidor: http.Server;
let base = '';
const relojReal = Date.now;
let desfaseMs = 0;
const abiertas: { close: () => void }[] = [];
const abrir = () => {
  const db = abrirNucleo(tmp);
  abiertas.push(db);
  return db;
};

before(async () => {
  Date.now = () => relojReal() + desfaseMs;
  const app = express();
  app.use('/auth', auth.router);
  app.use('/api', auth.middleware, auth.renovarSesion);
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });
  servidor = http.createServer(app);
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
  Date.now = relojReal;
  servidor.close();
  for (const db of abiertas) db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const HORA = 3600_000;
const login = () =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'paco', password: 'contraseña-de-prueba' }),
  });
const cookieDe = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const ping = (cookie: string) => fetch(`${base}/api/ping`, { headers: { cookie } });
const firmarCon = (clave: crypto.BinaryLike, cuerpo: string) =>
  crypto.createHmac('sha256', clave).update(cuerpo).digest('base64url');
const firmar = (cuerpo: string) => firmarCon(auth.claveDeSesion(SECRETO, 'paco', 'contraseña-de-prueba'), cuerpo);
const tokenCon = (clave: crypto.BinaryLike, expS: number, inicioS: number, id: string) =>
  `hermes_monitor_session=${expS}.${inicioS}.${id}.0.${firmarCon(clave, `${expS}.${inicioS}.${id}.0`)}`;

async function entrar(): Promise<string> {
  desfaseMs = 0;
  return cookieDe(await login());
}

test('should_keep_a_valid_session_after_a_restart_because_it_is_signed_with_the_own_secret', async () => {
  const cookie = await entrar();
  // Lo que comprueba la cookie es solo la firma con MONITOR_SESSION_SECRET: un token firmado
  // fuera de este proceso (como haría el servidor tras reiniciar) vale igual.
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const ahora = Math.floor(Date.now() / 1000);
  const ajeno = `${exp}.${ahora}.otro-proceso.0.${firmar(`${exp}.${ahora}.otro-proceso.0`)}`;
  assert.equal((await ping(cookie)).status, 200);
  assert.equal((await ping(`hermes_monitor_session=${ajeno}`)).status, 200);
});

test('should_reject_the_tokens_issued_before_users_because_they_name_nobody', async () => {
  const ahora = Math.floor(Date.now() / 1000);
  const exp = ahora + 3600;
  const sinPersona = `${exp}.${ahora}.idviejo.${firmar(`${exp}.${ahora}.idviejo`)}`;
  assert.equal(
    (await ping(`hermes_monitor_session=${sinPersona}`)).status,
    401,
    'quien la tenga vuelve a entrar con su email',
  );
  const antiguo = `${exp}.idviejo.${firmarCon(SECRETO, `${exp}.idviejo`)}`;
  assert.equal((await ping(`hermes_monitor_session=${antiguo}`)).status, 401);
});

test('should_not_renew_a_session_issued_less_than_an_hour_ago', async () => {
  const cookie = await entrar();
  desfaseMs = 30 * 60_000;
  const r = await ping(cookie);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('set-cookie'), null, 'sin Set-Cookie en cada petición');
});

test('should_renew_the_session_while_the_monitor_is_used_beyond_the_initial_12_hours', async () => {
  let cookie = await entrar();
  for (let h = 11; h <= 55; h += 11) {
    desfaseMs = h * HORA;
    const r = await ping(cookie);
    assert.equal(r.status, 200, `a las ${h} h sigue dentro`);
    assert.match(r.headers.get('set-cookie') ?? '', /Max-Age=43200/, 'renovada otras 12 h');
    cookie = cookieDe(r);
  }
  desfaseMs = 55 * HORA + 13 * HORA;
  assert.equal((await ping(cookie)).status, 401, '12 h sin usarla, caduca');
});

test('should_prefix_the_cookie_with_host_and_force_secure_when_the_request_comes_through_https', async () => {
  desfaseMs = 0;
  const r = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
    body: JSON.stringify({ username: 'paco', password: 'contraseña-de-prueba' }),
  });
  const setCookie = r.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /^__Host-hermes_monitor_session=/);
  assert.match(setCookie, /; Secure/);
  assert.match(setCookie, /Path=\//);
  assert.doesNotMatch(setCookie, /Domain=/);
  assert.equal((await ping(cookieDe(r))).status, 200, 'la cookie con prefijo abre la sesión');
});

test('should_keep_the_plain_cookie_name_over_plain_http_so_the_browser_accepts_it', async () => {
  const r = await login();
  assert.match(r.headers.get('set-cookie') ?? '', /^hermes_monitor_session=/);
  assert.doesNotMatch(r.headers.get('set-cookie') ?? '', /Secure/);
});

test('should_renew_also_when_the_web_asks_for_the_session', async () => {
  const cookie = await entrar();
  desfaseMs = 2 * HORA;
  const r = await fetch(`${base}/auth/session`, { headers: { cookie } });
  assert.equal(((await r.json()) as { authenticated: boolean }).authenticated, true);
  assert.match(r.headers.get('set-cookie') ?? '', /hermes_monitor_session=/);
});

test('should_end_the_session_at_the_maximum_since_login_even_if_it_keeps_being_renewed', async () => {
  let cookie = await entrar();
  const maxH = auth.SESION_MAX_S / 3600;
  for (let h = 11; h < maxH; h += 11) {
    desfaseMs = h * HORA;
    const r = await ping(cookie);
    assert.equal(r.status, 200);
    cookie = cookieDe(r) || cookie;
  }
  desfaseMs = (maxH + 1) * HORA;
  assert.equal((await ping(cookie)).status, 401, 'una cookie robada no vale para siempre');
});

test('should_keep_a_closed_session_closed_after_a_restart_when_revocations_live_in_nucleo_db', async () => {
  auth.guardarRevocadasEn(abrir());
  const cookie = await entrar();
  const otra = await entrar();
  await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie } });
  // Otro proceso (el servidor tras reiniciar) abre la misma base: la revocación sigue ahí.
  auth.guardarRevocadasEn(abrir());
  assert.equal((await ping(cookie)).status, 401);
  assert.equal((await ping(otra)).status, 200, 'las demás sesiones siguen');
  desfaseMs = 2 * HORA;
  const renovada = cookieDe(await ping(otra));
  await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: renovada } });
  assert.equal((await ping(otra)).status, 401, 'cerrar la renovada cierra también la cookie de antes: comparten id');
});

test('should_say_in_estado_that_sessions_use_the_own_secret_without_exposing_it', () => {
  const e = auth.estadoAcceso();
  assert.equal(e.secreto, 'propio');
  assert.equal(e.login, true);
  assert.ok(!JSON.stringify(e).includes(SECRETO.slice(0, 8)), 'ni el secreto ni un trozo');
  assert.deepEqual([e.sesion_horas_sin_uso, e.sesion_dias_max], [12, 7]);
});

test('should_not_publish_any_fingerprint_of_the_secret_in_estado_because_agents_read_it', () => {
  // Estado sale por plataforma_estado: una huella del secreto dejaría probar candidatos sin conexión.
  const e = auth.estadoAcceso() as Record<string, unknown>;
  assert.equal(e.huella_secreto, undefined);
  assert.ok(!Object.keys(e).some((k) => k.includes('huella')));
  assert.match(auth.huellaSecreto() ?? '', /^[0-9a-f]{8}$/, 'la huella queda para el log de arranque');
});

test('should_keep_a_closed_session_closed_even_for_a_copy_renewed_before_logout_that_expires_later', async () => {
  auth.guardarRevocadasEn(abrir());
  const vieja = await entrar();
  desfaseMs = 2 * HORA;
  const renovada = cookieDe(await ping(vieja));
  assert.match(renovada, /hermes_monitor_session=/, 'la copia renovada caduca a las 14 h; la vieja, a las 12 h');
  await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: vieja } });
  desfaseMs = 13 * HORA;
  assert.equal(
    (await ping(renovada)).status,
    401,
    'pasada la exp de la cookie con la que se salió, la renovada sigue cerrada',
  );
  auth.guardarRevocadasEn(abrir());
  assert.equal((await ping(renovada)).status, 401, 'y tras reiniciar');
});

test('should_close_the_sessions_signed_before_a_password_change', async () => {
  const ahora = Math.floor(Date.now() / 1000);
  const exp = ahora + 3600;
  const actual = auth.claveDeSesion(SECRETO, 'paco', 'contraseña-de-prueba');
  const conOtraContrasena = auth.claveDeSesion(SECRETO, 'paco', 'contraseña-filtrada');
  assert.equal((await ping(tokenCon(actual, exp, ahora, 'id-actual'))).status, 200);
  assert.equal((await ping(tokenCon(conOtraContrasena, exp, ahora, 'id-antes-del-cambio'))).status, 401);
  assert.equal(
    (await ping(tokenCon(SECRETO, exp, ahora, 'id-solo-secreto'))).status,
    401,
    'la firma no depende solo del secreto',
  );
});
