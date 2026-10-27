// Pliegos completos: lo que la empresa prepara (o tiene la ficha pedida) baja todo lo publicado, sin
// tope y con cualquier extensión; un ZIP se descomprime en un pliego por anexo; la petición del
// DEUC se guarda y se marca; los fallos pasajeros se reintentan con espera creciente hasta el
// plazo; y la licitación y «Hoy» dicen qué falta. La red se simula en fetch (sin conexión).
import { test, after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pliegos-completos-'));
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
const {
  colaDePliegos,
  descargaCompleta,
  descargarPendientes,
  encolarPliegos,
  encolarPliegosNuevos,
  tipoDeDocumento,
  trasFallo,
} = await import('../../src/dominios/licitaciones/pliegos.js');
const { completitudPliegos, faltanConAviso } = await import('../../src/dominios/licitaciones/pliegosCompletitud.js');
const { detalle } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { hoyLicitaciones } = await import('../../src/dominios/licitaciones/hoy.js');
const { licitacion } = await import('../helpers/sinteticas.js');
type LicitacionData = import('../../src/dominios/licitaciones/placsp/mapper.js').LicitacionData;

iniciarNucleo();
const db = dbLicitaciones();
const fetchReal = globalThis.fetch;

after(() => {
  globalThis.fetch = fetchReal;
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});
// Cada test baja solo lo suyo: la cola es de todas las licitaciones.
beforeEach(() => db.exec('DELETE FROM pliegos'));
afterEach(() => {
  globalThis.fetch = fetchReal;
});

const AHORA = Date.parse('2026-10-14T10:00:00Z');
const LIMITE = '2026-10-20T14:00:00';
const URL = 'https://contrataciondelestado.es/FileSystem/servlet/GetDocumentByIdServlet?DocumentIdParam=';
type Doc = LicitacionData['documentos'][number];
const doc = (clase: Doc['clase'], nombre: string, url = `${URL}${encodeURIComponent(nombre)}`): Doc => ({
  clase,
  nombre,
  url,
  hash: null,
});

let n = 0;
function conDocumentos(estado: string, documentos: Doc[], limite = LIMITE): string {
  const l = licitacion({ titulo: `Formación en datos ${++n}`, publicada: '2026-10-01', limite });
  guardarLicitacion(db, { ...l, documentos });
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, ?, 'x', 'x')",
  ).run(l.id, estado);
  return l.id;
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
const responde =
  (cuerpo: Uint8Array | string, tipo = 'application/octet-stream') =>
  () =>
    new Response(typeof cuerpo === 'string' ? Buffer.from(cuerpo, 'latin1') : cuerpo, {
      status: 200,
      headers: { 'content-type': tipo },
    });

const PDF = '%PDF-1.7\n1 0 obj';
const docx = (texto: string) =>
  zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(`<w:document>${texto}</w:document>`),
  });
const DEUC =
  '<?xml version="1.0" encoding="UTF-8"?>\n<espd-req:ESPDRequest xmlns:espd-req="urn:grow:names:specification:ubl:schema:xsd:ESPDRequest-1"><cbc:ID>Lote 3</cbc:ID></espd-req:ESPDRequest>';
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

type Fila = {
  url: string;
  clase: string;
  nombre: string;
  estado: string;
  ruta: string | null;
  origen: string;
  padre_url: string | null;
  tipo: string | null;
  intentos: number;
  error: string | null;
  proximo_intento_en: string | null;
};
const filas = (id: string) =>
  db
    .prepare(
      `SELECT url, clase, nombre, estado, ruta, origen, padre_url, tipo, intentos, error, proximo_intento_en
  FROM pliegos WHERE licitacion_id = ? ORDER BY rowid`,
    )
    .all(id) as Fila[];
const fila = (id: string, nombre: string) => filas(id).find((f) => f.nombre === nombre)!;
const enDisco = (ruta: string) => fs.readFileSync(path.join(conocimiento, ruta));

