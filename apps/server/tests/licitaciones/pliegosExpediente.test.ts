// Documentos extra de la PLACSP: la página del expediente lista anuncios, rectificaciones y
// «Otros documentos» que el feed no trae (o no traía: CASO_E, ingerida antes del mapper v2, tenía
// publicada una nota de rectificación que exige el ENS y nadie la veía). Se leen de la página,
// entran en la cola de pliegos y los baja la descarga de siempre; hasta que la página se revisa
// bien, lo de esos datos no se da por completo. La red se simula en fetch (sin conexión) y la
// página del expediente de CASO_E es sintética, con el marcado de la PLACSP (fixtures/documentos/expedienteCasoE.ts).
import { test, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { paginaExpedienteCasoE } from './fixtures/documentos/expedienteCasoE.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pliegos-expediente-'));
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
const { descargarPendientes } = await import('../../src/dominios/licitaciones/pliegos.js');
const { completitudPliegos } = await import('../../src/dominios/licitaciones/pliegosCompletitud.js');
const { revisarExpedientes, revisionExpediente } = await import('../../src/dominios/licitaciones/pliegosExpediente.js');
const { documentosDelExpediente, esPaginaDeExpediente } =
  await import('../../src/dominios/licitaciones/placsp/expediente.js');
const { coherenciaOferta } = await import('../../src/dominios/licitaciones/oferta/coherencia.js');
const { hoyLicitaciones } = await import('../../src/dominios/licitaciones/hoy.js');
const { licitacion } = await import('../helpers/sinteticas.js');

iniciarNucleo();
const db = dbLicitaciones();
const fetchReal = globalThis.fetch;
const PAGINA = paginaExpedienteCasoE();

after(() => {
  globalThis.fetch = fetchReal;
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});
// Cada test revisa solo lo suyo: la vuelta recorre todo lo que está en preparación.
beforeEach(() =>
  db.exec("DELETE FROM pliegos; DELETE FROM expedientes_placsp; UPDATE oportunidades SET estado = 'descartada'"),
);
afterEach(() => {
  globalThis.fetch = fetchReal;
});

const AHORA = Date.parse('2026-10-14T10:00:00Z');
const HORA = 60 * 60_000;
const DOC =
  'https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?cifrado=anonimo&DocumentIdParam=';
const PDF = (t: string) => `%PDF-1.7\n${t}`;

let n = 0;
// Como CASO_E: ingerida con el mapper anterior (sin «mapper» en los datos), con las Bases bajadas.
function preparada(opciones: { estado?: string; limite?: string; datosAntiguos?: boolean } = {}): {
  id: string;
  url: string;
  bases: string;
} {
  const l = licitacion({
    titulo: `Formación en salud ${++n}`,
    publicada: '2026-09-24',
    limite: opciones.limite ?? '2026-10-15T08:00:00',
  });
  const bases = `${DOC}bases-${n}`;
  guardarLicitacion(db, { ...l, documentos: [{ clase: 'pcap', nombre: 'Bases.pdf', url: bases, hash: null }] });
  if (opciones.datosAntiguos !== false) {
    const { mapper: _m, ...antiguos } = JSON.parse(
      (db.prepare('SELECT datos FROM licitaciones WHERE id = ?').get(l.id) as { datos: string }).datos,
    ) as Record<string, unknown>;
    db.prepare('UPDATE licitaciones SET datos = ? WHERE id = ?').run(JSON.stringify(antiguos), l.id);
  }
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, ?, 'x', 'x')",
  ).run(l.id, opciones.estado ?? 'en_preparacion');
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, sha256, actualizado_en) VALUES (?, ?, 'pcap', 'Bases.pdf', 'descargado', ?, ?, 'x')",
  ).run(l.id, bases, `Licitaciones/Radar/2026/${l.id}/Bases.pdf`, 'sha-bases');
  return { id: l.id, url: l.url!, bases };
}

// Cada URL devuelve lo suyo y se apunta qué se pidió; lo demás, 404.
function red(respuestas: Record<string, () => Response>): string[] {
  const pedidas: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    pedidas.push(url);
    return respuestas[url]?.() ?? new Response('no', { status: 404 });
  }) as typeof fetch;
  return pedidas;
}
const html = (cuerpo: string) => () =>
  new Response(cuerpo, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });
const pdf = (texto: string) => () =>
  new Response(Buffer.from(PDF(texto), 'latin1'), { status: 200, headers: { 'content-type': 'application/pdf' } });
const PORTAL = 'https://contrataciondelestado.es/wps/portal/plataforma/buscadores/detalle/!ut/p/z1/anonimo';
// El enlace del feed (deeplink) redirige al portal, como en la PLACSP.
const aPortal = () => new Response(null, { status: 302, headers: { location: PORTAL } });

