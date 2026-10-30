// Descargas de la PLACSP: las redirecciones se validan salto a salto (nunca se pide un
// destino fuera de la lista) y el cuerpo se corta al pasar del tope. fetch se simula en la
// frontera HTTP. Lo bajado se reconoce por su firma (un ZIP que guarda un PDF sin comprimir
// no es un PDF) y los ZIP que ya se guardaron como «.pdf» se descomprimen una sola vez.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import { leerConTope, pedirPermitida } from '../../src/dominios/licitaciones/placsp/descarga.js';
import { esUrlDePlataforma, esUrlDePliego } from '../../src/dominios/licitaciones/placsp/fuentes.js';
import { descargarPagina } from '../../src/dominios/licitaciones/sincronizar.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'descarga-'));
const conocimiento = path.join(tmp, 'conocimiento');
fs.mkdirSync(conocimiento);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.VAULT_PATH = conocimiento;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { repararZipsComoPdf, tipoDeDocumento } = await import('../../src/dominios/licitaciones/pliegos.js');
const { licitacion } = await import('../helpers/sinteticas.js');

iniciarNucleo();
const fetchReal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchReal;
});
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const PLACSP = 'https://contrataciondelestado.es/sindicacion/feed.atom';

// Cada URL responde lo que diga el mapa; se apunta qué se pidió y con qué «redirect».
function simular(mapa: Record<string, () => Response>) {
  const pedidas: { url: string; redirect: RequestInit['redirect'] }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    pedidas.push({ url: String(url), redirect: init?.redirect });
    const r = mapa[String(url)];
    return r ? r() : new Response('no', { status: 404 });
  }) as typeof fetch;
  return pedidas;
}

const redirige = (a: string) => () => new Response(null, { status: 302, headers: { location: a } });

test('should_not_request_a_redirect_target_outside_the_allowed_platforms', async () => {
  const pedidas = simular({ [PLACSP]: redirige('https://malicioso.example/feed.atom') });
  const r = await pedirPermitida(PLACSP, {}, esUrlDePlataforma);
  assert.equal(r.error?.code, 'url_no_permitida');
  assert.deepEqual(
    pedidas.map((p) => p.url),
    [PLACSP],
    'el destino de fuera no se llega a pedir',
  );
  assert.equal(pedidas[0]?.redirect, 'manual');
});

test('should_follow_relative_redirects_inside_the_allowed_platforms', async () => {
  const final = 'https://contrataciondelestado.es/otra/pagina.atom';
  simular({ [PLACSP]: redirige('/otra/pagina.atom'), [final]: () => new Response('<feed/>', { status: 200 }) });
  const r = await pedirPermitida(PLACSP, {}, esUrlDePlataforma);
  assert.equal(r.error, null);
  assert.equal(await r.data?.text(), '<feed/>');
});

test('should_give_up_after_three_redirects', async () => {
  const salto = (n: number) => `https://contrataciondelestado.es/salto/${n}`;
  simular(Object.fromEntries([0, 1, 2, 3, 4].map((n) => [n === 0 ? PLACSP : salto(n), redirige(salto(n + 1))])));
  assert.equal((await pedirPermitida(PLACSP, {}, esUrlDePlataforma)).error?.code, 'demasiadas_redirecciones');
});

test('should_fail_without_throwing_when_the_platform_is_unreachable', async () => {
  globalThis.fetch = (async () => {
    throw new Error('ECONNRESET');
  }) as typeof fetch;
  assert.equal((await pedirPermitida(PLACSP, {}, esUrlDePlataforma)).error?.code, 'placsp_inalcanzable');
});

test('should_refuse_a_feed_page_that_redirects_out_of_the_placsp', async () => {
  simular({ [PLACSP]: redirige('https://www.contratacion.euskadi.eus/feed.atom') });
  assert.equal(
    (await descargarPagina(PLACSP, null)).error?.code,
    'url_no_permitida',
    'una autonómica vale para pliegos, no para el feed',
  );
  assert.equal(esUrlDePliego('https://www.contratacion.euskadi.eus/feed.atom'), true);
});

