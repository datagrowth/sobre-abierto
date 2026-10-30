// Cola de trabajos de IA contra una API de runs de Hermes simulada (la frontera
// HTTP): lanzar con idempotencia, seguir el run, comprobar que dejó su resultado,
// reintentar, no lanzar nada si no hay perfil configurado y no atascarse en un trabajo roto
// o en un run que Hermes ya no conoce.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trabajos-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { encolar, vueltaCola } = await import('../../src/nucleo/trabajos.js');
const { registrarTipoTrabajo, obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { fijarPrioridad } = await import('../../src/nucleo/colaOrden.js');
const { frenadoHasta } = await import('../../src/nucleo/colaFrenos.js');
const { estadoCola } = await import('../../src/nucleo/colaConsultas.js');
const { alertasIa } = await import('../../src/nucleo/colaAlertas.js');
const { relanzarTrabajos } = await import('../../src/nucleo/colaRelanzado.js');
const { ahora } = await import('../../src/nucleo/db.js');
const { estadoDesde } = await import('../../src/nucleo/hermes/runs.js');

const db = abrirNucleo(tmp);
const KEY = 'clave-de-hermes-de-prueba';
const runs = new Map<string, { status: string; input: string; idem: string; output?: string }>();
let destino: { url: string; key: string } | null = null;
let hechos = new Set<string>();
let limiteAgotado = false;
let server: http.Server;

before(async () => {
  server = escucharLocal(
    http.createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${KEY}`) {
        res.writeHead(401).end('{}');
        return;
      }
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/v1/runs' && limiteAgotado) {
          res.writeHead(429).end('The usage limit has been reached');
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/runs') {
          const id = `run_${runs.size + 1}`;
          runs.set(id, {
            status: 'started',
            input: (JSON.parse(body) as { input: string }).input,
            idem: String(req.headers['idempotency-key']),
          });
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ run_id: id, status: 'started' }));
          return;
        }
        const run = runs.get(decodeURIComponent((req.url ?? '').split('/')[3] ?? ''));
        if (!run) {
          res.writeHead(404).end('{}');
          return;
        }
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ status: run.status, output: run.output }));
      });
    }),
  );
  destino = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, key: KEY };
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

registrarTipoTrabajo('prueba', {
  destino: () => destino,
  instrucciones: (p) => `haz ${(p as { n: number }).n}`,
  hecho: (p) => hechos.has(String((p as { n: number }).n)),
});

test('should_map_hermes_run_statuses', () => {
  assert.equal(estadoDesde('completed'), 'completado');
  assert.equal(estadoDesde('failed'), 'fallido');
  assert.equal(estadoDesde('cancelled'), 'cancelado');
  assert.equal(estadoDesde('started'), 'en_marcha');
});

test('should_not_duplicate_a_job_with_the_same_key', () => {
  const a = encolar(db, { tipo: 'prueba', dominio: 'test', clave: 'k1', payload: { n: 1 } });
  const b = encolar(db, { tipo: 'prueba', dominio: 'test', clave: 'k1', payload: { n: 99 } });
  assert.equal(a, b);
});

test('should_launch_at_most_two_runs_with_an_idempotency_key', async () => {
  encolar(db, { tipo: 'prueba', dominio: 'test', clave: 'k2', payload: { n: 2 } });
  encolar(db, { tipo: 'prueba', dominio: 'test', clave: 'k3', payload: { n: 3 } });
  await vueltaCola(db);
  assert.equal(runs.size, 2);
  assert.equal(runs.get('run_1')?.input, 'haz 1');
  assert.equal(runs.get('run_1')?.idem, 'k1#0');
  assert.equal(obtenerTrabajo(db, 3)?.estado, 'pendiente');
});

test('should_complete_a_job_only_when_the_run_left_its_result', async () => {
  hechos = new Set(['1']);
  runs.get('run_1')!.status = 'completed';
  runs.get('run_2')!.status = 'completed';
  runs.get('run_2')!.output = 'No he podido leer el PCAP:\n  el PDF está escaneado.';
  await vueltaCola(db);
  assert.equal(obtenerTrabajo(db, 1)?.estado, 'completado');
  const metricas = JSON.parse(obtenerTrabajo(db, 1)?.metricas ?? 'null') as { duracion_s: number | null } | null;
  assert.equal(typeof metricas?.duracion_s, 'number', 'al terminar guarda sus métricas (al menos la duración)');
  assert.ok(obtenerTrabajo(db, 1)?.lanzado_en, 'apunta cuándo se lanzó');
  const sinResultado = obtenerTrabajo(db, 2)!;
  assert.equal(sinResultado.estado, 'pendiente', 'se reintenta más tarde');
  assert.equal(sinResultado.intentos, 1);
  assert.match(sinResultado.error ?? '', /sin dejar el resultado/);
  assert.match(
    sinResultado.error ?? '',
    /Hermes respondió: «No he podido leer el PCAP: el PDF está escaneado\.»/,
    'dice por qué',
  );
  assert.ok(sinResultado.proximo_intento_en! > new Date().toISOString());
  assert.equal(obtenerTrabajo(db, 3)?.estado, 'lanzado', 'el hueco libre se ocupa');
});

test('should_wait_without_spending_attempts_when_hermes_is_not_configured', async () => {
  destino = null;
  const id = encolar(db, { tipo: 'prueba', dominio: 'test', clave: 'k4', payload: { n: 4 } });
  runs.get('run_3')!.status = 'started';
  await vueltaCola(db);
  assert.equal(obtenerTrabajo(db, id)?.estado, 'pendiente');
  assert.equal(obtenerTrabajo(db, id)?.intentos, 0);
});

// Bases separadas: lo que quedó en la cola de los tests anteriores no ocupa los huecos.
const otraCola = (nombre: string) => abrirNucleo(path.join(tmp, nombre));

function servidorDePrueba() {
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, key: KEY };
}

test('should_brake_a_type_whose_last_three_jobs_failed_until_a_person_reactivates_it', async () => {
  destino = servidorDePrueba();
  registrarTipoTrabajo('frenable', { destino: () => destino, instrucciones: () => 'nada', hecho: () => false });
  const d = otraCola('freno');
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, intentos, creado_en, actualizado_en)
    VALUES ('frenable', 'test', ?, '{}', 'fallido', 3, ?, ?)`);
  for (const k of ['f1', 'f2', 'f3']) insertar.run(k, ahora(), ahora());
  assert.ok(frenadoHasta(d, 'frenable'));
  const id = encolar(d, { tipo: 'frenable', dominio: 'test', clave: 'f4', payload: {} });
  const antes = runs.size;
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, id)?.estado, 'pendiente');
  assert.equal(runs.size, antes, 'frenado: no se lanza');
  assert.equal((estadoCola(d).frenados as { tipo: string }[])[0]?.tipo, 'frenable');
  assert.deepEqual(
    alertasIa(d, 'test').map((a) => [a.motivo, a.tipo]),
    [['fallos', 'frenable']],
  );
  assert.equal(frenadoHasta(d, 'frenable', Date.now() + 6 * 60 * 60_000 + 1), null, 'el freno caduca');
  const aMano = encolar(d, { tipo: 'frenable', dominio: 'test', clave: 'f5', payload: {}, aMano: true });
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, id)?.estado, 'lanzado', 'pedirlo a mano levanta el freno');
  assert.equal(obtenerTrabajo(d, aMano)?.estado, 'lanzado');
  d.close();
});

