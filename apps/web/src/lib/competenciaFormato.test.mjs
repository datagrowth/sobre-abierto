import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  barrasAnio,
  eurosCortos,
  nivelInteres,
  nombreONif,
  ofertasMedias,
  textoCoincidencias,
  textoPyme,
} from './competenciaFormato.js';

test('should_shorten_amounts_to_thousands_and_millions', () => {
  assert.equal(eurosCortos(1_234_567), '1,2 M€');
  assert.equal(eurosCortos(45_300), '45 mil €');
  assert.equal(eurosCortos(900), '900 €');
  assert.equal(eurosCortos(null), '—');
  assert.equal(ofertasMedias(3.333), '3,3');
  assert.equal(ofertasMedias(undefined), '—');
});

test('should_label_sme_share_and_interest_level', () => {
  assert.equal(textoPyme(1), 'pyme');
  assert.equal(textoPyme(0.2), 'no pyme');
  assert.equal(textoPyme(null), null);
  assert.equal(nivelInteres(72), 'alto');
  assert.equal(nivelInteres(40), 'medio');
  assert.equal(nivelInteres(10), 'bajo');
  assert.equal(nivelInteres(undefined), 'bajo');
});

test('should_describe_matches_with_the_opportunities_we_follow', () => {
  assert.equal(
    textoCoincidencias({ total: 4, mismo_organo: 1, mismo_cpv: 3 }),
    '1 en órganos donde licitas · 3 en tus CPV',
  );
  assert.equal(textoCoincidencias({ total: 0, mismo_organo: 0, mismo_cpv: 0 }), null);
  assert.equal(textoCoincidencias(undefined), null);
});

test('should_scale_year_bars_to_the_largest_year', () => {
  const barras = barrasAnio([
    { clave: '2024', contratos: 1 },
    { clave: '2025', contratos: 4 },
  ]);
  assert.deepEqual(
    barras.map((b) => b.ancho),
    [25, 100],
  );
  assert.deepEqual(
    barrasAnio([{ clave: '2024', contratos: 0 }]).map((b) => b.ancho),
    [0],
  );
  assert.deepEqual(barrasAnio([]), []);
});

test('should_fall_back_to_the_nif_without_a_name', () => {
  assert.equal(nombreONif({ nombre: 'Datos SL', nif: 'B1' }), 'Datos SL');
  assert.equal(nombreONif({ nombre: null, clave: 'Q1' }), 'Q1');
  assert.equal(nombreONif(null), '—');
});

test('should_not_show_placeholder_tax_ids_as_real_ones', async () => {
  const { textoNif } = await import('./competenciaFormato.js');
  assert.equal(textoNif('B00123455'), 'NIF B00123455');
  assert.equal(textoNif('TEMP00996'), 'sin NIF publicado');
  assert.equal(textoNif('B00000000'), 'sin NIF publicado');
  assert.equal(textoNif(null), 'sin NIF publicado');
});

test('should_show_the_band_and_territory_of_a_ranking_with_the_name_from_the_server', async () => {
  const { textoBanda, origenBanda } = await import('./competenciaFormato.js');

  assert.equal(
    textoBanda({ banda: { min: 7_000, max: 130_000, origen: 'ajuste' }, nuts: 'ES7', territorio: 'Canarias' }),
    'Banda 7-130 k€ · Canarias',
  );
  assert.equal(
    textoBanda({ banda: { min: 27_500, max: 92_000, origen: 'propia' }, nuts: 'ES3' }),
    'Banda 27,5-92 k€ · NUTS ES3',
  );
  assert.equal(textoBanda({ banda: null, nuts: null }), 'Todos los importes · Toda España');
  assert.equal(
    textoBanda({ banda: { min: 1_000_000, max: 1e10, origen: 'pedida' }, nuts: null }),
    'Desde 1000 k€ · Toda España',
  );
  assert.equal(
    textoBanda({ banda: { min: 0, max: 50_000, origen: 'pedida' }, nuts: 'ES30', territorio: 'Comunidad de Madrid' }),
    'Hasta 50 k€ · Comunidad de Madrid',
  );
  assert.equal(textoBanda(null), '');
  assert.match(origenBanda({ origen: 'ajuste' }), /menos de 5 presentadas: la banda de la escala/);
  assert.match(origenBanda({ origen: 'propia' }), /percentiles/i);
});

test('should_append_the_next_page_without_repeating_a_nif', async () => {
  const { unirPagina } = await import('./competenciaFormato.js');
  const primera = { kind: 'ready', items: [{ nif: 'A' }, { nif: 'B' }], total: 3, siguiente: 2 };

  const unida = unirPagina(primera, { items: [{ nif: 'B' }, { nif: 'C' }], total: 3, siguiente: null });

  assert.deepEqual(
    unida.items.map((i) => i.nif),
    ['A', 'B', 'C'],
  );
  assert.equal(unida.siguiente, null);
  assert.equal(unida.kind, 'ready');
  assert.deepEqual(unirPagina(primera, null).items.length, 2);
});
