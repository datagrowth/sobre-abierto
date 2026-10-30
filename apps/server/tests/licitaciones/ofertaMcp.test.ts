// licitaciones_oferta por MCP: abre con el bloque estado y los bloqueos de las comprobaciones,
// devuelve solo las secciones pedidas y nunca un importe ofertado. Sobre las ofertas reales
// seudonimizadas de fixtures/comprobaciones: CASO_F (descartada, con memoria en el guion) y CASO_D (sin
// memoria, lote 2 de interés), sembradas en la base como las deja la plataforma.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-mcp-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
for (const d of [conocimiento, agentes, path.join(tmp, 'salidas')]) fs.mkdirSync(d, { recursive: true });
const T_CLAUDE = 'c'.repeat(40);
const T_CURIOSO = 'k'.repeat(40);
// Un agente que lee licitaciones pero no colaboradores (datos personales).
fs.writeFileSync(path.join(agentes, 'curioso.token'), T_CURIOSO);
fs.writeFileSync(path.join(agentes, 'permisos.json'), JSON.stringify({ curioso: { colaboradores: 'ninguno' } }));
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { cambiarOportunidad } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { primerBloqueoAbierto } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'comprobaciones');
// Lejos, para que ninguna regla de plazo dependa del día en que corre el test.
const LIMITE = '2099-10-26T23:59:00';
const PRECIO = 72;

type Equipo = { persona_id: number; rol_en_la_oferta: string; lotes?: string[]; [k: string]: unknown };
type Fixture = {
  id: string;
  licitacion: { titulo: string; lotes: { id: string; nombre: string; presupuesto_sin_iva: number }[] };
  oportunidad: { estado: string; lotes_interes: string[]; motivo_descarte: string | null };
  guiones: { version: number; datos: unknown; creado_en: string }[];
  decisiones: {
    actualizada_en: string;
    datos: {
      equipo: Equipo[];
      ofertas: { lote: string | null; pendiente: boolean; importe: number | null; unitarios: unknown[] }[];
    } & Record<string, unknown>;
  } | null;
  propuesta: {
    creada_en: string;
    agente: string;
    avisos: string[];
    datos: { equipo: Equipo[] } & Record<string, unknown>;
  } | null;
  personas: { persona_id: number; nombre: string; tipo: string; rol: string }[];
};

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const leerFixture = (nombre: string): Fixture =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${nombre}.json`), 'utf8')) as Fixture;

// Las personas de la fixture, creadas en el núcleo: ids nuevos para los mismos seudónimos.
function crearPersonas(f: Fixture): Map<number, number> {
  return new Map(
    f.personas.map((p) => [
      p.persona_id,
      crearPersona(nucleo().db, { nombre: p.nombre, tipo: p.tipo, rol: p.rol }).data!.id,
    ]),
  );
}

const conIds = (equipo: Equipo[], ids: Map<number, number>): Equipo[] =>
  equipo.map((m) => ({ ...m, persona_id: ids.get(m.persona_id) ?? m.persona_id }));

function sembrarGuionYDecisiones(
  id: string,
  f: Fixture,
  ids: Map<number, number>,
  ajustar: (d: NonNullable<Fixture['decisiones']>['datos']) => void,
): void {
  const g = f.guiones.at(-1)!;
  const guionId = Number(
    db
      .prepare(
        "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, ?, ?, 'oferta-licitaciones', 1, ?)",
      )
      .run(id, g.version, JSON.stringify(g.datos), g.creado_en).lastInsertRowid,
  );
  if (f.decisiones) {
    const datos = { ...f.decisiones.datos, equipo: conIds(f.decisiones.datos.equipo, ids) };
    ajustar(datos);
    db.prepare(
      'INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)',
    ).run(id, guionId, JSON.stringify(datos), f.decisiones.actualizada_en);
  }
  if (f.propuesta) {
    const datos = { ...f.propuesta.datos, equipo: conIds(f.propuesta.datos.equipo, ids) };
    db.prepare(
      'INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, avisos, agente, creada_en) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      id,
      guionId,
      JSON.stringify(datos),
      JSON.stringify(f.propuesta.avisos),
      f.propuesta.agente,
      f.propuesta.creada_en,
    );
  }
}

// La oferta de la fixture con otro id (cada test la suya) y la oportunidad en preparación.
function sembrar(
  nombre: string,
  id: string,
  ajustar: (d: NonNullable<Fixture['decisiones']>['datos']) => void = () => {},
): Fixture {
  const f = leerFixture(nombre);
  const lotes = f.licitacion.lotes.map((l) => ({ id: l.id, nombre: l.nombre, importe: l.presupuesto_sin_iva }));
  const l = licitacion({
    titulo: f.licitacion.titulo,
    publicada: '2026-09-24',
    limite: LIMITE,
    ...(lotes.length ? { lotes } : {}),
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}` });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV', ?, ?, ?)",
  ).run(id, JSON.stringify(f.oportunidad.lotes_interes.map((x) => ({ id: x, motivo: 'criba' }))), ts, ts);
  sembrarGuionYDecisiones(id, f, crearPersonas(f), ajustar);
  return f;
}

