// Localizar una cita literal (la ficha, las comprobaciones, el crítico y la mejora usan lo mismo): cada trozo
// de palabra entera a palabra entera salvo por donde Hermes lo corta, nunca a media cifra, y los
// trozos en el orden de la cita.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localizarCitas } from '../../src/dominios/licitaciones/oferta/evaluacionMemoria.js';

const PLIEGO =
  'Volumen anual de negocios de 1.300.000 euros, IVA excluido, en alguno de los tres últimos ejercicios. La solvencia técnica se acredita con dos contratos similares.';

test('should_not_find_a_quote_that_starts_inside_a_word_or_a_number', () => {
  // Act
  const r = localizarCitas(
    [PLIEGO],
    [
      '300.000 euros, IVA excluido',
      'olumen anual de negocios de 1.300.000 euros',
      '1.300 euros, IVA excluido, en alguno',
    ],
  );
  // Assert
  assert.deepEqual(r, [null, null, null]);
});

test('should_find_the_same_quotes_written_whole_with_other_thousands_separators', () => {
  const r = localizarCitas(
    ['Otro apartado sin la cifra.', PLIEGO],
    ['de 1.300.000 euros, IVA excluido', 'negocios de 1 300 000 euros, iva excluido'],
  );
  assert.deepEqual(r, [2, 2]);
});

test('should_require_the_fragments_in_the_order_of_the_quote', () => {
  const enOrden = 'Volumen anual de negocios de 1.300.000 euros… se acredita con dos contratos similares';
  const alReves = 'se acredita con dos contratos similares… Volumen anual de negocios de 1.300.000 euros';
  assert.deepEqual(localizarCitas([PLIEGO], [enOrden, alReves]), [1, null]);
});

test('should_accept_a_word_cut_where_the_quote_is_cut_but_never_a_number', () => {
  const r = localizarCitas(
    [PLIEGO],
    [
      'Volumen anual de negocios de 1.300.000 euros, IVA exclu',
      'Volumen anual de neg… de los tres últimos ejercicios',
      'Volumen anual de negocios de 1.300',
    ],
  );
  assert.deepEqual(r, [1, 1, null]);
});
