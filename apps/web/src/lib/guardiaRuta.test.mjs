import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidirHash } from './guardiaRuta.js';

const COMPROBACIONES = '#/licitacion/p-1/comprobaciones';

test('should_ask_before_a_browser_back_leaves_the_comprobaciones', () => {
  assert.equal(decidirHash({ nuevo: '#/hoy', aceptado: COMPROBACIONES, conGuardia: true }), 'preguntar');
});

test('should_accept_a_route_the_app_already_accepted_or_without_comprobaciones', () => {
  assert.equal(
    decidirHash({ nuevo: COMPROBACIONES, aceptado: COMPROBACIONES, conGuardia: true }),
    'aceptar',
    'la web ya preguntó al navegar',
  );
  assert.equal(
    decidirHash({ nuevo: '#/hoy', aceptado: COMPROBACIONES, conGuardia: false }),
    'aceptar',
    'sin comprobaciones montadas no hay nada que perder',
  );
});
