// Frenos y pausa de la cola contra una API de runs de Hermes simulada (la frontera HTTP): la
// pausa por el límite de uso y las reactivaciones a mano sobreviven a un reinicio, y el freno
// por fallos es de cada oferta salvo que el fallo se repita en varias (entonces, del tipo).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cola-frenos-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo, ahora } = await import('../../src/nucleo/db.js');
const { encolar, vueltaCola } = await import('../../src/nucleo/trabajos.js');
const { registrarTipoTrabajo, obtenerTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { frenadoHasta } = await import('../../src/nucleo/colaFrenos.js');
const { alertasIa } = await import('../../src/nucleo/colaAlertas.js');
const { resumenCola, estadoCola } = await import('../../src/nucleo/colaConsultas.js');
const { relanzarTrabajos } = await import('../../src/nucleo/colaRelanzado.js');
const { pausaHastaMs } = await import('../../src/nucleo/colaEsperas.js');

const KEY = 'clave-de-hermes-de-prueba';
const TIPO = 'oferta_prueba';
let lanzados = 0;
let limiteAgotado = false;
let server: http.Server;
let destino: { url: string; key: string } | null = null;

before(() => {
  server = escucharLocal(
    http.createServer((req, res) => {
      if (req.headers.authorization !== `Bearer ${KEY}`) {
        res.writeHead(401).end('{}');
        return;
      }
      req.resume();
      req.on('end', () => {
        if (req.method === 'POST' && limiteAgotado) {
          res.writeHead(429).end('The usage limit has been reached');
          return;
        }
        if (req.method === 'POST') {
          lanzados += 1;
          res
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify({ run_id: `run_${lanzados}`, status: 'started' }));
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
  fs.rmSync(tmp, { recursive: true, force: true });
});

registrarTipoTrabajo(TIPO, { destino: () => destino, instrucciones: () => 'haz la oferta', hecho: () => false });

type Db = ReturnType<typeof abrirNucleo>;
const carpeta = (nombre: string) => path.join(tmp, nombre);

function fallidos(d: Db, recursos: string[]): void {
  const ins =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, intentos, creado_en, actualizado_en)
    VALUES (?, 'test', ?, ?, 'fallido', 3, ?, ?)`);
  recursos.forEach((r, i) =>
    ins.run(TIPO, `fallo-${r}-${i}-${Math.random()}`, JSON.stringify({ id: r }), ahora(), ahora()),
  );
}

const pedir = (d: Db, recurso: string) =>
  encolar(d, { tipo: TIPO, dominio: 'test', clave: `pedido-${recurso}-${Math.random()}`, payload: { id: recurso } });

test('should_keep_the_usage_limit_pause_after_a_restart', async () => {
  // Arrange
  limiteAgotado = true;
  const d = abrirNucleo(carpeta('pausa'));
  const a = pedir(d, 'A');
  await vueltaCola(d);
  assert.equal(obtenerTrabajo(d, a)?.codigo, 'limite_uso');
  d.close();
  limiteAgotado = false;
  // Act
  const reabierta = abrirNucleo(carpeta('pausa'));
  pedir(reabierta, 'B');
  const antes = lanzados;
  await vueltaCola(reabierta);
  // Assert
  assert.equal(lanzados, antes, 'tras reiniciar, la cola sigue en pausa y no lanza');
  assert.ok(pausaHastaMs(reabierta) > Date.now());
  assert.ok(resumenCola(reabierta).pausa_hasta);
  assert.ok(estadoCola(reabierta).pausa_por_limite_hasta);
  assert.deepEqual(
    alertasIa(reabierta, 'test').map((x) => x.motivo),
    ['limite'],
  );
  assert.equal(pausaHastaMs(reabierta, Date.now() + 31 * 60_000), 0, 'la pausa caduca');
  reabierta.close();
});

test('should_brake_only_the_tender_whose_last_three_jobs_failed', async () => {
  // Arrange
  const d = abrirNucleo(carpeta('freno-oferta'));
  fallidos(d, ['A', 'A', 'A']);
  const deA = pedir(d, 'A');
  const deB = pedir(d, 'B');
  // Act
  await vueltaCola(d, 5);
  // Assert
  assert.equal(obtenerTrabajo(d, deA)?.estado, 'pendiente', 'A está frenada');
  assert.equal(obtenerTrabajo(d, deB)?.estado, 'lanzado', 'los fallos de A no frenan a B');
  assert.equal(frenadoHasta(d, TIPO), null, 'el tipo entero no está frenado');
  assert.ok(frenadoHasta(d, TIPO, Date.now(), 'A'));
  assert.equal(frenadoHasta(d, TIPO, Date.now(), 'B'), null);
  assert.equal(frenadoHasta(d, TIPO, Date.now() + 6 * 60 * 60_000 + 1, 'A'), null, 'el freno de la oferta caduca');
  d.close();
});

test('should_brake_the_whole_type_when_six_jobs_failed_across_three_tenders', async () => {
  // Arrange
  const d = abrirNucleo(carpeta('freno-tipo'));
  fallidos(d, ['A', 'B', 'A', 'B', 'A', 'B']);
  assert.equal(frenadoHasta(d, TIPO), null, 'seis fallos de solo dos ofertas no frenan el tipo');
  fallidos(d, ['C', 'A', 'B', 'C', 'A', 'B']);
  const deD = pedir(d, 'D');
  // Act
  await vueltaCola(d, 5);
  // Assert
  assert.ok(frenadoHasta(d, TIPO), 'seis fallos de tres ofertas frenan el tipo');
  assert.ok(frenadoHasta(d, TIPO, Date.now(), 'D'), 'también para una oferta sin fallos');
  assert.equal(obtenerTrabajo(d, deD)?.estado, 'pendiente');
  d.close();
});

test('should_keep_a_person_reactivation_after_a_restart', async () => {
  // Arrange
  const d = abrirNucleo(carpeta('reactivar'));
  fallidos(d, ['A', 'A', 'A', 'C', 'C', 'C']);
  pedir(d, 'A');
  assert.equal(relanzarTrabajos(d, TIPO, 'A'), 1);
  d.close();
  // Act
  const reabierta = abrirNucleo(carpeta('reactivar'));
  const deC = pedir(reabierta, 'C');
  await vueltaCola(reabierta, 5);
  // Assert
  assert.equal(frenadoHasta(reabierta, TIPO, Date.now(), 'A'), null, 'la reactivación de A sigue tras reiniciar');
  const deA = reabierta
    .prepare(
      `SELECT estado FROM trabajos_ia WHERE estado IN ('pendiente', 'lanzado') AND json_extract(payload, '$.id') = 'A'`,
    )
    .get() as { estado: string };
  assert.equal(deA.estado, 'lanzado');
  assert.equal(obtenerTrabajo(reabierta, deC)?.estado, 'pendiente', 'relanzar A no quita el freno de C');
  reabierta.close();
});

test('should_list_the_braked_tenders_in_the_ia_alert', () => {
  // Arrange
  const porOferta = abrirNucleo(carpeta('alerta-oferta'));
  fallidos(porOferta, ['B', 'A', 'A', 'A', 'C', 'C', 'C']);
  const delTipo = abrirNucleo(carpeta('alerta-tipo'));
  fallidos(delTipo, ['A', 'B', 'C', 'A', 'B', 'C']);
  // Act
  const alertaOferta = alertasIa(porOferta, 'test');
  const alertaTipo = alertasIa(delTipo, 'test');
  // Assert
  assert.deepEqual(
    alertaOferta.map((x) => [x.motivo, x.tipo, x.alcance, x.recursos]),
    [['fallos', TIPO, 'recurso', ['A', 'C']]],
  );
  assert.deepEqual(
    resumenCola(porOferta).frenados.map((f) => f.recurso),
    ['A', 'C'],
  );
  assert.deepEqual(
    alertaTipo.map((x) => [x.alcance, x.recursos]),
    [['tipo', ['A', 'B', 'C']]],
  );
  assert.deepEqual(
    resumenCola(delTipo).frenados.map((f) => f.recurso),
    [null],
  );
  porOferta.close();
  delTipo.close();
});

test('should_name_the_braked_type_in_the_ia_alert_as_its_domain_names_it', async () => {
  // Arrange: un dominio que nombra sus trabajos y otro que no.
  const { fijarNombreTrabajos } = await import('../../src/nucleo/colaTipos.js');
  fijarNombreTrabajos('test', (tipo) => (tipo === TIPO ? 'Oferta de prueba' : tipo));
  const d = abrirNucleo(carpeta('alerta-nombre'));
  fallidos(d, ['A', 'A', 'A']);

  // Act
  const alertas = alertasIa(d, 'test');
  const sinNombre = alertasIa(d, 'otro-dominio');

  // Assert
  assert.deepEqual(
    alertas.map((x) => [x.motivo, x.nombre]),
    [['fallos', 'Oferta de prueba']],
  );
  assert.ok(
    sinNombre.every((x) => x.nombre === null || x.nombre === x.tipo),
    'sin nombre del dominio, el tipo tal cual',
  );
  d.close();
});

test('should_overwrite_and_remove_a_queue_mark', async () => {
  // Arrange
  const { leerMarca, ponerMarca, quitarMarca, claveReactivado } = await import('../../src/nucleo/colaMarcas.js');
  const d = abrirNucleo(carpeta('marcas'));
  const clave = claveReactivado(TIPO, 'A');
  // Act
  ponerMarca(d, clave, 'uno');
  ponerMarca(d, clave, 'dos');
  const leida = leerMarca(d, clave);
  quitarMarca(d, clave);
  // Assert
  assert.equal(clave, `reactivado:${TIPO}:A`);
  assert.equal(leida, 'dos');
  assert.equal(leerMarca(d, clave), null);
  d.close();
});

test('should_keep_the_brake_of_other_tenders_when_a_person_asks_for_one', async () => {
  // Arrange: B frenada por sus tres fallos.
  const d = abrirNucleo(carpeta('a-mano-otra'));
  fallidos(d, ['B', 'B', 'B']);
  const deB = pedir(d, 'B');
  // Act: una persona pide el de A.
  const deA = encolar(d, { tipo: TIPO, dominio: 'test', clave: 'a-mano-A', payload: { id: 'A' }, aMano: true });
  await vueltaCola(d, 5);
  // Assert
  assert.equal(obtenerTrabajo(d, deA)?.estado, 'lanzado');
  assert.equal(obtenerTrabajo(d, deB)?.estado, 'pendiente', 'pedir A a mano no quita el freno de B');
  assert.ok(frenadoHasta(d, TIPO, Date.now(), 'B'));
  d.close();
});

test('should_lift_the_brake_of_the_tender_a_person_asks_for', async () => {
  // Arrange
  const d = abrirNucleo(carpeta('a-mano-propia'));
  fallidos(d, ['B', 'B', 'B']);
  // Act
  const deB = encolar(d, { tipo: TIPO, dominio: 'test', clave: 'a-mano-B', payload: { id: 'B' }, aMano: true });
  await vueltaCola(d, 5);
  // Assert
  assert.equal(obtenerTrabajo(d, deB)?.estado, 'lanzado');
  d.close();
});
