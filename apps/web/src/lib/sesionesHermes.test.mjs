import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etiquetaSesion, normalizeSession, sortSessionsByActivity, filterSessions } from './sesionesHermes.js';

const sessions = [
  { id: 'cli_1', source: 'cli', title: 'CLI work', last_active: 100, message_count: 4 },
  { id: 'tg_1', source: 'telegram', title: '', preview: 'Hola desde Telegram', last_active: 300, message_count: 8 },
  { id: 'gw_1', source: 'gateway', title: 'Gateway job', last_active: 200, message_count: 2 },
];

assert.equal(normalizeSession({ id: 'x', last_active: 1779948453 }).lastActiveMs, 1779948453000);
assert.equal(normalizeSession({ id: 'x', last_active: 1779948453000 }).lastActiveMs, 1779948453000);
assert.equal(sortSessionsByActivity(sessions)[0].id, 'tg_1');
assert.deepEqual(
  filterSessions(sessions, { source: 'telegram' }).map((s) => s.id),
  ['tg_1'],
);
assert.deepEqual(
  filterSessions(sessions, { query: 'gateway' }).map((s) => s.id),
  ['gw_1'],
);

test('should_name_the_hermes_profile_of_a_session_and_date_it_by_its_start', () => {
  assert.equal(etiquetaSesion({ source: 'api', profile: 'oferta-licitaciones' }), 'Oferta licitaciones · API');
  assert.equal(etiquetaSesion({ source: 'telegram' }), 'Telegram');
  assert.equal(
    etiquetaSesion({ source: 'api_server', profile: 'oferta-licitaciones' }),
    'Oferta licitaciones · Plataforma',
    'las tareas de la plataforma, sin jerga',
  );
  assert.equal(normalizeSession({ id: 'x', started_at: 1_790_000_000 }).lastActiveMs, 1_790_000_000_000);
});
