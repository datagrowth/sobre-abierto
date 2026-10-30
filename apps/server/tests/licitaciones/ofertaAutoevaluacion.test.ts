// Guardias de la autoevaluación y de las lecciones automáticas: la autoevaluación no se lanza
// sin tiempo, con una versión posterior aceptada ni pasado su tope diario; las lecciones esperan
// si el plazo está cerca y no pasan de 2 pedidas solas por oferta y día.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUION_CASO_A, ID, licitacionCasoA } from './fixtures/casoA.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-autoeval-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { pedirEvaluacionDeMemoria, TIPO_EVALUACION } =
  await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { pedirLecciones, TIPO_LECCIONES } = await import('../../src/dominios/licitaciones/oferta/lecciones.js');
const { limitadorLicitaciones, MOTIVO_PLAZO_CERCANO, runsDeOfertaHoy } =
  await import('../../src/dominios/licitaciones/oferta/topes.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');

iniciarNucleo();
const db = dbLicitaciones();
const ts = new Date().toISOString();
const HORA = 3_600_000;
guardarLicitacion(db, licitacionCasoA());

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ponerPlazo = (horas: number) =>
  db
    .prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?')
    .run(horaLocalEspana(Date.now() + horas * HORA), ID);
const borrarTrabajos = () => nucleo().db.prepare('DELETE FROM trabajos_ia').run();
const trabajos = (tipo: string) =>
  (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ?').get(tipo) as { n: number }).n;

const guionId = Number(
  db
    .prepare(
      'INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, ?, 1, ?)',
    )
    .run(ID, JSON.stringify(GuionBase.parse(structuredClone(GUION_CASO_A))), 'test', ts).lastInsertRowid,
);

function memoria(version: number): number {
  return Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, ?, 'ensamblada', ?)",
      )
      .run(ID, guionId, version, ts).lastInsertRowid,
  );
}
function borrador(memoriaId: number, version: number, estado: string): void {
  db.prepare(
    `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, origen, memoria_id, guion_id, version, estado)
    VALUES (?, ?, 'h', 1, 'plataforma', ?, 'ensamblado', ?, ?, ?, ?)`,
  ).run(ID, `Salidas/Licitaciones/x/memoria-v${version}.docx`, ts, memoriaId, guionId, version, estado);
}
const m = (version: number) => ({ licitacion_id: ID, version, guion_id: guionId });

test('should_not_autoevaluate_a_memory_when_the_deadline_leaves_no_time', () => {
  borrarTrabajos();
  ponerPlazo(1);
  const r = pedirEvaluacionDeMemoria(nucleo().db, db, m(1), 'Salidas/Licitaciones/x/memoria-v1.docx');
  assert.ok('omitida' in r);
  assert.match(r.omitida, /no da tiempo/);
  assert.equal(trabajos(TIPO_EVALUACION), 0);
});

test('should_autoevaluate_a_memory_when_there_is_time', () => {
  borrarTrabajos();
  ponerPlazo(72);
  const r = pedirEvaluacionDeMemoria(nucleo().db, db, m(1), 'Salidas/Licitaciones/x/memoria-v1.docx');
  assert.ok('trabajo' in r);
  assert.equal(trabajos(TIPO_EVALUACION), 1);
});

test('should_not_autoevaluate_when_a_newer_version_is_already_accepted', () => {
  borrarTrabajos();
  ponerPlazo(72);
  borrador(memoria(1), 1, 'pendiente');
  borrador(memoria(2), 2, 'aceptada');
  const r = pedirEvaluacionDeMemoria(nucleo().db, db, m(1), 'Salidas/Licitaciones/x/memoria-v1.docx');
  assert.ok('omitida' in r);
  assert.match(r.omitida, /posterior/);
  assert.equal(trabajos(TIPO_EVALUACION), 0);
});

test('should_stop_autoevaluating_after_three_in_a_day', () => {
  borrarTrabajos();
  ponerPlazo(72);
  const resultados = [3, 4, 5, 6].map((v) =>
    pedirEvaluacionDeMemoria(nucleo().db, db, m(v), `Salidas/Licitaciones/x/memoria-v${v}.docx`),
  );
  assert.deepEqual(
    resultados.map((r) => 'trabajo' in r),
    [true, true, true, false],
  );
  assert.equal(trabajos(TIPO_EVALUACION), 3);
});

