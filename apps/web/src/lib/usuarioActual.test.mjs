import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contrasenaTemporal,
  esAdmin,
  estadoUsuario,
  fijarUsuario,
  iniciales,
  problemaContrasena,
  puede,
  QUE_PUEDE,
  suscribirUsuario,
  usuarioActual,
} from './usuarioActual.js';

test('should_let_everything_when_there_is_no_login', () => {
  assert.equal(puede(null, 'admin'), true, 'sin login no hay personas');
});

test('should_order_roles_admin_over_editor_over_lector', () => {
  const lector = { rol: 'lector' },
    editor = { rol: 'editor' },
    admin = { rol: 'admin' };
  assert.equal(puede(lector, 'editor'), false);
  assert.equal(puede(editor, 'editor'), true);
  assert.equal(puede(editor, 'admin'), false);
  assert.equal(esAdmin(admin), true);
});

test('should_treat_an_unknown_role_as_lector', () => {
  const u = fijarUsuario({ id: 3, nombre: 'Elisa', rol: 'superusuario' });
  assert.equal(u.rol, 'lector');
  assert.equal(puede(u, 'editor'), false);
  fijarUsuario(null);
});

test('should_keep_only_known_fields_and_tell_the_listeners', () => {
  // Arrange
  let avisos = 0;
  const quitar = suscribirUsuario(() => {
    avisos += 1;
  });
  // Act
  fijarUsuario({ id: '7', nombre: 'Paco', rol: 'admin', debe_cambiarla: 'si', hash: 'x' });
  // Assert
  assert.deepEqual(usuarioActual(), {
    id: 7,
    nombre: 'Paco',
    email: null,
    rol: 'admin',
    emergencia: false,
    debe_cambiarla: false,
  });
  assert.equal(avisos, 1);
  quitar();
  fijarUsuario(null);
});

test('should_ask_for_12_characters_and_matching_passwords', () => {
  assert.match(problemaContrasena('corta'), /12 caracteres/);
  assert.match(problemaContrasena('una-contraseña-larga', 'otra-contraseña-larga'), /no coinciden/);
  assert.equal(problemaContrasena('una-contraseña-larga', 'una-contraseña-larga'), null);
  assert.equal(problemaContrasena('una-contraseña-larga'), null, 'la temporal de un alta no se repite');
});

test('should_make_a_temporary_password_long_enough_and_without_confusable_letters', () => {
  const t = contrasenaTemporal();
  assert.match(t, /^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);
  assert.equal(problemaContrasena(t), null);
  assert.doesNotMatch(
    contrasenaTemporal(() => Array.from({ length: 16 }, (_, i) => i * 7)),
    /[01lIO]/,
  );
});

test('should_tell_the_state_of_each_user', () => {
  assert.deepEqual(estadoUsuario({ activo: false, debe_cambiarla: true }), { texto: 'De baja', tono: 'neutro' });
  assert.equal(estadoUsuario({ activo: true, debe_cambiarla: true }).texto, 'Falta su primer acceso');
  assert.equal(estadoUsuario({ activo: true, debe_cambiarla: false }).tono, 'ok');
});

test('should_give_initials_for_the_avatar', () => {
  assert.equal(iniciales('Paco Ejemplo'), 'PE');
  assert.equal(iniciales('elisa'), 'E');
  assert.equal(iniciales(''), '?');
});

test('should_say_only_admin_decides_the_price', () => {
  const precio = QUE_PUEDE.find(([que]) => que === 'Decidir el precio');
  assert.deepEqual(precio.slice(1), [true, false, false]);
});