test('should_not_brake_when_a_newer_job_succeeded_even_if_slow_failures_closed_last', () => {
  // Los fallos tardan más en cerrarse (tres intentos): por fecha de cierre serían los tres
  // últimos, pero entre medias llegó y salió bien otra ficha.
  const d = otraCola('freno-orden');
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, intentos, creado_en, actualizado_en)
    VALUES ('lento', 'test', ?, '{}', ?, 1, 'x', ?)`);
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  insertar.run('l1', 'fallido', hace(1));
  insertar.run('l2', 'fallido', hace(2));
  insertar.run('l3', 'completado', hace(20));
  insertar.run('l4', 'fallido', hace(3));
  assert.equal(frenadoHasta(d, 'lento'), null);
  insertar.run('l5', 'fallido', hace(0));
  insertar.run('l6', 'fallido', hace(0));
  assert.ok(frenadoHasta(d, 'lento'), 'tres seguidos por orden de llegada sí frenan');
  d.close();
});

test('should_not_let_jobs_without_a_hermes_profile_block_the_queue', async () => {
  db.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE estado IN ('pendiente', 'lanzado')").run();
  registrarTipoTrabajo('sin_perfil', { destino: () => null, instrucciones: () => 'nada', hecho: () => false });
  const a = encolar(db, { tipo: 'sin_perfil', dominio: 'test', clave: 'sp-1', payload: { n: 1 } });
  const b = encolar(db, { tipo: 'sin_perfil', dominio: 'test', clave: 'sp-2', payload: { n: 2 } });
  const c = encolar(db, { tipo: 'prueba', dominio: 'test', clave: 'tras-sin-perfil', payload: { n: 77 } });
  await vueltaCola(db);
  assert.equal(obtenerTrabajo(db, c)?.estado, 'lanzado', 'el que tiene perfil sale aunque haya otros delante');
  assert.equal(obtenerTrabajo(db, a)?.estado, 'pendiente');
  assert.equal(obtenerTrabajo(db, b)?.intentos, 0, 'los que no tienen perfil esperan sin gastar intentos');
});

test('should_free_the_slot_of_a_job_whose_run_hermes_forgot_after_a_restart', async () => {
  destino = servidorDePrueba();
  const d = otraCola('run-perdido');
  const id = encolar(d, { tipo: 'prueba', dominio: 'test', clave: 'perdido', payload: { n: 50 } });
  d.prepare("UPDATE trabajos_ia SET estado = 'lanzado', run_id = 'run_olvidado' WHERE id = ?").run(id);
  await vueltaCola(d);
  const t = obtenerTrabajo(d, id)!;
  assert.equal(t.estado, 'pendiente', 'el 404 es un run perdido: se reintenta más tarde');
  assert.equal(t.intentos, 1);
  assert.match(t.error ?? '', /ya no conoce el run/);
  assert.equal(t.codigo, 'run_perdido', 'el código queda en el trabajo, no solo en el log');
  d.close();
});

test('should_keep_the_code_of_the_last_failure_and_clear_it_when_the_job_completes', async () => {
  destino = servidorDePrueba();
  const d = otraCola('codigo-final');
  const roto = encolar(d, { tipo: 'prueba', dominio: 'test', clave: 'tercer-intento', payload: { n: 80 } });
  d.prepare("UPDATE trabajos_ia SET estado = 'lanzado', run_id = 'run_olvidado', intentos = 2 WHERE id = ?").run(roto);
  await vueltaCola(d);
  assert.deepEqual([obtenerTrabajo(d, roto)?.estado, obtenerTrabajo(d, roto)?.codigo], ['fallido', 'run_perdido']);
  const sano = encolar(d, { tipo: 'prueba', dominio: 'test', clave: 'tras-un-fallo', payload: { n: 81 } });
  d.prepare(
    "UPDATE trabajos_ia SET codigo = 'sin_resultado', error = 'El run terminó sin dejar el resultado esperado.' WHERE id = ?",
  ).run(sano);
  await vueltaCola(d);
  runs.get(obtenerTrabajo(d, sano)!.run_id!)!.status = 'completed';
  hechos.add('81');
  await vueltaCola(d);
  assert.deepEqual(
    [obtenerTrabajo(d, sano)?.estado, obtenerTrabajo(d, sano)?.codigo, obtenerTrabajo(d, sano)?.error],
    ['completado', null, null],
  );
  d.close();
});

test('should_stop_waiting_for_a_run_that_cannot_be_checked_for_longer_than_a_run_lasts', async () => {
  registrarTipoTrabajo('inalcanzable', {
    destino: () => ({ url: 'http://127.0.0.1:1', key: KEY }),
    instrucciones: () => 'nada',
    hecho: () => false,
  });
  const d = otraCola('sin-consulta');
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, run_id, creado_en, actualizado_en)
    VALUES ('inalcanzable', 'test', ?, '{}', 'lanzado', 'run_x', ?, ?)`);
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const reciente = Number(insertar.run('reciente', hace(5), hace(5)).lastInsertRowid);
  const viejo = Number(insertar.run('viejo', hace(31), hace(31)).lastInsertRowid);
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, reciente)?.estado, 'lanzado', 'un fallo pasajero no lo suelta');
  const t = obtenerTrabajo(d, viejo)!;
  assert.equal(t.estado, 'pendiente', 'tras más de un run entero sin poder consultarlo, deja el hueco');
  assert.match(t.error ?? '', /No se pudo consultar el run/);
  d.close();
});

