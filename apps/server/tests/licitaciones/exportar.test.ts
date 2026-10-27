// Exportación CSV de los listados: cada uno con las filas de su vista, entero
// aunque pase de una página, y servido como descarga para Excel.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exportar-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { csvOportunidades, csvPipeline, csvPresentadas } = await import('../../src/dominios/licitaciones/exportar.js');
const { FiltroRevision } = await import('../../src/dominios/licitaciones/revision.js');
const { licitacion } = await import('../helpers/sinteticas.js');

iniciarNucleo();
const db = dbLicitaciones();
let server: http.Server;
let base = '';
before(() => {
  const app = express();
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-23T08:00:00Z');
function oportunidad(titulo: string, estado: string, presupuesto = 48_250.5): string {
  const l = licitacion({ titulo, publicada: '2026-10-01', limite: '2026-11-12T14:00:00', presupuesto });
  guardarLicitacion(db, l);
  db.prepare('INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, ?, ?, ?)').run(
    l.id,
    estado,
    '2026-10-02T10:00:00Z',
    'x',
  );
  return l.id;
}

const filas = (csv: string) =>
  csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n');

test('should_export_the_pipeline_with_its_column_and_spanish_numbers', () => {
  // Arrange
  oportunidad('Servicio de cuadros de mando de movilidad', 'en_preparacion');

  // Act
  const [cabecera, primera] = filas(csvPipeline(db, AHORA));

  // Assert
  assert.equal(
    cabecera,
    'Estado;Expediente;Título;Título corto;Órgano;Responsable;Importe (€ sin IVA);Cierre (hora peninsular);Resultado',
  );
  assert.match(primera!, /^En preparación;.*;Cuadros de mando de movilidad;.*;48250,5;2026-11-12 14:00;$/);
});

test('should_export_every_opportunity_of_the_tab_beyond_one_page', () => {
  // Arrange
  for (let i = 0; i < 120; i += 1) oportunidad(`Formación en datos número ${i}`, 'nueva');

  // Act
  const lineas = filas(csvOportunidades(db, FiltroRevision.parse({ pestana: 'por_revisar' }), AHORA));

  // Assert
  assert.equal(lineas.length, 1 + 120, 'cabecera y las 120, no solo las 100 de una página');
  assert.match(lineas[0]!, /^Expediente;Título;Órgano;Procedimiento;Importe/);
});

test('should_export_presented_offers_with_the_bid_drop_as_percentage', () => {
  // Arrange
  const id = oportunidad('Talleres de competencias digitales', 'presentada', 40_000);
  db.prepare(
    `INSERT INTO propuestas (licitacion_id, lote, presentada_en, importe_ofertado, presupuesto, baja_ofertada, documentos, resultado, notas, lecciones, creada_en, actualizada_en)
    VALUES (?, '', '2026-10-10', 36600, 40000, 0.085, '[]', 'ganada', '', '', 'x', 'x')`,
  ).run(id);

  // Act
  const [, fila] = filas(csvPresentadas(db));

  // Assert
  assert.match(fila!, /^2026-10-10;.*;Talleres de competencias digitales;.*;;36600;40000;8,5%;Ganada;/);
  assert.equal(
    filas(csvPresentadas(db, { resultado: 'perdida' })).length,
    1,
    'con el filtro de la vista: solo la cabecera',
  );
});

test('should_serve_the_csv_as_an_attachment_and_reject_a_bad_filter', async () => {
  // Act
  const r = await fetch(`${base}/api/licitaciones/revision.csv?pestana=por_revisar`);
  const malo = await fetch(`${base}/api/licitaciones/revision.csv?pestana=inventada`);
  const competidores = await fetch(`${base}/api/licitaciones/competidores.csv`);

  // Assert
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /^text\/csv; charset=utf-8/);
  assert.match(
    r.headers.get('content-disposition') ?? '',
    /^attachment; filename="oportunidades-por-revisar-\d{4}-\d{2}-\d{2}\.csv"$/,
  );
  assert.equal(malo.status, 400);
  assert.equal(competidores.status, 200);
  const bytes = Buffer.from(await competidores.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'el BOM llega en los bytes (text() lo quitaría)');
  assert.match(bytes.toString('utf8'), /^\uFEFFNIF;Empresa;Contratos ganados/);
});
