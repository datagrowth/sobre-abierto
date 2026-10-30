// Vista de un anexo rellenado sobre la oferta de ejemplo de Villaejemplo
// (fixtures/comprobaciones/, seudonimizada). El borrador del Anexo V es un .docx sintético con el plan de
// sustituciones que guarda la cadena (anexoPlan.ts): el precio es inventado, no el ofertado.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { pdfConFormulario } from '../nucleo/fixtures/formularioPdf.js';
import { escucharLocal } from '../helpers/servidorLocal.js';
import type { VistaAnexo } from '../../src/dominios/licitaciones/oferta/vistaAnexo.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vista-anexo-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { PDFDocument } = await import('pdf-lib');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { filaDocumento } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { tarjetasDe } = await import('../../src/dominios/licitaciones/oferta/revisionHermes.js');
const { AVISO_SIN_PLAN } = await import('../../src/dominios/licitaciones/oferta/vistaAnexo.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
const db = dbLicitaciones();
const casoC = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, casoC);
const ID = casoC.id;
const ANEXO_V = 'a3-d1';
const CARPETA = `Salidas/Licitaciones/${ID}/anexos`;

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
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

// El Anexo V del lote 3 de Villaejemplo (PCAP pág. 108), con los huecos del modelo: precio, grabación de tutorías,
// participantes adicionales y subcontratación de servidores.
const MODELO = [
  'ANEXO V.- PROPOSICIÓN ECONÓMICA Y OFERTA RELATIVA A LOS CRITERIOS EVALUABLES MEDIANTE FÓRMULAS',
  'LOTE 3. Precio ofertado: …………… euros, IGIC excluido.',
  '2. Grabación de las tutorías con consentimiento del participante: ……………',
  '3. Ofrece …… participantes adicionales sobre el mínimo exigido.',
  'Subcontratación de servidores: ……',
  'Fdo.: ……………………',
];
type Hueco = { parrafo: number; original: string; nuevo: string; dato: string };
const huecos = (participantes: string): Hueco[] => [
  {
    parrafo: 2,
    original: 'Precio ofertado: …………… euros',
    nuevo: 'Precio ofertado: 12.345,67 euros',
    dato: 'Importe sin impuestos',
  },
  {
    parrafo: 3,
    original: 'participante: ……………',
    nuevo: 'participante: Sí, se ofrece',
    dato: 'Grabación de las tutorías',
  },
  {
    parrafo: 4,
    original: 'Ofrece …… participantes',
    nuevo: `Ofrece ${participantes} participantes`,
    dato: 'Participantes adicionales',
  },
  { parrafo: 5, original: 'servidores: ……', nuevo: 'servidores: No', dato: 'Subcontratación de servidores' },
];

async function docx(subs: Hueco[]): Promise<Buffer> {
  const textos = MODELO.map((t, i) =>
    subs.filter((s) => s.parrafo === i + 1).reduce((x, s) => x.replace(s.original, s.nuevo), t),
  );
  return Packer.toBuffer(
    new Document({ sections: [{ children: textos.map((t) => new Paragraph({ children: [new TextRun(t)] })) }] }),
  );
}

function guardarArchivo(ruta: string, bytes: Buffer): void {
  const abs = path.join(tmp, 'salidas', ...ruta.split('/').slice(1));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
}

// Como lo deja recibirAnexo: borrador con su ruta, la hora del relleno y el plan en `sustituciones`.
function enBorrador(clave: string, ruta: string, plan: unknown, en = '2026-10-14T16:00:00.000Z'): void {
  db.prepare(
    "UPDATE oferta_documentos SET estado = 'borrador', ruta = ?, anexo_en = ?, actualizado_en = ?, sustituciones = ? WHERE licitacion_id = ? AND clave = ?",
  ).run(ruta, en, en, plan === null ? null : JSON.stringify(plan), ID, clave);
}

const planWord = (subs: Hueco[]) => ({
  formato: 'docx',
  lote: '3',
  desde: 1,
  hasta: MODELO.length,
  items: subs.map((s) => ({ ...s, valor: null })),
});

async function anexoV(version: number, participantes: string): Promise<void> {
  const subs = huecos(participantes);
  const ruta = `${CARPETA}/Anexo V-v${version}.docx`;
  guardarArchivo(ruta, await docx(subs));
  enBorrador(ANEXO_V, ruta, planWord(subs));
}