async function conectar(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

type Llamada = { texto: string; datos: Record<string, unknown>; error: boolean };

async function oferta(argumentos: Record<string, unknown>, token = T_CLAUDE): Promise<Llamada> {
  const client = await conectar(token);
  try {
    const r = await client.callTool({ name: 'licitaciones_oferta', arguments: argumentos });
    const texto = (r.content as { text: string }[])[0]?.text ?? '';
    return { texto, datos: r.isError ? {} : (JSON.parse(texto) as Record<string, unknown>), error: Boolean(r.isError) };
  } finally {
    await client.close();
  }
}

type Estado = {
  descartada: { motivo: string; categoria: string | null } | null;
  veredicto: { tipo: string; texto: string };
  vence_en: string;
  vence_texto: string;
  siguiente: { clave: string; titulo: string; accion: unknown } | null;
  precio_fijado: Record<string, boolean>;
  decisiones_obsoletas: boolean;
  desfases: unknown[];
};

test('should_open_with_the_state_block_and_the_same_first_blocker_as_the_comprobaciones', async () => {
  // Arrange
  const ID = 'p-30670901';
  sembrar('casoD', ID);
  const comprobaciones = comprobacionesDe(db, nucleo().db, ID).data!;
  const primero = primerBloqueoAbierto(comprobaciones.bloqueos)!;

  // Act
  const r = await oferta({ id: ID });

  // Assert
  const estado = r.datos['estado'] as Estado;
  assert.deepEqual(Object.keys(r.datos).slice(0, 3), ['id', 'estado', 'bloqueos'], 'lo accionable primero');
  assert.deepEqual(estado.veredicto, comprobaciones.veredicto, 'el mismo veredicto que la web');
  assert.deepEqual(estado.siguiente, { clave: primero.clave, titulo: primero.titulo, accion: primero.accion });
  assert.deepEqual(
    (r.datos['bloqueos'] as { clave: string }[]).map((b) => b.clave),
    comprobaciones.bloqueos.map((b) => b.clave),
    'los bloqueos de las comprobaciones, en su orden',
  );
  assert.equal(estado.vence_en, '2099-10-26T23:59:00+01:00', 'ISO con zona');
  assert.match(estado.vence_texto, /23:59 hora peninsular$/);
  assert.deepEqual(estado.precio_fijado, { '2': false }, 'precio por lote del ámbito, sin importe');
  assert.deepEqual([estado.descartada, estado.decisiones_obsoletas, estado.desfases], [null, false, []]);
  assert.ok(!('coherencia' in r.datos), 'la coherencia ya viene como bloqueos');
});

test('should_return_only_the_requested_sections', async () => {
  // Arrange
  const ID = 'p-30670902';
  sembrar('casoD', ID);

  // Act
  const r = await oferta({ id: ID, secciones: ['estado', 'decisiones'] });

  // Assert
  assert.deepEqual(Object.keys(r.datos), ['id', 'estado', 'decisiones']);
});

test('should_default_to_state_blockers_and_section_when_asking_for_a_section', async () => {
  // Arrange
  const ID = 'p-30603091';
  const f = sembrar('casoF', ID);
  const guion = f.guiones.at(-1)!.datos as {
    memoria: { archivo: string; apartados: { titulo: string }[] };
    automaticos: { archivo: string }[];
  };

  // Act
  const r = await oferta({ id: ID, apartado: 1 });
  const conGuion = await oferta({ id: ID, apartado: 1, secciones: ['guion', 'apartado'] });

  // Assert
  const apartado = r.datos['apartado'] as { numero: number; titulo: string; automaticos_vigilados: number[] };
  assert.deepEqual(Object.keys(r.datos), ['id', 'estado', 'bloqueos', 'apartado']);
  assert.deepEqual([apartado.numero, apartado.titulo], [1, guion.memoria.apartados[0]!.titulo]);
  assert.deepEqual(
    apartado.automaticos_vigilados,
    guion.automaticos.map((_, i) => i),
    'los tres automáticos van en otro archivo: índices, no copias',
  );
  assert.deepEqual(Object.keys(conGuion.datos), ['id', 'guion', 'apartado'], 'lo que se pide, manda');
});

test('should_refuse_a_section_when_the_tender_asks_for_no_memory', async () => {
  // Arrange
  const ID = 'p-30670903';
  sembrar('casoD', ID);

  // Act
  const r = await oferta({ id: ID, apartado: 1 });

  // Assert
  assert.equal(r.error, true);
  assert.match(r.texto, /Esta oferta no lleva memoria técnica \(el pliego no la pide\)\./);
});

test('should_list_people_once_and_roles_by_id', async () => {
  // Arrange: la misma persona en dos roles.
  const ID = 'p-30670904';
  sembrar('casoD', ID, (d) => {
    d.equipo.push({ ...d.equipo[0]!, rol_en_la_oferta: 'Coordinación del lote 2', lotes: ['2'] });
  });

  // Act
  const conPermiso = await oferta({ id: ID, secciones: ['decisiones'] });
  const sinPermiso = await oferta({ id: ID, secciones: ['decisiones'] }, T_CURIOSO);

  // Assert
  type Decisiones = {
    personas?: { persona_id: number; nombre: string }[];
    roles: { rol: string; persona_id: number; lotes: string[] }[];
    equipo?: unknown;
  };
  const d = conPermiso.datos['decisiones'] as Decisiones;
  assert.equal(d.roles.length, 3);
  assert.equal(d.personas?.length, 2, 'cada persona una sola vez');
  assert.deepEqual(
    new Set(d.roles.map((x) => x.persona_id)),
    new Set(d.personas!.map((p) => p.persona_id)),
    'los roles nombran a las personas por id',
  );
  const ultimo = d.roles.at(-1)!;
  assert.deepEqual(
    [ultimo.rol, ultimo.persona_id, ultimo.lotes],
    ['Coordinación del lote 2', d.roles[0]!.persona_id, ['2']],
  );
  assert.ok(!('equipo' in d), 'sin el equipo repetido');
  const s = sinPermiso.datos['decisiones'] as Decisiones;
  assert.ok(!('personas' in s) && s.roles.length === 3, 'sin permiso sobre colaboradores, solo los roles');
  assert.ok(!sinPermiso.texto.includes('Persona K'), 'ni un nombre');
});

test('should_not_include_any_amount', async () => {
  // Arrange: el precio del lote 2 decidido.
  const ID = 'p-30670905';
  sembrar('casoD', ID, (d) => {
    d.ofertas = [{ lote: '2', pendiente: false, importe: PRECIO, unitarios: [] }];
  });

  // Act
  const r = await oferta({
    id: ID,
    secciones: ['estado', 'bloqueos', 'decisiones', 'propuesta', 'memoria', 'memoria_historial'],
  });

  // Assert
  assert.doesNotMatch(r.texto, new RegExp(`\\b${PRECIO}\\b`), 'el precio decidido no aparece');
  assert.doesNotMatch(r.texto, /"ofertas"|"unitarios"|"importe"/);
  assert.deepEqual((r.datos['estado'] as Estado).precio_fijado, { '2': true }, 'pero sí que está fijado');
});

test('should_say_discarded_with_its_reason_for_casoF', async () => {
  // Arrange: descartada por solvencia, como en producción.
  const ID = 'p-30603092';
  const f = sembrar('casoF', ID);
  assert.equal(
    cambiarOportunidad(
      db,
      ID,
      { estado: 'descartada', motivo_descarte: f.oportunidad.motivo_descarte!, categoria_descarte: 'solvencia' },
      'Persona A',
    ).error,
    null,
  );

  // Act
  const r = await oferta({ id: ID, secciones: ['estado'] });

  // Assert
  const estado = r.datos['estado'] as Estado;
  assert.deepEqual(estado.descartada, { motivo: f.oportunidad.motivo_descarte, categoria: 'solvencia' });
  assert.equal(estado.veredicto.tipo, 'descartada');
  assert.match(estado.veredicto.texto, /^Descartada: Sin solvencia técnica mínima/);
  assert.equal(estado.siguiente, null, 'descartada no hay nada que preparar: solo recuperarla');
});

// ── Historial de la memoria y evaluación entera ──

const RESUMEN_LARGO = `${'La memoria trata bien la metodología pero se queda corta en trazabilidad. '.repeat(14)}FIN-DEL-RESUMEN`;

function evaluacionDe(version: number, apartados: number[]): string {
  const criterios = apartados.map((n) => ({
    criterio: `Apartado ${n}`,
    peso: 12,
    tipo: 'juicio_valor',
    puntuacion: 0,
    justificacion: `Justificación del apartado ${n}`,
    apartado: n,
    tramo: 0,
  }));
  return JSON.stringify({
    resumen: RESUMEN_LARGO,
    puntuacion_total: 0,
    puntuacion_maxima: 12 * apartados.length,
    criterios,
    eliminar: [],
    modificar: [{ referencia: 'Apartado 1, pág. 3', que: 'Cuantificar los plazos del método de verificación.' }],
    reforzar: [],
    comparables: [],
    riesgos: [],
    memoria: { version, guion_id: 1 },
  });
}

type MemoriaHistorial = {
  id: number;
  version: number;
  revision: string;
  fugas: number;
  anulada: { en: string } | null;
  evaluacion_id: number | null;
  evaluacion: { resumen: string; mejorable: { apartado: number; que_cambiar: string; por_que: string }[] } | null;
  hallazgos_fugas: { cita?: string }[];
};

// La primera versión (subida a mano), aceptada y con una fuga (un importe en una frase de precio), y la segunda, con fases, pendiente, con crítica y fuga anulada.
function sembrarHistorial(id: string): void {
  sembrar('casoF', id);
  const guion = (db.prepare('SELECT id FROM guiones WHERE licitacion_id = ?').get(id) as { id: number }).id;
  const ts = new Date().toISOString();
  const memoria = (version: number, fase: string | null, revision: string, anulacion: string | null): number => {
    const b = Number(
      db
        .prepare(
          `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, guion_id, version)
      VALUES (?, ?, 'h', 10, 'plataforma', ?, ?, 'ensamblado', ?, ?)`,
        )
        .run(id, `Salidas/${id}/memoria-v${version}.docx`, ts, revision, guion, version).lastInsertRowid,
    );
    const m = Number(
      db
        .prepare(
          "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, borrador_id, fase, anulacion_fugas) VALUES (?, ?, ?, 'ensamblada', ?, ?, ?, ?, ?)",
        )
        .run(id, guion, version, ts, ts, b, fase, anulacion).lastInsertRowid,
    );
    db.prepare('UPDATE borradores SET memoria_id = ? WHERE id = ?').run(m, b);
    db.prepare(
      "INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en) VALUES (?, ?, ?, 'hermes', ?)",
    ).run(id, `Salidas/${id}/memoria-v${version}.docx`, evaluacionDe(version, [1, 2]), ts);
    return m;
  };
  const primera = memoria(1, null, 'aceptada', null);
  const bloque = { parrafos: ['El precio de la oferta será de 4.000 € al mes en cada lote.'] };
  db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos) VALUES (?, 1, 'recibido', ?)").run(
    primera,
    JSON.stringify({ titulo: 'Metodología de verificacion y calculo', bloques: [bloque], cubre: [], compromisos: [] }),
  );
  const segunda = memoria(
    2,
    'fin',
    'pendiente',
    JSON.stringify({ motivo: 'Es un ejemplo del método', en: '2026-10-14T10:00:00Z', fugas: [] }),
  );
  const critica = {
    apartados: [
      {
        apartado: 1,
        tramo: 3,
        puntos: 3,
        cita: 'Persona K coordina las verificaciones',
        motivos_para_bajar: [
          {
            cita: 'Persona K coordina las verificaciones',
            motivo: 'No hay plazos medibles',
            arreglo: 'Añadir plazos por fase',
          },
        ],
        falta: [],
      },
    ],
    resumen: 'Crítica de la ronda uno.',
  };
  db.prepare(
    "INSERT INTO memoria_criticas (memoria_id, ronda, datos, total, maximo, independiente, ciega, agente, creada_en) VALUES (?, 1, ?, 3, 12, 1, 1, 'hermes', ?)",
  ).run(segunda, JSON.stringify(critica), ts);
}

