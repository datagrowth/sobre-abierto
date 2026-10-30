import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alternarDestinatario, opcionesHora, textoResumen } from './avisosFormato.js';
import { fijarZonaEmpresa } from './formato.js';

// Los textos de estos tests son los de una empresa en Canarias: con la hora de allí al lado.
fijarZonaEmpresa('Atlantic/Canary');

test('should_say_when_and_to_how_many_the_summary_goes', () => {
  assert.equal(
    textoResumen({ dia: 1, hora: 8, destinatarios: [1, 2] }),
    'Los lunes a las 08:00 (hora de Canarias), a 2 personas',
  );
  assert.equal(
    textoResumen({ dia: 5, hora: 9, destinatarios: [] }),
    'Los viernes a las 09:00 (hora de Canarias), aún no llega a nadie',
  );
  assert.equal(
    textoResumen({ dia: 3, hora: 7, destinatarios: [4] }),
    'Los miércoles a las 07:00 (hora de Canarias), a 1 persona',
  );
});

test('should_show_the_peninsular_hour_next_to_the_canary_one', () => {
  assert.deepEqual(
    opcionesHora().find((o) => o.valor === 8),
    { valor: 8, texto: '08:00 (09:00 peninsular)' },
  );
});

test('should_say_only_the_peninsular_hour_for_a_peninsular_company', () => {
  fijarZonaEmpresa('Europe/Madrid');
  assert.deepEqual(
    opcionesHora().find((o) => o.valor === 8),
    { valor: 8, texto: '08:00' },
  );
  assert.equal(
    textoResumen({ dia: 1, hora: 8, destinatarios: [1] }),
    'Los lunes a las 08:00 (hora peninsular), a 1 persona',
  );
  fijarZonaEmpresa('Atlantic/Canary');
});

test('should_toggle_a_recipient', () => {
  assert.deepEqual(alternarDestinatario([1, 2], 2), [1]);
  assert.deepEqual(alternarDestinatario([1], 3), [1, 3]);
});
