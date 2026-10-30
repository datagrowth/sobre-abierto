// La cola no lanza trabajos al perfil de Hermes que tiene la lista de herramientas de antes del
// despliegue (14/10/2026: el guion de CASO_E gastó sus tres intentos con la tool vieja): esperan sin
// gastar intento ni hueco y salen en cuanto ese perfil vuelve a pedir la lista. Hermes simulado
// por HTTP (la frontera).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trabajos-desfase-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo, ahora } = await import('../../src/nucleo/db.js');
const { encolar, vueltaCola } = await import('../../src/nucleo/trabajos.js');
const { registrarTipoTrabajo, obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { estadoCola, resumenCola, listarTrabajos } = await import('../../src/nucleo/colaConsultas.js');
const { alertasIa } = await import('../../src/nucleo/colaAlertas.js');
const { estadisticasCola, codigoDeError } = await import('../../src/nucleo/colaEstadisticas.js');
const { guardarHuella, anotarListado } = await import('../../src/nucleo/mcp/huellas.js');

const db = abrirNucleo(tmp);
const KEY = 'clave-de-hermes-de-prueba';
const idems: string[] = [];
let destino: { url: string; key: string } | null = null;
let server: http.Server;

before(async () => {
  server = escucharLocal(
    http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.headers.authorization !== `Bearer ${KEY}`) {
          res.writeHead(401).end('{}');
          return;
        }
        if (req.method === 'POST' && req.url === '/v1/runs') {
          idems.push(String(req.headers['idempotency-key']));
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ run_id: `run_${idems.length}`, status: 'started' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'started' }));
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

const tipo = (agente?: string, conDestino = true) => ({
  destino: () => (conDestino ? destino : null),
  instrucciones: () => 'haz',
  hecho: () => false,
  ...(agente ? { metricas: { agente, stateDb: () => null } } : {}),
});
registrarTipoTrabajo('lic.guion', tipo('oferta-licitaciones'));
registrarTipoTrabajo('lic.ficha', tipo('licitaciones'));
registrarTipoTrabajo('lic.suelto', tipo());
// Un perfil sin gateway configurado: no hay a quién reiniciar.
registrarTipoTrabajo('otro.ficha', tipo('sin-gateway', false));

// La huella del perfil cambió hace un momento y Hermes tiene la lista de antes: está desfasado.
const marca = new Date(Date.now() - 60_000).toISOString();
guardarHuella(db, 'oferta-licitaciones', 'vieja', marca);
guardarHuella(db, 'oferta-licitaciones', 'nueva', marca);
// Primer arranque para «licitaciones»: sin huella previa, no bloquea.
guardarHuella(db, 'licitaciones', 'primera', marca);
// Agentes que no ejecutan trabajos de la cola (Claude Code, el token antiguo) o sin gateway, desfasados.
for (const otro of ['claude-code', 'hermes', 'sin-gateway']) {
  guardarHuella(db, otro, 'vieja', marca);
  guardarHuella(db, otro, 'nueva', marca);
}

let guion = 0;

test('should_not_launch_nor_spend_attempt_when_fingerprint_changed_without_listing', async () => {
  guion = encolar(db, { tipo: 'lic.guion', dominio: 'lic', clave: 'guion-casoE', payload: { id: 'p-1' } });
  await vueltaCola(db, 10);
  const t = obtenerTrabajo(db, guion)!;
  assert.equal(t.estado, 'pendiente');
  assert.equal(t.intentos, 0);
  assert.equal(t.run_id, null);
  assert.equal(t.codigo, 'herramientas_desfasadas');
  assert.match(t.error ?? '', /^Hermes tiene la lista de herramientas de antes del despliegue: reinicia Hermes/);
  assert.equal(codigoDeError(t.error!), 'herramientas_desfasadas');
  assert.equal(idems.length, 0, 'no se lanzó ningún run');
  await vueltaCola(db, 10);
  assert.equal(obtenerTrabajo(db, guion)!.intentos, 0, 'tampoco en la vuelta siguiente');
});

test('should_mark_stale_jobs_even_when_there_is_no_free_slot', async () => {
  const otro = encolar(db, { tipo: 'lic.guion', dominio: 'lic', clave: 'guion-otro', payload: { id: 'p-9' } });
  await vueltaCola(db, 0);
  assert.equal(obtenerTrabajo(db, otro)!.codigo, 'herramientas_desfasadas', 'sin huecos también se ve por qué espera');
  assert.equal(listarTrabajos(db, { codigo: 'herramientas_desfasadas', desde: 0, limite: 10 }).total, 2);
});

test('should_show_only_stale_hermes_profiles_that_run_queue_jobs', () => {
  const estado = estadoCola(db) as { herramientas_desfasadas: { agente: string }[] };
  assert.deepEqual(
    estado.herramientas_desfasadas.map((d) => d.agente),
    ['oferta-licitaciones'],
    'ni claude-code, ni hermes, ni un perfil sin gateway',
  );
  assert.deepEqual(
    resumenCola(db).desfasados.map((d) => d.agente),
    ['oferta-licitaciones'],
  );
  const alerta = alertasIa(db, 'lic').find((a) => a.motivo === 'desfase');
  assert.equal(alerta?.tipo, 'lic.guion');
  assert.equal(alerta?.hasta, null);
  const g = estadisticasCola(db).por_tipo.find((e) => e.tipo === 'lic.guion');
  assert.deepEqual(g?.esperas_por_codigo, { herramientas_desfasadas: 2 });
});

test('should_not_block_types_of_other_agents_nor_types_without_agent', async () => {
  const ficha = encolar(db, { tipo: 'lic.ficha', dominio: 'lic', clave: 'ficha-1', payload: { id: 'p-2' } });
  const suelto = encolar(db, { tipo: 'lic.suelto', dominio: 'lic', clave: 'suelto-1', payload: { id: 'p-3' } });
  await vueltaCola(db, 10);
  assert.equal(obtenerTrabajo(db, ficha)!.estado, 'lanzado', 'agente en su primer arranque con huella');
  assert.equal(obtenerTrabajo(db, suelto)!.estado, 'lanzado', 'tipo sin metricas.agente');
  assert.equal(obtenerTrabajo(db, guion)!.estado, 'pendiente');
});

test('should_not_touch_a_run_already_launched_when_its_agent_becomes_stale', async () => {
  guardarHuella(db, 'licitaciones', 'otra', ahora());
  const ficha = obtenerTrabajo(db, encolar(db, { tipo: 'lic.ficha', dominio: 'lic', clave: 'ficha-1', payload: {} }))!;
  await vueltaCola(db, 10);
  const despues = obtenerTrabajo(db, ficha.id)!;
  assert.equal(despues.estado, 'lanzado');
  assert.equal(despues.run_id, ficha.run_id);
  assert.equal(despues.codigo, null);
});

test('should_clear_the_stale_code_once_listed_even_without_a_free_slot', async () => {
  const esperaba = obtenerTrabajo(db, guion)!;
  anotarListado(db, 'oferta-licitaciones', 'nueva', ahora());
  await vueltaCola(db, 0);
  const t = obtenerTrabajo(db, guion)!;
  assert.equal(t.estado, 'pendiente');
  assert.equal(t.codigo, null, 'ya no dice herramientas_desfasadas');
  assert.equal(t.error, null, 'ni «reinicia Hermes»');
  assert.equal(t.proximo_intento_en, esperaba.proximo_intento_en, 'conserva cuándo empezó la espera (la clave)');
  assert.equal(listarTrabajos(db, { codigo: 'herramientas_desfasadas', desde: 0, limite: 10 }).total, 0);
});

test('should_launch_with_a_new_key_and_without_the_stale_code_after_a_later_listing', async () => {
  const esperaba = obtenerTrabajo(db, guion)!;
  assert.ok(esperaba.proximo_intento_en, 'la espera dejó su hora');
  await vueltaCola(db, 10);
  const t = obtenerTrabajo(db, guion)!;
  assert.equal(t.estado, 'lanzado');
  assert.equal(t.intentos, 0, 'la espera no gastó intento');
  assert.equal(t.codigo, null);
  assert.equal(t.error, null);
  assert.ok(
    idems.includes(`guion-casoE#0#${esperaba.proximo_intento_en}`),
    `clave con la hora de la espera, no «#null»: ${idems.join(', ')}`,
  );
});

test('should_launch_a_job_marked_stale_in_the_same_round_its_agent_listed', async () => {
  guardarHuella(db, 'oferta-licitaciones', 'otra-mas', ahora());
  const id = encolar(db, { tipo: 'lic.guion', dominio: 'lic', clave: 'guion-tercero', payload: { id: 'p-7' } });
  await vueltaCola(db, 50);
  const marcado = obtenerTrabajo(db, id)!;
  assert.equal(marcado.codigo, 'herramientas_desfasadas');
  anotarListado(db, 'oferta-licitaciones', 'otra-mas', ahora());
  await vueltaCola(db, 50);
  const t = obtenerTrabajo(db, id)!;
  assert.equal(t.estado, 'lanzado');
  assert.equal(t.codigo, null);
  assert.equal(t.error, null);
  assert.equal(idems.at(-1), `guion-tercero#0#${marcado.proximo_intento_en}`);
});
