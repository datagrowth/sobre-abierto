// Calidad del dato: cada regla deja su incidencia, lo que tiene incidencia (salvo el NIF) no
// entra en los comparables de los índices, el recuento de Ajustes › Fuentes y el relleno de una base anterior.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { abrirLicitaciones, guardarLicitacion } from '../../src/dominios/licitaciones/store.js';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { resumenCalidad } from '../../src/dominios/licitaciones/calidad.js';
import { comparablesDe } from '../../src/dominios/licitaciones/indices/comparables.js';
import { plausible } from '../../src/dominios/licitaciones/precios/segmento.js';
import { licitacionSintetica, resultadoSintetico } from '../helpers/licitacion.js';

const HOY = new Date().toISOString();
const reciente = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);

function base(): { dir: string; db: ReturnType<typeof abrirLicitaciones> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'calidad-'));
  abrirNucleo(dir).close();
  return { dir, db: abrirLicitaciones(dir) };
}

const lote = (id: string, presupuesto: number | null) => ({
  id,
  nombre: `Lote ${id}`,
  presupuesto_sin_iva: presupuesto,
  cpvs: [],
});

function conIncidencias(id = 'p-1') {
  return licitacionSintetica({
    id,
    cpvs: ['72267000'],
    presupuesto_sin_iva: 500_000,
    lotes: [
      lote('1', 100_000),
      lote('2', 100_000),
      lote('3', 100_000),
      lote('4', 100_000),
      lote('5', null),
      lote('6', 100_000),
    ],
    resultados: [
      resultadoSintetico({ lote: '1', importe_sin_iva: 130_000, fecha: reciente }),
      resultadoSintetico({ lote: '2', importe_sin_iva: 20_000, fecha: reciente }),
      resultadoSintetico({ lote: '3', ofertas: 0, fecha: reciente }),
      resultadoSintetico({ lote: '4', adjudicatario_nif: 'B12345678', fecha: reciente }),
      resultadoSintetico({ lote: '6', importe_sin_iva: 85_000, fecha: reciente }),
    ],
  });
}

test('should_flag_each_quality_rule_when_saving_a_tender', () => {
  const { db } = base();
  guardarLicitacion(db, conIncidencias());
  const filas = db.prepare('SELECT lote, regla FROM calidad_incidencias ORDER BY lote, regla').all() as {
    lote: string;
    regla: string;
  }[];
  assert.deepEqual(
    filas.map((f) => [f.lote, f.regla]),
    [
      ['1', 'sobre_presupuesto'],
      ['2', 'baja_excesiva'],
      ['3', 'cero_ofertas'],
      ['4', 'nif_no_valido'],
      ['5', 'lote_sin_importe'],
    ],
  );
  guardarLicitacion(db, { ...conIncidencias(), actualizada_en: '2026-03-05T10:00:00Z', resultados: [] });
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM calidad_incidencias').get() as { n: number }).n,
    1,
    'se rehacen con cada versión',
  );
});

test('should_keep_rows_with_incidents_out_of_the_comparables_except_an_invalid_nif', () => {
  const { db } = base();
  guardarLicitacion(db, conIncidencias());
  const m = comparablesDe(db, {
    tipo: '2',
    cpv: '72267000',
    presupuesto: 100_000,
    procedimiento: '1',
    organo_nif: null,
    referencia: HOY,
    excluir: null,
  });
  assert.deepEqual(m.comparables.map((c) => c.lote).sort(), ['4', '6']);
  assert.equal(m.comparables.find((c) => c.lote === '4')?.adjudicatario_nif, null);
});

test('should_count_incidents_by_rule_with_examples_for_the_sources_tab', () => {
  const { db } = base();
  guardarLicitacion(db, conIncidencias());
  const r = resumenCalidad(db);
  assert.deepEqual(
    r.incidencias.map((i) => [i.regla, i.n]),
    [
      ['sobre_presupuesto', 1],
      ['baja_excesiva', 1],
      ['cero_ofertas', 1],
      ['nif_no_valido', 1],
      ['lote_sin_importe', 1],
    ],
  );
  assert.equal(r.incidencias[0]?.ejemplos[0]?.titulo, 'Servicio');
  assert.equal(r.fuera_de_indices, 3);
  assert.equal(r.pliegos_ilegibles.n, 0);
});

test('should_treat_an_award_with_zero_offers_as_not_plausible', () => {
  assert.equal(plausible(0.1, 0), false);
  assert.equal(plausible(0.1, null), true);
  assert.equal(plausible(0.1, 3), true);
});

test('should_backfill_incidents_once_when_opening_an_older_database', () => {
  const { dir, db } = base();
  guardarLicitacion(db, conIncidencias());
  db.close();
  const vieja = new Database(path.join(dir, 'licitaciones.db'));
  vieja.exec('DELETE FROM calidad_incidencias; PRAGMA user_version = 17;');
  vieja.close();
  const reabierta = abrirLicitaciones(dir);
  assert.equal((reabierta.prepare('SELECT COUNT(*) AS n FROM calidad_incidencias').get() as { n: number }).n, 5);
});
