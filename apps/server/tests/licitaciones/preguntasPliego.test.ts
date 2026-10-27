// Preguntar al pliego sobre el caso A: la pregunta va a la cola con prioridad alta, Hermes
// responde con la cita literal (comprobada en los pliegos o no) o «el pliego no lo dice», y una
// persona la puede pasar a las comprobaciones.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, base, cerrar, db, ID, nucleo } from '../helpers/memoriaEntorno.js';

const {
  preguntasDe,
  responderPregunta,
  preguntarAlPliego,
  pasarAComprobaciones,
  TIPO_PREGUNTA_PLIEGO,
  instruccionesPregunta,
} = await import('../../src/dominios/licitaciones/preguntasPliego.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');

before(arrancar);
after(cerrar);

const limpiar = () => {
  db.exec('DELETE FROM preguntas_pliego');
  nucleo().db.prepare('DELETE FROM trabajos_ia WHERE tipo = ?').run(TIPO_PREGUNTA_PLIEGO);
};
const preguntar = (texto: string) => preguntarAlPliego(db, nucleo().db, ID, { pregunta: texto }, 'Ana').data!;

test('should_queue_the_question_from_the_web', async () => {
  // Arrange
  limpiar();

  // Act
  const res = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/preguntas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pregunta: '¿En qué horario hay que atender las consultas?' }),
  });

  // Assert
  assert.equal(res.status, 202);
  const p = (await res.json()) as { id: number; estado: string };
  assert.equal(p.estado, 'pendiente');
  // La prioridad (0, delante de todo) la comprueba prioridadCola.test.ts con el resto de tipos.
  const t = nucleo().db.prepare('SELECT payload FROM trabajos_ia WHERE tipo = ?').get(TIPO_PREGUNTA_PLIEGO) as {
    payload: string;
  };
  assert.deepEqual(JSON.parse(t.payload), { id: ID, pregunta: p.id });
  assert.match(
    instruccionesPregunta(db, { id: ID, pregunta: p.id }),
    /licitaciones_pliego_responder \(id=.*, pregunta=\d+\)/,
  );
});

test('should_reject_an_empty_question', () => {
  const r = preguntarAlPliego(db, nucleo().db, ID, { pregunta: '¿?' }, 'Ana');
  assert.equal(r.error?.code, 'invalid_input');
});

test('should_check_the_quote_literally_in_the_tender_documents', () => {
  // Arrange
  limpiar();
  const p = preguntar('¿Cuánto tiempo hay para responder una consulta?');

  // Act
  const r = responderPregunta(
    db,
    {
      id: ID,
      pregunta: p.id,
      dice: true,
      respuesta: 'Como mucho 48 horas.',
      cita: 'respuesta en un máximo de 48 horas',
    },
    'licitaciones',
  );

  // Assert
  assert.equal(r.error, null);
  assert.equal(r.data!.estado, 'respondida');
  assert.deepEqual([r.data!.cita?.comprobada, r.data!.cita?.pagina], [true, 3]);
  assert.match(r.data!.cita!.documento!, /PPT\.pdf$/);
  assert.equal(
    responderPregunta(db, { id: ID, pregunta: p.id, dice: false, respuesta: 'otra' }, 'x').error?.code,
    'conflicto',
    'una vez respondida no se pisa',
  );
});

test('should_mark_an_invented_quote_as_not_checked', () => {
  limpiar();
  const p = preguntar('¿Piden el ENS?');
  const r = responderPregunta(
    db,
    {
      id: ID,
      pregunta: p.id,
      dice: true,
      respuesta: 'Sí, categoría media.',
      cita: 'el adjudicatario acreditará el ENS de categoría media',
    },
    'licitaciones',
  );
  assert.deepEqual([r.data!.cita?.comprobada, r.data!.cita?.pagina], [false, null]);
});

test('should_ask_for_a_quote_when_the_tender_says_it', () => {
  limpiar();
  const p = preguntar('¿Hay formación al personal?');
  assert.equal(
    responderPregunta(db, { id: ID, pregunta: p.id, dice: true, respuesta: 'Sí.' }, 'x').error?.code,
    'invalid_input',
  );
  const r = responderPregunta(db, { id: ID, pregunta: p.id, dice: false, respuesta: 'El pliego no lo dice.' }, 'x');
  assert.deepEqual([r.data!.dice, r.data!.cita], [false, null]);
});

test('should_close_a_question_whose_job_failed', () => {
  limpiar();
  const p = preguntar('¿Se puede subcontratar la formación?');
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'fallido' WHERE tipo = ?").run(TIPO_PREGUNTA_PLIEGO);
  assert.equal(preguntasDe(db, ID).find((x) => x.id === p.id)?.estado, 'fallida');
});

test('should_turn_an_answer_into_a_comprobaciones_risk_and_back', () => {
  // Arrange
  limpiar();
  const p = preguntar('¿Hay que hacer una reunión mensual?');
  assert.equal(
    pasarAComprobaciones(db, ID, p.id, { en_comprobaciones: true }).error?.code,
    'conflicto',
    'sin respuesta no se pasa',
  );
  responderPregunta(db, { id: ID, pregunta: p.id, dice: false, respuesta: 'El pliego no lo dice.' }, 'x');

  // Act
  pasarAComprobaciones(db, ID, p.id, { en_comprobaciones: true });
  const fila = comprobacionesDe(db, nucleo().db, ID).data!.bloqueos.find(
    (b) => b.clave === `pregunta_pliego:-:${p.id}`,
  );

  // Assert
  assert.equal(fila?.gravedad, 'riesgo');
  assert.equal(fila?.accion.tipo, 'consulta_organo');
  assert.equal(
    fila?.titulo,
    '«¿Hay que hacer una reunión mensual?» Hermes no lo encontró en el pliego (no comprobado)',
  );
  pasarAComprobaciones(db, ID, p.id, { en_comprobaciones: false });
  assert.equal(
    comprobacionesDe(db, nucleo().db, ID).data!.bloqueos.some((b) => b.clave.startsWith('pregunta_pliego')),
    false,
  );
});
