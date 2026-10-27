// Paso Presentación de la oferta con el caso A (p-91000710): checklist sincronizada
// con el guion, la memoria aceptada que pasa sola a «preparado», cambios de una fila, hoja de
// datos con lo que falta, y el relleno de un anexo por MCP sobre un documento de modelos con
// dos anexos (se extrae el segundo, se rellenan nombre, NIF e importe, se guarda en Salidas y
// se rechaza cualquier cambio fuera de los huecos o un precio sin decidir). Sin LibreOffice.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CARPETA_PLIEGOS, decisionesCasoA, guionCon, ID, licitacionCasoA, otraLicitacion } from './fixtures/casoA.js';
import { modelosAnexos, P } from '../nucleo/fixtures/modelosAnexos.js';
import { leerSkill } from '../helpers/skill.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-docs-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
for (const d of [salidas, conocimiento, agentes]) fs.mkdirSync(d, { recursive: true });
const T_LICI = 'l'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { extraerDocumento } = await import('../../src/biblioteca/motor/documentos/extraccion.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, guionVigente, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { AnexoEntrada } = await import('../../src/dominios/licitaciones/oferta/anexosGuardado.js');
const { anexoRecibido, TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { encolarAnexosAuto } = await import('../../src/dominios/licitaciones/oferta/anexosAuto.js');
const { instruccionesAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosInstrucciones.js');
const { LEYENDO_PDF } = await import('../../src/dominios/licitaciones/oferta/anexosModeloPdf.js');
const { localizarModelo } = await import('../../src/dominios/licitaciones/oferta/modelosPdf.js');
const { prepararModelosPdf } = await import('../../src/dominios/licitaciones/oferta/modelosPdf.js');
const { vueltaCadena } = await import('../../src/dominios/licitaciones/oferta/cadena.js');
const { registrarSincronizacionDocumentos } = await import('../../src/dominios/licitaciones/oferta/documentosSync.js');
const { AVISO_SIN_GUION } = await import('../../src/dominios/licitaciones/oferta/anexosChecklist.js');
const { diferenciasFueraDelPlan, localizarHuecos, rellenarDocx } =
  await import('../../src/nucleo/documentos/rellenar.js');

iniciarNucleo();
// Como en producción (iniciarLicitaciones): la checklist se sincroniza con los eventos, no al leerla.
let dejarDeSincronizar = registrarSincronizacionDocumentos();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();
const MODELOS = await modelosAnexos();
const ANEXO_VII = 'a2-d1';
const CARPETA_SALIDAS = `Salidas/Licitaciones/EXP-2026-0412 (${ID})`;

// El guion del caso A con los modelos en pliegos que se pueden leer: el Anexo VII en un
// .docx de modelos, el XIII en el .doc original (sin LibreOffice) y el VI en un PDF.
function guionConModelos(cambio: (g: ReturnType<typeof guionCon>) => void = () => undefined) {
  return guionCon((g) => {
    (g.archivos[1]!.documentos[0] as { origen?: unknown }).origen = {
      modelo: 'Anexo VII',
      documento: 'Anexos PCAP.docx',
      pagina: 20,
    };
    g.archivos[0]!.documentos[5] = {
      tipo: 'declaracion',
      nombre: 'Anexo VI',
      obligatorio: true,
      produce: 'persona',
      origen: { modelo: 'Anexo VI', documento: 'Modelos.pdf', pagina: 9 },
    } as never;
    cambio(g as never);
  });
}

function pliego(nombre: string, contenido: Buffer): void {
  const ruta = `${CARPETA_PLIEGOS}/${nombre}`;
  fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, ruta), contenido);
  db.prepare(
    `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', ?, 'descargado', ?, ?)`,
  ).run(ID, `https://contrataciondelestado.es/${encodeURIComponent(nombre)}`, nombre, ruta, new Date().toISOString());
}

guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, new Date().toISOString(), new Date().toISOString());
pliego('Anexos PCAP.docx', MODELOS);
pliego('Anexos al PCAP.doc', Buffer.from('documento OLE de prueba'));
pliego('Modelos.pdf', Buffer.from('%PDF-1.4 prueba'));
assert.equal((await proponerGuion(db, GuionEntrada.parse(guionConModelos()), 'licitaciones')).error, null);
assert.equal(
  guardarPerfilEmpresa(nucleo().db, {
    nif: 'B12345678',
    nombre: 'Analítica Ejemplo SL',
    domicilio: 'Calle Ejemplo 7, Puerto de Ejemplo',
    representante: { nombre: 'Ana García Pérez', nif: '12345678Z', cargo: 'Administradora única' },
    contacto: { email: 'licitaciones@example.com' },
  }).error,
  null,
);
const PERSONA = crearPersona(nucleo().db, { nombre: 'Ana García Pérez', tipo: 'interno', rol: 'Consultora' }).data!.id;

function decidir(importe: number | null): void {
  const d = decisionesCasoA([PERSONA]);
  d.automaticos[0]!.nos_acogemos = true;
  const r = guardarDecisiones(db, nucleo().db, ID, {
    ...d,
    precio: importe === null ? { importe: null, pendiente: true } : { importe, pendiente: false },
  });
  assert.equal(r.error, null, r.error?.message);
}

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const json = { 'content-type': 'application/json' };
const api = (ruta: string, body?: unknown, method = 'POST') =>
  fetch(
    `${base}/api/licitaciones/licitaciones/${ID}/oferta${ruta}`,
    method === 'GET' ? {} : { method, headers: json, body: JSON.stringify(body ?? {}) },
  );
const leer = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;
const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';
const olvidarRechazos = () => nucleo().db.prepare('DELETE FROM auditoria_agentes').run();

