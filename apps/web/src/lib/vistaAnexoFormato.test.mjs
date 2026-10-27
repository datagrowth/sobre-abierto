import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aceptablesEnBloque, claveDocumento, trozos } from './vistaAnexoFormato.js';

const v = (desde, hasta, dato = 'Importe') => ({ desde, hasta, dato, valor: 'x', cambiado: false });

test('should_split_a_paragraph_into_text_and_highlighted_values', () => {
  const r = trozos({ n: 1, texto: 'Oferta de 100 euros en total', valores: [v(10, 13)] });
  assert.deepEqual(
    r.map((t) => t.texto),
    ['Oferta de ', '100', ' euros en total'],
  );
  assert.equal(r[1].valor.dato, 'Importe');
  assert.equal(r[0].valor, undefined);
});

test('should_handle_overlapping_or_out_of_range_offsets_without_crashing', () => {
  const r = trozos({ texto: 'abcdef', valores: [v(2, 4), v(3, 5), v(4, 99), v(-3, 1), v(5, 5)] });
  assert.equal(r.map((t) => t.texto).join(''), 'abcdef');
  assert.deepEqual(
    r.filter((t) => t.valor).map((t) => t.texto),
    ['a', 'cd', 'ef'],
  );
  assert.deepEqual(trozos({ texto: '', valores: [v(0, 2)] }), []);
  assert.deepEqual(trozos({ texto: 'hola' }), [{ texto: 'hola' }]);
});

test('should_offer_bulk_accept_only_for_two_or_more_non_accreditation_drafts', () => {
  const t = (clave, extra = {}) => ({ clave, tipo: 'anexo', estado: 'pendiente', acreditacion: false, ...extra });
  assert.equal(aceptablesEnBloque([t('a'), t('b', { acreditacion: true })]).length, 0);
  assert.equal(
    aceptablesEnBloque([t('a'), t('b'), t('c', { acreditacion: true }), t('d', { tipo: 'memoria' })]).length,
    2,
  );
  assert.equal(aceptablesEnBloque([t('a'), t('b', { estado: 'aceptada' })]).length, 0);
  assert.equal(aceptablesEnBloque(undefined).length, 0);
});

test('should_extract_the_document_key_from_the_card_key', () => {
  assert.equal(claveDocumento('anexo:anexo-v-l2:2026-10-14T10:00:00Z'), 'anexo-v-l2');
});
