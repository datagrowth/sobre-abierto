// Usuarios propios: contraseñas con scrypt, el primer admin desde el acceso de siempre,
// que nunca quede la web sin admin y que el hash no salga de la base.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
const { abrirNucleo } = await import('../../src/nucleo/db.js');
const u = await import('../../src/nucleo/usuarios.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usuarios-'));
const abiertas: { close: () => void }[] = [];
let n = 0;
function base() {
  const db = abrirNucleo(path.join(tmp, String(n++)));
  abiertas.push(db);
  return db;
}
after(() => {
  for (const db of abiertas) db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ALTA = { email: 'Elisa@Example.com ', nombre: 'Elisa', rol: 'editor', contrasena: 'temporal-de-doce' };

test('should_verify_a_scrypt_hash_and_reject_another_password', async () => {
  const h = await u.hashContrasena('una frase larga de verdad');
  assert.match(h, /^scrypt\$\d+\$\d+\$\d+\$/);
  assert.equal(await u.contrasenaValida('una frase larga de verdad', h), true);
  assert.equal(await u.contrasenaValida('otra frase larga de verdad', h), false);
  assert.equal(await u.contrasenaValida('x', 'no-es-un-hash'), false);
});

test('should_create_the_first_admin_from_the_old_login_only_when_there_are_no_users', async () => {
  const db = base();
  assert.equal(await u.sembrarPrimerAdmin(db, 'paco', 'contraseña-de-siempre'), true);
  assert.equal(await u.sembrarPrimerAdmin(db, 'otro', 'contraseña-de-siempre'), false, 'solo la primera vez');
  const [admin] = u.listarUsuarios(db);
  assert.deepEqual([admin!.email, admin!.rol, admin!.debe_cambiarla], ['paco', 'admin', true]);
  assert.equal(
    (await u.autenticar(db, 'PACO', 'contraseña-de-siempre'))?.id,
    admin!.id,
    'el email no distingue mayúsculas',
  );
});

test('should_ask_for_12_characters_and_a_valid_email_and_reject_a_repeated_email', async () => {
  const db = base();
  assert.equal((await u.crearUsuario(db, { ...ALTA, contrasena: 'corta' })).error?.code, 'invalid_input');
  assert.equal((await u.crearUsuario(db, { ...ALTA, email: 'no-es-email' })).error?.code, 'invalid_input');
  const r = await u.crearUsuario(db, ALTA);
  assert.equal(r.data?.email, 'elisa@example.com');
  assert.equal(r.data?.debe_cambiarla, true, 'la temporal se cambia en el primer acceso');
  assert.equal((await u.crearUsuario(db, ALTA)).error?.code, 'conflicto');
});

test('should_never_return_the_hash_in_any_user_listing', async () => {
  const db = base();
  await u.crearUsuario(db, ALTA);
  const texto = JSON.stringify([
    u.listarUsuarios(db),
    u.usuarioPorId(db, 1),
    await u.autenticar(db, ALTA.email, ALTA.contrasena),
  ]);
  assert.ok(!texto.includes('scrypt'), 'ni el hash ni su prefijo');
  assert.ok(!texto.includes(ALTA.contrasena));
});

test('should_keep_at_least_one_active_admin', async () => {
  const db = base();
  await u.sembrarPrimerAdmin(db, 'paco', 'contraseña-de-siempre');
  assert.equal(u.cambiarUsuario(db, 1, { rol: 'editor' }).error?.code, 'conflicto');
  assert.equal(u.cambiarUsuario(db, 1, { activo: false }).error?.code, 'conflicto');
  await u.crearUsuario(db, { ...ALTA, rol: 'admin' });
  assert.equal(u.cambiarUsuario(db, 1, { rol: 'editor' }).data?.rol, 'editor', 'con otro admin activo, sí');
});

test('should_not_let_a_deactivated_person_in', async () => {
  const db = base();
  await u.sembrarPrimerAdmin(db, 'paco', 'contraseña-de-siempre');
  const e = (await u.crearUsuario(db, ALTA)).data!;
  u.cambiarUsuario(db, e.id, { activo: false });
  assert.equal(await u.autenticar(db, ALTA.email, ALTA.contrasena), null);
  assert.equal(u.usuarioDeSesion(db, e.id, Math.floor(Date.now() / 1000)), null);
});

test('should_close_older_sessions_when_the_password_changes', async () => {
  // Arrange
  const db = base();
  const e = (await u.crearUsuario(db, ALTA)).data!;
  const antesS = Math.floor(Date.now() / 1000) - 60;
  assert.ok(u.usuarioDeSesion(db, e.id, Math.floor(Date.now() / 1000)));
  // Act
  const r = await u.cambiarContrasenaPropia(db, e.id, { actual: ALTA.contrasena, nueva: 'mi frase nueva y larga' });
  // Assert
  assert.equal(r.data?.usuario.debe_cambiarla, false);
  assert.equal(u.usuarioDeSesion(db, e.id, antesS), null, 'la sesión de antes del cambio ya no vale');
  assert.ok(await u.autenticar(db, ALTA.email, 'mi frase nueva y larga'));
  assert.equal(
    (await u.cambiarContrasenaPropia(db, e.id, { actual: 'no es la actual', nueva: 'otra frase larga más' })).error
      ?.code,
    'contrasena_incorrecta',
  );
});

test('should_reset_to_a_temporary_password_that_must_be_changed', async () => {
  const db = base();
  const e = (await u.crearUsuario(db, ALTA)).data!;
  await u.cambiarContrasenaPropia(db, e.id, { actual: ALTA.contrasena, nueva: 'mi frase nueva y larga' });
  const r = await u.restablecerContrasena(db, e.id, { contrasena: 'otra-temporal-12' });
  assert.equal(r.data?.debe_cambiarla, true);
  assert.equal(await u.autenticar(db, ALTA.email, 'mi frase nueva y larga'), null);
});

test('should_order_roles_admin_over_editor_over_lector', () => {
  assert.equal(u.alcanza('admin', 'editor'), true);
  assert.equal(u.alcanza('editor', 'admin'), false);
  assert.equal(u.alcanza('lector', 'lector'), true);
  assert.equal(u.alcanza('lector', 'editor'), false);
});
