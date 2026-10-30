import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barrasTrimestres,
  etiquetaTrimestre,
  mesAnio,
  millones,
  textoProrrogas,
  textoSalida,
} from './mercadoFormato.js';

test('should_label_quarters_and_scale_bars_to_the_largest', () => {
  assert.equal(etiquetaTrimestre('2026-T3'), 'T3 26');
  const b = barrasTrimestres([
    { trimestre: '2026-T1', importe: 500_000 },
    { trimestre: '2026-T2', importe: 2_000_000 },
    { trimestre: '2026-T3', importe: 0 },
  ]);
  assert.deepEqual(
    b.map((x) => [x.etiqueta, x.alto]),
    [
      ['T1 26', 25],
      ['T2 26', 100],
      ['T3 26', 0],
    ],
  );
  assert.deepEqual(
    barrasTrimestres([{ trimestre: '2026-T1', importe: 0 }]).map((x) => x.alto),
    [0],
  );
});

test('should_write_millions_and_short_months', () => {
  assert.equal(millones(1_250_000), '1,3');
  assert.equal(millones(null), '—');
  assert.equal(mesAnio('2027-03-31'), 'mar 2027');
  assert.equal(mesAnio(null), '—');
});

test('should_explain_the_expected_tender_and_the_extensions', () => {
  assert.equal(textoSalida({ ediciones: 0, antelacion_meses: 4 }), 'Sin historial del órgano: 4 meses antes del fin');
  assert.equal(
    textoSalida({ ediciones: 2, antelacion_meses: 3.5 }),
    '3,5 meses antes del fin, como en sus 2 ediciones anteriores',
  );
  assert.equal(textoProrrogas({ prorrogas_max: null }), 'prórrogas sin publicar');
  assert.equal(textoProrrogas({ prorrogas_max: 0 }), 'sin prórrogas');
  assert.equal(textoProrrogas({ prorrogas_max: 2, prorrogas_usadas: 1 }), '1 de 2 prórrogas usadas');
});
