// La marca de la instalación (Ajustes › Marca): nombre, colores y logo en nucleo.db, validados al
// guardar (tokens que existen, contraste AA, logo que es de verdad una imagen); la web la lee de
// /api/config y el logo de /api/marca/logo, y llega a la página y a los emails.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'marca-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { leerConfig, validarConfig } = await import('../../src/nucleo/config.js');
const { rutasPlataforma } = await import('../../src/nucleo/rutas.js');
const { abrirNucleo } = await import('../../src/nucleo/db.js');
const {
  cssDelTema,
  guardarLogo,
  guardarMarca,
  leerMarca,
  paginaConMarca,
  quitarLogo,
  rutaConfigWeb,
  rutaLogo,
  CSP_SVG,
} = await import('../../src/nucleo/marca.js');
const { repositorioDelPaquete, versionDelPaquete } = await import('../../src/nucleo/paquete.js');
const { montarCorreo } = await import('../../src/nucleo/correoPlantillas.js');

const PAGINA =
  '<!doctype html><html><head><meta charset="UTF-8" /><title>Sobre Abierto</title></head><body></body></html>';
const PLANTILLA = { asunto: 'Prueba', titulo: 'Título', intro: 'Intro', bloques: [] };
// Un tema propio que cumple AA: tinta oscura y acción clara, como el de una marca real.
const TEMA_PROPIO = { tinta: '#263B4A', 'tinta-2': '#5E7280', accion: '#B5FF82', hermes: '#BAB8D0' };
const SVG = Buffer.from(
  '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

iniciarNucleo();
let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.get('/api/config', rutaConfigWeb);
  app.get('/api/marca/logo', rutaLogo);
  app.use('/api/plataforma', rutasPlataforma());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const baseVacia = () => abrirNucleo(fs.mkdtempSync(path.join(tmp, 'vacia-')));

test('should_take_only_the_public_url_and_the_source_code_from_the_environment', () => {
  const neutra = leerConfig({});
  assert.match(
    neutra.fuente ?? '',
    /^https:\/\/github\.com\/[^/]+\/sobre-abierto$/,
    'el repositorio del package.json, sin git+ ni .git',
  );
  assert.equal(neutra.urlWeb, null);
  const propia = leerConfig({
    APP_URL: 'https://licitaciones.acme.example/',
    APP_SOURCE_URL: 'https://git.acme.example/sa',
    AVISOS_URL_WEB: 'https://antigua.example',
  });
  assert.equal(propia.urlWeb, 'https://licitaciones.acme.example', 'AVISOS_URL_WEB ya no se lee');
  assert.equal(propia.fuente, 'https://git.acme.example/sa');
  assert.equal(validarConfig({ APP_URL: 'ftp://x.example' }).error?.message, 'APP_URL');
});

test('should_start_neutral_and_save_name_and_colors_that_read_well', () => {
  const db = baseVacia();
  assert.deepEqual(leerMarca(db), { nombre: 'Sobre Abierto', tema: {}, logo: null, actualizado_en: null });
  const r = guardarMarca(db, { nombre: 'Acme · Licitaciones', tema: { ...TEMA_PROPIO, accion: '#b5ff82' } });
  assert.equal(r.error, null);
  assert.deepEqual(leerMarca(db).tema, TEMA_PROPIO, 'en mayúsculas');
  assert.equal(leerMarca(db).nombre, 'Acme · Licitaciones');
  db.close();
});

test('should_reject_unknown_tokens_short_colors_and_colors_without_contrast', () => {
  const db = baseVacia();
  assert.match(
    guardarMarca(db, { nombre: 'Acme', tema: { superficie2: '#F3F5F8' } }).error?.message ?? '',
    /superficie2/,
    'un token que no existe no se ignora',
  );
  assert.match(guardarMarca(db, { nombre: 'Acme', tema: { tinta: '#FFF' } }).error?.message ?? '', /#RRGGBB/);
  const claro = guardarMarca(db, { nombre: 'Acme', tema: { tinta: '#BBBBBB' } });
  assert.equal(claro.error?.code, 'invalid_input');
  assert.match(claro.error?.message ?? '', /«tinta» sobre «lienzo»: \d,\d\d:1 \(mínimo 4,5:1\)/);
  assert.equal(guardarMarca(db, { nombre: ' ', tema: {} }).error?.code, 'invalid_input');
  assert.deepEqual(leerMarca(db).tema, {}, 'nada inválido se guarda');
  db.close();
});

test('should_store_a_logo_only_when_it_is_really_an_image', () => {
  const db = baseVacia();
  assert.equal(guardarLogo(db, Buffer.from('hola, no soy un svg')).error?.code, 'invalid_input');
  assert.equal(guardarLogo(db, Buffer.alloc(200 * 1024 + 1)).error?.code, 'too_large');
  const png = guardarLogo(db, PNG);
  assert.equal(png.data?.logo?.tipo, 'image/png');
  assert.equal(guardarLogo(db, SVG).data?.logo?.tipo, 'image/svg+xml');
  assert.notEqual(leerMarca(db).logo?.hash, png.data?.logo?.hash, 'otro logo, otro hash');
  assert.equal(quitarLogo(db).logo, null);
  db.close();
});

test('should_put_the_name_and_own_colors_in_the_page_and_nothing_without_a_theme', () => {
  const neutra = paginaConMarca(PAGINA, { nombre: 'Sobre Abierto', tema: {} });
  const propia = paginaConMarca(PAGINA, { nombre: 'Acme <Licitaciones>', tema: { accion: '#B5FF82' } });
  assert.equal(neutra, PAGINA);
  assert.match(propia, /<title>Acme &lt;Licitaciones&gt;<\/title>/);
  assert.match(propia, /<style id="tema-instalacion">:root\{--so-accion:#B5FF82\}<\/style><\/head>/);
  assert.equal(cssDelTema({}), '');
});

test('should_serve_the_brand_without_session_and_the_logo_with_etag_nosniff_and_a_sandbox_for_svg', async () => {
  const db = nucleo().db;
  assert.equal((await fetch(`${base}/api/marca/logo`)).status, 404, 'sin logo');
  guardarMarca(db, { nombre: 'Acme', tema: TEMA_PROPIO });
  const hash = guardarLogo(db, SVG).data!.logo!.hash;

  const config = (await (await fetch(`${base}/api/config`)).json()) as Record<string, unknown>;
  const logo = await fetch(`${base}/api/marca/logo`);
  const otraVez = await fetch(`${base}/api/marca/logo`, { headers: { 'If-None-Match': `"${hash}"` } });

  assert.deepEqual(config, {
    nombre: 'Acme',
    logo: `/api/marca/logo?v=${hash}`,
    fuente: repositorioDelPaquete(),
    version: config.version,
    zona_horaria: 'Europe/Madrid',
  });
  assert.match(String(config.version), /^\d+\.\d+\.\d+/, 'la versión del package.json');
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get('content-type') ?? '', /^image\/svg\+xml/);
  assert.equal(logo.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(logo.headers.get('content-security-policy'), CSP_SVG);
  assert.equal(logo.headers.get('etag'), `"${hash}"`);
  assert.equal(otraVez.status, 304);
});

test('should_save_the_brand_and_the_logo_through_the_web', async () => {
  const mal = await fetch(`${base}/api/plataforma/marca`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Acme', tema: { tinta: '#EEEEEE' } }),
  });
  const bien = await fetch(`${base}/api/plataforma/marca`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Acme · Web', tema: TEMA_PROPIO }),
  });
  const formulario = new FormData();
  formulario.append('archivo', new Blob([PNG], { type: 'image/png' }), 'logo.png');
  const logo = await fetch(`${base}/api/plataforma/marca/logo`, { method: 'PUT', body: formulario });
  const leida = (await (await fetch(`${base}/api/plataforma/marca`)).json()) as {
    nombre: string;
    logo: { tipo: string };
  };

  assert.equal(mal.status, 400);
  assert.equal(bien.status, 200);
  assert.equal(logo.status, 200);
  assert.deepEqual([leida.nombre, leida.logo.tipo], ['Acme · Web', 'image/png']);
});

test('should_brand_the_emails_with_the_installation_name_and_colors', () => {
  const neutro = montarCorreo(PLANTILLA, null).html;
  const propio = montarCorreo(PLANTILLA, null, { nombre: 'Acme', tema: TEMA_PROPIO }).html;
  assert.match(neutro, />Sobre Abierto</);
  assert.match(propio, /background:#263B4A;[^"]*color:#B5FF82">Acme</);
  assert.doesNotMatch(neutro + propio, /datagr[o]wth/i, 'sin el nombre de la empresa que estaba en la plantilla');
});

test('should_return_null_when_the_package_has_no_https_repository', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'paquete-'));
  const archivo = path.join(dir, 'package.json');
  fs.writeFileSync(archivo, JSON.stringify({ repository: { url: 'git@github.com:x/y.git' } }));
  assert.equal(repositorioDelPaquete(archivo), null);
  assert.equal(repositorioDelPaquete(path.join(dir, 'no-existe.json')), null);
});

test('should_read_the_package_version_and_return_null_when_it_is_missing', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'version-'));
  const archivo = path.join(dir, 'package.json');
  fs.writeFileSync(archivo, JSON.stringify({ version: '1.2.3' }));
  assert.equal(versionDelPaquete(archivo), '1.2.3');
  fs.writeFileSync(archivo, JSON.stringify({ version: 'latest' }));
  assert.equal(versionDelPaquete(archivo), null);
  assert.equal(versionDelPaquete(path.join(dir, 'no-existe.json')), null);
});
