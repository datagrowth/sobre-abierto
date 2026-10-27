// Lo propio de cada empresa en Ajustes › Empresa (nombre comercial, zona horaria y áreas de formación): vuelve igual al
// guardar y lo vacío o la zona peninsular no se envían (el servidor pone el valor neutro).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diferenciasPerfil, formularioAPerfil, perfilAFormulario } from './empresaFormulario.js';
import { EMPRESA_EJEMPLO } from '../../tests/fixtures/empresaEjemplo.mjs';

test('should_round_trip_the_trade_name_and_the_time_zone', () => {
  const perfil = { ...EMPRESA_EJEMPLO, nombre_comercial: 'Analitix', zona_horaria: 'Atlantic/Canary' };
  const f = perfilAFormulario(perfil);
  assert.deepEqual([f.nombre_comercial, f.zona_horaria], ['Analitix', 'Atlantic/Canary']);
  const { perfil: vuelta, errores } = formularioAPerfil(f);
  assert.deepEqual(errores, []);
  assert.deepEqual([vuelta.nombre_comercial, vuelta.zona_horaria], ['Analitix', 'Atlantic/Canary']);
});

test('should_send_nothing_for_an_empty_trade_name_or_the_peninsular_zone', () => {
  const { perfil, errores } = formularioAPerfil(perfilAFormulario(EMPRESA_EJEMPLO));
  assert.deepEqual(errores, []);
  for (const k of ['nombre_comercial', 'zona_horaria', 'region_nuts', 'banda_importe_min', 'banda_importe_max'])
    assert.equal(k in perfil, false, k);
});

test('should_say_what_changed_in_trade_name_and_time_zone', () => {
  const cambios = diferenciasPerfil(EMPRESA_EJEMPLO, {
    ...EMPRESA_EJEMPLO,
    nombre_comercial: 'Analitix',
    zona_horaria: 'Atlantic/Canary',
  }).map((d) => d.campo);
  assert.deepEqual(cambios, ['Nombre comercial', 'Zona horaria']);
});

test('should_round_trip_training_areas_one_per_line_without_blanks_or_duplicates', () => {
  const areas = ['inteligencia artificial', 'dato (analítica, gobierno del dato)'];
  const f = perfilAFormulario({ ...EMPRESA_EJEMPLO, areas_formacion: areas });
  assert.equal(f.areas_formacion, areas.join('\n'));
  const escrito = [` ${areas[0]}`, '', areas[1], areas[0]].join('\r\n');
  const { perfil } = formularioAPerfil({ ...f, areas_formacion: escrito });
  assert.deepEqual(perfil.areas_formacion, areas);
});

test('should_send_no_training_areas_when_the_field_is_empty', () => {
  const { perfil } = formularioAPerfil({ ...perfilAFormulario(EMPRESA_EJEMPLO), areas_formacion: ' \n ' });
  assert.equal('areas_formacion' in perfil, false);
});
