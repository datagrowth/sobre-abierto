// Festivos calculados por código: Pascua, las nacionales, las de cada comunidad, la sede del
// órgano y el primer día laborable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comunidadDeSede,
  domingoDePascua,
  festivosDelAnio,
  festivosEntre,
  siguienteLaborable,
} from '../../src/nucleo/festivos.js';

test('should_compute_easter_sunday_for_known_years', () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2028].map(domingoDePascua), [
    '2024-03-31',
    '2025-04-20',
    '2026-04-05',
    '2027-03-28',
    '2028-04-16',
  ]);
});

test('should_list_national_holidays_with_good_friday', () => {
  const f = festivosDelAnio(2026, null);
  assert.deepEqual(
    f.map((x) => x.fecha),
    [
      '2026-01-01',
      '2026-01-06',
      '2026-04-03',
      '2026-05-01',
      '2026-08-15',
      '2026-10-12',
      '2026-11-01',
      '2026-12-06',
      '2026-12-08',
      '2026-12-25',
    ],
  );
  assert.ok(f.every((x) => x.ambito === 'nacional'));
});

test('should_add_regional_holidays_of_the_community', () => {
  const canarias = festivosDelAnio(2026, 'CN')
    .filter((x) => x.ambito === 'autonomico')
    .map((x) => `${x.fecha} ${x.nombre}`);
  assert.deepEqual(canarias, ['2026-04-02 Jueves Santo', '2026-05-30 Día de Canarias']);
  const cataluna = festivosDelAnio(2026, 'CT')
    .filter((x) => x.ambito === 'autonomico')
    .map((x) => x.fecha);
  assert.deepEqual(
    cataluna,
    ['2026-04-06', '2026-06-24', '2026-09-11', '2026-12-26'],
    'Lunes de Pascua y sin Jueves Santo',
  );
});

test('should_skip_weekends_and_holidays_to_the_next_working_day', () => {
  assert.equal(siguienteLaborable('2026-12-08', 'MD'), '2026-12-09', 'Inmaculada, martes');
  assert.equal(siguienteLaborable('2026-12-05', 'MD'), '2026-12-07', 'sábado → lunes');
  assert.equal(siguienteLaborable('2026-05-30', 'CN'), '2026-06-01', 'sábado y Día de Canarias');
  assert.equal(siguienteLaborable('2026-11-16', null), '2026-11-16', 'un lunes laborable se queda');
  assert.equal(festivosEntre('2026-12-20', '2027-01-10', null).length, 3, 'cruza el año');
});

test('should_find_the_community_of_the_contracting_body', () => {
  assert.deepEqual(comunidadDeSede({ ciudad: 'Santa Cruz de Tenerife' }), {
    comunidad: 'CN',
    fuente: 'ciudad del órgano: Santa Cruz de Tenerife',
  });
  assert.equal(
    comunidadDeSede({ ciudad: null, nombre: 'Cabildo Insular de La Palma' })?.comunidad,
    'CN',
    'La Palma no es Palma',
  );
  assert.equal(comunidadDeSede({ nombre: 'Ayuntamiento de Palma', nuts: null })?.comunidad, 'IB');
  assert.equal(
    comunidadDeSede({ nombre: 'Entidad pública empresarial', nuts: 'ES511' })?.comunidad,
    'CT',
    'si no, el NUTS del lugar de ejecución',
  );
  assert.equal(comunidadDeSede({ nombre: 'Entidad pública empresarial' }), null);
});
