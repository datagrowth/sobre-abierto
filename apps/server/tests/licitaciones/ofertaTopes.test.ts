// Topes por oferta y 24 h: una oferta que ya gastó sus runs automáticos del
// día no lanza más (lo pedido a mano sí) y la plataforma no pide sola más de N propuestas de
// decisiones por oferta y día. Las demás ofertas siguen.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FICHA_CASO_A, GUION_CASO_A } from './fixtures/casoA.js';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-topes-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';
process.env.HOME = tmp;
process.env.LICITACIONES_RUNS_OFERTA_DIA = '5';
process.env.LICITACIONES_PROPUESTAS_DIA = '3';
// Hermes simulado (la frontera HTTP): cuenta los runs lanzados.
let lanzadosEnHermes = 0;
const hermes = escucharLocal(
  http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const cabecera = { 'content-type': 'application/json' };
      if (req.method === 'POST') lanzadosEnHermes += 1;
      res.writeHead(200, cabecera).end(JSON.stringify({ run_id: `run_${lanzadosEnHermes}`, status: 'started' }));
    });
  }),
);
await new Promise((r) => hermes.once('listening', r));
const destinoHermes = {
  url: `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`,
  key: 'clave-de-hermes-de-prueba',
};

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { registrarTrabajos } = await import('../../src/dominios/licitaciones/index.js');
const { encolar, vueltaCola } = await import('../../src/nucleo/trabajos.js');
const { registrarTipoTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { proponerAlLlegarGuion, TIPO_PROPUESTA_DECISIONES } =
  await import('../../src/dominios/licitaciones/oferta/propuestaDecisiones.js');
const { repedirPropuestas } = await import('../../src/dominios/licitaciones/oferta/cadena.js');
const { quedanPropuestasHoy, runsDeOfertaHoy } = await import('../../src/dominios/licitaciones/oferta/topes.js');

const { db: dbNucleo } = iniciarNucleo();
const db = dbLicitaciones();
const HORA = 3_600_000;
// Un tipo de la oferta cualquiera: lo que se prueba es el tope del dominio, no lo que hace el run.
const TIPO = 'licitaciones.prueba_tope';
registrarTrabajos();
registrarTipoTrabajo(TIPO, {
  destino: () => destinoHermes,
  instrucciones: () => 'Prueba del tope.',
  hecho: () => false,
});

after(() => {
  hermes.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  dbNucleo.prepare('DELETE FROM trabajos_ia').run();
  lanzadosEnHermes = 0;
});

let claves = 0;
// Runs ya hechos de una oferta, lanzados hace `haceMs`.
function runsHechos(id: string, n: number, haceMs: number): void {
  const lanzado = new Date(Date.now() - haceMs).toISOString();
  for (let i = 0; i < n; i += 1) {
    const t = encolar(dbNucleo, {
      tipo: TIPO,
      dominio: 'licitaciones',
      clave: `hecho-${(claves += 1)}`,
      payload: { id },
    });
    dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'completado', lanzado_en = ? WHERE id = ?").run(lanzado, t);
  }
}

const pendiente = (id: string, aMano = false): number =>
  encolar(dbNucleo, {
    tipo: TIPO,
    dominio: 'licitaciones',
    clave: `pendiente-${(claves += 1)}`,
    payload: { id },
    aMano,
  });
const estadoDe = (t: number): string =>
  (dbNucleo.prepare('SELECT estado FROM trabajos_ia WHERE id = ?').get(t) as { estado: string }).estado;

test('should_not_launch_automatic_jobs_of_a_tender_that_reached_its_daily_run_cap', async () => {
  runsHechos('p-topada', 5, 2 * HORA);
  const t = pendiente('p-topada');

  await vueltaCola(dbNucleo, 4);

  assert.equal(estadoDe(t), 'pendiente', 'espera sin gastar intento');
  assert.equal(lanzadosEnHermes, 0, 'ni un run en Hermes');
  const fila = dbNucleo.prepare('SELECT intentos, error, codigo FROM trabajos_ia WHERE id = ?').get(t);
  assert.deepEqual({ ...(fila as object) }, { intentos: 0, error: null, codigo: null }, 'su fila no se toca');
});

test('should_launch_a_job_a_person_asked_for_even_over_the_cap', async () => {
  runsHechos('p-topada', 5, 2 * HORA);
  const t = pendiente('p-topada', true);

  await vueltaCola(dbNucleo, 4);

  assert.equal(estadoDe(t), 'lanzado');
  assert.equal(lanzadosEnHermes, 1);
});

test('should_count_only_runs_of_the_last_24_hours', async () => {
  runsHechos('p-ayer', 5, 25 * HORA);
  runsHechos('p-ayer', 4, 23 * HORA);
  const t = pendiente('p-ayer');

  await vueltaCola(dbNucleo, 4);

  assert.equal(runsDeOfertaHoy(dbNucleo, 'p-ayer', Date.now() - 1), 5, 'los 4 de hoy y el que acaba de salir');
  assert.equal(estadoDe(t), 'lanzado', 'los de hace más de 24 h no cuentan');
});

test('should_count_every_launch_of_a_job_that_was_retried', async () => {
  // Arrange: un trabajo que se lanza, falla y vuelve a la cola dos veces (como hace fallar()).
  const t = pendiente('p-reintentos');
  const reintentar = () =>
    dbNucleo
      .prepare(
        "UPDATE trabajos_ia SET estado = 'pendiente', intentos = intentos + 1, run_id = NULL, proximo_intento_en = NULL WHERE id = ?",
      )
      .run(t);

  // Act
  await vueltaCola(dbNucleo, 4);
  reintentar();
  await vueltaCola(dbNucleo, 4);
  reintentar();
  await vueltaCola(dbNucleo, 4);

  // Assert
  assert.equal(lanzadosEnHermes, 3);
  assert.equal(runsDeOfertaHoy(dbNucleo, 'p-reintentos'), 3, 'tres runs, no un trabajo');
});

test('should_let_other_tenders_launch_while_one_is_capped', async () => {
  runsHechos('p-topada', 5, HORA);
  const topada = pendiente('p-topada');
  const otra = pendiente('p-otra');

  await vueltaCola(dbNucleo, 4);

  assert.equal(estadoDe(topada), 'pendiente');
  assert.equal(estadoDe(otra), 'lanzado', 'el tope es de la oferta, no del tipo');
});

function enPreparacion(id: string): void {
  guardarLicitacion(db, {
    ...licitacion({
      titulo: `Licitación ${id}`,
      publicada: '2026-09-20',
      presupuesto: 24_000,
      limite: '2099-06-30T14:00:00',
    }),
    id,
    atom_id: `atom-${id}`,
  });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?)",
  ).run(id, ts, ts);
}

