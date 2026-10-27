// Anexo cuyo modelo es un PDF con formulario (AcroForm), caso A (p-91000710): la checklist
// dice, con el análisis guardado del PDF (modelosPdf.ts), si no se puede rellenar (sin campos ni
// huecos, no es un PDF) o si aún se está leyendo, las instrucciones del run
// listan los campos con su página, el anexo se rellena campo a campo sin aplanarlo y se guarda
// en Salidas como PDF, y se rechaza texto en una firma, un precio sin decidir y un campo que no
// existe (hasta el tercer envío). Sin LibreOffice.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CARPETA_PLIEGOS, decisionesCasoA, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';
import { pdfConFormulario } from '../nucleo/fixtures/formularioPdf.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-pdf-'));
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
process.env.CONVERSIONES_DIR = path.join(tmp, 'conversiones');
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
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { instruccionesDeAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosInstrucciones.js');
const { LEYENDO_PDF } = await import('../../src/dominios/licitaciones/oferta/anexosModeloPdf.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { prepararModelosPdf } = await import('../../src/dominios/licitaciones/oferta/modelosPdf.js');
const { camposDePdf } = await import('../../src/nucleo/documentos/formularioPdf.js');

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();
const MODELO = 'a1-d6';
const CARPETA_SALIDAS = `Salidas/Licitaciones/EXP-2026-0412 (${ID})`;
const RUTA_PLIEGO = `${CARPETA_PLIEGOS}/Modelos.pdf`;

// El Anexo VI del guion del caso A sale de «Modelos.pdf»: aquí es un formulario de verdad.
const guion = guionCon((g) => {
  g.archivos[0]!.documentos[5] = {
    tipo: 'declaracion',
    nombre: 'Anexo VI',
    obligatorio: true,
    produce: 'persona',
    origen: { modelo: 'Anexo VI', documento: 'Modelos.pdf', pagina: 1 },
  } as never;
});
const ponerPliego = (contenido: Buffer) => {
  fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, RUTA_PLIEGO), contenido);
};
// La vuelta de la oferta analiza el PDF (cada contenido una vez) antes de que se pueda pedir.
const analizar = () => prepararModelosPdf(db, { salidas, conocimiento });

guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, new Date().toISOString(), new Date().toISOString());
ponerPliego(await pdfConFormulario());
db.prepare(
  "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', 'Modelos.pdf', 'descargado', ?, ?)",
).run(ID, 'https://contrataciondelestado.es/Modelos.pdf', RUTA_PLIEGO, new Date().toISOString());
assert.equal((await proponerGuion(db, GuionEntrada.parse(guion), 'licitaciones')).error, null);
await analizar();
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
decidir(40_000);

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
const api = (ruta: string, method = 'POST') =>
  fetch(
    `${base}/api/licitaciones/licitaciones/${ID}/oferta${ruta}`,
    method === 'GET' ? {} : { method, headers: json, body: '{}' },
  );
type Doc = {
  clave: string;
  estado: string;
  ruta: string | null;
  ruta_pdf: string | null;
  anexo: {
    rellenable: boolean;
    motivo: string | null;
    avisos: string[];
    modelo: { tipo: string; ruta: string; pagina: number | null } | null;
  };
};
const fila = async () =>
  ((await (await api('/documentos', 'GET')).json()) as { documentos: Doc[] }).documentos.find(
    (d) => d.clave === MODELO,
  )!;
const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';
const olvidarRechazos = () => nucleo().db.prepare('DELETE FROM auditoria_agentes').run();

