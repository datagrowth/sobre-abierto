// El plan con que se rellenó un anexo (Word y PDF con formulario) queda guardado en
// oferta_documentos.sustituciones con el dato de la hoja de cada hueco y el valor de la hoja
// (en la oferta, solo la cifra del importe); un plan que ya no valida se ignora. Sin LibreOffice.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CARPETA_PLIEGOS, decisionesCasoA, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';
import { modelosAnexos, P } from '../nucleo/fixtures/modelosAnexos.js';
import { pdfConFormulario } from '../nucleo/fixtures/formularioPdf.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-plan-'));
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
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { filaDocumento } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { leerPlan } = await import('../../src/dominios/licitaciones/oferta/anexoPlan.js');
const { localizarHuecos } = await import('../../src/nucleo/documentos/rellenar.js');

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);
const db = dbLicitaciones();
const MODELOS = await modelosAnexos();
const WORD = 'a2-d1';
const PDF = 'a1-d6';

const guion = guionCon((g) => {
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
    origen: { modelo: 'Anexo VI', documento: 'Modelos.pdf', pagina: 1 },
  } as never;
});
function pliego(nombre: string, contenido: Buffer): void {
  const ruta = `${CARPETA_PLIEGOS}/${nombre}`;
  fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, ruta), contenido);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', ?, 'descargado', ?, ?)",
  ).run(ID, `https://contrataciondelestado.es/${encodeURIComponent(nombre)}`, nombre, ruta, new Date().toISOString());
}

guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, new Date().toISOString(), new Date().toISOString());
pliego('Anexos PCAP.docx', MODELOS);
pliego('Modelos.pdf', await pdfConFormulario());
assert.equal((await proponerGuion(db, GuionEntrada.parse(guion), 'licitaciones')).error, null);
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
{
  const d = decisionesCasoA([PERSONA]);
  d.automaticos[0]!.nos_acogemos = true;
  const r = guardarDecisiones(db, nucleo().db, ID, { ...d, precio: { importe: 40_000, pendiente: false } });
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

const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';

// Pedir la checklist antes crea las filas de documentos que luego actualiza el anexo.
async function enviar(clave: string, args: Record<string, unknown>) {
  await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/documentos`);
  const c = new Client({ name: 'test', version: '1.0.0' });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_LICI}` } },
    }),
  );
  try {
    return await c.callTool({ name: 'licitaciones_anexo', arguments: { id: ID, clave, ...args } });
  } finally {
    await c.close();
  }
}

const parrafos = localizarHuecos(MODELOS).data!.parrafos;
const trozo = (n: number, re: RegExp) => re.exec(parrafos.find((p) => p.indice === n)!.texto)![0];
const NIF = trozo(P.nombre7, /con NIF …+/);
const IMPORTE = trozo(P.importe7, /importe de …+/);
const planDe = (clave: string) => leerPlan(filaDocumento(db, ID, clave)!.sustituciones);

test('should_store_each_gap_with_its_data_field_and_the_value_used', async () => {
  const sustituciones = [
    { parrafo: P.nombre7, original: NIF, nuevo: 'con NIF 12345678Z', dato: 'NIF del representante' },
    { parrafo: P.importe7, original: IMPORTE, nuevo: 'importe de 40.000,00', dato: 'Importe sin impuestos' },
  ];
  const r = await enviar(WORD, { desde_parrafo: P.anexo7, hasta_parrafo: P.firma7, sustituciones });
  assert.equal(r.isError, undefined, texto(r));
  const plan = planDe(WORD);
  assert.equal(plan?.formato, 'docx');
  if (plan?.formato !== 'docx') return;
  assert.deepEqual(
    [plan.desde, plan.hasta, plan.lote, filaDocumento(db, ID, WORD)!.cambios_huecos],
    [P.anexo7, P.firma7, null, null],
  );
  assert.deepEqual(
    plan.items.map((i) => [i.parrafo, i.original, i.nuevo, i.dato]),
    sustituciones.map((s) => [s.parrafo, s.original, s.nuevo, s.dato]),
  );
  assert.equal(plan.items[0]!.valor, '12345678Z');
});

test('should_store_only_the_price_figure_for_offer_fields', () => {
  const plan = planDe(WORD);
  const importe = plan?.formato === 'docx' ? plan.items.find((i) => i.dato === 'Importe sin impuestos') : undefined;
  assert.equal(importe?.valor, '40.000,00 €', 'la cifra de la hoja, sin el texto que sigue al paréntesis');
});

test('should_store_pdf_fields_with_their_data_field', async () => {
  const campos = [
    { nombre: 'NIF', valor: 'B12345678', dato: 'NIF' },
    { nombre: 'Importe', valor: '40.000,00', dato: 'Importe sin impuestos' },
    { nombre: 'Acepta_condiciones', valor: true, dato: 'Certificado ISO 14001' },
  ];
  const r = await enviar(PDF, { campos });
  assert.equal(r.isError, undefined, texto(r));
  const plan = planDe(PDF);
  assert.equal(plan?.formato, 'pdf');
  if (plan?.formato !== 'pdf') return;
  assert.deepEqual(
    plan.campos.map((c) => [c.nombre, c.valor, c.dato]),
    campos.map((c) => [c.nombre, c.valor, c.dato]),
  );
  assert.equal(plan.campos[0]!.valor_hoja, 'B12345678');
  assert.equal(plan.campos[1]!.valor_hoja, '40.000,00 €');
});

test('should_ignore_a_stored_plan_that_no_longer_validates', () => {
  assert.equal(leerPlan(null), null);
  assert.equal(leerPlan('no es json'), null);
  assert.equal(leerPlan(JSON.stringify({ formato: 'docx', lote: null, desde: 1 })), null, 'le faltan campos');
  assert.equal(leerPlan(JSON.stringify({ formato: 'odt' })), null, 'formato desconocido');
});