test('should_stop_reading_a_body_without_content_length_once_it_exceeds_the_limit', async () => {
  let enviados = 0;
  const cuerpo = new ReadableStream<Uint8Array>({
    pull(c) {
      enviados += 1;
      c.enqueue(new Uint8Array(1024));
      if (enviados === 100) c.close();
    },
  });
  const r = await leerConTope(new Response(cuerpo), 4 * 1024);
  assert.equal(r.error?.code, 'demasiado_grande');
  assert.ok(enviados < 100, 'no se lee entero');
  const pequeno = await leerConTope(new Response('hola'), 1024);
  assert.equal(pequeno.data?.toString('utf8'), 'hola');
});

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF', 'latin1');
// Un ZIP que guarda el PDF sin comprimir: «%PDF-» aparece en su primer KB.
const zipConPdf = () => zipSync({ 'x.pdf': [new Uint8Array(PDF), { level: 0 }] });

test('should_detect_zip_with_stored_pdf_by_signature', () => {
  // Arrange
  const bytes = zipConPdf();
  assert.ok(Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-'), 'el PDF va sin comprimir');
  // Act
  const tipo = tipoDeDocumento(bytes, 'Pliego.pdf');
  // Assert
  assert.equal(tipo.data, '.zip');
});

test('should_still_detect_real_pdf', () => {
  // Arrange
  const conBasuraDelante = Buffer.concat([Buffer.from('\xEF\xBB\xBF\r\n', 'latin1'), PDF]);
  // Act / Assert
  assert.equal(tipoDeDocumento(PDF, 'pliego.docx').data, '.pdf');
  assert.equal(tipoDeDocumento(conBasuraDelante, 'pliego.pdf').data, '.pdf');
});

// Un ZIP bajado antes del arreglo: guardado en disco como «.pdf» y registrado como descargado.
function zipGuardadoComoPdf(): { id: string; url: string; abs: string } {
  const l = licitacion({
    titulo: 'Servicio de análisis de datos',
    publicada: '2026-10-01',
    limite: '2026-10-20T14:00:00',
  });
  guardarLicitacion(dbLicitaciones(), l);
  const ruta = `Licitaciones/Radar/2026/${l.id}/Pliego.pdf`;
  const abs = path.join(conocimiento, ruta);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, zipConPdf());
  const url = `https://contrataciondelestado.es/doc/${l.id}`;
  dbLicitaciones()
    .prepare(
      `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en)
    VALUES (?, ?, 'pcap', 'Pliego.pdf', 'descargado', ?, 'x')`,
    )
    .run(l.id, url, ruta);
  return { id: l.id, url, abs };
}

type FilaPliego = { url: string; estado: string; ruta: string | null; origen: string; padre_url: string | null };
const filasDe = (id: string) =>
  dbLicitaciones()
    .prepare('SELECT url, estado, ruta, origen, padre_url FROM pliegos WHERE licitacion_id = ? ORDER BY rowid')
    .all(id) as FilaPliego[];

test('should_unzip_already_saved_zip_named_pdf_and_mark_it_descomprimido', async () => {
  // Arrange
  const { id, url, abs } = zipGuardadoComoPdf();
  // Act
  const r = await repararZipsComoPdf(dbLicitaciones(), conocimiento);
  // Assert
  assert.equal(r.error, null);
  assert.equal(r.data, 1);
  const [zip, entrada] = filasDe(id);
  assert.deepEqual({ estado: zip?.estado, ruta: zip?.ruta }, { estado: 'descomprimido', ruta: null });
  assert.equal(entrada?.origen, 'zip');
  assert.equal(entrada?.padre_url, url);
  assert.equal(entrada?.url, `${url}#x.pdf`);
  assert.ok(entrada?.ruta?.endsWith('.pdf'));
  assert.ok(
    fs.readFileSync(path.join(conocimiento, entrada!.ruta!)).subarray(0, 5).toString('latin1') === '%PDF-',
    'el documento de dentro es legible',
  );
  assert.ok(fs.existsSync(abs), 'el .pdf original no se borra');
});

test('should_be_idempotent_when_repairing_twice', async () => {
  // Arrange
  const { id } = zipGuardadoComoPdf();
  await repararZipsComoPdf(dbLicitaciones(), conocimiento);
  const antes = filasDe(id);
  // Act
  const r = await repararZipsComoPdf(dbLicitaciones(), conocimiento);
  // Assert
  assert.equal(r.data, 0);
  assert.deepEqual(filasDe(id), antes);
});