type Doc = {
  clave: string;
  nombre: string;
  tipo: string;
  estado: string;
  ruta: string | null;
  ruta_pdf: string | null;
  nota: string | null;
  anexo: { rellenable: boolean; motivo: string | null; en_curso: unknown; avisos: string[] };
};
type Lista = { documentos: Doc[]; resumen: { total: number; preparados: number; pendientes_obligatorios: number } };
const documentos = () => leer<Lista>(api('/documentos', undefined, 'GET'));
const doc = async (clave: string) => (await documentos()).documentos.find((d) => d.clave === clave)!;

async function conectar() {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_LICI}` } },
    }),
  );
  return client;
}

async function enviarAnexo(args: Record<string, unknown>) {
  const c = await conectar();
  try {
    return await c.callTool({
      name: 'licitaciones_anexo',
      arguments: { id: ID, clave: ANEXO_VII, desde_parrafo: P.anexo7, hasta_parrafo: P.firma7, ...args },
    });
  } finally {
    await c.close();
  }
}

const p8 = localizarHuecos(MODELOS).data!.parrafos.find((p) => p.indice === P.nombre7)!.texto;
const p9 = localizarHuecos(MODELOS).data!.parrafos.find((p) => p.indice === P.importe7)!.texto;
const hueco = (t: string, re: RegExp) => re.exec(t)![0];
const NOMBRE = hueco(p8, /D\.\/Dña\. …+/);
const NIF = hueco(p8, /con NIF …+/);
const REPRESENTACION = hueco(p8, /en representación de …+/);
const IMPORTE = hueco(p9, /importe de …+/);
const CUOTA = hueco(p9, /IGIC de …+/);
const DOMICILIO = hueco(p8, /con domicilio en …+/);
let pedidaEn = '';

const BIEN = [
  { parrafo: P.nombre7, original: NOMBRE, nuevo: 'D./Dña. Ana García Pérez', dato: 'Representante' },
  { parrafo: P.nombre7, original: NIF, nuevo: 'con NIF 12345678Z', dato: 'NIF del representante' },
  {
    parrafo: P.nombre7,
    original: REPRESENTACION,
    nuevo: 'en representación de Analítica Ejemplo SL',
    dato: 'Nombre o razón social',
  },
  {
    parrafo: P.nombre7,
    original: DOMICILIO,
    nuevo: 'con domicilio en Calle Ejemplo 7, Puerto de Ejemplo',
    dato: 'Domicilio',
  },
  { parrafo: P.importe7, original: IMPORTE, nuevo: 'importe de 40.000,00', dato: 'Importe sin impuestos' },
  { parrafo: P.importe7, original: CUOTA, nuevo: 'IGIC de 2.800,00', dato: 'Cuota de IGIC' },
  { parrafo: P.iso, original: '☐', nuevo: '☒', dato: 'Certificado ISO 14001' },
];

test('should_sync_checklist_with_the_outline_and_say_what_can_be_filled', async () => {
  const l = await documentos();
  assert.deepEqual(
    l.documentos.map((d) => d.clave),
    ['a1-d1', 'a1-d2', 'a1-d3', 'a1-d4', 'a1-d5', 'a1-d6', 'a2-d1'],
  );
  assert.ok(l.documentos.every((d) => d.estado === 'pendiente'));
  assert.deepEqual(l.resumen, { total: 7, preparados: 0, pendientes_obligatorios: 6 });
  const por = Object.fromEntries(l.documentos.map((d) => [d.clave, d.anexo]));
  assert.deepEqual(por[ANEXO_VII], {
    rellenable: true,
    motivo: null,
    en_curso: null,
    avisos: [],
    modelo: { tipo: 'docx', ruta: `Conocimiento/${CARPETA_PLIEGOS}/Anexos PCAP.docx`, pagina: null },
  });
  assert.match(por['a1-d3']!.motivo ?? '', /Word antiguo \(\.doc\): hace falta LibreOffice/);
  assert.match(por['a1-d2']!.motivo ?? '', /memoria técnica se redacta en el paso 3/);
  assert.match(por['a1-d1']!.motivo ?? '', /no dice en qué documento está el modelo/);
  assert.equal(por['a1-d6']!.motivo, LEYENDO_PDF, 'un PDF se lee en la vuelta, no al listar');
  await prepararModelosPdf(db, { salidas, conocimiento });
  const tras = (await documentos()).documentos.find((d) => d.clave === 'a1-d6')!.anexo;
  assert.match(
    tras.motivo ?? '',
    /No se puede leer el texto del PDF/,
    'un PDF que no lo es se dice (no se inventa un formulario)',
  );
});

test('should_add_new_outline_documents_as_pending_and_hide_removed_ones', async () => {
  assert.equal(
    (await leer<Doc>(api('/documentos/a1-d4', { estado: 'no_aplica', nota: 'Solo para empresas en UTE.' }, 'PATCH')))
      .estado,
    'no_aplica',
  );
  const mas = guionConModelos((g) => {
    g.archivos[0]!.documentos.push({
      tipo: 'acreditacion',
      nombre: 'Certificado de la AEAT',
      obligatorio: true,
      produce: 'persona',
    } as never);
  });
  await proponerGuion(db, GuionEntrada.parse(mas), 'licitaciones');
  const l = await documentos();
  assert.equal(l.documentos.find((d) => d.clave === 'a1-d7')?.estado, 'pendiente');
  assert.equal(l.documentos.find((d) => d.clave === 'a1-d4')?.estado, 'no_aplica', 'lo que ya estaba se conserva');
  assert.deepEqual(l.resumen, { total: 7, preparados: 0, pendientes_obligatorios: 7 });
  await proponerGuion(db, GuionEntrada.parse(guionConModelos()), 'licitaciones');
  assert.equal(
    (await documentos()).documentos.some((d) => d.clave === 'a1-d7'),
    false,
    'oculto al salir del guion',
  );
  assert.equal(
    db.prepare("SELECT oculto FROM oferta_documentos WHERE licitacion_id = ? AND clave = 'a1-d7'").pluck().get(ID),
    1,
    'no se borra',
  );
});

test('should_mark_memoria_prepared_when_the_assembled_memoria_is_accepted', async () => {
  const ruta = `${CARPETA_SALIDAS}/memoria-v1.docx`;
  const ts = new Date().toISOString();
  const b = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, origen, version, ruta_pdf, estado)
    VALUES (?, ?, 'x', 1, 'plataforma', ?, 'ensamblado', 1, ?, 'pendiente')`,
      )
      .run(ID, ruta, ts, `${CARPETA_SALIDAS}/memoria-v1.pdf`).lastInsertRowid,
  );
  assert.equal((await doc('a1-d2')).estado, 'pendiente', 'pendiente de revisión: aún no');
  const aceptar = await fetch(`${base}/api/licitaciones/borradores/${b}`, {
    method: 'PATCH',
    headers: json,
    body: JSON.stringify({ decision: 'aceptar' }),
  });
  assert.equal(aceptar.status, 200);
  const m = await doc('a1-d2');
  assert.deepEqual([m.estado, m.ruta, m.ruta_pdf], ['preparado', ruta, `${CARPETA_SALIDAS}/memoria-v1.pdf`]);
});

