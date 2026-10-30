// Rutas de Salidas con los importes ofertados, que salidas_listar y salidas_leer no enseñan:
// VALORES_A_TECLEAR.md, en el paquete la carpeta del archivo económico (o solo la proposición si
// comparte archivo con la memoria), los documentos económicos de la checklist y sus anexos.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GUION_CASO_A, ID, licitacionCasoA, otraLicitacion } from './fixtures/casoA.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rutas-importes-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { rutaConImportes } = await import('../../src/dominios/licitaciones/oferta/rutasConImportes.js');

iniciarNucleo();
const db = dbLicitaciones();
const ts = new Date().toISOString();
const UNICO = 'p-77000001';
const CARPETA = `Salidas/Licitaciones/EXP-2026-0412 (${ID})`;
const CARPETA_UNICO = `Salidas/Licitaciones/77000001-2026 (${UNICO})`;
const ARCHIVO_1 = 'Archivo electrónico nº 1';
const ARCHIVO_2 = 'Archivo electrónico nº 2';

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function guardarGuion(id: string, datos: unknown): number {
  return Number(
    db
      .prepare(
        'INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, ?, 1, ?)',
      )
      .run(id, JSON.stringify(GuionBase.parse(datos)), 'test', ts).lastInsertRowid,
  );
}

// Un solo archivo para todo: la memoria y la proposición económica van juntas.
function guionDeArchivoUnico() {
  const g = structuredClone(GUION_CASO_A);
  g.archivos[0]!.documentos.push(...(g.archivos[1]!.documentos as never[]));
  g.archivos.pop();
  g.automaticos = g.automaticos.map((a) => ({ ...a, archivo: ARCHIVO_1 }));
  g.oferta_economica = { ...g.oferta_economica, archivo: ARCHIVO_1 };
  return g;
}

const doc = (orden: number, clave: string, archivo: string) => ({
  orden,
  nombre: archivo,
  clave,
  archivo,
  origen: 'x',
  sha256: '0'.repeat(64),
  bytes: 1,
  estado_checklist: 'preparado',
  firma: 'pendiente',
});
const carpeta = (ruta: string, archivo: string, documentos: ReturnType<typeof doc>[]) => ({
  ruta,
  lote: null,
  archivo,
  firma: null,
  documentos,
});

function guardarPaquete(id: string, guionId: number, ruta: string, carpetas: ReturnType<typeof carpeta>[]): void {
  const m = {
    licitacion: { id, expediente: 'x', titulo: 'x', organo: 'x' },
    version: 1,
    generado_en: ts,
    guion: { id: guionId, version: 1 },
    decisiones_en: null,
    plazo: { fecha_limite: null, texto: null, canal: null },
    lotes: [],
    carpetas,
    valores: [],
    comprobaciones: [],
  };
  db.prepare(
    'INSERT INTO paquetes_presentacion (licitacion_id, version, ruta, guion_id, manifiesto, bloqueos, avisos, creado_en) VALUES (?, 1, ?, ?, ?, 0, 0, ?)',
  ).run(id, ruta, guionId, JSON.stringify(m), ts);
}

guardarLicitacion(db, licitacionCasoA());
guardarLicitacion(db, otraLicitacion(UNICO));
const g = guardarGuion(ID, GUION_CASO_A);
const gUnico = guardarGuion(UNICO, guionDeArchivoUnico());
const V1 = `${CARPETA}/PRESENTACION/v1 2026-10-14 10.00`;
const V1_UNICO = `${CARPETA_UNICO}/PRESENTACION/v1 2026-10-14 10.00`;
guardarPaquete(ID, g, V1, [
  carpeta(`1 ${ARCHIVO_1}`, ARCHIVO_1, [doc(1, 'a1-d1', '01 DEUC.pdf')]),
  carpeta(`2 ${ARCHIVO_2}`, ARCHIVO_2, [doc(1, 'a2-d1', '01 Anexo VII. Proposición económica.pdf')]),
]);
guardarPaquete(UNICO, gUnico, V1_UNICO, [
  carpeta(`1 ${ARCHIVO_1}`, ARCHIVO_1, [
    doc(1, 'a1-d1', '01 DEUC.pdf'),
    doc(2, 'a1-d7', '02 Anexo VII. Proposición económica.pdf'),
  ]),
]);

