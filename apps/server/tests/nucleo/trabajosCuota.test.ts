// Cuota del modelo: un doble clic encola un solo run (encolarUnico), un run que acaba sin
// resultado dos veces por lo mismo no se reintenta y un colgado se relanza sin gastar intento
// hasta un tope. Hermes simulado por HTTP, con idempotencia por Idempotency-Key como el real.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trabajos-cuota-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { encolar, encolarUnico, vueltaCola } = await import('../../src/nucleo/trabajos.js');
const { fijarLimitador } = await import('../../src/nucleo/colaOrden.js');
const { registrarTipoTrabajo, obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { relanzarColgadosDe } = await import('../../src/nucleo/colaRelanzado.js');

const db = abrirNucleo(tmp);
const runs = new Map<string, { status: string; output?: string }>();
const porClave = new Map<string, string>();
let destino: { url: string; key: string } | null = null;
let server: http.Server;

function lanzarSimulado(req: http.IncomingMessage): { run_id: string; status: string } {
  const clave = String(req.headers['idempotency-key'] ?? '');
  const previo = porClave.get(clave);
  if (previo) return { run_id: previo, status: runs.get(previo)!.status };
  const id = `run_${runs.size + 1}`;
  runs.set(id, { status: 'started' });
  porClave.set(clave, id);
  return { run_id: id, status: 'started' };
}

before(async () => {
  server = escucharLocal(
    http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const json = (status: number, cuerpo: unknown) =>
          res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo));
        if (req.method === 'POST' && req.url === '/v1/runs') return json(200, lanzarSimulado(req));
        const [, , , id, accion] = (req.url ?? '').split('/');
        const run = runs.get(decodeURIComponent(id ?? ''));
        if (!run) return json(404, {});
        if (accion === 'stop') return json(200, { status: 'cancelled' });
        return json(200, run);
      });
    }),
  );
  destino = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, key: 'clave-de-hermes-de-prueba' };
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

registrarTipoTrabajo('lic.cuota', { destino: () => destino, instrucciones: () => 'haz', hecho: () => false });

// Cada prueba con runs empieza con la cola vacía: lo encolado por las anteriores ocuparía los huecos.
const vaciarCola = () =>
  db.prepare(`UPDATE trabajos_ia SET estado = 'cancelado' WHERE estado IN ('pendiente', 'lanzado')`).run();
const listoParaReintentar = (id: number) =>
  db.prepare('UPDATE trabajos_ia SET proximo_intento_en = NULL WHERE id = ?').run(id);

async function completarSinResultado(id: number, salida: string): Promise<void> {
  listoParaReintentar(id);
  await vueltaCola(db, 5);
  runs.set(obtenerTrabajo(db, id)!.run_id!, { status: 'completed', output: salida });
  await vueltaCola(db, 0);
}

test('should_return_the_same_job_when_the_same_request_arrives_twice', () => {
  const base = 'lic.cuota:exp-2026.01-a';
  const primero = encolarUnico(db, { tipo: 'lic.cuota', dominio: 'lic', base, payload: { id: 'p-1' } });
  const segundo = encolarUnico(db, { tipo: 'lic.cuota', dominio: 'lic', base, payload: { id: 'p-1' } });
  assert.deepEqual(primero, { id: primero.id, nuevo: true });
  assert.deepEqual(segundo, { id: primero.id, nuevo: false });
  assert.equal(obtenerTrabajo(db, primero.id)!.clave, `${base}#1`);
});

test('should_mark_as_requested_by_a_person_a_pending_job_an_agent_queued_first', () => {
  const base = 'lic.cuota:p-a-mano';
  const agente = encolarUnico(db, { tipo: 'lic.cuota', dominio: 'lic', base, payload: { id: 'p-a-mano' } });
  assert.equal(obtenerTrabajo(db, agente.id)!.a_mano, 0);
  const persona = encolarUnico(db, {
    tipo: 'lic.cuota',
    dominio: 'lic',
    base,
    payload: { id: 'p-a-mano' },
    aMano: true,
  });
  assert.deepEqual(persona, { id: agente.id, nuevo: false });
  assert.equal(obtenerTrabajo(db, agente.id)!.a_mano, 1);
});

test('should_not_mix_jobs_of_bases_that_share_a_prefix_with_dashes_or_dots', () => {
  const corta = encolarUnico(db, { tipo: 'lic.cuota', dominio: 'lic', base: 'lic.cuota:p-2', payload: { id: 'p-2' } });
  for (const base of ['lic.cuota:p-20', 'lic.cuota:p-2.1', 'lic.cuota:p-2-b']) {
    const otra = encolarUnico(db, { tipo: 'lic.cuota', dominio: 'lic', base, payload: { id: base } });
    assert.equal(otra.nuevo, true, base);
    assert.notEqual(otra.id, corta.id, base);
    assert.equal(obtenerTrabajo(db, otra.id)!.clave, `${base}#1`);
  }
});

