// Mejora de la memoria con el caso A (p-91000710): la memoria ensamblada se evalúa con la escala
// del guion (un criterio por apartado con su tramo, y los párrafos genéricos), la web ve la
// evaluación por apartado y qué se puede mejorar, y «Nueva versión» crea la siguiente copiando lo
// que se conserva y redactando solo lo elegido, con el texto anterior y las indicaciones en la tarea.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  APARTADOS,
  apartadoCasoA,
  decisionesCasoA,
  FICHA_CASO_A,
  GUION_CASO_A,
  guionCon,
  ID,
  licitacionCasoA,
  type Numeros,
} from './fixtures/casoA.js';
import { leerSkill } from '../helpers/skill.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-mejorar-'));
const salidas = path.join(tmp, 'salidas');
const agentes = path.join(tmp, '.agentes');
for (const d of [salidas, agentes]) fs.mkdirSync(d, { recursive: true });
const T_LICI = 'l'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { EvaluacionEntrada, guardarEvaluacion, instruccionesEvaluacion } =
  await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');
const { GuionEntrada, guionVigente, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { ApartadoEntrada, recibirApartado } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { instruccionesRedaccion, TIPO_MEMORIA_REDACCION } =
  await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { componerDossier } = await import('../../src/dominios/licitaciones/oferta/dossier.js');
const { problemasContraGuion } = await import('../../src/dominios/licitaciones/oferta/evaluacionMemoria.js');
const { AVISO_SIN_PERFIL, PREFIJO_AVISO_FIRMA, ensamblarMemoria } =
  await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { avisoDescartadas } = await import('../../src/dominios/licitaciones/propuestas/revision.js');
const { actualizarMemoria, NADA_QUE_ACTUALIZAR } =
  await import('../../src/dominios/licitaciones/oferta/actualizarMemoria.js');
const { generarDocx } = await import('../../src/nucleo/documentos/docx.js');

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();
const ts = new Date().toISOString();
guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ts, ts);
assert.equal(guardarPerfilEmpresa(nucleo().db, { nif: 'B12345678', nombre: 'Analítica Ejemplo SL' }).error, null);
const PERSONAS = ['Ana García Pérez', 'Luis Martín Díaz'].map(
  (nombre) => crearPersona(nucleo().db, { nombre, tipo: 'interno', rol: 'Consultora' }).data!.id,
);
await proponerFicha(db, FichaEntrada.parse(FICHA_CASO_A), 'licitaciones');
assert.equal((await proponerGuion(db, GuionEntrada.parse({ id: ID, ...GUION_CASO_A }), 'licitaciones')).error, null);
assert.equal(guardarDecisiones(db, nucleo().db, ID, decisionesCasoA(PERSONAS)).error, null);

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
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

const json = { 'content-type': 'application/json' };
const post = (ruta: string, body: unknown = {}) =>
  fetch(`${base}/api/licitaciones${ruta}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
const leer = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';
const RUTA_V = (v: number) => `Salidas/Licitaciones/EXP-2026-0412 (${ID})/memoria-v${v}.docx`;

type FilaMemoria = { id: number; version: number; guion_id: number; estado: string; error: string | null };
const memoria = (version: number) =>
  db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(ID, version) as
    FilaMemoria | undefined;
const numeros = (m: FilaMemoria): Numeros => ({ memoria_id: m.id, guion_id: m.guion_id, version: m.version });
const trabajo = (clave: string) =>
  nucleo().db.prepare('SELECT id, estado, payload FROM trabajos_ia WHERE clave = ?').get(clave) as
    { id: number; estado: string; payload: string } | undefined;

// Una memoria con fases ya redactada: los cuatro apartados del caso A recibidos, lista para montarse.
function memoriaRedactada(version: number): number {
  const guion = guionVigente(db, ID)!.id;
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ronda) VALUES (?, ?, ?, 'redactando', ?, 'redaccion', 0)",
      )
      .run(ID, guion, version, ts).lastInsertRowid,
  );
  for (const n of [1, 2, 3, 4]) {
    db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (?, ?, 'pendiente')").run(m, n);
    const r = recibirApartado(
      db,
      ApartadoEntrada.parse(apartadoCasoA(n, { memoria_id: m, guion_id: guion, version })),
      'licitaciones',
    );
    assert.equal(r.error, null, r.error?.message);
  }
  return m;
}

// El run de redacción que la máquina de fases encoló para una memoria.
const redaccionDe = (memoriaId: number) =>
  (
    nucleo().db.prepare('SELECT payload FROM trabajos_ia WHERE tipo = ? ORDER BY id').all(TIPO_MEMORIA_REDACCION) as {
      payload: string;
    }[]
  )
    .map((t) => JSON.parse(t.payload) as { id: string; memoria_id: number; guion_id: number; version: number })
    .filter((p) => p.memoria_id === memoriaId);

// Quita una memoria creada por una prueba, con todo lo que se le guardó, para que las siguientes cuenten versiones.
function olvidarMemoria(id: number): void {
  for (const t of ['memoria_apartados', 'memoria_dossiers', 'memoria_estrategias', 'memoria_fichas_solucion'])
    db.prepare(`DELETE FROM ${t} WHERE memoria_id = ?`).run(id);
  db.prepare('DELETE FROM memorias WHERE id = ?').run(id);
  nucleo().db.prepare("DELETE FROM trabajos_ia WHERE json_extract(payload, '$.memoria_id') = ?").run(id);
}

type EstadoMemoria = {
  version: number;
  evaluacion: {
    id: number;
    puntuacion_total: number;
    puntuacion_maxima: number;
    por_apartado: { apartado: number; puntos: number; maximo: number; tramo: number | null }[];
    genericos: number;
  } | null;
  evaluacion_en_curso: { estado: string } | null;
  mejorable: number[];
  origen: { version_base: number; apartados_rehechos: number[]; indicaciones: string | null } | null;
};
const estado = async (version: number) =>
  (
    await leer<{ memorias: EstadoMemoria[] }>(fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta`))
  ).memorias.find((m) => m.version === version)!;

