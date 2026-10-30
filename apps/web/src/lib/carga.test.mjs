import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoFalloRecarga, trasCarga, trasFallo } from './carga.js';

test('should_keep_previous_data_when_reload_fails', () => {
  const previo = trasCarga({ a: 1 }, 1000);
  const r = trasFallo(previo, 'sin red', 2000);
  assert.equal(r.kind, 'ready');
  assert.deepEqual(r.data, { a: 1 });
  assert.deepEqual(r.fallo, { message: 'sin red', en: 2000 });
});

test('should_not_keep_data_of_other_deps_when_the_new_load_fails', () => {
  // Arrange: el resumen del lote 1 cargado; se pasa al lote 2 y su carga falla.
  const lote1 = trasCarga({ lote: '1' }, 1000, '["4","1"]');

  // Act
  const lote2 = trasFallo(lote1, 'HTTP 500', 2000, '["4","2"]');
  const recargaLote1 = trasFallo(lote1, 'sin red', 2000, '["4","1"]');

  // Assert
  assert.deepEqual(lote2, { kind: 'error', message: 'HTTP 500' }, 'no enseña el lote 1 bajo la pestaña del 2');
  assert.deepEqual(recargaLote1.data, { lote: '1' }, 'la misma consulta conserva lo que se veía');
});

test('should_return_error_when_first_load_fails', () => {
  assert.deepEqual(trasFallo({ kind: 'loading' }, 'caído'), { kind: 'error', message: 'caído' });
  assert.deepEqual(trasFallo(undefined, 'caído'), { kind: 'error', message: 'caído' });
});

test('should_clear_failure_after_successful_reload', () => {
  const fallido = trasFallo(trasCarga(1, 1000), 'x', 2000);
  const r = trasCarga(2, 3000);
  assert.equal(fallido.fallo.message, 'x');
  assert.equal(r.fallo, undefined);
  assert.equal(textoFalloRecarga(r), null);
});

test('should_format_failure_with_madrid_time', () => {
  const previaTZ = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    // 14:02 UTC en octubre = 16:02 en Madrid (CEST)
    const estado = trasFallo(trasCarga({}, Date.UTC(2026, 9, 14, 14, 2)), 'HTTP 500', Date.UTC(2026, 9, 14, 14, 5));
    assert.equal(textoFalloRecarga(estado), 'No se pudo actualizar (HTTP 500) · datos de las 16:02');
  } finally {
    if (previaTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previaTZ;
  }
});
