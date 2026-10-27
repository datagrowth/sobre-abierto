// Histórico de la PLACSP de punta a punta con un ZIP pequeño construido en el test a
// partir de fixtures reales: descarga simulada (la frontera HTTP), lectura en streaming,
// filtro de sector, estado por fuente y año, reanudación, fallos, temporales y rutas web.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { escucharLocal } from '../helpers/servidorLocal.js';
import type { DescargarZip } from '../../src/dominios/licitaciones/historicoCarga.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'historico-'));
const DATOS = path.join(tmp, 'datos');
process.env.PLATAFORMA_DATA_DIR = DATOS;
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const { recorrerAtoms } = await import('../../src/dominios/licitaciones/placsp/zip.js');
const { listarHistorico, pedirHistorico, piezasDe } = await import('../../src/dominios/licitaciones/historico.js');
const { cargarHistorico } = await import('../../src/dominios/licitaciones/historicoCarga.js');
const { prefiltrar, guardarFiltros, FILTROS_INICIALES } = await import('../../src/dominios/licitaciones/prefiltro.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { entradas } = await import('../../src/dominios/licitaciones/placsp/atom.js');
const { mapearEntrada } = await import('../../src/dominios/licitaciones/placsp/mapper.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const leer = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');
const HOY = new Date('2026-10-02T10:00:00Z');
const TMP_ZIP = path.join(DATOS, 'historico-tmp');

// Dos .atom como en los ZIP de la PLACSP, y un archivo que no es .atom (se ignora).
const ZIP = zipSync({
  'licitacionesPerfilesContratanteCompleto3_20170101_000000.atom': strToU8(leer('perfiles-pagina1.atom')),
  'licitacionesPerfilesContratanteCompleto3_20170102_000000.atom': strToU8(leer('perfiles-pagina2.atom')),
  'LEEME.txt': strToU8('no es un atom'),
});

let pedidas: string[] = [];
const descargaOk: DescargarZip = async (url, destino, alProgreso) => {
  pedidas.push(url);
  fs.writeFileSync(destino, ZIP);
  alProgreso(ZIP.length);
  return { data: { bytes: ZIP.length }, error: null };
};

iniciarNucleo();
const db = dbLicitaciones();

let server: http.Server;
let base = '';

before(() => {
  const app = express();
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

function fila(fuente: string, anio: number) {
  const f = listarHistorico(db).find((x) => x.fuente === fuente && x.anio === anio);
  assert.ok(f, `falta ${fuente} ${anio}`);
  return f;
}

function limpiar(): void {
  db.exec(
    'DELETE FROM historico_estado; DELETE FROM adjudicaciones; DELETE FROM licitaciones; DELETE FROM oportunidades;',
  );
  fs.rmSync(TMP_ZIP, { recursive: true, force: true });
  pedidas = [];
}

test('should_split_years_into_monthly_zips_from_2018_and_annual_before', () => {
  assert.deepEqual(piezasDe(FUENTES.perfiles, 2017, HOY), [FUENTES.perfiles.zipAnual(2017)]);
  const meses = piezasDe(FUENTES.agregadas, 2019, HOY);
  assert.equal(meses.length, 12);
  assert.match(meses[2] ?? '', /PlataformasAgregadasSinMenores_201903\.zip$/);
  assert.equal(piezasDe(FUENTES.perfiles, 2026, HOY).length, 9, 'del año en curso, solo los meses cerrados');
  assert.deepEqual(
    piezasDe(FUENTES.perfiles, 2026, new Date('2026-01-15T10:00:00Z')),
    [],
    'en enero aún no hay ninguno',
  );
});

test('should_read_every_atom_of_a_zip_in_order_and_skip_the_ones_already_done', async () => {
  const ruta = path.join(tmp, 'prueba.zip');
  fs.writeFileSync(ruta, ZIP);
  const vistos: number[] = [];
  const todo = await recorrerAtoms(ruta, 0, (xml, i) => {
    assert.match(xml, /<feed/);
    vistos.push(i);
  });
  const resto = await recorrerAtoms(ruta, 1, (_xml, i) => vistos.push(i * 10));
  assert.deepEqual(todo.data, { atoms: 2 });
  assert.deepEqual(resto.data, { atoms: 2 });
  assert.deepEqual(vistos, [0, 1, 10]);
  fs.writeFileSync(ruta, 'esto no es un zip');
  assert.equal((await recorrerAtoms(ruta, 0, () => {})).error?.code, 'zip_ilegible');
});

test('should_load_a_year_end_to_end_keeping_only_the_sector_and_deleting_the_temporary_zip', async () => {
  limpiar();
  guardarFiltros(db, FILTROS_INICIALES);
  pedirHistorico(db, { desde: 2017, hasta: 2017, fuentes: ['perfiles'], repetir: false }, HOY);

  const avisos: number[] = [];
  const r = await cargarHistorico(db, {
    dataDir: DATOS,
    todo: false,
    descargar: descargaOk,
    hoy: HOY,
    alCandidatas: (n) => avisos.push(n),
  });

  assert.deepEqual(r.data, { hechos: 1 });
  assert.deepEqual(pedidas, [FUENTES.perfiles.zipAnual(2017)]);
  const f = fila('perfiles', 2017);
  assert.equal(f.estado, 'hecho');
  assert.deepEqual(
    [f.piezas_total, f.piezas_hechas, f.entradas, f.guardadas, f.fuera_de_sector, f.errores],
    [1, 1, 5, 2, 3, 0],
  );
  assert.equal(f.bytes, ZIP.length);
  assert.ok(f.terminado_en);
  const ids = (
    db.prepare("SELECT id FROM licitaciones WHERE origen = 'historico' ORDER BY id").all() as { id: string }[]
  ).map((x) => x.id);
  assert.deepEqual(ids, ['p-18431943', 'p-20379303'], 'solo lo del sector: CPV 72… y 79311…');
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM adjudicaciones WHERE baja IS NOT NULL').get() as { n: number }).n > 0,
    true,
  );
  assert.deepEqual(fs.readdirSync(TMP_ZIP), [], 'el temporal se borra al acabar');
  const candidatas = db.prepare('SELECT licitacion_id FROM oportunidades ORDER BY licitacion_id').all();
  assert.deepEqual(
    candidatas,
    [{ licitacion_id: 'p-20379303' }],
    'lo abierto y en plazo pasa el prefiltro; lo adjudicado, no',
  );
  assert.deepEqual(avisos, [1]);
});

test('should_prefilter_open_tenders_from_history_even_if_the_feed_later_brings_the_same_version', async () => {
  limpiar();
  guardarFiltros(db, FILTROS_INICIALES);
  pedirHistorico(db, { desde: 2017, hasta: 2017, fuentes: ['perfiles'], repetir: false }, HOY);
  await cargarHistorico(db, {
    dataDir: DATOS,
    todo: false,
    descargar: descargaOk,
    hoy: new Date('2026-12-01T00:00:00Z'),
  });
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM oportunidades').get() as { n: number }).n,
    0,
    'con el plazo vencido no entra',
  );

  const l = mapearEntrada('perfiles', [...entradas(leer('perfiles-pagina1.atom'))][1] ?? '').data;
  assert.equal(l?.id, 'p-20379303');
  assert.equal(guardarLicitacion(db, l!), 'igual', 'el feed trae la misma versión');

  assert.equal(prefiltrar(db, [l!.id], HOY.getTime()), 1, 'el origen no la excluye');
});

test('should_save_everything_when_configured_and_update_tenders_already_in_the_base', async () => {
  limpiar();
  pedirHistorico(db, { desde: 2017, hasta: 2017, fuentes: ['perfiles'], repetir: false }, HOY);
  await cargarHistorico(db, { dataDir: DATOS, todo: true, descargar: descargaOk, hoy: HOY });
  const f = fila('perfiles', 2017);
  assert.deepEqual([f.guardadas, f.fuera_de_sector], [5, 0]);
});

test('should_resume_the_same_zip_from_the_next_atom_without_downloading_again', async () => {
  limpiar();
  pedirHistorico(db, { desde: 2017, hasta: 2017, fuentes: ['perfiles'], repetir: false }, HOY);
  // Como si el proceso se hubiera cortado después del primer .atom.
  fs.mkdirSync(TMP_ZIP, { recursive: true });
  fs.writeFileSync(path.join(TMP_ZIP, 'perfiles-2017-01.zip'), ZIP);
  db.prepare(
    "UPDATE historico_estado SET estado = 'procesando', atoms_hechos = 1, entradas = 3 WHERE fuente = 'perfiles' AND anio = 2017",
  ).run();

  await cargarHistorico(db, { dataDir: DATOS, todo: true, descargar: descargaOk, hoy: HOY });

  assert.deepEqual(pedidas, [], 'el ZIP ya estaba bajado');
  const f = fila('perfiles', 2017);
  assert.equal(f.estado, 'hecho');
  assert.equal(f.entradas, 5, '3 del primer .atom (antes del corte) + 2 del segundo');
  assert.equal(
    db.prepare("SELECT 1 FROM licitaciones WHERE id = 'p-18431943'").get(),
    undefined,
    'el primer .atom no se repite',
  );
  assert.ok(db.prepare("SELECT 1 FROM licitaciones WHERE id = 'p-20602993'").get());
});

test('should_mark_a_failed_download_as_error_remove_the_partial_file_and_retry_when_asked_again', async () => {
  limpiar();
  const falla: DescargarZip = async (_url, destino) => {
    fs.writeFileSync(destino, 'a medias');
    return { data: null, error: { code: 'placsp_sin_zip', message: 'La PLACSP no tiene ese ZIP.' } };
  };
  pedirHistorico(db, { desde: 2017, hasta: 2017, fuentes: ['perfiles'], repetir: false }, HOY);
  const r = await cargarHistorico(db, { dataDir: DATOS, todo: false, descargar: falla, hoy: HOY });
  assert.deepEqual(r.data, { hechos: 0 });
  assert.equal(fila('perfiles', 2017).estado, 'error');
  assert.match(fila('perfiles', 2017).error ?? '', /placsp_sin_zip/);
  assert.deepEqual(fs.readdirSync(TMP_ZIP), []);

  assert.deepEqual(pedirHistorico(db, { desde: 2017, hasta: 2017, fuentes: ['perfiles'], repetir: false }, HOY).data, {
    pedidos: 1,
  });
  assert.equal(fila('perfiles', 2017).estado, 'pendiente');
});

test('should_resume_a_failed_year_from_the_failed_month_without_downloading_the_finished_ones', async () => {
  limpiar();
  let fallar = true;
  const fallaEnMarzo: DescargarZip = async (url, destino, alProgreso) => {
    if (fallar && url.endsWith('_201903.zip'))
      return { data: null, error: { code: 'placsp_inalcanzable', message: 'corte' } };
    return descargaOk(url, destino, alProgreso);
  };
  const pedido = { desde: 2019, hasta: 2019, fuentes: ['perfiles' as const], repetir: false };
  pedirHistorico(db, pedido, HOY);
  await cargarHistorico(db, { dataDir: DATOS, todo: true, descargar: fallaEnMarzo, hoy: HOY });
  assert.deepEqual(
    [fila('perfiles', 2019).estado, fila('perfiles', 2019).piezas_hechas, fila('perfiles', 2019).entradas],
    ['error', 2, 10],
  );

  fallar = false;
  pedidas = [];
  assert.deepEqual(pedirHistorico(db, pedido, HOY).data, { pedidos: 1 });
  assert.deepEqual(
    [fila('perfiles', 2019).piezas_hechas, fila('perfiles', 2019).error],
    [2, null],
    'se conserva lo hecho',
  );
  await cargarHistorico(db, { dataDir: DATOS, todo: true, descargar: fallaEnMarzo, hoy: HOY });

  assert.equal(pedidas.length, 10, 'de marzo a diciembre');
  assert.match(pedidas[0] ?? '', /_201903\.zip$/);
  const f = fila('perfiles', 2019);
  assert.deepEqual([f.estado, f.piezas_hechas, f.entradas], ['hecho', 12, 60]);
});

test('should_reopen_a_finished_current_year_only_for_the_new_closed_months', async () => {
  limpiar();
  const pedido = { desde: 2026, hasta: 2026, fuentes: ['perfiles' as const], repetir: false };
  pedirHistorico(db, pedido, HOY);
  await cargarHistorico(db, { dataDir: DATOS, todo: true, descargar: descargaOk, hoy: HOY });
  assert.deepEqual([fila('perfiles', 2026).estado, fila('perfiles', 2026).piezas_hechas], ['hecho', 9]);
  assert.deepEqual(pedirHistorico(db, pedido, HOY).data, { pedidos: 0 }, 'sin meses nuevos no se reabre');

  const noviembre = new Date('2026-11-05T10:00:00Z');
  pedidas = [];
  assert.deepEqual(pedirHistorico(db, pedido, noviembre).data, { pedidos: 1 });
  await cargarHistorico(db, { dataDir: DATOS, todo: true, descargar: descargaOk, hoy: noviembre });

  assert.deepEqual(pedidas, [FUENTES.perfiles.zipMensual(2026, 10)]);
  assert.deepEqual([fila('perfiles', 2026).estado, fila('perfiles', 2026).piezas_hechas], ['hecho', 10]);
});

test('should_not_reload_finished_years_unless_asked_to_repeat', async () => {
  limpiar();
  const pedido = { desde: 2017, hasta: 2017, fuentes: ['perfiles' as const], repetir: false };
  pedirHistorico(db, pedido, HOY);
  await cargarHistorico(db, { dataDir: DATOS, todo: false, descargar: descargaOk, hoy: HOY });
  assert.deepEqual(pedirHistorico(db, pedido, HOY).data, { pedidos: 0 });
  assert.deepEqual(pedirHistorico(db, { ...pedido, repetir: true }, HOY).data, { pedidos: 1 });
  assert.equal(fila('perfiles', 2017).guardadas, 0, 'al repetir se empieza de cero');
});

test('should_skip_years_a_source_does_not_publish', () => {
  limpiar();
  const r = pedirHistorico(db, { desde: 2014, hasta: 2016, fuentes: ['agregadas'], repetir: false }, HOY);
  assert.deepEqual(r.data, { pedidos: 1 }, 'las agregadas empiezan en 2016');
  assert.equal(
    pedirHistorico(db, { desde: 2030, fuentes: ['perfiles'], repetir: false }, HOY).error?.code,
    'invalid_input',
  );
});

test('should_validate_histórico_and_price_requests_on_the_web_api', async () => {
  limpiar();
  const json = { 'content-type': 'application/json' };
  assert.equal(
    (await fetch(`${base}/historico`, { method: 'POST', headers: json, body: JSON.stringify({ desde: 1999 }) })).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/historico`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ desde: 2020, hasta: 2019 }),
      })
    ).status,
    400,
  );
  const ok = await fetch(`${base}/historico`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ desde: 2024, hasta: 2024, fuentes: ['agregadas'] }),
  });
  assert.equal(ok.status, 202);
  assert.deepEqual(await ok.json(), { pedidos: 1, en_marcha: false });
  const lista = (await (await fetch(`${base}/historico`)).json()) as {
    anios: { anio: number; piezas_total: number }[];
    por_estado: Record<string, number>;
  };
  assert.deepEqual(lista.por_estado, { pendiente: 1 });
  assert.equal(lista.anios[0]?.piezas_total, 12);

  assert.equal((await fetch(`${base}/licitaciones/p-0000/precios`)).status, 404);
  assert.equal((await fetch(`${base}/licitaciones/p-1/precios?bajas=0.2,abc`)).status, 400);
  assert.equal((await fetch(`${base}/licitaciones/p-1/precios?bajas=0.99`)).status, 400);
  assert.equal((await fetch(`${base}/licitaciones/p-1/comparables?limite=500`)).status, 400);
});

test('should_serve_prices_and_comparables_for_a_stored_tender', async () => {
  limpiar();
  pedirHistorico(db, { desde: 2017, hasta: 2017, fuentes: ['perfiles'], repetir: false }, HOY);
  await cargarHistorico(db, { dataDir: DATOS, todo: true, descargar: descargaOk, hoy: HOY });
  const r = await fetch(`${base}/licitaciones/p-20379303/precios?bajas=0.15&ofertas=3`);
  assert.equal(r.status, 200);
  const p = (await r.json()) as {
    segmento: { n: number; suficiente: boolean; probados: unknown[] };
    escenarios: { ofertas_esperadas: number } | null;
    consulta: { cpv: string };
  };
  assert.equal(p.consulta.cpv, '72600000');
  assert.equal(p.segmento.suficiente, false, 'con cuatro adjudicaciones no hay muestra');
  assert.ok(p.segmento.probados.length > 1);
  const c = await fetch(`${base}/licitaciones/p-20379303/comparables`);
  assert.equal(c.status, 200);
  assert.ok(Array.isArray(await c.json()));
});
