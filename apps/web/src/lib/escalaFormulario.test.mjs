import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escalaAFormulario, formularioAEscala, opcionesRegion } from './escalaFormulario.js';

test('should_round_trip_region_and_band_written_in_spanish', () => {
  const f = escalaAFormulario({ region_nuts: 'ES70', banda_min: 7000, banda_max: 130000 });
  assert.deepEqual(f, { region_nuts: 'ES70', banda_min: '7.000', banda_max: '130.000' });
  assert.deepEqual(formularioAEscala(f), {
    escala: { region_nuts: 'ES70', banda_min: 7000, banda_max: 130000 },
    errores: [],
  });
});

test('should_send_nulls_for_all_spain_and_no_band', () => {
  assert.deepEqual(formularioAEscala(escalaAFormulario(null)), {
    escala: { region_nuts: null, banda_min: null, banda_max: null },
    errores: [],
  });
});

test('should_flag_a_band_upside_down_or_not_a_number', () => {
  assert.match(
    formularioAEscala({ region_nuts: '', banda_min: '130.000', banda_max: '7.000' }).errores[0],
    /no puede ser mayor/,
  );
  assert.match(formularioAEscala({ region_nuts: '', banda_min: 'mucho', banda_max: '' }).errores[0], /Banda desde/);
});

test('should_offer_all_spain_each_community_and_a_saved_prefix', () => {
  assert.deepEqual(opcionesRegion('')[0], ['', 'Toda España']);
  assert.ok(opcionesRegion('').some(([c, n]) => c === 'ES70' && n === 'Canarias'));
  assert.deepEqual(opcionesRegion('ES7').at(-1), ['ES7', 'NUTS ES7']);
});