test('should_change_state_path_and_note_of_a_document', async () => {
  const r = await api(
    '/documentos/a1-d1',
    { estado: 'preparado', ruta: 'Conocimiento/Licitaciones/DEUC firmado.pdf', nota: 'Firmado por Ana' },
    'PATCH',
  );
  assert.equal(r.status, 200);
  const d = (await r.json()) as Doc;
  assert.deepEqual(
    [d.estado, d.ruta, d.nota, d.anexo.rellenable],
    ['preparado', 'Conocimiento/Licitaciones/DEUC firmado.pdf', 'Firmado por Ana', false],
  );
  assert.equal((await api('/documentos/a1-d1', { ruta: 'https://drive.google.com/file/d/abc' }, 'PATCH')).status, 200);
  assert.equal((await api('/documentos/a1-d1', { estado: 'firmado' }, 'PATCH')).status, 400);
  assert.equal((await api('/documentos/a1-d1', { ruta: 'Salidas/../secreto.txt' }, 'PATCH')).status, 400);
  assert.equal((await api('/documentos/a1-d1', {}, 'PATCH')).status, 400);
  assert.equal((await api('/documentos/a1-d1', { estado: 'preparado', otra: 1 }, 'PATCH')).status, 400);
  assert.equal((await api('/documentos/a9-d9', { estado: 'preparado' }, 'PATCH')).status, 404);
  assert.equal((await api('/documentos/x', { estado: 'preparado' }, 'PATCH')).status, 400);
  assert.equal((await leer<Lista>(api('/documentos', undefined, 'GET'))).resumen.preparados, 2);
});

test('should_reject_no_aplica_without_a_reason', async () => {
  const sinNota = await api('/documentos/a1-d1', { estado: 'no_aplica' }, 'PATCH');
  const corta = await api('/documentos/a1-d1', { estado: 'no_aplica', nota: '   no va   ' }, 'PATCH');
  const larga = await api('/documentos/a1-d1', { estado: 'no_aplica', nota: 'x'.repeat(501) }, 'PATCH');
  const conMotivo = await api(
    '/documentos/a1-d1',
    { estado: 'no_aplica', nota: 'No vamos en UTE con nadie.' },
    'PATCH',
  );
  assert.deepEqual([sinNota.status, corta.status, larga.status], [400, 400, 400]);
  assert.match(
    ((await sinNota.json()) as { message: string }).message,
    /^Di por qué no aplica \(al menos 10 caracteres\)\.$/,
  );
  assert.equal(conMotivo.status, 200);
  const d = (await conMotivo.json()) as Doc;
  assert.deepEqual([d.estado, d.nota], ['no_aplica', 'No vamos en UTE con nadie.']);
  assert.equal(
    (await api('/documentos/a1-d1', { estado: 'preparado', nota: null }, 'PATCH')).status,
    200,
    'salir de «no aplica» no pide motivo',
  );
});

type Hoja = { campos: { grupo: string; etiqueta: string; valor: string | null; falta: boolean }[]; avisos: string[] };
const valor = (h: Hoja, etiqueta: string) => h.campos.find((c) => c.etiqueta === etiqueta);

