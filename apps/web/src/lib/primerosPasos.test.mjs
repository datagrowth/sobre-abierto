import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faltaPonerEnMarcha, pasosPrimerArranque } from './primerosPasos.js';

const HECHO = {
  empresa: { perfil: { nombre: 'Analítica Ejemplo, S.L.' } },
  prefiltro: { de_ejemplo: false },
  estado: { hermes: 'configurado' },
  drive: { connected: false },
};
const hechos = (pasos) => pasos.filter((p) => p.hecho).map((p) => p.clave);

test('should_mark_nothing_done_on_a_fresh_install', () => {
  // Arrange
  const nueva = {
    empresa: { perfil: null },
    prefiltro: { de_ejemplo: true },
    estado: { hermes: 'sin configurar (HERMES_LICITACIONES_URL y HERMES_LICITACIONES_KEY)' },
    drive: { connected: false },
  };

  // Act
  const pasos = pasosPrimerArranque(nueva);

  // Assert
  assert.deepEqual(hechos(pasos), []);
  assert.equal(faltaPonerEnMarcha(pasos), true);
});

test('should_leave_every_step_undone_while_the_data_has_not_arrived', () => {
  assert.deepEqual(hechos(pasosPrimerArranque({})), []);
  assert.deepEqual(hechos(pasosPrimerArranque({ empresa: null, prefiltro: null, estado: null, drive: null })), []);
});

test('should_not_ask_for_drive_to_finish_the_setup', () => {
  // Act
  const pasos = pasosPrimerArranque(HECHO);

  // Assert
  assert.deepEqual(hechos(pasos), ['empresa', 'filtros', 'ia']);
  assert.equal(faltaPonerEnMarcha(pasos), false);
  assert.equal(pasos.find((p) => p.clave === 'drive').opcional, true);
});

test('should_still_ask_for_the_filters_while_they_are_the_example', () => {
  const pasos = pasosPrimerArranque({ ...HECHO, prefiltro: { de_ejemplo: true } });
  assert.deepEqual(hechos(pasos), ['empresa', 'ia']);
  assert.equal(faltaPonerEnMarcha(pasos), true);
});

test('should_point_each_step_to_the_settings_tab_that_does_it', () => {
  const destinos = Object.fromEntries(pasosPrimerArranque(HECHO).map((p) => [p.clave, p.destino]));
  assert.deepEqual(destinos, {
    empresa: ['ajustes', 'empresa'],
    filtros: ['ajustes', 'fuentes'],
    ia: ['ajustes', 'hermes'],
    drive: ['ajustes', 'drive'],
  });
});
