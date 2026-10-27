import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mensajeSinCuerpo } from './erroresHttp.js';

test('should_tell_what_to_do_in_every_http_error', () => {
  for (const status of [400, 403, 404, 408, 429, 500, 502, 504]) {
    const texto = mensajeSinCuerpo(status);
    assert.match(texto, new RegExp(`HTTP ${status}`), `lleva el código ${status}`);
    assert.match(texto, /[Ii]nténtalo|Recarga|Pide|Espera|avisa/, `dice qué hacer en ${status}`);
  }
});

test('should_say_the_server_took_too_long_on_a_gateway_timeout', () => {
  assert.match(mensajeSinCuerpo(504), /tardó demasiado/);
});
