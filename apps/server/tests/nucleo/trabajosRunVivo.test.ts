// Desde cuándo puede haber un run vivo de un trabajo (run_vivo_desde): un run parado sin
// confirmación (relanzado a mano, inactivo con Hermes sin responder) aún puede guardar después
// de que se lance el siguiente; uno que Hermes dio por acabado, no. Hermes simulado por HTTP.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trabajos-run-vivo-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { encolar, vueltaCola } = await import('../../src/nucleo/trabajos.js');
const { registrarTipoTrabajo, obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { relanzarTrabajos } = await import('../../src/nucleo/colaRelanzado.js');

const db = abrirNucleo(tmp);
const KEY = 'clave-de-hermes-de-prueba';
const estados = new Map<string, string>();
let pararFalla = false;
let destino: { url: string; key: string } | null = null;
let server: http.Server;

before(async () => {
  server = escucharLocal(
    http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        const json = (status: number, cuerpo: unknown) =>
          res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(cuerpo));
        if (req.method === 'POST' && req.url === '/v1/runs') {
          const id = `run_${estados.size + 1}`;
          estados.set(id, 'started');
          return json(200, { run_id: id, status: 'started' });
        }
        const [, , , id, accion] = (req.url ?? '').split('/');
        const estado = estados.get(decodeURIComponent(id ?? ''));
        if (!estado) return json(404, {});
        if (accion === 'stop') return pararFalla ? json(503, {}) : json(200, { status: 'cancelled' });
        return json(200, { status: estado });
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

registrarTipoTrabajo('lic.guion', { destino: () => destino, instrucciones: () => 'haz', hecho: () => false });

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('should_keep_the_launch_of_a_run_stopped_without_confirmation_when_relaunching', async () => {
  const id = encolar(db, { tipo: 'lic.guion', dominio: 'lic', clave: 'g-1', payload: { id: 'p-1' } });
  await vueltaCola(db, 5);
  const primero = obtenerTrabajo(db, id)!;
  assert.equal(primero.run_vivo_desde, primero.lanzado_en, 'el primer run marca desde cuándo');
  pararFalla = true;
  relanzarTrabajos(db, 'lic.guion', 'p-1');
  await espera(5);
  await vueltaCola(db, 5);
  const segundo = obtenerTrabajo(db, id)!;
  assert.equal(segundo.estado, 'lanzado');
  assert.ok(segundo.lanzado_en! > primero.lanzado_en!, 'se lanzó otro run');
  assert.equal(segundo.run_vivo_desde, primero.lanzado_en, 'el run anterior puede seguir vivo y guardar');
});

test('should_restart_the_live_run_mark_after_hermes_confirms_the_run_ended', async () => {
  pararFalla = false;
  const id = encolar(db, { tipo: 'lic.guion', dominio: 'lic', clave: 'g-2', payload: { id: 'p-2' } });
  await vueltaCola(db, 5);
  const primero = obtenerTrabajo(db, id)!;
  estados.set(primero.run_id!, 'failed');
  await vueltaCola(db, 0);
  const fallado = obtenerTrabajo(db, id)!;
  assert.equal(fallado.estado, 'pendiente');
  assert.equal(fallado.run_vivo_desde, null, 'Hermes dio el run por acabado');
  db.prepare('UPDATE trabajos_ia SET proximo_intento_en = NULL WHERE id = ?').run(id);
  await espera(5);
  await vueltaCola(db, 5);
  const segundo = obtenerTrabajo(db, id)!;
  assert.equal(segundo.run_vivo_desde, segundo.lanzado_en);
  assert.ok(segundo.run_vivo_desde! > primero.lanzado_en!);
});

test('should_forget_every_live_run_when_hermes_no_longer_knows_the_run', async () => {
  const id = encolar(db, { tipo: 'lic.guion', dominio: 'lic', clave: 'g-3', payload: { id: 'p-3' } });
  await vueltaCola(db, 5);
  pararFalla = true;
  relanzarTrabajos(db, 'lic.guion', 'p-3');
  await espera(5);
  await vueltaCola(db, 5);
  const t = obtenerTrabajo(db, id)!;
  assert.notEqual(t.run_vivo_desde, t.lanzado_en, 'arrastra el run anterior');
  estados.delete(t.run_id!);
  await vueltaCola(db, 0);
  assert.equal(
    obtenerTrabajo(db, id)!.run_vivo_desde,
    null,
    'un 404 es un Hermes reiniciado: no queda ningún run vivo',
  );
});
