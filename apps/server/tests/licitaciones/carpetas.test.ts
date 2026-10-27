// Carpetas de Licitaciones en Conocimiento: reorganización única con la API de Drive
// (simulada en la frontera HTTP: sin red), lo que no debe moverse, destino ocupado,
// idempotencia, Drive desconectado, actualización de rutas guardadas, espera de la descarga
// de pliegos y la carpeta de lo presentado al registrar una propuesta (en Drive y en disco).
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'carpetas-lic-'));
const conocimiento = path.join(tmp, 'conocimiento');
const estadoDrive = path.join(tmp, 'drive-state');
fs.mkdirSync(conocimiento, { recursive: true });
fs.mkdirSync(estadoDrive, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.VAULT_PATH = conocimiento;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.LICITACIONES_ACTIVO = '0';
process.env.DRIVE_STATE_DIR = estadoDrive;
process.env.GDRIVE_CLIENT_ID = 'cid';
process.env.GDRIVE_CLIENT_SECRET = 'csecret';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { leerConfig } = await import('../../src/nucleo/config.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { procesarPagina } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const { obtenerLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { actualizarRutas, carpetaDe, nombrePresentada, abreviarOrgano, temaDe } =
  await import('../../src/dominios/licitaciones/carpetas.js');
const { reorganizar, reorganizarSiToca, leerReorganizacion, comprobarSincronizacion, descargaPermitida, clasificar } =
  await import('../../src/dominios/licitaciones/reorganizacion.js');
const { carpetaPresentadaDe } = await import('../../src/dominios/licitaciones/presentadas.js');
const { crearCarpetasPresentadas } = await import('../../src/dominios/licitaciones/index.js');
const { carpetaPliegos, descargarPendientes } = await import('../../src/dominios/licitaciones/pliegos.js');
const { registrarPropuesta, borrarPropuesta, NuevaPropuesta } =
  await import('../../src/dominios/licitaciones/propuestas/registro.js');
const { guardarOperacion } = await import('../../src/nucleo/operaciones.js');
const { crearPropuesta, listarPendientes } = await import('../../src/biblioteca/motor/bandeja.js');
const { instruccionesEvaluacion } = await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
iniciarNucleo();
procesarPagina(dbLicitaciones(), FUENTES.perfiles, fs.readFileSync(path.join(FIX, 'requisitos.atom'), 'utf8'));
const SERVICIOS = 'p-20435341';

const CARPETA = 'application/vnd.google-apps.folder';
const DOC = 'application/vnd.google-apps.document';
const PDF = 'application/pdf';
const fetchReal = globalThis.fetch;

type Nodo = { id: string; name: string; mimeType: string; parent: string };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Drive en memoria tras su API REST (files.list paginado de 3 en 3, files.create y
// files.update con addParents/removeParents). Cualquier otra llamada (copiar, borrar) es un 500.
class DriveFalso {
  nodos = new Map<string, Nodo>([['raiz', { id: 'raiz', name: 'Hermes', mimeType: CARPETA, parent: '' }]]);
  llamadas: string[] = [];
  fallar = new Set<string>();
  fallarListado = new Set<string>();
  private n = 0;

  crear(parent: string, name: string, mimeType = CARPETA): string {
    const id = `id${++this.n}`;
    this.nodos.set(id, { id, name, mimeType, parent });
    return id;
  }

  hijos(parent: string): Nodo[] {
    return [...this.nodos.values()].filter((x) => x.parent === parent);
  }

  /** Id de «a/b/c» bajo la raíz; con `crear`, crea las carpetas que falten. */
  id(ruta: string, crear = false): string | null {
    let p = 'raiz';
    for (const name of ruta.split('/')) {
      const h = this.hijos(p).find((x) => x.name === name);
      if (!h && !crear) return null;
      p = h ? h.id : this.crear(p, name);
    }
    return p;
  }

  archivo(ruta: string, mimeType = PDF): string {
    return this.crear(this.id(path.posix.dirname(ruta), true)!, path.posix.basename(ruta), mimeType);
  }

  nombres(ruta: string): string[] {
    const id = this.id(ruta);
    return id
      ? this.hijos(id)
          .map((h) => h.name)
          .sort()
      : [];
  }

  private listar(u: URL): Response {
    const padre = /^'([^']+)' in parents/.exec(u.searchParams.get('q') ?? '')?.[1] ?? '';
    if (this.fallarListado.has(this.nodos.get(padre)?.name ?? ''))
      return json(500, { error: { message: 'Backend Error' } });
    const todos = this.hijos(padre);
    const desde = Number(u.searchParams.get('pageToken') ?? 0);
    const files = todos.slice(desde, desde + 3).map(({ id, name, mimeType }) => ({ id, name, mimeType }));
    return json(200, { files, ...(desde + 3 < todos.length ? { nextPageToken: String(desde + 3) } : {}) });
  }

  private mover(id: string, u: URL, init: RequestInit): Response {
    const nodo = this.nodos.get(id);
    if (!nodo) return json(404, { error: { message: 'File not found' } });
    if (this.fallar.has(nodo.name)) return json(500, { error: { message: 'Backend Error' } });
    if (nodo.parent !== u.searchParams.get('removeParents')) return json(400, { error: { message: 'bad parent' } });
    const body = JSON.parse(String(init.body ?? '{}')) as { name?: string };
    nodo.parent = u.searchParams.get('addParents') ?? '';
    if (body.name) nodo.name = body.name;
    return json(200, { id, name: nodo.name, mimeType: nodo.mimeType });
  }

  fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(input));
    if (u.hostname === '127.0.0.1') return fetchReal(input, init);
    const metodo = init.method ?? 'GET';
    this.llamadas.push(`${metodo} ${u.hostname}${u.pathname}`);
    if (u.hostname === 'oauth2.googleapis.com')
      return json(200, { access_token: 'at', expires_in: 3600, token_type: 'Bearer' });
    if (u.hostname === 'contrataciondelestado.es')
      return new Response(Buffer.from('%PDF-1.4 pliego'), { status: 200, headers: { 'content-type': PDF } });
    if (u.pathname === '/drive/v3/files' && metodo === 'GET') return this.listar(u);
    if (u.pathname === '/drive/v3/files' && metodo === 'POST') {
      const b = JSON.parse(String(init.body)) as { name: string; mimeType: string; parents: string[] };
      return json(200, { id: this.crear(b.parents[0]!, b.name, b.mimeType), name: b.name });
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m && metodo === 'PATCH') return this.mover(m[1]!, u, init);
    return json(500, { error: 'llamada inesperada' });
  }) as typeof fetch;

  get cambios(): string[] {
    return this.llamadas.filter((l) => !l.startsWith('GET ') && !l.includes('oauth2'));
  }
}

