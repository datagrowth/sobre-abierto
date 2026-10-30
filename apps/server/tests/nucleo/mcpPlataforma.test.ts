// Estado, actividad y trabajos de la plataforma por MCP sin respuestas cortadas: el estado y
// la actividad por partes (y en JSON compacto con más margen), y los trabajos de la cola con
// filtros y por páginas (en producción, 777 fallidos que no se podían repasar).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-plataforma-'));
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(path.join(tmp, 'conocimiento'), { recursive: true });
fs.mkdirSync(agentes);
const T_CLAUDE = 'c'.repeat(40);
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { herramientasBiblioteca } = await import('../../src/nucleo/mcp/biblioteca.js');
const { registrarEstado } = await import('../../src/nucleo/estado.js');
const { estadoCola } = await import('../../src/nucleo/colaConsultas.js');
const { emitir } = await import('../../src/nucleo/eventos.js');

iniciarNucleo();
anadirHerramientas(herramientasBiblioteca);
registrarEstado('trabajos', () => estadoCola(nucleo().db));
// Una pieza grande, como el estado de licitaciones con muchas carpetas omitidas.
registrarEstado('licitaciones', () => ({
  omitidas: Array.from({ length: 600 }, (_, i) => `Licitaciones/Radar/2026/carpeta-${i}`),
}));

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

async function llamar(nombre: string, args: Record<string, unknown>): Promise<{ texto: string; error: boolean }> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${T_CLAUDE}` } },
    }),
  );
  try {
    const r = await client.callTool({ name: nombre, arguments: args });
    return { texto: (r.content as { text: string }[])[0]?.text ?? '', error: r.isError === true };
  } finally {
    await client.close();
  }
}

function sembrarTrabajos(): void {
  const insertar = nucleo().db
    .prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, codigo, error, creado_en, actualizado_en)
    VALUES (?, 'licitaciones', ?, ?, ?, ?, ?, ?, ?)`);
  const hoy = new Date().toISOString();
  for (let i = 0; i < 30; i += 1) {
    insertar.run(
      'licitaciones.cribar',
      `cribar-lote-${i}`,
      JSON.stringify({ lote: i }),
      'fallido',
      'sin_resultado',
      `El run terminó sin dejar el resultado esperado. ${'x'.repeat(900)}`,
      hoy,
      hoy,
    );
  }
  insertar.run(
    'licitaciones.ficha',
    'ficha-p-1',
    JSON.stringify({ id: 'p-91000080' }),
    'fallido',
    'run_inactivo',
    'Hermes lleva 10 min sin usar ninguna herramienta.',
    hoy,
    hoy,
  );
  insertar.run(
    'licitaciones.ficha',
    'ficha-p-2',
    JSON.stringify({ id: 'p-91000080' }),
    'completado',
    null,
    null,
    hoy,
    hoy,
  );
}

test('should_list_queue_jobs_with_filters_and_pages_without_cutting_the_answer', async () => {
  sembrarTrabajos();
  const primera = await llamar('plataforma_trabajos', {
    tipo: 'licitaciones.cribar',
    estado: 'fallido',
    codigo: 'sin_resultado',
    limite: 20,
  });
  assert.equal(primera.error, false);
  const p = JSON.parse(primera.texto) as { total: number; siguiente: number | null; trabajos: { error: string }[] };
  assert.deepEqual([p.total, p.trabajos.length, p.siguiente], [30, 20, 20], 'JSON entero, no recortado');
  assert.ok(p.trabajos.every((t) => t.error.length <= 1500));
  const ultima = JSON.parse(
    (await llamar('plataforma_trabajos', { tipo: 'licitaciones.cribar', desde: 20, limite: 20 })).texto,
  ) as { trabajos: unknown[]; siguiente: number | null };
  assert.deepEqual([ultima.trabajos.length, ultima.siguiente], [10, null]);
  const deLicitacion = JSON.parse(
    (await llamar('plataforma_trabajos', { licitacion: 'p-91000080', estado: 'fallido' })).texto,
  ) as { total: number; trabajos: { codigo: string }[] };
  assert.deepEqual([deLicitacion.total, deLicitacion.trabajos[0]?.codigo], [1, 'run_inactivo']);
  assert.equal((await llamar('plataforma_trabajos', { estado: 'roto' })).error, true, 'la entrada se valida');
});