test('should_build_data_sheet_and_flag_what_is_missing', async () => {
  const sin = await leer<Hoja>(api('/hoja-datos', undefined, 'GET'));
  assert.deepEqual(valor(sin, 'Importe sin impuestos'), {
    grupo: 'Oferta',
    etiqueta: 'Importe sin impuestos',
    valor: null,
    falta: true,
  });
  assert.ok(sin.avisos.some((a) => a.startsWith('Aún no se han fijado las decisiones')));
  decidir(40_000);
  const h = await leer<Hoja>(api('/hoja-datos', undefined, 'GET'));
  const v = (e: string) => valor(h, e)?.valor;
  assert.deepEqual(
    [v('NIF'), v('Representante'), v('NIF del representante'), v('Cargo del representante')],
    ['B12345678', 'Ana García Pérez', '12345678Z', 'Administradora única'],
  );
  assert.equal(valor(h, 'Teléfono')?.falta, true);
  assert.deepEqual([v('Expediente'), v('Lotes')], ['EXP-2026-0412', 'Toda la licitación']);
  assert.deepEqual(
    [v('Importe sin impuestos'), v('Impuesto'), v('Cuota de IGIC'), v('Total con IGIC')],
    ['40.000,00 €', 'IGIC 7 %', '2.800,00 €', '42.800,00 €'],
  );
  assert.equal(v('Baja sobre el presupuesto'), '22,30 % (presupuesto 51.480,00 €)');
  assert.equal(v('Certificado ISO 14001'), 'Sí, nos acogemos — Anexo VII');
  assert.equal(v('Mejora 1: bolsa de horas adicionales'), 'No — Anexo VII');
  assert.ok(h.avisos.includes('IGIC al 7 % (tipo general): confirma el tipo en el pliego antes de presentar.'));
  assert.ok(h.avisos.includes('Faltan datos de la empresa en Ajustes › Empresa: teléfono.'));
  assert.equal((await fetch(`${base}/api/licitaciones/licitaciones/p-1/oferta/hoja-datos`)).status, 404);
});

test('should_queue_the_annex_job_once_and_refuse_models_that_cannot_be_filled', async () => {
  const r = await api(`/documentos/${ANEXO_VII}/anexo`);
  assert.equal(r.status, 202);
  const { trabajo } = (await r.json()) as { trabajo: number };
  assert.equal(
    (await leer<{ trabajo: number }>(api(`/documentos/${ANEXO_VII}/anexo`))).trabajo,
    trabajo,
    'el mismo trabajo mientras está en curso',
  );
  const t = nucleo().db.prepare('SELECT tipo, payload FROM trabajos_ia WHERE id = ?').get(trabajo) as {
    tipo: string;
    payload: string;
  };
  assert.equal(t.tipo, TIPO_ANEXO);
  const payload = JSON.parse(t.payload) as { id: string; clave: string; pedida_en: string };
  assert.deepEqual([payload.id, payload.clave], [ID, ANEXO_VII]);
  assert.ok((await doc(ANEXO_VII)).anexo.en_curso, 'en curso');
  pedidaEn = payload.pedida_en;
  assert.equal(anexoRecibido(db, ID, ANEXO_VII, pedidaEn), false);
  const doc3 = await api('/documentos/a1-d3/anexo');
  assert.equal(doc3.status, 400);
  assert.match(((await doc3.json()) as { message: string }).message, /LibreOffice/);
  assert.equal((await api('/documentos/a1-d1/anexo')).status, 400);
  assert.equal((await api('/documentos/a9-d1/anexo')).status, 404);
});

