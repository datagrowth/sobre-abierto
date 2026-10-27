// Perfil de costes: va aparte del perfil de empresa, nunca falla al leerse (sin fila o con una
// fila rota da los valores por defecto) y no sale nunca a un agente por plataforma_empresa.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { NIF_EJEMPLO } from '../fixtures/empresaEjemplo.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perfil-costes-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
const T_CLAUDE = 'c'.repeat(40);
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { rutasPlataforma } = await import('../../src/nucleo/rutas.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { herramientasBiblioteca } = await import('../../src/nucleo/mcp/biblioteca.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { EUROS_HORA_POR_DEFECTO, PerfilCostes, guardarPerfilCostes, leerPerfilCostes, perfilCostesPorDefecto } =
  await import('../../src/nucleo/perfilCostes.js');

iniciarNucleo();
anadirHerramientas(herramientasBiblioteca);
let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/plataforma', rutasPlataforma());
  app.use(
    '/mcp',
    routerMcp(() => path.join(tmp, '.agentes')),
  );
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function baseVacia() {
  return abrirNucleo(fs.mkdtempSync(path.join(tmp, 'vacia-')));
}

const CAMPOS_COSTES = Object.keys(PerfilCostes.shape);

test('should_return_defaults_when_no_row', async () => {
  // Arrange
  const db = baseVacia();
  // Act
  const leido = leerPerfilCostes(db);
  const conEntorno = leerPerfilCostes(db, 32);
  const res = await fetch(`${base}/api/plataforma/empresa/costes`);
  const web = (await res.json()) as {
    perfil: Record<string, number>;
    por_defecto: boolean;
    actualizado_en: string | null;
  };
  // Assert
  assert.equal(leido.por_defecto, true);
  assert.equal(leido.actualizado_en, null);
  assert.equal(leido.perfil.euros_hora, EUROS_HORA_POR_DEFECTO);
  assert.deepEqual(
    [leido.perfil.tamano_subgrupo, leido.perfil.fraccion_aptas, leido.perfil.umbral_total_pct],
    [11, 0.75, 0.5],
  );
  assert.equal(conEntorno.perfil.euros_hora, 32, 'LICITACIONES_PRECIO_HORA manda mientras nadie guarde el perfil');
  assert.equal(res.status, 200);
  assert.equal(web.por_defecto, true);
  assert.deepEqual(web.perfil, perfilCostesPorDefecto(nucleo().config.licitaciones.precioHora));
  db.close();
});

test('should_return_defaults_and_flag_when_stored_profile_is_invalid', () => {
  // Arrange: una fila guardada con un campo que ya no existe y otra que ni es JSON.
  const db = baseVacia();
  const insertar = db.prepare('INSERT OR REPLACE INTO perfil_costes (id, datos, actualizado_en) VALUES (1, ?, ?)');
  insertar.run(JSON.stringify({ euros_hora: 30, campo_viejo: 1 }), '2026-10-01T00:00:00.000Z');
  // Act
  const conCampoViejo = leerPerfilCostes(db);
  insertar.run('{no es json', '2026-10-01T00:00:00.000Z');
  const roto = leerPerfilCostes(db);
  // Assert
  for (const r of [conCampoViejo, roto]) {
    assert.equal(r.por_defecto, true);
    assert.deepEqual(r.perfil, perfilCostesPorDefecto());
  }
  db.close();
});

test('should_reject_negative_or_absurd_hourly_cost', () => {
  // Arrange
  const db = baseVacia();
  // Act
  const negativo = guardarPerfilCostes(db, { euros_hora: -5 });
  const absurdo = guardarPerfilCostes(db, { euros_hora: 100_000 });
  const fraccion = guardarPerfilCostes(db, { fraccion_aptas: 1.5 });
  const desconocido = guardarPerfilCostes(db, { euros_hora: 30, margen: 0.2 });
  // Assert
  for (const r of [negativo, absurdo, fraccion, desconocido]) assert.equal(r.error?.code, 'invalid_input');
  assert.equal(leerPerfilCostes(db).por_defecto, true, 'nada inválido llega a guardarse');
  db.close();
});

test('should_round_trip_saved_profile', () => {
  // Arrange
  const db = baseVacia();
  // Act
  const g = guardarPerfilCostes(db, { euros_hora: 40, tamano_subgrupo: 12, umbral_total_pct: 1.2 });
  const leido = leerPerfilCostes(db, 32);
  const sinEurosHora = guardarPerfilCostes(db, { umbral_horas: 20 }, 32);
  // Assert
  assert.equal(g.error, null);
  assert.equal(leido.por_defecto, false);
  assert.deepEqual(leido.perfil, {
    ...perfilCostesPorDefecto(),
    euros_hora: 40,
    tamano_subgrupo: 12,
    umbral_total_pct: 1.2,
  });
  assert.equal(leido.actualizado_en, g.data?.actualizado_en);
  assert.equal(sinEurosHora.data?.perfil.euros_hora, 32, 'sin €/h, el del entorno');
  const evento = db.prepare("SELECT datos FROM eventos WHERE tipo = 'plataforma.empresa_costes'").all() as {
    datos: string;
  }[];
  assert.equal(evento.length, 2);
  assert.ok(
    evento.every((e) => e.datos === '{}'),
    'el evento no lleva contenido',
  );
  db.close();
});

test('should_answer_400_on_invalid_put', async () => {
  // Arrange
  const url = `${base}/api/plataforma/empresa/costes`;
  const put = (body: unknown) =>
    fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  // Act
  const malos = await Promise.all([put({ euros_hora: -1 }), put([1, 2]), put({ tamano_subgrupo: 2.5 })]);
  const tras = (await (await fetch(url)).json()) as { por_defecto: boolean };
  const bueno = await put({ euros_hora: 28 });
  // Assert
  for (const r of malos) {
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: string }).error, 'invalid_input');
  }
  assert.equal(tras.por_defecto, true, 'un PUT inválido no toca la base');
  assert.equal(bueno.status, 200);
  assert.equal(((await bueno.json()) as { perfil: { euros_hora: number } }).perfil.euros_hora, 28);
});

test('should_not_expose_costs_in_plataforma_empresa_output', async () => {
  // Arrange: perfil de empresa y de costes guardados.
  const db = nucleo().db;
  assert.equal(guardarPerfilEmpresa(db, { nif: NIF_EJEMPLO, nombre: 'EMPRESA DE PRUEBA, S.L.' }).error, null);
  assert.equal(guardarPerfilCostes(db, { euros_hora: 41.5, euros_envio_por_persona: 9 }).error, null);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${T_CLAUDE}` } },
    }),
  );
  try {
    // Act
    const r = await client.callTool({ name: 'plataforma_empresa', arguments: {} });
    const texto = (r.content as { type: string; text: string }[])[0]?.text ?? '';
    // Assert
    assert.equal(r.isError, undefined);
    assert.match(texto, /EMPRESA DE PRUEBA/);
    for (const campo of CAMPOS_COSTES) assert.ok(!texto.includes(campo), `plataforma_empresa no lleva ${campo}`);
    assert.ok(!texto.includes('41.5') && !texto.includes('41,5'));
  } finally {
    await client.close();
  }
});