// El párrafo literal del apartado 2, bloque 2 (apartadoCasoA lo escribe así).
const GENERICO_2 =
  'La empresa propone para este punto un procedimiento con responsable designado, respuesta en 48 horas y un indicador mensual que se revisa con la entidad (indicadores de calidad del servicio).';

/** Una evaluación de la memoria con la vara del guion: tramo por apartado, sugerencias y un genérico del apartado 2. */
function evaluacionDe(documento: string, tramos: number[]) {
  const criterios = APARTADOS.map((a, i) => ({
    criterio: a.titulo,
    peso: a.puntos,
    tipo: 'juicio_valor',
    apartado: i + 1,
    tramo: tramos[i],
    puntuacion: tramos[i],
    justificacion: `Tramo de ${tramos[i]}: ${i === 1 ? 'los indicadores no tienen meta ni frecuencia de medida.' : 'concreto y operativo.'}`,
    referencia: `${i + 1}. ${a.titulo}`,
  }));
  return {
    id: ID,
    documento,
    resumen: 'Memoria concreta en la organización; floja en indicadores y en las mejoras.',
    puntuacion_total: tramos.reduce((s, t) => s + t, 0),
    puntuacion_maxima: 25,
    criterios,
    eliminar: [],
    reforzar: [
      {
        referencia: '4. Mejoras vinculadas al objeto del contrato',
        que: 'Cuantificar la utilidad de cada mejora para la entidad.',
      },
    ],
    modificar: [
      {
        referencia: '2. Gestión de incidencias y control de calidad — Indicadores',
        que: 'Poner meta numérica y frecuencia a cada indicador.',
      },
      { referencia: '1. Organización y metodología del servicio', que: 'Nombrar al suplente del responsable.' },
    ],
    comparables: [],
    riesgos: [],
    genericos: [
      {
        referencia: '2. Gestión de incidencias y control de calidad',
        texto: GENERICO_2,
        por_que: 'No dice qué umbral activa el indicador ni quién lo revisa.',
      },
    ],
  };
}
const guardar = (e: unknown) => guardarEvaluacion(db, raicesActuales(), EvaluacionEntrada.parse(e), 'licitaciones');

test('should_not_queue_a_self_evaluation_for_a_memoria_with_phases_and_give_the_scale_to_the_evaluator', async () => {
  // Arrange: su crítica ciega es su evaluación (rondasMemoria.ts), así que el montaje no encola otra.
  const id = memoriaRedactada(1);

  // Act
  const e1 = await ensamblarMemoria(db, id, raicesActuales());

  // Assert
  assert.equal(e1.error, null, e1.error?.message);
  assert.equal(memoria(1)!.estado, 'ensamblada');
  assert.equal(trabajo(`evaluacion-memoria-${ID}-v1`), undefined, 'ninguna autoevaluación encolada');
  const e = await estado(1);
  assert.deepEqual([e.evaluacion, e.evaluacion_en_curso, e.mejorable, e.origen], [null, null, [], null]);
  const inst = instruccionesEvaluacion(ID, RUTA_V(1), db);
  assert.match(inst, /Es la memoria técnica v1 que montó la plataforma/);
  assert.match(inst, /VARA DE MEDIR: los 4 apartados de la memoria del guion \(v1\), 25 puntos\. Puntúa como la mesa/);
  assert.match(
    inst,
    /2\. «Gestión de incidencias y control de calidad» \(7 puntos\)\. Se valorará: Procedimiento de gestión de incidencias;/,
  );
  assert.match(inst, /Escala: 0 puntos: No aporta contenido operativo\. \| 3 puntos/);
  assert.match(inst, /«genericos»: cada párrafo que la mesa no puntuaría/);
  assert.doesNotMatch(instruccionesEvaluacion(ID, RUTA_V(1)), /VARA DE MEDIR/, 'sin base, la de la ficha');
});

