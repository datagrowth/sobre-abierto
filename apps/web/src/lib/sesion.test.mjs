import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisarSiSinSesion, debeVolverAEntrar, esSinSesion, EVENTO_SESION_CADUCADA } from './sesion.js';

test('should_dispatch_session_expired_event_only_on_401', () => {
  const eventos = [];
  globalThis.window = { dispatchEvent: (e) => eventos.push(e.type) };
  try {
    assert.equal(avisarSiSinSesion(401), true);
    assert.equal(avisarSiSinSesion(409), false, 'un 409 de versión antigua no es la sesión');
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(eventos, [EVENTO_SESION_CADUCADA]);
});

test('should_not_fail_without_window', () => {
  assert.equal(avisarSiSinSesion(401), false);
});

test('should_treat_only_401_as_a_lost_session', () => {
  assert.equal(esSinSesion(401), true);
  assert.equal(esSinSesion(403), false, 'un 403 es el origen o permisos, no la sesión');
  assert.equal(esSinSesion(500), false);
});

test('should_ask_to_log_in_again_only_with_login_enabled_and_no_session', () => {
  assert.equal(debeVolverAEntrar({ enabled: true, authenticated: false }), true);
  assert.equal(debeVolverAEntrar({ enabled: true, authenticated: true }), false);
  assert.equal(
    debeVolverAEntrar({ enabled: false, authenticated: false }),
    false,
    'sin login no hay sesión que perder',
  );
  assert.equal(debeVolverAEntrar(null), false, 'sin respuesta no se sabe: no se echa a nadie');
});
