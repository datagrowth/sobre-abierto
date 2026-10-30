// Las dos cosas que la web oye en cada respuesta de la API, a la vez: la versión (cabecera
// X-Web-Version y 409 version_antigua) y la sesión (401 → GuardiaAcceso pregunta y vuelve al login).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTO_SESION_CADUCADA } from './sesion.js';
import { EVENTO_VERSION_NUEVA } from './versionWeb.js';
import { request, requestCondicional } from './apiCliente.js';
import { bibliotecaApi } from './bibliotecaApi.js';

const BUNDLE = 'index-abc.js';

function entorno(respuesta) {
  const eventos = [];
  const pedidas = [];
  globalThis.window = { dispatchEvent: (e) => eventos.push(e.type) };
  globalThis.CustomEvent = class {
    constructor(type) {
      this.type = type;
    }
  };
  globalThis.document = { querySelector: () => ({ getAttribute: () => `/assets/${BUNDLE}` }) };
  globalThis.fetch = async (url, init) => {
    pedidas.push({ url, headers: init?.headers ?? {} });
    return {
      status: respuesta.status,
      ok: respuesta.status >= 200 && respuesta.status < 300,
      headers: { get: (h) => (respuesta.cabeceras ?? {})[h] ?? null },
      json: async () => respuesta.body,
    };
  };
  return { eventos, pedidas };
}

afterEach(() => {
  for (const k of ['window', 'CustomEvent', 'document', 'fetch']) delete globalThis[k];
});

test('should_send_the_web_version_and_warn_of_a_new_version_on_409_without_touching_the_session', async () => {
  const { eventos, pedidas } = entorno({ status: 409, body: { error: 'version_antigua', message: 'Recarga' } });
  await assert.rejects(
    request('/api/licitaciones/x', { method: 'PUT' }),
    (e) => e.status === 409 && e.code === 'version_antigua',
  );
  assert.equal(pedidas[0].headers['X-Web-Version'], BUNDLE);
  assert.deepEqual(eventos, [EVENTO_VERSION_NUEVA]);
});

test('should_warn_of_a_lost_session_on_401_without_warning_of_a_new_version', async () => {
  const { eventos } = entorno({ status: 401, body: { error: 'unauthorized' } });
  await assert.rejects(request('/api/licitaciones'), (e) => e.status === 401);
  assert.deepEqual(eventos, [EVENTO_SESION_CADUCADA]);
});

test('should_warn_of_both_when_a_401_comes_from_a_newer_server', async () => {
  const { eventos } = entorno({
    status: 401,
    body: { error: 'unauthorized' },
    cabeceras: { 'X-Web-Version': 'index-nuevo.js' },
  });
  await assert.rejects(requestCondicional('/api/licitaciones/x/comprobaciones'));
  assert.deepEqual(eventos.sort(), [EVENTO_SESION_CADUCADA, EVENTO_VERSION_NUEVA].sort());
});

test('should_warn_nothing_on_a_normal_response', async () => {
  const { eventos } = entorno({ status: 200, body: { ok: true }, cabeceras: { 'X-Web-Version': BUNDLE } });
  assert.deepEqual(await request('/api/licitaciones'), { ok: true });
  assert.deepEqual(eventos, []);
});

test('should_handle_session_and_version_in_the_vault_client_too', async () => {
  const { eventos, pedidas } = entorno({ status: 401, body: { error: 'unauthorized' } });
  await assert.rejects(bibliotecaApi.health(), (e) => e.status === 401);
  assert.equal(pedidas[0].headers['X-Web-Version'], BUNDLE);
  assert.deepEqual(eventos, [EVENTO_SESION_CADUCADA]);
  const v = entorno({ status: 409, body: { error: 'version_antigua' } });
  await assert.rejects(bibliotecaApi.notes.create('a.md'));
  assert.deepEqual(v.eventos, [EVENTO_VERSION_NUEVA]);
});

test('should_explain_what_to_do_when_the_server_cannot_be_reached', async () => {
  entorno({ status: 200, body: {} });
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  await assert.rejects(
    request('/api/licitaciones'),
    (e) => e.status === 0 && e.code === 'sin_conexion' && /Comprueba tu red/.test(e.message),
  );
});

test('should_say_what_to_do_on_a_server_error_without_message', async () => {
  entorno({ status: 500, body: null });
  await assert.rejects(
    request('/api/licitaciones'),
    (e) => e.status === 500 && /avisa a quien administre/.test(e.message),
  );
});
