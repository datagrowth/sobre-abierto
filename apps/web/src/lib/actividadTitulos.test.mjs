import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idsEnTexto, conTitulos, explicarError } from './actividadTitulos.js';

test('should_find_tender_ids_in_text', () => {
  assert.deepEqual(idsEnTexto('ficha de p-123 y a-9, otra vez p-123'), ['p-123', 'a-9']);
  assert.deepEqual(idsEnTexto('sin ids, ni mapa-1'), []);
  assert.deepEqual(idsEnTexto(null), []);
  assert.equal(idsEnTexto(Array.from({ length: 60 }, (_, i) => `p-${i}`).join(' ')).length, 50);
});

test('should_replace_ids_with_titles_and_keep_unknown_ids', () => {
  const t = conTitulos('Ficha p-1 y p-2 listas', { 'p-1': 'Servicio de limpieza' });
  assert.deepEqual(t, [
    { tipo: 'texto', texto: 'Ficha ' },
    { tipo: 'enlace', id: 'p-1', texto: 'Servicio de limpieza' },
    { tipo: 'texto', texto: ' y p-2 listas' },
  ]);
  assert.deepEqual(conTitulos('', {}), []);
});

test('should_explain_known_error_codes_and_ignore_unknown', () => {
  assert.match(explicarError('{"error":"not_found"}'), /ya no existe/);
  assert.equal(explicarError('algo raro'), null);
  assert.equal(explicarError(undefined), null);
});
