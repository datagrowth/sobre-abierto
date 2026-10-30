import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorDeProceso } from './listaFormato.js';

test('should_explain_a_processing_error_and_offer_retry_only_when_it_helps', () => {
  // Act
  const ficha = errorDeProceso({ codigo: 'ficha_fallida', detalle: 'sin_resultado' });
  const ilegibles = errorDeProceso({ codigo: 'pliegos_ilegibles', detalle: null });

  // Assert
  assert.deepEqual(ficha, {
    texto: 'Hermes no pudo hacer la ficha tras tres rondas',
    detalle: 'sin_resultado',
    reintentar: true,
  });
  assert.equal(ilegibles.reintentar, false, 'pedirlos otra vez no los hace legibles');
  assert.equal(errorDeProceso({ codigo: 'pliegos_error' }).texto, 'No se pudieron bajar los pliegos');
  assert.equal(errorDeProceso(null), null);
});