type Fila = { url: string; clase: string; nombre: string; estado: string; origen: string; ruta: string | null };
const delExpediente = (id: string) =>
  db
    .prepare(
      "SELECT url, clase, nombre, estado, origen, ruta FROM pliegos WHERE licitacion_id = ? AND origen = 'expediente' ORDER BY rowid",
    )
    .all(id) as Fila[];

test('should_list_the_pdf_of_every_notice_and_every_other_document_published_on_the_expedient_page', () => {
  const docs = documentosDelExpediente(PAGINA);

  assert.deepEqual(
    docs.map((d) => [d.clase, d.nombre, d.url, d.publicado]),
    [
      ['anuncio', 'Rectificación de Anuncio de Licitación 29-09-2027 1205.pdf', `${DOC}doc-03`, '2027-09-29T12:05'],
      ['anuncio', 'Anuncio de Licitación 22-09-2027 1015.pdf', `${DOC}doc-06`, '2027-09-22T10:15'],
      ['anuncio', 'Rectificación de Pliego 29-09-2027 1210.pdf', `${DOC}doc-09`, '2027-09-29T12:10'],
      ['otro', 'Documento de aprobación del expediente 22-09-2027 1025', `${DOC}doc-10`, '2027-09-22T10:25'],
      ['otro', 'Composición de la mesa de contratación 22-09-2027 1026', `${DOC}doc-11`, '2027-09-22T10:26'],
      ['otro', 'Memoria justificativa 22-09-2027 1027', `${DOC}doc-12`, '2027-09-22T10:27'],
      ['otro', 'Rectificación de errores materiales del pliego 29-09-2027 1155', `${DOC}doc-13`, '2027-09-29T11:55'],
    ],
    'del anuncio, solo el pdf (también el de la versión anterior); el pliego histórico sin enlaces no cuenta',
  );
  assert.equal(esPaginaDeExpediente(PAGINA), true);
});

test('should_ignore_links_outside_the_platform_commented_rows_and_pages_without_a_documents_table', () => {
  const fila = (
    href: string,
    extra = '',
  ) => `<tr class="rowClass1"><td>01/10/2026 13:36</td><td><span id="x:textStipo1PadreGen">Aclaración</span></td>
    <td><a href="${href}" id="x:linkVerDocPadreGen"><img src="/wps/PA_PortletsPlace/imagenes/lupa-icon.png" /></a>${extra}</td></tr>`;
  const pagina = `<table id="myTablaDetalleVISUOE"><tbody>
    ${fila('https://contrataciondelestado.es.evil.example/doc')}
    ${fila('http://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?DocumentIdParam=x')}
    <!-- ${fila(`${DOC}comentado`)} -->
    ${fila(`${DOC}aclaracion`)}
    ${fila(`${DOC}aclaracion`)}
  </tbody></table>`;

  assert.deepEqual(
    documentosDelExpediente(pagina).map((d) => [d.clase, d.nombre, d.url]),
    [['otro', 'Aclaración 01-10-2026 1336', `${DOC}aclaracion`]],
  );
  assert.equal(esPaginaDeExpediente('<html><body>Sesión caducada</body></html>'), false);
  assert.deepEqual(documentosDelExpediente('<html><body>Sesión caducada</body></html>'), []);
});

test('should_queue_and_download_the_documents_the_feed_lacks_and_then_count_the_pliegos_as_checked', async () => {
  const { id, url } = preparada();
  assert.deepEqual(
    [completitudPliegos(db, id)!.sin_comprobar, completitudPliegos(db, id)!.completa],
    [true, null],
    'antes: sin comprobar, no completa',
  );
  const pedidas = red({ [url]: aPortal, [PORTAL]: html(PAGINA) });

  assert.equal(await revisarExpedientes(db, AHORA), 7);

  assert.deepEqual(pedidas, [url, PORTAL], 'sigue la redirección dentro de la PLACSP');
  const filas = delExpediente(id);
  assert.equal(filas.length, 7);
  assert.ok(
    filas.every((f) => f.estado === 'pendiente'),
    'en cola para la descarga de siempre',
  );
  assert.deepEqual(revisionExpediente(db, id), {
    revisado_en: new Date(AHORA).toISOString(),
    comprobado_en: new Date(AHORA).toISOString(),
    documentos: 7,
    error: null,
  });
  const antes = completitudPliegos(db, id)!;
  assert.deepEqual(
    [antes.sin_comprobar, antes.completa, antes.publicados, antes.descargados],
    [false, false, 8, 1],
    'comprobado: falta lo que la página publica',
  );
  assert.ok(
    antes.faltan.some(
      (f) => f.nombre === 'Rectificación de errores materiales del pliego 29-09-2027 1155' && f.motivo === 'pendiente',
    ),
  );
  const bloquea = coherenciaOferta(db, id).filter((i) => i.tipo === 'pliegos' && i.gravedad === 'bloquea');
  assert.match(
    bloquea[0]?.mensaje ?? '',
    /Rectificación de errores materiales del pliego/,
    'una rectificación sin bajar bloquea la oferta',
  );

  red(Object.fromEntries(filas.map((f) => [f.url, pdf(f.nombre)])));
  assert.equal(await descargarPendientes(db, conocimiento, 10, AHORA), 7);

  const nota = delExpediente(id).find((f) => f.nombre.startsWith('Rectificación de errores materiales'))!;
  assert.equal(path.posix.basename(nota.ruta!), 'Rectificación de errores materiales del pliego 29-09-2027 1155.pdf');
  assert.ok(fs.existsSync(path.join(conocimiento, nota.ruta!)));
  const despues = completitudPliegos(db, id)!;
  assert.deepEqual([despues.completa, despues.publicados, despues.descargados, despues.faltan], [true, 8, 8, []]);
});

