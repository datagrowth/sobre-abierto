// Posición, hora estimada y motivo de espera de los trabajos de la cola, y el último fallo de
// una oferta: con la tabla trabajos_ia sembrada a mano (no se lanza ningún run).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cola-eta-'));
process.env.NODE_ENV = 'test';

const Database = (await import('better-sqlite3')).default;
const { abrirNucleo, nucleoFile } = await import('../../src/nucleo/db.js');
const { MARCA_PAUSA_LIMITE, ponerMarca } = await import('../../src/nucleo/colaMarcas.js');
const { registrarTipoTrabajo, obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { fijarLimitador, MOTIVO_TOPE } = await import('../../src/nucleo/colaOrden.js');
const { ultimoFallo, trabajoEnCursoDetallado } = await import('../../src/nucleo/colaConsultas.js');
const { contextoEta, detalleTrabajo, duracionesPorTipo, MIN_MUESTRAS } = await import('../../src/nucleo/colaEta.js');

const MIN = 60_000;
const AHORA = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const destino = () => ({ url: 'http://127.0.0.1:9', key: 'clave-de-prueba' });
registrarTipoTrabajo('eta.memoria', { destino, instrucciones: () => 'haz', hecho: () => true });
registrarTipoTrabajo('eta.tope', { destino, instrucciones: () => 'haz', hecho: () => true });
fijarLimitador('eta_tope', () => MOTIVO_TOPE);

const abiertas: { close: () => void }[] = [];
after(() => {
  for (const d of abiertas) d.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

let n = 0;
function nuevaDb() {
  const dir = fs.mkdtempSync(path.join(tmp, 'db-'));
  const db = abrirNucleo(dir);
  abiertas.push(db);
  return { db, dir };
}

type Fila = {
  tipo?: string;
  dominio?: string;
  estado: string;
  id?: string;
  lanzado?: number;
  actualizado?: number;
  error?: string | null;
  codigo?: string | null;
  proximo?: string | null;
};

function sembrar(db: ReturnType<typeof abrirNucleo>, f: Fila): number {
  n += 1;
  const r = db
    .prepare(
      `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, error, codigo, proximo_intento_en, creado_en, actualizado_en, lanzado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      f.tipo ?? 'eta.memoria',
      f.dominio ?? 'licitaciones',
      `clave-${n}`,
      JSON.stringify({ id: f.id ?? `p-${n}` }),
      f.estado,
      f.error ?? null,
      f.codigo ?? null,
      f.proximo ?? null,
      iso(AHORA - 60 * MIN),
      iso(f.actualizado ?? AHORA - 30 * MIN),
      f.lanzado === undefined ? null : iso(f.lanzado),
    );
  return Number(r.lastInsertRowid);
}

// Diez completados de 10, 20… 100 min: p5 = 14.5, p50 = 55, p90 = 91, p95 = 95.5.
function conHistoria(db: ReturnType<typeof abrirNucleo>, muestras = 10, tipo = 'eta.memoria'): void {
  for (let i = 1; i <= muestras; i += 1) {
    const fin = AHORA - 2 * 60 * MIN;
    sembrar(db, { tipo, estado: 'completado', lanzado: fin - i * 10 * MIN, actualizado: fin });
  }
}

const detalle = (db: ReturnType<typeof abrirNucleo>, id: number, runs = 2) =>
  detalleTrabajo(db, obtenerTrabajo(db, id)!, contextoEta(db, AHORA, runs));

test('should_estimate_the_finish_between_p5_and_p95_of_the_type', () => {
  const { db } = nuevaDb();
  conHistoria(db);
  const lanzado = AHORA - 5 * MIN;
  const id = sembrar(db, { estado: 'lanzado', lanzado });

  const d = detalle(db, id);

  assert.equal(d.posicion, 0);
  assert.deepEqual(d.eta, { desde: iso(lanzado + 14.5 * MIN), hasta: iso(lanzado + 95.5 * MIN), mediana_min: 55 });
  assert.equal(d.mas_de_lo_normal, false);
  assert.equal(d.motivo_espera, null);
});

test('should_flag_more_than_usual_only_after_the_end_of_the_estimate_p95', () => {
  const { db } = nuevaDb();
  conHistoria(db);
  const pasado = sembrar(db, { estado: 'lanzado', lanzado: AHORA - 120 * MIN });
  const enP92 = sembrar(db, { estado: 'lanzado', lanzado: AHORA - 92 * MIN });

  assert.equal(detalle(db, pasado).mas_de_lo_normal, true);
  assert.equal(detalle(db, enP92).mas_de_lo_normal, false, 'aún dentro de eta.desde–eta.hasta');
});

test('should_not_count_braked_jobs_ahead_in_the_position', () => {
  // Arrange: tres pendientes de la oferta B, frenada por sus tres fallos, delante de uno de A.
  const { db } = nuevaDb();
  conHistoria(db);
  for (let i = 0; i < 3; i += 1) sembrar(db, { estado: 'fallido', id: 'p-frenada', actualizado: AHORA - 10 * MIN });
  for (let i = 0; i < 3; i += 1) sembrar(db, { estado: 'pendiente', id: 'p-frenada' });
  const deA = sembrar(db, { estado: 'pendiente', id: 'p-libre' });

  // Act
  const d = detalle(db, deA);

  // Assert
  assert.equal(d.posicion, 1, 'es el que sale en el siguiente hueco');
  assert.equal(d.eta?.desde, iso(AHORA + 14.5 * MIN), 'sin sumar la mediana de los frenados');
});

test('should_give_position_one_to_the_next_job_to_launch', () => {
  const { db } = nuevaDb();
  conHistoria(db);
  const primero = sembrar(db, { estado: 'pendiente' });
  const segundo = sembrar(db, { estado: 'pendiente' });

  const [a, b] = [detalle(db, primero), detalle(db, segundo)];

  assert.deepEqual([a.posicion, b.posicion], [1, 2]);
  assert.deepEqual([a.motivo_espera, b.motivo_espera], ['cola', 'cola']);
  assert.deepEqual(a.eta, { desde: iso(AHORA + 14.5 * MIN), hasta: iso(AHORA + 95.5 * MIN), mediana_min: 55 });
});

test('should_add_the_median_of_the_jobs_ahead_divided_by_the_slots', () => {
  const { db } = nuevaDb();
  conHistoria(db);
  sembrar(db, { estado: 'pendiente' });
  sembrar(db, { estado: 'pendiente' });
  const tercero = sembrar(db, { estado: 'pendiente' });

  const d = detalle(db, tercero, 2);

  // Dos delante de 55 min de mediana entre 2 runs a la vez: empieza a los 55 min.
  assert.equal(d.posicion, 3);
  assert.equal(d.eta?.desde, iso(AHORA + (55 + 14.5) * MIN));
  assert.equal(d.eta?.hasta, iso(AHORA + (55 + 95.5) * MIN));
});

test('should_say_the_job_waits_for_the_usage_limit_pause', () => {
  const { db } = nuevaDb();
  conHistoria(db);
  const pausa = AHORA + 20 * MIN;
  ponerMarca(db, MARCA_PAUSA_LIMITE, iso(pausa));
  const id = sembrar(db, { estado: 'pendiente', codigo: 'limite_uso', proximo: iso(pausa) });

  const d = detalle(db, id);

  assert.equal(d.motivo_espera, 'pausa_limite');
  assert.equal(d.eta?.desde, iso(pausa + 14.5 * MIN), 'no empieza antes de que acabe la pausa');
});

test('should_say_tope_oferta_when_the_tender_reached_its_cap', () => {
  const { db } = nuevaDb();
  const id = sembrar(db, { tipo: 'eta.tope', dominio: 'eta_tope', estado: 'pendiente' });

  assert.equal(detalle(db, id).motivo_espera, 'tope_oferta');
});

test('should_give_no_estimate_to_a_pending_job_the_queue_will_not_launch', () => {
  // Arrange: con historia para estimar, pero su oferta llegó al tope de runs del día.
  const { db } = nuevaDb();
  conHistoria(db, 10, 'eta.tope');
  const id = sembrar(db, { tipo: 'eta.tope', dominio: 'eta_tope', estado: 'pendiente' });

  // Act
  const d = detalle(db, id);

  // Assert
  assert.equal(d.motivo_espera, 'tope_oferta');
  assert.equal(d.posicion, null);
  assert.equal(d.eta, null, 'no empieza ya: espera a que se abra el tope');
});

test('should_return_no_estimate_with_less_than_five_samples', () => {
  const { db } = nuevaDb();
  conHistoria(db, MIN_MUESTRAS - 1);
  const id = sembrar(db, { estado: 'pendiente' });

  const d = detalle(db, id);

  assert.equal(duracionesPorTipo(db, AHORA).has('eta.memoria'), false);
  assert.equal(d.eta, null);
  assert.equal(d.posicion, 1, 'sin hora, pero con su sitio en la cola');
});

test('should_hide_the_error_of_personal_data_jobs', () => {
  const { db } = nuevaDb();
  const cv = sembrar(db, {
    dominio: 'colaboradores',
    estado: 'pendiente',
    error: 'Hermes respondió: «Persona A, ingeniera…»',
    codigo: 'sin_resultado',
    proximo: iso(AHORA + 4 * MIN),
  });
  const oferta = sembrar(db, {
    estado: 'pendiente',
    error: `El run terminó sin dejar el resultado esperado. ${'x'.repeat(600)}`,
    codigo: 'sin_resultado',
    proximo: iso(AHORA + 4 * MIN),
  });

  const [a, b] = [detalle(db, cv), detalle(db, oferta)];

  assert.equal(a.error, null);
  assert.equal(b.error?.length, 300, 'recortado a 300 caracteres');
  assert.deepEqual([b.motivo_espera, b.posicion, b.codigo], ['reintento', null, 'sin_resultado']);
});

test('should_report_the_last_final_failure_of_a_tender_job', () => {
  const { db, dir } = nuevaDb();
  const dominio = new Database(':memory:');
  abiertas.push(dominio);
  dominio.prepare('ATTACH DATABASE ? AS nucleo').run(nucleoFile(dir));
  sembrar(db, { id: 'p-1', estado: 'completado', actualizado: AHORA - 3 * 60 * MIN });
  sembrar(db, {
    id: 'p-1',
    estado: 'fallido',
    actualizado: AHORA - 60 * MIN,
    codigo: 'sin_resultado',
    error: 'El run terminó sin dejar el resultado esperado.',
  });
  sembrar(db, { id: 'p-2', estado: 'fallido', actualizado: AHORA - 3 * 60 * MIN, codigo: 'run_inactivo' });
  sembrar(db, { id: 'p-2', estado: 'completado', actualizado: AHORA - 60 * MIN });
  sembrar(db, { id: 'p-3', estado: 'fallido', actualizado: AHORA - 30 * 60 * MIN, codigo: 'run_inactivo' });

  const fallo = ultimoFallo(dominio, 'eta.memoria', 'p-1', AHORA);

  assert.deepEqual(fallo, {
    codigo: 'sin_resultado',
    error: 'El run terminó sin dejar el resultado esperado.',
    intentos: 0,
    en: iso(AHORA - 60 * MIN),
  });
  assert.equal(ultimoFallo(dominio, 'eta.memoria', 'p-2', AHORA), null, 'un completado posterior lo tapa');
  assert.equal(ultimoFallo(dominio, 'eta.memoria', 'p-3', AHORA), null, 'de hace más de 24 h no cuenta');
});

test('should_detail_the_job_in_progress_of_a_tender', () => {
  const { db } = nuevaDb();
  conHistoria(db);
  const id = sembrar(db, { id: 'p-9', estado: 'pendiente' });

  const d = trabajoEnCursoDetallado(db, 'eta.memoria', 'p-9', AHORA);

  assert.deepEqual(
    [d?.estado, d?.id, d?.tipo, d?.posicion, d?.motivo_espera, d?.intentos],
    ['en_cola', id, 'eta.memoria', 1, 'cola', 0],
  );
  assert.equal(trabajoEnCursoDetallado(db, 'eta.memoria', 'p-otra', AHORA), null);
});
