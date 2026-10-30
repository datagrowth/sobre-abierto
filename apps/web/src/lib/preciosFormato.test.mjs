import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  porcentaje,
  puntos,
  leerBaja,
  leerOfertas,
  textoProporcion,
  progresoHistorico,
  cabeceraEscenarios,
  columnaAnormal,
  eurosPorUnidad,
  textoUmbral,
} from './preciosFormato.js';

test('should_format_discounts_as_spanish_percentages', () => {
  assert.equal(porcentaje(0.153), '15,3 %');
  assert.equal(porcentaje(0), '0,0 %');
  assert.equal(porcentaje(null), '—');
  assert.equal(puntos(0.012), '+1,2 pp');
  assert.equal(puntos(-0.004), '−0,4 pp');
  assert.equal(puntos(undefined), '—');
});

test('should_parse_a_discount_typed_as_a_percentage', () => {
  assert.equal(leerBaja('15'), 0.15);
  assert.equal(leerBaja('15,5 %'), 0.155);
  assert.equal(leerBaja(''), null);
  assert.ok(Number.isNaN(leerBaja('abc')));
  assert.ok(Number.isNaN(leerBaja('96')));
  assert.ok(Number.isNaN(leerBaja('-3')));
});

test('should_parse_the_expected_number_of_offers', () => {
  assert.equal(leerOfertas('4'), 4);
  assert.equal(leerOfertas(' '), null);
  assert.ok(Number.isNaN(leerOfertas('2.5')));
  assert.ok(Number.isNaN(leerOfertas('0')));
});

test('should_describe_empirical_proportions_and_history_progress', () => {
  assert.equal(textoProporcion(0.75, 20), '15 de 20 (75 %)');
  assert.equal(textoProporcion(null, 20), '—');
  assert.equal(
    progresoHistorico({ estado: 'descargando', piezas_total: 12, piezas_hechas: 3, bytes: 43_000_000, entradas: 1500 }),
    '3/12 meses · 41 MB · 1500 entradas',
  );
  assert.equal(progresoHistorico({ estado: 'hecho', guardadas: 40, entradas: 900 }), '40 guardadas de 900');
  assert.equal(progresoHistorico({ estado: 'pendiente' }), 'en cola');
  assert.equal(progresoHistorico({ estado: 'error', error: 'placsp_sin_zip: no existe' }), 'placsp_sin_zip: no existe');
});

// Intl separa la cifra del «€» con un espacio duro.
const plano = (t) => t.replace(/\u00A0/g, ' ');
const BASE_ESC = {
  ofertas_esperadas: 1,
  baja_resto: 0.1,
  umbral_anormal: 0.251,
  unidad: null,
  umbral_unidad: null,
  cita: null,
  umbral_literal: null,
};

test('should_name_the_threshold_column_after_the_rule_used', () => {
  assert.equal(columnaAnormal({ regla: 'pliego' }), 'Umbral del pliego');
  assert.equal(columnaAnormal({ regla: 'art85' }), 'Art. 85 RGLCAP');
  assert.equal(columnaAnormal({ regla: 'literal' }), 'Art. 85 RGLCAP (estimado)');
  assert.equal(columnaAnormal(null), 'Art. 85 RGLCAP');
});

test('should_show_the_casoE_tender_threshold_per_student_with_its_source', () => {
  const e = {
    ...BASE_ESC,
    regla: 'pliego',
    umbral_anormal: 0.15,
    unidad: { nombre: 'alumno', base: 110.25 },
    umbral_unidad: 93.7125,
    cita: 'Bases.pdf, pág. 53',
  };

  assert.equal(
    plano(textoUmbral(e)),
    'Umbral del pliego: una baja de más del 15,0 % (93,71 € por alumno) es anormalmente baja (Bases.pdf, pág. 53).',
  );
  assert.deepEqual(
    cabeceraEscenarios(e).map(([t]) => t),
    ['Escenario', 'Baja', 'Importe sin IVA', 'Por alumno', 'Ganada con baja ≤', 'Umbral del pliego'],
  );
});

test('should_show_the_literal_threshold_and_say_art_85_is_an_estimate', () => {
  const texto = textoUmbral({
    ...BASE_ESC,
    regla: 'literal',
    umbral_literal: 'Más de 20 puntos por debajo de la media.',
  });

  assert.match(
    texto,
    /^El pliego fija su propio umbral \(«Más de 20 puntos por debajo de la media\.»\): el aviso se estima con el art\. 85 RGLCAP y manda el pliego\./,
  );
  assert.match(texto, /a partir de una baja del 25,1 % la oferta podría ser anormalmente baja\.$/);
});

test('should_keep_the_art_85_text_and_total_columns_without_a_tender_threshold', () => {
  assert.equal(
    textoUmbral({ ...BASE_ESC, regla: 'art85' }),
    'Con 1 oferta y el resto a la baja mediana (10,0 %), a partir de una baja del 25,1 % la oferta podría ser anormalmente baja.',
  );
  assert.equal(
    textoUmbral({ ...BASE_ESC, regla: 'art85', umbral_anormal: null, ofertas_esperadas: 3 }),
    'Con 3 ofertas y el resto a la baja mediana (10,0 %), ninguna baja razonable sería anormal.',
  );
  assert.equal(cabeceraEscenarios({ regla: 'art85', unidad: null }).length, 5);
});

test('should_format_unit_prices_with_cents', () => {
  assert.equal(plano(eurosPorUnidad(92.4, 'alumno')), '92,40 € por alumno');
  assert.equal(eurosPorUnidad(null, 'alumno'), '—');
  assert.equal(plano(eurosPorUnidad(1234.5, null)), '1.234,50 €');
});