async function enviar(args: Record<string, unknown>) {
  const c = new Client({ name: 'test', version: '1.0.0' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_LICI}` } },
    }),
  );
  try {
    return await c.callTool({ name: 'licitaciones_anexo', arguments: { id: ID, clave: MODELO, ...args } });
  } finally {
    await c.close();
  }
}

const BIEN = [
  { nombre: 'NIF', valor: 'B12345678', dato: 'NIF' },
  { nombre: 'Importe', valor: '40.000,00', dato: 'Importe sin impuestos' },
  { nombre: 'Acepta_condiciones', valor: true, dato: 'Certificado ISO 14001' },
  { nombre: 'Tipo_empresa', valor: 'Pyme', dato: 'Tipo de empresa' },
];

test('should_say_early_that_a_pdf_model_without_fields_or_a_broken_pdf_must_be_filled_by_hand', async () => {
  ponerPliego(await pdfConFormulario({ sinCampos: true }));
  assert.deepEqual(
    [(await fila()).anexo.rellenable, (await fila()).anexo.motivo],
    [false, LEYENDO_PDF],
    'hasta que la vuelta lo analice',
  );
  await analizar();
  const sin = await fila();
  assert.deepEqual(
    [sin.anexo.rellenable, sin.anexo.motivo, sin.anexo.modelo?.tipo],
    [false, 'No encuentro «Anexo VI» con huecos en «Modelos.pdf»: rellénalo a mano.', 'a_mano'],
  );
  const pedido = await api(`/documentos/${MODELO}/anexo`);
  assert.equal(pedido.status, 400);
  assert.match(
    ((await pedido.json()) as { message: string }).message,
    /con huecos en «Modelos\.pdf»: rellénalo a mano/,
  );
  ponerPliego(Buffer.from('%PDF-1.4 esto no se puede leer'));
  await analizar();
  assert.match((await fila()).anexo.motivo ?? '', /No se puede leer el texto del PDF/);
  ponerPliego(await pdfConFormulario());
  await analizar();
  const con = await fila();
  assert.deepEqual(
    [con.anexo.rellenable, con.anexo.motivo, con.anexo.modelo],
    [true, null, { tipo: 'campos', ruta: `Conocimiento/${RUTA_PLIEGO}`, pagina: 1 }],
    'con campos, se puede rellenar',
  );
});

test('should_give_the_last_page_when_the_pdf_model_spans_several_pages', async () => {
  // Arrange: el análisis dice que el modelo ocupa de la página 1 a la 3.
  const antes = db.prepare('SELECT rowid AS r, hasta_pagina AS h FROM modelos_pdf').all() as {
    r: number;
    h: number | null;
  }[];
  db.prepare('UPDATE modelos_pdf SET hasta_pagina = 3').run();

  // Act
  const varias = (await fila()).anexo.modelo;
  db.prepare('UPDATE modelos_pdf SET hasta_pagina = 1').run();
  const una = (await fila()).anexo.modelo;
  for (const f of antes) db.prepare('UPDATE modelos_pdf SET hasta_pagina = ? WHERE rowid = ?').run(f.h, f.r);

  // Assert: con una sola página no se manda (la web dice «pág. 1», no «págs. 1-1»).
  assert.deepEqual(varias, { tipo: 'campos', ruta: `Conocimiento/${RUTA_PLIEGO}`, pagina: 1, hasta_pagina: 3 });
  assert.deepEqual(una, { tipo: 'campos', ruta: `Conocimiento/${RUTA_PLIEGO}`, pagina: 1 });
});

test('should_give_hermes_the_fields_of_the_pdf_form_with_their_pages', async () => {
  const r = await api(`/documentos/${MODELO}/anexo`);
  assert.equal(r.status, 202);
  const ins = await instruccionesDeAnexo(db, nucleo().db, {
    id: ID,
    clave: MODELO,
    pedida_en: new Date().toISOString(),
  });
  assert.match(ins, /rellena el modelo «Anexo VI» \(Anexo VI, Modelos\.pdf pág\. 1\)/);
  assert.match(ins, /Es un formulario PDF: se rellenan solo sus campos/);
  assert.match(ins, /- «NIF» \(texto, pág\. 1\)/);
  assert.match(ins, /- «Tipo_empresa» \(radio, pág\. 1, opciones: «Pyme», «Gran empresa»\)/);
  assert.match(ins, /- «Firma» \(firma, pág\. 2 — FIRMA: no se rellena\)/);
  assert.match(
    ins,
    /ANEXO VI\. Declaración responsable del licitador/,
    'el texto del PDF, para emparejar etiquetas con campos',
  );
  assert.match(ins, /licitaciones_anexo \(id=p-91000710, clave=a1-d6, campos\)/);
  assert.match(ins, /- Empresa · NIF del representante: 12345678Z/);
  const trabajo = nucleo()
    .db.prepare("SELECT tipo FROM trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.clave') = ?")
    .get(TIPO_ANEXO, MODELO) as { tipo: string };
  assert.equal(trabajo.tipo, TIPO_ANEXO);
});

test('should_reject_text_in_a_signature_and_a_price_that_is_not_decided_in_a_pdf', async () => {
  olvidarRechazos();
  for (let n = 1; n <= 3; n += 1) {
    const firmado = await enviar({
      campos: [...BIEN, { nombre: 'Firma', valor: 'Ana García Pérez', dato: 'Representante' }],
    });
    assert.equal(firmado.isError, true, `rechazo ${n}: nunca se acepta`);
    assert.match(
      texto(firmado),
      /La firma se deja en blanco: la pone una persona con su certificado \(campo «Firma»\)\./,
    );
  }
  olvidarRechazos();
  decidir(null);
  const sinPrecio = await enviar({ campos: BIEN });
  assert.equal(sinPrecio.isError, true);
  assert.match(
    texto(sinPrecio),
    /El precio aún no está decidido \(decisiones de la oferta\): no envíes el campo «Importe» del importe; lo rellena una persona cuando se fije\./,
  );
  decidir(40_000);
});

test('should_refuse_word_fields_for_a_pdf_model', async () => {
  const mezcla = await enviar({ desde_parrafo: 1, hasta_parrafo: 2, sustituciones: [], campos: BIEN });
  assert.equal(mezcla.isError, true);
  assert.match(
    texto(mezcla),
    /Este modelo es un PDF con formulario: envía «campos», sin desde_parrafo, hasta_parrafo ni sustituciones/,
  );
});

test('should_reject_wrong_data_and_unknown_fields_until_the_third_try', async () => {
  olvidarRechazos();
  const mal = await enviar({
    campos: [
      { nombre: 'NIF', valor: 'X99999999', dato: 'NIF' },
      { nombre: 'Inventado', valor: 'x', dato: 'Domicilio' },
    ],
  });
  assert.equal(mal.isError, true);
  assert.match(
    texto(mal),
    /No encuentro el campo «Inventado» en el formulario: usa el nombre exacto de la lista de la tarea\./,
  );
  assert.match(
    texto(mal),
    /«NIF» es «B12345678» en la hoja de datos y el campo «NIF» pone «X99999999»: copia el dato tal cual\./,
  );
  const tel = await enviar({ campos: [{ nombre: 'Lugar', valor: '922 000 000', dato: 'Teléfono' }] });
  assert.match(texto(tel), /La hoja de datos no trae «Teléfono»: no envíes el campo «Lugar»\./);
  const tercera = await enviar({ campos: [{ nombre: 'Inventado', valor: 'x', dato: 'Domicilio' }, ...BIEN] });
  assert.equal(tercera.isError, undefined, 'a la tercera entra con avisos');
  assert.match(
    (JSON.parse(texto(tercera)) as { avisos: string[] }).avisos.join(' '),
    /No encuentro el campo «Inventado»/,
  );
  olvidarRechazos();
});

test('should_fill_the_pdf_form_without_flattening_it_and_write_it_to_salidas', async () => {
  olvidarRechazos();
  const r = await enviar({ campos: BIEN });
  assert.equal(r.isError, undefined, texto(r));
  const d = JSON.parse(texto(r)) as {
    ruta: string;
    ruta_pdf: string | null;
    version: number;
    aplicadas: number;
    avisos: string[];
  };
  assert.equal(d.ruta, `${CARPETA_SALIDAS}/anexos/Anexo VI-v${d.version}.pdf`);
  assert.deepEqual([d.ruta_pdf, d.aplicadas], [null, 4]);
  assert.deepEqual(
    d.avisos,
    ['Quedan campos sin rellenar: «Lugar»: complétalos a mano antes de firmar.'],
    'la firma se queda en blanco a propósito',
  );
  const abs = path.join(salidas, d.ruta.replace(/^Salidas\//, ''));
  const campos = await camposDePdf(fs.readFileSync(abs));
  const por = new Map(campos.data!.map((c) => [c.nombre, c.valor]));
  assert.deepEqual(
    [
      por.get('NIF'),
      por.get('Importe'),
      por.get('Acepta_condiciones'),
      por.get('Tipo_empresa'),
      por.get('Lugar'),
      por.get('Firma'),
    ],
    ['B12345678', '40.000,00', true, 'Pyme', null, null],
  );
  const f = await fila();
  assert.deepEqual([f.estado, f.ruta, f.ruta_pdf, f.anexo.avisos], ['borrador', d.ruta, null, d.avisos]);
  const otra = JSON.parse(texto(await enviar({ campos: BIEN }))) as { version: number };
  assert.equal(otra.version, d.version + 1, 'no pisa la anterior');
  assert.ok(fs.existsSync(abs));
});

const conExtras = async (extras: string[], paginasExtra = 0) =>
  ponerPliego(await pdfConFormulario({ extras, paginasExtra }));

test('should_reject_text_in_the_signer_name_field_whatever_it_is_called_but_not_in_dates_or_places', async () => {
  olvidarRechazos();
  await conExtras(['Fdo_nombre', 'FdoNombre', 'Fecha_firma', 'Confirmacion_NIF']);
  for (const nombre of ['Fdo_nombre', 'FdoNombre']) {
    const r = await enviar({ campos: [{ nombre, valor: 'Ana García Pérez', dato: 'Representante' }] });
    assert.equal(r.isError, true, nombre);
    assert.match(
      texto(r),
      new RegExp(`La firma se deja en blanco: la pone una persona con su certificado \\(campo «${nombre}»\\)\\.`),
    );
  }
  const bien = await enviar({
    campos: [
      { nombre: 'Fecha_firma', valor: '14/10/2026', dato: 'Fecha de la firma' },
      { nombre: 'Confirmacion_NIF', valor: 'B12345678', dato: 'NIF' },
    ],
  });
  assert.equal(bien.isError, undefined, texto(bien));
  const avisos = (JSON.parse(texto(bien)) as { avisos: string[] }).avisos.join(' ');
  assert.doesNotMatch(avisos, /Fdo_nombre|FdoNombre/, 'el nombre de quien firma no se da como campo por rellenar');
  olvidarRechazos();
});

test('should_reject_an_amount_in_any_field_while_the_price_is_not_decided_but_not_the_tax_type', async () => {
  olvidarRechazos();
  await conExtras(['Tipo_impuesto']);
  decidir(null);
  const disfrazado = await enviar({ campos: [{ nombre: 'Lugar', valor: '40.000,00 €', dato: 'Domicilio' }] });
  assert.equal(disfrazado.isError, true, 'un importe en un campo cualquiera con otro dato');
  assert.match(
    texto(disfrazado),
    /El precio aún no está decidido \(decisiones de la oferta\): no envíes el campo «Lugar» del importe/,
  );
  const impuesto = await enviar({ campos: [{ nombre: 'Tipo_impuesto', valor: 'IGIC 7 %', dato: 'Impuesto' }] });
  assert.equal(impuesto.isError, undefined, 'el tipo de impuesto no lleva precio');
  decidir(40_000);
  olvidarRechazos();
});

test('should_warn_that_the_filled_pdf_is_the_whole_tender_document_when_it_has_pages_without_fields', async () => {
  olvidarRechazos();
  await conExtras([], 3);
  const r = await enviar({ campos: BIEN });
  assert.equal(r.isError, undefined, texto(r));
  assert.match(
    (JSON.parse(texto(r)) as { avisos: string[] }).avisos.join(' '),
    /El PDF rellenado es el documento entero del pliego \(5 páginas; los campos están en las páginas 1 a 2\): si trae más anexos, recórtalo a mano antes de presentarlo\./,
  );
  olvidarRechazos();
});
