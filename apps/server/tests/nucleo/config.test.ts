// Configuración de la plataforma: al arrancar se valida sin lanzar y, si falla, solo se
// sabe qué variables no valen (nunca sus valores, que pueden ser claves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerConfig, validarConfig } from '../../src/nucleo/config.js';

test('should_return_the_names_of_the_invalid_variables_without_their_values', () => {
  const r = validarConfig({ HERMES_RUNS_A_LA_VEZ: '99', HERMES_LICITACIONES_KEY: 'corta-y-secreta' });
  assert.equal(r.data, null);
  assert.equal(r.error?.code, 'config_invalida');
  assert.deepEqual(r.error?.message.split(', ').sort(), ['HERMES_LICITACIONES_KEY', 'HERMES_RUNS_A_LA_VEZ']);
  assert.ok(!r.error?.message.includes('corta-y-secreta'));
});

test('should_validate_a_correct_environment_without_throwing', () => {
  const r = validarConfig({ PLATAFORMA_DATA_DIR: '/tmp/plataforma' });
  assert.equal(r.error, null);
  assert.equal(r.data?.dataDir, '/tmp/plataforma');
});

test('should_read_the_agent_requests_per_minute_from_the_validated_config', () => {
  assert.equal(leerConfig({}).agentesPeticionesMinuto, 120, 'por defecto');
  assert.equal(leerConfig({ AGENTES_PETICIONES_MINUTO: '30' }).agentesPeticionesMinuto, 30);
  assert.deepEqual(validarConfig({ AGENTES_PETICIONES_MINUTO: '0' }).error?.message, 'AGENTES_PETICIONES_MINUTO');
  assert.deepEqual(validarConfig({ AGENTES_PETICIONES_MINUTO: 'muchas' }).error?.message, 'AGENTES_PETICIONES_MINUTO');
});

test('should_default_the_daily_run_cap_to_40', () => {
  const { licitaciones } = leerConfig({});
  assert.equal(licitaciones.runsOfertaDia, 40, 'runs automáticos por oferta y día');
  assert.equal(licitaciones.propuestasDia, 3, 'propuestas automáticas por oferta y día');
  assert.equal(
    leerConfig({ LICITACIONES_RUNS_OFERTA_DIA: '60', LICITACIONES_PROPUESTAS_DIA: '5' }).licitaciones.runsOfertaDia,
    60,
  );
  assert.equal(validarConfig({ LICITACIONES_RUNS_OFERTA_DIA: '4' }).error?.message, 'LICITACIONES_RUNS_OFERTA_DIA');
  assert.equal(validarConfig({ LICITACIONES_PROPUESTAS_DIA: '0' }).error?.message, 'LICITACIONES_PROPUESTAS_DIA');
});

test('should_keep_the_deuc_xml_switch_off_by_default_and_validate_it', () => {
  assert.equal(leerConfig({}).licitaciones.deucXml, false, 'apagado por defecto');
  assert.equal(leerConfig({ LICITACIONES_DEUC_XML: '1' }).licitaciones.deucXml, true);
  assert.equal(leerConfig({ LICITACIONES_DEUC_XML: '0' }).licitaciones.deucXml, false);
  assert.equal(validarConfig({ LICITACIONES_DEUC_XML: 'si' }).error?.message, 'LICITACIONES_DEUC_XML');
});
