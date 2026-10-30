import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claveRequisito,
  insertarMencion,
  partesComentario,
  textoBotonComentarios,
  textoMencion,
} from './comentariosFormato.js';

test('should_key_a_requirement_by_lot_and_text_without_accents', () => {
  assert.equal(
    claveRequisito({ lote: '2', descripcion: 'Certificación ISO 27001 vigente' }),
    '2:certificacion_iso_27001_vigente',
  );
  assert.equal(claveRequisito({ descripcion: 'Solvencia técnica: 3 contratos' }), '-:solvencia_tecnica_3_contratos');
  assert.equal(claveRequisito({ descripcion: 'x'.repeat(400) }).length, 200, 'cabe en el servidor');
  assert.equal(claveRequisito(null), '-:');
});

test('should_say_how_many_comments_and_how_many_are_open', () => {
  assert.equal(textoBotonComentarios([]), 'Comentar');
  assert.equal(textoBotonComentarios([{ resuelto: false }]), '1 comentario');
  assert.equal(textoBotonComentarios([{ resuelto: true }, { resuelto: false }]), '2 comentarios · 1 sin resolver');
  assert.equal(textoBotonComentarios([{ resuelto: true }, { resuelto: true }]), '2 comentarios');
});

test('should_append_a_mention_with_a_space', () => {
  assert.equal(insertarMencion('', 'Elisa Martín'), '@Elisa Martín ');
  assert.equal(insertarMencion('Mira', 'Ana'), 'Mira @Ana ');
  assert.equal(insertarMencion('Mira ', 'Ana'), 'Mira @Ana ');
});

test('should_split_a_comment_to_highlight_its_mentions', () => {
  const partes = partesComentario('@ana pérez y @Ana, mirad', [
    { id: 1, nombre: 'Ana' },
    { id: 2, nombre: 'Ana Pérez' },
  ]);
  assert.deepEqual(partes, [
    { texto: '@ana pérez', mencion: true },
    { texto: ' y ', mencion: false },
    { texto: '@Ana', mencion: true },
    { texto: ', mirad', mencion: false },
  ]);
  assert.deepEqual(partesComentario('sin nadie', []), [{ texto: 'sin nadie', mencion: false }]);
  assert.equal(textoMencion({ autor: 'Elisa', titulo: 'Formación en IA' }), 'Elisa en «Formación en IA»');
});