test('should_create_a_new_job_once_the_previous_one_finished', () => {
  const base = 'lic.cuota:p-3';
  const primero = encolarUnico(db, { tipo: 'lic.cuota', dominio: 'lic', base, payload: { id: 'p-3' } });
  db.prepare(`UPDATE trabajos_ia SET estado = 'completado' WHERE id = ?`).run(primero.id);
  const segundo = encolarUnico(db, { tipo: 'lic.cuota', dominio: 'lic', base, payload: { id: 'p-3' } });
  assert.equal(segundo.nuevo, true);
  assert.notEqual(segundo.id, primero.id);
  assert.equal(obtenerTrabajo(db, segundo.id)!.clave, `${base}#2`);
});

test('should_store_whether_a_person_asked_for_the_job', () => {
  const aMano = encolarUnico(db, {
    tipo: 'lic.cuota',
    dominio: 'lic',
    base: 'lic.cuota:p-4',
    payload: { id: 'p-4' },
    aMano: true,
  });
  const solo = encolar(db, { tipo: 'lic.cuota', dominio: 'lic', clave: 'lic.cuota:p-5', payload: { id: 'p-5' } });
  assert.equal(obtenerTrabajo(db, aMano.id)!.a_mano, 1);
  assert.equal(obtenerTrabajo(db, solo)!.a_mano, 0);
});

test('should_not_retry_a_job_whose_run_ended_twice_without_result_for_the_same_reason', async () => {
  vaciarCola();
  const id = encolar(db, { tipo: 'lic.cuota', dominio: 'lic', clave: 'lic.cuota:p-6', payload: { id: 'p-6' } });
  await completarSinResultado(id, 'No encuentro el pliego técnico.');
  assert.equal(obtenerTrabajo(db, id)!.estado, 'pendiente', 'el primer sin resultado se reintenta');
  await completarSinResultado(id, 'No encuentro el pliego técnico.');
  const t = obtenerTrabajo(db, id)!;
  assert.equal(t.estado, 'fallido');
  assert.equal(t.intentos, 2, 'no gastó el tercer intento');
  assert.equal(t.codigo, 'sin_resultado');
  assert.ok(t.error!.endsWith(' Misma causa dos veces seguidas: no se reintenta.'), t.error!);
});

test('should_retry_when_the_reason_without_result_changes', async () => {
  vaciarCola();
  const id = encolar(db, { tipo: 'lic.cuota', dominio: 'lic', clave: 'lic.cuota:p-7', payload: { id: 'p-7' } });
  await completarSinResultado(id, 'No encuentro el pliego técnico.');
  await completarSinResultado(id, 'El anexo III está escaneado.');
  const t = obtenerTrabajo(db, id)!;
  assert.equal(t.estado, 'pendiente');
  assert.equal(t.intentos, 2);
  assert.ok(!t.error!.includes('Misma causa'));
});

test('should_relaunch_a_hung_job_twice_without_spending_an_attempt_and_spend_it_the_third_time', async () => {
  vaciarCola();
  const id = encolar(db, { tipo: 'lic.cuota', dominio: 'lic', clave: 'lic.cuota:p-8', payload: { id: 'p-8' } });
  await vueltaCola(db, 5);
  const vistos = new Set([obtenerTrabajo(db, id)!.run_id]);
  for (const esperado of [
    { intentos: 0, relanzamientos: 1 },
    { intentos: 0, relanzamientos: 2 },
    { intentos: 1, relanzamientos: 2 },
  ]) {
    assert.equal(relanzarColgadosDe(db, 'lic.cuota', 'p-8'), 1);
    const t = obtenerTrabajo(db, id)!;
    assert.deepEqual({ intentos: t.intentos, relanzamientos: t.relanzamientos }, esperado);
    assert.equal(t.estado, 'pendiente');
    await vueltaCola(db, 5);
    vistos.add(obtenerTrabajo(db, id)!.run_id);
  }
  assert.equal(vistos.size, 4, 'cada relanzamiento es un run nuevo, no el colgado de antes');
});

test('should_retry_a_personal_data_job_without_result_twice_since_its_error_hides_the_reason', async () => {
  // Arrange: un trabajo de colaboradores, cuyo error no guarda la respuesta de Hermes.
  vaciarCola();
  registrarTipoTrabajo('colaboradores.cuota', {
    destino: () => destino,
    instrucciones: () => 'haz',
    hecho: () => false,
  });
  const id = encolar(db, {
    tipo: 'colaboradores.cuota',
    dominio: 'colaboradores',
    clave: 'colaboradores.cuota:1',
    payload: { id: '1' },
  });
  // Act
  await completarSinResultado(id, 'No encuentro el CV.');
  await completarSinResultado(id, 'El CV está escaneado.');
  // Assert
  const t = obtenerTrabajo(db, id)!;
  assert.equal(t.estado, 'pendiente', 'dos motivos distintos que no se ven: le queda el tercer intento');
  assert.equal(t.intentos, 2);
});