async function vista(clave: string): Promise<{ status: number; json: VistaAnexo & { error?: string } }> {
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/documentos/${clave}/vista`);
  return { status: r.status, json: (await r.json()) as VistaAnexo & { error?: string } };
}

async function vistaConPlazo(clave: string): Promise<number> {
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/documentos/${clave}/vista`, {
    signal: AbortSignal.timeout(5000),
  });
  return r.status;
}

async function aceptar(claves: string[]): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/documentos/aceptar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claves }),
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

const resaltados = (v: VistaAnexo) =>
  (v.parrafos ?? []).flatMap((p) => p.valores.map((x) => ({ ...x, marcado: p.texto.slice(x.desde, x.hasta) })));

test('should_highlight_price_and_yes_values_with_their_sheet_field', async () => {
  // Arrange
  await anexoV(1, '30');

  // Act
  const { status, json } = await vista(ANEXO_V);

  // Assert
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.formato, 'docx');
  assert.equal(json.version, 1);
  const v = resaltados(json);
  assert.deepEqual(
    v.map((x) => [x.marcado, x.dato]),
    [
      ['12.345,67', 'Importe sin impuestos'],
      ['Sí, se ofrece', 'Grabación de las tutorías'],
      ['30', 'Participantes adicionales'],
      ['No', 'Subcontratación de servidores'],
    ],
  );
  assert.ok(v.every((x) => x.valor === x.marcado && !x.cambiado));
  assert.equal(json.campos, null);
});

test('should_mark_the_value_that_changed_from_the_previous_version', async () => {
  // Arrange: la v1 ofrecía 20 participantes; la v2, regenerada al cambiar la hoja, ofrece 30.
  const v1 = huecos('20');
  guardarArchivo(`${CARPETA}/Anexo V-v1.docx`, await docx(v1));
  await anexoV(2, '30');

  // Act
  const { json } = await vista(ANEXO_V);

  // Assert
  assert.equal(json.version, 2);
  const cambiados = resaltados(json)
    .filter((x) => x.cambiado)
    .map((x) => x.marcado);
  assert.deepEqual(cambiados, ['30']);
});

test('should_show_the_text_without_highlights_and_warn_when_the_draft_has_no_plan', async () => {
  // Arrange: un borrador anterior al registro de valores.
  const ruta = `${CARPETA}/Anexo V-v1.docx`;
  enBorrador(ANEXO_V, ruta, null);

  // Act
  const { json } = await vista(ANEXO_V);

  // Assert
  assert.ok(json.avisos.includes(AVISO_SIN_PLAN));
  assert.ok((json.parrafos ?? []).some((p) => p.texto.includes('Ofrece 20 participantes')));
  assert.equal(resaltados(json).length, 0);
});

test('should_answer_500_when_reading_the_draft_throws', async (t) => {
  // Arrange: la base bloqueada (frontera) hace que la vista lance en vez de devolver un error.
  await anexoV(1, '20');
  t.mock.method(db, 'prepare', () => {
    throw new Error('SQLITE_BUSY: database is locked');
  });

  // Act
  const status = await vistaConPlazo(ANEXO_V);

  // Assert: responde (no se queda colgada) y sin detalles internos.
  t.mock.restoreAll();
  assert.equal(status, 500);
});

test('should_show_form_fields_for_a_pdf_annex', async () => {
  // Arrange: v1 con «Pyme» y v2 con «Gran empresa», cada una con el formulario relleno.
  const relleno = async (tipo: string) => {
    const doc = await PDFDocument.load(await pdfConFormulario());
    doc.getForm().getRadioGroup('Tipo_empresa').select(tipo);
    doc.getForm().getCheckBox('Acepta_condiciones').check();
    return Buffer.from(await doc.save());
  };
  guardarArchivo(`${CARPETA}/Anexo VI-v1.pdf`, await relleno('Pyme'));
  guardarArchivo(`${CARPETA}/Anexo VI-v2.pdf`, await relleno('Gran empresa'));
  enBorrador('a1-d2', `${CARPETA}/Anexo VI-v2.pdf`, {
    formato: 'pdf',
    lote: null,
    campos: [
      { nombre: 'Tipo_empresa', valor: 'Gran empresa', dato: 'Tamaño de la empresa', valor_hoja: 'Gran empresa' },
      { nombre: 'Acepta_condiciones', valor: true, dato: 'Acepta las condiciones', valor_hoja: null },
    ],
  });

  // Act
  const { status, json } = await vista('a1-d2');

  // Assert
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.formato, 'pdf');
  assert.equal(json.parrafos, null);
  assert.deepEqual(json.campos, [
    { nombre: 'Tipo_empresa', dato: 'Tamaño de la empresa', valor: 'Gran empresa', cambiado: true },
    { nombre: 'Acepta_condiciones', dato: 'Acepta las condiciones', valor: 'Sí', cambiado: false },
  ]);
});