test('should_hide_valores_a_teclear_anywhere', () => {
  assert.equal(rutaConImportes(db, `${V1}/VALORES_A_TECLEAR.md`), true);
  assert.equal(rutaConImportes(db, 'Salidas/Otra carpeta/valores_a_teclear.md'), true);
});

test('should_hide_the_whole_economic_folder_of_a_package', () => {
  assert.equal(rutaConImportes(db, `${V1}/2 ${ARCHIVO_2}/01 Anexo VII. Proposición económica.pdf`), true);
  assert.equal(rutaConImportes(db, `${V1}/2 ${ARCHIVO_2}/00 Índice.docx`), true, 'también el índice del sobre');
});

test('should_show_the_rest_of_the_package', () => {
  assert.equal(rutaConImportes(db, `${V1}/1 ${ARCHIVO_1}/01 DEUC.pdf`), false);
  assert.equal(rutaConImportes(db, `${V1}/INSTRUCCIONES.md`), false);
  assert.equal(rutaConImportes(db, `${CARPETA}/memoria-v1.docx`), false);
});

test('should_hide_only_the_economic_document_when_it_shares_the_folder_with_the_memory', () => {
  assert.equal(rutaConImportes(db, `${V1_UNICO}/1 ${ARCHIVO_1}/02 Anexo VII. Proposición económica.pdf`), true);
  assert.equal(rutaConImportes(db, `${V1_UNICO}/1 ${ARCHIVO_1}/01 DEUC.pdf`), false);
});

test('should_hide_every_version_of_a_filled_economic_annex', () => {
  assert.equal(rutaConImportes(db, `${CARPETA}/anexos/Anexo VII. Proposición económica-v1.pdf`), true);
  assert.equal(rutaConImportes(db, `${CARPETA}/anexos/Anexo VII. Proposición económica-v2.docx`), true);
  assert.equal(rutaConImportes(db, `${CARPETA}/anexos/Anexo XIII. Declaración responsable-v1.docx`), false);
});

test('should_hide_an_economic_checklist_document_uploaded_elsewhere', () => {
  // Arrange
  const subida = 'Salidas/Subidas a mano/proposicion firmada.pdf';
  db.prepare(
    "INSERT INTO oferta_documentos (licitacion_id, clave, nombre, estado, ruta, actualizado_en) VALUES (?, 'a2-d1', 'Anexo VII', 'preparado', ?, ?)",
  ).run(ID, subida, ts);
  db.prepare(
    "INSERT INTO oferta_documentos (licitacion_id, clave, nombre, estado, ruta, actualizado_en) VALUES (?, 'a1-d1', 'DEUC', 'preparado', ?, ?)",
  ).run(ID, 'Salidas/Subidas a mano/deuc.pdf', ts);
  // Act y Assert
  assert.equal(rutaConImportes(db, subida), true);
  assert.equal(rutaConImportes(db, 'Salidas/Subidas a mano/deuc.pdf'), false);
});

test('should_hide_a_package_version_whose_manifest_cannot_be_read', () => {
  // Arrange
  const v2 = `${CARPETA}/PRESENTACION/v2 2026-10-14 11.00`;
  db.prepare(
    "INSERT INTO paquetes_presentacion (licitacion_id, version, ruta, guion_id, manifiesto, bloqueos, avisos, creado_en) VALUES (?, 2, ?, ?, '{roto', 0, 0, ?)",
  ).run(ID, v2, g, ts);
  // Act y Assert: sin poder comprobarlo, no se enseña.
  assert.equal(rutaConImportes(db, `${v2}/1 ${ARCHIVO_1}/01 DEUC.pdf`), true);
});
