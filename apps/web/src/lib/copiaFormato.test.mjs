import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoCopia } from './copiaFormato.js';

const ACTIVA = {
  activa: true,
  motivo: null,
  hora: 4,
  conservarDias: 30,
  plataforma: 'semanal',
  ultima: '2026-10-03T02:01:00Z',
  ultimaPlataforma: '2026-09-28T02:01:00Z',
};
// Hoy a las 10:00 UTC: la última copia de ACTIVA es de hace 8 horas.
const AHORA = Date.parse('2026-10-03T10:00:00Z');
const HORA = 3_600_000;

test('should_say_unknown_when_drive_sync_has_not_reported_yet', () => {
  const r = estadoCopia(null);
  assert.equal(r.estado, 'desconocida');
  assert.match(r.lineas[0], /aún no ha informado/);
});

test('should_show_reason_when_backup_is_disabled', () => {
  const r = estadoCopia({ ...ACTIVA, activa: false, motivo: 'GDRIVE_BACKUP=0', ultima: null });
  assert.equal(r.estado, 'desactivada');
  assert.match(r.lineas[0], /desactivada \(GDRIVE_BACKUP=0\)/);
  assert.match(r.lineas[1], /copia del VPS/);
  assert.equal(r.lineas.length, 2);
});

test('should_show_last_copy_still_in_drive_when_backup_is_disabled', () => {
  const r = estadoCopia({ ...ACTIVA, activa: false, motivo: 'GDRIVE_BACKUP=0' }, AHORA);
  assert.equal(r.estado, 'desactivada');
  assert.match(r.lineas[2], /^Última copia: .*2026.*sigue en Drive → Copias de seguridad hasta que la borres\.$/);
});

test('should_warn_when_active_backup_is_more_than_26_hours_old', () => {
  const r = estadoCopia(ACTIVA, Date.parse(ACTIVA.ultima) + 27 * HORA);
  assert.equal(r.estado, 'atrasada');
  assert.match(r.lineas[0], /no se hace desde el .*2026.*logs de drive-sync/);
  assert.match(r.lineas[1], /^Copia de seguridad a Drive activa/);
});

test('should_not_warn_within_26_hours_of_the_last_backup', () => {
  assert.equal(estadoCopia(ACTIVA, Date.parse(ACTIVA.ultima) + 25 * HORA).estado, 'activa');
});

test('should_not_warn_when_no_backup_was_made_yet', () => {
  assert.equal(estadoCopia({ ...ACTIVA, ultima: null }, AHORA).estado, 'activa');
});

test('should_show_schedule_and_last_backup_when_active', () => {
  const r = estadoCopia(ACTIVA, AHORA);
  assert.equal(r.estado, 'activa');
  assert.match(r.lineas[0], /desde las 4:00, se conservan 30 días/);
  assert.match(r.lineas[1], /^Última copia: .*2026/);
  assert.match(r.lineas[2], /una vez por semana \(última: .*2026.*\)\.$/);
});

test('should_say_when_no_backup_was_made_yet', () => {
  const r = estadoCopia({ ...ACTIVA, ultima: null, ultimaPlataforma: null }, AHORA);
  assert.equal(r.lineas[1], 'Aún no se ha hecho ninguna copia.');
  assert.equal(r.lineas[2], 'Bases de datos de la plataforma: una vez por semana.');
});

test('should_not_show_last_platform_copy_when_platform_is_excluded', () => {
  const r = estadoCopia({ ...ACTIVA, plataforma: 'no' }, AHORA);
  assert.equal(r.lineas[2], 'Bases de datos de la plataforma: no se copian.');
});
