import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filasAcierto, textoActasMercado } from './calidadFormato.js';

test('should_show_the_backtest_error_in_points_or_offers_and_the_range_coverage', () => {
  const filas = filasAcierto([
    { indice: 'baja', mes: '2026-10', n: 120, error_absoluto_medio: 0.058, cobertura_rango: 0.48 },
    { indice: 'ofertas', mes: '2026-10', n: 90, error_absoluto_medio: 1.42, cobertura_rango: null },
  ]);
  assert.deepEqual(
    filas.map((f) => [f.indice, f.error, f.cobertura]),
    [
      ['Baja esperada', '5,8 puntos', '48 %'],
      ['Ofertas esperadas', '1,4 ofertas', '—'],
    ],
  );
  assert.deepEqual(filasAcierto(), []);
});

test('should_count_third_party_records_by_state', () => {
  assert.equal(
    textoActasMercado({ por_estado: { leida: 10, leida_hermes: 2, sin_acta: 3, pedida_hermes: 1 }, licitadores: 40 }),
    '12 leídas (40 licitadores) · 3 sin acta publicada · 1 esperando a Hermes',
  );
  assert.equal(textoActasMercado(null), '0 leídas (0 licitadores)');
});
