// Trabajos que esperan una herramienta de Hermes: salen solos cuando el perfil vuelve a pedir la
// lista (Hermes reiniciado) y un «no está disponible» con el MCP conectado no para el tipo
// (03/11/2026: el modelo llamó a una tool mal formada y la criba quedó 24 h esperando).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'espera-herramienta-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { encolar } = await import('../../src/nucleo/trabajos.js');
const { registrarTipoTrabajo, obtenerTrabajo, actualizar } = await import('../../src/nucleo/colaTipos.js');
const { esperarHerramienta, liberarEsperasHerramienta, mcpConectado, esperaHerramienta } =
  await import('../../src/nucleo/colaEsperas.js');
const { anotarListado } = await import('../../src/nucleo/mcp/huellas.js');
const { registrarUso } = await import('../../src/nucleo/agentes/auditoria.js');

const db = abrirNucleo(tmp);
after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const destino = { url: 'http://hermes.invalid', key: 'k' };
registrarTipoTrabajo('esp.cribar', {
  destino: () => destino,
  instrucciones: () => 'criba',
  hecho: () => false,
  metricas: { agente: 'licitaciones', stateDb: () => null },
});
const SALIDA = 'No puedo: la herramienta `licitaciones_cribar` no está disponible en este perfil.';
const haceMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function lanzado(clave: string, lanzadoHaceMin: number) {
  const id = encolar(db, { tipo: 'esp.cribar', dominio: 'lic', clave, payload: {} });
  actualizar(db, id, { estado: 'lanzado', lanzado_en: haceMin(lanzadoHaceMin), run_id: `run-${clave}` });
  return obtenerTrabajo(db, id)!;
}

test('should_treat_the_run_as_lacking_tools_when_the_profile_made_no_mcp_call', () => {
  const t = lanzado('sin-llamadas', 1);
  assert.equal(mcpConectado(db, t), false);
});

test('should_consider_the_mcp_connected_when_the_profile_called_a_platform_tool_around_the_run', () => {
  // Arrange: otro run del mismo perfil usó el MCP hace 5 min.
  registrarUso(db, {
    agente: 'licitaciones',
    herramienta: 'licitaciones_candidatas',
    dominio: 'lic',
    recurso: null,
    resultado: 'ok',
  });
  const t = lanzado('con-llamadas', 1);

  // Act + Assert
  assert.equal(mcpConectado(db, t), true);
  assert.equal(mcpConectado(db, { ...t, tipo: 'tipo.sin.agente' }), false, 'sin perfil conocido no se puede saber');
});

test('should_keep_what_hermes_answered_in_the_wait', () => {
  const t = lanzado('respuesta', 1);
  esperarHerramienta(db, t, SALIDA, true);
  const despues = obtenerTrabajo(db, t.id)!;
  assert.match(despues.error ?? '', /^Falta una herramienta en Hermes \(licitaciones_cribar\): reinicia Hermes/);
  assert.match(despues.error ?? '', /Hermes respondió: «No puedo/);
  assert.ok(esperaHerramienta(db, 'esp.cribar'), 'el tipo espera');
});

test('should_release_waiting_jobs_once_the_profile_lists_its_tools_again', () => {
  // Arrange: un listado de antes de la espera no la levanta.
  anotarListado(db, 'licitaciones', 'h', haceMin(60));
  assert.equal(liberarEsperasHerramienta(db), 0);
  assert.ok(esperaHerramienta(db, 'esp.cribar'));

  // Act: Hermes reiniciado vuelve a pedir la lista.
  anotarListado(db, 'licitaciones', 'h', new Date(Date.now() + 1000).toISOString());
  const liberados = liberarEsperasHerramienta(db);

  // Assert
  assert.equal(liberados, 1);
  assert.equal(esperaHerramienta(db, 'esp.cribar'), null, 'el tipo ya no espera');
  assert.equal(liberarEsperasHerramienta(db), 0, 'una sola vez');
});
