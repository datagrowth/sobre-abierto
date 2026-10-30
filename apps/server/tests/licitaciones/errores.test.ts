// Errores de procesamiento: lo que el proceso automático ya no saca adelante sale en «Errores»
// con su motivo (y deja de contar en «Nuevas»); al arreglarse o reintentarlo, vuelve a su sitio.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo, type Db as DbNucleo } from '../../src/nucleo/db.js';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import { Filtro, listarOportunidades } from '../../src/dominios/licitaciones/oportunidades.js';
import { reintentarProceso, revisarErrores } from '../../src/dominios/licitaciones/errores.js';
import type { Legibilidad } from '../../src/dominios/licitaciones/pliegosIndice.js';
import { licitacion } from '../helpers/sinteticas.js';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-errores-'));
const abiertas: { close: () => void }[] = [];
after(() => {
  abiertas.forEach((d) => d.close());
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-20T10:00:00Z');
const AUN_NO_INDEXADO = (): Legibilidad[] | null => null;

let n = 0;
function conNueva(limite = '2026-12-15T08:00:00'): { db: Db; nucleo: DbNucleo; id: string } {
  n += 1;
  const dir = path.join(tmp, String(n));
  const nucleo = abrirNucleo(dir);
  const db = abrirLicitaciones(dir);
  abiertas.push(db, nucleo);
  const l = licitacion({ titulo: 'Plan de formación', publicada: '2026-10-01', limite });
  guardarLicitacion(db, l);
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, 'nueva', 'x', 'x')",
  ).run(l.id);
  return { db, nucleo, id: l.id };
}

function pliego(db: Db, id: string, clase: string, estado: string, error: string | null = null): void {
  db.prepare(
    `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, error, intentos, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, 3, 'x')`,
  ).run(
    id,
    `https://placsp/${clase}`,
    clase,
    `${clase}.pdf`,
    estado,
    estado === 'descargado' ? `${id}/${clase}.pdf` : null,
    error,
  );
}

function trabajoFicha(nucleo: DbNucleo, id: string, clave: string, estado: string, error: string | null = null): void {
  nucleo
    .prepare(
      `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, error, creado_en, actualizado_en)
    VALUES ('licitaciones.ficha', 'licitaciones', ?, ?, ?, ?, '2026-10-20T08:00:00Z', '2026-10-20T08:00:00Z')`,
    )
    .run(clave, JSON.stringify({ id }), estado, error);
}

const marca = (db: Db, id: string) =>
  db
    .prepare('SELECT error_proceso AS codigo, error_detalle AS detalle FROM oportunidades WHERE licitacion_id = ?')
    .get(id) as { codigo: string | null; detalle: string | null };
const lista = (db: Db, estados: string[]) => listarOportunidades(db, Filtro.parse({ estados }), AHORA);

test('should_move_an_opportunity_to_errores_when_no_document_could_be_downloaded', () => {
  // Arrange
  const { db, id } = conNueva();
  pliego(db, id, 'pcap', 'error', 'placsp_http_404: no encontrado');
  pliego(db, id, 'ppt', 'error', 'placsp_http_404: no encontrado');

  // Act
  const cambios = revisarErrores(db, AHORA, AUN_NO_INDEXADO);

  // Assert
  assert.equal(cambios, 1);
  assert.deepEqual(marca(db, id), { codigo: 'pliegos_error', detalle: 'placsp_http_404: no encontrado' });
  const errores = lista(db, ['con_error']);
  assert.deepEqual(
    errores.items.map((x) => [x.id, x.error_proceso?.codigo]),
    [[id, 'pliegos_error']],
  );
  assert.equal(lista(db, ['nueva']).total, 0, 'ya no cuenta como nueva');
  assert.equal(errores.cuentas['con_error'], 1);
  assert.equal(errores.cuentas['nueva'], undefined);
});

test('should_not_mark_as_error_what_still_has_a_document_to_download_or_read', () => {
  // Arrange
  const { db, id } = conNueva();
  pliego(db, id, 'pcap', 'error', 'zip_roto: no se abre');
  pliego(db, id, 'ppt', 'descargado');

  // Act
  revisarErrores(db, AHORA, AUN_NO_INDEXADO);

  // Assert
  assert.equal(marca(db, id).codigo, null);
  assert.equal(lista(db, ['nueva']).total, 1);
});

