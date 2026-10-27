// Identidad y permisos de los agentes: un token por agente (archivo, entorno o el
// token antiguo de la Biblioteca), permisos por dominio, límite de peticiones y
// auditoría sin contenidos.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentes-'));
const dir = path.join(tmp, '.agentes');
fs.mkdirSync(dir);
process.env.NODE_ENV = 'test';

const { agentePorToken, agentesConocidos, olvidarAgentes } = await import('../../src/nucleo/agentes/registro.js');
const { leerAjustesPermisos, permisosDe, puede } = await import('../../src/nucleo/agentes/permisos.js');
const { crearLimitador } = await import('../../src/nucleo/agentes/limite.js');
const { registrarUso, usosRecientes } = await import('../../src/nucleo/agentes/auditoria.js');
const { abrirNucleo } = await import('../../src/nucleo/db.js');

const T_HERMES = 'h'.repeat(40);
const T_LICI = 'l'.repeat(40);
const T_CLAUDE = 'c'.repeat(40);
const T_ANTIGUO = 'a'.repeat(40);
const env = { AGENTE_TOKEN_CLAUDE_CODE: T_CLAUDE, BIBLIOTECA_TOKEN: T_ANTIGUO, HOME: tmp } as NodeJS.ProcessEnv;

after(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => olvidarAgentes());

test('should_close_the_agent_api_when_no_token_exists', () => {
  assert.deepEqual(agentesConocidos(dir, { HOME: tmp }), []);
});

test('should_identify_agents_by_their_own_token_from_files_and_environment', () => {
  fs.writeFileSync(path.join(dir, 'hermes.token'), `${T_HERMES}\n`);
  fs.writeFileSync(path.join(dir, 'licitaciones.token'), T_LICI);
  fs.writeFileSync(path.join(dir, 'corto.token'), 'demasiado-corto');
  fs.writeFileSync(path.join(dir, 'Mal Nombre.token'), 'x'.repeat(40));
  assert.deepEqual(
    agentesConocidos(dir, env)
      .map((a) => a.nombre)
      .sort(),
    ['claude-code', 'hermes', 'licitaciones'],
  );
  assert.equal(agentePorToken(dir, T_LICI, env)?.nombre, 'licitaciones');
  assert.equal(agentePorToken(dir, T_CLAUDE, env)?.nombre, 'claude-code');
  assert.equal(agentePorToken(dir, 'otro'.repeat(10), env), null);
});

test('should_keep_the_old_library_token_working_as_hermes_only_without_a_hermes_file', () => {
  assert.equal(agentePorToken(dir, T_ANTIGUO, env), null, 'con hermes.token manda el archivo');
  fs.rmSync(path.join(dir, 'hermes.token'));
  olvidarAgentes();
  assert.equal(agentePorToken(dir, T_ANTIGUO, env)?.nombre, 'hermes');
});

test('should_let_every_agent_read_and_only_licitaciones_agents_triage', () => {
  const claude = permisosDe('claude-code');
  assert.equal(puede(claude, 'licitaciones', 'leer'), true);
  assert.equal(puede(claude, 'licitaciones', 'proponer'), false);
  assert.equal(puede(claude, 'biblioteca', 'proponer'), true);
  assert.equal(puede(permisosDe('licitaciones'), 'licitaciones', 'proponer'), true);
  assert.equal(puede(permisosDe('hermes'), 'licitaciones', 'proponer'), true);
});

test('should_show_each_domain_agent_only_its_own_domain_the_library_and_the_company', () => {
  const lici = permisosDe('licitaciones');
  const critico = permisosDe('critico-licitaciones');
  assert.equal(puede(lici, 'licitaciones', 'proponer'), true);
  assert.equal(puede(lici, 'colaboradores', 'proponer'), true, 'los equipos se piden en los pliegos');
  assert.equal(puede(lici, 'biblioteca', 'proponer'), true);
  assert.equal(puede(lici, 'plataforma', 'leer'), true);
  assert.equal(puede(critico, 'biblioteca', 'leer'), false, 'el crítico ciego no ve la Biblioteca');
  assert.equal(puede(critico, 'colaboradores', 'leer'), false, 'ni los CV');
  assert.equal(puede(permisosDe('otro-perfil'), 'licitaciones', 'leer'), true, 'un perfil nuevo lee licitaciones');
  assert.equal(puede(permisosDe('otro-perfil'), 'colaboradores', 'leer'), false, 'pero no los CV: hay que concederlo');
  const concedido = { 'otro-perfil': { colaboradores: 'leer' as const } };
  assert.equal(puede(permisosDe('otro-perfil', concedido), 'colaboradores', 'leer'), true, 'permisos.json los concede');
  assert.equal(
    puede(permisosDe('critico-licitaciones', { 'critico-licitaciones': { biblioteca: 'leer' } }), 'biblioteca', 'leer'),
    true,
    'permisos.json puede ampliarlo',
  );
});

