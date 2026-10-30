// Cifras de la cola para operar (por tipo y código, por oferta, medianas) y el código de los errores
// guardados sin él, sobre una tabla trabajos_ia sembrada a mano.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cola-estadisticas-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { estadisticasCola, rellenarCodigos, codigoDeError, medianasDuracion } =
  await import('../../src/nucleo/colaEstadisticas.js');
const { estadoCola } = await import('../../src/nucleo/colaConsultas.js');
const { insertarFallido, insertarTrabajo } = await import('../helpers/cola.js');

const otraCola = (nombre: string) => abrirNucleo(path.join(tmp, nombre));

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('should_count_the_last_seven_days_by_type_state_and_failure_code', () => {
  const d = otraCola('estadisticas');
  const ahoraMs = Date.parse('2026-10-14T12:00:00Z');
  const hace = (dias: number) => new Date(ahoraMs - dias * 86_400_000).toISOString();
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, codigo, creado_en, actualizado_en)
    VALUES (?, 'licitaciones', ?, '{}', ?, ?, ?, ?)`);
  const filas: [string, string, string | null, number][] = [
    ['licitaciones.cribar', 'fallido', 'sin_resultado', 1],
    ['licitaciones.cribar', 'fallido', 'sin_resultado', 2],
    ['licitaciones.cribar', 'fallido', 'run_inactivo', 3],
    ['licitaciones.cribar', 'completado', null, 1],
    ['licitaciones.cribar', 'fallido', 'sin_resultado', 9],
    ['licitaciones.ficha', 'completado', null, 0],
    ['licitaciones.ficha', 'pendiente', 'run_perdido', 0],
    ['licitaciones.ficha', 'fallido', null, 6],
  ];
  filas.forEach(([tipo, estado, codigo, dias], i) =>
    insertar.run(tipo, `e${i}`, estado, codigo, hace(dias), hace(dias)),
  );
  const e = estadisticasCola(d, 7, ahoraMs);
  assert.equal(e.desde, hace(7));
  assert.deepEqual(
    e.por_tipo.map((t) => t.tipo),
    ['licitaciones.cribar', 'licitaciones.ficha'],
    'primero el que más falla',
  );
  const criba = e.por_tipo[0]!;
  assert.deepEqual(
    [criba.completados, criba.fallidos, criba.en_curso, criba.tasa_fallo],
    [1, 3, 0, 0.75],
    'el fallo de hace 9 días no cuenta',
  );
  assert.deepEqual(criba.fallos_por_codigo, { sin_resultado: 2, run_inactivo: 1 });
  assert.deepEqual(e.por_tipo[1]!.fallos_por_codigo, { sin_codigo: 1 });
  assert.equal(e.por_tipo[1]!.en_curso, 1);
  assert.ok(
    (estadoCola(d, ahoraMs).ultimos_7_dias as { por_tipo: unknown[] }).por_tipo.length > 0,
    'plataforma_estado lo trae',
  );
  d.close();
});

test('should_give_a_code_to_the_errors_saved_before_the_code_column', () => {
  const d = otraCola('rellenar');
  const errores: [string, string][] = [
    ['El run terminó sin dejar el resultado esperado. Hermes respondió: «no pude»', 'sin_resultado'],
    ['Hermes lleva 10 min sin usar ninguna herramienta en este run (¿se reinició?): se reintenta.', 'run_inactivo'],
    ['Hermes ya no conoce el run (¿se reinició?).', 'run_perdido'],
    ['hermes_http_500: Error interno de Hermes', 'hermes_http_500'],
    ['Uso del modelo agotado: hermes_http_429: The usage limit has been reached', 'limite_uso'],
    ['Falta una herramienta en Hermes (licitaciones_guion): reinicia Hermes', 'sin_herramienta'],
    ['Run fallido.', 'run_fallido'],
    ['Context window exceeded', 'desconocido'],
  ];
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, error, creado_en, actualizado_en)
    VALUES ('prueba', 'test', ?, '{}', 'fallido', ?, 'x', 'antes')`);
  errores.forEach(([error], i) => insertar.run(`r${i}`, error));
  insertar.run('sin-error', null);
  assert.equal(rellenarCodigos(d), errores.length);
  const codigos = d
    .prepare("SELECT codigo, actualizado_en FROM trabajos_ia WHERE clave LIKE 'r%' ORDER BY id")
    .all() as { codigo: string; actualizado_en: string }[];
  assert.deepEqual(
    codigos.map((c) => c.codigo),
    errores.map(([, c]) => c),
  );
  assert.ok(
    codigos.every((c) => c.actualizado_en === 'antes'),
    'no mueve la fecha: las estadísticas siguen contando cuándo falló',
  );
  assert.equal(rellenarCodigos(d), 0, 'una sola vez');
  d.close();
});

test('should_code_http_429_message_as_usage_limit', () => {
  assert.equal(codigoDeError('HTTP 429: The usage limit has been reached'), 'limite_uso');
  assert.equal(codigoDeError('Context window exceeded'), 'desconocido');
});

test('should_recode_unknown_429_errors_when_filling_codes', () => {
  const d = otraCola('recodificar');
  insertarFallido(d, 'z1', 'HTTP 429: The usage limit has been reached', { codigo: 'desconocido' });
  insertarFallido(d, 'z2', 'Context window exceeded', { codigo: 'desconocido' });
  insertarFallido(d, 'z3', 'Run fallido.', { codigo: 'run_fallido' });
  assert.equal(rellenarCodigos(d), 1, 'solo cambia el 429; el desconocido sigue igual');
  const codigos = (d.prepare('SELECT codigo FROM trabajos_ia ORDER BY id').all() as { codigo: string }[]).map(
    (c) => c.codigo,
  );
  assert.deepEqual(codigos, ['limite_uso', 'desconocido', 'run_fallido']);
  d.close();
});

