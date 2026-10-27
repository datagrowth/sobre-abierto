// Estadística del núcleo: percentiles como PERCENTIL.INC de Excel y media, con los
// casos borde (vacío, un solo valor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { media, percentil, percentiles } from '../../src/nucleo/estadistica.js';

test('should_interpolate_percentiles_like_excel_percentile_inc', () => {
  const ordenados = [0.1, 0.2, 0.3, 0.4, 0.5];
  assert.ok(Math.abs((percentil(ordenados, 0.1) ?? 0) - 0.14) < 1e-9);
  assert.equal(percentil(ordenados, 0.5), 0.3);
  assert.deepEqual(percentiles(ordenados), { p10: 0.14, p25: 0.2, p50: 0.3, p75: 0.4, p90: 0.46 });
});

test('should_handle_empty_and_single_samples', () => {
  assert.deepEqual(percentiles([0.2]), { p10: 0.2, p25: 0.2, p50: 0.2, p75: 0.2, p90: 0.2 });
  assert.equal(percentil([], 0.5), null);
  assert.equal(media([]), null);
  assert.equal(media([2, 4]), 3);
});

test('should_clamp_out_of_range_probabilities', () => {
  assert.equal(percentil([1, 2, 3], -1), 1);
  assert.equal(percentil([1, 2, 3], 2), 3);
});
