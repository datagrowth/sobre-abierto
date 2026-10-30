// salidas_leer por páginas o por sección: 15 páginas por llamada con la página para seguir,
// una sección «## N.» de un Markdown entera, y la ruta siempre con el prefijo «Salidas/».
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { PDFDocument } from 'pdf-lib';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'salidas-leer-'));
const salidas = path.join(tmp, 'salidas');
const agentes = path.join(tmp, '.agentes');
const carpeta = path.join(salidas, 'Licitaciones', 'EXP-1 (p-1)');
fs.mkdirSync(carpeta, { recursive: true });
fs.mkdirSync(agentes);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), 'l'.repeat(40));
// Sin permiso de colaboradores (se lo quita el ajuste de permisos).
fs.writeFileSync(path.join(agentes, 'mirador.token'), 's'.repeat(40));
fs.writeFileSync(path.join(agentes, 'permisos.json'), JSON.stringify({ mirador: { colaboradores: 'ninguno' } }));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
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
const { leerDocumento, leerPaginas, leerSeccion, MAX_SECCION } = await import('../../src/nucleo/salidas.js');
const { generarDocx } = await import('../../src/nucleo/documentos/docx.js');
// Las reservas de Salidas que registra Licitaciones al cargar (importes y copias personales).
await import('../../src/dominios/licitaciones/tools.js');
const { cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');

iniciarNucleo();
anadirHerramientas(herramientasBiblioteca);
const RAICES = { salidas, conocimiento: null };
const MD = 'Licitaciones/EXP-1 (p-1)/memoria.md';

let server: http.Server;
let base = '';

before(async () => {
  const pdf = await PDFDocument.create();
  for (let i = 1; i <= 20; i++) pdf.addPage().drawText(`Contenido de la pagina ${i}`, { x: 50, y: 700 });
  fs.writeFileSync(path.join(carpeta, 'pliego.pdf'), await pdf.save());
  fs.writeFileSync(
    path.join(carpeta, 'memoria.md'),
    '# Memoria\nIntro\n\n## 1. Equipo\nDos personas.\n\n## 2. Calidad\nControl mensual.\n\n## 3. Mejoras\nFormacion.\n',
  );
  const docx = await generarDocx({
    portada: {
      titulo: 'Memoria',
      subtitulo: 'x',
      expediente: '1/2026',
      organo: 'Organo',
      licitadora: { nombre: 'Empresa, S.L.', nif: 'B00000000', domicilio: 'Calle 1' },
      fecha: '1 de octubre de 2026',
      lotes: [],
    },
    apartados: [{ numero: '1', titulo: 'Equipo', bloques: [{ parrafos: ['Texto.'] }] }],
    pie: { texto: 'Pie', numeracion: false },
  } as never);
  fs.writeFileSync(path.join(carpeta, 'memoria.docx'), docx as Buffer);
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
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('should_return_15_pages_and_next_page_when_more_are_asked', async () => {
  const r = await leerPaginas(RAICES, `Salidas/${MD.replace('memoria.md', 'pliego.pdf')}`, 1, 20);
  assert.equal(r.error, null);
  assert.equal(r.data!.total_paginas, 20);
  assert.equal(r.data!.hasta, 15);
  assert.equal(r.data!.siguiente_pagina_desde, 16);
  assert.match(r.data!.texto, /\[pág\. 15\]\nContenido de la pagina 15/);
  assert.doesNotMatch(r.data!.texto, /pagina 16/);
  const resto = await leerPaginas(RAICES, `Salidas/${MD.replace('memoria.md', 'pliego.pdf')}`, 16, 20);
  assert.equal(resto.data!.siguiente_pagina_desde, null);
  assert.equal(resto.data!.hasta, 20);
});

test('should_read_one_markdown_section_by_number', async () => {
  const r = await leerSeccion(RAICES, `Salidas/${MD}`, 2);
  assert.equal(r.error, null);
  assert.match(r.data!.texto, /^## 2\. Calidad\nControl mensual\.$/);
  assert.deepEqual(r.data!.secciones, [1, 2, 3]);
});

test('should_cap_a_section_over_the_limit_and_say_where_to_continue', async () => {
  // Arrange: una «## 2.» de 80.000 caracteres (una memoria con anexos pegados) entre otras dos.
  const larga = `## 2. Anexos
${'x'.repeat(80_000)}`;
  const texto = `# Memoria

## 1. Equipo
Dos.

${larga}

## 3. Mejoras
Fin.
`;
  fs.writeFileSync(path.join(carpeta, 'larga.md'), texto);
  const ruta = `Salidas/${MD.replace('memoria.md', 'larga.md')}`;
  // Act
  const r = await leerSeccion(RAICES, ruta, 2);
  const resto = await leerDocumento(RAICES, ruta, r.data!.siguiente_desde!);
  // Assert
  assert.equal(r.error, null);
  assert.equal(r.data!.texto.length, MAX_SECCION);
  assert.deepEqual(
    [r.data!.total, r.data!.desde, r.data!.siguiente_desde],
    [larga.length, texto.indexOf('## 2.'), texto.indexOf('## 2.') + MAX_SECCION],
  );
  assert.ok(larga.startsWith(r.data!.texto), 'el principio de la sección');
  assert.ok(
    resto.data!.texto.length > 0 && larga.slice(MAX_SECCION).startsWith(resto.data!.texto),
    'con desde=siguiente_desde sigue justo donde se cortó',
  );
  const corta = await leerSeccion(RAICES, ruta, 1);
  assert.equal(corta.data!.siguiente_desde, null, 'una sección que cabe no tiene continuación');
});

test('should_list_sections_when_the_number_does_not_exist', async () => {
  const r = await leerSeccion(RAICES, `Salidas/${MD}`, 9);
  assert.equal(r.error?.code, 'not_found');
  assert.match(r.error!.message, /No hay sección 9\. Secciones: 1, 2, 3/);
});

test('should_say_it_is_a_folder_and_name_salidas_listar', async () => {
  const client = new Client({ name: 't', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { authorization: `Bearer ${'l'.repeat(40)}` } },
    }),
  );
  const r = await client.callTool({
    name: 'salidas_leer',
    arguments: { ruta: 'Licitaciones/EXP-1 (p-1)/', seccion: 1 },
  });
  assert.match(JSON.stringify(r.content), /salidas_listar/);
  await client.close();
});

test('should_reject_pages_for_a_word_without_pages', async () => {
  const r = await leerPaginas(RAICES, 'Salidas/Licitaciones/EXP-1 (p-1)/memoria.docx', 1);
  assert.equal(r.error?.code, 'invalid_input');
  assert.match(r.error!.message, /no tiene páginas/);
});

test('should_always_prefix_route_with_Salidas', async () => {
  const client = new Client({ name: 't', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { authorization: `Bearer ${'l'.repeat(40)}` } },
    }),
  );
  const r = await client.callTool({
    name: 'salidas_leer',
    arguments: { ruta: 'Licitaciones/EXP-1 (p-1)/pliego.pdf', pagina_desde: 2, pagina_hasta: 3 },
  });
  const texto = JSON.stringify(r.content);
  assert.match(texto, /Salidas\/Licitaciones\/EXP-1 \(p-1\)\/pliego\.pdf/);
  assert.match(texto, /pagina 3/);
  const mezcla = await client.callTool({ name: 'salidas_leer', arguments: { ruta: MD, seccion: 1, desde: 5 } });
  assert.match(JSON.stringify(mezcla.content), /una sola forma/);
  await client.close();
});

