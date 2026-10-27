import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esAbrirPresentada, puedePedirCambios, sugerirPresentada } from './subidaVersionFormato.js';
import { textoSubida } from './memoriaFormato.js';

const AVISO =
  'Guardada entera: no se encontraron los títulos del guion; «Pedir cambios» por apartado no está disponible para esta versión.';

test('should_tell_that_the_version_was_stored_whole_with_the_server_warning', () => {
  assert.equal(
    textoSubida({ version: 3, reconocidos: 0, total: 5, avisos: [AVISO], sin_repartir: true, aprende: true }),
    `Subida como v3, entera (sin repartir por apartados). Hermes la evalúa ahora y saca lecciones de tus cambios. ${AVISO}`,
  );
  assert.doesNotMatch(
    textoSubida({ version: 3, reconocidos: 0, total: 5, avisos: [AVISO], sin_repartir: true }),
    /0 de 5/,
  );
});

test('should_suggest_uploading_as_presentada_only_when_presented_or_past_the_deadline', () => {
  assert.equal(sugerirPresentada({ presentada_o_vencida: true }), true);
  assert.equal(sugerirPresentada({ presentada_o_vencida: false }), false);
  assert.equal(sugerirPresentada(null), false);
});

test('should_not_offer_asking_for_changes_on_a_whole_trial_or_hand_uploaded_version', () => {
  const progreso = { fase: 'fin' };
  assert.equal(puedePedirCambios({ estado: 'ensamblada', progreso }), true);
  assert.equal(puedePedirCambios({ estado: 'ensamblada', progreso, sin_repartir: true }), false);
  assert.equal(puedePedirCambios({ estado: 'ensamblada', progreso, ensayo: true }), false);
  assert.equal(puedePedirCambios({ estado: 'ensamblada', progreso: null }), false, 'subida a mano: sin progreso');
  assert.equal(puedePedirCambios({ estado: 'redactando', progreso }), false);
  assert.equal(puedePedirCambios(null), false);
});

test('should_open_only_the_presentada_panel_of_the_same_licitacion_and_lote', () => {
  assert.equal(esAbrirPresentada({ id: 'L1', lote: null }, 'L1'), true);
  assert.equal(esAbrirPresentada({ id: 'L1', lote: '2' }, 'L1', '2'), true);
  assert.equal(
    esAbrirPresentada({ id: 'L1', lote: '2' }, 'L1', '4'),
    false,
    'memoria por lote: el del lote 4 no se abre',
  );
  assert.equal(esAbrirPresentada({ id: 'L1', lote: '2' }, 'L1'), false, 'ni la común');
  assert.equal(esAbrirPresentada({ id: 'L2', lote: null }, 'L1'), false);
  assert.equal(esAbrirPresentada('L1', 'L1'), false);
});
