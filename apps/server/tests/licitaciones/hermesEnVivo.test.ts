// HermesEnVivo: lo que Hermes hace ahora para una oferta, con su
// sitio en la cola y la hora estimada, el último fallo en lenguaje legible y los topes del día.
// La tabla trabajos_ia se siembra a mano: no se lanza ningún run.
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-en-vivo-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';
process.env.HOME = tmp;
process.env.LICITACIONES_RUNS_OFERTA_DIA = '5';
process.env.LICITACIONES_PROPUESTAS_DIA = '3';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { registrarTrabajos } = await import('../../src/dominios/licitaciones/index.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { hermesEnVivo, nombreTrabajo, textoFallo } =
  await import('../../src/dominios/licitaciones/oferta/hermesEnVivo.js');

const { db: dbNucleo } = iniciarNucleo();
const db = dbLicitaciones();
registrarTrabajos();
const ID = 'p-envivo';
const OTRA = 'p-otra';
for (const id of [ID, OTRA]) {
  guardarLicitacion(db, {
    ...licitacion({ titulo: `Licitación ${id}`, publicada: '2026-09-20', limite: '2099-06-30T14:00:00' }),
    id,
    atom_id: `atom-${id}`,
  });
}

const MIN = 60_000;
const AHORA = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

type Fila = {
  tipo: string;
  id?: string;
  estado: string;
  payload?: Record<string, unknown>;
  intentos?: number;
  codigo?: string | null;
  proximo?: string | null;
  lanzado?: number | null;
  actualizado?: number;
  creado?: number;
  aMano?: boolean;
};

let n = 0;
function sembrar(f: Fila): number {
  n += 1;
  const r = dbNucleo
    .prepare(
      `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, intentos, codigo, error, proximo_intento_en, creado_en, actualizado_en, lanzado_en, a_mano)
    VALUES (?, 'licitaciones', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `licitaciones.${f.tipo}`,
      `clave-${n}`,
      JSON.stringify({ id: f.id ?? ID, ...f.payload }),
      f.estado,
      f.intentos ?? 0,
      f.codigo ?? null,
      f.codigo ? 'salida de Hermes' : null,
      f.proximo ?? null,
      iso(f.creado ?? AHORA - 60 * MIN),
      iso(f.actualizado ?? AHORA - 30 * MIN),
      f.lanzado === undefined || f.lanzado === null ? null : iso(f.lanzado),
      f.aMano ? 1 : 0,
    );
  return Number(r.lastInsertRowid);
}

// Seis guiones completados de otra oferta hace dos días: dan la duración típica del tipo sin contar como runs de hoy.
function historiaGuion(): void {
  const fin = AHORA - 2 * 24 * 60 * MIN;
  for (let i = 1; i <= 6; i += 1)
    sembrar({ tipo: 'guion', id: OTRA, estado: 'completado', lanzado: fin - i * 10 * MIN, actualizado: fin });
}

let server: http.Server;
let base = '';
before(() => {
  const app = express();
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  dbNucleo.prepare('DELETE FROM trabajos_ia').run();
});

test('should_list_what_hermes_does_now_for_the_offer_with_position_and_estimate', () => {
  historiaGuion();
  sembrar({ tipo: 'ficha', estado: 'lanzado', lanzado: AHORA - 5 * MIN });
  const guion = sembrar({ tipo: 'guion', estado: 'pendiente' });
  sembrar({ tipo: 'memoria_apartado', estado: 'pendiente', payload: { apartado: 2 } });
  sembrar({ tipo: 'anexo', estado: 'pendiente', payload: { clave: 'II' } });
  sembrar({ tipo: 'guion', id: OTRA, estado: 'pendiente' });

  const r = hermesEnVivo(db, dbNucleo, ID, AHORA);

  assert.equal(r.error, null);
  const v = r.data!;
  assert.deepEqual(
    v.trabajos.map((t) => [t.nombre, t.estado]),
    [
      ['Ficha', 'generando'],
      ['Guion de la oferta', 'en_cola'],
      ['Memoria: apartado 2', 'en_cola'],
      ['Anexo II', 'en_cola'],
    ],
    'solo los de esta oferta, con su nombre legible',
  );
  const g = v.trabajos.find((t) => t.id === guion)!;
  assert.equal(typeof g.posicion, 'number', 'tiene sitio en la cola');
  assert.ok(g.eta && g.eta.desde < g.eta.hasta, 'hora estimada en intervalo');
  assert.equal(v.ultimo_fallo, null);
});

test('should_explain_the_last_failure_in_plain_spanish_with_the_retry_time', () => {
  // 14:05 UTC del 15 de octubre: las 16:05 en hora peninsular (horario de verano).
  sembrar({
    tipo: 'guion',
    estado: 'pendiente',
    intentos: 2,
    codigo: 'sin_resultado',
    proximo: '2026-10-15T14:05:00.000Z',
    actualizado: AHORA - 2 * MIN,
  });
  sembrar({ tipo: 'ficha', estado: 'fallido', intentos: 3, codigo: 'run_inactivo', actualizado: AHORA - 20 * MIN });

  const v = hermesEnVivo(db, dbNucleo, ID, AHORA).data!;

  assert.deepEqual(
    v.ultimo_fallo,
    {
      tipo: 'licitaciones.guion',
      nombre: 'Guion de la oferta',
      codigo: 'sin_resultado',
      en: iso(AHORA - 2 * MIN),
      texto: 'falló 2 de 3: Hermes no dejó resultado; reintento a las 16:05',
    },
    'el más reciente, el que aún se reintenta',
  );
});

test('should_explain_a_final_failure_without_retry_unless_a_later_run_completed', () => {
  sembrar({ tipo: 'ficha', estado: 'fallido', intentos: 3, codigo: 'run_inactivo', actualizado: AHORA - 20 * MIN });
  sembrar({ tipo: 'lecciones', estado: 'fallido', intentos: 3, codigo: 'codigo_raro', actualizado: AHORA - 40 * MIN });
  sembrar({ tipo: 'lecciones', estado: 'completado', actualizado: AHORA - 10 * MIN, lanzado: AHORA - 12 * MIN });

  const v = hermesEnVivo(db, dbNucleo, ID, AHORA).data!;

  assert.equal(v.ultimo_fallo?.texto, 'falló 3 de 3: Hermes dejó de responder');
  assert.equal(v.ultimo_fallo?.nombre, 'Ficha', 'el de lecciones lo tapa su completado posterior');
});

test('should_show_runs_today_against_the_cap', () => {
  for (let i = 0; i < 3; i += 1)
    sembrar({
      tipo: 'memoria_apartado',
      estado: 'completado',
      lanzado: AHORA - (i + 1) * 60 * MIN,
      payload: { apartado: i + 1 },
    });
  sembrar({ tipo: 'guion', estado: 'completado', lanzado: AHORA - 30 * 60 * MIN });
  sembrar({ tipo: 'decisiones', estado: 'pendiente', creado: AHORA - 10 * MIN });
  sembrar({ tipo: 'decisiones', estado: 'cancelado', creado: AHORA - 20 * MIN, aMano: true });

  const v = hermesEnVivo(db, dbNucleo, ID, AHORA).data!;

  assert.deepEqual(
    { runs: v.runs_hoy, tope: v.tope_runs, propuestas: v.propuestas_auto_hoy, tope_p: v.tope_propuestas },
    { runs: 3, tope: 5, propuestas: 1, tope_p: 3 },
    'el guion de hace 30 h no cuenta y la propuesta pedida a mano tampoco',
  );
});

test('should_show_a_tender_brake_after_three_failures_of_its_type', () => {
  for (let i = 0; i < 3; i += 1)
    sembrar({
      tipo: 'anexo',
      estado: 'fallido',
      intentos: 3,
      codigo: 'sin_resultado',
      actualizado: AHORA - (i + 1) * MIN,
      payload: { clave: 'I' },
    });

  const v = hermesEnVivo(db, dbNucleo, ID, AHORA).data!;

  assert.equal(v.frenos.length, 1);
  assert.deepEqual(
    { ...v.frenos[0], hasta: undefined },
    { tipo: 'licitaciones.anexo', nombre: 'Anexos', alcance: 'oferta', hasta: undefined },
  );
  assert.equal(v.pausa_hasta, null);
});

test('should_return_not_found_for_an_unknown_tender', () => {
  const r = hermesEnVivo(db, dbNucleo, 'p-no-existe', AHORA);

  assert.equal(r.error?.code, 'not_found');
});

test('should_answer_through_get_offer_hermes_route', async () => {
  sembrar({ tipo: 'guion', estado: 'pendiente' });

  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/hermes`);
  const inexistente = await fetch(`${base}/api/licitaciones/licitaciones/p-no-existe/oferta/hermes`);
  const invalido = await fetch(`${base}/api/licitaciones/licitaciones/..%2Fx/oferta/hermes`);

  assert.equal(r.status, 200);
  const cuerpo = (await r.json()) as { trabajos: { nombre: string }[]; tope_runs: number };
  assert.deepEqual(
    cuerpo.trabajos.map((t) => t.nombre),
    ['Guion de la oferta'],
  );
  assert.equal(cuerpo.tope_runs, 5);
  assert.equal(inexistente.status, 404);
  assert.equal(invalido.status, 400);
});

