// Búsqueda de notas: una pregunta en lenguaje natural debe encontrar notas (no tratarse
// como subcadena literal) y las tildes no deben importar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-busqueda-'));
process.env.VAULT_PATH = tmp;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.NODE_ENV = 'test';

const notas: Record<string, string> = {
  'metodologia/Método de trabajo.md': '# Método de trabajo\n\nNotas breves y enlazadas para ganar productividad.\n',
  'metodologia/Captura ubicua.md': '# Captura ubicua\n\nCapturar ideas rápidas en cualquier momento.\n',
  'negocio/Cliente ideal.md': '---\ntags: [negocio]\n---\n\n# Cliente ideal\n\nA quién ofrecemos el servicio.\n',
};
for (const [relativa, contenido] of Object.entries(notas)) {
  const absoluta = path.join(tmp, relativa);
  fs.mkdirSync(path.dirname(absoluta), { recursive: true });
  fs.writeFileSync(absoluta, contenido, 'utf8');
}

const { buscarNotas } = await import('../../src/biblioteca/motor/busqueda.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('should_find_notes_with_a_natural_language_question', async () => {
  const pregunta = await buscarNotas('qué notas tengo sobre productividad');

  assert.ok(pregunta.length > 0, `obtuve ${pregunta.length}`);
});

test('should_find_notes_with_a_single_word', async () => {
  const palabra = await buscarNotas('productividad');

  assert.ok(palabra.length > 0, `obtuve ${palabra.length}`);
});

test('should_return_at_least_as_many_results_for_a_question_as_for_its_keyword', async () => {
  const pregunta = await buscarNotas('qué notas tengo sobre productividad');
  const palabra = await buscarNotas('productividad');

  assert.ok(pregunta.length >= palabra.length, `pregunta=${pregunta.length} palabra=${palabra.length}`);
});

test('should_find_the_note_that_answers_a_second_natural_question', async () => {
  const resultados = await buscarNotas('cómo capturar ideas rápidas');

  assert.ok(resultados.some((r) => r.path === 'metodologia/Captura ubicua.md'));
});

test('should_ignore_accents_when_searching', async () => {
  const conTilde = await buscarNotas('método');
  const sinTilde = await buscarNotas('metodo');

  assert.ok(conTilde.length > 0);
  assert.equal(sinTilde.length, conTilde.length, `con=${conTilde.length} sin=${sinTilde.length}`);
});
