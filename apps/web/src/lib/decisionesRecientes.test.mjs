import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { apuntarDecisiones, decisionesAlDia, olvidarDecisiones } from './decisionesRecientes.js';

const LEIDAS = {
  version: 5,
  datos: {
    ofertas: [
      { lote: '1', importe: 100 },
      { lote: '2', importe: 200 },
    ],
  },
};

beforeEach(olvidarDecisiones);

test('should_save_the_next_section_with_the_version_the_last_save_returned', () => {
  // Arrange: se guardó el precio del lote 1 (v5 → v6) y la oferta aún no se recargó.
  apuntarDecisiones('p-1', {
    version: 6,
    datos: {
      ofertas: [
        { lote: '1', importe: 90 },
        { lote: '2', importe: 200 },
      ],
    },
  });

  // Act
  const d = decisionesAlDia('p-1', LEIDAS);

  // Assert
  assert.equal(d.version, 6, 'sin el 409 de «otra persona guardó»');
  assert.deepEqual(
    d.datos.ofertas.map((o) => o.importe),
    [90, 200],
    'el lote 2 se guarda sobre el lote 1 ya guardado',
  );
});

test('should_use_the_reloaded_decisions_once_they_are_as_new', () => {
  // Arrange
  apuntarDecisiones('p-1', { version: 6, datos: { ofertas: [] } });
  const recargadas = { version: 7, datos: { ofertas: [{ lote: '1', importe: 80 }] } };

  // Act / Assert
  assert.equal(decisionesAlDia('p-1', recargadas), recargadas);
  assert.equal(decisionesAlDia('p-2', LEIDAS), LEIDAS, 'cada oferta, lo suyo');
});

test('should_ignore_a_response_without_version_or_an_older_one', () => {
  // Arrange
  apuntarDecisiones('p-1', { version: 6, datos: null });
  apuntarDecisiones('p-1', { version: 4, datos: { ofertas: [] } });
  apuntarDecisiones('p-1', null);

  // Act
  const d = decisionesAlDia('p-1', LEIDAS);

  // Assert
  assert.equal(d.version, 6);
  assert.deepEqual(d.datos, LEIDAS.datos, 'sin datos en la respuesta, los leídos');
});
