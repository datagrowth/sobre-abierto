// «Programado»: las tareas de cron de cada perfil de Hermes leídas de sus archivos (la
// frontera: el formato es de Hermes) y los automatismos que registran los dominios.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'programado-'));
process.env.NODE_ENV = 'test';

const { cronHermes, siguiente, registrarProgramado, automatismos, marcarVuelta, ultimaVuelta } =
  await import('../../src/nucleo/programado.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function escribir(rel: string, contenido: string): void {
  const f = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenido);
}

const RESUMEN = {
  id: 'a1b2',
  name: 'Resumen matinal',
  prompt: 'Revisa las oportunidades nuevas y los plazos   de los próximos 7 días.',
  schedule: { kind: 'cron', expr: '0 8 * * 1-5', display: '0 8 * * 1-5' },
  schedule_display: 'weekdays at 8am',
  enabled: true,
  state: 'scheduled',
  next_run_at: '2026-10-05T08:00:00+02:00',
  last_run_at: '2026-10-02T08:00:03+02:00',
  last_status: 'ok',
  last_error: null,
  deliver: 'telegram',
  skills: ['licitaciones'],
  campo_nuevo_de_hermes: 1,
};

test('should_read_the_cron_jobs_of_the_main_profile_and_each_hermes_profile', () => {
  escribir(
    'cron/jobs.json',
    JSON.stringify({
      jobs: [
        { id: 'p1', prompt: 'Copia de seguridad', schedule: { expr: '0 3 * * *' }, enabled: false, paused_at: 'x' },
      ],
    }),
  );
  escribir(
    'profiles/licitaciones/cron/jobs.json',
    JSON.stringify({ jobs: [RESUMEN, { name: 'sin id' }], updated_at: 'x' }),
  );
  fs.mkdirSync(path.join(tmp, 'profiles', 'sin-cron'), { recursive: true });
  escribir('profiles/roto/cron/jobs.json', '{ esto no es json');

  const perfiles = cronHermes(tmp);
  assert.deepEqual(
    perfiles.map((p) => p.perfil),
    ['principal', 'licitaciones', 'roto', 'sin-cron'],
  );
  const [principal, lici, roto, vacio] = perfiles;
  assert.deepEqual(
    principal?.tareas.map((t) => [t.nombre, t.cuando, t.estado]),
    [['Copia de seguridad', '0 3 * * *', 'en pausa']],
    'sin nombre: el principio del prompt',
  );
  assert.equal(lici?.tareas.length, 1, 'una tarea sin id se ignora sin tumbar las demás');
  assert.deepEqual(lici?.tareas[0], {
    perfil: 'licitaciones',
    id: 'a1b2',
    nombre: 'Resumen matinal',
    que_hace: 'Revisa las oportunidades nuevas y los plazos de los próximos 7 días.',
    cuando: 'weekdays at 8am',
    estado: 'programada',
    proxima: '2026-10-05T08:00:00+02:00',
    ultima: '2026-10-02T08:00:03+02:00',
    ultimo_resultado: 'ok',
    ultimo_error: null,
    entrega: 'telegram',
  });
  assert.match(roto?.error ?? '', /No se pudo leer/);
  assert.deepEqual(vacio, { perfil: 'sin-cron', tareas: [], error: null }, 'sin archivo: sin tareas, sin error');
});

test('should_flag_jobs_that_failed_last_time', () => {
  const dir = path.join(tmp, 'otro');
  fs.mkdirSync(path.join(dir, 'cron'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'cron', 'jobs.json'),
    JSON.stringify({ jobs: [{ ...RESUMEN, last_status: 'error', last_error: 'Telegram: chat not found' }] }),
  );
  const [principal] = cronHermes(dir);
  assert.equal(principal?.tareas[0]?.estado, 'con error');
  assert.equal(principal?.tareas[0]?.ultimo_error, 'Telegram: chat not found');
  assert.deepEqual(cronHermes(path.join(tmp, 'no-existe')), [{ perfil: 'principal', tareas: [], error: null }]);
});

test('should_compute_the_next_run_from_the_last_one_or_now', () => {
  const ahora = new Date('2026-10-04T10:00:00Z');
  assert.equal(siguiente('2026-10-04T09:55:00Z', 15 * 60_000, ahora), '2026-10-04T10:10:00.000Z');
  assert.equal(siguiente(null, 60_000, ahora), '2026-10-04T10:00:00.000Z', 'nunca corrió: ya');
  assert.equal(
    siguiente('2026-10-04T08:00:00Z', 60_000, ahora),
    '2026-10-04T10:00:00.000Z',
    'atrasada: ya, no en el pasado',
  );
});

test('should_list_registered_automations_and_survive_one_that_throws', () => {
  marcarVuelta('prueba.bucle', new Date('2026-10-04T10:00:00Z'));
  registrarProgramado('prueba.bucle', () => ({
    id: 'prueba.bucle',
    dominio: 'prueba',
    nombre: 'Bucle',
    que_hace: 'Nada',
    cada: '1 min',
    ultima: ultimaVuelta('prueba.bucle'),
    proxima: null,
    estado: 'activo',
    detalle: null,
    accion: null,
  }));
  registrarProgramado('prueba.roto', () => {
    throw new Error('sin base');
  });
  const lista = automatismos();
  assert.equal(lista.find((a) => a.id === 'prueba.bucle')?.ultima, '2026-10-04T10:00:00.000Z');
  assert.match(lista.find((a) => a.id === 'prueba.roto')?.detalle ?? '', /sin base/);
});
