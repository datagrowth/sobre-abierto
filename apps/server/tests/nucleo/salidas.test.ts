// Documentos de Salidas y Conocimiento: rutas que nunca salen de su carpeta, sin CV de
// colaboradores ni carpetas ocultas (salvo .gdocs), listado y lectura por partes, también
// por MCP con salidas_leer.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'salidas-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(path.join(salidas, 'Licitaciones', 'EXP-1 (p-1)', '.gdocs'), { recursive: true });
fs.mkdirSync(path.join(conocimiento, 'Colaboradores'), { recursive: true });
fs.mkdirSync(agentes);
fs.writeFileSync(
  path.join(salidas, 'Licitaciones', 'EXP-1 (p-1)', 'borrador.md'),
  `# Borrador\n${'texto '.repeat(5000)}`,
);
fs.writeFileSync(path.join(salidas, 'Licitaciones', 'EXP-1 (p-1)', '.gdocs', 'memoria.docx'), 'no es un docx');
fs.writeFileSync(path.join(salidas, 'Licitaciones', 'EXP-1 (p-1)', 'notas.exe'), 'binario');
fs.writeFileSync(path.join(tmp, 'secreto.md'), 'fuera de Salidas');
fs.writeFileSync(path.join(conocimiento, 'Colaboradores', 'cv-ana.md'), 'CV');
// Una unión (Windows) o enlace simbólico dentro de Salidas que apunta fuera de ella.
fs.mkdirSync(path.join(tmp, 'fuera'));
fs.writeFileSync(path.join(tmp, 'fuera', 'entorno.md'), 'SECRETO');
fs.symlinkSync(path.join(tmp, 'fuera'), path.join(salidas, 'enlace'), 'junction');
const T_LICI = 'l'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { herramientasBiblioteca } = await import('../../src/nucleo/mcp/biblioteca.js');
const {
  esRutaDocumento,
  documentoEnDisco,
  archivoExistente,
  rutaDeSalidas,
  documentosDe,
  leerDocumento,
  listarSalidas,
  esCarpeta,
  MAX_LECTURA,
  raicesActuales,
} = await import('../../src/nucleo/salidas.js');
const { fijarRutaBiblioteca, restablecerRutaBiblioteca } = await import('../../src/biblioteca/motor/configuracion.js');

iniciarNucleo();
anadirHerramientas(herramientasBiblioteca);
const RAICES = { salidas, conocimiento };

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(
    '/mcp',
    routerMcp(() => agentes),
  );
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

