// Matriz rol × persona sobre Villaejemplo (fixtures/cambios): nadie del equipo tiene registrada la docencia en topografía ni en jardinería y la
// ficha decía «Cumple». La función es pura; la ruta se prueba por HTTP con la Biblioteca doblada.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'matriz-equipo-'));
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
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { matrizEquipo, matrizDeLicitacion } = await import('../../src/dominios/licitaciones/oferta/matrizEquipo.js');
const { actualizarPersona, listarPersonas } = await import('../../src/nucleo/colaboradores/personas.js');
const { ok } = await import('../../src/nucleo/result.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
const express = (await import('express')).default;

type Entrada = Parameters<typeof matrizEquipo>[0];
type Fila = ReturnType<typeof matrizEquipo>[number];
type Requisito = Entrada['requisitos'][number];
type Decisiones = NonNullable<Entrada['decisiones']>;
type Persona = Entrada['personas'][number];

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cambios');
const casoC = JSON.parse(fs.readFileSync(path.join(DIR, 'casoC-medios.json'), 'utf8')) as {
  ficha_aprobada: { datos: { requisitos: Requisito[] } };
  decisiones: { datos: Decisiones };
  personas: ({ persona_id: number } & Record<string, unknown>)[];
};
const comoPersona = ({ persona_id, ...p }: { persona_id: number } & Record<string, unknown>): Persona =>
  ({
    cv_ruta: null,
    ...p,
    id: persona_id,
    creada_en: '2026-10-01T00:00:00Z',
    actualizada_en: '2026-10-01T00:00:00Z',
  }) as unknown as Persona;
const PERSONAS = casoC.personas.map(comoPersona);
const CASO_C: Entrada = {
  requisitos: casoC.ficha_aprobada.datos.requisitos,
  decisiones: casoC.decisiones.datos,
  personas: PERSONAS,
  lotes: ['3'],
};

const filaDe = (filas: Fila[], rol: RegExp) => filas.find((f) => rol.test(f.rol));
const celda = (f: Fila | undefined, persona: number, materia: RegExp) =>
  f?.asignados.find((a) => a.persona_id === persona)?.celdas.find((c) => materia.test(c.materia));

const requisito = (r: Partial<Requisito>): Requisito =>
  ({
    tipo: 'medios_personales',
    descripcion: 'Formador/a con experiencia en topografía',
    excluyente: true,
    cumple: 'dudoso',
    justificacion: 'Sin comprobar.',
    documento: 'PPT.pdf',
    pagina: 7,
    ...r,
  }) as Requisito;
const decisiones = (
  equipo: { persona_id: number; rol_en_la_oferta: string; lotes?: string[] }[],
  lotes = ['3'],
): Decisiones =>
  ({
    ...casoC.decisiones.datos,
    lotes,
    equipo: equipo.map((m) => ({ dedicacion: 'Parcial', lotes: [], ...m })),
  }) as Decisiones;

test('should_mark_casoC_gardening_and_surveying_as_not_covered', () => {
  const filas = matrizEquipo(CASO_C);

  const tutor = filaDe(filas, /^Tutor/);
  assert.ok(filaDe(filas, /^Coordinador/), 'la coordinación tiene su fila aunque no pida materias');
  assert.equal(tutor?.lote, '3');
  assert.equal(tutor?.pagina, 3);
  for (const materia of [/topografía/, /jardinería/]) {
    const celdas = tutor!.asignados.map((a) => a.celdas.find((c) => materia.test(c.materia)));
    assert.ok(celdas.length && celdas.every((c) => c?.estado === 'no'), `${materia}: nadie del equipo la tiene`);
  }
  assert.equal(celda(tutor, 1001, /análisis de datos/)?.estado, 'si', 'Data Analytics acredita el análisis de datos');
  assert.equal(celda(tutor, 1001, /60 h/)?.estado, 'no_comprobado', 'las horas no constan en Colaboradores');
});

test('should_never_turn_doubtful_into_yes', () => {
  // Villaejemplo trae «cumple: si» y «dudoso» en otros: ninguno da por acreditada una materia sin evidencia.
  for (const cumple of ['si', 'dudoso'] as const) {
    const filas = matrizEquipo({
      requisitos: [requisito({ cumple })],
      decisiones: decisiones([{ persona_id: 1003, rol_en_la_oferta: 'Formadora' }]),
      personas: PERSONAS,
    });

    assert.equal(celda(filas[0], 1003, /topografía/)?.estado, 'no', cumple);
  }
  const conCv = matrizEquipo({
    requisitos: [requisito({})],
    decisiones: decisiones([{ persona_id: 1003, rol_en_la_oferta: 'Formadora' }]),
    personas: PERSONAS,
    cvs: [{ persona_id: 1003, materia: 'topografía', ruta: 'Colaboradores/cv-j.pdf', pagina: 2 }],
  });
  assert.notEqual(celda(conCv[0], 1003, /topografía/)?.estado, 'si', 'el CV no la acredita');
});

test('should_offer_the_cv_page_when_colaboradores_lacks_the_subject', () => {
  const cvs = [{ persona_id: 1006, materia: 'Topografía', ruta: 'Colaboradores/cv-g.pdf', pagina: 2 }];

  const filas = matrizEquipo({
    requisitos: [requisito({})],
    decisiones: decisiones([{ persona_id: 1006, rol_en_la_oferta: 'Formadora de topografía' }]),
    personas: PERSONAS,
    cvs,
  });

  assert.deepEqual(celda(filas[0], 1006, /topografía/), {
    materia: 'topografía',
    estado: 'no_comprobado',
    fuente: 'cv',
    ruta: 'Colaboradores/cv-g.pdf',
    pagina: 2,
  });
});

test('should_warn_when_one_person_holds_two_incompatible_roles', () => {
  const r = requisito({ descripcion: 'Un coordinador/a del servicio y un formador/a con experiencia en topografía' });
  const d = decisiones([
    { persona_id: 1001, rol_en_la_oferta: 'Coordinadora' },
    { persona_id: 1001, rol_en_la_oferta: 'Formadora de topografía' },
  ]);

  const filas = matrizEquipo({ requisitos: [r], decisiones: d, personas: PERSONAS });
  const juntables = matrizEquipo({
    requisitos: [
      { ...r, descripcion: `${r.descripcion}. Ambos puestos podrán ser desempeñados por la misma persona.` },
    ],
    decisiones: d,
    personas: PERSONAS,
  });

  assert.match(filaDe(filas, /^Formador/)?.incompatibles[0] ?? '', /Persona F es Formador\/a y también Coordinador\/a/);
  assert.equal(filaDe(filas, /^Coordinador/)?.incompatibles.length, 1);
  assert.ok(
    juntables.every((f) => !f.incompatibles.length),
    'el pliego permite que coincidan',
  );
});

test('should_filter_rows_by_the_lots_we_bid_for', () => {
  const requisitos = [
    requisito({ lote: '1', descripcion: 'Docente de geriatría' }),
    requisito({ lote: '3' }),
    requisito({ descripcion: 'Coordinador/a del contrato' }),
  ];

  const filas = matrizEquipo({ requisitos, decisiones: null, personas: PERSONAS, lotes: ['3'] });
  const sinAmbito = matrizEquipo({ requisitos, decisiones: decisiones([], ['1']), personas: PERSONAS });

  assert.deepEqual(
    filas.map((f) => [f.rol, f.lote]),
    [
      ['Formador/a', '3'],
      ['Coordinador/a', null],
    ],
  );
  assert.deepEqual(
    sinAmbito.map((f) => f.lote),
    ['1', null],
    'sin ámbito, los lotes de las decisiones',
  );
  assert.ok(
    filas.every((f) => !f.asignados.length),
    'sin decisiones no hay nadie asignado',
  );
});

// Ruta: GET …/oferta/equipo/matriz, con la Biblioteca (la frontera) doblada en la búsqueda de CV.
iniciarNucleo();
const db = dbLicitaciones();
const comprobaciones = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, comprobaciones);
const app = express();
app.use(express.json());
app.use('/api/licitaciones', rutasLicitaciones());
const server = escucharLocal(http.createServer(app));
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/licitaciones/licitaciones`;
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('should_serve_the_casoC_matrix_with_surveying_not_covered', async () => {
  const res = await fetch(`${base}/${comprobaciones.id}/oferta/equipo/matriz`);
  const cuerpo = (await res.json()) as { filas: Fila[] };

  assert.equal(res.status, 200);
  const tutor = filaDe(cuerpo.filas, /^Tutor/);
  assert.ok(tutor?.asignados.length);
  assert.ok(tutor!.asignados.every((a) => a.celdas.find((c) => /topografía/.test(c.materia))?.estado === 'no'));
  assert.equal((await fetch(`${base}/${comprobaciones.id}/oferta/equipo/matriz?cv=si`)).status, 400);
  assert.equal((await fetch(`${base}/p-no-existe/oferta/equipo/matriz`)).status, 404);
});

test('should_look_up_the_cvs_only_when_asked_and_with_a_limit', async () => {
  const tutora = listarPersonas(nucleo().db).find((p) => p.nombre === 'Persona F')!;
  const { id: _id, creada_en: _c, actualizada_en: _a, ...datos } = tutora;
  assert.equal(actualizarPersona(nucleo().db, tutora.id, { ...datos, cv_ruta: 'Colaboradores/cv-f.pdf' }).error, null);
  const buscadas: string[] = [];
  const buscador = async (texto: string) => {
    buscadas.push(texto);
    return ok(/topografía/.test(texto) ? ['Colaboradores/cv-f.pdf'] : []);
  };

  const sin = await matrizDeLicitacion(db, nucleo().db, comprobaciones.id, { cv: false, buscador });
  const antes = buscadas.length;
  const con = await matrizDeLicitacion(db, nucleo().db, comprobaciones.id, { cv: true, buscador });

  assert.deepEqual([sin.error, antes], [null, 0], 'sin ?cv=1 no se busca en los CV');
  assert.ok(buscadas.length > 0 && buscadas.length <= 8, `búsquedas: ${buscadas.length}`);
  const c = celda(filaDe(con.data!.filas, /^Tutor/), tutora.id, /topografía/);
  assert.deepEqual([c?.estado, c?.fuente, c?.ruta], ['no_comprobado', 'cv', 'Colaboradores/cv-f.pdf']);
});
