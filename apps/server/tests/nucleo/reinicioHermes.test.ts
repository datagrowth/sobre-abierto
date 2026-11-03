// Lo que el instalador lee tras actualizar: los perfiles de Hermes con la lista de herramientas de
// antes del despliegue (no los agentes de fuera, que un reinicio de Hermes no arregla) y los runs en marcha.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reinicio-'));
const agentes = path.join(tmp, '.agentes');
fs.mkdirSync(agentes);
fs.writeFileSync(path.join(agentes, 'licitaciones.token'), 'l'.repeat(40));
fs.writeFileSync(path.join(agentes, 'oferta-licitaciones.token'), 'o'.repeat(40));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.AGENTE_TOKEN_CLAUDE_CODE = 'c'.repeat(40);
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { guardarHuella, anotarListado } = await import('../../src/nucleo/mcp/huellas.js');
const { estadoReinicio, textoReinicio } = await import('../../src/nucleo/mcp/reinicio.js');
const { encolar } = await import('../../src/nucleo/trabajos.js');

iniciarNucleo();
const db = () => nucleo().db;

after(() => {
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function desfasar(agente: string): void {
  guardarHuella(db(), agente, 'vieja', '2026-11-01T10:00:00.000Z');
  anotarListado(db(), agente, 'vieja', '2026-11-01T10:00:00.000Z');
  guardarHuella(db(), agente, 'nueva', '2026-11-02T10:00:00.000Z');
}

test('should_report_nothing_to_restart_when_hermes_has_the_current_tools', () => {
  guardarHuella(db(), 'licitaciones', 'h1', '2026-11-01T10:00:00.000Z');
  assert.deepEqual(estadoReinicio(db(), agentes), { desfasados: [], enMarcha: 0 });
  assert.equal(textoReinicio({ desfasados: [], enMarcha: 0 }), 'desfasados=\nen_marcha=0');
});

test('should_report_stale_hermes_profiles_but_not_outside_agents', () => {
  desfasar('oferta-licitaciones');
  desfasar('claude-code');

  const e = estadoReinicio(db(), agentes);

  assert.deepEqual(e.desfasados, ['oferta-licitaciones'], 'reiniciar Hermes no arregla a Claude Code');
});

test('should_count_the_runs_a_restart_would_cut', () => {
  const id = encolar(db(), { tipo: 'lic.guion', dominio: 'lic', clave: 'guion-1', payload: { id: 'p-1' } });
  encolar(db(), { tipo: 'lic.guion', dominio: 'lic', clave: 'guion-2', payload: { id: 'p-2' } });
  db().prepare("UPDATE trabajos_ia SET estado = 'lanzado' WHERE id = ?").run(id);

  const e = estadoReinicio(db(), agentes);

  assert.equal(e.enMarcha, 1, 'un pendiente no se corta');
  assert.equal(textoReinicio(e), 'desfasados=oferta-licitaciones\nen_marcha=1');
});