let drive: DriveFalso;

// Última vuelta de drive-sync: por defecto «después de todo» (lo del disco ya está en Drive).
function vueltaSync(ms = Date.now() + 10 * 60_000): void {
  const marca = path.join(estadoDrive, 'last-round');
  fs.writeFileSync(marca, '');
  fs.utimesSync(marca, new Date(ms), new Date(ms));
}

function conectarDrive(listo = true): void {
  vueltaSync();
  const cfg = {
    token: { access_token: 'x', token_type: 'Bearer', refresh_token: 'rt', expiry: new Date().toISOString() },
    account: null,
    folder: { id: 'raiz', name: 'Hermes', path: 'Hermes' },
    connectedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(estadoDrive, 'drive.json'), JSON.stringify(cfg));
  fs.writeFileSync(path.join(estadoDrive, 'active-folder'), 'raiz\n');
  fs.rmSync(path.join(estadoDrive, 'bisync-ready-Conocimiento'), { force: true });
  if (listo) fs.writeFileSync(path.join(estadoDrive, 'bisync-ready-Conocimiento'), '');
}

const desconectarDrive = () => fs.rmSync(path.join(estadoDrive, 'drive.json'), { force: true });

beforeEach(() => {
  drive = new DriveFalso();
  globalThis.fetch = drive.fetch;
  conectarDrive();
  nucleo().db.exec('DELETE FROM operaciones_unicas; DELETE FROM documentos; DELETE FROM trabajos_ia;');
  dbLicitaciones().exec(
    'DELETE FROM carpetas_presentadas; DELETE FROM pliegos; DELETE FROM propuestas; DELETE FROM evaluaciones; DELETE FROM fichas;',
  );
  fs.rmSync(conocimiento, { recursive: true, force: true });
  fs.mkdirSync(conocimiento, { recursive: true });
});

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/licitaciones`;
});

after(() => {
  globalThis.fetch = fetchReal;
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const PRESENTADA = '2026-05 - SER-2026-0000003222 - Ejemplo GC - Formación estadística';
const L = 'Conocimiento/Licitaciones';

// La estructura anterior, con lo que casa y lo que no debe moverse.
function arbolAnterior(): void {
  drive.archivo(`${L}/${PRESENTADA}/DOCUMENTACION PRESENTADA/memoria.pdf`);
  drive.archivo(`${L}/${PRESENTADA}/OTROS DOCUMENTOS/acta`, DOC);
  drive.id(`${L}/2026-13 - mes imposible`, true);
  drive.id(`${L}/Notas sueltas`, true);
  drive.archivo(`${L}/resumen.pdf`);
  drive.archivo(`${L}/2026-04 - suelto.pdf`);
  drive.archivo(`${L}/2026/EXP-1 (p-100)/PCAP.pdf`);
  drive.archivo(`${L}/2026/EXP-2 (a-200)/PPT.pdf`);
  drive.archivo(`${L}/2026/EXP-2 (a-200)/resumen`, DOC);
  drive.id(`${L}/2026/Otra cosa`, true);
  drive.id(`${L}/2026/EXP-3 (p-300) copia`, true);
  drive.archivo(`${L}/2026/suelto.pdf`);
  drive.archivo(`${L}/2025/EXP-9 (p-900)/PCAP.pdf`);
}

test('should_do_nothing_and_say_so_when_drive_is_disconnected', async () => {
  desconectarDrive();
  arbolAnterior();
  assert.equal(await reorganizar(), 'sin_drive');
  const r = leerReorganizacion();
  assert.match(r.mensaje, /Drive no está conectado/);
  assert.deepEqual(r.movidas, []);
  assert.deepEqual(drive.llamadas, [], 'sin conexión no se llama a Google');
  assert.equal(descargaPermitida(r.estado), true, 'sin Drive nada se mueve: la descarga sigue');
  assert.deepEqual(
    drive.nombres(L).filter((n) => n === 'Radar' || n === 'Presentadas'),
    [],
  );
});

test('should_wait_while_drive_sync_has_not_joined_conocimiento_yet', async () => {
  conectarDrive(false);
  arbolAnterior();
  assert.equal(await reorganizar(), 'sin_drive');
  assert.match(leerReorganizacion().mensaje, /drive-sync aún no ha terminado/);
  assert.deepEqual(drive.cambios, []);
  conectarDrive(true);
  assert.equal(await reorganizarSiToca(), 'sincronizando', 'con drive-sync listo se hace sola');
});

test('should_move_only_what_matches_the_patterns_through_the_drive_api', async () => {
  arbolAnterior();
  const docPresentada = drive.id(`${L}/${PRESENTADA}/OTROS DOCUMENTOS/acta`);
  assert.equal(await reorganizar(), 'sincronizando');
  assert.deepEqual(drive.nombres(`${L}/Presentadas`), [PRESENTADA]);
  assert.deepEqual(drive.nombres(`${L}/Radar/2026`), ['EXP-1 (p-100)', 'EXP-2 (a-200)']);
  assert.deepEqual(drive.nombres(`${L}/Radar/2025`), ['EXP-9 (p-900)']);
  assert.equal(
    drive.id(`${L}/Presentadas/${PRESENTADA}/OTROS DOCUMENTOS/acta`),
    docPresentada,
    'el Google Doc viaja con su carpeta',
  );
  assert.ok(drive.id(`${L}/Radar/2026/EXP-2 (a-200)/resumen`));
  assert.deepEqual(drive.nombres(L), [
    '2025',
    '2026',
    '2026-04 - suelto.pdf',
    '2026-13 - mes imposible',
    'Notas sueltas',
    'Presentadas',
    'Radar',
    'resumen.pdf',
  ]);
  assert.deepEqual(drive.nombres(`${L}/2026`), ['EXP-3 (p-300) copia', 'Otra cosa', 'suelto.pdf']);
  assert.ok(
    drive.cambios.every((c) => c.startsWith('PATCH ') || c === 'POST www.googleapis.com/drive/v3/files'),
    'solo mover y crear carpetas: ni copiar ni borrar',
  );

  const r = leerReorganizacion();
  assert.deepEqual(r.movidas.map((m) => [m.tipo, m.a]).sort(), [
    ['presentada', `Licitaciones/Presentadas/${PRESENTADA}`],
    ['radar', 'Licitaciones/Radar/2025/EXP-9 (p-900)'],
    ['radar', 'Licitaciones/Radar/2026/EXP-1 (p-100)'],
    ['radar', 'Licitaciones/Radar/2026/EXP-2 (a-200)'],
  ]);
  assert.deepEqual(r.omitidas.map((o) => o.ruta).sort(), [
    'Licitaciones/2026-04 - suelto.pdf',
    'Licitaciones/2026-13 - mes imposible',
    'Licitaciones/2026/EXP-3 (p-300) copia',
    'Licitaciones/2026/Otra cosa',
    'Licitaciones/2026/suelto.pdf',
    'Licitaciones/Notas sueltas',
    'Licitaciones/resumen.pdf',
  ]);
  assert.ok(
    r.omitidas.every((o) => o.motivo.length > 5),
    'cada omitida dice por qué',
  );
  assert.equal(descargaPermitida(r.estado), false, 'la descarga de pliegos espera a que bisync lo traiga');
});

test('should_never_overwrite_an_existing_destination_and_use_a_suffix', async () => {
  arbolAnterior();
  const ocupada = drive.archivo(`${L}/Radar/2026/EXP-1 (p-100)/nuevo.pdf`);
  drive.id(`${L}/Presentadas/${PRESENTADA}`, true);
  await reorganizar();
  assert.deepEqual(drive.nombres(`${L}/Radar/2026`), ['EXP-1 (p-100)', 'EXP-1 (p-100)-1', 'EXP-2 (a-200)']);
  assert.deepEqual(drive.nombres(`${L}/Radar/2026/EXP-1 (p-100)`), ['nuevo.pdf'], 'lo que ya estaba no se toca');
  assert.equal(drive.id(`${L}/Radar/2026/EXP-1 (p-100)/nuevo.pdf`), ocupada);
  assert.deepEqual(drive.nombres(`${L}/Presentadas`), [PRESENTADA, `${PRESENTADA}-1`]);
  assert.ok(
    leerReorganizacion().movidas.some(
      (m) => m.de === 'Licitaciones/2026/EXP-1 (p-100)' && m.a === 'Licitaciones/Radar/2026/EXP-1 (p-100)-1',
    ),
  );
});

test('should_be_idempotent_checking_the_real_state_in_drive', async () => {
  arbolAnterior();
  await reorganizar();
  const mov = drive.cambios.length;
  assert.equal(await reorganizar(), 'sincronizando', 'repetir no da por hecho lo que bisync aún no trajo');
  assert.equal(drive.cambios.length, mov, 'la segunda pasada no mueve ni crea nada');
  assert.equal(leerReorganizacion().movidas.length, 4, 'lo movido antes sigue en el informe');
  drive.llamadas = [];
  assert.equal(await reorganizarSiToca(), 'sincronizando');
  assert.deepEqual(drive.llamadas, [], 'con la marca puesta no se vuelve a mirar Drive al arrancar');
});

test('should_finish_when_bisync_brings_the_change_to_disk_or_after_half_an_hour', async () => {
  arbolAnterior();
  await reorganizar();
  const viejo = path.join(conocimiento, 'Licitaciones', '2026', 'EXP-1 (p-100)');
  fs.mkdirSync(viejo, { recursive: true });
  fs.writeFileSync(path.join(viejo, 'PCAP.pdf'), 'x');
  assert.equal(comprobarSincronizacion(conocimiento), 'sincronizando');
  assert.equal(
    comprobarSincronizacion(conocimiento, Date.now() + 31 * 60_000),
    'hecha',
    'pasada media hora no espera más',
  );
  assert.match(leerReorganizacion().mensaje, /siguen con archivos en su sitio viejo/);

  await reorganizar();
  fs.rmSync(path.join(viejo, 'PCAP.pdf'));
  assert.equal(comprobarSincronizacion(conocimiento), 'hecha', 'sin archivos en el sitio viejo, bisync ya lo trajo');
  assert.equal(descargaPermitida(leerReorganizacion().estado), true);
});

test('should_report_errors_keep_going_and_retry_after_fifteen_minutes', async () => {
  arbolAnterior();
  drive.fallar.add('EXP-2 (a-200)');
  assert.equal(await reorganizar(), 'sincronizando', 'lo movido espera a bisync aunque haya errores');
  const r = leerReorganizacion();
  assert.deepEqual(
    r.errores.map((e) => e.ruta),
    ['Licitaciones/2026/EXP-2 (a-200)'],
  );
  assert.equal(r.movidas.length, 3, 'un fallo no para el resto');
  assert.equal(comprobarSincronizacion(conocimiento), 'error', 'con el disco al día queda «error»');
  assert.equal(descargaPermitida('error'), true, 'un error de una carpeta no para la descarga');
  drive.fallar.clear();
  drive.llamadas = [];
  assert.equal(await reorganizarSiToca(), 'error', 'antes de 15 minutos no se reintenta');
  assert.deepEqual(drive.llamadas, []);
  assert.equal(await reorganizarSiToca(Date.now() + 16 * 60_000), 'sincronizando');
  assert.deepEqual(drive.nombres(`${L}/Radar/2026`), ['EXP-1 (p-100)', 'EXP-2 (a-200)']);
  assert.equal(leerReorganizacion().movidas.length, 4);
});

test('should_keep_downloading_and_filing_when_one_folder_fails_for_good', async () => {
  arbolAnterior();
  drive.fallar.add('EXP-2 (a-200)');
  await reorganizar();
  comprobarSincronizacion(conocimiento);
  assert.equal(
    await reorganizarSiToca(Date.now() + 16 * 60_000),
    'error',
    'sin nada nuevo movido vuelve a «error», no a esperar',
  );
  assert.equal(descargaPermitida(leerReorganizacion().estado), true);
  const { carpetaRadar } = prepararPresentada();
  drive.archivo(`Conocimiento/${carpetaRadar}/PCAP.pdf`);
  assert.equal(await crearCarpetasPresentadas(), 1, 'las carpetas de lo presentado no esperan a la carpeta que falla');
  fs.mkdirSync(path.join(conocimiento, carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!.ruta!, 'PLIEGOS'), {
    recursive: true,
  });
  dbLicitaciones()
    .prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, 'https://contrataciondelestado.es/ppt.pdf', 'ppt', 'PPT.pdf', 'pendiente', ?)",
    )
    .run(SERVICIOS, new Date().toISOString());
  assert.equal(await descargarPendientes(dbLicitaciones(), conocimiento), 1, 'el resto de pliegos se descarga');
});

test('should_go_on_with_the_other_years_when_listing_one_fails', async () => {
  arbolAnterior();
  drive.fallarListado.add('2025');
  await reorganizar();
  assert.deepEqual(
    leerReorganizacion().errores.map((e) => e.ruta),
    ['Licitaciones/2025'],
  );
  assert.deepEqual(drive.nombres(`${L}/Radar/2026`), ['EXP-1 (p-100)', 'EXP-2 (a-200)']);
  assert.deepEqual(drive.nombres(`${L}/Presentadas`), [PRESENTADA]);
});

test('should_not_move_a_folder_with_files_that_drive_sync_has_not_uploaded_yet', async () => {
  arbolAnterior();
  const viejo = path.join(conocimiento, 'Licitaciones', '2026', 'EXP-1 (p-100)');
  fs.mkdirSync(viejo, { recursive: true });
  fs.writeFileSync(path.join(viejo, 'recien bajado.pdf'), 'x');
  vueltaSync(Date.now() - 10 * 60_000);
  await reorganizar();
  assert.deepEqual(
    drive.nombres(`${L}/2026`).filter((n) => n.startsWith('EXP-1')),
    ['EXP-1 (p-100)'],
    'se queda en su sitio',
  );
  assert.match(
    leerReorganizacion().errores.find((e) => e.ruta === 'Licitaciones/2026/EXP-1 (p-100)')?.motivo ?? '',
    /aún no ha subido/,
  );
  vueltaSync();
  comprobarSincronizacion(conocimiento, Date.now() + 31 * 60_000);
  fs.rmSync(viejo, { recursive: true });
  await reorganizarSiToca(Date.now() + 16 * 60_000);
  assert.deepEqual(
    drive.nombres(`${L}/Radar/2026`),
    ['EXP-1 (p-100)', 'EXP-2 (a-200)'],
    'con drive-sync al día, se mueve',
  );
});

test('should_wait_for_bisync_after_a_restart_in_the_middle_of_a_pass', async () => {
  const movida = { de: 'Licitaciones/2026/EXP-1 (p-100)', a: 'Licitaciones/Radar/2026/EXP-1 (p-100)', tipo: 'radar' };
  guardarOperacion(nucleo().db, 'licitaciones.carpetas', 'en_curso', {
    movidas: [movida],
    movida_en: new Date().toISOString(),
  });
  assert.equal(await reorganizarSiToca(), 'sincronizando', 'lo movido antes del reinicio sigue esperando a bisync');
  assert.equal(leerReorganizacion().movidas.length, 1);
  assert.equal(descargaPermitida(leerReorganizacion().estado), false);
});

test('should_reapply_saved_paths_that_could_not_be_updated_after_a_move', async () => {
  arbolAnterior();
  const db = dbLicitaciones();
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES ('p-100', 'u', 'pcap', 'PCAP.pdf', 'descargado', ?, ?)",
  ).run('Licitaciones/2026/EXP-1 (p-100)/PCAP.pdf', new Date().toISOString());
  db.exec('ALTER TABLE evaluaciones RENAME TO evaluaciones_fuera');
  try {
    await reorganizar();
  } finally {
    db.exec('ALTER TABLE evaluaciones_fuera RENAME TO evaluaciones');
  }
  assert.ok(leerReorganizacion().errores.some((e) => /no se pudieron actualizar las rutas/.test(e.motivo)));
  assert.equal(comprobarSincronizacion(conocimiento), 'error', 'no se da por hecha con rutas sin actualizar');
  assert.equal(await reorganizarSiToca(Date.now() + 16 * 60_000), 'hecha', 'el reintento las reaplica');
  assert.equal(
    (db.prepare('SELECT ruta FROM pliegos').get() as { ruta: string }).ruta,
    'Licitaciones/Radar/2026/EXP-1 (p-100)/PCAP.pdf',
  );
});

test('should_point_pending_note_proposals_to_the_moved_folder', async () => {
  arbolAnterior();
  await crearPropuesta({ title: 'Nota EXP-1', body: 'x', source: 'Licitaciones/2026/EXP-1 (p-100)/PCAP.pdf' });
  await crearPropuesta({
    title: 'Nota Doc',
    body: 'x',
    source: `.gdocs/Licitaciones/${PRESENTADA}/OTROS DOCUMENTOS/acta.docx`,
  });
  await crearPropuesta({ title: 'Otra', body: 'x', source: 'Licitaciones/2026/Otra cosa/a.pdf' });
  await reorganizar();
  const fuentes = (await listarPendientes()).map((p) => p.frontmatter['fuente']).sort();
  assert.deepEqual(fuentes, [
    `.gdocs/Licitaciones/Presentadas/${PRESENTADA}/OTROS DOCUMENTOS/acta.docx`,
    'Licitaciones/2026/Otra cosa/a.pdf',
    'Licitaciones/Radar/2026/EXP-1 (p-100)/PCAP.pdf',
  ]);
});

test('should_skip_destination_folders_hidden_items_and_names_that_are_not_paths', () => {
  const h = (name: string, folder = true) => ({ id: 'x', name, folder });
  const plan = clasificar(
    [
      h('Radar'),
      h('Presentadas'),
      h('.hermes-sync', false),
      h('2026-05 - a/b'),
      h('2026-05 - bien'),
      h('2026'),
      h('20266'),
    ],
    new Set(['Radar', 'Presentadas']),
  );
  assert.deepEqual(
    plan.presentadas.map((x) => x.name),
    ['2026-05 - bien'],
  );
  assert.deepEqual(
    plan.anios.map((x) => x.name),
    ['2026'],
  );
  assert.deepEqual(
    plan.omitidas.map((x) => x.ruta),
    ['Licitaciones/2026-05 - a/b', 'Licitaciones/20266'],
  );
  assert.match(plan.omitidas[0]!.motivo, /«\/»/);
});

test('should_update_every_saved_path_inside_a_moved_folder_and_nothing_else', () => {
  const db = dbLicitaciones();
  const de = 'Licitaciones/2026/EXP-1 (p-100)';
  const a = 'Licitaciones/Radar/2026/EXP-1 (p-100)';
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES ('p-100', 'u1', 'pcap', 'PCAP.pdf', 'descargado', ?, ?)",
  ).run(`${de}/PCAP.pdf`, ts);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES ('p-1000', 'u2', 'pcap', 'PCAP.pdf', 'descargado', ?, ?)",
  ).run('Licitaciones/2026/EXP-1 (p-1000)/PCAP.pdf', ts);
  nucleo()
    .db.prepare(
      "INSERT INTO documentos (ruta, dominio, sha256, bytes, registrado_en) VALUES (?, 'licitaciones', 'h', 1, ?)",
    )
    .run(`${de}/PCAP.pdf`, ts);
  const docs = [
    `Conocimiento/${de}/memoria.pdf`,
    `Conocimiento/.gdocs/${de}/acta.docx`,
    'Salidas/Licitaciones/x/memoria.md',
    `Conocimiento/${de}-bis/otro.pdf`,
  ];
  db.prepare(
    "INSERT INTO propuestas (licitacion_id, lote, presentada_en, documentos, creada_en, actualizada_en) VALUES ('p-100', '', '2026-05-01', ?, ?, ?)",
  ).run(JSON.stringify(docs), ts, ts);
  db.prepare(
    "INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en) VALUES ('p-100', ?, '{}', 'h', ?)",
  ).run(`Conocimiento/${de}/PCAP.pdf`, ts);
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES ('p-100', 'aprobada', ?, 'h', ?, ?)",
  ).run(JSON.stringify({ requisitos: [{ documento: `${de}/PCAP.pdf`, pagina: 3 }] }), ts, ts);
  nucleo()
    .db.prepare(
      "INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en) VALUES ('licitaciones.evaluar', 'licitaciones', 'k', ?, 'pendiente', ?, ?)",
    )
    .run(JSON.stringify({ id: 'p-100', documento: `Conocimiento/${de}/PCAP.pdf` }), ts, ts);

  assert.ok(actualizarRutas(db, { de, a }) >= 7);

  const rutas = (db.prepare('SELECT ruta FROM pliegos ORDER BY licitacion_id').all() as { ruta: string }[]).map(
    (x) => x.ruta,
  );
  assert.deepEqual(
    rutas,
    [`${a}/PCAP.pdf`, 'Licitaciones/2026/EXP-1 (p-1000)/PCAP.pdf'],
    'una carpeta con nombre parecido no cambia',
  );
  assert.equal((nucleo().db.prepare('SELECT ruta FROM documentos').get() as { ruta: string }).ruta, `${a}/PCAP.pdf`);
  assert.deepEqual(
    JSON.parse((db.prepare('SELECT documentos FROM propuestas').get() as { documentos: string }).documentos),
    [
      `Conocimiento/${a}/memoria.pdf`,
      `Conocimiento/.gdocs/${a}/acta.docx`,
      'Salidas/Licitaciones/x/memoria.md',
      `Conocimiento/${de}-bis/otro.pdf`,
    ],
  );
  assert.equal(
    (db.prepare('SELECT documento FROM evaluaciones').get() as { documento: string }).documento,
    `Conocimiento/${a}/PCAP.pdf`,
  );
  assert.equal(
    JSON.parse((db.prepare('SELECT datos FROM fichas').get() as { datos: string }).datos).requisitos[0].documento,
    `${a}/PCAP.pdf`,
  );
  assert.equal(
    JSON.parse((nucleo().db.prepare('SELECT payload FROM trabajos_ia').get() as { payload: string }).payload).documento,
    `Conocimiento/${a}/PCAP.pdf`,
  );
  assert.equal(actualizarRutas(db, { de, a }), 0, 'repetirlo no cambia nada');
});

test('should_update_saved_paths_in_the_same_operation_as_the_drive_move', async () => {
  arbolAnterior();
  const ts = new Date().toISOString();
  dbLicitaciones()
    .prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES ('p-100', 'u', 'pcap', 'PCAP.pdf', 'descargado', ?, ?)",
    )
    .run('Licitaciones/2026/EXP-1 (p-100)/PCAP.pdf', ts);
  dbLicitaciones()
    .prepare(
      "INSERT INTO propuestas (licitacion_id, lote, presentada_en, documentos, creada_en, actualizada_en) VALUES ('p-7', '', '2026-05-01', ?, ?, ?)",
    )
    .run(JSON.stringify([`Conocimiento/Licitaciones/${PRESENTADA}/DOCUMENTACION PRESENTADA/memoria.pdf`]), ts, ts);
  await reorganizar();
  assert.equal(
    (dbLicitaciones().prepare('SELECT ruta FROM pliegos').get() as { ruta: string }).ruta,
    'Licitaciones/Radar/2026/EXP-1 (p-100)/PCAP.pdf',
  );
  assert.deepEqual(
    JSON.parse(
      (dbLicitaciones().prepare('SELECT documentos FROM propuestas').get() as { documentos: string }).documentos,
    ),
    [`Conocimiento/Licitaciones/Presentadas/${PRESENTADA}/DOCUMENTACION PRESENTADA/memoria.pdf`],
  );
});

test('should_name_submitted_folders_like_the_team_did', () => {
  assert.equal(
    abreviarOrgano('Complejo Hospitalario Universitario Insular Ejemplo de Gran Canaria'),
    'CHU Insular Ejemplo GC',
  );
  assert.equal(abreviarOrgano('Ayuntamiento de Las Palmas de Gran Canaria'), 'Ayto. LPGC');
  assert.equal(
    temaDe('Contratación del servicio de formación en estadística para el personal del hospital', 30),
    'Formación en estadística',
  );
  const nombre = nombrePresentada({
    presentada_en: '2026-05-12',
    expediente: 'SER/2026/0000003222',
    titulo: 'Servicio de formación en estadística aplicada',
    organo_nombre: 'Complejo Hospitalario Universitario Insular Ejemplo de Gran Canaria',
  });
  assert.equal(nombre, '2026-05 - SER-2026-0000003222 - CHU Insular Ejemplo GC - Formación en estadística aplicada');
  const largo = nombrePresentada({
    presentada_en: '2026-01-02',
    expediente: 'X'.repeat(80),
    titulo: 'Tema: «raro» / con | barras '.repeat(10),
    organo_nombre: 'Órgano',
  });
  assert.ok(largo.length <= 100);
  assert.doesNotMatch(largo, /[\\/:*?"<>|]/);
});

test('should_validate_folder_settings', () => {
  const base = { PLATAFORMA_DATA_DIR: tmp };
  assert.deepEqual(
    [leerConfig(base).licitaciones.carpetaRadar, leerConfig(base).licitaciones.carpetaPresentadas],
    ['Licitaciones/Radar', 'Licitaciones/Presentadas'],
  );
  assert.equal(
    leerConfig({ ...base, LICITACIONES_CARPETA_RADAR: 'Radar PLACSP' }).licitaciones.carpetaRadar,
    'Radar PLACSP',
  );
  for (const [radar, presentadas] of [
    ['Licitaciones/X', 'Licitaciones/X'],
    ['Licitaciones/X', 'Licitaciones/X/Y'],
    ['Licitaciones', 'Licitaciones/P'],
    ['../fuera', 'P'],
    ['.ocultas/R', 'P'],
    ['Colaboradores/R', 'P'],
    ['a\\b', 'P'],
  ]) {
    assert.throws(
      () => leerConfig({ ...base, LICITACIONES_CARPETA_RADAR: radar, LICITACIONES_CARPETA_PRESENTADAS: presentadas }),
      `${radar} y ${presentadas}`,
    );
  }
});

function prepararPresentada(): { carpetaRadar: string } {
  const l = obtenerLicitacion(dbLicitaciones(), SERVICIOS)!;
  const carpetaRadar = carpetaDe(l);
  dbLicitaciones()
    .prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, 'https://contrataciondelestado.es/a.pdf', 'pcap', 'PCAP.pdf', 'descargado', ?, ?)",
    )
    .run(SERVICIOS, `${carpetaRadar}/PCAP.pdf`, new Date().toISOString());
  const r = registrarPropuesta(
    dbLicitaciones(),
    SERVICIOS,
    NuevaPropuesta.parse({ presentada_en: '2026-05-12', importe_ofertado: 100_000 }),
  );
  assert.equal(r.error, null);
  return { carpetaRadar };
}

const nombreServicios = () => carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!.nombre;

test('should_create_the_submitted_folder_in_drive_and_move_the_tender_documents_there', async () => {
  const { carpetaRadar } = prepararPresentada();
  const idRadar = drive.archivo(`Conocimiento/${carpetaRadar}/PCAP.pdf`);
  const carpetaId = drive.nodos.get(idRadar)!.parent;
  drive.archivo(`Conocimiento/${carpetaRadar}/resumen`, DOC);
  assert.equal(await crearCarpetasPresentadas(), 0, 'con la reorganización pendiente espera');
  await reorganizar();
  assert.equal(await crearCarpetasPresentadas(), 1);

  const c = carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!;
  assert.equal(c.estado, 'hecha');
  assert.match(c.nombre, /^2026-05 - E2026016793 - Consejo Gobierno Insular Cabildo/);
  assert.equal(c.ruta, `Licitaciones/Presentadas/${c.nombre}`);
  assert.deepEqual(drive.nombres(`Conocimiento/${c.ruta}`), [
    'DOCUMENTACION PRESENTADA',
    'OTROS DOCUMENTOS',
    'PLIEGOS',
  ]);
  assert.equal(
    drive.id(`Conocimiento/${c.ruta}/PLIEGOS`),
    carpetaId,
    'la carpeta del radar entera pasa a ser PLIEGOS, con sus Google Docs',
  );
  assert.deepEqual(drive.nombres(`Conocimiento/${c.ruta}/PLIEGOS`), ['PCAP.pdf', 'resumen']);
  assert.equal(
    (dbLicitaciones().prepare('SELECT ruta FROM pliegos WHERE licitacion_id = ?').get(SERVICIOS) as { ruta: string })
      .ruta,
    `${c.ruta}/PLIEGOS/PCAP.pdf`,
  );

  registrarPropuesta(dbLicitaciones(), SERVICIOS, NuevaPropuesta.parse({ lote: '', presentada_en: '2026-06-01' }));
  assert.equal(await crearCarpetasPresentadas(), 0, 'una carpeta por licitación');
});

test('should_hold_tender_downloads_until_the_submitted_folder_reaches_the_disk', async () => {
  prepararPresentada();
  await reorganizar();
  await crearCarpetasPresentadas();
  const ruta = carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!.ruta!;
  dbLicitaciones()
    .prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, 'https://contrataciondelestado.es/ppt.pdf', 'ppt', 'PPT.pdf', 'pendiente', ?)",
    )
    .run(SERVICIOS, new Date().toISOString());
  assert.equal(await descargarPendientes(dbLicitaciones(), conocimiento), 0, 'bisync aún no trajo PLIEGOS');
  assert.ok(!drive.llamadas.some((l) => l.includes('contrataciondelestado')));
  fs.mkdirSync(path.join(conocimiento, ruta, 'PLIEGOS'), { recursive: true });
  assert.equal(await descargarPendientes(dbLicitaciones(), conocimiento), 1);
  assert.ok(fs.existsSync(path.join(conocimiento, ruta, 'PLIEGOS', 'PPT.pdf')), 'lo nuevo baja ya a PLIEGOS');
});

test('should_create_the_submitted_folder_on_disk_without_drive_and_never_overwrite', async () => {
  desconectarDrive();
  const { carpetaRadar } = prepararPresentada();
  fs.mkdirSync(path.join(conocimiento, carpetaRadar), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, carpetaRadar, 'PCAP.pdf'), 'pliego');
  const ocupada = path.join(conocimiento, 'Licitaciones', 'Presentadas', nombreServicios());
  fs.mkdirSync(ocupada, { recursive: true });
  fs.writeFileSync(path.join(ocupada, 'de una persona.txt'), 'no tocar');
  // Es de otra licitación con el mismo expediente: no se reutiliza.
  const ts = new Date().toISOString();
  dbLicitaciones()
    .prepare(
      "INSERT INTO carpetas_presentadas (licitacion_id, nombre, ruta, estado, creada_en, actualizada_en) VALUES ('p-otra', 'x', ?, 'hecha', ?, ?)",
    )
    .run(`Licitaciones/Presentadas/${nombreServicios()}`, ts, ts);
  await reorganizar();
  assert.equal(leerReorganizacion().estado, 'sin_drive');
  assert.equal(await crearCarpetasPresentadas(), 1);

  const c = carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!;
  assert.equal(c.ruta, `Licitaciones/Presentadas/${c.nombre}-1`);
  const abs = path.join(conocimiento, c.ruta!);
  assert.deepEqual(fs.readdirSync(abs).sort(), ['DOCUMENTACION PRESENTADA', 'OTROS DOCUMENTOS', 'PLIEGOS']);
  assert.equal(fs.readFileSync(path.join(abs, 'PLIEGOS', 'PCAP.pdf'), 'utf8'), 'pliego');
  assert.equal(fs.existsSync(path.join(conocimiento, carpetaRadar)), false);
  assert.deepEqual(fs.readdirSync(ocupada), ['de una persona.txt']);
  assert.equal(
    (dbLicitaciones().prepare('SELECT ruta FROM pliegos WHERE licitacion_id = ?').get(SERVICIOS) as { ruta: string })
      .ruta,
    `${c.ruta}/PLIEGOS/PCAP.pdf`,
  );
  assert.deepEqual(drive.llamadas, []);
});

test('should_retry_a_failed_submitted_folder_after_fifteen_minutes', async () => {
  const { carpetaRadar } = prepararPresentada();
  drive.archivo(`Conocimiento/${carpetaRadar}/PCAP.pdf`);
  await reorganizar();
  drive.fallar.add(path.posix.basename(carpetaRadar));
  await crearCarpetasPresentadas();
  const fallida = carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!;
  assert.equal(fallida.estado, 'error');
  assert.match(fallida.error ?? '', /GOOGLE_ERROR/);
  drive.fallar.clear();
  assert.equal(await crearCarpetasPresentadas(), 0, 'antes de 15 minutos no se reintenta');
  dbLicitaciones().prepare("UPDATE carpetas_presentadas SET actualizada_en = '2000-01-01T00:00:00Z'").run();
  assert.equal(await crearCarpetasPresentadas(), 1);
  const c = carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!;
  assert.equal(c.estado, 'hecha');
  assert.equal(c.ruta, fallida.ruta, 'el reintento sigue en la carpeta ya creada');
  assert.deepEqual(drive.nombres('Conocimiento/Licitaciones/Presentadas'), [c.nombre]);
});

test('should_show_the_result_in_estado_and_repeat_the_check_on_demand', async () => {
  arbolAnterior();
  const r = await fetch(`${base}/carpetas/reorganizar`, { method: 'POST' });
  assert.equal(r.status, 202);
  await reorganizar();
  const estado = (await (await fetch(`${base}/estado`)).json()) as {
    carpetas: {
      radar: string;
      presentadas: string;
      reorganizacion: { estado: string; movidas: unknown[]; total_omitidas: number; descarga_en_espera: boolean };
    };
  };
  assert.equal(estado.carpetas.radar, 'Licitaciones/Radar');
  assert.equal(estado.carpetas.presentadas, 'Licitaciones/Presentadas');
  assert.equal(estado.carpetas.reorganizacion.estado, 'sincronizando');
  assert.equal(estado.carpetas.reorganizacion.movidas.length, 4);
  assert.equal(estado.carpetas.reorganizacion.total_omitidas, 7);
  assert.equal(estado.carpetas.reorganizacion.descarga_en_espera, true);
});

test('should_point_the_evaluator_to_submitted_proposals_first', () => {
  assert.match(
    instruccionesEvaluacion(SERVICIOS, 'Salidas/x.md'),
    /primero con lo que ya presentamos.*biblioteca_buscar con carpeta «Licitaciones\/Presentadas»/,
  );
});

const DEL_EQUIPO = '2026-03 - E2026016793 - Cabildo - Formación hecha a mano';

test('should_reuse_the_submitted_folder_the_team_already_had_for_that_tender_in_drive', async () => {
  const { carpetaRadar } = prepararPresentada();
  drive.archivo(`Conocimiento/${carpetaRadar}/PCAP.pdf`);
  drive.archivo(`${L}/Presentadas/${DEL_EQUIPO}/PLIEGOS/pliego del equipo.pdf`);
  drive.id(`${L}/Presentadas/2026-03 - E2026016793X - Otro - Parecido`, true);
  await reorganizar();
  assert.equal(await crearCarpetasPresentadas(), 1);
  const c = carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!;
  assert.equal(c.ruta, `Licitaciones/Presentadas/${DEL_EQUIPO}`);
  assert.deepEqual(
    drive.nombres(`${L}/Presentadas`),
    [DEL_EQUIPO, '2026-03 - E2026016793X - Otro - Parecido'],
    'ninguna carpeta nueva',
  );
  const radar = path.posix.basename(carpetaRadar);
  assert.deepEqual(
    drive.nombres(`${L}/Presentadas/${DEL_EQUIPO}/PLIEGOS`),
    [radar, 'pliego del equipo.pdf'],
    'lo del radar entra en su PLIEGOS sin pisar nada',
  );
  assert.equal(
    (dbLicitaciones().prepare('SELECT ruta FROM pliegos WHERE licitacion_id = ?').get(SERVICIOS) as { ruta: string })
      .ruta,
    `${c.ruta}/PLIEGOS/${radar}/PCAP.pdf`,
  );
});

test('should_link_proposals_registered_before_the_folders_existed_on_disk', async () => {
  desconectarDrive();
  const ts = new Date().toISOString();
  dbLicitaciones()
    .prepare(
      "INSERT INTO propuestas (licitacion_id, lote, presentada_en, documentos, creada_en, actualizada_en) VALUES (?, '', '2026-03-10', '[]', ?, ?)",
    )
    .run(SERVICIOS, ts, ts);
  const suya = path.join(conocimiento, 'Licitaciones', 'Presentadas', DEL_EQUIPO);
  fs.mkdirSync(path.join(suya, 'DOCUMENTACION PRESENTADA'), { recursive: true });
  await reorganizar();
  assert.equal(await crearCarpetasPresentadas(), 1, 'la propuesta antigua pide su carpeta');
  const c = carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!;
  assert.equal(c.estado, 'hecha');
  assert.equal(c.ruta, `Licitaciones/Presentadas/${DEL_EQUIPO}`, 'y se enlaza con la que ya había');
  assert.deepEqual(fs.readdirSync(path.join(conocimiento, 'Licitaciones', 'Presentadas')), [DEL_EQUIPO]);
  assert.deepEqual(fs.readdirSync(suya).sort(), ['DOCUMENTACION PRESENTADA', 'OTROS DOCUMENTOS', 'PLIEGOS']);
});

test('should_move_every_folder_with_tender_documents_to_pliegos', async () => {
  const l = obtenerLicitacion(dbLicitaciones(), SERVICIOS)!;
  const nueva = carpetaDe(l);
  const vieja = `Licitaciones/2025/${path.posix.basename(nueva)}`;
  const ts = new Date().toISOString();
  const insertar = dbLicitaciones().prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'pcap', 'x', 'descargado', ?, ?)",
  );
  insertar.run(SERVICIOS, 'https://contrataciondelestado.es/1.pdf', `${nueva}/PCAP.pdf`, ts);
  insertar.run(SERVICIOS, 'https://contrataciondelestado.es/2.pdf', `${vieja}/PPT.pdf`, ts);
  drive.archivo(`Conocimiento/${nueva}/PCAP.pdf`);
  drive.archivo(`Conocimiento/${vieja}/PPT.pdf`);
  registrarPropuesta(dbLicitaciones(), SERVICIOS, NuevaPropuesta.parse({ presentada_en: '2026-05-12' }));
  guardarOperacion(nucleo().db, 'licitaciones.carpetas', 'hecha', {});
  assert.equal(await crearCarpetasPresentadas(), 1);
  const c = carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!;
  assert.deepEqual(drive.nombres(`Conocimiento/${c.ruta}/PLIEGOS`), [path.posix.basename(vieja), 'PCAP.pdf']);
  const rutas = (dbLicitaciones().prepare('SELECT ruta FROM pliegos ORDER BY url').all() as { ruta: string }[]).map(
    (x) => x.ruta,
  );
  assert.deepEqual(rutas, [`${c.ruta}/PLIEGOS/PCAP.pdf`, `${c.ruta}/PLIEGOS/${path.posix.basename(vieja)}/PPT.pdf`]);
});

test('should_retry_when_the_tender_folder_is_on_disk_but_not_yet_in_drive', async () => {
  const { carpetaRadar } = prepararPresentada();
  fs.mkdirSync(path.join(conocimiento, carpetaRadar), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, carpetaRadar, 'PCAP.pdf'), 'pliego');
  guardarOperacion(nucleo().db, 'licitaciones.carpetas', 'hecha', {});
  await crearCarpetasPresentadas();
  const c = carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)!;
  assert.equal(c.estado, 'error', 'no se da por hecha con un PLIEGOS vacío');
  assert.match(c.error ?? '', /PENDIENTE_SYNC/);
  assert.deepEqual(drive.nombres(`Conocimiento/${c.ruta}`), ['DOCUMENTACION PRESENTADA', 'OTROS DOCUMENTOS']);
});

test('should_cancel_a_submitted_folder_not_created_yet_when_the_last_proposal_is_deleted', () => {
  const r = registrarPropuesta(dbLicitaciones(), SERVICIOS, NuevaPropuesta.parse({ presentada_en: '2026-05-12' }));
  assert.equal(carpetaPresentadaDe(dbLicitaciones(), SERVICIOS)?.estado, 'pendiente');
  borrarPropuesta(dbLicitaciones(), r.data!.id);
  assert.equal(carpetaPresentadaDe(dbLicitaciones(), SERVICIOS), null);
});

test('should_download_next_to_the_tender_documents_already_downloaded', () => {
  const l = obtenerLicitacion(dbLicitaciones(), SERVICIOS)!;
  assert.equal(carpetaPliegos(dbLicitaciones(), l), carpetaDe(l), 'sin ninguno, la carpeta del radar');
  dbLicitaciones()
    .prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, 'u', 'pcap', 'x', 'descargado', ?, ?)",
    )
    .run(SERVICIOS, 'Licitaciones/2026/E2026016793 (p-20435341)/PCAP.pdf', new Date().toISOString());
  assert.equal(
    carpetaPliegos(dbLicitaciones(), l),
    'Licitaciones/2026/E2026016793 (p-20435341)',
    'sin reorganizar aún, junto a los que ya tiene',
  );
});

test('should_not_let_waiting_tenders_block_the_downloads_of_the_rest', async () => {
  const otra = (
    dbLicitaciones().prepare('SELECT id FROM licitaciones WHERE id <> ? LIMIT 1').get(SERVICIOS) as { id: string }
  ).id;
  const ts = new Date().toISOString();
  dbLicitaciones()
    .prepare(
      "INSERT INTO carpetas_presentadas (licitacion_id, nombre, ruta, estado, creada_en, actualizada_en) VALUES (?, 'x', 'Licitaciones/Presentadas/x', 'hecha', ?, ?)",
    )
    .run(SERVICIOS, ts, ts);
  const insertar = dbLicitaciones().prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, ?, 'adicional', ?, 'pendiente', ?)",
  );
  for (let i = 0; i < 4; i++)
    insertar.run(SERVICIOS, `https://contrataciondelestado.es/${i}.pdf`, `${i}.pdf`, `2000-01-0${i + 1}T00:00:00Z`);
  insertar.run(otra, 'https://contrataciondelestado.es/libre.pdf', 'libre.pdf', ts);
  // Solo se baja lo que sigue la empresa y sigue abierto (o lo que prepara): esta, en preparación.
  dbLicitaciones()
    .prepare(
      `INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, 'en_preparacion', ?, ?)
    ON CONFLICT(licitacion_id) DO UPDATE SET estado = 'en_preparacion'`,
    )
    .run(otra, ts, ts);
  assert.equal(await descargarPendientes(dbLicitaciones(), conocimiento), 1, 'baja el de la otra licitación');
  assert.equal(
    (dbLicitaciones().prepare('SELECT estado FROM pliegos WHERE licitacion_id = ?').get(otra) as { estado: string })
      .estado,
    'descargado',
  );
});