// Doce documentos como los de Villaejemplo: PCAP, PPT, nueve anexos, la petición del DEUC y su
// ZIP, la memoria justificativa y la nota de rectificación sin extensión, y uno de una
// plataforma de la que no se baja nada.
const CASO_C = [
  doc('pcap', 'PCAP.pdf'),
  doc('ppt', 'PPT.pdf'),
  ...['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'].map((a) => doc('adicional', `ANEXO ${a}.docx`)),
  doc('adicional', 'Deuc.xml'),
  doc('adicional', 'DEUC.zip'),
  doc('otro', 'Memoria justificativa'),
  doc('otro', 'Rectificación de errores materiales del pliego'),
  doc('adicional', 'Anexo en otra web.pdf', 'http://www.madrid.org/contratos/anexo.pdf'),
];

test('should_queue_every_published_document_without_cap_or_extension_filter_once_the_tender_is_in_preparation', () => {
  const id = conDocumentos('nueva', CASO_C);
  assert.equal(
    encolarPliegosNuevos(db, new Date(AHORA).toISOString()),
    8,
    'nueva sin ficha: lo justo para la ficha, hasta 8',
  );
  assert.deepEqual(
    filas(id)
      .slice(0, 2)
      .map((f) => f.nombre),
    ['PCAP.pdf', 'PPT.pdf'],
  );
  assert.ok(
    filas(id).every((f) => /\.(pdf|docx)$/.test(f.nombre)),
    'solo anexos legibles',
  );
  db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = ?").run(id);
  assert.equal(encolarPliegosNuevos(db, new Date(AHORA).toISOString()), 7, 'en preparación: el resto, sin tope');
  assert.deepEqual(
    filas(id)
      .map((f) => f.nombre)
      .sort(),
    CASO_C.slice(0, -1)
      .map((d) => d.nombre)
      .sort(),
    'todo menos lo de otra plataforma',
  );
  assert.deepEqual(
    filas(id)
      .filter((f) => f.clase === 'otro')
      .map((f) => f.nombre),
    ['Memoria justificativa', 'Rectificación de errores materiales del pliego'],
  );
});

test('should_download_everything_once_the_ficha_is_requested_and_not_for_another_tender_with_a_longer_id', () => {
  const id = conDocumentos('nueva', CASO_C);
  const trabajo =
    db.prepare(`INSERT INTO nucleo.trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en)
    VALUES ('licitaciones.ficha', 'licitaciones', ?, '{}', 'pendiente', 'x', 'x')`);
  trabajo.run(`ficha-auto-${id}7`);
  assert.equal(descargaCompleta(db, id), false, 'la ficha de p-10017 no es la de p-1001');
  trabajo.run(`ficha-${id}-2026-10-14T08:00:00.000Z`);
  assert.equal(descargaCompleta(db, id), true, 'ficha pedida a mano');
  assert.equal(encolarPliegos(db, id), 15);
});

test('should_unpack_a_published_zip_and_register_each_annex_as_a_pliego_with_its_origin', async () => {
  const zip = zipSync({
    'ANEXO III.docx': docx('Adscripción de medios'),
    'ANEXO IV.docx': docx('Modelo de propuesta académica'),
    'Modelos/': new Uint8Array(0),
    'Modelos/ANEXO IX.pdf': strToU8(PDF),
    'Deuc.xml': strToU8(DEUC),
    '__MACOSX/._ANEXO III.docx': strToU8('basura'),
    'Thumbs.db': OLE,
  });
  const anexos = doc('adicional', 'Anexos.zip');
  const id = conDocumentos('en_preparacion', [anexos]);
  encolarPliegos(db, id);
  red({ [anexos.url]: responde(zip, 'application/zip') });

  assert.equal(await descargarPendientes(db, conocimiento, 10, AHORA), 1);

  const delZip = filas(id).filter((f) => f.origen === 'zip');
  assert.deepEqual(delZip.map((f) => f.nombre).sort(), ['ANEXO III.docx', 'ANEXO IV.docx', 'ANEXO IX.pdf', 'Deuc.xml']);
  assert.ok(
    delZip.every((f) => f.estado === 'descargado' && f.padre_url === anexos.url && f.clase === 'adicional'),
    'heredan la clase del ZIP y lo apuntan como padre',
  );
  assert.equal(
    path.posix.basename(fila(id, 'ANEXO IV.docx').ruta!),
    'Anexos - ANEXO IV.docx',
    'en Drive se ve de qué ZIP salió',
  );
  assert.match(enDisco(fila(id, 'ANEXO IV.docx').ruta!).toString('latin1'), /^PK/);
  assert.equal(fila(id, 'Deuc.xml').tipo, 'deuc');
  const delFeed = fila(id, 'Anexos.zip');
  assert.deepEqual(
    [delFeed.estado, delFeed.ruta, delFeed.origen],
    ['descomprimido', null, 'feed'],
    'el ZIP no se guarda: queda descomprimido',
  );
  assert.deepEqual(completitudPliegos(db, id), {
    completa: true,
    descarga_completa: true,
    publicados: 1,
    descargados: 1,
    faltan: [],
    citados_sin_pliego: [],
    sin_comprobar: false,
    expediente: null,
  });
});

