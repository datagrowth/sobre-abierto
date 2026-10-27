// Antecedentes de punta a punta: la tool licitaciones_antecedentes por MCP (cliente
// oficial), el nivel de indicios en licitaciones_ver y en las candidatas de la criba, la
// ruta web del bloque «Antecedentes» y las señales del pliego de la ficha, que cuentan
// solo cuando una persona aprueba la ficha.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion, type Sintetica } from '../helpers/sinteticas.js';
import { TEMAS_CHECKLIST } from '../../src/dominios/licitaciones/temas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antecedentes-mcp-'));
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(agentes);
const T_LICI = 'l'.repeat(40);
const T_CLAUDE = 'c'.repeat(40);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), T_LICI);
process.env.AGENTE_TOKEN_CLAUDE_CODE = T_CLAUDE;
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { routerMcp, anadirHerramientas } = await import('../../src/nucleo/mcp/servidor.js');
const { herramientasLicitaciones } = await import('../../src/dominios/licitaciones/tools.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { crearLotes } = await import('../../src/dominios/licitaciones/criba.js');
const { instruccionesFicha } = await import('../../src/dominios/licitaciones/ficha.js');

iniciarNucleo();
anadirHerramientas(herramientasLicitaciones);

const GANADOR = { nif: 'B85000001', nombre: 'Tributos Digitales SL' };

function guardar(s: Sintetica): string {
  const l = licitacion(s);
  guardarLicitacion(dbLicitaciones(), l, 'historico');
  return l.id;
}

guardar({
  titulo: 'Mantenimiento de la aplicación de gestión tributaria 2021-2022',
  publicada: '2021-02-10',
  ganadores: [{ ...GANADOR, importe: 119_000, ofertas: 1 }],
});
guardar({
  titulo: 'Mantenimiento de la aplicación de gestión tributaria 2023-2024',
  publicada: '2023-02-10',
  ganadores: [{ ...GANADOR, importe: 119_500, ofertas: 1 }],
});
// 8 días en un abierto: por debajo del mínimo legal (15), que con el incumbente y las ofertas únicas da «alto».
const ACTUAL = guardar({
  titulo: 'Mantenimiento de la aplicación de gestión tributaria 2025-2026',
  publicada: '2025-06-02',
  limite: '2025-06-10T14:00:00',
});
const NUEVA = guardar({
  titulo: 'Estudio de movilidad urbana sostenible',
  publicada: '2025-06-02',
  limite: '2025-07-30T14:00:00',
});

let server: http.Server;
let base = '';

before(() => {
  const app = express();
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
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function conectar(token: string) {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const texto = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? '';

test('should_give_any_reading_agent_the_timeline_and_signals_by_mcp', async () => {
  const claude = await conectar(T_CLAUDE);
  try {
    assert.ok(
      (await claude.listTools()).tools.some((t) => t.name === 'licitaciones_antecedentes'),
      'leer: también Claude Code',
    );
    const r = JSON.parse(
      texto(await claude.callTool({ name: 'licitaciones_antecedentes', arguments: { id: ACTUAL } })),
    ) as {
      nivel: string;
      ediciones: { anio: string; adjudicatario_nombre: string }[];
      indicios: { indicios: { codigo: string }[] };
    };
    assert.deepEqual(
      r.ediciones.map((h) => [h.anio, h.adjudicatario_nombre]),
      [
        ['2023', 'Tributos Digitales SL'],
        ['2021', 'Tributos Digitales SL'],
      ],
    );
    assert.ok(r.indicios.indicios.some((i) => i.codigo === 'incumbente'));
    assert.equal(r.nivel, 'alto');
    const mal = await claude.callTool({ name: 'licitaciones_antecedentes', arguments: { id: ACTUAL, lote: '3' } });
    assert.equal(mal.isError, true);
    assert.match(texto(mal), /no tiene lotes/);
  } finally {
    await claude.close();
  }
});

test('should_include_the_signal_level_in_the_tender_view_and_in_the_screening_candidates', async () => {
  const db = dbLicitaciones();
  const ts = new Date().toISOString();
  for (const id of [ACTUAL, NUEVA]) {
    db.prepare(
      "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'candidata', 'CPV 72…', ?, ?)",
    ).run(id, ts, ts);
  }
  const lote = crearLotes(db, 40)[0] ?? 0;
  const lici = await conectar(T_LICI);
  try {
    const ver = JSON.parse(texto(await lici.callTool({ name: 'licitaciones_ver', arguments: { id: ACTUAL } }))) as {
      antecedentes: { nivel: string; ediciones: number };
    };
    assert.deepEqual([ver.antecedentes.nivel, ver.antecedentes.ediciones], ['alto', 2]);
    const c = JSON.parse(texto(await lici.callTool({ name: 'licitaciones_candidatas', arguments: { lote } }))) as {
      candidatas: { id: string; antecedentes: { nivel: string; adjudicatario_anterior: string | null } }[];
    };
    const porId = Object.fromEntries(c.candidatas.map((x) => [x.id, x.antecedentes]));
    assert.equal(porId[ACTUAL]?.nivel, 'alto');
    assert.match(porId[ACTUAL]?.adjudicatario_anterior ?? '', /Tributos Digitales SL/);
    assert.deepEqual([porId[NUEVA]?.nivel, porId[NUEVA]?.adjudicatario_anterior], ['bajo', null]);
  } finally {
    await lici.close();
  }
});

test('should_serve_the_antecedentes_block_to_the_web_and_validate_its_query', async () => {
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ACTUAL}/antecedentes`);
  assert.equal(r.status, 200);
  const d = (await r.json()) as { ediciones: unknown[]; como_se_buscan: string; reglas: string };
  assert.equal(d.ediciones.length, 2);
  assert.match(d.como_se_buscan, /seis meses/);
  assert.match(d.reglas, /Nivel: alto desde 5 puntos/);
  assert.equal((await fetch(`${base}/api/licitaciones/licitaciones/${ACTUAL}/antecedentes?limite=500`)).status, 400);
  assert.equal((await fetch(`${base}/api/licitaciones/licitaciones/${ACTUAL}/antecedentes?lote=7`)).status, 400);
  assert.equal((await fetch(`${base}/api/licitaciones/licitaciones/p-0/antecedentes`)).status, 404);
  assert.equal((await fetch(`${base}/api/licitaciones/licitaciones/x/antecedentes`)).status, 400);
});

function ficha(senales: unknown[]) {
  return {
    id: NUEVA,
    resumen: 'Estudio de movilidad urbana sostenible del municipio durante seis meses.',
    requisitos: [],
    criterios: [{ descripcion: 'Conocimiento del modelo de tráfico actual', peso: 40, tipo: 'juicio_valor' }],
    documentacion: [],
    hitos: [],
    garantias: [],
    penalizaciones: [],
    riesgos: [],
    recomendacion: { decision: 'revisar', motivo: 'Criterio que premia conocer el modelo actual.' },
    senales_pliego: senales,
    cobertura: TEMAS_CHECKLIST.map((tema) => ({ tema, estado: 'no_lo_pide', documento: 'PCAP.pdf', pagina: 4 })),
  };
}

const SENAL = {
  tipo: 'juicio_valor_favorece',
  descripcion: 'Puntúa conocer el modelo de tráfico que ya usa el ayuntamiento',
  cita: 'se valorará el conocimiento del modelo actual',
  documento: 'PCAP.pdf',
  pagina: 21,
};

test('should_add_pliego_signals_to_the_signals_as_soon_as_the_ficha_arrives', async () => {
  const lici = await conectar(T_LICI);
  try {
    assert.equal(
      (await lici.callTool({ name: 'licitaciones_ficha', arguments: ficha([{ ...SENAL, tipo: 'sospecha' }]) })).isError,
      true,
      'tipo fuera de la lista',
    );
    assert.equal(
      (await lici.callTool({ name: 'licitaciones_ficha', arguments: ficha([{ ...SENAL, inventado: 1 }]) })).isError,
      true,
      'esquema estricto',
    );
    const sinLotes = await lici.callTool({ name: 'licitaciones_ficha', arguments: ficha([{ ...SENAL, lote: '1' }]) });
    assert.equal(sinLotes.isError, true, 'una señal de un lote que no existe no contaría en ninguno');
    assert.match(texto(sinLotes), /no tiene lotes: quita «lote»/);
    assert.equal((await lici.callTool({ name: 'licitaciones_ficha', arguments: ficha([SENAL]) })).isError, undefined);
  } finally {
    await lici.close();
  }
  const despues = (await (await fetch(`${base}/api/licitaciones/licitaciones/${NUEVA}/antecedentes`)).json()) as {
    indicios: { indicios: { codigo: string; dato: string }[] };
  };
  const senal = despues.indicios.indicios.find((i) => i.codigo === 'pliego_juicio_valor_favorece');
  assert.match(senal?.dato ?? '', /«se valorará el conocimiento del modelo actual» \(PCAP\.pdf, pág\. 21\)/);
});

test('should_ask_hermes_for_pliego_signals_as_signals_and_not_as_accusations', () => {
  const instrucciones = instruccionesFicha(NUEVA, 'Analítica Ejemplo');
  assert.match(instrucciones, /senales_pliego/);
  assert.match(instrucciones, /indicios, no acusaciones/);
  assert.match(instrucciones, /licitaciones_antecedentes/);
});