// Propuestas automáticas que ya falló hoy (sobre guiones anteriores).
function propuestasFallidas(id: string, n: number): void {
  for (let i = 0; i < n; i += 1) {
    const t = encolar(dbNucleo, {
      tipo: TIPO_PROPUESTA_DECISIONES,
      dominio: 'licitaciones',
      clave: `decisiones-prueba-${(claves += 1)}`,
      payload: { id, guion_id: 9000 + i, pedida_en: new Date().toISOString() },
    });
    dbNucleo.prepare("UPDATE trabajos_ia SET estado = 'fallido' WHERE id = ?").run(t);
  }
}

const propuestasDe = (id: string): number =>
  (
    dbNucleo
      .prepare("SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.id') = ?")
      .get(TIPO_PROPUESTA_DECISIONES, id) as { n: number }
  ).n;

test('should_not_ask_a_fourth_automatic_proposal_the_same_day', async () => {
  const ID = 'p-cuarta-propuesta';
  enPreparacion(ID);
  propuestasFallidas(ID, 3);
  assert.equal((await proponerFicha(db, FichaEntrada.parse({ ...FICHA_CASO_A, id: ID }), 'licitaciones')).error, null);

  const g = await proponerGuion(db, GuionEntrada.parse({ id: ID, ...GUION_CASO_A }), 'licitaciones');
  proponerAlLlegarGuion(dbNucleo, db, ID);
  const repedidas = repedirPropuestas(dbNucleo, db, [ID]);

  assert.equal(g.error, null);
  assert.equal(repedidas, 0);
  assert.equal(propuestasDe(ID), 3, 'ni al llegar el guion ni en la cadena');
  assert.equal(quedanPropuestasHoy(dbNucleo, ID, Date.now() + 25 * HORA), true, 'al día siguiente vuelve a haber');
  dbNucleo
    .prepare("UPDATE trabajos_ia SET a_mano = 1 WHERE tipo = ? AND json_extract(payload, '$.id') = ?")
    .run(TIPO_PROPUESTA_DECISIONES, ID);
  assert.equal(quedanPropuestasHoy(dbNucleo, ID), true, 'las pedidas a mano no cuentan');
});
