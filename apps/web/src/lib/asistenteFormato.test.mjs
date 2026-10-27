import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ayudaTexto,
  cambioDeRespuesta,
  conversacion,
  estadoDocumento,
  introduccion,
  preguntaActual,
  progreso,
  textoCitas,
  tonoOpcion,
} from './asistenteFormato.js';

const P = (clave, estado = 'pendiente', extra = {}) => ({
  clave,
  estado,
  seccion: 'equipo',
  titulo: clave,
  opciones: [],
  libre: 'hermes',
  ...extra,
});

test('should_show_the_chosen_question_or_the_first_pending_one', () => {
  const ps = [P('lotes', 'hecha'), P('equipo:docent:1'), P('precio:1')];
  assert.equal(preguntaActual(ps, null).clave, 'equipo:docent:1');
  assert.equal(preguntaActual(ps, 'lotes').clave, 'lotes', 'volver a una ya respondida para cambiarla');
  assert.equal(preguntaActual(ps, 'no-existe').clave, 'equipo:docent:1');
  assert.equal(preguntaActual([P('lotes', 'hecha')], null), null, 'todo respondido');
});

test('should_introduce_how_many_decisions_are_needed', () => {
  assert.equal(
    introduccion({ total: 8, hechas: 3 }),
    'Vamos con la oferta. Para redactar todos los documentos necesito 8 decisiones. 3 ya las tengo de la ficha y de lo decidido; te pregunto el resto de una en una.',
  );
  assert.match(introduccion({ total: 8, hechas: 7 }), /te pregunto la que falta/);
  assert.match(introduccion({ total: 2, hechas: 2 }), /están tomadas/);
  assert.match(introduccion({ total: 0, hechas: 0 }), /guion/);
});

test('should_turn_the_thread_into_a_conversation_with_each_question_before_its_answer', () => {
  // Arrange
  const hilo = [
    {
      id: 1,
      pregunta: 'equipo:docent:1',
      autor: 'persona',
      tipo: 'respuesta',
      texto: 'Hay que contratarlo',
      datos: { titulo: 'Docente del lote 1' },
    },
    {
      id: 2,
      pregunta: 'incorporar:docent:1',
      autor: 'persona',
      tipo: 'respuesta',
      texto: 'Sí, como perfil a incorporar',
      datos: { titulo: 'Docente del lote 1 a incorporar' },
    },
    { id: 3, pregunta: 'incorporar:docent:1', autor: 'plataforma', tipo: 'guardado', texto: 'Hecho.', datos: {} },
    {
      id: 4,
      pregunta: 'automatico:x:-',
      autor: 'persona',
      tipo: 'libre',
      texto: 'sí, con el certificado',
      datos: { titulo: 'Horas de tutoría' },
      estado: 'interpretando',
    },
  ];

  // Act
  const c = conversacion(hilo);

  // Assert
  assert.deepEqual(
    c.map((x) => [x.quien, x.tipo]),
    [
      ['hermes', 'pregunta'],
      ['persona', 'respuesta'],
      ['hermes', 'pregunta'],
      ['persona', 'respuesta'],
      ['hermes', 'guardado'],
      ['hermes', 'pregunta'],
      ['persona', 'libre'],
      ['hermes', 'leyendo'],
    ],
  );
  assert.equal(c[0].texto, 'Docente del lote 1');
});

test('should_say_what_changing_an_answered_decision_redoes', () => {
  const hecha = P('precio:2', 'hecha', { seccion: 'precio' });
  assert.deepEqual(cambioDeRespuesta(hecha, { tipo: 'precio', lote: '2', importe: 100 }), {
    decisiones: { precio: { lote: '2' } },
  });
  assert.deepEqual(
    cambioDeRespuesta(P('dato_anexo:impuesto', 'hecha'), { tipo: 'dato_anexo', dato: 'impuesto', valor: {} }),
    { decisiones: { datos_anexo: ['impuesto'] } },
  );
  assert.deepEqual(cambioDeRespuesta(P('lotes', 'hecha'), { tipo: 'lotes', lotes: ['1'] }), { lotes: ['1'] });
  assert.equal(
    cambioDeRespuesta(P('precio:2'), { tipo: 'precio', lote: '2', importe: 100 }),
    null,
    'la primera respuesta no cambia nada hecho',
  );
  assert.equal(cambioDeRespuesta(hecha, { tipo: 'contratar', rol: 'x', lotes: [] }), null);
});

test('should_format_progress_quotes_tones_and_help', () => {
  assert.deepEqual(progreso({ total: 8, hechas: 4 }), { texto: '4 de 8', porcentaje: 50 });
  assert.deepEqual(progreso({ total: 0, hechas: 0 }), { texto: '0 de 0', porcentaje: 0 });
  assert.equal(
    textoCitas([
      { documento: 'PCAP', pagina: 13 },
      { documento: 'LCSP', pagina: null },
    ]),
    'PCAP, pág. 13 · LCSP',
  );
  assert.equal(tonoOpcion({ hermes: true, tono: 'ok' }), 'hermes');
  assert.equal(tonoOpcion({ hermes: false, tono: 'impide' }), 'impide');
  assert.deepEqual(estadoDocumento({ generado: true }), { texto: 'Generado', tono: 'ok' });
  assert.match(ayudaTexto(P('precio:1', 'pendiente', { seccion: 'precio', libre: 'codigo' })), /importe/);
  assert.equal(ayudaTexto(P('x', 'pendiente', { libre: null })), null);
});