test('should_ask_which_sections_to_redo_when_there_is_nothing_to_choose_them_from', async () => {
  const sinNada = await post(`/licitaciones/${ID}/oferta/memoria/1/mejorar`);
  assert.equal(sinNada.status, 409);
  assert.equal(
    (await leer<{ message: string }>(sinNada)).message,
    'La memoria v1 aún no tiene evaluación: espera a la autoevaluación, pide «Volver a evaluar» o escribe tus indicaciones.',
  );
  const cambioSinNada = await post(`/licitaciones/${ID}/oferta/memoria/1/actualizar-afectados`);
  assert.equal(cambioSinNada.status, 400);
  assert.equal((await leer<{ message: string }>(cambioSinNada)).message, NADA_QUE_ACTUALIZAR);
  const sinEvaluacion = await post(`/licitaciones/${ID}/oferta/memoria/1/mejorar`, {
    indicaciones: 'Nombra al suplente del responsable en todo el texto.',
  });
  assert.equal(sinEvaluacion.status, 400);
  assert.equal(
    (await leer<{ message: string }>(sinEvaluacion)).message,
    'Sin evaluación, elige qué apartados rehacer.',
  );
  assert.equal((await post(`/licitaciones/${ID}/oferta/memoria/99/mejorar`)).status, 404);
});

test('should_validate_a_memoria_evaluation_against_the_outline_sections', () => {
  const buena = evaluacionDe(RUTA_V(1), [8, 3, 6, 2]);
  const conFicha = guardar({
    ...buena,
    criterios: [
      { criterio: 'Oferta económica', peso: 30, tipo: 'formula', puntuacion: 20, justificacion: 'Según la baja.' },
      ...buena.criterios,
    ],
    puntuacion_total: 39,
    puntuacion_maxima: 55,
  });
  assert.match(
    conFicha.error?.message ?? '',
    /^Puntúa los 4 apartados de la memoria del guion \(v1\), un criterio por apartado con «apartado» \(de 1 a 4\)/,
  );
  const tramoMalo = structuredClone(buena);
  tramoMalo.criterios[1]!.tramo = 6;
  tramoMalo.criterios[1]!.puntuacion = 6;
  tramoMalo.puntuacion_total = 22;
  assert.match(
    guardar(tramoMalo).error?.message ?? '',
    /El tramo 6 no está en la escala del apartado 2 \(0, 3, 5 o 7\)\./,
  );
  const sinTramo = structuredClone(buena);
  delete (sinTramo.criterios[0] as { tramo?: number }).tramo;
  assert.match(
    guardar(sinTramo).error?.message ?? '',
    /Falta «tramo» en el apartado 1: los puntos del tramo de su escala que le daría la mesa \(0, 4, 6 o 8\)\./,
  );
  const pasada = structuredClone(buena);
  pasada.criterios[2]!.tramo = 5;
  assert.match(guardar(pasada).error?.message ?? '', /En el apartado 3, la puntuación \(6\) pasa de su tramo \(5\)/);
  const otroTitulo = structuredClone(buena);
  otroTitulo.criterios[0]!.criterio = 'Metodología';
  assert.match(
    guardar(otroTitulo).error?.message ?? '',
    /El criterio del apartado 1 es «Organización y metodología del servicio», de 8 puntos y de juicio de valor/,
  );
  const inventado = {
    ...buena,
    genericos: [
      {
        referencia: '2. Gestión',
        texto: 'Somos líderes del sector con una amplia experiencia acreditada.',
        por_que: 'Autoelogio.',
      },
    ],
  };
  assert.match(
    guardar(inventado).error?.message ?? '',
    /Estos «genericos» no están tal cual en la memoria v1: «Somos líderes del sector/,
  );
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM evaluaciones').get() as { n: number }).n, 0, 'nada guardado');
});