test('should_name_a_document_without_extension_by_its_bytes_and_keep_and_mark_the_deuc_request', async () => {
  const docs = [
    doc('otro', 'Memoria justificativa'),
    doc('otro', 'Anexo II'),
    doc('adicional', 'Deuc.xml'),
    doc('adicional', 'Presupuesto.bc3'),
    doc('otro', 'Aviso'),
  ];
  const id = conDocumentos('en_preparacion', docs);
  encolarPliegos(db, id);
  red({
    [docs[0]!.url]: responde(PDF),
    [docs[1]!.url]: responde(docx('Anexo II')),
    [docs[2]!.url]: responde(DEUC, 'text/xml'),
    [docs[3]!.url]: responde('~V|FIEBDC-3/2020|Presto|'),
    [docs[4]!.url]: responde('<!DOCTYPE html><html><body>Sesión caducada</body></html>', 'text/html'),
  });

  assert.equal(await descargarPendientes(db, conocimiento, 10, AHORA), 4);

  const nombre = (n: string) => path.posix.basename(fila(id, n).ruta ?? '');
  assert.equal(nombre('Memoria justificativa'), 'Memoria justificativa.pdf');
  assert.equal(nombre('Anexo II'), 'Anexo II.docx');
  assert.equal(nombre('Deuc.xml'), 'Deuc.xml');
  assert.equal(fila(id, 'Deuc.xml').tipo, 'deuc', 'la petición del DEUC queda marcada');
  assert.equal(fila(id, 'Memoria justificativa').tipo, null);
  assert.equal(
    nombre('Presupuesto.bc3'),
    'Presupuesto.bc3',
    'lo que no se reconoce por los bytes vale por su extensión',
  );
  assert.deepEqual(
    [fila(id, 'Aviso').estado, fila(id, 'Aviso').intentos],
    ['error', 1],
    'una página web no es un documento',
  );
  const enDetalle = detalle(db, id).data!.pliegos.find((p) => p['nombre'] === 'Deuc.xml')!;
  assert.equal(enDetalle['estado_indice'], undefined, 'la petición del DEUC no se juzga como pliego ilegible');
});

test('should_tell_documents_from_web_pages_by_their_bytes', () => {
  assert.equal(tipoDeDocumento(strToU8(DEUC), 'peticion').data, '.xml');
  assert.equal(tipoDeDocumento(strToU8('<ESPDRequest/>'), 'Deuc.xml').data, '.xml', 'sin prólogo, si así se llama');
  assert.equal(
    tipoDeDocumento(strToU8('<?xml version="1.0"?><!DOCTYPE html><html></html>'), 'x.xml').error?.code,
    'no_es_documento',
  );
  assert.equal(
    tipoDeDocumento(strToU8('texto suelto'), 'Memoria justificativa').error?.code,
    'no_es_documento',
    'sin extensión ni tipo reconocible',
  );
  assert.equal(
    tipoDeDocumento(strToU8('texto suelto'), 'PCAP.pdf').error?.code,
    'no_es_documento',
    'dice ser un PDF y no lo es',
  );
  assert.equal(
    tipoDeDocumento(strToU8('texto suelto'), 'Exp.2026').error?.code,
    'no_es_documento',
    '«.2026» no es una extensión',
  );
});

