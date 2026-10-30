import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultaAlOrgano, dondeCita, estadoPregunta, sePuedePasar } from './preguntasPliegoFormato.js';

const p = (x) => ({
  id: 1,
  pregunta: '¿Piden ENS?',
  estado: 'respondida',
  dice: true,
  respuesta: 'Sí.',
  cita: null,
  en_comprobaciones: false,
  ...x,
});

test('should_say_not_checked_unless_the_quote_was_found_literally', () => {
  assert.deepEqual(estadoPregunta(p({ cita: { texto: 'x', documento: 'a/PCAP.pdf', pagina: 4, comprobada: true } })), {
    texto: 'Cita comprobada',
    tono: 'ok',
  });
  assert.deepEqual(estadoPregunta(p({ cita: { texto: 'x', documento: null, pagina: null, comprobada: false } })), {
    texto: 'No comprobada',
    tono: 'riesgo',
  });
  assert.equal(estadoPregunta(p({ dice: false })).texto, 'Hermes no lo encontró en el pliego (no comprobado)');
  assert.equal(estadoPregunta(p({ estado: 'pendiente' })).tono, 'hermes');
  assert.match(estadoPregunta(p({ estado: 'fallida' })).texto, /vuelve a preguntarlo/);
});

test('should_name_the_document_and_page_of_the_quote', () => {
  assert.equal(dondeCita({ documento: 'Licitaciones/p-1/PPT.pdf', pagina: 3 }), 'PPT.pdf, pág. 3');
  assert.equal(dondeCita({ documento: 'PPT.pdf', pagina: null }), 'PPT.pdf');
  assert.equal(dondeCita({ documento: null, pagina: null }), null);
  assert.equal(dondeCita(null), null);
});

test('should_draft_the_query_to_the_contracting_body_as_a_question', () => {
  const t = consultaAlOrgano(p({ pregunta: 'Se puede subcontratar la formación' }), {
    expediente: '12/2026',
    titulo: 'Formación en IA',
  });
  assert.match(t, /^Asunto: consulta sobre el expediente 12\/2026/);
  assert.match(t, /\n¿se puede subcontratar la formación\?\n/);
  assert.match(consultaAlOrgano(p({ pregunta: '¿Piden ENS??' }), { expediente: '1', titulo: 't' }), /\n¿piden ENS\?\n/);
});

test('should_only_pass_answered_questions_to_the_comprobaciones', () => {
  assert.equal(sePuedePasar(p({})), true);
  assert.equal(sePuedePasar(p({ estado: 'pendiente' })), false);
});
