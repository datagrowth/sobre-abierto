// El latido de la cadena: un run que sigue llamando a herramientas sobre su oferta no está
// colgado aunque pase de su tiempo esperado; uno callado diez minutos, sí.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-latido-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';
process.env.HOME = tmp;

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { encolar } = await import('../../src/nucleo/trabajos.js');
const { registrarTipoTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { registrarUso } = await import('../../src/nucleo/agentes/auditoria.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { relanzarColgados, TIEMPO_ESPERADO_MIN } = await import('../../src/dominios/licitaciones/oferta/cadena.js');
const { TIPO_FICHA } = await import('../../src/dominios/licitaciones/ficha.js');
const { TIPO_EVALUACION } = await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');
const { TIPO_LECCIONES } = await import('../../src/dominios/licitaciones/oferta/lecciones.js');

iniciarNucleo();
const db = dbLicitaciones();
const MIN = 60_000;
const AHORA = Date.parse('2026-10-14T12:00:00Z');
const AGENTE = 'agente-prueba';
const A = 'p-latido-a';
const B = 'p-latido-b';

for (const tipo of [TIPO_FICHA, TIPO_EVALUACION, TIPO_LECCIONES]) {
  registrarTipoTrabajo(tipo, {
    destino: () => null,
    instrucciones: () => '',
    hecho: () => false,
    metricas: { agente: AGENTE, stateDb: () => null },
  });
}
for (const [id, expediente] of [
  [A, 'EXP-A/2026'],
  [B, 'EXP-B/2026'],
] as const) {
  guardarLicitacion(db, {
    ...licitacion({ titulo: id, publicada: '2026-09-20', presupuesto: 1000, limite: '2026-12-01' }),
    id,
    atom_id: `atom-${id}`,
    expediente,
  });
}

const hace = (min: number) => new Date(AHORA - min * MIN).toISOString();
const lanzar = (clave: string, tipo: string, id: string, minLanzado: number) => {
  encolar(nucleo().db, { tipo, dominio: 'licitaciones', clave, payload: { id } });
  nucleo()
    .db.prepare(
      "UPDATE trabajos_ia SET estado = 'lanzado', run_id = NULL, error = NULL, lanzado_en = ? WHERE clave = ?",
    )
    .run(hace(minLanzado), clave);
};
const latido = (recurso: string, min: number) => {
  registrarUso(nucleo().db, {
    agente: AGENTE,
    herramienta: 'licitaciones_ver',
    dominio: 'licitaciones',
    recurso,
    resultado: 'ok',
  });
  nucleo()
    .db.prepare('UPDATE auditoria_agentes SET creado_en = ? WHERE id = (SELECT MAX(id) FROM auditoria_agentes)')
    .run(hace(min));
};
const trabajo = (clave: string) =>
  nucleo().db.prepare('SELECT estado, intentos FROM trabajos_ia WHERE clave = ?').get(clave) as {
    estado: string;
    intentos: number;
  };
const limpiar = () => {
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado'").run();
  nucleo().db.prepare('DELETE FROM auditoria_agentes').run();
};

test('should_not_relaunch_a_slow_ficha_that_keeps_calling_tools_for_its_tender', () => {
  lanzar('ficha-lenta', TIPO_FICHA, A, 45);
  latido(`${A}#pliego`, 3);
  assert.equal(relanzarColgados(nucleo().db, db, [A], AHORA), 0);
  assert.equal(trabajo('ficha-lenta').estado, 'lanzado');
  limpiar();
});

test('should_relaunch_a_ficha_silent_for_ten_minutes_after_its_expected_time', () => {
  lanzar('ficha-muda', TIPO_FICHA, A, 45);
  latido(A, 15);
  assert.equal(relanzarColgados(nucleo().db, db, [A], AHORA), 1);
  assert.equal(trabajo('ficha-muda').estado, 'pendiente');
  limpiar();
});

test('should_relaunch_hung_evaluations_and_lessons_of_an_offer_in_preparation', () => {
  assert.equal(TIEMPO_ESPERADO_MIN[TIPO_EVALUACION], 20);
  assert.equal(TIEMPO_ESPERADO_MIN[TIPO_LECCIONES], 15);
  lanzar('evaluacion-colgada', TIPO_EVALUACION, A, 30);
  lanzar('lecciones-colgadas', TIPO_LECCIONES, A, 30);
  lanzar('lecciones-recientes', TIPO_LECCIONES, B, 10);
  assert.equal(relanzarColgados(nucleo().db, db, [A, B], AHORA), 2);
  assert.deepEqual(
    ['evaluacion-colgada', 'lecciones-colgadas', 'lecciones-recientes'].map((c) => trabajo(c).estado),
    ['pendiente', 'pendiente', 'lanzado'],
  );
  limpiar();
});

test('should_not_count_tool_calls_about_another_tender_as_heartbeat', () => {
  lanzar('ficha-a', TIPO_FICHA, A, 45);
  latido(B, 1);
  latido(`${B}#x`, 1);
  assert.equal(relanzarColgados(nucleo().db, db, [A], AHORA), 1);
  limpiar();
});

test('should_count_a_library_path_with_the_expediente_as_heartbeat', () => {
  lanzar('ficha-ruta', TIPO_FICHA, A, 45);
  latido('Conocimiento/Licitaciones/EXP-A/2026/pliego.pdf', 2);
  assert.equal(relanzarColgados(nucleo().db, db, [A], AHORA), 0);
  limpiar();
});

test('should_not_spend_an_attempt_when_the_chain_relaunches', () => {
  lanzar('ficha-sin-gasto', TIPO_FICHA, A, 45);
  relanzarColgados(nucleo().db, db, [A], AHORA);
  assert.deepEqual(trabajo('ficha-sin-gasto'), { estado: 'pendiente', intentos: 0 });
  limpiar();
});

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});