test('should_store_the_evaluation_with_its_memoria_and_expose_tramos_and_improvable_sections', async () => {
  const lici = new Client({ name: 'test', version: '1.0.0' });
  await lici.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_LICI}` } },
    }),
  );
  try {
    // Recortado con «…», el genérico sigue localizándose; la memoria que diga Hermes no cuenta.
    const e = evaluacionDe(RUTA_V(1), [8, 3, 6, 2]);
    e.genericos[0]!.texto = `${GENERICO_2.slice(0, 60)}…${GENERICO_2.slice(90)}`;
    const r = await lici.callTool({
      name: 'licitaciones_evaluacion',
      arguments: { ...e, memoria: { version: 7, guion_id: 99 } },
    });
    assert.equal(r.isError, undefined, texto(r));
  } finally {
    await lici.close();
  }
  const guardada = db.prepare('SELECT datos FROM evaluaciones ORDER BY id DESC LIMIT 1').get() as { datos: string };
  assert.deepEqual(JSON.parse(guardada.datos).memoria, { version: 1, guion_id: guionVigente(db, ID)!.id });
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE clave = ?")
    .run(`evaluacion-memoria-${ID}-v1`);
  const e = await estado(1);
  assert.deepEqual(
    [e.evaluacion?.puntuacion_total, e.evaluacion?.puntuacion_maxima, e.evaluacion?.genericos],
    [19, 25, 1],
  );
  assert.deepEqual(e.evaluacion?.por_apartado, [
    { apartado: 1, puntos: 8, maximo: 8, tramo: 8 },
    { apartado: 2, puntos: 3, maximo: 7, tramo: 3 },
    { apartado: 3, puntos: 6, maximo: 6, tramo: 6 },
    { apartado: 4, puntos: 2, maximo: 4, tramo: 2 },
  ]);
  assert.deepEqual([e.mejorable, e.evaluacion_en_curso], [[2, 4], null]);
});

test('should_reject_bad_improvement_requests', async () => {
  const fuera = await post(`/licitaciones/${ID}/oferta/memoria/1/mejorar`, { apartados: [9] });
  assert.equal(fuera.status, 400);
  assert.equal((await leer<{ message: string }>(fuera)).message, 'La memoria tiene 4 apartados: elige entre 1 y 4.');
  assert.equal((await post(`/licitaciones/${ID}/oferta/memoria/1/mejorar`, { apartados: [] })).status, 400);
  assert.equal(
    (await post(`/licitaciones/${ID}/oferta/memoria/1/mejorar`, { apartados: [2], extra: 1 })).status,
    400,
    'esquema estricto',
  );
  assert.equal((await post(`/licitaciones/${ID}/oferta/memoria/x/mejorar`)).status, 400);
});

const INDICACIONES_EVALUACION =
  'Pon meta numérica y frecuencia a los indicadores y cuantifica la utilidad de cada mejora.';

test('should_create_the_next_version_copying_the_kept_sections_and_queueing_one_run_for_the_chosen_ones', async () => {
  const r = await post(`/licitaciones/${ID}/oferta/memoria/1/mejorar`, { indicaciones: INDICACIONES_EVALUACION });
  assert.equal(r.status, 202, await r.clone().text());
  const nueva = await leer<{ memoria: number; version: number; apartados: number[] }>(r);
  assert.deepEqual([nueva.version, nueva.apartados], [2, [2, 4]], 'los que la evaluación deja por debajo del máximo');
  const filas = db
    .prepare('SELECT apartado, estado, agente, datos FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(nueva.memoria) as { apartado: number; estado: string; agente: string | null; datos: string | null }[];
  const base1 = db
    .prepare('SELECT apartado, datos FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(memoria(1)!.id) as { datos: string }[];
  assert.deepEqual(
    filas.map((f) => [f.apartado, f.estado, f.agente]),
    [
      [1, 'recibido', 'copiado-v1'],
      [2, 'pendiente', null],
      [3, 'recibido', 'copiado-v1'],
      [4, 'pendiente', null],
    ],
  );
  assert.equal(filas[0]!.datos, base1[0]!.datos, 'el apartado conservado es el mismo texto');
  assert.equal(redaccionDe(nueva.memoria).length, 1, 'un único run de redacción para lo que se rehace');
  const e = await estado(2);
  assert.deepEqual(e.origen, {
    version_base: 1,
    apartados_rehechos: [2, 4],
    indicaciones: INDICACIONES_EVALUACION,
    subida: null,
  });
  const evento = ultimosEventos(nucleo().db, 50).find(
    (x) => x.tipo === 'licitacion.memoria' && x.datos['accion'] === 'actualizada',
  );
  assert.deepEqual(evento?.datos, { accion: 'actualizada', version: 2, version_base: 1, apartados: 2 });
  const otra = await post(`/licitaciones/${ID}/oferta/memoria/1/mejorar`, { indicaciones: INDICACIONES_EVALUACION });
  assert.equal(otra.status, 409);
  assert.equal(
    (await leer<{ message: string }>(otra)).message,
    'La memoria v2 aún se está redactando o ensamblando: espera a que termine.',
  );
});

test('should_give_the_previous_text_and_the_persons_instructions_to_the_run_of_the_new_version', () => {
  const [payload] = redaccionDe(memoria(2)!.id);
  const inst = instruccionesRedaccion(db, nucleo().db, payload as never);
  assert.doesNotMatch(inst, /CAMBIO TARDÍO/, 'es una mejora, no un cambio');
  assert.match(inst, /YA ESTÁN RECIBIDOS los apartados 1, 3: no los reenvíes/);
  assert.match(inst, /TE TOCA REDACTAR los apartados 2, 4; empieza por el 2\./);
  const apartado2 = inst.slice(inst.indexOf('=== Apartado 2 ==='), inst.indexOf('=== Apartado 4 ==='));
  assert.ok(
    apartado2.indexOf(INDICACIONES_EVALUACION) < apartado2.indexOf('MEJORA DE LA VERSIÓN 1'),
    'las indicaciones de la persona van primero y mandan',
  );
  assert.match(apartado2, /INDICACIONES DE QUIEN LLEVA LA OFERTA \(mandan sobre la evaluación/);
  assert.match(
    apartado2,
    /la evaluación propia lo deja en el tramo de 3 puntos.*Reescríbelo para el tramo máximo \(7 puntos/,
  );
  assert.match(apartado2, /TEXTO ANTERIOR DEL APARTADO \(v1; reescríbelo entero/);
  assert.match(apartado2, /Procedimiento de gestión de incidencias/, 'el texto de la versión base va en la tarea');
});

test('should_assemble_the_new_version_without_queueing_a_self_evaluation', async () => {
  for (const n of [2, 4])
    assert.equal(
      recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(n, numeros(memoria(2)!))), 'licitaciones').error,
      null,
    );
  const e2 = await ensamblarMemoria(db, memoria(2)!.id, raicesActuales());
  assert.equal(e2.error, null, e2.error?.message);
  assert.equal(memoria(2)!.estado, 'ensamblada');
  assert.equal(trabajo(`evaluacion-memoria-${ID}-v2`), undefined, 'su crítica es su evaluación');
  const md = fs.readFileSync(path.join(salidas, 'Licitaciones', `EXP-2026-0412 (${ID})`, 'memoria-v2.md'), 'utf8');
  assert.ok(
    md.includes('1. Organización y metodología del servicio') && md.includes('Coordinación con la Asesoría Jurídica'),
    'con los apartados copiados',
  );
  const e = await estado(2);
  assert.deepEqual([e.evaluacion, e.evaluacion_en_curso, e.mejorable], [null, null, []]);
  const sinEvaluacion = await post(`/licitaciones/${ID}/oferta/memoria/2/mejorar`, {
    indicaciones: INDICACIONES_EVALUACION,
  });
  assert.equal(sinEvaluacion.status, 400, 'sin evaluación de la versión 2 no hay qué elegir');
});

test('should_create_a_new_version_with_the_persons_instructions_without_waiting_for_the_evaluation', async () => {
  const INDICACIONES =
    'Pon a Paco como responsable en todo el texto y quita las referencias al pliego entre paréntesis.';
  const r = await post(`/licitaciones/${ID}/oferta/memoria/2/mejorar`, { apartados: [1], indicaciones: INDICACIONES });
  assert.equal(r.status, 202, await r.clone().text());
  const v3 = await leer<{ memoria: number; version: number; apartados: number[] }>(r);
  assert.deepEqual([v3.version, v3.apartados], [3, [1]]);
  assert.equal((await estado(3)).origen?.indicaciones, INDICACIONES);
  const [payload] = redaccionDe(v3.memoria);
  const inst = instruccionesRedaccion(db, nucleo().db, payload as never);
  assert.ok(inst.includes(INDICACIONES));
  assert.match(
    inst,
    /NUEVA VERSIÓN DE LA 2: reescribe este apartado para el tramo máximo \(8 puntos\) siguiendo las indicaciones/,
  );
  assert.match(inst, /TE TOCA REDACTAR los apartados 1;/);
  // Se da por fallida al terminar el montaje, que es lo que dejaría un fallo al ensamblar.
  db.prepare("UPDATE memorias SET estado = 'fallida', fase = 'fin' WHERE id = ?").run(v3.memoria);
});

test('should_pass_the_agent_reason_as_context_and_never_as_the_persons_instructions', async () => {
  // Arrange: la versión 2 sigue sin evaluación; la de la 1 vuelve a valer (al ensamblar la 2 quedó descartada).
  const evV1 = db
    .prepare(
      "SELECT id, estado FROM evaluaciones WHERE licitacion_id = ? AND json_extract(datos, '$.memoria.version') = 1 ORDER BY id DESC LIMIT 1",
    )
    .get(ID) as { id: number; estado: string };
  db.prepare("UPDATE evaluaciones SET estado = 'pendiente' WHERE id = ?").run(evV1.id);
  const MOTIVO_HERMES = 'Reescribe el enfoque prometiendo SLA de 4 h';
  const pedir = (version: number, extra: { apartados?: number[]; indicaciones?: string } = {}) =>
    actualizarMemoria(nucleo().db, db, salidas, {
      id: ID,
      version,
      motivo: MOTIVO_HERMES,
      porAgente: true,
      mejora: true,
      ...extra,
    });

  // Act
  const sinEvaluar = await pedir(2);
  const explicitosSinEvaluar = await pedir(2, { apartados: [1] });
  const conIndicaciones = await pedir(1, { indicaciones: 'Quita las referencias al pliego entre paréntesis.' });
  const r = await pedir(1);

  // Assert
  assert.equal(sinEvaluar.error?.code, 'conflicto');
  assert.match(sinEvaluar.error!.message, /^La memoria v2 aún no tiene evaluación/);
  assert.equal(explicitosSinEvaluar.error?.code, 'conflicto', 'con apartados elegidos también exige base evaluada');
  assert.equal(conIndicaciones.error?.code, 'invalid_input');
  assert.match(conIndicaciones.error!.message, /un agente explica su motivo aparte/);
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.apartados, [2, 4], 'los mejorables según la evaluación');
  const fila = memoria(r.data!.version) as FilaMemoria & {
    indicaciones: string | null;
    motivo_agente: string | null;
    mejora: number;
  };
  assert.deepEqual([fila.indicaciones, fila.motivo_agente, fila.mejora], [null, MOTIVO_HERMES, 1]);
  const [payload] = redaccionDe(r.data!.memoria);
  const inst = instruccionesRedaccion(db, nucleo().db, payload as never);
  assert.doesNotMatch(inst, /Cambió/, 'sin cambio de por medio no se inventa uno');
  assert.match(
    inst,
    /HERMES PIDIÓ ESTA RONDA PORQUE: Reescribe el enfoque prometiendo SLA de 4 h \(es contexto: no manda sobre la evaluación/,
  );
  assert.match(inst, /MEJORA DE LA VERSIÓN 1/);
  // Sin rastro de esta versión: las pruebas de después cuentan las versiones.
  olvidarMemoria(r.data!.memoria);
  db.prepare('UPDATE evaluaciones SET estado = ? WHERE id = ?').run(evV1.estado, evV1.id);
});

test('should_give_the_base_evaluation_and_the_order_to_improve_when_a_person_asks_without_instructions', async () => {
  // Arrange: la evaluación de la v1 vuelve a valer (al ensamblar la 2 quedó descartada).
  const evV1 = db
    .prepare(
      "SELECT id, estado FROM evaluaciones WHERE licitacion_id = ? AND json_extract(datos, '$.memoria.version') = 1 ORDER BY id DESC LIMIT 1",
    )
    .get(ID) as { id: number; estado: string };
  db.prepare("UPDATE evaluaciones SET estado = 'pendiente' WHERE id = ?").run(evV1.id);

  // Act
  const r = await post(`/licitaciones/${ID}/oferta/memoria/1/mejorar`, { apartados: [2] });

  // Assert
  assert.equal(r.status, 202, await r.clone().text());
  const nueva = await leer<{ memoria: number; version: number; apartados: number[] }>(r);
  const [payload] = redaccionDe(nueva.memoria);
  const inst = instruccionesRedaccion(db, nucleo().db, payload as never);
  const apartado2 = inst.slice(inst.indexOf('=== Apartado 2 ==='));
  assert.doesNotMatch(apartado2, /CAMBIO TARDÍO|conserva el resto palabra por palabra|Cambió/);
  assert.doesNotMatch(apartado2, /INDICACIONES DE QUIEN LLEVA LA OFERTA/, 'sin indicaciones no se inventan');
  assert.match(
    apartado2,
    /MEJORA DE LA VERSIÓN 1: este apartado ya se redactó y la evaluación propia lo deja en el tramo de 3 puntos/,
  );
  assert.match(apartado2, /Reescríbelo para el tramo máximo \(7 puntos/);
  assert.match(apartado2, /Justificación de la evaluación: «Tramo de 3: los indicadores no tienen meta ni frecuencia/);
  assert.match(apartado2, /- Modificar: Poner meta numérica y frecuencia a cada indicador\./);
  assert.match(apartado2, /Párrafos genéricos que la mesa no puntuaría/);
  assert.ok(apartado2.includes(GENERICO_2.slice(0, 60)), 'el párrafo genérico de este apartado (la cita recortada)');
  assert.doesNotMatch(apartado2, /Nombrar al suplente/, 'la sugerencia del apartado 1 no es de este');
  assert.match(apartado2, /TEXTO ANTERIOR DEL APARTADO \(v1; reescríbelo entero/);
  olvidarMemoria(nueva.memoria);
  db.prepare('UPDATE evaluaciones SET estado = ? WHERE id = ?').run(evV1.estado, evV1.id);
});

test('should_reevaluate_an_assembled_memoria_on_request', async () => {
  const r = await post(`/licitaciones/${ID}/oferta/memoria/1/evaluar`);
  assert.equal(r.status, 202);
  const { trabajo: id } = await leer<{ trabajo: number }>(r);
  const t = nucleo().db.prepare('SELECT payload FROM trabajos_ia WHERE id = ?').get(id) as { payload: string };
  assert.equal((JSON.parse(t.payload) as { documento: string }).documento, RUTA_V(1));
  assert.equal((await estado(1)).evaluacion_en_curso?.estado, 'en_cola');
  assert.equal((await post(`/licitaciones/${ID}/oferta/memoria/9/evaluar`)).status, 404);
});

// Memoria por lote: cada lote tiene sus versiones. Aquí la v2 pasa a ser del lote 2 y la
// v3, de otro lote; al terminar se deja todo como estaba y se borra la versión que se crea.
const INDICACIONES_LOTE = 'Ajusta el apartado 1 al calendario de este lote y nombra al suplente.';
const actualizarVersion2 = () =>
  actualizarMemoria(nucleo().db, db, salidas, { id: ID, version: 2, apartados: [1], indicaciones: INDICACIONES_LOTE });
function sinMejorasDePrueba(): void {
  const ids = db.prepare('SELECT id FROM memorias WHERE licitacion_id = ? AND version > 3').all(ID) as { id: number }[];
  for (const m of ids) olvidarMemoria(m.id);
}
function conLotes(lote2: string, lote3: string, estado3: string): () => void {
  const antes = db
    .prepare('SELECT version, estado, lote FROM memorias WHERE licitacion_id = ? AND version IN (2, 3)')
    .all(ID) as { version: number; estado: string; lote: string | null }[];
  db.prepare('UPDATE memorias SET lote = ? WHERE licitacion_id = ? AND version = 2').run(lote2, ID);
  db.prepare('UPDATE memorias SET lote = ?, estado = ? WHERE licitacion_id = ? AND version = 3').run(
    lote3,
    estado3,
    ID,
  );
  return () => {
    for (const m of antes)
      db.prepare('UPDATE memorias SET estado = ?, lote = ? WHERE licitacion_id = ? AND version = ?').run(
        m.estado,
        m.lote,
        ID,
        m.version,
      );
    sinMejorasDePrueba();
  };
}

test('should_keep_lote_in_the_new_version', async () => {
  // Arrange
  const deshacer = conLotes('2', '4', 'fallida');
  try {
    // Act
    const r = await actualizarVersion2();

    // Assert
    assert.equal(r.error, null, r.error?.message);
    const nueva = db.prepare('SELECT lote, version_base FROM memorias WHERE id = ?').get(r.data!.memoria) as {
      lote: string | null;
      version_base: number;
    };
    assert.deepEqual(nueva, { lote: '2', version_base: 2 });
  } finally {
    deshacer();
  }
});

test('should_allow_updating_lote_2_while_lote_4_is_being_written', async () => {
  // Arrange
  const deshacer = conLotes('2', '4', 'redactando');
  try {
    // Act
    const otroLote = await actualizarVersion2();
    sinMejorasDePrueba();
    db.prepare("UPDATE memorias SET lote = '2' WHERE licitacion_id = ? AND version = 3").run(ID);
    const mismoLote = await actualizarVersion2();

    // Assert
    assert.equal(otroLote.error, null, otroLote.error?.message);
    assert.equal(mismoLote.error?.message, 'La memoria v3 aún se está redactando o ensamblando: espera a que termine.');
  } finally {
    deshacer();
  }
});

test('should_refuse_to_update_when_the_decisions_are_no_longer_valid', async () => {
  // Un guion idéntico ya no desfasa las decisiones (rebase.ts): cambia un criterio automático.
  const otro = guionCon((g) => {
    g.automaticos[0]!.puntos = 12;
  });
  assert.equal((await proponerGuion(db, GuionEntrada.parse(otro), 'licitaciones')).error, null);
  const r = await post(`/licitaciones/${ID}/oferta/memoria/1/mejorar`, { indicaciones: INDICACIONES_EVALUACION });
  assert.equal(r.status, 409);
  assert.match(
    (await leer<{ message: string }>(r)).message,
    /^Las decisiones se fijaron con el guion v1 y el vigente es el v2/,
  );
});

test('should_add_what_the_tender_boards_said_in_similar_sections_to_the_dossier_once_accepted', async () => {
  const datos = {
    resultado: 'perdida',
    ganador: 'Consultora Atlántica SL',
    puntos_nuestros: 31,
    puntos_ganador: 39,
    lecciones: ['Los indicadores sin meta numérica puntuaron en el tramo bajo.'],
    criterios: [
      {
        criterio: 'Gestión de incidencias y control de calidad',
        puntos_max: 7,
        nuestros: 3,
        ganador: 7,
        comentario_mesa: 'Los indicadores propuestos carecen de metas cuantificadas.',
        pagina: 4,
      },
    ],
  };
  const insertar = (estado: string) =>
    db
      .prepare(
        `INSERT INTO aprendizajes (carpeta, expediente, organo, documento, datos, estado, agente, creado_en)
    VALUES (?, '12/2025', 'Ayuntamiento de Villaejemplo', ?, ?, ?, 'licitaciones', ?)`,
      )
      .run(
        `Conocimiento/Licitaciones/Presentadas/Villaejemplo ${estado}`,
        `Conocimiento/Licitaciones/Presentadas/Villaejemplo ${estado}/acta.pdf`,
        JSON.stringify(datos),
        estado,
        ts,
      );
  const leccionesDelDossier = async () => {
    const d = await componerDossier(db, nucleo().db, memoria(1)!.id);
    assert.equal(d.error, null, d.error?.message);
    return d.data!.secciones.find((x) => x.clave === 'lecciones')!.texto;
  };
  insertar('pendiente');
  assert.doesNotMatch(
    await leccionesDelDossier(),
    /carecen de metas cuantificadas/,
    'lo pendiente de revisar no llega',
  );
  insertar('aceptada');
  assert.match(
    await leccionesDelDossier(),
    /2\. Gestión de incidencias y control de calidad:\n- [^\n]*Los indicadores propuestos carecen de metas cuantificadas\./,
  );
});

test('should_keep_the_evaluation_example_of_the_hermes_skill_valid', () => {
  const md = leerSkill();
  const inicio =
    md.indexOf('```json', md.indexOf('### Evaluar una memoria con la escala del guion')) + '```json'.length;
  const e = EvaluacionEntrada.safeParse(JSON.parse(md.slice(inicio, md.indexOf('```', inicio))));
  assert.ok(e.success, JSON.stringify(e.error?.issues));
  const apartados = GuionEntrada.parse({ id: ID, ...GUION_CASO_A }).memoria!.apartados;
  assert.deepEqual(problemasContraGuion(e.data.criterios, apartados, 1), [], 'el ejemplo casa con el guion del caso A');
});