// La declaración responsable de la grabación de tutorías (a3-d2) acredita el criterio: el guion la tipa así.
function tiparAcreditacion(clave: string): void {
  const [, a, d] = /^a(\d+)-d(\d+)$/.exec(clave)!.map(Number) as [number, number, number];
  db.prepare(
    `UPDATE guiones SET datos = json_set(datos, '$.archivos[${a - 1}].documentos[${d - 1}].tipo', 'acreditacion')
    WHERE licitacion_id = ? AND version = (SELECT max(version) FROM guiones WHERE licitacion_id = ?)`,
  ).run(ID, ID);
}

test('should_refuse_to_accept_accreditation_drafts_in_bulk', async () => {
  // Arrange
  tiparAcreditacion('a3-d2');
  enBorrador('a3-d2', `${CARPETA}/Declaracion grabacion tutorias-v1.docx`, null);
  enBorrador('a1-d3', `${CARPETA}/Anexo VII-v1.docx`, null);
  const acredita = new Map(
    tarjetasDe(db, ID, 'web')
      .filter((t) => t.tipo === 'anexo')
      .map((t) => [t.clave.split(':')[1], t.acreditacion]),
  );
  assert.deepEqual([acredita.get('a3-d2'), acredita.get('a1-d3')], [true, false]);

  // Act
  const enBloque = await aceptar(['a3-d2', 'a1-d3']);
  const solo = await aceptar(['a3-d2']);

  // Assert
  assert.equal(enBloque.status, 400);
  assert.equal(enBloque.json['message'], 'Los anexos de acreditación se aceptan uno a uno.');
  assert.equal(filaDocumento(db, ID, 'a1-d3')!.estado, 'borrador');
  assert.equal(solo.status, 200, JSON.stringify(solo.json));
  assert.equal(filaDocumento(db, ID, 'a3-d2')!.estado, 'preparado');
});

test('should_leave_the_annex_prepared_and_close_its_card_when_accepted', async () => {
  // Arrange
  await anexoV(2, '30');
  const clave = `anexo:${ANEXO_V}:${filaDocumento(db, ID, ANEXO_V)!.anexo_en}`;

  // Act
  const r = await aceptar([ANEXO_V]);

  // Assert
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(filaDocumento(db, ID, ANEXO_V)!.estado, 'preparado');
  const cierre = db
    .prepare('SELECT estado FROM revision_tarjetas WHERE licitacion_id = ? AND clave = ?')
    .get(ID, clave) as { estado: string } | undefined;
  assert.equal(cierre?.estado, 'aceptada');
  assert.ok(!tarjetasDe(db, ID, 'web').some((t) => t.clave === clave && t.estado === 'pendiente'));
});

test('should_accept_several_non_accreditation_drafts_at_once', async () => {
  // Arrange
  enBorrador('a1-d2', `${CARPETA}/Anexo VI-v2.pdf`, null);
  enBorrador('a1-d3', `${CARPETA}/Anexo VII-v1.docx`, null);
  assert.ok(
    tarjetasDe(db, ID, 'web')
      .filter((t) => t.tipo === 'anexo')
      .every((t) => !t.acreditacion),
  );

  // Act
  const r = await aceptar(['a1-d2', 'a1-d3']);

  // Assert
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(
    (r.json['documentos'] as { clave: string; estado: string }[]).map((d) => [d.clave, d.estado]),
    [
      ['a1-d2', 'preparado'],
      ['a1-d3', 'preparado'],
    ],
  );
  const cerradas = db
    .prepare(
      "SELECT clave FROM revision_tarjetas WHERE licitacion_id = ? AND clave LIKE 'anexo:a1-%' AND estado = 'aceptada' ORDER BY clave",
    )
    .all(ID) as { clave: string }[];
  assert.equal(cerradas.length, 2);
});

test('should_return_not_found_for_an_annex_without_draft', async () => {
  // Arrange: el DEUC (a1-d1) sigue pendiente, sin nada que rellenara Hermes.
  assert.equal(filaDocumento(db, ID, 'a1-d1')!.anexo_en, null);

  // Act
  const v = await vista('a1-d1');
  const a = await aceptar(['a1-d1']);

  // Assert
  assert.equal(v.status, 404);
  assert.equal(a.status, 404);
});

test('should_reject_an_empty_list_of_keys', async () => {
  // Act
  const r = await aceptar([]);

  // Assert
  assert.equal(r.status, 400);
});