test('should_revisit_the_page_every_few_hours_without_duplicating_what_is_already_queued', async () => {
  const { id, url } = preparada();
  const pedidas = red({ [url]: html(PAGINA) });
  await revisarExpedientes(db, AHORA);

  assert.equal(await revisarExpedientes(db, AHORA + HORA), 0);
  assert.equal(pedidas.length, 1, 'a la hora no se vuelve a pedir');
  assert.equal(await revisarExpedientes(db, AHORA + 7 * HORA), 0, 'a las seis horas se vuelve a mirar: nada nuevo');
  assert.equal(pedidas.length, 2);
  assert.equal(delExpediente(id).length, 7);
});

test('should_keep_the_pliegos_unchecked_and_say_why_when_the_page_cannot_be_read', async () => {
  const { id, url } = preparada();
  red({ [url]: () => new Response('Service Unavailable', { status: 503, statusText: 'Service Unavailable' }) });

  assert.equal(await revisarExpedientes(db, AHORA), 0);

  const c = completitudPliegos(db, id)!;
  assert.deepEqual(
    [c.sin_comprobar, c.completa, c.faltan.length],
    [true, null, 0],
    'no falta nada de lo que consta, pero no se da por completa',
  );
  assert.equal(c.expediente?.error, 'placsp_http_503: Service Unavailable');
  const avisos = coherenciaOferta(db, id)
    .filter((i) => i.tipo === 'pliegos')
    .map((i) => i.mensaje);
  assert.ok(
    avisos.some((m) =>
      /No se ha comprobado si la PLACSP publica más documentos.*no se puede dar por completo.*falló \(placsp_http_503/.test(
        m,
      ),
    ),
    'la coherencia lo dice',
  );

  red({ [url]: html('<html><body>Mantenimiento</body></html>') });
  await revisarExpedientes(db, AHORA + 7 * HORA);
  assert.match(
    revisionExpediente(db, id)?.error ?? '',
    /^no_es_expediente/,
    'una página sin tabla de documentos no cuenta como revisada',
  );
  assert.equal(completitudPliegos(db, id)!.sin_comprobar, true);
});

test('should_not_follow_a_redirect_out_of_the_platform', async () => {
  const { id, url } = preparada();
  const pedidas = red({
    [url]: () => new Response(null, { status: 302, headers: { location: 'https://evil.example/detalle' } }),
  });

  await revisarExpedientes(db, AHORA);

  assert.deepEqual(pedidas, [url]);
  assert.match(revisionExpediente(db, id)?.error ?? '', /^url_no_permitida/);
  assert.equal(delExpediente(id).length, 0);
});

test('should_only_visit_tenders_in_preparation_still_open', async () => {
  const nueva = preparada({ estado: 'nueva' });
  const vencida = preparada({ limite: '2026-10-01T08:00:00' });
  const pedidas = red({});

  assert.equal(await revisarExpedientes(db, AHORA), 0);

  assert.deepEqual(pedidas, []);
  assert.equal(revisionExpediente(db, nueva.id), null);
  assert.equal(revisionExpediente(db, vencida.id), null);
});

test('should_point_a_document_published_twice_to_the_copy_already_in_drive', async () => {
  // La memoria justificativa del feed (v2) y la de la página tienen URLs distintas y los mismos bytes.
  const { id, url } = preparada({ datosAntiguos: false });
  const delFeed = `${DOC}memoria-feed-${id}`;
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, ?, 'otro', 'Memoria justificativa', 'pendiente', '2000-01-01')",
  ).run(id, delFeed);
  red({ [url]: html(PAGINA) });
  await revisarExpedientes(db, AHORA);
  const resto = delExpediente(id).filter((f) => !f.nombre.startsWith('Memoria'));
  red({
    [delFeed]: pdf('memoria'),
    [`${DOC}doc-12`]: pdf('memoria'),
    ...Object.fromEntries(resto.map((f) => [f.url, pdf(f.nombre)])),
  });

  assert.equal(await descargarPendientes(db, conocimiento, 1, AHORA), 1, 'primero la del feed');
  await descargarPendientes(db, conocimiento, 20, AHORA);

  const rutas = db
    .prepare("SELECT ruta FROM pliegos WHERE licitacion_id = ? AND nombre LIKE 'Memoria justificativa%'")
    .all(id) as { ruta: string }[];
  assert.equal(rutas.length, 2);
  assert.equal(new Set(rutas.map((r) => r.ruta)).size, 1, 'una sola copia en Drive');
});