test('should_list_every_memory_version_with_its_leaks_and_review_state', async () => {
  // Arrange
  const ID = 'p-30670910';
  sembrarHistorial(ID);

  // Act
  const r = await oferta({ id: ID, secciones: ['memoria_historial'] });

  // Assert: de la más reciente a la más antigua.
  const h = r.datos['memoria_historial'] as MemoriaHistorial[];
  assert.deepEqual(
    h.map((x) => [x.version, x.revision]),
    [
      [2, 'pendiente'],
      [1, 'aceptada'],
    ],
  );
  assert.deepEqual([h[0]!.fugas, h[0]!.anulada], [0, { en: '2026-10-14T10:00:00Z' }]);
  assert.deepEqual([h[1]!.fugas, h[1]!.anulada], [1, null]);
  assert.doesNotMatch(r.texto, /Es un ejemplo del método/, 'el motivo de anularla no sale');
});

test('should_return_the_whole_evaluation_summary', async () => {
  // Arrange
  const ID = 'p-30670911';
  sembrarHistorial(ID);

  // Act
  const r = await oferta({ id: ID, secciones: ['memoria_historial'] });

  // Assert
  const h = r.datos['memoria_historial'] as MemoriaHistorial[];
  assert.ok(RESUMEN_LARGO.length > 600);
  assert.equal(h[1]!.evaluacion?.resumen, RESUMEN_LARGO, 'sin recortar');
  assert.equal(typeof h[1]!.evaluacion_id, 'number');
});

