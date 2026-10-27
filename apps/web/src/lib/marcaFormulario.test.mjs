import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formularioAMarca, marcaAFormulario, TOKENS_MARCA, variablesDelTema } from './marcaFormulario.js';
import { PALETA } from './tema.js';

test('should_offer_every_color_of_the_palette_with_its_neutral_value', () => {
  assert.equal(TOKENS_MARCA.length, Object.keys(PALETA).length);
  assert.deepEqual(
    TOKENS_MARCA.find((t) => t.token === 'tinta'),
    { token: 'tinta', nombre: 'Texto', neutro: PALETA['--so-tinta'] },
  );
});

test('should_send_only_the_colors_that_change_and_round_trip_a_brand', () => {
  const marca = { nombre: 'Acme · Licitaciones', tema: { tinta: '#263B4A', accion: '#B5FF82' } };
  const f = marcaAFormulario(marca);
  assert.equal(f.colores.lienzo, PALETA['--so-lienzo']);
  assert.deepEqual(formularioAMarca(f), { marca, errores: [] });
  assert.deepEqual(
    formularioAMarca({ ...f, colores: { ...f.colores, accion: PALETA['--so-accion'].toLowerCase() } }).marca.tema,
    { tinta: '#263B4A' },
    'volver al neutro lo quita',
  );
});

test('should_flag_an_empty_name_and_a_malformed_color', () => {
  const f = marcaAFormulario(null);
  const { errores } = formularioAMarca({ ...f, nombre: ' ', colores: { ...f.colores, tinta: '#FFF' } });
  assert.deepEqual(errores, ['Escribe el nombre de la aplicación.', 'Texto: escribe el color como #RRGGBB.']);
});

test('should_list_every_css_variable_with_null_for_the_neutral_ones', () => {
  const v = Object.fromEntries(variablesDelTema({ tinta: '#263B4A' }));
  assert.equal(v['--so-tinta'], '#263B4A');
  assert.equal(v['--so-lienzo'], null);
});