const filaOtro = (
  enlace: string,
) => `<tr class="rowClass1"><td>01/10/2026 13:36</td><td><span id="x:textStipo1PadreGen">Aclaración</span></td>
  <td>${enlace}</td></tr>`;
const tabla = (filas: string) => `<table id="myTablaDetalleVISUOE"><tbody>${filas}</tbody></table>`;

test('should_resolve_relative_links_accept_single_quotes_and_decode_ampersands_in_the_url', () => {
  const relativo = filaOtro(
    '<a href="/FileSystem/servlet/GetDocumentByIdServlet?a=1&amp;b=2&#38;c=3&#x26;d=4"><img src="/x/lupa-icon.png" /></a>',
  );
  const simples = filaOtro(`<a id='x' href='${DOC}simples'><img src="/x/lupa-icon.png" /></a>`);

  const docs = documentosDelExpediente(
    tabla(relativo + simples),
    'https://contrataciondelestado.es/wps/portal/detalle',
  );

  assert.deepEqual(
    docs.map((d) => d.url),
    ['https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?a=1&b=2&c=3&d=4', `${DOC}simples`],
  );
});

test('should_not_count_a_page_without_readable_documents_as_checked', async () => {
  const { id, url } = preparada();
  red({ [url]: html(tabla('')) });

  const r = await revisarExpedientes(db, AHORA);

  assert.equal(r, 0);
  const rev = revisionExpediente(db, id)!;
  assert.match(rev.error ?? '', /^expediente_sin_documentos/);
  assert.equal(rev.comprobado_en, null, 'no se apunta como comprobada');
  assert.equal(completitudPliegos(db, id)!.sin_comprobar, true);
});

test('should_process_unclosed_tags_in_linear_time_and_cap_the_rows', () => {
  const sinCerrar = '<table id="myTablaDetalleVISUOE">' + '<tr>'.repeat(50_000);
  const enlacesSinCerrar = tabla('<tr><td><a href="/x">'.repeat(30_000));
  const muchasFilas = tabla(filaOtro(`<a href="${DOC}1"></a>`).repeat(5_000));

  const t0 = Date.now();
  const a = documentosDelExpediente(sinCerrar);
  const b = documentosDelExpediente(enlacesSinCerrar);
  documentosDelExpediente(muchasFilas);
  const scripts = documentosDelExpediente('<script>'.repeat(50_000));
  const comentarios = documentosDelExpediente('<!--'.repeat(50_000));

  assert.ok(Date.now() - t0 < 1000, `tardó ${Date.now() - t0} ms`);
  assert.deepEqual([a, b, scripts, comentarios], [[], [], [], []]);
});

test('should_not_trust_a_stale_check_when_later_reviews_keep_failing', async () => {
  const { id, url } = preparada();
  red({ [url]: aPortal, [PORTAL]: html(PAGINA) });
  await revisarExpedientes(db, AHORA);
  assert.equal(completitudPliegos(db, id, AHORA)!.sin_comprobar, false, 'recién comprobada');
  red({ [url]: () => new Response('no', { status: 503, statusText: 'Service Unavailable' }) });
  await revisarExpedientes(db, AHORA + 7 * HORA);

  assert.equal(
    completitudPliegos(db, id, AHORA + 8 * HORA)!.sin_comprobar,
    false,
    'un solo fallo reciente no la invalida',
  );
  const c = completitudPliegos(db, id, AHORA + 13 * HORA)!;
  assert.deepEqual([c.sin_comprobar, c.completa], [true, null]);
  assert.match(c.expediente?.error ?? '', /^placsp_http_503/, 'el aviso lleva el código del fallo');
  const hoy = hoyLicitaciones(db, '2000-01-01T00:00:00Z', AHORA + 13 * HORA).por_aprobar.find(
    (p) => p.enlace.id === `${id}/pliegos`,
  );
  assert.match(
    hoy?.detalle ?? '',
    /la comprobación de la página del expediente falla \(placsp_http_503/,
    'Hoy dice el código y el motivo real',
  );
  assert.doesNotMatch(hoy?.detalle ?? '', /anteriores a leer/);
});
