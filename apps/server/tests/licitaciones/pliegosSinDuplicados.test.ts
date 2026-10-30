// Pliegos sin duplicados: un mismo archivo bajado (misma ruta) sale una sola vez en el detalle,
// con todas sus clases y los otros nombres con que se publicó. P. ej. en CASO_E: «2 - BASES…»
// llegó como pcap y como ppt, y «Composición de la mesa» era el mismo archivo que el
// «Documento de aprobación del expediente».
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pliegos-sin-duplicados-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { detalle } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { licitacion } = await import('../helpers/sinteticas.js');

iniciarNucleo();
const db = dbLicitaciones();
const lic = licitacion({ titulo: 'Servicios de formación', publicada: '2026-09-24', limite: '2026-10-15T08:00:00' });
guardarLicitacion(db, lic);

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => db.exec('DELETE FROM pliegos'));

const CARPETA = 'Licitaciones/Radar/2026/17-26 (p-1)';
const BASES = 'Pliego regulador del servicio.pdf';
const APROBACION = 'Documento de aprobación del expediente 24-09-2026 0928';

function pliego(url: string, clase: string, nombre: string, ruta: string | null, estado = 'descargado'): void {
  db.prepare(
    `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, ?, ?, ?, ?, '2026-09-25T10:00:00Z')`,
  ).run(lic.id, url, clase, nombre, estado, ruta);
}

function pliegosDelDetalle(): Record<string, unknown>[] {
  const d = detalle(db, lic.id);
  assert.equal(d.error, null);
  return d.data!.pliegos;
}

test('should_list_same_file_once_with_both_classes', () => {
  pliego('u1', 'pcap', BASES, `${CARPETA}/${BASES}`);
  pliego('u2', 'ppt', BASES, `${CARPETA}/${BASES}`);
  pliego('u3', 'anuncio', 'Anuncio de Licitación.pdf', `${CARPETA}/Anuncio de Licitación.pdf`);

  const pliegos = pliegosDelDetalle();

  assert.equal(pliegos.length, 2);
  assert.equal(pliegos.filter((p) => p['nombre'] === BASES).length, 1);
  assert.deepEqual(pliegos[0]?.['clases'], ['pcap', 'ppt']);
  assert.equal(pliegos[0]?.['clase'], 'pcap', 'la primera fila se queda');
  assert.deepEqual(pliegos[0]?.['tambien_como'], [], 'mismo nombre: no se repite');
  assert.deepEqual(pliegos[1]?.['clases'], ['anuncio']);
});

test('should_keep_other_names_of_the_same_file_as_also_published_as', () => {
  const ruta = `${CARPETA}/${APROBACION}.pdf`;
  pliego('u1', 'otro', APROBACION, ruta);
  pliego('u2', 'otro', 'Composición de la mesa de contratación 24-09-2026 0929', ruta);

  const pliegos = pliegosDelDetalle();

  assert.equal(pliegos.length, 1);
  assert.equal(pliegos[0]?.['nombre'], APROBACION);
  assert.deepEqual(pliegos[0]?.['clases'], ['otro']);
  assert.deepEqual(pliegos[0]?.['tambien_como'], ['Composición de la mesa de contratación 24-09-2026 0929']);
});

test('should_keep_pending_rows_without_path', () => {
  pliego('u1', 'pcap', 'Pliego administrativo.pdf', null, 'pendiente');
  pliego('u2', 'ppt', 'Pliego técnico.pdf', null, 'error');
  pliego('u3', 'pcap', BASES, `${CARPETA}/${BASES}`);

  const pliegos = pliegosDelDetalle();

  assert.equal(pliegos.length, 3);
  assert.deepEqual(
    pliegos.map((p) => p['estado']),
    ['pendiente', 'error', 'descargado'],
  );
  assert.equal('clases' in pliegos[0]!, false, 'lo no bajado sale tal cual');
});