test('should_give_hermes_the_annex_range_and_the_data_sheet', () => {
  const ins = instruccionesAnexo(db, nucleo().db, { id: ID, clave: ANEXO_VII, pedida_en: new Date().toISOString() });
  assert.match(ins, /rellena el modelo «Anexo VII\. Proposición económica» \(Anexo VII, Anexos PCAP\.docx pág\. 20\)/);
  assert.match(ins, new RegExp(`«Anexo VII» parece ir del párrafo ${P.anexo7} al ${P.firma7}`));
  assert.match(ins, /^\[8\] D\.\/Dña\. …+, con NIF/m);
  assert.doesNotMatch(ins, /^\[1\] ANEXO VI$/m, 'el otro anexo no se manda entero');
  assert.match(ins, /- Empresa · NIF del representante: 12345678Z/);
  assert.match(ins, /- Empresa · Teléfono: \(falta: deja el hueco vacío\)/);
  assert.match(ins, /licitaciones_anexo \(id=p-91000710, clave=a2-d1/);
  const parrafos = localizarHuecos(MODELOS).data!.parrafos;
  assert.deepEqual(
    localizarModelo(parrafos, 'Anexo VI'),
    { desde: P.anexo6, hasta: P.firma6 },
    '«Anexo VI» no confunde «Anexo VII»',
  );
  assert.equal(localizarModelo(parrafos, 'Anexo XIII'), null);
});

test('should_ask_for_the_range_and_substitutions_when_the_model_is_a_word', async () => {
  olvidarRechazos();
  const r = await enviarAnexo({
    desde_parrafo: undefined,
    hasta_parrafo: undefined,
    campos: [{ nombre: 'NIF', valor: 'B12345678', dato: 'NIF' }],
  });
  assert.equal(r.isError, true);
  assert.match(texto(r), /Este modelo es un Word: envía desde_parrafo, hasta_parrafo y sustituciones \(no «campos»\)/);
});

test('should_reject_a_price_that_is_not_decided', async () => {
  olvidarRechazos();
  decidir(null);
  const r = await enviarAnexo({ sustituciones: BIEN });
  assert.equal(r.isError, true);
  assert.match(
    texto(r),
    new RegExp(
      `El precio aún no está decidido \\(decisiones de la oferta\\): deja vacío el hueco del importe del párrafo ${P.importe7}; lo rellena una persona cuando se fije\\.`,
    ),
  );
  decidir(40_000);
});

test('should_reject_changes_to_the_model_text_always', async () => {
  olvidarRechazos();
  const malo = [
    {
      parrafo: P.nombre7,
      original: REPRESENTACION,
      nuevo: 'actuando para Analítica Ejemplo SL',
      dato: 'Nombre o razón social',
    },
  ];
  for (let n = 1; n <= 3; n += 1) {
    const r = await enviarAnexo({ sustituciones: malo });
    assert.equal(r.isError, true, `rechazo ${n}`);
    assert.match(
      texto(r),
      /cambia el texto del modelo «en representación de»: solo se rellenan los huecos y el texto del modelo se conserva literal\./,
    );
  }
  const fuera = await enviarAnexo({
    sustituciones: [{ ...BIEN[0], parrafo: 3, original: hueco(p8, /D\.\/Dña\. …+/) }],
  });
  assert.match(texto(fuera), /Las sustituciones de los párrafos 3 caen fuera del modelo \(párrafos 6-14\)\./);
});

test('should_reject_wrong_range_or_data_until_the_third_try', async () => {
  olvidarRechazos();
  const mal = await enviarAnexo({
    desde_parrafo: P.proposicion,
    sustituciones: [{ ...BIEN[1], nuevo: 'con NIF 87654321X' }],
  });
  assert.equal(mal.isError, true);
  assert.match(
    texto(mal),
    /El párrafo 7 \(«PROPOSICIÓN ECONÓMICA Y CRITERIOS AUTOMÁTICOS»\) no es el título de «Anexo VII»/,
  );
  assert.match(
    texto(mal),
    /«NIF del representante» es «12345678Z» en la hoja de datos y el párrafo 8 pone «con NIF 87654321X»: copia el dato tal cual\./,
  );
  const tel = await enviarAnexo({
    sustituciones: [{ parrafo: P.telefono, original: 'Teléfono:', nuevo: 'Teléfono: 922 000 000', dato: 'Teléfono' }],
  });
  assert.match(texto(tel), /La hoja de datos no trae «Teléfono»: deja vacío el hueco del párrafo 12\./);
  const tercera = await enviarAnexo({
    sustituciones: [{ parrafo: P.nombre7, original: 'con CIF ……', nuevo: 'con CIF B1', dato: 'NIF' }],
  });
  assert.equal(tercera.isError, undefined, 'a la tercera entra con avisos');
  assert.match(
    (JSON.parse(texto(tercera)) as { avisos: string[] }).avisos.join(' '),
    /No encuentro «con CIF ……» en el párrafo 8/,
  );
});

test('should_fill_the_second_annex_and_write_it_to_salidas', async () => {
  olvidarRechazos();
  const r = await enviarAnexo({ sustituciones: BIEN });
  assert.equal(r.isError, undefined, texto(r));
  const d = JSON.parse(texto(r)) as {
    ruta: string;
    ruta_pdf: string | null;
    version: number;
    aplicadas: number;
    avisos: string[];
  };
  assert.equal(d.ruta, `${CARPETA_SALIDAS}/anexos/Anexo VII. Proposición económica-v${d.version}.docx`);
  assert.deepEqual([d.ruta_pdf, d.aplicadas], [null, 7]);
  assert.deepEqual(
    d.avisos,
    [`Quedan huecos sin rellenar en los párrafos ${P.telefono}, ${P.lugar7}: complétalos a mano antes de firmar.`],
    'la firma se queda en blanco a propósito',
  );
  const abs = path.join(salidas, d.ruta.replace(/^Salidas\//, ''));
  const leido = await extraerDocumento(abs);
  const todo = leido.data!.pages.join('\n');
  assert.match(todo, /^ANEXO VII/);
  assert.match(
    todo,
    /D\.\/Dña\. Ana García Pérez, con NIF 12345678Z, en representación de Analítica Ejemplo SL, con domicilio en Calle Ejemplo 7, Puerto de Ejemplo,/,
  );
  assert.match(todo, /importe de 40\.000,00 euros, IGIC excluido, al que corresponde un IGIC de 2\.800,00 euros\./);
  assert.match(todo, /☒ Certificado ISO 14001/);
  assert.doesNotMatch(todo, /DECLARACIÓN RESPONSABLE/, 'solo el segundo anexo');
  const fila = await doc(ANEXO_VII);
  assert.deepEqual([fila.estado, fila.ruta, fila.anexo.avisos], ['borrador', d.ruta, d.avisos]);
  assert.equal(anexoRecibido(db, ID, ANEXO_VII, pedidaEn), true);
  const ev = ultimosEventos(nucleo().db, 50).find(
    (e) => e.tipo === 'licitacion.documentos' && (e.datos as { version?: number }).version === d.version,
  );
  assert.deepEqual(ev?.datos, { accion: 'anexo', clave: ANEXO_VII, version: d.version, avisos: 1 });
  const otra = JSON.parse(texto(await enviarAnexo({ sustituciones: BIEN }))) as { version: number; ruta: string };
  assert.equal(otra.version, d.version + 1, 'no pisa la anterior');
  assert.ok(fs.existsSync(abs));
});

const cancelarAnexos = () =>
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')")
    .run(TIPO_ANEXO);
const automaticos = () =>
  (
    nucleo()
      .db.prepare("SELECT clave FROM trabajos_ia WHERE clave LIKE 'anexo-auto-%' AND estado = 'pendiente'")
      .all() as { clave: string }[]
  ).map((x) => x.clave);

test('should_reject_any_text_in_a_signature_gap', async () => {
  olvidarRechazos();
  const firmado = [
    ...BIEN,
    { parrafo: P.firma7, original: 'Fdo.: ……………………', nuevo: 'Fdo.: Ana García Pérez', dato: 'Representante' },
  ];
  for (let n = 1; n <= 3; n += 1) {
    const r = await enviarAnexo({ sustituciones: firmado });
    assert.equal(r.isError, true, `rechazo ${n}: nunca se acepta`);
    assert.match(
      texto(r),
      new RegExp(`La firma se deja en blanco: la pone una persona con su certificado \\(párrafo ${P.firma7}\\)\\.`),
    );
  }
  olvidarRechazos();
});

test('should_fill_place_and_date_from_the_sheet', async () => {
  const h = await leer<Hoja>(api('/hoja-datos', undefined, 'GET'));
  assert.deepEqual(valor(h, 'Fecha'), {
    grupo: 'Firma',
    etiqueta: 'Fecha',
    valor: 'a la fecha de la firma electrónica',
    falta: false,
  });
  assert.equal(valor(h, 'Lugar')?.falta, true, 'el domicilio de prueba no trae código postal');
  assert.ok(h.avisos.some((a) => a.startsWith('El domicilio de la empresa no trae código postal y municipio')));
  const ins = instruccionesAnexo(db, nucleo().db, { id: ID, clave: ANEXO_VII, pedida_en: new Date().toISOString() });
  assert.match(ins, /- Firma · Fecha: a la fecha de la firma electrónica/);
  assert.match(ins, /La firma, NUNCA: su hueco \(«Fdo\.: ……»\) se queda en blanco/);
});

test('should_wait_for_the_lot_price_before_filling_its_economic_annex', () => {
  cancelarAnexos();
  decidir(null);
  assert.equal(encolarAnexosAuto(nucleo().db, db), 0, 'el Anexo VII es la oferta económica: espera al precio');
  assert.deepEqual(automaticos(), []);
});

test('should_queue_annexes_automatically_after_decisions_are_saved', () => {
  cancelarAnexos();
  decidir(40_000);
  assert.equal(encolarAnexosAuto(nucleo().db, db), 0, 'el anexo recibido ya lleva este precio');
  decidir(40_500);
  assert.equal(
    encolarAnexosAuto(nucleo().db, db),
    0,
    'con su plan guardado, el precio nuevo lo pone el código (anexosRegeneracion.ts), sin run',
  );
  // Un anexo de antes del plan no se puede regenerar por código: lo vuelve a pedir.
  const plan = (
    db
      .prepare('SELECT sustituciones FROM oferta_documentos WHERE licitacion_id = ? AND clave = ?')
      .get(ID, ANEXO_VII) as { sustituciones: string | null }
  ).sustituciones;
  db.prepare('UPDATE oferta_documentos SET sustituciones = NULL WHERE licitacion_id = ? AND clave = ?').run(
    ID,
    ANEXO_VII,
  );
  assert.equal(encolarAnexosAuto(nucleo().db, db), 1);
  db.prepare('UPDATE oferta_documentos SET sustituciones = ? WHERE licitacion_id = ? AND clave = ?').run(
    plan,
    ID,
    ANEXO_VII,
  );
  const [clave] = automaticos();
  assert.match(clave ?? '', new RegExp(`^anexo-auto-${ID}-${ANEXO_VII}-[0-9a-f]{12}-tras-\\d{4}-`));
  assert.equal(encolarAnexosAuto(nucleo().db, db), 0, 'uno en curso: no se repite');
  assert.equal(vueltaCadena(nucleo().db, db).anexos, 0, 'la cadena lo pide en cada vuelta');
});

test('should_ask_hermes_again_when_the_saved_plan_does_not_track_the_sheet_price', () => {
  // Arrange: el plan guardado con un `dato` que no casa con la hoja («Importe» por «Importe sin impuestos»).
  cancelarAnexos();
  const leerSust = () =>
    (
      db
        .prepare('SELECT sustituciones FROM oferta_documentos WHERE licitacion_id = ? AND clave = ?')
        .get(ID, ANEXO_VII) as { sustituciones: string }
    ).sustituciones;
  const original = leerSust();
  const plan = JSON.parse(original) as { items: { dato: string; valor: string | null }[] };
  const sinPrecio = {
    ...plan,
    items: plan.items.map((i) => (/^(Importe|Cuota)/.test(i.dato) ? { ...i, dato: 'Importe', valor: null } : i)),
  };
  db.prepare('UPDATE oferta_documentos SET sustituciones = ? WHERE licitacion_id = ? AND clave = ?').run(
    JSON.stringify(sinPrecio),
    ID,
    ANEXO_VII,
  );
  // Act
  decidir(40_750);
  const n = encolarAnexosAuto(nucleo().db, db);
  // Assert
  db.prepare('UPDATE oferta_documentos SET sustituciones = ? WHERE licitacion_id = ? AND clave = ?').run(
    original,
    ID,
    ANEXO_VII,
  );
  assert.equal(n, 1, 'el código no pondría el precio nuevo: lo vuelve a pedir');
  cancelarAnexos();
});

test('should_not_redo_an_annex_a_person_marked_as_prepared_and_warn_instead', async () => {
  cancelarAnexos();
  assert.equal((await api(`/documentos/${ANEXO_VII}`, { estado: 'preparado' }, 'PATCH')).status, 200);
  decidir(41_000);
  assert.equal(encolarAnexosAuto(nucleo().db, db), 0);
  const fila = await doc(ANEXO_VII);
  assert.equal(fila.estado, 'preparado');
  assert.equal(
    fila.anexo.avisos.filter((a) => a.startsWith('El anexo es anterior a que cambiara el precio (decisiones de las '))
      .length,
    1,
  );
  encolarAnexosAuto(nucleo().db, db);
  assert.equal(
    (await doc(ANEXO_VII)).anexo.avisos.filter((a) => a.startsWith('El anexo es anterior')).length,
    1,
    'el aviso, una vez',
  );
});

test('should_not_redo_a_draft_annex_a_person_corrected_nor_one_replaced_by_their_own_file', async () => {
  cancelarAnexos();
  assert.equal((await api(`/documentos/${ANEXO_VII}`, { estado: 'borrador' }, 'PATCH')).status, 200);
  const antes = await doc(ANEXO_VII);
  assert.ok(antes.ruta, 'el anexo de Hermes tiene su archivo');
  const abs = path.join(salidas, antes.ruta.replace(/^Salidas\//, ''));
  const tarde = new Date(Date.now() + 60_000);
  fs.utimesSync(abs, tarde, tarde);
  decidir(42_000);
  assert.equal(encolarAnexosAuto(nucleo().db, db), 0, 'el .docx se tocó después de escribirlo: lleva correcciones');
  const aviso =
    'El borrador tiene correcciones tuyas: Hermes no lo rehace solo. Si cambió algo que lleva, rehazlo con «Rellenar con Hermes».';
  encolarAnexosAuto(nucleo().db, db);
  assert.equal((await doc(ANEXO_VII)).anexo.avisos.filter((a) => a === aviso).length, 1, 'el aviso, una vez');
  const propio = `${CARPETA_SALIDAS}/mio.docx`;
  assert.equal((await api(`/documentos/${ANEXO_VII}`, { ruta: propio }, 'PATCH')).status, 200);
  const fila = db
    .prepare('SELECT ruta, anexo_en, anexo_modelo FROM oferta_documentos WHERE licitacion_id = ? AND clave = ?')
    .get(ID, ANEXO_VII) as { ruta: string; anexo_en: string | null; anexo_modelo: string | null };
  assert.deepEqual(
    [fila.ruta, fila.anexo_en, fila.anexo_modelo],
    [propio, null, null],
    'con otra ruta ya no es un anexo de Hermes',
  );
  decidir(43_000);
  assert.equal(encolarAnexosAuto(nucleo().db, db), 0, 'el documento de una persona no se rehace');
});

test('should_keep_the_annex_example_of_the_hermes_skill_valid', () => {
  const md = leerSkill();
  const inicio = md.indexOf('```json', md.indexOf('## Rellenar un anexo')) + '```json'.length;
  const e = AnexoEntrada.safeParse(JSON.parse(md.slice(inicio, md.indexOf('```', inicio))));
  assert.ok(e.success, JSON.stringify(e.error?.issues));
  assert.ok(e.data.sustituciones?.length, 'el ejemplo de Word trae sustituciones');
  const r = rellenarDocx(MODELOS, e.data.sustituciones).data!;
  assert.deepEqual(r.noEncontradas, [], 'los trozos del ejemplo están en el modelo de prueba');
  assert.deepEqual(diferenciasFueraDelPlan(MODELOS, r.docx, r.aplicadas), []);
});

test('should_keep_the_pdf_annex_example_of_the_hermes_skill_valid', () => {
  const md = leerSkill();
  const inicio = md.indexOf('```json', md.indexOf('### Si el modelo es un PDF con formulario')) + '```json'.length;
  const e = AnexoEntrada.safeParse(JSON.parse(md.slice(inicio, md.indexOf('```', inicio))));
  assert.ok(e.success, JSON.stringify(e.error?.issues));
  assert.ok(e.data.campos?.length, 'el ejemplo de PDF trae campos');
  assert.equal(e.data.sustituciones, undefined);
});

test('should_price_per_unit_against_the_maximum_and_show_exempt_tax_in_the_data_sheet', async () => {
  const porHora = guionConModelos((g) => {
    g.oferta_economica = {
      ...g.oferta_economica,
      impuesto_aparte: 'exento',
      precio_unitario: { unidad: 'hora', maximo: 1.54 },
    } as never;
  });
  assert.equal((await proponerGuion(db, GuionEntrada.parse(porHora), 'licitaciones')).error, null);
  decidir(1.5);
  const h = await leer<Hoja>(api('/hoja-datos', undefined, 'GET'));
  const v = (e: string) => valor(h, e)?.valor;
  assert.deepEqual(
    [v('Importe sin impuestos'), v('Impuesto'), v('Total con impuesto')],
    ['1,50 € por hora', 'Exento', '1,50 € por hora'],
  );
  assert.equal(v('Baja sobre el presupuesto'), '2,60 % (precio máximo 1,54 € por hora)');
  assert.ok(
    h.avisos.includes(
      'Según el guion la prestación está exenta de impuesto: confírmalo en el pliego antes de presentar.',
    ),
  );
  assert.ok(h.avisos.includes('El precio se oferta por hora: el importe de las decisiones es el precio unitario.'));
  assert.ok(!h.avisos.some((a) => a.includes('tipo general')));
});

// ── La checklist se lee sin escribir y conserva cada documento aunque cambie de posición ──

const AEAT = { tipo: 'acreditacion', nombre: 'Certificado de la AEAT', obligatorio: true, produce: 'persona' } as never;
const filasGuardadas = () =>
  db.prepare('SELECT * FROM oferta_documentos WHERE licitacion_id = ? ORDER BY clave').all(ID);
const eventos = () => nucleo().db.prepare('SELECT COUNT(*) FROM eventos').pluck().get() as number;

test('should_not_write_any_row_when_reading_the_checklist', async (t) => {
  dejarDeSincronizar();
  t.after(() => {
    dejarDeSincronizar = registrarSincronizacionDocumentos();
  });
  const SS = {
    tipo: 'acreditacion',
    nombre: 'Certificado de la Seguridad Social',
    obligatorio: true,
    produce: 'persona',
  } as never;
  assert.equal(
    (
      await proponerGuion(
        db,
        GuionEntrada.parse(
          guionConModelos((x) => {
            x.archivos[0]!.documentos.push(SS);
          }),
        ),
        'licitaciones',
      )
    ).error,
    null,
  );
  const [filas, nEventos] = [filasGuardadas(), eventos()];

  const l = await documentos();
  const paquete = await api('/paquete', undefined, 'GET');

  assert.equal(paquete.status, 200);
  assert.deepEqual(filasGuardadas(), filas, 'ni el GET de la checklist ni el del paquete escriben filas');
  assert.equal(eventos(), nEventos, 'ni emiten eventos');
  const nuevo = l.documentos.find((d) => d.clave === 'a1-d7') as Doc & { actualizado_en: string };
  assert.deepEqual(
    [nuevo.nombre, nuevo.estado],
    ['Certificado de la Seguridad Social', 'pendiente'],
    'lo que aún no tiene fila sale pendiente',
  );
  assert.equal(nuevo.actualizado_en, guionVigente(db, ID)!.creado_en, 'con la fecha del guion');
  assert.equal(
    filasGuardadas().some((f) => (f as { nombre: string }).nombre === 'Certificado de la Seguridad Social'),
    false,
  );
});

test('should_sync_the_checklist_when_a_new_outline_arrives', async () => {
  const sinAeat = guionConModelos();
  await proponerGuion(db, GuionEntrada.parse(sinAeat), 'licitaciones');

  await proponerGuion(
    db,
    GuionEntrada.parse(
      guionConModelos((x) => {
        x.archivos[0]!.documentos.push(AEAT);
      }),
    ),
    'licitaciones',
  );
  const fila = () =>
    db
      .prepare("SELECT estado, oculto, identidad FROM oferta_documentos WHERE licitacion_id = ? AND clave = 'a1-d7'")
      .get(ID);

  assert.deepEqual(
    fila(),
    { estado: 'pendiente', oculto: 0, identidad: 'certificado de la aeat||' },
    'el evento del guion la guarda sin esperar a un GET',
  );
  await proponerGuion(db, GuionEntrada.parse(sinAeat), 'licitaciones');
  assert.equal((fila() as { oculto: number }).oculto, 1);
});

test('should_keep_state_route_and_note_when_a_new_outline_inserts_a_document_before', async () => {
  await proponerGuion(db, GuionEntrada.parse(guionConModelos()), 'licitaciones');
  const antes = await documentos();
  const de = (l: Lista, nombre: string) => l.documentos.find((d) => d.nombre === nombre)!;
  const estado = (d: Doc) => [d.estado, d.ruta, d.nota];

  await proponerGuion(
    db,
    GuionEntrada.parse(
      guionConModelos((x) => {
        x.archivos[0]!.documentos.unshift(AEAT);
      }),
    ),
    'licitaciones',
  );
  const despues = await documentos();

  assert.deepEqual(
    despues.documentos.slice(0, 2).map((d) => [d.clave, d.nombre]),
    [
      ['a1-d1', 'Certificado de la AEAT'],
      ['a1-d2', 'DEUC'],
    ],
  );
  assert.equal(de(despues, 'Certificado de la AEAT').estado, 'pendiente');
  for (const d of antes.documentos)
    assert.deepEqual(estado(de(despues, d.nombre)), estado(d), `«${d.nombre}» conserva estado, ruta y nota`);
  assert.equal(de(despues, 'DEUC').estado, 'preparado');
  await proponerGuion(db, GuionEntrada.parse(guionConModelos()), 'licitaciones');
  const vuelta = await documentos();
  assert.deepEqual(
    vuelta.documentos.map((d) => [d.clave, ...estado(d)]),
    antes.documentos.map((d) => [d.clave, ...estado(d)]),
    'al volver al guion de antes, cada fila en su sitio',
  );
});

test('should_say_there_is_no_outline_yet_instead_of_an_empty_list', async () => {
  guardarLicitacion(db, otraLicitacion('p-sin-guion'));

  const r = await fetch(`${base}/api/licitaciones/licitaciones/p-sin-guion/oferta/documentos`);

  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), {
    documentos: [],
    resumen: { total: 0, preparados: 0, pendientes_obligatorios: 0 },
    aviso: AVISO_SIN_GUION,
  });
  assert.equal(AVISO_SIN_GUION, 'Aún no hay guion: Hermes lo saca del pliego.');
});

test('should_not_copy_one_moved_document_into_two_positions', async () => {
  // Arrange: la misma declaración en los dos archivos, preparada en el 1 y pendiente en el 2.
  const DR = {
    tipo: 'declaracion',
    nombre: 'Declaración responsable de prueba',
    obligatorio: true,
    produce: 'persona',
  } as never;
  const conDr = (antes: boolean) =>
    guionConModelos((x) => {
      for (const a of x.archivos.slice(0, 2)) {
        a.documentos.unshift(DR);
        if (antes) a.documentos.unshift(AEAT);
      }
    });
  await proponerGuion(db, GuionEntrada.parse(conDr(false)), 'licitaciones');
  db.prepare(
    "UPDATE oferta_documentos SET estado = 'preparado', ruta = 'Salidas/dr-sobre-1.pdf' WHERE licitacion_id = ? AND clave = 'a1-d1'",
  ).run(ID);

  // Act: el guion nuevo mete un documento delante en cada archivo y los dos bajan a d2.
  await proponerGuion(db, GuionEntrada.parse(conDr(true)), 'licitaciones');
  const lista = await documentos();

  // Assert
  const en = (clave: string) => lista.documentos.find((d) => d.clave === clave)!;
  assert.deepEqual(
    [en('a1-d2').nombre, en('a1-d2').estado, en('a1-d2').ruta],
    ['Declaración responsable de prueba', 'preparado', 'Salidas/dr-sobre-1.pdf'],
  );
  assert.deepEqual(
    [en('a2-d2').nombre, en('a2-d2').estado, en('a2-d2').ruta],
    ['Declaración responsable de prueba', 'pendiente', null],
    'la del sobre 2 sigue siendo la suya',
  );
  await proponerGuion(db, GuionEntrada.parse(guionConModelos()), 'licitaciones');
});