test('should_retry_a_run_that_hermes_still_calls_running_but_has_not_used_any_tool_for_ten_minutes', async () => {
  destino = servidorDePrueba();
  registrarTipoTrabajo('vigilado', {
    destino: () => destino,
    instrucciones: () => 'nada',
    hecho: () => false,
    metricas: { agente: 'oferta-licitaciones', stateDb: () => null },
  });
  const d = otraCola('run-inactivo');
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  runs.set('run_zombi', { status: 'running', input: '', idem: '' });
  runs.set('run_vivo', { status: 'running', input: '', idem: '' });
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, run_id, creado_en, actualizado_en, lanzado_en)
    VALUES ('vigilado', 'test', ?, '{}', 'lanzado', ?, ?, ?, ?)`);
  const zombi = Number(insertar.run('zombi', 'run_zombi', hace(15), hace(15), hace(15)).lastInsertRowid);
  d.prepare(
    "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('oferta-licitaciones', 'biblioteca_leer', 'biblioteca', NULL, 'ok', ?)",
  ).run(hace(13));
  await vueltaCola(d);
  const t = obtenerTrabajo(d, zombi)!;
  assert.equal(t.estado, 'pendiente', 'sin herramientas desde hace 13 min: muerto, se reintenta');
  assert.match(t.error ?? '', /lleva 10 min sin usar ninguna herramienta/);
  const vivo = Number(insertar.run('vivo', 'run_vivo', hace(15), hace(15), hace(15)).lastInsertRowid);
  d.prepare(
    "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('oferta-licitaciones', 'licitaciones_oferta', 'licitaciones', NULL, 'ok', ?)",
  ).run(hace(2));
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, vivo)?.estado, 'lanzado', 'con una llamada hace 2 min sigue en marcha');
  d.close();
});

test('should_use_type_max_time_when_type_defines_maxMs', async () => {
  destino = servidorDePrueba();
  registrarTipoTrabajo('largo', {
    destino: () => destino,
    instrucciones: () => 'nada',
    hecho: () => false,
    maxMs: 90 * 60_000,
  });
  registrarTipoTrabajo('corto', { destino: () => destino, instrucciones: () => 'nada', hecho: () => false });
  const d = otraCola('tiempo-por-tipo');
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  runs.set('run_largo', { status: 'running', input: '', idem: '' });
  runs.set('run_corto', { status: 'running', input: '', idem: '' });
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, run_id, creado_en, actualizado_en)
    VALUES (?, 'test', ?, '{}', 'lanzado', ?, ?, ?)`);
  const largo = Number(insertar.run('largo', 'largo', 'run_largo', hace(40), hace(40)).lastInsertRowid);
  const corto = Number(insertar.run('corto', 'corto', 'run_corto', hace(40), hace(40)).lastInsertRowid);
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, largo)?.estado, 'lanzado', '40 min de 90: sigue en marcha');
  assert.equal(obtenerTrabajo(d, corto)?.codigo, 'run_tiempo_maximo', 'sin maxMs propio, 30 min');
  d.close();
});