// ── Nada desaparece en silencio: lo que se descarta al llegar una versión nueva queda dicho ──

const avisosGuardados = (version: number) =>
  JSON.parse(
    (
      db.prepare('SELECT avisos FROM memorias WHERE licitacion_id = ? AND version = ?').get(ID, version) as {
        avisos: string;
      }
    ).avisos,
  ) as string[];
const avisosLeidos = async (version: number) =>
  (
    await leer<{ memorias: { version: number; avisos: string[] }[] }>(
      fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta`),
    )
  ).memorias.find((m) => m.version === version)!.avisos;

test('should_tell_in_new_version_warnings_which_versions_were_discarded', async () => {
  const primera = memoria(1)!;
  const estadoV1 = (
    db.prepare('SELECT estado FROM borradores WHERE memoria_id = ?').get(primera.id) as { estado: string }
  ).estado;
  assert.equal(estadoV1, 'descartada', 'la v1 sin revisar se fue al llegar la v2');
  assert.ok(
    avisosGuardados(2).includes('Al llegar la v2, la v1 sin revisar pasó a descartada.'),
    avisosGuardados(2).join(' | '),
  );
  assert.ok(
    (await avisosLeidos(2)).includes('Al llegar la v2, la v1 sin revisar pasó a descartada.'),
    'y la web lo ve',
  );
  assert.equal(avisoDescartadas(5, [2, 3, 4]), 'Al llegar la v5, las v2, v3 y v4 sin revisar pasaron a descartadas.');
  assert.equal(avisoDescartadas(5, []), null);
});

test('should_return_discarded_versions_when_a_new_one_is_assembled', async () => {
  const segunda = memoria(2)!;
  const tercera = memoria(3)!;
  const copia = db
    .prepare('SELECT datos, caracteres, paginas_estimadas FROM memoria_apartados WHERE memoria_id = ? AND apartado = 1')
    .get(segunda.id) as { datos: string; caracteres: number; paginas_estimadas: number };
  db.prepare(
    "UPDATE memoria_apartados SET estado = 'recibido', datos = ?, caracteres = ?, paginas_estimadas = ?, agente = 'licitaciones' WHERE memoria_id = ? AND apartado = 1",
  ).run(copia.datos, copia.caracteres, copia.paginas_estimadas, tercera.id);
  const r = await ensamblarMemoria(db, tercera.id, raicesActuales());
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.descartadas, [2]);
  assert.ok(
    r.data!.avisos.includes('Al llegar la v3, la v2 sin revisar pasó a descartada.'),
    r.data!.avisos.join(' | '),
  );
  assert.deepEqual(avisosGuardados(3), r.data!.avisos, 'lo que se devuelve es lo que queda guardado');
});

test('should_return_discarded_versions_when_uploading_a_word', async () => {
  const titulos = guionVigente(db, ID)!.datos.memoria!.apartados.map((a) => a.titulo);
  const parrafo =
    'Persona A coordina el servicio con un responsable suplente y revisa los indicadores cada mes con la entidad.';
  const docx = await generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'EXP-2026-0412',
      organo: 'SIIE',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '15 de octubre de 2026',
    },
    apartados: titulos.map((t, i) => ({ numero: String(i + 1), titulo: t, bloques: [{ parrafos: [parrafo] }] })),
    pie: { texto: '', numeracion: true },
  });
  const form = new FormData();
  form.append('archivo', new Blob([new Uint8Array(docx)]), 'memoria-retocada.docx');
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/memoria/subir`, {
    method: 'POST',
    body: form,
  });
  assert.equal(r.status, 201, await r.clone().text());
  const s = await leer<{ version: number; descartadas: number[] }>(r);
  assert.deepEqual([s.version, s.descartadas], [4, [3]]);
  assert.ok(
    avisosGuardados(4).includes('Al llegar la v4, la v3 sin revisar pasó a descartada.'),
    avisosGuardados(4).join(' | '),
  );
});