test('should_apply_permission_overrides_and_ignore_a_broken_file', () => {
  fs.writeFileSync(
    path.join(dir, 'permisos.json'),
    JSON.stringify({ 'claude-code': { biblioteca: 'leer', licitaciones: 'ninguno' } }),
  );
  const claude = agentePorToken(dir, T_CLAUDE, env)!;
  assert.equal(puede(claude.permisos, 'biblioteca', 'proponer'), false);
  assert.equal(puede(claude.permisos, 'licitaciones', 'leer'), false);
  fs.writeFileSync(path.join(dir, 'permisos.json'), '{ esto no es json');
  olvidarAgentes();
  assert.equal(puede(agentePorToken(dir, T_CLAUDE, env)!.permisos, 'licitaciones', 'leer'), true);
  fs.rmSync(path.join(dir, 'permisos.json'));
});

test('should_keep_the_other_overrides_when_permisos_json_names_a_retired_domain', () => {
  fs.writeFileSync(
    path.join(dir, 'permisos.json'),
    JSON.stringify({ 'claude-code': { licitaciones: 'ninguno', retirado: 'leer' } }),
  );
  assert.deepEqual(leerAjustesPermisos(dir), {
    data: { 'claude-code': { licitaciones: 'ninguno' } },
    descartados: ['retirado'],
    error: null,
  });
  const claude = agentePorToken(dir, T_CLAUDE, env)!;
  assert.equal(puede(claude.permisos, 'licitaciones', 'leer'), false, 'el «ninguno» sigue valiendo');
  assert.equal(Object.hasOwn(claude.permisos, 'retirado'), false);
  fs.rmSync(path.join(dir, 'permisos.json'));
});

test('should_limit_requests_per_agent_and_minute', () => {
  const permitir = crearLimitador(2);
  assert.equal(permitir('a', 0), true);
  assert.equal(permitir('a', 1), true);
  assert.equal(permitir('a', 2), false);
  assert.equal(permitir('b', 2), true, 'cada agente tiene su cupo');
  assert.equal(permitir('a', 60_001), true, 'la ventana se desliza');
  assert.deepEqual(permitir.uso(60_002), { a: 1 }, 'cuántas lleva cada agente en el último minuto');
});

test('should_charge_the_mcp_quota_only_for_tool_calls', async () => {
  const { esLlamadaAHerramienta } = await import('../../src/nucleo/mcp/servidor.js');
  assert.equal(
    esLlamadaAHerramienta({ method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} } }),
    true,
  );
  assert.equal(
    esLlamadaAHerramienta({
      method: 'POST',
      body: [{ method: 'notifications/initialized' }, { method: 'tools/call' }],
    }),
    true,
    'en lote',
  );
  for (const metodo of ['initialize', 'notifications/initialized', 'tools/list']) {
    assert.equal(esLlamadaAHerramienta({ method: 'POST', body: { method: metodo } }), false, metodo);
  }
  assert.equal(esLlamadaAHerramienta({ method: 'GET', body: undefined }), false, 'el canal de escucha');
  assert.equal(esLlamadaAHerramienta({ method: 'DELETE', body: undefined }), false);
});

test('should_audit_tool_use_without_arguments_or_content', () => {
  const db = abrirNucleo(path.join(tmp, 'datos'));
  registrarUso(db, {
    agente: 'claude-code',
    herramienta: 'licitaciones_ver',
    dominio: 'licitaciones',
    recurso: 'p-1',
    resultado: 'ok',
  });
  const [uso] = usosRecientes(db, 5, 'claude-code');
  assert.deepEqual(Object.keys(uso!).sort(), ['agente', 'creado_en', 'dominio', 'herramienta', 'recurso', 'resultado']);
  assert.equal(uso!.recurso, 'p-1');
  db.close();
});
