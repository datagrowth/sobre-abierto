import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clavePlegado, estadoPlegado } from './plegado.js';

test('should_remember_whether_a_box_was_left_folded_or_unfolded', () => {
  assert.equal(clavePlegado('oferta.guion'), 'dg.plegado.oferta.guion');
  assert.equal(estadoPlegado('1'), true);
  assert.equal(estadoPlegado('0', true), false, 'desplegada a propósito aunque por defecto vaya plegada');
  assert.equal(estadoPlegado(null), false);
  assert.equal(estadoPlegado(null, true), true);
});
