// Eventos de la cola de trabajos («licitacion.trabajo»): avisan de fallos finales, de la pausa
// por límite de uso y de relanzamientos, sin llevar nunca el error ni el payload.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cola-eventos-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo, ahora } = await import('../../src/nucleo/db.js');
const { encolar, vueltaCola } = await import('../../src/nucleo/trabajos.js');
const { registrarTipoTrabajo, fijarEventoTrabajos } = await import('../../src/nucleo/colaTipos.js');
const { relanzarColgadosDe } = await import('../../src/nucleo/colaRelanzado.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');

const KEY = 'clave-de-hermes-de-prueba';
const TIPO = 'evento_prueba';
const TIPO_PERSONAL = 'evento_personal';
let modo: 'ok' | 'limite' | 'caido' = 'ok';
let server: http.Server;
let destino: { url: string; key: string } | null = null;

before(() => {
  server = escucharLocal(
    http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.method === 'POST' && modo === 'limite') {
          res.writeHead(429).end('The usage limit has been reached');
          return;
        }
        if (req.method === 'POST') {
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ run_id: 'run_1', status: 'started' }));
          return;
        }
        if (modo === 'caido') {
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ status: 'failed', error: 'Datos de Persona A: DNI secreto' }));
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
  abiertas.forEach((d) => d.close());
  fs.rmSync(tmp, { recursive: true, force: true });
});

registrarTipoTrabajo(TIPO, { destino: () => destino, instrucciones: () => 'haz', hecho: () => false });
registrarTipoTrabajo(TIPO_PERSONAL, { destino: () => destino, instrucciones: () => 'haz', hecho: () => false });
fijarEventoTrabajos('test', 'test.trabajo');

type Db = ReturnType<typeof abrirNucleo>;
const abiertas: ReturnType<typeof abrirNucleo>[] = [];
const nuevaDb = (n: string) => {
  const d = abrirNucleo(path.join(tmp, n));
  abiertas.push(d);
  return d;
};
const pedir = (d: Db, tipo: string, dominio: string, id: string) =>
  encolar(d, { tipo, dominio, clave: `${id}-${Math.random()}`, payload: { id } });
const delTipo = (d: Db, tipo: string) => ultimosEventos(d, 50).filter((e) => e.tipo === tipo);

function marcarUltimoIntento(d: Db, id: number): void {
  d.prepare('UPDATE trabajos_ia SET intentos = 2 WHERE id = ?').run(id);
}

test('should_emit_a_tender_job_event_when_a_job_fails_for_good', async () => {
  // Arrange
  modo = 'caido';
  const d = nuevaDb('fallo');
  const id = pedir(d, TIPO, 'test', 'LIC-1');
  marcarUltimoIntento(d, id);
  await vueltaCola(d);
  // Act
  await vueltaCola(d);
  // Assert
  const eventos = delTipo(d, 'test.trabajo');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0]!.recurso, 'LIC-1');
  assert.equal(eventos[0]!.datos.estado, 'fallido');
  assert.equal(eventos[0]!.datos.trabajo, id);
  assert.equal(eventos[0]!.datos.tipo, TIPO);
  assert.equal(eventos[0]!.datos.intentos, 3);
});

test('should_emit_once_when_the_usage_limit_pauses_the_queue', async () => {
  // Arrange
  modo = 'limite';
  const d = nuevaDb('limite');
  for (const r of ['A', 'B', 'C']) pedir(d, TIPO, 'test', r);
  // Act
  await vueltaCola(d);
  await vueltaCola(d);
  // Assert
  const eventos = delTipo(d, 'test.trabajo');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0]!.datos.estado, 'esperando');
  assert.equal(eventos[0]!.datos.codigo, 'limite_uso');
  assert.ok(eventos[0]!.datos.proximo_intento_en);
});

test('should_emit_when_a_hung_job_is_relaunched', () => {
  // Arrange
  const d = nuevaDb('colgado');
  const id = pedir(d, TIPO, 'test', 'LIC-2');
  d.prepare("UPDATE trabajos_ia SET estado = 'lanzado', lanzado_en = ? WHERE id = ?").run(ahora(), id);
  // Act
  const n = relanzarColgadosDe(d, TIPO, 'LIC-2');
  // Assert
  assert.equal(n, 1);
  const eventos = delTipo(d, 'test.trabajo');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0]!.datos.estado, 'relanzado');
  assert.equal(eventos[0]!.datos.codigo, 'relanzado');
});

test('should_not_put_the_resource_of_personal_data_jobs_in_the_event', async () => {
  // Arrange
  modo = 'caido';
  const d = nuevaDb('personal');
  const id = pedir(d, TIPO_PERSONAL, 'colaboradores', 'PERSONA-A');
  marcarUltimoIntento(d, id);
  await vueltaCola(d);
  // Act
  await vueltaCola(d);
  // Assert
  const eventos = delTipo(d, 'trabajo.cambio');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0]!.recurso, null);
  assert.ok(!JSON.stringify(eventos[0]!).includes('PERSONA-A'));
});

test('should_not_include_the_error_text_in_the_event', async () => {
  // Arrange
  modo = 'caido';
  const d = nuevaDb('sinerror');
  const id = pedir(d, TIPO, 'test', 'LIC-3');
  marcarUltimoIntento(d, id);
  await vueltaCola(d);
  // Act
  await vueltaCola(d);
  // Assert
  const texto = JSON.stringify(delTipo(d, 'test.trabajo'));
  assert.ok(texto.length > 2);
  assert.ok(!texto.includes('DNI secreto'));
  assert.ok(!texto.includes('Persona A'));
});
