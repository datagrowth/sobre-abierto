// Auditoría de cobertura por comunidad: semanas cerradas en hora peninsular, solo lo de
// el sector de la empresa, agregada y perfiles por separado, y la comparación con lo apuntado de cada
// plataforma autonómica con el umbral del 5 %.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import {
  anotarAutonomica,
  falta,
  informeCobertura,
  lunesDe,
  semanasCerradas,
  vueltaCobertura,
} from '../../src/dominios/licitaciones/cobertura.js';
import { licitacion, type Sintetica } from '../helpers/sinteticas.js';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-cobertura-'));
const abiertas: Db[] = [];
after(() => {
  abiertas.forEach((d) => d.close());
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Jueves 22 de octubre de 2026: la última semana cerrada empieza el lunes 12.
const JUEVES = Date.parse('2026-10-22T10:00:00Z');

type Caso = Sintetica & { nuts: string | null; fuente: 'agregadas' | 'perfiles' };

function conLicitaciones(casos: Caso[]): Db {
  const dir = path.join(tmp, String(abiertas.length + 1));
  abrirNucleo(dir).close();
  const db = abrirLicitaciones(dir);
  abiertas.push(db);
  for (const c of casos) guardarLicitacion(db, { ...licitacion(c), nuts: c.nuts, fuente: c.fuente });
  return db;
}

const catalana = (publicada: string, extra: Partial<Caso> = {}): Caso => ({
  titulo: 'Plataforma de datos',
  publicada,
  nuts: 'ES511',
  fuente: 'agregadas',
  ...extra,
});

test('should_return_the_monday_of_the_week_and_the_last_closed_weeks', () => {
  // Arrange / Act / Assert
  assert.equal(lunesDe('2026-10-22'), '2026-10-19');
  assert.equal(lunesDe('2026-10-19'), '2026-10-19', 'un lunes es su propio lunes');
  assert.equal(lunesDe('2026-10-25'), '2026-10-19', 'el domingo cierra la semana');
  assert.deepEqual(semanasCerradas('2026-10-22'), ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
  assert.deepEqual(semanasCerradas('2026-10-19', 1), ['2026-10-12'], 'el lunes, la semana que acaba de cerrar');
});

test('should_count_only_our_sector_by_community_and_source_in_each_closed_week', () => {
  // Arrange
  const db = conLicitaciones([
    catalana('2026-10-12'),
    catalana('2026-10-18'),
    catalana('2026-10-14', { fuente: 'perfiles' }),
    catalana('2026-10-13', { titulo: 'Obras de asfaltado', cpv: '45233222' }),
    catalana('2026-10-20'),
    { titulo: 'Cuadro de mando', publicada: '2026-10-15', nuts: 'ES705', fuente: 'agregadas' },
    { titulo: 'Analítica', publicada: '2026-10-15', nuts: null, fuente: 'perfiles' },
  ]);

  // Act
  const contadas = vueltaCobertura(db, JUEVES);
  const informe = informeCobertura(db);

  // Assert
  assert.deepEqual(contadas, ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']);
  const porComunidad = Object.fromEntries(informe.comunidades.map((c) => [c.comunidad, c]));
  assert.equal(porComunidad['ES51']?.agregadas, 2, 'la de obras no es del sector y la del 20 es de una semana abierta');
  assert.equal(porComunidad['ES51']?.perfiles, 1);
  assert.equal(porComunidad['ES51']?.nombre, 'Cataluña');
  assert.equal(porComunidad['ES70']?.agregadas, 1);
  assert.equal(porComunidad['sin_comunidad']?.perfiles, 1);
  assert.equal(informe.hasta, '2026-10-12');
});

test('should_not_count_again_while_the_last_closed_week_is_stored', () => {
  // Arrange
  const db = conLicitaciones([catalana('2026-10-12')]);
  vueltaCobertura(db, JUEVES);

  // Act
  const otraVez = vueltaCobertura(db, JUEVES + 3_600_000);
  const elLunes = vueltaCobertura(db, Date.parse('2026-10-26T08:00:00Z'));

  // Assert
  assert.deepEqual(otraVez, []);
  assert.deepEqual(
    elLunes,
    ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'],
    'el lunes cuenta la semana que cerró y repasa las de antes',
  );
});

test('should_say_add_a_source_only_when_the_aggregate_misses_more_than_5_percent', () => {
  // Arrange: la agregada trae 2 catalanas y 1 canaria esa semana.
  const db = conLicitaciones([
    catalana('2026-10-12'),
    catalana('2026-10-13'),
    { titulo: 'Cuadro de mando', publicada: '2026-10-15', nuts: 'ES705', fuente: 'agregadas' },
  ]);
  vueltaCobertura(db, JUEVES);

  // Act
  const r1 = anotarAutonomica(
    db,
    { semana: '2026-10-12', comunidad: 'ES51', publicadas: 3, fuente: 'Dades obertes de Catalunya' },
    JUEVES,
  );
  const r2 = anotarAutonomica(
    db,
    { semana: '2026-10-12', comunidad: 'ES70', publicadas: 1, fuente: 'Plataforma de Canarias' },
    JUEVES,
  );
  const informe = informeCobertura(db);

  // Assert
  assert.equal(r1.error, null);
  assert.equal(r2.error, null);
  const cat = informe.comunidades.find((c) => c.comunidad === 'ES51');
  const can = informe.comunidades.find((c) => c.comunidad === 'ES70');
  assert.equal(cat?.veredicto, 'anadir_fuente');
  assert.equal(cat?.falta, 1 / 3);
  assert.equal(can?.veredicto, 'basta_placsp');
  assert.equal(informe.comunidades[0]?.comunidad, 'ES51', 'primero lo que más falta');
});

test('should_keep_without_verdict_a_community_with_nothing_noted', () => {
  // Arrange
  const db = conLicitaciones([catalana('2026-10-12')]);
  vueltaCobertura(db, JUEVES);

  // Act
  const cat = informeCobertura(db).comunidades.find((c) => c.comunidad === 'ES51');

  // Assert
  assert.equal(cat?.veredicto, 'sin_dato');
  assert.equal(cat?.falta, null);
  assert.equal(cat?.comparadas, 0);
});

test('should_reject_noting_a_week_that_has_not_ended', () => {
  // Arrange
  const db = conLicitaciones([]);

  // Act
  const r = anotarAutonomica(
    db,
    { semana: '2026-10-19', comunidad: 'ES51', publicadas: 4, fuente: 'Dades obertes' },
    JUEVES,
  );

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
});

test('should_measure_what_is_missing_without_going_below_zero', () => {
  assert.equal(falta(9, 10), 0.1);
  assert.equal(falta(12, 10), 0, 'traer más que la autonómica no es una falta');
  assert.equal(falta(3, 0), null, 'sin cifra autonómica no hay con qué comparar');
});
