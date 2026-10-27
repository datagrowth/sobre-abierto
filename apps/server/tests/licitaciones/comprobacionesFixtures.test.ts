// Criterio de hecho sobre las 5 ofertas de ejemplo (sintéticas, en fixtures/comprobaciones/): cada una se siembra en una base temporal, se
// calcula sus comprobaciones a la hora de la captura y se compara con su <oferta>.esperado.json: veredicto,
// conjunto exacto de claves que impiden (0 falsos «impide»), tareas de la persona y primer bloqueo
// (el mismo que dan la Mesa y el MCP, primerBloqueoAbierto). Y la paridad: Hoy, la
// lista, la cabecera (GET /comprobaciones) y el MCP dan el mismo veredicto y el mismo primer bloqueo.
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comprobaciones-fixtures-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { coherenciaOferta } = await import('../../src/dominios/licitaciones/oferta/coherencia.js');
const { ofertaParaAgente, primerBloqueoAbierto } =
  await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
const { faltaDePreparacion } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { mesaDe } = await import('../../src/dominios/licitaciones/oferta/mesa.js');
const { Filtro, listarOportunidades } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const express = (await import('express')).default;
const { OFERTAS_COMPROBACIONES, leerEsperadoComprobaciones, leerFixtureComprobaciones, sembrarFixture } =
  await import('../helpers/comprobacionesFixtures.js');

type Oferta = (typeof OFERTAS_COMPROBACIONES)[number];
type Comprobaciones = NonNullable<ReturnType<typeof comprobacionesDe>['data']>;
type Item = ReturnType<typeof listarOportunidades>['items'][number];
type EstadoMcp = { veredicto: Comprobaciones['veredicto']; siguiente: { clave: string; titulo: string } | null };
type FilaMesa = NonNullable<ReturnType<typeof mesaDe>['data']>['tu_mesa'][number];
// Lo que dicen de la misma oferta, a la misma hora, las otras vistas (la Mesa y las filas que ve el MCP, también).
type Vistas = {
  http: Comprobaciones;
  hoy: string[];
  lista: Item | undefined;
  mcp: EstadoMcp;
  mcp_bloqueos: { clave: string; titulo: string }[];
  mesa: FilaMesa | undefined;
};
type Calculo = {
  comprobaciones: Comprobaciones;
  coherencia: ReturnType<typeof coherenciaOferta>;
  ambito: string[];
  vistas: Vistas;
};