test('should_replace_missing_profile_warning_when_profile_is_now_complete', async () => {
  const firma = `${PREFIJO_AVISO_FIRMA} al final de la memoria: escribe en el Word quién firma (el perfil no tiene representante) antes de firmar.`;
  for (const v of [3, 4])
    db.prepare('UPDATE memorias SET avisos = ? WHERE licitacion_id = ? AND version = ?').run(
      JSON.stringify([AVISO_SIN_PERFIL, firma]),
      ID,
      v,
    );
  assert.deepEqual(await avisosLeidos(3), [
    'La portada de la v3 se montó sin el perfil de la empresa; ya está completo: «Volver a montar sin IA» la pone al día.',
    firma,
  ]);
  assert.deepEqual(
    await avisosLeidos(4),
    ['La portada de la v4 se montó sin el perfil de la empresa; ya está completo: corrígela en tu Word.', firma],
    'la subida se corrige en el Word',
  );
  const perfil = {
    nif: 'B12345678',
    nombre: 'Analítica Ejemplo SL',
    domicilio: 'Calle Mayor 1, 38003 Puerto de Ejemplo',
    representante: { nombre: 'Persona A', nif: '12345678Z' },
  };
  assert.equal(guardarPerfilEmpresa(nucleo().db, perfil).error, null);
  assert.equal(
    (await avisosLeidos(3)).some((a) => a.startsWith(PREFIJO_AVISO_FIRMA)),
    false,
    'con lugar y firmante, no se pide escribirlos a mano',
  );
  assert.ok(
    (await avisosLeidos(3)).includes(
      'La firma de la v3 se montó sin lugar o sin firmante; ya están en el perfil: «Volver a montar sin IA» la pone al día.',
    ),
    'el Word sigue sin ellos hasta volver a montarlo',
  );
  assert.ok(
    (await avisosLeidos(4)).includes(
      'La firma de la v4 se montó sin lugar o sin firmante; ya están en el perfil: corrígela en tu Word.',
    ),
    'la subida se corrige en el Word',
  );
  assert.deepEqual(avisosGuardados(3), [AVISO_SIN_PERFIL, firma], 'se recalcula al leer, sin tocar lo guardado');
});
