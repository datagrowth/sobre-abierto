import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cuando, tonoTarea, nombrePerfil } from './programadoFormato.js';

const AHORA = Date.parse('2026-10-04T10:00:00Z');

test('should_say_when_it_ran_and_when_it_runs_next_in_relative_words', () => {
  assert.equal(cuando('2026-10-04T09:57:00Z', AHORA), 'hace 3 min');
  assert.equal(cuando('2026-10-04T12:00:00Z', AHORA), 'dentro de 2 h');
  assert.equal(cuando('2026-10-05T10:00:00Z', AHORA), 'dentro de 1 día');
  assert.equal(cuando('2026-10-01T10:00:00Z', AHORA), 'hace 3 días');
  assert.equal(cuando('2026-10-04T10:00:20Z', AHORA), 'ahora');
  assert.equal(cuando(null, AHORA), '—');
  assert.equal(cuando('mañana', AHORA), 'mañana', 'lo que no es fecha se enseña tal cual');
});

test('should_color_hermes_jobs_by_state_and_name_profiles', () => {
  assert.equal(tonoTarea('con error'), 'error');
  assert.equal(tonoTarea('programada'), 'exito');
  assert.equal(tonoTarea('raro'), 'neutro');
  assert.equal(nombrePerfil('licitaciones'), 'Hermes (licitaciones)');
});
