import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  destinoDeAccion,
  nombreLegible,
  ordenar,
  resumenCuentas,
  textoLeccionAplicada,
  totalDocumentos,
} from './revisionSobresFormato.js';

test('should_summarise_what_is_left_most_urgent_first', () => {
  assert.equal(
    resumenCuentas({ impide: 2, riesgo: 1, pendiente: 0, correcto: 7 }),
    '2 impiden · 1 riesgo · 7 correctas',
  );
  assert.equal(resumenCuentas({ impide: 0, riesgo: 0, pendiente: 1, correcto: 1 }), '1 pendiente · 1 correcta');
  assert.equal(resumenCuentas({ impide: 0, riesgo: 0, pendiente: 0, correcto: 0 }), 'Sin comprobaciones');
});

test('should_lower_names_written_in_capitals', () => {
  assert.equal(
    nombreLegible('COMPROMISO DE ADSCRIPCIÓN DE MEDIOS AL CONTRATO'),
    'Compromiso de adscripción de medios al contrato',
  );
  assert.equal(nombreLegible('Memoria técnica'), 'Memoria técnica');
  assert.equal(nombreLegible(null), '');
});

test('should_send_each_action_to_its_row_or_piece', () => {
  assert.deepEqual(destinoDeAccion({ texto: 'Suavizar', bloqueo: 'compromiso_caro:-:x', destino: null }), {
    bloqueo: 'compromiso_caro:-:x',
  });
  assert.deepEqual(destinoDeAccion({ texto: 'Kit de firma', bloqueo: null, destino: 'kit_firma' }), {
    testid: 'pie-comprobaciones',
  });
  assert.deepEqual(destinoDeAccion({ texto: 'Pedir cambios', bloqueo: null, destino: 'memoria' }), {
    cajon: 'memoria',
  });
  assert.equal(destinoDeAccion(null), null);
});

test('should_put_what_blocks_first_and_accepted_risks_with_the_correct_ones', () => {
  const c = (clave, estado, aceptado = false) => ({ clave, estado, aceptado });
  assert.deepEqual(
    ordenar([c('a', 'correcto'), c('b', 'riesgo', true), c('c', 'impide'), c('d', 'pendiente')]).map((x) => x.clave),
    ['c', 'd', 'a', 'b'],
  );
  assert.equal(totalDocumentos({ sobres: [{ documentos: [1, 2] }, { documentos: [3] }] }), 3);
});

test('should_say_where_a_lesson_was_applied_and_what_the_critic_says', () => {
  assert.equal(textoLeccionAplicada({ apartados: [2], cumplida: true }), 'apartado 2 · el crítico la ve cumplida');
  assert.equal(
    textoLeccionAplicada({ apartados: [1, 3, 4], cumplida: false }),
    'apartados 1, 3 y 4 · el crítico no la ve cumplida',
  );
  assert.equal(textoLeccionAplicada({ apartados: [5], cumplida: null }), 'apartado 5 · sin comprobar');
});