after(() => {
  server.close();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('should_accept_only_paths_inside_salidas_or_conocimiento', () => {
  assert.equal(esRutaDocumento('Salidas/Licitaciones/EXP-1 (p-1)/borrador.md'), true);
  assert.equal(esRutaDocumento('Conocimiento/Licitaciones/2026/EXP-1 (p-1)/propuesta.pdf'), true);
  assert.equal(esRutaDocumento('Salidas/.gdocs/Licitaciones/memoria.docx'), true, 'la copia de los Google Docs sí');
  for (const mala of [
    'Salidas/../secreto.md',
    'Salidas/./x.md',
    'Salidas/.ocultos/x.md',
    'Salidas//x.md',
    'Salidas/a\\..\\b.md',
    'C:/x.md',
    'Otra/x.md',
    'Salidas',
    'Conocimiento/Colaboradores/cv-ana.md',
    'Conocimiento/colaboradores/cv-ana.md',
    'Salidas/x\u0000.md',
    'Conocimiento/.gdocs/Colaboradores/Ana Pérez.docx',
  ]) {
    assert.equal(esRutaDocumento(mala), false, mala);
  }
});

test('should_never_resolve_a_document_outside_its_folder', () => {
  const dentro = documentoEnDisco(RAICES, 'Salidas/Licitaciones/EXP-1 (p-1)/borrador.md');
  assert.equal(dentro.data, path.join(salidas, 'Licitaciones', 'EXP-1 (p-1)', 'borrador.md'));
  assert.equal(documentoEnDisco(RAICES, 'Salidas/../secreto.md').error?.code, 'invalid_input');
  assert.equal(documentoEnDisco({ salidas: null, conocimiento }, 'Salidas/x/y.md').error?.code, 'no_configurado');
  assert.equal(archivoExistente(RAICES, 'Salidas/Licitaciones/no-existe.md').error?.code, 'not_found');
  assert.equal(
    archivoExistente(RAICES, 'Salidas/Licitaciones').error?.code,
    'not_found',
    'una carpeta no es un documento',
  );
});

test('should_refuse_documents_reached_through_links_that_leave_the_folder', async () => {
  assert.equal(archivoExistente(RAICES, 'Salidas/enlace/entorno.md').error?.code, 'invalid_input');
  const leido = await leerDocumento(RAICES, 'Salidas/enlace/entorno.md');
  assert.equal(leido.error?.code, 'invalid_input');
  assert.deepEqual(documentosDe(RAICES, 'Salidas/enlace'), []);
  assert.ok(
    !documentosDe(RAICES, 'Salidas').some((r) => r.startsWith('Salidas/enlace')),
    'el listado no entra en enlaces',
  );
});

test('should_normalize_agent_paths_to_salidas', () => {
  assert.equal(rutaDeSalidas(salidas, 'Licitaciones/a.md'), 'Salidas/Licitaciones/a.md');
  assert.equal(rutaDeSalidas(salidas, 'Salidas/Licitaciones/a.md'), 'Salidas/Licitaciones/a.md');
  assert.equal(
    rutaDeSalidas(salidas, 'Conocimiento/Licitaciones/Ofertas/X (p-1)/Oferta/a.md'),
    'Conocimiento/Licitaciones/Ofertas/X (p-1)/Oferta/a.md',
    'la oferta en su carpeta única',
  );
  assert.equal(rutaDeSalidas(salidas, `${salidas}${path.sep}Licitaciones${path.sep}a.md`), 'Salidas/Licitaciones/a.md');
  assert.equal(rutaDeSalidas(salidas, '/Licitaciones/a.md'), 'Salidas/Licitaciones/a.md');
});

test('should_list_documents_of_a_folder_without_hidden_or_unknown_files', () => {
  assert.deepEqual(documentosDe(RAICES, 'Salidas/Licitaciones/EXP-1 (p-1)'), [
    'Salidas/Licitaciones/EXP-1 (p-1)/.gdocs/memoria.docx',
    'Salidas/Licitaciones/EXP-1 (p-1)/borrador.md',
  ]);
  assert.deepEqual(documentosDe(RAICES, 'Salidas/no-existe'), []);
  assert.deepEqual(documentosDe(RAICES, 'Salidas/../'), []);
});

test('should_list_offer_folder_documents_four_levels_deep', () => {
  // Arrange: la estructura del paquete de una oferta, PRESENTACION/vN/Lote N/<n> Sobre X/.
  const oferta = path.join(salidas, 'Licitaciones', 'CP-0417-2027 (p-2)');
  const sobre = path.join(oferta, 'PRESENTACION', 'v1', 'Lote 2', '1 Sobre A');
  fs.mkdirSync(sobre, { recursive: true });
  fs.writeFileSync(path.join(sobre, 'deuc.pdf'), '%PDF');
  fs.writeFileSync(path.join(oferta, 'memoria.md'), '# Memoria');
  const carpeta = 'Salidas/Licitaciones/CP-0417-2027 (p-2)';
  try {
    // Act
    const hondo = listarSalidas(RAICES, carpeta, 4);
    const corto = listarSalidas(RAICES, carpeta, 2);
    // Assert
    assert.equal(hondo.error, null);
    assert.deepEqual(
      hondo.data?.documentos.map((d) => d.ruta),
      [`${carpeta}/PRESENTACION/v1/Lote 2/1 Sobre A/deuc.pdf`, `${carpeta}/memoria.md`],
    );
    assert.equal(hondo.data?.documentos[1]?.tamano, '# Memoria'.length);
    assert.ok(!Number.isNaN(Date.parse(hondo.data?.documentos[1]?.modificado ?? '')));
    assert.equal(hondo.data?.recortado, false);
    assert.deepEqual(
      corto.data?.documentos.map((d) => d.ruta),
      [`${carpeta}/memoria.md`],
      'con 2 niveles no llega al sobre',
    );
    assert.equal(
      listarSalidas(RAICES, `${carpeta}/memoria.md`, 4).error?.code,
      'not_found',
      'un archivo no es una carpeta',
    );
    assert.equal(listarSalidas(RAICES, 'Salidas/Licitaciones/no-existe', 4).error?.code, 'not_found');
    assert.equal(listarSalidas(RAICES, 'Salidas/../', 4).error?.code, 'invalid_input');
  } finally {
    fs.rmSync(oferta, { recursive: true });
  }
});

test('should_strip_trailing_slash_from_salidas_path', () => {
  assert.equal(
    rutaDeSalidas(salidas, 'Salidas/Licitaciones/CP-0417-2027 (p-91000880)/'),
    'Salidas/Licitaciones/CP-0417-2027 (p-91000880)',
  );
  assert.equal(rutaDeSalidas(salidas, 'Licitaciones/EXP-1 (p-1)//'), 'Salidas/Licitaciones/EXP-1 (p-1)');
  assert.equal(rutaDeSalidas(salidas, 'Salidas/'), 'Salidas', 'no se convierte en «Salidas/Salidas»');
  assert.equal(esCarpeta(RAICES, rutaDeSalidas(salidas, 'Licitaciones/EXP-1 (p-1)/')), true);
  assert.equal(esCarpeta(RAICES, 'Salidas/Licitaciones/EXP-1 (p-1)/borrador.md'), false);
});

test('should_read_documents_by_parts_and_report_unreadable_ones', async () => {
  const ruta = 'Salidas/Licitaciones/EXP-1 (p-1)/borrador.md';
  const primera = await leerDocumento(RAICES, ruta);
  assert.equal(primera.error, null);
  assert.equal(primera.data?.hasta, MAX_LECTURA);
  assert.ok(primera.data!.total > MAX_LECTURA);
  const segunda = await leerDocumento(RAICES, ruta, primera.data!.hasta);
  assert.equal(segunda.data?.desde, MAX_LECTURA);
  assert.equal(segunda.data?.hasta, primera.data!.total);
  const roto = await leerDocumento(RAICES, 'Salidas/Licitaciones/EXP-1 (p-1)/.gdocs/memoria.docx');
  assert.equal(roto.error?.code, 'read_error');
  assert.equal(
    (await leerDocumento(RAICES, 'Salidas/Licitaciones/EXP-1 (p-1)/notas.exe')).error?.code,
    'invalid_input',
    'formato no admitido',
  );
});

test('should_read_salidas_through_mcp_and_refuse_traversal', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${T_LICI}` } },
    }),
  );
  try {
    const ok = await client.callTool({
      name: 'salidas_leer',
      arguments: { ruta: 'Licitaciones/EXP-1 (p-1)/borrador.md', max: 100 },
    });
    assert.equal(ok.isError, undefined);
    assert.match((ok.content as { text: string }[])[0]?.text ?? '', /# Borrador/);
    const fuera = await client.callTool({ name: 'salidas_leer', arguments: { ruta: '../secreto.md' } });
    assert.equal(fuera.isError, true);
    assert.doesNotMatch((fuera.content as { text: string }[])[0]?.text ?? '', /fuera de Salidas/);
    const porEnlace = await client.callTool({ name: 'salidas_leer', arguments: { ruta: 'enlace/entorno.md' } });
    assert.equal(porEnlace.isError, true);
    assert.doesNotMatch((porEnlace.content as { text: string }[])[0]?.text ?? '', /SECRETO/);
  } finally {
    await client.close();
  }
});

test('should_keep_conocimiento_at_VAULT_PATH_even_with_a_vault_saved_in_the_web_settings', () => {
  // Arrange
  const otra = path.join(tmp, 'boveda-de-la-web');
  fs.mkdirSync(otra);
  assert.equal(raicesActuales().conocimiento, path.resolve(conocimiento), 'sin ajustes vale VAULT_PATH');
  // Act
  fijarRutaBiblioteca(otra);
  try {
    const raices = raicesActuales();
    // Assert
    assert.equal(raices.conocimiento, path.resolve(conocimiento), 'manda el despliegue, no una ruta guardada');
    assert.equal(raices.salidas, salidas);
  } finally {
    restablecerRutaBiblioteca();
  }
});
