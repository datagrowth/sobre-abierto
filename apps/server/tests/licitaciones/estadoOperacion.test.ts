// Avisos de operación de Ajustes › Estado: «al día» solo si la ingesta trae novedades,
// y la criba con más de un 20 % de lotes fallidos en 7 días no pasa en silencio.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estado-operacion-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { abrirLicitaciones, guardarSyncEstado } = await import('../../src/dominios/licitaciones/store.js');
const { alDiaHasta, alertasOperacion } = await import('../../src/dominios/licitaciones/index.js');

abrirNucleo(tmp).close();
const db = abrirLicitaciones(tmp);
const AHORA = Date.parse('2026-10-15T10:00:00Z');

after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sync = (fuente: string, hasta: string | null) =>
  guardarSyncEstado(db, {
    fuente,
    hasta,
    ultima_vuelta: '2026-10-15T09:55:00Z',
    last_modified: null,
    ultimo_error: null,
    entradas: 0,
  });
const lote = (estado: string, creado: string) =>
  db.prepare("INSERT INTO lotes_criba (ids, estado, creado_en) VALUES ('[]', ?, ?)").run(estado, creado);

const PERFILES = 'Perfiles de contratante (Estado y organismos adheridos)';
const AGREGADAS = 'Plataformas agregadas (comunidades autónomas y entidades locales)';

test('should_warn_per_source_when_perfiles_brings_nothing_for_6_hours_even_if_agregadas_published', () => {
  // Arrange: la última vuelta es de hace 5 min; perfiles no trae nada desde el lunes por la tarde
  // y agregadas publicó su lote de madrugada (PLACSP, 19-21/10/2026).
  sync('perfiles', '2026-10-13T20:08:00+02:00');
  sync('agregadas', '2026-10-15T01:00:00Z');

  // Act
  const activa = alertasOperacion(db, true, AHORA);
  const parada = alertasOperacion(db, false, AHORA);

  // Assert: con la ingesta parada ya lo dice otro aviso.
  assert.equal(alDiaHasta(db), '2026-10-15T01:00:00.000Z');
  assert.deepEqual(activa, [
    {
      motivo: 'ingesta_sin_novedades',
      desde: '2026-10-13T18:08:00.000Z',
      fuente: 'perfiles',
      nombre: PERFILES,
      horas: 6,
      al_dia: [AGREGADAS],
    },
  ]);
  assert.deepEqual(parada, []);
});

test('should_give_agregadas_a_day_before_warning_because_it_publishes_once_at_night', () => {
  // Arrange: 26 h sin lote de agregadas es normal; 31 h, no.
  sync('perfiles', '2026-10-15T09:30:00Z');
  sync('agregadas', '2026-10-14T08:00:00Z');
  assert.deepEqual(alertasOperacion(db, true, AHORA), []);

  // Act
  sync('agregadas', '2026-10-14T03:00:00Z');
  const a = alertasOperacion(db, true, AHORA);

  // Assert
  assert.deepEqual(
    a.map((x) => x.motivo === 'ingesta_sin_novedades' && [x.fuente, x.horas, x.al_dia]),
    [['agregadas', 30, [PERFILES]]],
  );
});

test('should_not_warn_when_every_source_brought_news_recently', () => {
  sync('agregadas', '2026-10-15T07:30:00Z');
  assert.deepEqual(alertasOperacion(db, true, AHORA), []);
});

test('should_warn_when_screening_failures_exceed_20_percent', () => {
  // Arrange: 1 de 4 en la semana (25 %); el fallido viejo y el abierto no cuentan.
  for (const e of ['cribado', 'cribado', 'cribado', 'fallido']) lote(e, '2026-10-12T10:00:00Z');
  lote('fallido', '2026-09-01T10:00:00Z');
  lote('abierto', '2026-10-15T09:00:00Z');

  // Act
  const a = alertasOperacion(db, true, AHORA);

  // Assert
  assert.deepEqual(a, [{ motivo: 'criba_con_fallos', fallidos: 1, total: 4 }]);
});

test('should_not_warn_when_screening_failures_are_at_most_20_percent', () => {
  lote('cribado', '2026-10-13T10:00:00Z');
  assert.deepEqual(alertasOperacion(db, true, AHORA), [], '1 de 5: el 20 % justo no avisa');
});
