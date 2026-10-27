// Métricas de un trabajo de IA: de la respuesta del run, de la sesión del perfil en su
// state.db (una base como la de Hermes, hecha aquí) y de la auditoría de herramientas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { registrarUso } from '../../src/nucleo/agentes/auditoria.js';
import { deAuditoria, deRun, deSesion, recogerMetricas } from '../../src/nucleo/hermes/metricas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'metricas-'));
const db = abrirNucleo(tmp);
after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const LANZADO = Date.parse('2026-10-05T10:00:00Z');

function stateDb(
  sesiones: {
    started_at: number | string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    api_call_count: number;
    tool_call_count: number;
  }[],
): string {
  const ruta = path.join(tmp, `state-${Math.random().toString(36).slice(2)}.db`);
  const s = new Database(ruta);
  s.exec(
    'CREATE TABLE sessions (id TEXT, started_at REAL, model TEXT, billing_provider TEXT, input_tokens INTEGER, output_tokens INTEGER, api_call_count INTEGER, tool_call_count INTEGER)',
  );
  for (const x of sesiones)
    s.prepare("INSERT INTO sessions VALUES ('s', ?, ?, 'openai-codex', ?, ?, ?, ?)").run(
      x.started_at,
      x.model,
      x.input_tokens,
      x.output_tokens,
      x.api_call_count,
      x.tool_call_count,
    );
  s.close();
  return ruta;
}

test('should_read_the_model_and_tokens_from_the_run_when_hermes_gives_them', () => {
  assert.deepEqual(
    deRun({ status: 'completed', model: 'gpt-6-luna', usage: { prompt_tokens: 1000, completion_tokens: 200 } }),
    { modelo: 'gpt-6-luna', tokens_entrada: 1000, tokens_salida: 200 },
  );
  assert.deepEqual(deRun({ status: 'completed', usage: 'raro' }), {}, 'lo que no encaja se ignora');
});

test('should_take_the_profile_session_that_started_with_the_run', () => {
  const ruta = stateDb([
    {
      started_at: (LANZADO - 3_600_000) / 1000,
      model: 'otro-modelo',
      input_tokens: 1,
      output_tokens: 1,
      api_call_count: 1,
      tool_call_count: 1,
    },
    {
      started_at: (LANZADO + 5_000) / 1000,
      model: 'gpt-6-luna',
      input_tokens: 150_000,
      output_tokens: 9_000,
      api_call_count: 12,
      tool_call_count: 7,
    },
  ]);
  assert.deepEqual(deSesion(ruta, LANZADO, LANZADO + 600_000), {
    modelo: 'gpt-6-luna',
    proveedor: 'openai-codex',
    tokens_entrada: 150_000,
    tokens_salida: 9_000,
    llamadas_api: 12,
    llamadas_herramientas: 7,
  });
  assert.deepEqual(deSesion(path.join(tmp, 'no-existe.db'), LANZADO, LANZADO + 1), {});
  assert.deepEqual(deSesion(null, LANZADO, LANZADO + 1), {});
});

test('should_use_the_session_model_when_the_run_reports_the_hermes_agent_alias', () => {
  assert.equal(
    deRun({ status: 'completed', model: 'hermes-agent', usage: { model: 'Hermes-Agent' } }).modelo,
    undefined,
    'el alias no es un modelo',
  );
  const lanzado = new Date(Date.now() - 120_000).toISOString();
  const ruta = stateDb([
    {
      started_at: new Date(Date.now() - 110_000).toISOString(),
      model: 'gpt-6-luna',
      input_tokens: 10,
      output_tokens: 5,
      api_call_count: 3,
      tool_call_count: 2,
    },
  ]);
  const conAlias = recogerMetricas(
    db,
    { lanzado_en: lanzado, payload: '{}' },
    { status: 'completed', model: 'hermes-agent', usage: { prompt_tokens: 40 } },
    { agente: 'licitaciones', stateDb: () => ruta },
  );
  assert.equal(conAlias.modelo, 'gpt-6-luna');
  assert.equal(conAlias.tokens_entrada, 40, 'lo demás del run se sigue tomando');
  const sinModelo = recogerMetricas(
    db,
    { lanzado_en: lanzado, payload: '{}' },
    { status: 'completed' },
    { agente: 'licitaciones', stateDb: () => ruta },
  );
  assert.equal(sinModelo.modelo, 'gpt-6-luna');
});

test('should_count_tool_calls_truncations_and_rejections_of_the_run', () => {
  const uso = (herramienta: string, recurso: string, resultado: 'ok' | 'error' | 'recortada') =>
    registrarUso(db, { agente: 'licitaciones', herramienta, dominio: 'licitaciones', recurso, resultado });
  uso('licitaciones_ver', 'p-1', 'ok');
  uso('biblioteca_leer', 'Licitaciones/Radar/2026/X (p-1)/PCAP.pdf', 'recortada');
  uso('licitaciones_ficha', 'p-1', 'error');
  uso('licitaciones_ver', 'p-2', 'ok');
  const desde = new Date(Date.now() - 60_000).toISOString();
  const hasta = new Date(Date.now() + 60_000).toISOString();
  assert.deepEqual(deAuditoria(db, 'licitaciones', desde, hasta, 'p-1'), {
    llamadas_herramientas: 3,
    respuestas_recortadas: 1,
    rechazos: 1,
  });
  assert.equal(deAuditoria(db, 'licitaciones', desde, hasta, null).llamadas_herramientas, 4);
});

test('should_combine_the_sources_and_measure_the_duration', () => {
  const lanzado = new Date(Date.now() - 840_000).toISOString();
  const ruta = stateDb([
    {
      started_at: new Date(Date.now() - 830_000).toISOString(),
      model: 'gpt-6-sol',
      input_tokens: 10,
      output_tokens: 5,
      api_call_count: 3,
      tool_call_count: 2,
    },
  ]);
  const m = recogerMetricas(
    db,
    { lanzado_en: lanzado, payload: JSON.stringify({ id: 'p-1' }) },
    { status: 'completed' },
    { agente: 'licitaciones', stateDb: () => ruta },
  );
  assert.equal(m.modelo, 'gpt-6-sol');
  assert.equal(m.llamadas_herramientas, 2, 'la sesión manda sobre la auditoría');
  assert.equal(m.respuestas_recortadas, 1);
  assert.equal(m.duracion_s, 840);
  assert.deepEqual(m.fuentes, ['sesion', 'auditoria']);
  const sinNada = recogerMetricas(db, { lanzado_en: null, payload: '{}' }, {}, undefined);
  assert.deepEqual([sinNada.modelo, sinNada.duracion_s, sinNada.fuentes], [null, null, []]);
});
