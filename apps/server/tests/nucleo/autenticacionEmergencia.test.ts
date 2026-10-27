// El acceso de emergencia (MONITOR_BASIC_AUTH_*) solo entra mientras ningún admin tenga contraseña
// propia; después, el acceso se recupera con el comando de recuperarAcceso.ts.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const ENV_CLAVE = 'contraseña-del-env-de-prueba';
const PROPIA = 'la-contraseña-propia-de-ana';
process.env.NODE_ENV = 'test';
process.env.MONITOR_BASIC_AUTH_USERNAME = 'paco';
process.env.MONITOR_BASIC_AUTH_PASSWORD = ENV_CLAVE;
process.env.MONITOR_SESSION_SECRET = 'secreto-de-prueba-del-acceso-de-emergencia-0123456789';
delete process.env.MONITOR_PROXIES_DE_CONFIANZA;

const express = (await import('express')).default;
const auth = await import('../../src/nucleo/autenticacion.js');
const { abrirNucleo } = await import('../../src/nucleo/db.js');
const u = await import('../../src/nucleo/usuarios.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emergencia-'));
const db = abrirNucleo(tmp);
let servidor: http.Server;
let base = '';

before(async () => {
  const app = express();
  app.use('/auth', auth.router);
  app.use('/api', auth.middleware);
  app.get('/api/ping', (_req, res) => {
    res.json({ ok: true });
  });
  servidor = http.createServer(app);
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
  servidor.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Un único admin recién sembrado con el login de siempre, que ha cambiado su email (así el login del
// `.env` ya no coincide con su fila y solo puede entrar por la puerta de emergencia).
beforeEach(async () => {
  db.prepare('DELETE FROM usuarios').run();
  await auth.usarUsuariosDe(db);
  const admin = u.listarUsuarios(db)[0]!;
  assert.equal(u.cambiarUsuario(db, admin.id, { email: 'ana@example.com' }).error, null);
});

const login = (username: string, password: string) =>
  fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
const cookieDe = (r: Response) => (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const ping = (cookie: string) => fetch(`${base}/api/ping`, { headers: { cookie } });
const adminId = () => u.listarUsuarios(db)[0]!.id;
const elegirContrasena = (actual: string) => u.cambiarContrasenaPropia(db, adminId(), { actual, nueva: PROPIA });

test('should_let_the_env_login_in_as_emergency_while_no_admin_has_their_own_password', async () => {
  const r = await login('paco', ENV_CLAVE);
  assert.equal(r.status, 204);
  const s = (await (await fetch(`${base}/auth/session`, { headers: { cookie: cookieDe(r) } })).json()) as {
    usuario: { emergencia: boolean };
  };
  assert.equal(s.usuario.emergencia, true);
});

test('should_reject_the_env_login_once_an_admin_has_their_own_password', async () => {
  assert.equal((await elegirContrasena(ENV_CLAVE)).error, null);

  assert.equal((await login('paco', ENV_CLAVE)).status, 401);
  assert.equal((await login('ana@example.com', PROPIA)).status, 204, 'su contraseña propia sí entra');
});

test('should_drop_open_emergency_sessions_once_an_admin_has_their_own_password', async () => {
  const cookie = cookieDe(await login('paco', ENV_CLAVE));
  assert.equal((await ping(cookie)).status, 200);

  assert.equal((await elegirContrasena(ENV_CLAVE)).error, null);

  assert.equal((await ping(cookie)).status, 401);
});

test('should_not_count_a_temporary_password_as_one_of_their_own', async () => {
  const antes = await elegirContrasena(ENV_CLAVE);
  assert.equal(antes.error, null);
  assert.equal((await login('paco', ENV_CLAVE)).status, 401);

  await u.restablecerContrasena(db, adminId(), { contrasena: 'temporal-de-prueba-larga' });

  assert.equal((await login('paco', ENV_CLAVE)).status, 204, 'sin contraseña propia vuelve la de emergencia');
});

test('should_give_a_temporary_password_that_must_be_changed_and_close_open_sessions', async () => {
  assert.equal((await elegirContrasena(ENV_CLAVE)).error, null);
  const cookie = cookieDe(await login('ana@example.com', PROPIA));
  assert.equal((await ping(cookie)).status, 200);

  // La sesión se compara con el cambio al segundo: sin esperar, ambos caen en el mismo.
  await new Promise((r) => setTimeout(r, 1100));
  const r = await u.recuperarAdmin(db, ' ANA@example.com ');

  assert.equal(r.error, null);
  assert.ok(r.data!.contrasena.length >= 12);
  assert.equal(r.data!.usuario.debe_cambiarla, true);
  assert.equal((await ping(cookie)).status, 401, 'la sesión de antes se cierra');
  assert.equal((await login('ana@example.com', PROPIA)).status, 401, 'la contraseña de antes ya no vale');
  const entra = await login('ana@example.com', r.data!.contrasena);
  assert.equal(entra.status, 204);
  const s = (await (await fetch(`${base}/auth/session`, { headers: { cookie: cookieDe(entra) } })).json()) as {
    usuario: { debe_cambiarla: boolean };
  };
  assert.equal(s.usuario.debe_cambiarla, true);
});

test('should_refuse_to_recover_an_unknown_inactive_or_non_admin_user', async () => {
  const alta = await u.crearUsuario(db, {
    email: 'eva@example.com',
    nombre: 'Eva Editora',
    rol: 'editor',
    contrasena: 'contraseña-de-eva-larga',
  });

  for (const email of ['nadie@example.com', 'eva@example.com', 'no-es-un-email', '']) {
    const r = await u.recuperarAdmin(db, email);
    assert.ok(r.error, email);
  }
  u.cambiarUsuario(db, alta.data!.id, { rol: 'admin' });
  u.cambiarUsuario(db, alta.data!.id, { activo: false });
  assert.ok((await u.recuperarAdmin(db, 'eva@example.com')).error, 'un admin dado de baja no vale');
});

test('should_print_the_temporary_password_from_the_command_and_fail_for_an_unknown_email', () => {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const ejecutar = (...args: string[]) =>
    spawnSync(
      process.execPath,
      ['--import', 'tsx', fileURLToPath(new URL('../../src/recuperarAcceso.ts', import.meta.url)), ...args],
      {
        env: { ...process.env, PLATAFORMA_DATA_DIR: tmp },
        encoding: 'utf8',
      },
    );

  const bien = ejecutar('ana@example.com');
  const mal = ejecutar('nadie@example.com');
  const sinArgumento = ejecutar();

  assert.equal(bien.status, 0, bien.stderr);
  const temporal = /: (\S+)\n/.exec(bien.stdout)?.[1] ?? '';
  assert.ok(temporal.length >= 12);
  assert.equal(u.listarUsuarios(db)[0]!.debe_cambiarla, true);
  assert.equal(mal.status, 1);
  assert.doesNotMatch(mal.stdout + mal.stderr, /ana@example\.com/);
  assert.equal(sinArgumento.status, 2);
});