test('should_mark_a_ficha_that_failed_all_its_rounds_and_clear_it_when_retried', () => {
  // Arrange
  const { db, nucleo, id } = conNueva();
  pliego(db, id, 'pcap', 'descargado');
  trabajoFicha(nucleo, id, `ficha-auto-${id}`, 'fallido', 'sin_resultado');
  trabajoFicha(nucleo, id, `ficha-auto-${id}-r1`, 'fallido', 'sin_resultado');
  trabajoFicha(nucleo, id, `ficha-auto-${id}-r2`, 'fallido', 'Hermes no envió la ficha');
  revisarErrores(db, AHORA, AUN_NO_INDEXADO);
  assert.equal(marca(db, id).codigo, 'ficha_fallida');

  // Act
  const r = reintentarProceso(nucleo, db, id);

  // Assert: se pide otra ficha y, con ella en cola, la vuelta no la vuelve a marcar.
  assert.deepEqual(r, { data: { reintentado: 'ficha_fallida' }, error: null });
  assert.equal(marca(db, id).codigo, null);
  const pedida = nucleo
    .prepare("SELECT estado FROM trabajos_ia WHERE clave LIKE ? AND estado = 'pendiente'")
    .get(`ficha-${id}-m%`);
  assert.ok(pedida, 'una ronda manual en cola');
  revisarErrores(db, AHORA, AUN_NO_INDEXADO);
  assert.equal(marca(db, id).codigo, null);
});

test('should_not_mark_a_ficha_with_rounds_left', () => {
  // Arrange
  const { db, nucleo, id } = conNueva();
  pliego(db, id, 'pcap', 'descargado');
  trabajoFicha(nucleo, id, `ficha-auto-${id}`, 'fallido', 'sin_resultado');

  // Act
  revisarErrores(db, AHORA, AUN_NO_INDEXADO);

  // Assert
  assert.equal(marca(db, id).codigo, null);
});

test('should_mark_unreadable_documents_and_refuse_to_retry_them', () => {
  // Arrange
  const { db, nucleo, id } = conNueva();
  pliego(db, id, 'pcap', 'descargado');
  const escaneado: Legibilidad[] = [
    { ruta: `${id}/pcap.pdf`, clase: 'pcap', estado_indice: 'escaneado', paginas: 30, error_indice: 'PDF escaneado' },
  ];

  // Act
  revisarErrores(db, AHORA, () => escaneado);
  const r = reintentarProceso(nucleo, db, id);

  // Assert
  assert.equal(marca(db, id).codigo, 'pliegos_ilegibles');
  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(marca(db, id).codigo, 'pliegos_ilegibles', 'sigue en Errores');
});

test('should_requeue_failed_documents_on_retry', () => {
  // Arrange
  const { db, nucleo, id } = conNueva();
  pliego(db, id, 'pcap', 'error', 'placsp_inalcanzable: sin red');
  revisarErrores(db, AHORA, AUN_NO_INDEXADO);

  // Act
  const r = reintentarProceso(nucleo, db, id);

  // Assert
  assert.equal(r.error, null);
  assert.deepEqual(db.prepare('SELECT estado, intentos, error FROM pliegos WHERE licitacion_id = ?').get(id), {
    estado: 'pendiente',
    intentos: 0,
    error: null,
  });
  revisarErrores(db, AHORA, AUN_NO_INDEXADO);
  assert.equal(marca(db, id).codigo, null, 'con un pliego por bajar no es un error');
});

test('should_clear_the_mark_when_the_opportunity_is_no_longer_new_or_its_deadline_passed', () => {
  // Arrange
  const { db, id } = conNueva('2026-10-19T08:00:00');
  pliego(db, id, 'pcap', 'error', 'placsp_http_404: no encontrado');
  db.prepare("UPDATE oportunidades SET error_proceso = 'pliegos_error' WHERE licitacion_id = ?").run(id);

  // Act
  revisarErrores(db, AHORA, AUN_NO_INDEXADO);

  // Assert
  assert.equal(marca(db, id).codigo, null);
});

test('should_refuse_to_retry_without_an_error_or_an_opportunity', () => {
  // Arrange
  const { db, nucleo, id } = conNueva();

  // Act
  const sinError = reintentarProceso(nucleo, db, id);
  const sinOportunidad = reintentarProceso(nucleo, db, 'p-0000');

  // Assert
  assert.equal(sinError.error?.code, 'invalid_input');
  assert.equal(sinOportunidad.error?.code, 'not_found');
});