test('should_say_hermes_needs_a_restart_for_outdated_tools', () => {
  // Act
  const texto = textoFallo('herramientas_desfasadas', 0, null);
  // Assert
  assert.equal(texto, 'Hermes tiene herramientas antiguas: hay que reiniciarlo');
});

test('should_not_report_waits_or_a_manual_relaunch_as_the_last_failure', () => {
  // Arrange: un guion que espera a que se reinicie Hermes, un anexo que espera al uso del modelo y un apartado relanzado a mano.
  sembrar({ tipo: 'guion', estado: 'pendiente', codigo: 'herramientas_desfasadas', actualizado: AHORA - 1 * MIN });
  sembrar({
    tipo: 'anexo',
    estado: 'pendiente',
    codigo: 'limite_uso',
    payload: { clave: 'II' },
    actualizado: AHORA - 2 * MIN,
  });
  const relanzado = sembrar({
    tipo: 'memoria_apartado',
    estado: 'pendiente',
    codigo: 'relanzado',
    payload: { apartado: 1 },
    actualizado: AHORA - 3 * MIN,
  });
  dbNucleo
    .prepare("UPDATE trabajos_ia SET error = 'Relanzado a mano: se paró el run anterior.' WHERE id = ?")
    .run(relanzado);
  sembrar({ tipo: 'ficha', estado: 'pendiente', intentos: 1, codigo: 'run_inactivo', actualizado: AHORA - 10 * MIN });
  // Act
  const v = hermesEnVivo(db, dbNucleo, ID, AHORA).data!;
  // Assert
  assert.equal(v.ultimo_fallo?.nombre, 'Ficha', 'el único fallo de verdad, aunque sea más antiguo');
  assert.equal(v.ultimo_fallo?.texto, 'falló 1 de 3: Hermes dejó de responder');
});

test('should_name_a_whole_job_type_without_payload_for_alerts', () => {
  // Act
  const nombres = [
    'licitaciones.anexo',
    'licitaciones.memoria_apartado',
    'licitaciones.cribar',
    'licitaciones.nuevo_tipo',
  ].map((t) => nombreTrabajo(t, '{}'));

  // Assert
  assert.deepEqual(nombres, ['Anexos', 'Memoria: apartados', 'Criba', 'nuevo_tipo']);
  assert.equal(nombreTrabajo('licitaciones.memoria_apartado', '{"apartado":3}'), 'Memoria: apartado 3');
  assert.equal(nombreTrabajo('licitaciones.anexo', '{"clave":"deuc"}'), 'Anexo deuc');
});