iniciarNucleo();
const db = dbLicitaciones();
const app = express();
app.use('/api/licitaciones', rutasLicitaciones());
const server = escucharLocal(http.createServer(app));
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/licitaciones`;
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// GET /comprobaciones calcula con la hora del reloj: se fija a la de la captura para compararlo con lo demás.
async function comprobacionesHttp(id: string, ahoraMs: number): Promise<Comprobaciones> {
  mock.timers.enable({ apis: ['Date'], now: ahoraMs });
  try {
    const res = await fetch(`${base}/licitaciones/${id}/comprobaciones`);
    assert.equal(res.status, 200, id);
    return (await res.json()) as Comprobaciones;
  } finally {
    mock.timers.reset();
  }
}

async function vistasDe(id: string, ahoraMs: number): Promise<Vistas> {
  const filtro = Filtro.parse({ estados: ['en_preparacion', 'descartada'], limite: 100 });
  const mcp = ofertaParaAgente(db, nucleo().db, { id, secciones: ['estado', 'bloqueos'] }, false, ahoraMs);
  assert.equal(mcp.error, null, id);
  const mesa = mesaDe(db, nucleo().db, ahoraMs);
  assert.equal(mesa.error, null, id);
  const datos = mcp.data as { estado: EstadoMcp; bloqueos: { clave: string; titulo: string }[] };
  return {
    http: await comprobacionesHttp(id, ahoraMs),
    hoy: faltaDePreparacion(db, id, ahoraMs),
    lista: listarOportunidades(db, filtro, ahoraMs).items.find((x) => x.id === id),
    mcp: datos.estado,
    mcp_bloqueos: datos.bloqueos,
    mesa: [...mesa.data!.decide_hoy, ...mesa.data!.tu_mesa, ...mesa.data!.listas_para_firmar].find(
      (x) => x.id === id,
    ) as FilaMesa | undefined,
  };
}

// El perfil capturado no dice qué certificados tiene la empresa (`certificados` sin indicar: lo trae
// el perfil de empresa). Se siembra como lo deja Ajustes › Empresa con la verdad de hoy: ninguno, sin ENS.
// El domicilio sigue sin rellenar, como en producción.
async function calcular(o: Oferta): Promise<Calculo> {
  const capturado = leerFixtureComprobaciones(o);
  const f = { ...capturado, perfil: { ...capturado.perfil, certificados: [] } };
  nucleo().db.prepare('DELETE FROM personas').run();
  sembrarFixture(db, nucleo().db, f);
  const ahoraMs = Date.parse(f.ahora);
  const r = comprobacionesDe(db, nucleo().db, f.id, ahoraMs);
  assert.equal(r.error, null, `${o}: ${r.error?.message ?? ''}`);
  return {
    comprobaciones: r.data!,
    coherencia: coherenciaOferta(db, f.id, { ahoraMs }),
    ambito: f.oportunidad.lotes_interes,
    vistas: await vistasDe(f.id, ahoraMs),
  };
}

// Perfil y personas son del núcleo, uno para todas: las comprobaciones de cada oferta (y lo que dicen de ellas las demás
// vistas) se calcula antes de sembrar la siguiente.
const CALCULOS = new Map<Oferta, Calculo>();
for (const o of OFERTAS_COMPROBACIONES) CALCULOS.set(o, await calcular(o));
const calculo = (o: Oferta): Calculo => CALCULOS.get(o)!;

const abierta = (b: Comprobaciones['bloqueos'][number]): boolean => b.estado === 'abierto' || b.estado === 'propuesta';
const impiden = (c: Comprobaciones): string[] =>
  c.bloqueos
    .filter((b) => abierta(b) && b.gravedad === 'impide')
    .map((b) => b.clave)
    .sort();
const deLaPersona = (c: Comprobaciones): Set<string> =>
  new Set(c.bloqueos.filter((b) => abierta(b) && b.actor === 'tu' && b.gravedad !== 'ok').map((b) => b.clave));

function comprobarOferta(o: Oferta): Comprobaciones {
  const { comprobaciones } = calculo(o);
  const esperado = leerEsperadoComprobaciones(o);

  assert.equal(comprobaciones.veredicto.tipo, esperado.veredicto, `${o}: ${comprobaciones.veredicto.texto}`);
  assert.deepEqual(impiden(comprobaciones), [...esperado.impide].sort(), `${o}: claves que impiden`);
  const tuyas = deLaPersona(comprobaciones);
  assert.deepEqual(
    esperado.tu.filter((k) => !tuyas.has(k)),
    [],
    `${o}: tareas de la persona que faltan`,
  );
  assert.equal(primerBloqueoAbierto(comprobaciones.bloqueos)?.clave, esperado.primer_bloqueo, `${o}: primer bloqueo`);
  return comprobaciones;
}

test('should_say_casoE_is_not_presentable_because_of_ens_basic', () => {
  const c = comprobarOferta('casoE');

  assert.match(c.veredicto.texto, /^No presentable: Exigen ENS BÁSICA/);
});

test('should_say_casoB_is_not_presentable_because_of_ens_medium', () => {
  const c = comprobarOferta('casoB');

  assert.match(c.veredicto.texto, /^No presentable: Exigen ENS MEDIA/);
});

test('should_say_casoF_is_discarded', () => {
  const c = comprobarOferta('casoF');

  assert.match(c.veredicto.texto, /^Descartada: Sin solvencia técnica mínima/);
});

test('should_ask_casoD_for_the_lot_2_price_and_the_address', () => {
  const c = comprobarOferta('casoD');

  assert.equal(c.bloqueos.find((b) => b.clave === 'precio:2')?.actor, 'tu');
  assert.equal(c.bloqueos.find((b) => b.clave === 'empresa:-:domicilio')?.gravedad, 'impide');
});

test('should_say_casoC_has_one_eligibility_blocker_for_gardening_and_surveying', () => {
  const c = comprobarOferta('casoC');

  const medios = c.bloqueos.filter((b) => abierta(b) && b.gravedad === 'impide' && b.clave.startsWith('medios:'));
  assert.deepEqual(
    medios.map((b) => [b.clave, b.actor]),
    [
      ['medios:3:topografia', 'negocio'],
      ['medios:3:jardineria_arbolado', 'negocio'],
    ],
  );
  assert.match(c.veredicto.texto, /topografía/);
});

test('should_have_no_false_impide_in_the_five_offers', () => {
  const falsos = OFERTAS_COMPROBACIONES.flatMap((o) => {
    const esperadas = new Set(leerEsperadoComprobaciones(o).impide);
    return impiden(calculo(o).comprobaciones)
      .filter((k) => !esperadas.has(k))
      .map((k) => `${o} ${k}`);
  });

  assert.deepEqual(falsos, []);
});

// Tres fallos de las comprobaciones con varios lotes: «igual que en el lote 1» daba un automaticos_lotes falso,
// se cogía el primer lote con el mismo nombre de criterio y se miraba el equipo de otros lotes.
test('should_keep_the_multi_lot_findings_closed', () => {
  for (const o of ['casoE', 'casoD'] as const) {
    const { comprobaciones, coherencia, ambito } = calculo(o);

    const tipos = coherencia.map((x) => x.tipo);
    const deOtrosLotes = comprobaciones.bloqueos
      .filter((b) => b.lote !== null && !ambito.includes(b.lote))
      .map((b) => b.clave);

    assert.equal(tipos.includes('automaticos_lotes'), false, `${o}: #6 y #7`);
    assert.equal(tipos.includes('equipo_lotes'), false, `${o}: #10`);
    assert.deepEqual(deOtrosLotes, [], `${o}: ninguna fila de un lote al que no vamos`);
    assert.equal(
      comprobaciones.bloqueos.some((b) => b.clave.startsWith('automaticos_lotes:') || b.clave.startsWith('equipo')),
      false,
      o,
    );
  }
});

