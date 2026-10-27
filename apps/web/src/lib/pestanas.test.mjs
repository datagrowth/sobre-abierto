import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opcionFuera, pestanaEnfocable } from './pestanas.js';

const VISTAS = [
  { key: 'oportunidades', label: 'Oportunidades' },
  { key: 'ofertas', label: 'Presentadas' },
];

test('should_focus_the_open_tab_or_the_first_one_when_none_is_open', () => {
  assert.equal(pestanaEnfocable(VISTAS, 'ofertas'), 'ofertas');
  assert.equal(pestanaEnfocable(VISTAS, 'ajustes'), 'oportunidades', 'en Ajustes el teclado entra por la primera');
  assert.equal(pestanaEnfocable(VISTAS, null), 'oportunidades');
  assert.equal(pestanaEnfocable([], 'ajustes'), null);
});

test('should_add_a_select_option_only_for_a_view_outside_the_tabs', () => {
  assert.equal(opcionFuera(VISTAS, 'oportunidades'), null);
  assert.deepEqual(opcionFuera(VISTAS, 'ajustes'), { key: 'ajustes', label: 'Ajustes' });
  assert.deepEqual(opcionFuera(VISTAS, 'otra'), { key: 'otra', label: '' });
  assert.deepEqual(opcionFuera(VISTAS, null), { key: '', label: '' });
});