test('should_count_states_of_the_last_7_days_next_to_history', () => {
  const d = otraCola('siete_dias');
  const ahoraMs = Date.parse('2026-10-15T10:00:00Z');
  insertarFallido(d, 'viejo', 'x', { actualizado: '2026-09-01T00:00:00Z' });
  insertarFallido(d, 'reciente', 'x', { actualizado: '2026-10-14T00:00:00Z' });
  insertarFallido(d, 'hecho', null, { actualizado: '2026-10-14T00:00:00Z', estado: 'completado' });
  const e = estadoCola(d, ahoraMs);
  assert.deepEqual(e.por_estado, { fallido: 2, completado: 1 });
  assert.deepEqual(e.por_estado_7_dias, { fallido: 1, completado: 1 });
  d.close();
});

test('should_give_the_median_minutes_of_completed_jobs_from_launch_to_end_when_there_are_five_samples', () => {
  const d = otraCola('medianas');
  const ahoraMs = Date.parse('2026-10-14T12:00:00Z');
  const iso = (minAntes: number) => new Date(ahoraMs - minAntes * 60_000).toISOString();
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, lanzado_en, actualizado_en)
    VALUES (?, 'licitaciones', ?, '{}', ?, ?, ?, ?)`);
  // Cinco fichas completadas de 10, 20, 30, 40 y 200 min (una sin lanzado_en: cuenta desde que se pidió).
  [10, 20, 30, 40].forEach((m, i) =>
    insertar.run('licitaciones.ficha', `f${i}`, 'completado', iso(500), iso(m + 60), iso(60)),
  );
  insertar.run('licitaciones.ficha', 'f-sin-lanzar', 'completado', iso(260), null, iso(60));
  // Ni los fallidos ni los de hace más de 14 días cuentan.
  insertar.run('licitaciones.ficha', 'f-fallido', 'fallido', iso(1000), iso(1000), iso(60));
  insertar.run('licitaciones.ficha', 'f-viejo', 'completado', iso(30 * 1440), iso(30 * 1440), iso(20 * 1440));
  [10, 20, 30, 40].forEach((m, i) =>
    insertar.run('licitaciones.guion', `g${i}`, 'completado', iso(m + 60), iso(m + 60), iso(60)),
  );

  const m = medianasDuracion(d, ['licitaciones.ficha', 'licitaciones.guion', 'licitaciones.anexo'], 14, ahoraMs);

  assert.deepEqual(m, { 'licitaciones.ficha': 30, 'licitaciones.guion': null, 'licitaciones.anexo': null });
  d.close();
});

test('should_count_states_only_in_the_last_7_days', () => {
  // Arrange
  const d = otraCola('operacion_7_dias');
  const ahoraMs = Date.parse('2026-10-15T10:00:00Z');
  insertarTrabajo(d, 'viejo', { estado: 'fallido', codigo: 'sin_resultado', creado: '2026-09-01T00:00:00Z' });
  insertarTrabajo(d, 'reciente', { estado: 'fallido', codigo: 'run_inactivo', creado: '2026-10-14T00:00:00Z' });

  // Act
  const e = estadoCola(d, ahoraMs) as {
    por_estado: Record<string, number>;
    por_estado_7_dias: Record<string, number>;
    fallos_recientes: { codigo: string }[];
  };

  // Assert: el histórico sigue entero; la ventana y los fallos recientes, solo de 7 días.
  assert.deepEqual(e.por_estado, { fallido: 2 });
  assert.deepEqual(e.por_estado_7_dias, { fallido: 1 });
  assert.deepEqual(
    e.fallos_recientes.map((f) => f.codigo),
    ['run_inactivo'],
  );
  d.close();
});

test('should_group_jobs_by_offer', () => {
  // Arrange
  const d = otraCola('por_oferta');
  const ahoraMs = Date.parse('2026-10-15T10:00:00Z');
  const hoy = '2026-10-15T08:00:00Z';
  insertarTrabajo(d, 'a1', { estado: 'lanzado', payload: '{"id":"LIC-A"}', creado: hoy, lanzado: hoy });
  insertarTrabajo(d, 'a2', { estado: 'pendiente', payload: '{"id":"LIC-A"}', creado: hoy });
  insertarTrabajo(d, 'a3', { estado: 'fallido', payload: '{"id":"LIC-A"}', creado: hoy });
  insertarTrabajo(d, 'a4', { estado: 'fallido', payload: '{"id":"LIC-A"}', creado: '2026-09-01T00:00:00Z' });
  insertarTrabajo(d, 'b1', { estado: 'completado', payload: '{"id":"LIC-B"}', creado: hoy });
  insertarTrabajo(d, 'c1', { estado: 'pendiente', payload: '{"id":"colab-7"}', dominio: 'colaboradores', creado: hoy });
  insertarTrabajo(d, 'sin', { estado: 'pendiente', payload: '{"lote":3}', creado: hoy });

  // Act
  const e = estadoCola(d, ahoraMs) as { por_oferta: unknown[] };

  // Assert: lo terminado bien y los fallos de hace más de 7 días no cuentan; lo personal no sale.
  assert.deepEqual(e.por_oferta, [
    { dominio: 'licitaciones', recurso: 'LIC-A', pendientes: 1, en_marcha: 1, fallidos: 1 },
  ]);
  d.close();
});