test('should_use_type_inactivity_when_defined', async () => {
  destino = servidorDePrueba();
  const metricas = { agente: 'redactor-largo', stateDb: () => null };
  registrarTipoTrabajo('paciente', {
    destino: () => destino,
    instrucciones: () => 'nada',
    hecho: () => false,
    metricas,
    inactivoMs: 15 * 60_000,
  });
  registrarTipoTrabajo('impaciente', {
    destino: () => destino,
    instrucciones: () => 'nada',
    hecho: () => false,
    metricas,
  });
  const d = otraCola('inactividad-por-tipo');
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  runs.set('run_paciente', { status: 'running', input: '', idem: '' });
  runs.set('run_impaciente', { status: 'running', input: '', idem: '' });
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, run_id, creado_en, actualizado_en, lanzado_en)
    VALUES (?, 'test', ?, '{}', 'lanzado', ?, ?, ?, ?)`);
  const paciente = Number(
    insertar.run('paciente', 'paciente', 'run_paciente', hace(20), hace(20), hace(20)).lastInsertRowid,
  );
  const impaciente = Number(
    insertar.run('impaciente', 'impaciente', 'run_impaciente', hace(20), hace(20), hace(20)).lastInsertRowid,
  );
  d.prepare(
    "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('redactor-largo', 'licitaciones_memoria_apartado', 'licitaciones', NULL, 'ok', ?)",
  ).run(hace(13));
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, paciente)?.estado, 'lanzado', '13 min sin herramientas caben en sus 15');
  const t = obtenerTrabajo(d, impaciente)!;
  assert.equal(t.codigo, 'run_inactivo', 'con los 10 min de siempre, se reintenta');
  d.close();
});

test('should_keep_long_job_alive_while_agent_keeps_calling_tools', async () => {
  destino = servidorDePrueba();
  const metricas = { agente: 'redactor-entero', stateDb: () => null };
  registrarTipoTrabajo('redaccion_entera', {
    destino: () => destino,
    instrucciones: () => 'nada',
    hecho: () => false,
    metricas,
    maxMs: 90 * 60_000,
    inactivoMs: 15 * 60_000,
  });
  const d = otraCola('largo-con-latido');
  const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  runs.set('run_entero', { status: 'running', input: '', idem: '' });
  const id = Number(
    d
      .prepare(
        `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, run_id, creado_en, actualizado_en, lanzado_en)
    VALUES ('redaccion_entera', 'test', 'entero', '{}', 'lanzado', 'run_entero', ?, ?, ?)`,
      )
      .run(hace(70), hace(70), hace(70)).lastInsertRowid,
  );
  // Un apartado enviado cada pocos minutos: cada envío queda en la auditoría.
  for (const min of [60, 45, 30, 12, 4]) {
    d.prepare(
      "INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en) VALUES ('redactor-entero', 'licitaciones_memoria_apartado', 'licitaciones', NULL, 'ok', ?)",
    ).run(hace(min));
  }
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, id)?.estado, 'lanzado', '70 min de run, con latido hace 4 min: sigue');
  d.close();
});

test('should_stop_and_relaunch_a_hung_job_with_a_new_key_without_spending_an_attempt', async () => {
  destino = servidorDePrueba();
  const d = otraCola('relanzar');
  const id = encolar(d, { tipo: 'prueba', dominio: 'test', clave: 'colgado', payload: { id: 'p-1', n: 70 } });
  await vueltaCola(d);
  const antes = obtenerTrabajo(d, id)!;
  assert.equal(antes.estado, 'lanzado');
  assert.equal(relanzarTrabajos(d, 'prueba', 'p-1'), 1);
  const t = obtenerTrabajo(d, id)!;
  assert.deepEqual([t.estado, t.intentos, t.run_id], ['pendiente', 0, null]);
  assert.match(t.error ?? '', /^Relanzado a mano/);
  await vueltaCola(d);
  const otro = obtenerTrabajo(d, id)!;
  assert.equal(otro.estado, 'lanzado');
  assert.notEqual(otro.run_id, antes.run_id, 'run nuevo');
  assert.notEqual(runs.get(otro.run_id!)!.idem, runs.get(antes.run_id!)!.idem, 'con otra clave de idempotencia');
  assert.equal(relanzarTrabajos(d, 'prueba', 'p-otra'), 0);
  d.close();
});

// Lanza un trabajo en una cola nueva y deja su run terminado con esta respuesta de Hermes.
async function terminarConRespuesta(nombre: string, t: { tipo: string; dominio: string }, salida: string) {
  const d = otraCola(nombre);
  const id = encolar(d, { ...t, clave: nombre, payload: { n: 60 } });
  await vueltaCola(d);
  const run = runs.get(obtenerTrabajo(d, id)!.run_id!)!;
  run.status = 'completed';
  run.output = salida;
  await vueltaCola(d);
  return { d, t: obtenerTrabajo(d, id)! };
}

test('should_not_pause_the_queue_when_hermes_answer_mentions_an_amount_with_429', async () => {
  destino = servidorDePrueba();
  const { d, t } = await terminarConRespuesta(
    'importe',
    { tipo: 'prueba', dominio: 'test' },
    'El presupuesto es de 1.429,00 € y no encuentro el PCAP.',
  );
  assert.equal(t.intentos, 1, 'es un fallo del trabajo: gasta un intento');
  assert.match(t.error ?? '', /1\.429,00 €/);
  assert.equal(estadoCola(d).pausa_por_limite_hasta, null, 'la cola no se pausa');
  d.close();
});

test('should_not_keep_hermes_answer_for_jobs_with_personal_data', async () => {
  registrarTipoTrabajo('cv_prueba', { destino: () => destino, instrucciones: () => 'lee', hecho: () => false });
  const { d, t } = await terminarConRespuesta(
    'personales',
    { tipo: 'cv_prueba', dominio: 'colaboradores' },
    'Ana Pérez Secreta no encaja.',
  );
  assert.match(t.error ?? '', /sin dejar el resultado/);
  assert.ok(!JSON.stringify(estadoCola(d).ultimos).includes('Ana'), 'ni en el error ni en plataforma_estado');
  d.close();
});

test('should_fail_only_the_job_whose_type_throws_and_launch_the_next_one', async () => {
  destino = servidorDePrueba();
  registrarTipoTrabajo('roto', {
    destino: () => destino,
    instrucciones: () => {
      throw new Error('payload con datos');
    },
    hecho: () => false,
  });
  const d = otraCola('aislado');
  const roto = encolar(d, { tipo: 'roto', dominio: 'test', clave: 'r1', payload: {} });
  const sano = encolar(d, { tipo: 'prueba', dominio: 'test', clave: 's1', payload: { n: 70 } });
  await vueltaCola(d, 1);
  const t = obtenerTrabajo(d, roto)!;
  assert.equal(t.estado, 'pendiente');
  assert.equal(t.intentos, 1);
  assert.match(t.error ?? '', /Error interno/);
  assert.ok(!t.error?.includes('payload con datos'));
  assert.equal(obtenerTrabajo(d, sano)?.estado, 'lanzado', 'el siguiente sale y ocupa el único hueco');
  d.close();
});

test('should_wait_without_retrying_when_hermes_lacks_a_platform_tool_until_someone_asks_again', async () => {
  // Si se despliega una herramienta nueva sin reiniciar Hermes, cada trabajo
  // lee los pliegos y falla al enviar: tres intentos por trabajo para nada.
  destino = servidorDePrueba();
  const salida = 'No he podido enviar el guion: la herramienta `licitaciones_guion` no está disponible en este perfil.';
  const { d, t } = await terminarConRespuesta('sin-herramienta', { tipo: 'prueba', dominio: 'test' }, salida);
  assert.equal(t.estado, 'pendiente');
  assert.equal(t.intentos, 0, `no gasta intento: ${t.error}`);
  assert.match(t.error ?? '', /^Falta una herramienta en Hermes \(licitaciones_guion\): reinicia Hermes/);
  assert.equal(t.codigo, 'sin_herramienta');
  const otro = encolar(d, { tipo: 'prueba', dominio: 'test', clave: 'detras', payload: { n: 61 } });
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, otro)!.estado, 'pendiente', 'el resto del tipo tampoco se lanza');
  assert.deepEqual(
    alertasIa(d, 'test').map((a) => [a.motivo, a.tipo]),
    [['herramienta', 'prueba']],
  );
  encolar(d, { tipo: 'prueba', dominio: 'test', clave: 'a-mano', payload: { n: 62 }, aMano: true });
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, t.id)!.estado, 'lanzado', 'pedirlo a mano lo reanuda');
  assert.deepEqual(alertasIa(d, 'test'), []);
  d.close();
});

// Con un solo hueco, el run que se lanza dice quién salió primero (su input lleva la clave).
async function primeroEnSalir(d: ReturnType<typeof otraCola>): Promise<string> {
  const antes = runs.size;
  await vueltaCola(d, 1);
  assert.equal(runs.size, antes + 1, 'con un hueco sale uno solo');
  return runs.get(`run_${runs.size}`)!.input;
}

test('should_launch_the_lower_prioridad_pending_before_an_older_one', async () => {
  destino = servidorDePrueba();
  const tipo = (nombre: string, rango: number) =>
    registrarTipoTrabajo(nombre, {
      destino: () => destino,
      instrucciones: (p) => (p as { q: string }).q,
      hecho: () => false,
      prioridad: () => rango,
    });
  tipo('urgente', 1);
  tipo('de_fondo', 50);
  const d = otraCola('prioridad');
  encolar(d, { tipo: 'de_fondo', dominio: 'test', clave: 'viejo', payload: { q: 'fondo' } });
  encolar(d, { tipo: 'urgente', dominio: 'test', clave: 'nuevo', payload: { q: 'urgente' } });
  assert.equal(await primeroEnSalir(d), 'urgente');
  d.close();
});

test('should_keep_a_fixed_prioridad_when_the_type_is_registered_before_or_after_it', async () => {
  destino = servidorDePrueba();
  const def = { destino: () => destino, instrucciones: (p: unknown) => (p as { q: string }).q, hecho: () => false };
  fijarPrioridad('fijado_antes', () => 1);
  registrarTipoTrabajo('fijado_antes', def);
  registrarTipoTrabajo('fijado_despues', def);
  fijarPrioridad('fijado_despues', () => 1);
  registrarTipoTrabajo('fijado_despues', def);
  registrarTipoTrabajo('neutro_a', { ...def, prioridad: () => 50 });
  for (const t of ['fijado_antes', 'fijado_despues']) {
    const d = otraCola(`fijado-${t}`);
    encolar(d, { tipo: 'neutro_a', dominio: 'test', clave: 'viejo', payload: { q: 'viejo' } });
    encolar(d, { tipo: t, dominio: 'test', clave: 'nuevo', payload: { q: t } });
    assert.equal(await primeroEnSalir(d), t);
    d.close();
  }
});

test('should_keep_fifo_order_when_the_type_defines_no_prioridad', async () => {
  destino = servidorDePrueba();
  registrarTipoTrabajo('sin_gancho', {
    destino: () => destino,
    instrucciones: (p) => (p as { q: string }).q,
    hecho: () => false,
  });
  const d = otraCola('fifo');
  encolar(d, { tipo: 'sin_gancho', dominio: 'test', clave: 'a', payload: { q: 'primero' } });
  encolar(d, { tipo: 'sin_gancho', dominio: 'test', clave: 'b', payload: { q: 'segundo' } });
  assert.equal(await primeroEnSalir(d), 'primero');
  d.close();
});

test('should_not_stop_the_queue_when_the_prioridad_hook_throws', async () => {
  destino = servidorDePrueba();
  registrarTipoTrabajo('gancho_roto', {
    destino: () => destino,
    instrucciones: (p) => (p as { q: string }).q,
    hecho: () => false,
    prioridad: () => {
      throw new Error('base cerrada');
    },
  });
  const d = otraCola('gancho-roto');
  encolar(d, { tipo: 'gancho_roto', dominio: 'test', clave: 'a', payload: { q: 'roto' } });
  assert.equal(await primeroEnSalir(d), 'roto', 'el trabajo cae en neutro y se lanza');
  d.close();
});

test('should_pause_the_whole_queue_without_spending_attempts_when_usage_is_exhausted', async () => {
  destino = servidorDePrueba();
  limiteAgotado = true;
  const d = otraCola('limite');
  const a = encolar(d, { tipo: 'prueba', dominio: 'test', clave: 'l1', payload: { n: 1 } });
  const b = encolar(d, { tipo: 'prueba', dominio: 'test', clave: 'l2', payload: { n: 2 } });
  await vueltaCola(d);
  const t = obtenerTrabajo(d, a)!;
  assert.equal(t.estado, 'pendiente');
  assert.equal(t.intentos, 0, `no gasta intento: ${t.error}`);
  assert.match(t.error ?? '', /429/);
  assert.equal(t.codigo, 'limite_uso');
  assert.ok(t.proximo_intento_en! > new Date(Date.now() + 25 * 60_000).toISOString());
  assert.equal(obtenerTrabajo(d, b)?.error, null, 'el siguiente ni se intenta: la cola está en pausa');
  assert.ok(estadoCola(d).pausa_por_limite_hasta);
  limiteAgotado = false;
  d.close();
});
