import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearTurnos, pedirConPlazo } from './peticiones.js';

test('should_keep_only_the_latest_request_valid', () => {
  const nuevo = crearTurnos();
  const lista = nuevo();
  const busqueda = nuevo();
  assert.equal(lista(), false, 'la lista sin filtro llega tarde y no pisa la búsqueda');
  assert.equal(busqueda(), true);
});

test('should_accept_a_single_request', () => {
  const nuevo = crearTurnos();
  assert.equal(nuevo()(), true);
});

test('should_keep_separate_counters_for_each_view', () => {
  const lista = crearTurnos();
  const ficha = crearTurnos();
  const deLista = lista();
  ficha();
  assert.equal(deLista(), true, 'una petición de otra vista no la invalida');
});

test('should_ask_again_with_confirmation_when_the_deadline_is_tight_and_the_person_accepts', async () => {
  const pedidos = [];
  const justo = Object.assign(new Error('Quedan 3 h 29 min…'), { code: 'plazo_justo' });
  const pedir = async (confirmado) => {
    pedidos.push(confirmado);
    if (!confirmado) throw justo;
    return { trabajo: 7 };
  };
  assert.deepEqual(await pedirConPlazo(pedir, () => true), { trabajo: 7 });
  assert.deepEqual(pedidos, [false, true]);
  await assert.rejects(
    pedirConPlazo(pedir, () => false),
    /Quedan 3 h 29 min/,
    'sin confirmar, el aviso queda como error',
  );
  const otro = async () => {
    throw Object.assign(new Error('Sin pliegos'), { code: 'invalid_input' });
  };
  await assert.rejects(
    pedirConPlazo(otro, () => {
      throw new Error('no se pregunta');
    }),
    /Sin pliegos/,
  );
});

test('should_ask_again_with_confirmation_when_the_alternative_route_warning_is_accepted', async () => {
  const mensajes = [];
  const pedidos = [];
  const via = Object.assign(
    new Error('El ENS sigue abierto: preparas el Anexo XIV como vía alternativa. Gasta 1 run.'),
    { code: 'via_alternativa' },
  );
  const pedir = async (confirmado) => {
    pedidos.push(confirmado);
    if (!confirmado) throw via;
    return { trabajo: 9 };
  };
  const confirmar = (m) => {
    mensajes.push(m);
    return true;
  };
  assert.deepEqual(await pedirConPlazo(pedir, confirmar), { trabajo: 9 });
  assert.deepEqual(pedidos, [false, true]);
  assert.match(mensajes[0], /El ENS sigue abierto: preparas el Anexo XIV/, 'enseña el mensaje del servidor');
  await assert.rejects(
    pedirConPlazo(pedir, () => false),
    /vía alternativa/,
    'sin confirmar, el aviso queda como error',
  );
});
