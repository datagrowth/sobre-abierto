import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diferencias, textoCampo } from './propuestaIa.js';

test('should_write_field_values_as_short_text', () => {
  assert.equal(textoCampo(''), '—');
  assert.equal(textoCampo(['ISO 9001', 'ENS']), 'ISO 9001; ENS');
  assert.equal(textoCampo([{ anio: '2025', importe: '186420.35' }]), '2025 186420.35');
  assert.equal(textoCampo(3), '3');
});

test('should_list_only_changed_fields_with_before_and_after', () => {
  const d = diferencias(
    { rol: 'Analista', anios: '3', notas: '' },
    { rol: 'Data Engineer', anios: '3', notas: '' },
    { rol: 'Rol', anios: 'Años', notas: 'Notas' },
  );
  assert.deepEqual(d, [{ campo: 'Rol', antes: 'Analista', despues: 'Data Engineer' }]);
  assert.deepEqual(diferencias(null, { rol: 'X' }, { rol: 'Rol' }), [{ campo: 'Rol', antes: '—', despues: 'X' }]);
});
