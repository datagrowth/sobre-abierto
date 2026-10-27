// plataforma_estado › agentes: qué herramientas tiene quien llama y cuáles le faltan.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-permisos-'));
const conocimiento = path.join(tmp, 'conocimiento');
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(path.join(conocimiento, 'Empresa'), { recursive: true });
fs.mkdirSync(agentes);
fs.writeFileSync(
  path.join(conocimiento, 'Empresa', 'perfil-licitaciones.md'),
  '# Perfil\nConsultora de datos e inteligencia artificial.\n',
);
const T_LICI = 'l'.repeat(40);
const T_CLAUDE = 'c'.repeat(40);
const T_HERMES = 'h'.repeat(40);
fs.writeFileSync(path.join(agentes, 'hermes.token'), T_HERMES);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
// Un agente sin colaboradores y otro sin licitaciones ni colaboradores (ajustes de permisos).
const T_SIN_COLAB = 'm'.repeat(40);
const T_AISLADO = 's'.repeat(40);
fs.writeFileSync(path.join(agentes, 'mirador.token'), T_SIN_COLAB);
fs.writeFileSync(path.join(agentes, 'aislado.token'), T_AISLADO);
fs.writeFileSync(
  path.join(agentes, 'permisos.json'),
  JSON.stringify({
    mirador: { colaboradores: 'ninguno' },
    aislado: { licitaciones: 'ninguno', colaboradores: 'ninguno' },
  }),
);
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.VAULT_PATH = conocimiento;
// Carpeta de una oferta en Salidas, con su paquete en PRESENTACION/vN/Lote N/<n> Sobre X/.
const salidas = path.join(tmp, 'salidas');
const OFERTA = 'Licitaciones/CP-0417-2027 (p-91000880)';
fs.mkdirSync(path.join(salidas, OFERTA, 'PRESENTACION', 'v1', 'Lote 1', '1 Sobre A'), { recursive: true });
fs.writeFileSync(
  path.join(salidas, OFERTA, 'PRESENTACION', 'v1', 'Lote 1', '1 Sobre A', 'declaracion.md'),
  '# Declaración',
);
fs.writeFileSync(path.join(salidas, OFERTA, 'memoria.md'), '# Memoria');
process.env.SALIDAS_DIR = salidas;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { herramientasBiblioteca } = await import('../../src/nucleo/mcp/biblioteca.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { permisosDe, puede } = await import('../../src/nucleo/agentes/permisos.js');
const { registrarEstado } = await import('../../src/nucleo/estado.js');
const { catalogoHerramientas } = await import('../../src/nucleo/mcp/servidor.js');

iniciarNucleo();
// En producción lo registra nucleo/index.ts; aquí basta la sección para poder pedirla.
registrarEstado('agentes', () => ({}));
anadirHerramientas(herramientasBiblioteca);
anadirHerramientas(herramientasLicitaciones);

let server: http.Server;
let base = '';

before(async () => {
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
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function conectar(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

function texto(r: { content: unknown }): string {
  return (r.content as { type: string; text: string }[])[0]?.text ?? '';
}

type Estado = {
  herramientas_del_que_llama: { agente: string; tiene: string[]; le_faltan: { nombre: string; permiso: string }[] };
};

async function estadoAgentes(token: string, seccion?: string): Promise<Estado> {
  const client = await conectar(token);
  const r = await client.callTool({ name: 'plataforma_estado', arguments: seccion ? { seccion } : {} });
  await client.close();
  return JSON.parse(texto(r)) as Estado;
}

test('should_list_missing_tools_with_required_permission_for_restricted_agent', async () => {
  const e = await estadoAgentes(T_CLAUDE, 'agentes');
  const h = e.herramientas_del_que_llama;
  assert.equal(h.agente, 'claude-code');
  assert.deepEqual(
    h.le_faltan.find((x) => x.nombre === 'licitaciones_cribar'),
    { nombre: 'licitaciones_cribar', permiso: 'licitaciones:proponer' },
  );
  assert.ok(h.tiene.includes('licitaciones_ver'));
  assert.ok(!h.tiene.includes('licitaciones_cribar'));
});

test('should_report_biblioteca_leer_as_missing_for_critic_agent', () => {
  const permisos = permisosDe('critico-licitaciones');
  const faltan = catalogoHerramientas().filter((h) => !puede(permisos, h.dominio, h.accion));
  assert.ok(faltan.some((h) => h.nombre === 'biblioteca_leer' && `${h.dominio}:${h.accion}` === 'biblioteca:leer'));
});

test('should_list_no_missing_tools_for_full_agent_except_other_domains', async () => {
  const e = await estadoAgentes(T_HERMES);
  const h = e.herramientas_del_que_llama;
  const ajenos = h.le_faltan.filter((x) => !x.permiso.startsWith('colaboradores:'));
  assert.deepEqual(ajenos, []);
});

test('should_build_catalog_including_conditionally_registered_tools', () => {
  const nombres = catalogoHerramientas().map((h) => h.nombre);
  assert.ok(nombres.includes('licitaciones_equipo'));
  assert.deepEqual(
    nombres,
    [...nombres].sort((a, b) => a.localeCompare(b)),
  );
});

test('should_not_claim_equipo_tool_for_agent_without_colaboradores', async () => {
  // Act
  const h = (await estadoAgentes(T_SIN_COLAB, 'agentes')).herramientas_del_que_llama;
  const client = await conectar(T_SIN_COLAB);
  const registradas = (await client.listTools()).tools.map((t) => t.name);
  await client.close();
  // Assert: lo que dice que tiene es lo que de verdad tiene.
  assert.ok(h.tiene.includes('licitaciones_ver'));
  assert.ok(!h.tiene.includes('licitaciones_equipo'));
  assert.ok(!registradas.includes('licitaciones_equipo'));
  assert.deepEqual(
    h.le_faltan.find((x) => x.nombre === 'licitaciones_equipo'),
    { nombre: 'licitaciones_equipo', permiso: 'colaboradores:leer' },
  );
  assert.deepEqual([...h.tiene].sort(), [...registradas].sort());
});

test('should_list_every_missing_permission_for_equipo_tool', async () => {
  // Act: el aislado no tiene licitaciones ni colaboradores.
  const h = (await estadoAgentes(T_AISLADO, 'agentes')).herramientas_del_que_llama;
  // Assert
  assert.deepEqual(
    h.le_faltan.find((x) => x.nombre === 'licitaciones_equipo'),
    { nombre: 'licitaciones_equipo', permiso: 'licitaciones:leer y colaboradores:leer' },
  );
});