test('should_explain_what_to_change_in_each_improvable_section_from_the_critique', async () => {
  // Arrange
  const ID = 'p-30670912';
  sembrarHistorial(ID);

  // Act
  const r = await oferta({ id: ID, secciones: ['memoria', 'memoria_historial'] });

  // Assert: la segunda sale de su crítica; la primera (sin ella), de las sugerencias y la justificación de la evaluación.
  const mejorable = (r.datos['memoria'] as { evaluacion: MemoriaHistorial['evaluacion'] }).evaluacion!.mejorable;
  assert.deepEqual(
    mejorable.map((x) => x.apartado),
    [1],
  );
  assert.equal(mejorable[0]!.que_cambiar, 'Añadir plazos por fase');
  assert.match(mejorable[0]!.por_que, /^No hay plazos medibles/);
  const deLaPrimera = (r.datos['memoria_historial'] as MemoriaHistorial[])[1]!.evaluacion!.mejorable;
  assert.deepEqual(
    deLaPrimera.map((x) => x.apartado),
    [1, 2],
  );
  assert.equal(deLaPrimera[0]!.que_cambiar, 'Cuantificar los plazos del método de verificación.');
  assert.equal(deLaPrimera[1]!.por_que, 'Justificación del apartado 2');
});

test('should_hide_names_without_permission', async () => {
  // Arrange
  const ID = 'p-30670913';
  sembrarHistorial(ID);

  // Act
  const con = await oferta({ id: ID, secciones: ['memoria', 'memoria_historial'] });
  const sin = await oferta({ id: ID, secciones: ['memoria', 'memoria_historial'] }, T_CURIOSO);

  // Assert
  assert.match(con.texto, /Persona K coordina/);
  assert.doesNotMatch(sin.texto, /Persona K/);
  assert.ok(
    Array.isArray((sin.datos['memoria'] as { evaluacion: { mejorable: unknown[] } }).evaluacion.mejorable),
    'pero sigue explicando qué cambiar',
  );
  assert.match(sin.texto, /Añadir plazos por fase/);
});