test('should_link_the_tender_and_offer_folders_in_drive_once_they_exist', async () => {
  const ir = async (carpeta: string) => {
    const r = await fetch(`${base}/licitaciones/${SERVICIOS}/drive/${carpeta}`);
    return { status: r.status, cuerpo: (await r.json()) as { url?: string; ruta?: string; message?: string } };
  };
  const sinPliegos = await ir('pliegos');
  assert.deepEqual(
    [sinPliegos.status, sinPliegos.cuerpo.message],
    [404, 'Aún no hay pliegos descargados de esta licitación.'],
  );
  dbLicitaciones()
    .prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, 'u', 'pcap', 'x', 'descargado', ?, ?)",
    )
    .run(SERVICIOS, 'Licitaciones/Radar/2026/E2026016793 (p-20435341)/PCAP.pdf', new Date().toISOString());
  const aunNo = await ir('pliegos');
  assert.equal(aunNo.status, 404);
  assert.match(aunNo.cuerpo.message ?? '', /drive-sync la sube en su siguiente vuelta/);

  const pliegos = drive.id(`${L}/Radar/2026/E2026016793 (p-20435341)`, true)!;
  assert.deepEqual((await ir('pliegos')).cuerpo, {
    url: `https://drive.google.com/drive/folders/${pliegos}`,
    ruta: 'Licitaciones/Radar/2026/E2026016793 (p-20435341)',
  });
  const llamadas = drive.llamadas.length;
  assert.equal((await ir('pliegos')).status, 200);
  assert.equal(drive.llamadas.length, llamadas, 'el id se recuerda: no vuelve a recorrer Drive');

  const oferta = drive.id('Salidas/Licitaciones/E2026016793 (p-20435341)', true)!;
  assert.deepEqual((await ir('oferta')).cuerpo, {
    url: `https://drive.google.com/drive/folders/${oferta}`,
    ruta: 'Salidas/Licitaciones/E2026016793 (p-20435341)',
  });
  assert.equal(drive.cambios.length, 0, 'buscar no crea carpetas');

  assert.equal((await ir('otra')).status, 400);
  desconectarDrive();
  const sinDrive = await ir('oferta');
  assert.deepEqual(
    [sinDrive.status, sinDrive.cuerpo.message],
    [503, 'Drive no está conectado: conéctalo en Ajustes › Drive.'],
  );
});
