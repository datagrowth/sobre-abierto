import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filasEncaje, resumenEncaje, textoEncaje, textoPeso } from './encajeFormato.js';

const ENCAJE = {
  valor: 82,
  elegible: true,
  etiqueta: null,
  componentes: [
    { clave: 'tematica', etiqueta: 'Temática', peso: 0.3, valor: 92, detalle: 'Hermes: interesa', de_hermes: true },
    {
      clave: 'economia',
      etiqueta: 'Economía',
      peso: 0.15,
      valor: null,
      detalle: 'Pocas ofertas ganadas',
      de_hermes: false,
    },
  ],
};

test('should_say_the_encaje_with_its_closure_when_not_eligible', () => {
  assert.equal(textoEncaje(ENCAJE), 'Encaje 82');
  assert.equal(
    textoEncaje({ ...ENCAJE, valor: 20, elegible: false, etiqueta: 'no elegible' }),
    'Encaje 20 · no elegible',
  );
  assert.equal(textoEncaje({ ...ENCAJE, valor: null }), null);
  assert.equal(textoEncaje(null), null);
});

test('should_list_eligibility_first_and_mark_components_without_data', () => {
  const filas = filasEncaje(ENCAJE);
  assert.deepEqual(
    filas.map((f) => [f.etiqueta, f.peso]),
    [
      ['Elegibilidad', 'cierre'],
      ['Temática', '0,30'],
      ['Economía', '0,15'],
    ],
  );
  assert.deepEqual(filas[0].chip, { texto: 'Cumple', tono: 'ok' });
  assert.equal(filas[1].chip, null);
  assert.deepEqual(filas[2].chip, { texto: 'Sin datos', tono: 'neutro' });
  assert.equal(filasEncaje({ ...ENCAJE, elegible: false }).at(0).chip.texto, 'No elegible');
});

test('should_write_weights_with_a_decimal_comma', () => {
  assert.equal(textoPeso(0.1), '0,10');
});

test('should_sum_up_the_breakdown_in_one_line_for_the_list', () => {
  assert.equal(resumenEncaje(ENCAJE), 'Temática 92 · Economía sin datos');
  assert.equal(resumenEncaje(null), '');
});