async function como(token: string) {
  const client = new Client({ name: 't', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

test('should_hide_the_copy_of_a_cv_from_an_agent_without_colaboradores_permission', async () => {
  // Arrange: un CV reutilizado de la carpeta Empresa, copiado a documentos/Colaboradores/ de la oferta.
  const cv = 'Licitaciones/EXP-1 (p-1)/documentos/Colaboradores/cv-persona.md';
  fs.mkdirSync(path.join(salidas, ...path.dirname(cv).split('/')), { recursive: true });
  fs.writeFileSync(path.join(salidas, ...cv.split('/')), ['# CV', 'Persona A, 10 años.', ''].join('\n'));
  const [sin, con] = [await como('s'.repeat(40)), await como('l'.repeat(40))];

  // Act
  const listaSin = JSON.stringify(
    (await sin.callTool({ name: 'salidas_listar', arguments: { carpeta: 'Licitaciones/EXP-1 (p-1)' } })).content,
  );
  const leerSin = JSON.stringify((await sin.callTool({ name: 'salidas_leer', arguments: { ruta: cv } })).content);
  const listaCon = JSON.stringify(
    (await con.callTool({ name: 'salidas_listar', arguments: { carpeta: 'Licitaciones/EXP-1 (p-1)' } })).content,
  );
  await Promise.all([sin.close(), con.close()]);

  // Assert
  assert.doesNotMatch(listaSin, /cv-persona/);
  assert.match(listaSin, /ocultos/);
  assert.match(leerSin, /colaboradores/);
  assert.doesNotMatch(leerSin, /10 años/);
  assert.match(listaCon, /cv-persona/, 'quien puede ver colaboradores sí la ve');
});

test('should_stop_at_the_last_whole_page_that_fits_and_continue_from_the_next', async () => {
  // Arrange: un pliego de 15 páginas de unos 5.000 caracteres (75.000: más que una respuesta).
  const pdf = await PDFDocument.create();
  const linea = (p: number, l: number) => `Pagina ${p} linea ${l} `.padEnd(95, 'x');
  for (let p = 1; p <= 15; p++) {
    const pagina = pdf.addPage([595, 842]);
    for (let l = 1; l <= 52; l++) pagina.drawText(linea(p, l), { x: 10, y: 830 - l * 15, size: 6 });
  }
  const ruta = 'Salidas/Licitaciones/EXP-1 (p-1)/pliego-largo.pdf';
  fs.writeFileSync(path.join(carpeta, 'pliego-largo.pdf'), await pdf.save());

  // Act
  const r = await leerPaginas(RAICES, ruta, 1, 15);
  const resto = await leerPaginas(RAICES, ruta, r.data!.siguiente_pagina_desde!, 15);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.ok(r.data!.texto.length <= MAX_SECCION, 'cabe en la respuesta sin recortes');
  assert.ok(r.data!.hasta < 15);
  assert.equal(r.data!.siguiente_pagina_desde, r.data!.hasta + 1);
  assert.match(r.data!.texto, new RegExp(`Pagina ${r.data!.hasta} linea 52`), 'la última página va entera');
  assert.doesNotMatch(r.data!.texto, new RegExp(`Pagina ${r.data!.hasta + 1} linea`));
  assert.match(
    resto.data!.texto,
    new RegExp(`^\\[pág\\. ${r.data!.hasta + 1}\\]`),
    'sigue justo en la página siguiente',
  );
});
