// Subir un pliego que falta: se guarda junto a los demás pliegos sin pisar nada,
// queda como «manual» con quién lo subió, un ZIP se reconoce por su firma aunque se llame
// «.pdf», lo repetido (mismo hash) se rechaza nombrando lo que ya estaba y una rectificación
// subida después de la ficha hace que la cadena la pida otra vez. Es el caso de CASO_E,
// cuya «Rectificación de Pliego» no estaba en los datos abiertos.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { zipSync } from 'fflate';
import { FICHA_CASO_A } from './fixtures/casoA.js';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { comoPersona, de } from '../helpers/persona.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pliegos-subida-'));
const conocimiento = path.join(tmp, 'conocimiento');
fs.mkdirSync(conocimiento);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.VAULT_PATH = conocimiento;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';
process.env.HOME = tmp;

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { guardarOperacion } = await import('../../src/nucleo/operaciones.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { carpetaPliegos } = await import('../../src/dominios/licitaciones/pliegos.js');
const { subirPliego, EVENTO_PLIEGOS } = await import('../../src/dominios/licitaciones/pliegosSubida.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { fichaPorRehacer } = await import('../../src/dominios/licitaciones/oferta/cadena.js');

iniciarNucleo();
const db = dbLicitaciones();
let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(comoPersona);
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/licitaciones`;
});
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const pdf = (texto: string) => Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Title (${texto}) >>\nendobj\n%%EOF`, 'latin1');
const archivo = (nombre: string, datos: Buffer) => ({ nombre, datos, campos: {} });
type FilaPliego = {
  url: string;
  clase: string;
  nombre: string;
  estado: string;
  ruta: string | null;
  sha256: string | null;
  origen: string;
  subido_por: string | null;
  padre_url: string | null;
};
const pliegosDe = (id: string) =>
  db
    .prepare(
      'SELECT url, clase, nombre, estado, ruta, sha256, origen, subido_por, padre_url FROM pliegos WHERE licitacion_id = ? ORDER BY rowid',
    )
    .all(id) as FilaPliego[];

function nuevaLicitacion(id: string): string {
  const l = licitacion({
    titulo: `Servicio de apoyo académico ${id}`,
    publicada: '2026-09-20',
    limite: '2026-10-30T14:00:00',
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}` });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?)",
  ).run(id, ts, ts);
  return id;
}

const carpetaDe = (id: string) =>
  carpetaPliegos(
    db,
    db.prepare('SELECT * FROM licitaciones WHERE id = ?').get(id) as Parameters<typeof carpetaPliegos>[1],
  );

test('should_save_an_uploaded_pdf_in_the_tender_folder_and_register_it_as_manual', async () => {
  // Arrange
  const id = nuevaLicitacion('p-subida-1');
  const bytes = pdf('rectificacion');
  // Act
  const r = await subirPliego(db, conocimiento, id, archivo('Rectificación de Pliego.pdf', bytes), 'Persona A');
  // Assert
  assert.equal(r.error, null);
  const ruta = path.posix.join(carpetaDe(id), 'Rectificación de Pliego.pdf');
  assert.deepEqual(r.data, { guardados: [{ nombre: 'Rectificación de Pliego.pdf', ruta }], duplicado: null });
  assert.deepEqual(fs.readFileSync(path.join(conocimiento, ruta)), bytes);
  const [p] = pliegosDe(id);
  assert.equal(p?.url, `manual:${p?.sha256}`);
  assert.deepEqual(
    [p?.origen, p?.estado, p?.clase, p?.subido_por, p?.ruta],
    ['manual', 'descargado', 'adicional', 'Persona A', ruta],
  );
  const ev = db.prepare('SELECT datos FROM eventos WHERE tipo = ? AND recurso = ?').get(EVENTO_PLIEGOS, id) as
    { datos: string } | undefined;
  assert.equal(JSON.parse(ev?.datos ?? '{}').accion, 'subido');
});

// El expediente dice quién subió cada pliego a mano (null: lo trajo la plataforma).
test('should_show_who_uploaded_a_tender_document_in_the_detail', async () => {
  // Arrange
  const id = nuevaLicitacion('p-subida-quien');
  assert.equal(
    (await subirPliego(db, conocimiento, id, archivo('Aclaraciones.pdf', pdf('aclaraciones')), 'Persona B')).error,
    null,
  );
  // Act
  const { detalle } = await import('../../src/dominios/licitaciones/oportunidades.js');
  const d = detalle(db, id);
  // Assert
  assert.equal(d.error, null);
  const pliegos = d.data!.pliegos as { nombre: string; subido_por: string | null }[];
  assert.deepEqual(
    pliegos.map((p) => [p.nombre, p.subido_por]),
    [['Aclaraciones.pdf', 'Persona B']],
  );
});

test('should_unzip_a_zip_named_pdf_by_its_signature', async () => {
  // Arrange
  const id = nuevaLicitacion('p-subida-zip');
  const zip = Buffer.from(
    zipSync({ 'PCAP.pdf': new Uint8Array(pdf('pcap')), 'Anexo I.pdf': new Uint8Array(pdf('anexo')) }),
  );
  // Act
  const r = await subirPliego(db, conocimiento, id, archivo('Pliegos.pdf', zip), 'Persona B');
  // Assert
  assert.equal(r.error, null);
  assert.equal(r.data?.guardados.length, 2);
  for (const g of r.data!.guardados)
    assert.ok(fs.readFileSync(path.join(conocimiento, g.ruta)).toString('latin1').startsWith('%PDF-'));
  const filas = pliegosDe(id);
  const padre = filas.find((f) => f.padre_url === null);
  assert.deepEqual([padre?.estado, padre?.origen, padre?.ruta], ['descomprimido', 'manual', null]);
  assert.ok(
    filas
      .filter((f) => f.padre_url === padre?.url)
      .every((f) => f.subido_por === 'Persona B' && f.estado === 'descargado'),
  );
});

test('should_reject_a_duplicate_by_hash_naming_the_existing_file', async () => {
  // Arrange
  const id = nuevaLicitacion('p-subida-dup');
  const bytes = pdf('una vez');
  await subirPliego(db, conocimiento, id, archivo('Rectificación de Pliego.pdf', bytes), 'Persona A');
  // Act
  const r = await subirPliego(db, conocimiento, id, archivo('Otra copia.pdf', bytes), 'Persona A');
  // Assert
  assert.equal(r.error?.code, 'conflicto');
  assert.equal(r.error?.message, 'Ya está: «Rectificación de Pliego.pdf»');
  assert.equal(pliegosDe(id).length, 1);
});

test('should_return_a_generic_error_without_disk_paths_when_saving_throws', async (t) => {
  // Arrange: Drive bloquea la carpeta (frontera) y el error lleva la ruta absoluta.
  const id = nuevaLicitacion('p-subida-ebusy');
  t.mock.method(db, 'prepare', () => {
    throw new Error('EBUSY: resource busy or locked, open C:/Users/x/Conocimiento/pliego.pdf');
  });

  // Act
  const r = await subirPliego(db, conocimiento, id, archivo('Anexo IV.pdf', pdf('ebusy')), 'Persona A');

  // Assert
  t.mock.restoreAll();
  assert.equal(r.error?.code, 'io_error');
  assert.doesNotMatch(r.error?.message ?? '', /EBUSY|Users|Conocimiento/);
  assert.deepEqual(pliegosDe(id), []);
});

test('should_reject_an_unsupported_extension', async () => {
  // Arrange
  const id = nuevaLicitacion('p-subida-ext');
  const png = Buffer.from('\x89PNG\r\n\x1a\nresto', 'latin1');
  // Act
  const exe = await subirPliego(db, conocimiento, id, archivo('Anexo II.exe', Buffer.from('MZ')), 'Persona A');
  const disfrazado = await subirPliego(db, conocimiento, id, archivo('Anexo II.pdf', png), 'Persona A');
  // Assert
  assert.equal(exe.error?.code, 'invalid_input');
  assert.equal(disfrazado.error?.code, 'invalid_input', 'lo que dicen los bytes manda sobre el nombre');
  assert.deepEqual(pliegosDe(id), []);
});

test('should_never_overwrite_an_existing_file', async () => {
  // Arrange
  const id = nuevaLicitacion('p-subida-pisar');
  const carpeta = path.join(conocimiento, carpetaDe(id));
  fs.mkdirSync(carpeta, { recursive: true });
  const ajeno = pdf('puesto a mano en Drive');
  fs.writeFileSync(path.join(carpeta, 'Anexo III.pdf'), ajeno);
  // Act
  const r = await subirPliego(db, conocimiento, id, archivo('Anexo III.pdf', pdf('el subido')), 'Persona A');
  // Assert
  assert.equal(r.error, null);
  assert.equal(path.posix.basename(r.data!.guardados[0]!.ruta), 'Anexo III-1.pdf');
  assert.deepEqual(fs.readFileSync(path.join(carpeta, 'Anexo III.pdf')), ajeno, 'el que ya estaba sigue igual');
});

test('should_trigger_ficha_redo_when_the_upload_is_a_rectification', async () => {
  // Arrange
  const id = nuevaLicitacion('p-subida-ficha');
  assert.equal((await proponerFicha(db, FichaEntrada.parse({ ...FICHA_CASO_A, id }), 'licitaciones')).error, null);
  const haceDos = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  db.prepare('UPDATE fichas SET creada_en = ?, actualizada_en = ?, revisada_en = ? WHERE licitacion_id = ?').run(
    haceDos,
    haceDos,
    haceDos,
    id,
  );
  assert.equal(fichaPorRehacer(db, id), null, 'antes de subirla, la ficha vale');
  // Act
  const r = await subirPliego(
    db,
    conocimiento,
    id,
    archivo('Rectificación de Pliego.pdf', pdf('rectifica')),
    'Persona A',
  );
  // Assert
  assert.equal(r.error, null);
  assert.match(fichaPorRehacer(db, id) ?? '', /^ficha-auto-p-subida-ficha-v\d+-p1$/);
});

test('should_answer_201_then_409_when_the_same_rectification_is_uploaded_twice_through_the_api', async () => {
  // Arrange
  const id = nuevaLicitacion('p-91000080');
  guardarOperacion(nucleo().db, 'licitaciones.carpetas', 'hecha', {});
  const enviar = () => {
    const f = new FormData();
    f.append('archivo', new Blob([pdf('CASO_E rectificación')]), 'Rectificación de Pliego.pdf');
    return fetch(`${base}/licitaciones/${id}/pliegos`, { method: 'POST', body: f, headers: de('Persona C') });
  };
  // Act
  const primera = await enviar();
  const segunda = await enviar();
  // Assert
  assert.equal(primera.status, 201);
  const cuerpo = (await primera.json()) as { indexacion: string; guardados: { nombre: string }[] };
  assert.equal(cuerpo.indexacion, 'en_cola');
  assert.equal(cuerpo.guardados[0]?.nombre, 'Rectificación de Pliego.pdf');
  assert.equal(pliegosDe(id)[0]?.subido_por, 'Persona C');
  assert.equal(segunda.status, 409);
  assert.match(((await segunda.json()) as { message: string }).message, /^Ya está: «Rectificación de Pliego\.pdf»$/);
});
