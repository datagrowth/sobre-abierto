import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  errorArchivoPresentada,
  memoriaPresentada,
  rutasPresentada,
  textoBotonPresentada,
  textoSubidaPresentada,
} from './memoriaPresentadaFormato.js';

test('should_accept_only_pdf_or_docx_up_to_30_mb', () => {
  assert.equal(errorArchivoPresentada({ name: 'Memoria CASO_E.PDF', size: 1000 }), null);
  assert.equal(errorArchivoPresentada({ name: 'memoria.docx', size: 1000 }), null);
  assert.equal(errorArchivoPresentada({ name: 'memoria.doc', size: 1000 }), 'Solo PDF o Word (.docx).');
  assert.equal(errorArchivoPresentada({ name: 'sin-extension', size: 1000 }), 'Solo PDF o Word (.docx).');
  assert.equal(errorArchivoPresentada({ name: 'memoria.pdf', size: 31 * 1024 * 1024 }), 'El archivo pasa de 30 MB.');
  assert.match(errorArchivoPresentada(null), /Elige/);
});

test('should_find_the_current_presentada_and_its_links', () => {
  const m = {
    id: 2,
    presentada: true,
    borrador: { ruta: 'Salidas/x/a.docx', ruta_pdf: 'Salidas/x/a.pdf', ruta_md: 'Salidas/x/a.md' },
  };
  assert.equal(memoriaPresentada([{ id: 1, presentada: false, presentada_sustituida: true }, m]), m);
  assert.equal(memoriaPresentada([]), null);
  assert.deepEqual(rutasPresentada(m), ['Salidas/x/a.docx', 'Salidas/x/a.pdf', 'Salidas/x/a.md']);
  assert.deepEqual(rutasPresentada({ borrador: null }), []);
});

test('should_say_how_the_presentada_was_stored', () => {
  assert.equal(
    textoSubidaPresentada({
      version: 4,
      reconocidos: 0,
      total: 5,
      evalua: true,
      aprende: false,
      sustituye: null,
      avisos: [],
    }),
    'Subida como la memoria presentada (v4), guardada entera. Hermes la evalúa.',
  );
  assert.equal(
    textoSubidaPresentada({
      version: 5,
      reconocidos: 3,
      total: 5,
      evalua: true,
      aprende: true,
      sustituye: 4,
      avisos: ['Ojo.'],
    }),
    'Subida como la memoria presentada (v5), repartida en 3 de 5 apartados. Sustituye a la presentada anterior, que queda en el historial. Hermes la evalúa y saca lecciones. Ojo.',
  );
});

test('should_name_the_lot_when_uploading_the_submitted_memory_of_a_lot', () => {
  assert.equal(textoBotonPresentada('4', true), 'Subir la memoria presentada del lote 4 (PDF o Word)');
});

test('should_say_the_top_upload_is_common_to_every_lot_only_with_one_memory_per_lot', () => {
  assert.equal(textoBotonPresentada(null, true), 'Subir una memoria presentada común a todos los lotes (PDF o Word)');
  assert.equal(textoBotonPresentada(), 'Subir la memoria presentada (PDF o Word)');
});
