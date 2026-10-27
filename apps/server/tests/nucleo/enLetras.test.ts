// Importes en letras para la proposición económica y VALORES_A_TECLEAR.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enteroEnLetras, eurosEnLetras } from '../../src/nucleo/enLetras.js';

test('should_write_amounts_in_spanish_words_with_cents', () => {
  assert.equal(eurosEnLetras(72), 'setenta y dos euros');
  assert.equal(eurosEnLetras(98.18), 'noventa y ocho euros con dieciocho céntimos');
  assert.equal(eurosEnLetras(1), 'un euro');
  assert.equal(eurosEnLetras(21), 'veintiún euros');
  assert.equal(eurosEnLetras(0.01), 'cero euros con un céntimo');
  assert.equal(eurosEnLetras(21_780), 'veintiún mil setecientos ochenta euros');
  assert.equal(eurosEnLetras(1_650), 'mil seiscientos cincuenta euros');
  assert.equal(eurosEnLetras(100_000), 'cien mil euros');
  assert.equal(eurosEnLetras(101_031.5), 'ciento un mil treinta y un euros con cincuenta céntimos');
  assert.equal(eurosEnLetras(2_500_000), 'dos millones quinientos mil euros');
  assert.equal(enteroEnLetras(1_000_001), 'un millón uno');
  assert.equal(enteroEnLetras(-1), '-1', 'fuera de rango, en cifra');
});