// ── Paridad: Hoy, lista, cabecera y MCP leen de las comprobaciones ──

type FilaComprobaciones = Comprobaciones['bloqueos'][number];
const CATEGORIAS: Record<FilaComprobaciones['categoria'], string> = {
  elegibilidad: 'Elegibilidad',
  precio: 'Precio',
  decisiones: 'Decisiones',
  coherencia: 'Coherencia',
  fugas: 'Fugas entre sobres',
  documentos: 'Documentos',
  empresa: 'Empresa',
  firma: 'Firma',
  plazo: 'Hitos del plazo',
};
const linea = (b: FilaComprobaciones): string => `${CATEGORIAS[b.categoria]}: ${b.titulo}`;
const pendientes = (c: Comprobaciones): FilaComprobaciones[] =>
  c.bloqueos.filter((b) => primerBloqueoAbierto([b]) !== null);

test('should_give_the_same_verdict_and_first_blocker_in_today_the_list_the_comprobaciones_and_mcp', () => {
  for (const o of OFERTAS_COMPROBACIONES) {
    const { comprobaciones, vistas } = calculo(o);
    const primero = primerBloqueoAbierto(comprobaciones.bloqueos)!;
    const enPreparacion = leerFixtureComprobaciones(o).oportunidad.estado === 'en_preparacion';

    assert.deepEqual(vistas.http.veredicto, comprobaciones.veredicto, `${o}: GET /comprobaciones`);
    assert.equal(primerBloqueoAbierto(vistas.http.bloqueos)?.clave, primero.clave, `${o}: GET /comprobaciones`);
    assert.equal(vistas.hoy[0], linea(primero), `${o}: Hoy`);
    assert.deepEqual(vistas.mcp.veredicto, comprobaciones.veredicto, `${o}: MCP`);
    // Descartada (CASO_F) no hay nada que preparar: el MCP no propone ningún siguiente paso.
    assert.equal(
      vistas.mcp.siguiente?.clave,
      comprobaciones.veredicto.tipo === 'descartada' ? undefined : primero.clave,
      `${o}: MCP`,
    );
    assert.ok(vistas.lista, `${o}: en la lista`);
    // La lista solo trae las comprobaciones de las que se preparan (CASO_F está descartada).
    assert.deepEqual(vistas.lista.veredicto, enPreparacion ? comprobaciones.veredicto : null, `${o}: lista`);
    assert.deepEqual(
      vistas.lista.primer_bloqueo,
      enPreparacion ? { clave: primero.clave, titulo: primero.titulo } : null,
      `${o}: lista`,
    );
  }
});

