import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puedeMarcar, cambioDeLotes, textoMaximoLotes } from './lotesEleccion.js';

test('should_refuse_ticking_beyond_the_tender_maximum', () => {
  assert.equal(puedeMarcar(['1', '2'], '3', 2), false);
  assert.equal(puedeMarcar(['1'], '3', 2), true);
});

test('should_allow_ticking_any_number_when_there_is_no_maximum', () => {
  assert.equal(puedeMarcar(['1', '2', '3'], '4', undefined), true);
  assert.equal(puedeMarcar(['1', '2', '3'], '4', null), true);
});

test('should_allow_unticking_always', () => {
  assert.equal(puedeMarcar(['1', '2'], '2', 2), true);
  assert.equal(puedeMarcar(['1', '2', '3'], '3', 1), true);
});

test('should_tell_removed_and_added_lots_apart', () => {
  assert.deepEqual(cambioDeLotes(['1', '2'], ['2', '3']), { quitados: ['1'], anadidos: ['3'] });
});

test('should_report_no_change_when_selection_is_equal_or_empty', () => {
  assert.deepEqual(cambioDeLotes(['1'], ['1']), { quitados: [], anadidos: [] });
  assert.deepEqual(cambioDeLotes(), { quitados: [], anadidos: [] });
});

test('should_word_the_maximum_in_singular_and_plural', () => {
  assert.equal(textoMaximoLotes(2), 'Este pliego deja ir a 2 lotes como mucho.');
  assert.equal(textoMaximoLotes(1), 'Este pliego deja ir a 1 lote como mucho.');
});