test('should_hold_lessons_until_the_deadline_passes_when_it_is_close', () => {
  borrarTrabajos();
  ponerPlazo(1);
  const id = pedirLecciones(nucleo().db, { id: 1, licitacion_id: ID, version: 1 }, null);
  assert.equal(typeof id, 'number');
  const t = nucleo().db.prepare('SELECT * FROM trabajos_ia WHERE id = ?').get(id) as never;
  assert.equal(limitadorLicitaciones(t), MOTIVO_PLAZO_CERCANO);
  ponerPlazo(72);
  assert.equal(limitadorLicitaciones(t), null);
});

test('should_cap_automatic_lessons_at_two_per_day', () => {
  borrarTrabajos();
  ponerPlazo(72);
  const ids = [1, 2, 3].map((v) => pedirLecciones(nucleo().db, { id: v, licitacion_id: ID, version: v }, null));
  assert.deepEqual(
    ids.map((i) => typeof i),
    ['number', 'number', 'object'],
  );
  assert.equal(ids[2], null);
  assert.equal(trabajos(TIPO_LECCIONES), 2);
});

function memoriaEnsayo(version: number): { memoria: number; ruta: string } {
  const memoria = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensayo) VALUES (?, ?, ?, 'ensamblada', ?, 1)",
      )
      .run(ID, guionId, version, ts).lastInsertRowid,
  );
  const ruta = `Salidas/Licitaciones/x/memoria-v${version}-ensayo.docx`;
  db.prepare(
    `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, origen, memoria_id, guion_id, version, estado)
    VALUES (?, ?, 'h', 1, 'plataforma', ?, 'ensamblado', ?, ?, ?, 'pendiente')`,
  ).run(ID, ruta, ts, memoria, guionId, version);
  return { memoria, ruta };
}

test('should_not_count_rehearsal_runs_against_offer_daily_cap', () => {
  // Arrange: 5 runs de la memoria de ensayo (apartados y su autoevaluación) y 2 de la oferta de verdad.
  borrarTrabajos();
  const e = memoriaEnsayo(40);
  const ins = nucleo().db
    .prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en, lanzado_en)
    VALUES ('licitaciones.memoria_apartado', 'licitaciones', ?, ?, 'completado', ?, ?, ?)`);
  const lanzado = new Date().toISOString();
  for (let n = 1; n <= 4; n += 1)
    ins.run(`ensayo-a${n}`, JSON.stringify({ id: ID, memoria_id: e.memoria, apartado: n }), lanzado, lanzado, lanzado);
  ins.run('ensayo-eval', JSON.stringify({ id: ID, documento: e.ruta }), lanzado, lanzado, lanzado);
  ins.run('real-guion', JSON.stringify({ id: ID, pedida_en: lanzado }), lanzado, lanzado, lanzado);
  ins.run('real-a1', JSON.stringify({ id: ID, memoria_id: e.memoria + 1000, apartado: 1 }), lanzado, lanzado, lanzado);
  // Act
  const n = runsDeOfertaHoy(nucleo().db, ID);
  // Assert
  assert.equal(n, 2, 'solo los de la oferta de verdad');
});

test('should_autoevaluate_the_real_memory_after_three_rehearsal_autoevaluations', () => {
  // Arrange: tres autoevaluaciones de versiones de ensayo en 24 h.
  borrarTrabajos();
  ponerPlazo(72);
  for (const v of [41, 42, 43]) {
    const e = memoriaEnsayo(v);
    const r = pedirEvaluacionDeMemoria(nucleo().db, db, { ...m(v), ensayo: 1 }, e.ruta);
    assert.ok('trabajo' in r);
  }
  // Act
  const real = pedirEvaluacionDeMemoria(nucleo().db, db, m(44), 'Salidas/Licitaciones/x/memoria-v44.docx');
  // Assert
  assert.ok('trabajo' in real, 'el ensayo no le quita la nota a la memoria de verdad');
});