test('should_not_save_executables_scripts_or_double_suffixes_by_their_name', () => {
  for (const nombre of [
    'Anexo II modelo.pdf.js',
    'instalar.exe',
    'abrir.vbs',
    'carpeta.scf',
    'enlace.url',
    'script.ps1',
    'pagina.hta',
    'plano.pdf.dwg',
  ]) {
    assert.equal(tipoDeDocumento(strToU8('MZ contenido'), nombre).error?.code, 'tipo_no_admitido', nombre);
  }
  assert.equal(tipoDeDocumento(strToU8('AC1027 plano'), 'Plano de situación.dwg').data, '.dwg', 'un plano sí');
  assert.equal(tipoDeDocumento(strToU8('~V|FIEBDC-3/2020|'), 'Presupuesto.bc3').data, '.bc3');
});

test('should_share_one_entry_budget_between_a_zip_and_the_zips_inside_and_never_unzip_half', async () => {
  const lote = (n: number, prefijo: string) =>
    zipSync(Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefijo}${i}.txt`, strToU8(`Documento ${i}`)])));
  // Tres ZIP de 80 documentos dentro de otro: cada uno pasaba su propio tope de 200.
  const anidado = zipSync({
    'a.zip': lote(80, 'a'),
    'b.zip': lote(80, 'b'),
    'c.zip': lote(80, 'c'),
    'Anexo.pdf.js': strToU8('alert(1)'),
  });
  const grande = lote(250, 'plano');
  const docs = [doc('adicional', 'Anidado.zip'), doc('adicional', 'Planos.zip')];
  const id = conDocumentos('en_preparacion', docs);
  encolarPliegos(db, id);
  red({ [docs[0]!.url]: responde(anidado, 'application/zip'), [docs[1]!.url]: responde(grande, 'application/zip') });

  assert.equal(await descargarPendientes(db, conocimiento, 10, AHORA), 0);

  for (const nombre of ['Anidado.zip', 'Planos.zip']) {
    const f = fila(id, nombre);
    assert.equal(f.estado, 'error', `${nombre}: no queda «descomprimido» con documentos de menos`);
    assert.match(f.error ?? '', /^zip_demasiadas_entradas: El ZIP trae más de 200 documentos/);
  }
  assert.equal(filas(id).filter((f) => f.origen === 'zip').length, 0, 'no se guarda nada a medias');
  // Lo ignorado también cuenta: un zip64 que declara 2^32 entradas paraba el event loop.
  const basura = zipSync(
    Object.fromEntries(Array.from({ length: 2_001 }, (_, i) => [`__MACOSX/._${i}`, new Uint8Array(0)])),
  );
  const otra = doc('adicional', 'Basura.zip');
  const id2 = conDocumentos('en_preparacion', [otra]);
  encolarPliegos(db, id2);
  red({ [otra.url]: responde(basura, 'application/zip') });
  await descargarPendientes(db, conocimiento, 10, AHORA);
  assert.match(fila(id2, 'Basura.zip').error ?? '', /^zip_demasiadas_entradas: El ZIP trae más de 2000 entradas/);
  assert.deepEqual(
    completitudPliegos(db, id)?.faltan.map((f) => f.motivo),
    ['error', 'error'],
    'y consta como lo que falta',
  );
});

test('should_retry_transient_errors_with_growing_waits_until_the_deadline', async () => {
  const pcap = doc('pcap', 'PCAP.pdf');
  const id = conDocumentos('en_preparacion', [pcap]);
  encolarPliegos(db, id);
  red({ [pcap.url]: () => new Response('Service Unavailable', { status: 503 }) });

  assert.equal(await descargarPendientes(db, conocimiento, 10, AHORA), 0);
  assert.deepEqual([fila(id, 'PCAP.pdf').estado, fila(id, 'PCAP.pdf').intentos], ['pendiente', 1]);
  assert.equal(fila(id, 'PCAP.pdf').proximo_intento_en, new Date(AHORA + 60_000).toISOString());
  assert.deepEqual(colaDePliegos(db, conocimiento, 10, AHORA + 30_000), [], 'espera su turno');
  assert.equal(colaDePliegos(db, conocimiento, 10, AHORA + 61_000).length, 1);

  await descargarPendientes(db, conocimiento, 10, AHORA + 61_000);
  assert.equal(
    fila(id, 'PCAP.pdf').proximo_intento_en,
    new Date(AHORA + 61_000 + 120_000).toISOString(),
    'la espera crece',
  );
  db.prepare('UPDATE pliegos SET intentos = 7, proximo_intento_en = NULL WHERE licitacion_id = ?').run(id);
  await descargarPendientes(db, conocimiento, 10, AHORA);
  assert.deepEqual(
    [fila(id, 'PCAP.pdf').estado, fila(id, 'PCAP.pdf').proximo_intento_en],
    ['pendiente', new Date(AHORA + 3_600_000).toISOString()],
    'en plazo no se rinde (hasta 60 min)',
  );

  red({ [pcap.url]: responde(PDF, 'application/pdf') });
  assert.equal(await descargarPendientes(db, conocimiento, 10, AHORA + 3_600_000), 1);
  assert.deepEqual(
    [fila(id, 'PCAP.pdf').estado, fila(id, 'PCAP.pdf').error, fila(id, 'PCAP.pdf').proximo_intento_en],
    ['descargado', null, null],
  );
});

test('should_give_up_on_transient_errors_after_the_deadline_and_on_lasting_ones_after_three_tries', () => {
  const ahora = Date.parse('2026-10-14T10:00:00Z');
  const enPlazo = { fecha_limite: '2026-10-20T14:00:00' };
  const vencido = { fecha_limite: '2026-10-14T08:00:00' };
  assert.equal(
    trasFallo({ ...enPlazo, intentos: 20 }, 'placsp_inalcanzable', ahora).definitivo,
    false,
    'tiempo de espera agotado: se reintenta',
  );
  assert.equal(
    trasFallo({ ...vencido, intentos: 1 }, 'placsp_http_502', ahora).definitivo,
    false,
    'vencido, aún le quedan intentos',
  );
  assert.equal(trasFallo({ ...vencido, intentos: 2 }, 'placsp_http_502', ahora).definitivo, true);
  assert.equal(
    trasFallo({ fecha_limite: null, intentos: 11 }, 'io_error', ahora).definitivo,
    true,
    'sin plazo, doce veces',
  );
  assert.deepEqual(
    trasFallo({ ...enPlazo, intentos: 1 }, 'placsp_http_404', ahora),
    { definitivo: false, proximo: null },
    'lo que no es pasajero, tres veces y sin esperar',
  );
  assert.equal(trasFallo({ ...enPlazo, intentos: 2 }, 'placsp_http_404', ahora).definitivo, true);
  assert.equal(trasFallo({ ...enPlazo, intentos: 0 }, 'zip_vacio', ahora).definitivo, true);
});

// Un guion mínimo que cita sus modelos por archivo, como lo manda Hermes.
function guionQueCita(id: string, citas: string[]): void {
  const datos = {
    archivos: [
      {
        nombre: 'Sobre A',
        contenido: 'Documentación administrativa',
        prohibiciones: [],
        documento: 'Licitaciones/Radar/2026/x/PCAP.pdf',
        documentos: citas.map((c, i) => ({
          tipo: 'declaracion',
          nombre: `Modelo ${i + 1}`,
          obligatorio: true,
          produce: 'persona',
          origen: { documento: c, pagina: 1 },
        })),
      },
    ],
    memoria: null,
    automaticos: [],
    oferta_economica: null,
    plazo: { fecha_limite: null, canal: 'PLACSP' },
  };
  db.prepare(
    `INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, 'licitaciones', 3, 'x')`,
  ).run(id, JSON.stringify(datos));
}

function preparadaConHuecos(): string {
  const docs = [
    doc('pcap', 'PCAP.pdf'),
    doc('adicional', 'ANEXO IV.docx'),
    doc('adicional', 'ANEXO V.docx'),
    doc('otro', 'Memoria justificativa'),
    doc('adicional', 'Anexo en otra web.pdf', 'http://www.madrid.org/contratos/anexo.pdf'),
  ];
  const id = conDocumentos('en_preparacion', docs);
  const poner =
    db.prepare(`INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, error, intentos, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'x')`);
  poner.run(id, docs[0]!.url, 'pcap', 'PCAP.pdf', 'descargado', 'Licitaciones/Radar/2026/x/PCAP.pdf', null, 0);
  poner.run(id, docs[1]!.url, 'adicional', 'ANEXO IV.docx', 'error', null, 'placsp_http_404: Not Found', 3);
  poner.run(id, docs[3]!.url, 'otro', 'Memoria justificativa', 'pendiente', null, null, 0);
  guionQueCita(id, ['ANEXO IV.docx', 'ANEXO XII.docx', 'Cuadro de características', 'PCAP.pdf']);
  return id;
}

test('should_report_published_documents_missing_from_drive_and_files_cited_by_the_guion_without_a_pliego', () => {
  const id = preparadaConHuecos();

  const c = completitudPliegos(db, id)!;

  assert.deepEqual([c.completa, c.descarga_completa], [false, true], 'le toca bajarlo todo y no está todo en Drive');
  assert.deepEqual([c.publicados, c.descargados], [5, 1]);
  assert.deepEqual(
    c.faltan.map((f) => [f.nombre, f.motivo, f.citado]),
    [
      ['ANEXO IV.docx', 'error', true],
      ['ANEXO V.docx', 'sin_encolar', false],
      ['Memoria justificativa', 'pendiente', false],
      ['Anexo en otra web.pdf', 'no_descargable', false],
    ],
  );
  assert.equal(c.faltan[0]!.error, 'placsp_http_404: Not Found');
  assert.deepEqual(
    c.citados_sin_pliego,
    [{ documento: 'ANEXO XII.docx', en: 'guion' }],
    'lo citado como texto («Cuadro de características») es parte de un pliego',
  );
  assert.deepEqual(
    faltanConAviso(c).map((f) => f.nombre),
    ['ANEXO IV.docx', 'Anexo en otra web.pdf'],
    'lo que aún entra en cola o espera su turno no avisa',
  );
  assert.deepEqual(detalle(db, id).data!.completitud_pliegos, c, 'va en la respuesta de la licitación');
  assert.equal(completitudPliegos(db, 'p-0'), null);
});

test('should_warn_in_hoy_about_a_tender_in_preparation_with_published_documents_missing', () => {
  const id = preparadaConHuecos();

  const avisos = () =>
    hoyLicitaciones(db, '2000-01-01T00:00:00Z', AHORA).por_aprobar.filter(
      (p) => p.tipo === 'pliegos' && p.enlace.id === `${id}/pliegos`,
    );

  assert.deepEqual(
    avisos().map((p) => [p.enlace.id, p.detalle, p.corto]),
    [
      [
        `${id}/pliegos`,
        'Faltan 2 documentos publicados en Drive: «ANEXO IV.docx», «Anexo en otra web.pdf» · en Pliegos',
        'Faltan pliegos',
      ],
    ],
  );
  db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE licitacion_id = ?").run(id);
  assert.deepEqual(avisos(), [], 'solo lo que preparamos');
});

test('should_not_call_complete_a_tender_whose_data_predates_reading_the_other_documents', () => {
  // CASO_E: ingerida antes del mapper v2, su nota de rectificación («Otro documento») no consta.
  const id = conDocumentos('en_preparacion', [doc('pcap', 'Bases.pdf')]);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, ?, 'pcap', 'Bases.pdf', 'descargado', 'x')",
  ).run(id, doc('pcap', 'Bases.pdf').url);
  assert.equal(completitudPliegos(db, id)?.sin_comprobar, false, 'guardada con el mapper de ahora');
  const { mapper: _mapper, ...antiguos } = JSON.parse(
    (db.prepare('SELECT datos FROM licitaciones WHERE id = ?').get(id) as { datos: string }).datos,
  ) as Record<string, unknown>;
  db.prepare('UPDATE licitaciones SET datos = ? WHERE id = ?').run(JSON.stringify(antiguos), id);

  const c = completitudPliegos(db, id)!;
  assert.deepEqual(
    [c.faltan.length, c.sin_comprobar],
    [0, true],
    'no falta nada de lo que consta, pero no está comprobado',
  );
  assert.equal(c.completa, null, 'sin comprobar no se da por completa');
  const hoy = hoyLicitaciones(db, '2000-01-01T00:00:00Z', AHORA).por_aprobar.find(
    (p) => p.enlace.id === `${id}/pliegos`,
  );
  assert.equal(hoy?.corto, 'Pliegos sin comprobar');
  assert.match(hoy?.detalle ?? '', /^Sin comprobar si la PLACSP publica más documentos/);
});
