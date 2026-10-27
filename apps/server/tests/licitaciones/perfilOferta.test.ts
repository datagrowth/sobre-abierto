// La preparación de la oferta (guion, memoria, anexos, evaluación) puede ir a otro perfil
// de Hermes, con un modelo mejor; la criba, las fichas y las actas siguen en licitaciones.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perfil-oferta-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.HERMES_HOME = path.join(tmp, 'hermes');
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.NODE_ENV = 'test';
fs.mkdirSync(process.env.SALIDAS_DIR, { recursive: true });

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { leerConfig } = await import('../../src/nucleo/config.js');
const { destinoDeTipo } = await import('../../src/nucleo/colaTipos.js');
const { registrarTrabajos, textoPerfilCritico, textoPerfilOferta } =
  await import('../../src/dominios/licitaciones/index.js');
const { cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { permisosDe } = await import('../../src/nucleo/agentes/permisos.js');

iniciarNucleo();
registrarTrabajos();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const LIC = { HERMES_LICITACIONES_URL: 'http://hermes:8642/p/licitaciones', HERMES_LICITACIONES_KEY: 'l'.repeat(20) };
const OFERTA = {
  HERMES_OFERTA_LICITACIONES_URL: 'http://hermes:8642/p/oferta-licitaciones/',
  HERMES_OFERTA_LICITACIONES_KEY: 'o'.repeat(20),
};
const PREPARACION = [
  'licitaciones.guion',
  'licitaciones.memoria_estrategia',
  'licitaciones.memoria_redaccion',
  'licitaciones.memoria_hechos',
  'licitaciones.anexo',
  'licitaciones.evaluar',
  'licitaciones.decisiones',
];
const REQUISITOS = ['licitaciones.cribar', 'licitaciones.ficha', 'licitaciones.aprender_acta'];

function conConfig(env: Record<string, string>): void {
  Object.assign(nucleo().config, leerConfig({ ...env, SALIDAS_DIR: process.env.SALIDAS_DIR! }));
}

test('should_send_offer_preparation_to_the_oferta_profile_and_requirements_to_licitaciones', () => {
  conConfig({ ...LIC, ...OFERTA });
  for (const tipo of PREPARACION)
    assert.equal(destinoDeTipo(tipo)?.url, 'http://hermes:8642/p/oferta-licitaciones', tipo);
  for (const tipo of REQUISITOS) assert.equal(destinoDeTipo(tipo)?.url, 'http://hermes:8642/p/licitaciones', tipo);
  assert.equal(textoPerfilOferta(), 'perfil propio (oferta-licitaciones)');
});

test('should_fall_back_to_the_licitaciones_profile_without_an_oferta_profile', () => {
  conConfig(LIC);
  for (const tipo of [...PREPARACION, ...REQUISITOS])
    assert.equal(destinoDeTipo(tipo)?.url, 'http://hermes:8642/p/licitaciones', tipo);
  assert.match(textoPerfilOferta(), /^usa el perfil de licitaciones/);
  conConfig({ ...LIC, HERMES_OFERTA_LICITACIONES_URL: OFERTA.HERMES_OFERTA_LICITACIONES_URL });
  assert.equal(destinoDeTipo('licitaciones.guion')?.url, 'http://hermes:8642/p/licitaciones', 'a medias no se usa');
  assert.match(textoPerfilOferta(), /HERMES_OFERTA_LICITACIONES_URL sin KEY/);
});

test('should_give_the_oferta_agent_the_same_tools_as_licitaciones', () => {
  assert.deepEqual(permisosDe('oferta-licitaciones'), permisosDe('licitaciones'));
});

const CRITICO = {
  HERMES_OFERTA_CRITICO_URL: 'http://hermes:8642/p/critico-licitaciones',
  HERMES_OFERTA_CRITICO_KEY: 'x'.repeat(20),
};

test('should_fall_back_to_offer_profile_and_mark_not_independent_without_critic_config', () => {
  conConfig({ ...LIC, ...OFERTA });
  assert.equal(
    destinoDeTipo('licitaciones.memoria_critica')?.url,
    'http://hermes:8642/p/oferta-licitaciones',
    'sin crítico, critica el de oferta',
  );
  assert.match(textoPerfilCritico(), /^la hace el perfil de oferta, el mismo que redacta: tiende a sobrevalorar/);
  for (const tipo of ['licitaciones.memoria_estrategia', 'licitaciones.memoria_redaccion'])
    assert.equal(destinoDeTipo(tipo)?.url, 'http://hermes:8642/p/oferta-licitaciones', tipo);
  conConfig({ ...LIC, ...OFERTA, ...CRITICO });
  assert.equal(destinoDeTipo('licitaciones.memoria_critica')?.url, 'http://hermes:8642/p/critico-licitaciones');
  assert.equal(
    destinoDeTipo('licitaciones.memoria_redaccion')?.url,
    'http://hermes:8642/p/oferta-licitaciones',
    'la redacción sigue en el de oferta',
  );
  assert.equal(textoPerfilCritico(), 'perfil propio (critico-licitaciones)');
  conConfig({ ...LIC, ...OFERTA, HERMES_OFERTA_CRITICO_URL: CRITICO.HERMES_OFERTA_CRITICO_URL });
  assert.match(textoPerfilCritico(), /HERMES_OFERTA_CRITICO_URL sin KEY/);
});

test('should_give_the_critic_only_licitaciones_without_cvs', () => {
  assert.deepEqual(permisosDe('critico-licitaciones'), { licitaciones: 'proponer' });
});
