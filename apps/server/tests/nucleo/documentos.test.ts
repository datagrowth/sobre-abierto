// Documentos bajados por los dominios: nunca se pisa un archivo ajeno, el mismo
// archivo no se duplica y todo queda registrado en nucleo.documentos.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { guardarDocumentoNuevo } from '../../src/nucleo/documentos.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-nucleo-'));
const raiz = path.join(tmp, 'conocimiento');
const db = abrirNucleo(path.join(tmp, 'datos'));

after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const origen = {
  dominio: 'licitaciones',
  origenUrl: 'https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?DocumentIdParam=1',
};
const doc = (rel: string, texto: string) => ({ rel, bytes: Buffer.from(texto), ...origen });

test('should_write_and_register_a_new_document', async () => {
  const r = await guardarDocumentoNuevo(db, raiz, doc('Licitaciones/Radar/2026/a/bases.pdf', 'uno'));
  assert.equal(r.error, null);
  assert.equal(r.data?.ruta, 'Licitaciones/Radar/2026/a/bases.pdf');
  assert.equal(r.data?.nuevo, true);
  const fila = db
    .prepare('SELECT dominio, bytes FROM documentos WHERE ruta = ?')
    .get('Licitaciones/Radar/2026/a/bases.pdf');
  assert.deepEqual({ ...(fila as object) }, { dominio: 'licitaciones', bytes: 3 });
});

test('should_reuse_the_same_file_and_never_overwrite_another', async () => {
  const mismo = await guardarDocumentoNuevo(db, raiz, doc('Licitaciones/Radar/2026/a/bases.pdf', 'uno'));
  assert.deepEqual(mismo.data, {
    ruta: 'Licitaciones/Radar/2026/a/bases.pdf',
    sha256: mismo.data?.sha256,
    nuevo: false,
  });
  fs.writeFileSync(path.join(raiz, 'Licitaciones/Radar/2026/a/ajeno.pdf'), 'de una persona');
  const otro = await guardarDocumentoNuevo(db, raiz, doc('Licitaciones/Radar/2026/a/ajeno.pdf', 'dos'));
  assert.equal(otro.data?.ruta, 'Licitaciones/Radar/2026/a/ajeno-1.pdf');
  assert.equal(fs.readFileSync(path.join(raiz, 'Licitaciones/Radar/2026/a/ajeno.pdf'), 'utf8'), 'de una persona');
});