test('should_hide_colaboradores_names_in_the_evaluation_summary_and_justification', async () => {
  // Arrange: la evaluación de la primera versión nombra a una persona de Colaboradores en el resumen y en una justificación.
  const ID = 'p-30670914';
  sembrarHistorial(ID);
  const persona = crearPersona(nucleo().db, { nombre: 'Ana Ejemplo Ruiz', tipo: 'interno', rol: 'Jefa de proyecto' })
    .data!.id;
  const fila = db
    .prepare(
      "SELECT id, datos FROM evaluaciones WHERE licitacion_id = ? AND json_extract(datos, '$.memoria.version') = 1",
    )
    .get(ID) as { id: number; datos: string };
  const datos = JSON.parse(fila.datos) as { resumen: string; criterios: { justificacion: string }[] };
  datos.resumen = 'Ana Ejemplo Ruiz como jefa de proyecto aporta 10 años de experiencia.';
  datos.criterios[1]!.justificacion = 'Ana Ejemplo Ruiz no detalla su dedicación.';
  db.prepare('UPDATE evaluaciones SET datos = ? WHERE id = ?').run(JSON.stringify(datos), fila.id);

  // Act
  const sin = await oferta({ id: ID, secciones: ['memoria_historial'] }, T_CURIOSO);
  const con = await oferta({ id: ID, secciones: ['memoria_historial'] });

  // Assert
  assert.doesNotMatch(sin.texto, /Ana Ejemplo Ruiz/);
  assert.match(sin.texto, new RegExp(`la persona ${persona} como jefa de proyecto`));
  assert.match(con.texto, /Ana Ejemplo Ruiz como jefa de proyecto/, 'con permiso de colaboradores, tal cual');
});

