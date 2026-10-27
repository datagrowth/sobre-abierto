// Hora local de España para comparar con fecha_limite (guardada sin zona, en hora peninsular).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horaLocalEspana, instanteDeHoraEspana, isoConZonaEspana } from '../../src/nucleo/fechas.js';
import { sigueAbierta } from '../../src/dominios/licitaciones/prefiltro.js';

test('should_format_summer_time_as_utc_plus_two', () => {
  assert.equal(horaLocalEspana(Date.parse('2026-07-01T10:00:00Z')), '2026-07-01T12:00:00');
});

test('should_format_winter_time_as_utc_plus_one', () => {
  assert.equal(horaLocalEspana(Date.parse('2026-12-01T10:00:05Z')), '2026-12-01T11:00:05');
});

test('should_repeat_the_hour_from_two_to_three_on_the_october_change', () => {
  // El 25/10/2026 a las 01:00 UTC los relojes vuelven de 03:00 a 02:00.
  assert.equal(horaLocalEspana(Date.parse('2026-10-25T00:59:59Z')), '2026-10-25T02:59:59');
  assert.equal(horaLocalEspana(Date.parse('2026-10-25T01:00:00Z')), '2026-10-25T02:00:00');
  assert.equal(
    horaLocalEspana(Date.parse('2026-10-25T00:30:00Z')),
    horaLocalEspana(Date.parse('2026-10-25T01:30:00Z')),
  );
});

test('should_write_midnight_as_00_and_change_the_day_and_year', () => {
  assert.equal(horaLocalEspana(Date.parse('2026-12-31T23:30:00Z')), '2027-01-01T00:30:00');
});

test('should_not_depend_on_the_process_time_zone', () => {
  const previa = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    assert.equal(horaLocalEspana(Date.parse('2026-07-01T10:00:00Z')), '2026-07-01T12:00:00');
  } finally {
    if (previa === undefined) delete process.env.TZ;
    else process.env.TZ = previa;
  }
});

test('should_close_a_tender_once_its_local_deadline_passes_in_spain', () => {
  const l = { estado: 'PUB', fecha_limite: '2026-10-15T08:00:00', borrada_en: null };
  // 06:30 UTC son las 08:30 en Madrid: ya cerró, aunque en UTC aún no sean las 08:00.
  assert.equal(sigueAbierta(l, Date.parse('2026-10-15T06:30:00Z')), false);
  assert.equal(sigueAbierta(l, Date.parse('2026-10-15T05:30:00Z')), true);
});

test('should_turn_a_peninsular_deadline_into_its_instant_in_summer_and_winter', () => {
  assert.equal(
    instanteDeHoraEspana('2026-10-15T08:00:00'),
    Date.parse('2026-10-15T06:00:00Z'),
    'CASO_E Canarias: 08:00 peninsular, UTC+2',
  );
  assert.equal(
    instanteDeHoraEspana('2026-12-01T11:00'),
    Date.parse('2026-12-01T10:00:00Z'),
    'sin segundos, en invierno UTC+1',
  );
  assert.equal(
    instanteDeHoraEspana('2026-10-25T03:30:00'),
    Date.parse('2026-10-25T02:30:00Z'),
    'tras el cambio de hora de octubre',
  );
  assert.equal(
    instanteDeHoraEspana('2026-03-29T03:30:00'),
    Date.parse('2026-03-29T01:30:00Z'),
    'tras el cambio de hora de marzo',
  );
});

test('should_not_depend_on_the_process_time_zone_to_turn_a_deadline_into_an_instant', () => {
  const previa = process.env.TZ;
  process.env.TZ = 'Atlantic/Canary';
  try {
    assert.equal(
      instanteDeHoraEspana('2026-10-15T08:00:00'),
      Date.parse('2026-10-15T06:00:00Z'),
      'desde Canarias, el plazo sigue siendo a las 07:00 de allí',
    );
  } finally {
    if (previa === undefined) delete process.env.TZ;
    else process.env.TZ = previa;
  }
});

test('should_not_turn_a_date_without_time_or_garbage_into_an_instant', () => {
  assert.deepEqual(
    [instanteDeHoraEspana('2026-10-15'), instanteDeHoraEspana(''), instanteDeHoraEspana('mañana')],
    [null, null, null],
  );
});

test('should_give_iso_with_madrid_offset_in_summer_and_winter', () => {
  assert.equal(isoConZonaEspana('2026-10-15T08:00:00'), '2026-10-15T08:00:00+02:00', 'CASO_E: horario de verano');
  assert.equal(isoConZonaEspana('2026-11-15T08:00:00'), '2026-11-15T08:00:00+01:00', 'tras el cambio de octubre');
  assert.equal(isoConZonaEspana('2026-12-01T11:00'), '2026-12-01T11:00:00+01:00', 'sin segundos');
  assert.equal(
    Date.parse(isoConZonaEspana('2026-10-15T08:00:00')!),
    instanteDeHoraEspana('2026-10-15T08:00:00'),
    'el mismo instante',
  );
});

test('should_return_null_for_dates_without_time', () => {
  assert.deepEqual(
    [isoConZonaEspana('2026-10-15'), isoConZonaEspana(''), isoConZonaEspana('mañana')],
    [null, null, null],
  );
});