test('should_evaluate_the_limiter_per_type_and_recount_after_each_launch', async () => {
  // Arrange: un limitador que retiene un tipo (como las lecciones cerca del plazo) y tiene un tope de 1 run por oferta.
  vaciarCola();
  registrarTipoTrabajo('lim.oferta', { destino: () => destino, instrucciones: () => 'haz', hecho: () => false });
  registrarTipoTrabajo('lim.lecciones', { destino: () => destino, instrucciones: () => 'haz', hecho: () => false });
  const lanzadosDe = (id: string) =>
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM trabajos_ia WHERE json_extract(payload, '$.id') = ? AND lanzado_en IS NOT NULL",
        )
        .get(id) as { n: number }
    ).n;
  fijarLimitador('lim', (t) =>
    t.tipo === 'lim.lecciones' ? 'plazo_cercano' : lanzadosDe('x') >= 1 ? 'tope_oferta' : null,
  );
  const oferta = encolar(db, { tipo: 'lim.oferta', dominio: 'lim', clave: 'lim:oferta-1', payload: { id: 'x' } });
  const otra = encolar(db, { tipo: 'lim.oferta', dominio: 'lim', clave: 'lim:oferta-2', payload: { id: 'x' } });
  const lecciones = encolar(db, {
    tipo: 'lim.lecciones',
    dominio: 'lim',
    clave: 'lim:lecciones',
    payload: { id: 'x' },
  });
  // Act
  await vueltaCola(db, 5);
  // Assert
  const estado = (id: number) => obtenerTrabajo(db, id)!.estado;
  assert.equal(estado(oferta), 'lanzado');
  assert.equal(estado(otra), 'pendiente', 'tras el primer lanzamiento la oferta ya llegó a su tope');
  assert.equal(estado(lecciones), 'pendiente', 'las lecciones no heredan el «sin motivo» del otro tipo');
});

test('should_mark_as_asked_by_a_person_the_jobs_queued_by_hand_before_the_column_existed', async () => {
  // Arrange: una base de antes de a_mano, con trabajos pedidos a mano y automáticos.
  const { default: Database } = await import('better-sqlite3');
  const dir = path.join(tmp, 'antes-de-a-mano');
  fs.mkdirSync(dir, { recursive: true });
  const vieja = new Database(path.join(dir, 'nucleo.db'));
  vieja.exec(`CREATE TABLE trabajos_ia (id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, dominio TEXT NOT NULL, clave TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL, estado TEXT NOT NULL, run_id TEXT, intentos INTEGER NOT NULL DEFAULT 0, error TEXT, proximo_intento_en TEXT,
    creado_en TEXT NOT NULL, actualizado_en TEXT NOT NULL)`);
  const ISO = '2026-10-14T09:30:00.000Z';
  const claves = {
    [`guion-p-1-${ISO}`]: 1,
    [`decisiones-p-1-${ISO}`]: 1,
    [`anexo-p-1-a1-d2-${ISO}`]: 1,
    [`ficha-p-2-${ISO}`]: 1,
    'memoria-p-1-v2-a3': 1,
    [`anexo-auto-p-1-a1-d2-${ISO}`]: 0,
    'ficha-auto-p-3': 0,
    'decisiones-auto-p-1-g4': 0,
    'lecciones-p-1-v2': 0,
    [`perfil-cv-abc-${ISO}`]: 0,
  };
  const ins = vieja.prepare(
    "INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en) VALUES ('t', 'lic', ?, '{}', 'pendiente', ?, ?)",
  );
  for (const clave of Object.keys(claves)) ins.run(clave, ISO, ISO);
  vieja.close();
  // Act
  const nueva = abrirNucleo(dir);
  // Assert
  const filas = nueva.prepare('SELECT clave, a_mano FROM trabajos_ia').all() as { clave: string; a_mano: number }[];
  assert.deepEqual(Object.fromEntries(filas.map((f) => [f.clave, f.a_mano])), claves);
  nueva.prepare("UPDATE trabajos_ia SET a_mano = 0 WHERE clave = 'memoria-p-1-v2-a3'").run();
  nueva.close();
  const otraVez = abrirNucleo(dir);
  assert.equal(
    (otraVez.prepare("SELECT a_mano FROM trabajos_ia WHERE clave = 'memoria-p-1-v2-a3'").get() as { a_mano: number })
      .a_mano,
    0,
    'solo una vez, al crear la columna',
  );
  otraVez.close();
});
