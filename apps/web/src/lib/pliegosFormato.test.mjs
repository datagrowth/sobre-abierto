import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorArchivo, etiquetaOrigen, subidosSinIndexar, textoTrasSubir } from './pliegosFormato.js';

test('should_say_indexed_and_redo_message_after_upload', () => {
  assert.equal(textoTrasSubir({ indexado: false }), 'Subido · indexándose…');
  assert.equal(textoTrasSubir({ indexado: true }), 'indexado ✓ · si es una rectificación, la ficha se rehace sola');
  assert.match(textoTrasSubir({ indexado: false, duplicado: 'a.pdf' }), /Ya estaba subido/);
});

test('should_reject_files_with_wrong_extension_or_too_big', () => {
  assert.match(errorArchivo({ name: 'x.exe', size: 1 }), /formato/);
  assert.match(errorArchivo({ name: 'x.pdf', size: 61 * 1024 * 1024 }), /60 MB/);
  assert.equal(errorArchivo({ name: 'X.PDF', size: 10 }), null);
  assert.ok(errorArchivo(null));
});

test('should_label_manual_uploads_with_who_uploaded_them', () => {
  assert.equal(etiquetaOrigen({ origen: 'manual', subido_por: 'Ana' }), 'Subido a mano por Ana');
  assert.equal(etiquetaOrigen({ origen: 'manual', subido_por: 'web' }), 'Subido a mano por la web');
  assert.equal(etiquetaOrigen({ origen: 'feed' }), null);
});

test('should_count_manual_uploads_not_yet_indexed', () => {
  assert.equal(
    subidosSinIndexar([{ origen: 'manual' }, { origen: 'manual', estado_indice: 'ok' }, { origen: 'feed' }]),
    1,
  );
  assert.equal(subidosSinIndexar([]), 0);
});