test('should_list_what_is_missing_in_the_comprobaciones_order', () => {
  for (const o of OFERTAS_COMPROBACIONES) {
    const { comprobaciones, vistas } = calculo(o);

    const filas = pendientes(comprobaciones).map(linea);

    assert.ok(filas.length > 0, o);
    assert.deepEqual(vistas.hoy.slice(0, filas.length), filas, o);
  }
});

// CASO_E tenía la primera versión de la memoria, del guion 13, sin revisar con el 19 vigente y Hoy decía «dala por buena».
test('should_not_tell_casoE_to_accept_an_outdated_memory', () => {
  const { vistas } = calculo('casoE');

  assert.ok(
    vistas.hoy.some((f) => /^Decisiones: La v\d+ es de un guion anterior: no la des por buena$/.test(f)),
    vistas.hoy.join(' | '),
  );
  assert.ok(!vistas.hoy.some((f) => /dala por buena/.test(f)), vistas.hoy.join(' | '));
});

// ── Compromisos caros: la memoria v3 de Villaejemplo promete cosas que cuestan y el pliego no pide ──

type FilaConCoste = FilaComprobaciones & {
  coste?: { horas: number | null; euros: number | null; apariciones: unknown[] };
};
const deCoste = (c: Comprobaciones): FilaConCoste[] =>
  (c.bloqueos as FilaConCoste[]).filter((b) => /^compromisos?_caros?:/.test(b.clave));
const IMPORTE = /\d[\d.,]*\s*(?:€|euros?)|€/i;

test('should_show_casoC_costly_commitments_with_their_cost_and_suavizar', () => {
  const { comprobaciones } = calculo('casoC');

  const filas = deCoste(comprobaciones);

  assert.ok(filas.length >= 1, 'la memoria de Villaejemplo tiene compromisos caros');
  for (const b of filas) {
    assert.equal(b.accion.tipo, 'suavizar', b.clave);
    assert.equal(b.actor, 'tu', b.clave);
    // Sin índice de la Biblioteca en el test no se puede cotejar con el pliego.
    assert.equal(b.gravedad, 'no_comprobado', b.clave);
    assert.ok(b.coste && ((b.coste.horas ?? 0) > 0 || (b.coste.euros ?? 0) > 0), b.clave);
    assert.doesNotMatch(b.titulo, IMPORTE, b.clave);
  }
  assert.ok(
    comprobaciones.limite_suavizar && comprobaciones.limite_suavizar < comprobaciones.hora_interna_cierre,
    `${comprobaciones.limite_suavizar}`,
  );
});

test('should_say_the_same_about_costly_commitments_in_today_the_list_the_header_mcp_and_the_desk', () => {
  for (const o of OFERTAS_COMPROBACIONES) {
    const { comprobaciones, vistas } = calculo(o);
    const filas = deCoste(comprobaciones);

    assert.deepEqual(
      deCoste(vistas.http).map((b) => [b.clave, b.titulo, b.huella, b.coste]),
      filas.map((b) => [b.clave, b.titulo, b.huella, b.coste]),
      `${o}: GET /comprobaciones`,
    );
    assert.equal(vistas.http.limite_suavizar, comprobaciones.limite_suavizar, `${o}: GET /comprobaciones`);
    // Hoy dice las pendientes (riesgo o impide), como las demás filas: una sin cotejar no sale ahí.
    for (const b of filas)
      assert.equal(vistas.hoy.includes(linea(b)), primerBloqueoAbierto([b]) !== null, `${o}: Hoy ${b.clave}`);
    const mcp = vistas.mcp_bloqueos.filter((b) => /^compromisos?_caros?:/.test(b.clave));
    assert.deepEqual(
      mcp.map((b) => [b.clave, b.titulo]),
      filas.map((b) => [b.clave, b.titulo]),
      `${o}: MCP`,
    );
    assert.ok(
      mcp.every((b) => !IMPORTE.test(b.titulo)),
      `${o}: MCP sin importes en el título`,
    );
    if (vistas.mesa) assert.equal(vistas.mesa.minutos_persona, comprobaciones.minutos_persona, `${o}: Mesa`);
  }
});
