import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ariaOrden, escalaRango, ordenarFilas, posicionEnRango, siguienteOrden, textoPocosDatos } from './uiFormato.js';

test('should_sort_rows_with_empty_values_last_in_both_directions', () => {
  // Arrange
  const filas = [{ n: 3 }, { n: null }, { n: 1 }, { n: 2 }, { n: '' }];

  // Act
  const asc = ordenarFilas(filas, (f) => f.n, 'asc').map((f) => f.n);
  const desc = ordenarFilas(filas, (f) => f.n, 'desc').map((f) => f.n);

  // Assert
  assert.deepEqual(asc, [1, 2, 3, null, '']);
  assert.deepEqual(desc, [3, 2, 1, null, '']);
});

test('should_sort_text_in_spanish_with_numbers_inside', () => {
  const filas = ['Lote 10', 'lote 2', 'Árbol', 'Zona'].map((t) => ({ t }));
  assert.deepEqual(
    ordenarFilas(filas, (f) => f.t).map((f) => f.t),
    ['Árbol', 'lote 2', 'Lote 10', 'Zona'],
  );
});

test('should_keep_the_original_order_between_ties', () => {
  const filas = [
    { k: 1, id: 'a' },
    { k: 1, id: 'b' },
    { k: 0, id: 'c' },
  ];
  assert.deepEqual(
    ordenarFilas(filas, (f) => f.k).map((f) => f.id),
    ['c', 'a', 'b'],
  );
});

test('should_toggle_the_direction_on_the_same_column_and_start_ascending_on_another', () => {
  assert.deepEqual(siguienteOrden(null, 'cierre'), { clave: 'cierre', sentido: 'asc' });
  assert.deepEqual(siguienteOrden({ clave: 'cierre', sentido: 'asc' }, 'cierre'), { clave: 'cierre', sentido: 'desc' });
  assert.deepEqual(siguienteOrden({ clave: 'cierre', sentido: 'desc' }, 'importe'), {
    clave: 'importe',
    sentido: 'asc',
  });
  assert.equal(ariaOrden({ clave: 'cierre', sentido: 'desc' }, 'cierre'), 'descending');
  assert.equal(ariaOrden({ clave: 'cierre', sentido: 'desc' }, 'importe'), 'none');
});

test('should_place_values_on_the_range_bar_without_leaving_it', () => {
  assert.equal(posicionEnRango(25, 0, 100), 25);
  assert.equal(posicionEnRango(150, 0, 100), 100);
  assert.equal(posicionEnRango(-5, 0, 100), 0);
  assert.equal(posicionEnRango(null, 0, 100), null);
  assert.equal(posicionEnRango(5, 10, 10), null, 'sin escala no hay posición');
});

test('should_leave_room_after_the_largest_value_on_the_scale', () => {
  const e = escalaRango([0.12, 0.3, null, 0.2]);
  assert.equal(e.min, 0);
  assert.ok(Math.abs(e.max - 0.33) < 1e-9);
  assert.equal(escalaRango([]), null);
  assert.deepEqual(escalaRango([0]), { min: 0, max: 1 });
});

test('should_say_few_data_with_the_sample_size', () => {
  assert.equal(textoPocosDatos(7), 'pocos datos (n = 7)');
});
