// Memoria no valorable (caso CASO_E): manda el guion vigente. Si ya no puntúa la memoria, la
// plataforma no encola su autoevaluación ni deja pedirla a mano, y una evaluación con
// puntuación máxima 0 ya no la rechaza el esquema.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUION_CASO_A, ID, licitacionCasoA } from './fixtures/casoA.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-no-valorable-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { EvaluacionDatos, pedirEvaluacion, pedirEvaluacionDeMemoria, TIPO_EVALUACION } =
  await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');

iniciarNucleo();
const db = dbLicitaciones();
const ts = new Date().toISOString();
guardarLicitacion(db, licitacionCasoA());

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function guardarGuion(version: number, valorable: boolean | undefined): number {
  const datos = GuionBase.parse(structuredClone(GUION_CASO_A));
  if (valorable === false) datos.memoria = { ...datos.memoria!, valorable: false };
  return Number(
    db
      .prepare(
        'INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, ?, ?, ?, 1, ?)',
      )
      .run(ID, version, JSON.stringify(datos), 'test', ts).lastInsertRowid,
  );
}

const trabajosEvaluar = () =>
  (nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ?').get(TIPO_EVALUACION) as { n: number }).n;

// La versión se hizo con el guion g1 (sin el campo valorable) y después llegó g2.
const g1 = guardarGuion(1, undefined);
const m = { licitacion_id: ID, version: 1, guion_id: g1 };

test('should_accept_evaluation_with_max_zero', () => {
  const r = EvaluacionDatos.safeParse({
    resumen: 'La memoria no se puntúa.',
    puntuacion_total: 0,
    puntuacion_maxima: 0,
    criterios: [{ criterio: 'Memoria', peso: 0, tipo: 'juicio_valor', puntuacion: 0, justificacion: 'No puntúa' }],
    eliminar: [],
    modificar: [],
    reforzar: [],
    comparables: [],
    riesgos: [],
  });
  assert.equal(r.success, true);
});

test('should_still_enqueue_when_current_guion_is_valorable', () => {
  const antes = trabajosEvaluar();
  const id = pedirEvaluacionDeMemoria(nucleo().db, db, m, 'Salidas/Licitaciones/x/memoria-v1.docx');
  assert.ok('trabajo' in id);
  assert.equal(trabajosEvaluar(), antes + 1);
});

test('should_not_enqueue_memory_evaluation_when_current_guion_says_not_valorable', () => {
  guardarGuion(2, false);
  const antes = trabajosEvaluar();
  const id = pedirEvaluacionDeMemoria(nucleo().db, db, { ...m, version: 2 }, 'Salidas/Licitaciones/x/memoria-v2.docx');
  assert.ok('omitida' in id);
  assert.equal(trabajosEvaluar(), antes);
});

test('should_reject_manual_evaluation_of_non_valorable_memory', () => {
  const doc = 'Salidas/Licitaciones/x/memoria-v1.docx';
  const mem = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES (?, ?, 1, 'ensamblada', ?)",
      )
      .run(ID, g1, ts).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, origen, memoria_id, guion_id, version) VALUES (?, ?, 'h', 1, 'plataforma', ?, 'ensamblado', ?, ?, 1)",
  ).run(ID, doc, ts, mem, g1);
  const r = pedirEvaluacion(nucleo().db, db, { documentos: tmp, salidas: tmp } as never, { id: ID, documento: doc });
  assert.equal(r.error?.code, 'invalid_input');
  assert.match(r.error?.message ?? '', /no puntúa esta memoria/);
});

type Respuesta = { content: { text: string }[]; isError?: boolean };
type Callback = (raw: unknown) => Promise<Respuesta>;

// Un McpServer falso que guarda los callbacks por nombre: la frontera es el SDK.
async function herramientaMcp(nombre: string): Promise<Callback> {
  const { herramientasPropuestas } = await import('../../src/dominios/licitaciones/propuestas/tools.js');
  const tools = new Map<string, Callback>();
  const server = {
    registerTool: (n: string, _c: unknown, f: Callback) => {
      tools.set(n, f);
    },
  };
  herramientasPropuestas(server as never, { nombre: 'hermes', permisos: { licitaciones: 'proponer' } });
  return tools.get(nombre)!;
}

test('should_reject_evaluation_tool_for_memory_that_current_guion_does_not_score', async () => {
  // Arrange: la memoria v1 (guion g1, valorable) ya está registrada y el vigente g2 no la puntúa.
  const evaluar = await herramientaMcp('licitaciones_evaluacion');
  const entrada = {
    id: ID,
    documento: 'Salidas/Licitaciones/x/memoria-v1.docx',
    resumen: 'La memoria no se puntúa.',
    puntuacion_total: 0,
    puntuacion_maxima: 0,
    criterios: [{ criterio: 'Memoria', peso: 0, tipo: 'juicio_valor', puntuacion: 0, justificacion: 'No puntúa' }],
    eliminar: [],
    modificar: [],
    reforzar: [],
    comparables: [],
    riesgos: [],
  };
  // Act
  const r = await evaluar(entrada);
  // Assert: el motivo es que no se evalúa, no los criterios de la ficha.
  assert.equal(r.isError, true);
  assert.match(r.content[0]!.text, /no puntúa esta memoria/);
  assert.doesNotMatch(r.content[0]!.text, /criterios de la ficha/);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM evaluaciones').get() as { n: number }).n, 0);
});