test('should_return_the_memory_of_the_requested_lot', async () => {
  // Arrange: CASO_E pide una memoria por lote; la v5 es la del lote 2 y la v6, la del lote 4.
  const ID = 'p-30670915';
  sembrar('casoE', ID);
  const guion = (db.prepare('SELECT id FROM guiones WHERE licitacion_id = ?').get(ID) as { id: number }).id;
  const ts = new Date().toISOString();
  for (const [version, lote] of [
    [5, '2'],
    [6, '4'],
  ] as const) {
    db.prepare(
      "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, lote) VALUES (?, ?, ?, 'ensamblada', ?, ?, ?)",
    ).run(ID, guion, version, ts, ts, lote);
  }

  // Act
  const delLote2 = await oferta({ id: ID, secciones: ['memoria'], lote: '2' });
  const sinLote = await oferta({ id: ID, secciones: ['memoria'] });
  const otroLote = await oferta({ id: ID, secciones: ['memoria'], lote: '9' });

  // Assert
  assert.equal((delLote2.datos['memoria'] as { version: number; lote: string }).version, 5);
  assert.equal((delLote2.datos['memoria'] as { version: number; lote: string }).lote, '2');
  assert.equal(sinLote.datos['memoria'], null, 'sin lote no elige la de ninguno');
  assert.match(String(sinLote.datos['aviso_memoria']), /con «lote»/);
  assert.deepEqual(
    (sinLote.datos['memorias_por_lote'] as { lote: string; version: number }[]).map((m) => [m.lote, m.version]),
    [
      ['2', 5],
      ['4', 6],
    ],
  );
  assert.equal(otroLote.error, true);
  assert.match(otroLote.texto, /lotes 2, 4/);
});

async function oportunidades(token: string): Promise<string> {
  const client = await conectar(token);
  try {
    const r = await client.callTool({
      name: 'licitaciones_oportunidades',
      arguments: { estados: ['en_preparacion'], limite: 100 },
    });
    return (r.content as { text: string }[])[0]?.text ?? '';
  } finally {
    await client.close();
  }
}

test('should_hide_names_in_blockers_state_and_list_without_permission', async () => {
  // Arrange: una persona del equipo solo para el lote 1 cuando la empresa va al 2 (la coherencia la nombra).
  const ID = 'p-30670921';
  const f = sembrar('casoD', ID, (d) => {
    d.equipo = d.equipo.map((m) => ({ ...m, lotes: ['1'] }));
  });
  const nombres = new RegExp(f.personas.map((p) => p.nombre).join('|'));

  // Act
  const con = await oferta({ id: ID, secciones: ['estado', 'bloqueos'] });
  const sin = await oferta({ id: ID, secciones: ['estado', 'bloqueos'] }, T_CURIOSO);
  const lista = await oportunidades(T_CURIOSO);

  // Assert
  assert.match(con.texto, nombres, 'con permiso, el bloqueo dice a quién');
  assert.doesNotMatch(sin.texto, nombres);
  assert.match(sin.texto, /la persona \d+/, 'sin permiso, por su id');
  assert.doesNotMatch(lista, nombres);
});
