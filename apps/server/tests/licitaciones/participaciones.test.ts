// Participaciones: una fila «adjudicataria» por adjudicación con NIF válido, sin el nombre
// de las personas físicas, resembrada con cada versión, completada por un acta sin perder lo de la
// PLACSP y rellenada una vez al abrir una base anterior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { abrirLicitaciones, guardarLicitacion } from '../../src/dominios/licitaciones/store.js';
import { guardarParticipacion, participacionesDe } from '../../src/dominios/licitaciones/participaciones.js';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { licitacionSintetica, resultadoSintetico as resultado, type Resultado } from '../helpers/licitacion.js';

function base(): ReturnType<typeof abrirLicitaciones> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'participaciones-'));
  abrirNucleo(dir).close();
  return abrirLicitaciones(dir);
}

function licitacion(resultados: Resultado[], actualizada = '2026-03-02T10:00:00Z') {
  return licitacionSintetica({ resultados, actualizada_en: actualizada });
}

test('should_seed_one_awarded_row_per_award_with_a_valid_nif', () => {
  const db = base();
  guardarLicitacion(
    db,
    licitacion([
      resultado({}),
      resultado({ lote: '2', adjudicatario_nif: 'B12345678', adjudicatario_nombre: 'NIF mal escrito SL' }),
      resultado({ lote: '3', codigo: '4', adjudicatario_nif: 'A00000075' }),
      resultado({ lote: '4', adjudicatario_nif: '12345678Z', adjudicatario_nombre: 'Persona A' }),
    ]),
  );
  const filas = participacionesDe(db, 'p-1');
  assert.deepEqual(
    filas.map((f) => [f.lote, f.empresa_nif, f.empresa_nombre, f.rol, f.importe_ofertado, f.fuente]),
    [
      ['', 'B00765438', 'Sistemas Ejemplo SA', 'adjudicataria', 80_000, 'placsp'],
      ['4', '12345678Z', null, 'adjudicataria', 80_000, 'placsp'],
    ],
  );
});

test('should_reseed_from_the_placsp_and_keep_what_an_acta_added', () => {
  const db = base();
  guardarLicitacion(db, licitacion([resultado({})]));
  guardarParticipacion(db, {
    licitacion_id: 'p-1',
    lote: '',
    empresa_nif: 'A00000075',
    empresa_nombre: 'Analítica Ejemplo SL',
    rol: 'licitadora',
    importe_ofertado: 85_000,
    puntos_tecnicos: 40,
    puntos_economicos: 45,
    fuente: 'acta',
    documento: 'acta.pdf',
    confianza: 0.9,
  });
  guardarParticipacion(db, {
    licitacion_id: 'p-1',
    lote: '',
    empresa_nif: 'B00765438',
    rol: 'licitadora',
    importe_ofertado: null,
    puntos_tecnicos: 48,
    puntos_economicos: 50,
    fuente: 'acta',
    confianza: 0.9,
  });
  guardarLicitacion(db, licitacion([resultado({ importe_sin_iva: 79_000 })], '2026-03-05T10:00:00Z'));
  const filas = participacionesDe(db, 'p-1');
  assert.deepEqual(
    filas.map((f) => [f.empresa_nif, f.rol, f.importe_ofertado, f.puntos_tecnicos, f.fuente]),
    [
      ['B00765438', 'adjudicataria', 79_000, 48, 'acta'],
      ['A00000075', 'licitadora', 85_000, 40, 'acta'],
    ],
  );
});

test('should_backfill_participations_once_when_opening_an_older_database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'participaciones-vieja-'));
  abrirNucleo(dir).close();
  abrirLicitaciones(dir).close();
  const vieja = new Database(path.join(dir, 'licitaciones.db'));
  vieja.exec(`DROP TABLE participaciones;
    INSERT INTO adjudicaciones (licitacion_id, lote, resultado, adjudicatario_nif, adjudicatario_nombre, importe_sin_iva, ord, fecha_ref, nif_valido)
    VALUES ('p-9', '', '9', 'ESB00765438', 'Sistemas Ejemplo', 50000, 0, '2025-01-01', NULL);
    PRAGMA user_version = 14;`);
  vieja.close();
  const db = abrirLicitaciones(dir);
  assert.deepEqual(
    participacionesDe(db, 'p-9').map((f) => [f.empresa_nif, f.rol, f.fecha_ref]),
    [['B00765438', 'adjudicataria', '2025-01-01']],
  );
});