test('should_describe_the_job_error_limit_the_listing_applies', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${T_CLAUDE}` } },
    }),
  );
  try {
    const herramientas = (await client.listTools()).tools;
    const trabajos = herramientas.find((t) => t.name === 'plataforma_trabajos')?.description ?? '';
    const estado = herramientas.find((t) => t.name === 'plataforma_estado')?.description ?? '';

    assert.match(trabajos, /hasta 1\.500 caracteres, recortado por el final/);
    assert.doesNotMatch(trabajos, /400 caracteres/);
    assert.match(estado, /por_estado_7_dias/);
  } finally {
    await client.close();
  }
});

test('should_return_one_status_section_or_the_whole_status_without_cutting_it', async () => {
  const trabajos = await llamar('plataforma_estado', { seccion: 'trabajos' });
  const t = JSON.parse(trabajos.texto) as Record<
    string,
    { ultimos_7_dias: { por_tipo: { tipo: string; fallos_por_codigo: Record<string, number> }[] } }
  >;
  assert.deepEqual(Object.keys(t), ['trabajos']);
  const masFalla = t['trabajos']!.ultimos_7_dias.por_tipo[0]!;
  assert.equal(masFalla.tipo, 'licitaciones.cribar');
  assert.deepEqual(masFalla.fallos_por_codigo, { sin_resultado: 30 });
  const todo = await llamar('plataforma_estado', {});
  assert.ok(todo.texto.length > 20_000, 'pasa del tope de antes');
  assert.deepEqual(Object.keys(JSON.parse(todo.texto) as object).sort(), [
    'herramientas_del_que_llama',
    'licitaciones',
    'trabajos',
  ]);
  const mala = await llamar('plataforma_estado', { seccion: 'inexistente' });
  assert.equal(mala.error, true);
  assert.match(mala.texto, /trabajos, licitaciones|licitaciones, trabajos/);
});

test('should_return_one_activity_section_when_asked', async () => {
  emitir(nucleo().db, { tipo: 'licitaciones.lotes', dominio: 'licitaciones', recurso: null, datos: { lotes: [1] } });
  const r = await llamar('plataforma_actividad', { seccion: 'eventos', limite: 5 });
  const a = JSON.parse(r.texto) as Record<string, { tipo: string }[]>;
  assert.deepEqual(Object.keys(a), ['eventos']);
  assert.equal(a['eventos']?.[0]?.tipo, 'licitaciones.lotes');
});

test('should_list_position_eta_and_wait_reason_in_plataforma_trabajos', async () => {
  const insertar = nucleo().db
    .prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en, lanzado_en)
    VALUES ('licitaciones.eta_prueba', 'licitaciones', ?, '{"id":"p-eta"}', ?, ?, ?, ?)`);
  const ms = Date.now();
  const iso = (m: number) => new Date(ms - m * 60_000).toISOString();
  for (let i = 0; i < 5; i += 1)
    insertar.run(`eta-hecho-${i}`, 'completado', iso(200), iso(100), iso(100 + 10 * (i + 1)));
  insertar.run('eta-en-marcha', 'lanzado', iso(20), iso(5), iso(5));
  insertar.run('eta-en-cola', 'pendiente', iso(3), iso(3), null);

  const r = JSON.parse(
    (await llamar('plataforma_trabajos', { licitacion: 'p-eta', tipo: 'licitaciones.eta_prueba' })).texto,
  ) as {
    trabajos: {
      estado: string;
      posicion?: number | null;
      eta?: { desde: string; hasta: string } | null;
      motivo_espera?: string | null;
    }[];
  };

  const enMarcha = r.trabajos.find((t) => t.estado === 'lanzado');
  const enCola = r.trabajos.find((t) => t.estado === 'pendiente');
  const hecho = r.trabajos.find((t) => t.estado === 'completado');
  assert.deepEqual([enMarcha?.posicion, enMarcha?.motivo_espera], [0, null]);
  assert.ok(enMarcha?.eta && enMarcha.eta.desde < enMarcha.eta.hasta, 'intervalo del percentil 5 al 95');
  // Sin perfil de Hermes registrado para el tipo: no saldrá solo.
  assert.deepEqual([enCola?.posicion, enCola?.motivo_espera], [1, 'sin_perfil']);
  assert.ok(enCola?.eta);
  assert.equal(hecho?.posicion, undefined, 'lo terminado no tiene sitio en la cola');
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(base), {
      requestInit: { headers: { Authorization: `Bearer ${T_CLAUDE}` } },
    }),
  );
  try {
    const descripcion =
      (await client.listTools()).tools.find((t) => t.name === 'plataforma_trabajos')?.description ?? '';
    assert.match(
      descripcion,
      /motivo de la espera: pausa_limite, freno, espera_herramienta, reintento, tope_oferta, plazo_cercano, sin_perfil o cola/,
    );
  } finally {
    await client.close();
  }
});
