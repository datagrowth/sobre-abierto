import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conResponsable, opcionesResponsable } from './responsableFormato.js';

test('should_offer_nobody_and_the_active_team_as_leads', () => {
  const equipo = [
    { id: 1, nombre: 'Elisa' },
    { id: 2, nombre: 'Paco' },
  ];
  assert.deepEqual(
    opcionesResponsable(equipo).map((o) => [o.valor, o.texto]),
    [
      ['', 'Sin responsable'],
      ['1', 'Elisa'],
      ['2', 'Paco'],
    ],
  );
});

test('should_keep_the_current_lead_in_the_options_when_not_in_the_team_list', () => {
  const o = opcionesResponsable([{ id: 1, nombre: 'Elisa' }], { id: 9, nombre: 'Quien estaba' });
  assert.deepEqual(
    o.map((x) => x.valor),
    ['', '1', '9'],
  );
  assert.deepEqual(
    opcionesResponsable([], null).map((x) => x.valor),
    [''],
    'sin equipo cargado, solo «Sin responsable»',
  );
});

test('should_show_the_lead_only_on_pipeline_offers', () => {
  assert.equal(conResponsable({ estado: 'en_preparacion' }), true);
  assert.equal(conResponsable({ estado: 'ganada' }), true);
  assert.equal(conResponsable({ estado: 'nueva' }), false);
  assert.equal(conResponsable(null), false);
});
