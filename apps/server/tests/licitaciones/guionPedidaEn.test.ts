// Desde cuándo trabajaba el run que dejó un guion o una ficha: el lanzamiento del run más antiguo
// del trabajo que podía seguir vivo (run_vivo_desde), no el pedida_en del payload, que no cambia
// al relanzarlo o reintentarlo, ni el último lanzado_en, que no ve un run anterior sin parar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

process.env.NODE_ENV = 'test';
const { pedidaEnDe } = await import('../../src/dominios/licitaciones/oferta/guion.js');

const db = new Database(':memory:');
db.exec("ATTACH DATABASE ':memory:' AS nucleo");
db.exec(
  'CREATE TABLE nucleo.trabajos_ia (id INTEGER PRIMARY KEY, payload TEXT NOT NULL, lanzado_en TEXT, run_vivo_desde TEXT)',
);
const trabajo = (pedida: string, vivo: string | null, lanzado: string | null = vivo) =>
  Number(
    db
      .prepare('INSERT INTO nucleo.trabajos_ia (payload, lanzado_en, run_vivo_desde) VALUES (?, ?, ?)')
      .run(JSON.stringify({ id: 'p-1', pedida_en: pedida }), lanzado, vivo).lastInsertRowid,
  );

const PEDIDA = '2026-10-14T08:00:00.000Z';
const PRIMER_RUN = '2026-10-14T08:05:00.000Z';
const RELANZADO = '2026-10-14T10:00:00.000Z';
const GUARDADO = '2026-10-14T10:20:00.000Z';

test('should_use_the_launch_of_the_run_that_saved_when_the_job_was_relaunched_after_it_ended', () => {
  assert.equal(
    pedidaEnDe(db, trabajo(PEDIDA, RELANZADO), GUARDADO),
    RELANZADO,
    'un pliego bajado a las 9 sí lo leyó el run de las 10',
  );
});

test('should_use_the_launch_of_an_earlier_run_that_was_not_confirmed_stopped', () => {
  // El run de las 8:05 se relanzó a las 10 sin poder pararlo: puede ser el que guardó a las 10:20
  // sin haber visto un anexo bajado a las 9.
  assert.equal(pedidaEnDe(db, trabajo(PEDIDA, PRIMER_RUN, RELANZADO), GUARDADO), PRIMER_RUN);
});

test('should_fall_back_to_pedida_en_when_the_result_predates_the_live_run_or_the_job_predates_the_column', () => {
  assert.equal(
    pedidaEnDe(db, trabajo(PEDIDA, '2026-10-14T11:00:00.000Z'), GUARDADO),
    PEDIDA,
    'lo guardó un run anterior: no se sabe cuándo empezó',
  );
  assert.equal(
    pedidaEnDe(db, trabajo(PEDIDA, null, RELANZADO), GUARDADO),
    PEDIDA,
    'sin run_vivo_desde (trabajo de antes de la columna)',
  );
});

test('should_use_the_save_time_without_a_linked_job_or_with_a_later_request', () => {
  assert.equal(pedidaEnDe(db, null, GUARDADO), GUARDADO);
  assert.equal(pedidaEnDe(db, 9999, GUARDADO), GUARDADO, 'trabajo borrado');
  assert.equal(pedidaEnDe(db, trabajo('2026-10-14T12:00:00.000Z', null), GUARDADO), GUARDADO);
});
