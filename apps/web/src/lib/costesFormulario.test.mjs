import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cuerpoPerfilCostes,
  formularioAPerfilCostes,
  GRUPOS_COSTES,
  perfilCostesAFormulario,
} from './costesFormulario.js';

// Los valores por defecto del servidor (nucleo/perfilCostes.ts), como llegan del GET.
const POR_DEFECTO = {
  euros_hora: 25,
  euros_material_por_persona: 18,
  euros_envio_por_persona: 7,
  minutos_preparacion_individual: 10,
  fraccion_aptas: 0.75,
  fraccion_ruta_apoyo: 0.25,
  tamano_subgrupo: 11,
  horas_preparacion_por_hora_lectiva: 1.5,
  horas_por_contacto: 1,
  horas_montaje_aula: 8,
  horas_aula_semana: 4.5,
  horas_por_informe: 2,
  minutos_extra_comentario: 3,
  plazo_referencia_dias: 5,
  umbral_horas: 15,
  umbral_euros: 300,
  umbral_pct_presupuesto: 0.02,
  umbral_total_pct: 0.5,
};

const formulario = (cambios) => ({ ...perfilCostesAFormulario(POR_DEFECTO), ...cambios });

test('should_read_decimal_comma', () => {
  const { perfil, errores } = formularioAPerfilCostes(
    formulario({ euros_hora: '32,50', horas_aula_semana: '4,5', fraccion_aptas: '72,5' }),
  );

  assert.deepEqual(errores, []);
  assert.equal(perfil.euros_hora, 32.5);
  assert.equal(perfil.horas_aula_semana, 4.5);
  assert.equal(perfil.fraccion_aptas, 0.725);
});

test('should_send_null_for_empty_to_keep_default', () => {
  const { perfil, errores } = formularioAPerfilCostes(
    formulario({ euros_material_por_persona: '  ', umbral_total_pct: '' }),
  );
  const cuerpo = cuerpoPerfilCostes(perfil);

  assert.deepEqual(errores, []);
  assert.equal(perfil.euros_material_por_persona, null);
  assert.equal(perfil.umbral_total_pct, null);
  // El esquema del servidor rechaza null: lo vacío no se envía y el servidor pone su valor por defecto.
  assert.equal('euros_material_por_persona' in cuerpo, false);
  assert.equal('umbral_total_pct' in cuerpo, false);
  assert.equal(cuerpo.euros_hora, 25);
});

test('should_reject_negative_values', () => {
  const { errores } = formularioAPerfilCostes(formulario({ euros_hora: '-10', euros_envio_por_persona: '-0,5' }));

  assert.equal(errores.length, 2);
  assert.match(errores[0], /Coste de una hora de trabajo: escribe un número igual o mayor que 0/);
  assert.match(errores[1], /Envío por persona/);
});

test('should_reject_out_of_range_non_integer_and_malformed_values', () => {
  const { errores } = formularioAPerfilCostes(
    formulario({ euros_hora: '0,5', tamano_subgrupo: '10,5', fraccion_ruta_apoyo: '120', umbral_horas: 'muchas' }),
  );

  assert.equal(errores.length, 4);
  assert.match(errores[0], /Coste de una hora de trabajo: entre 1 y 1\.000 €\/h/);
  assert.match(errores[1], /Alumnado en la ruta de apoyo: entre 0 y 100 %/);
  assert.match(errores[2], /Tamaño de un subgrupo: escribe un número entero/);
  assert.match(errores[3], /Un compromiso a partir de: escribe un número/);
});

test('should_round_trip_defaults', () => {
  const textos = perfilCostesAFormulario(POR_DEFECTO);
  const { perfil, errores } = formularioAPerfilCostes(textos);

  assert.equal(textos.fraccion_aptas, '75');
  assert.equal(textos.horas_preparacion_por_hora_lectiva, '1,5');
  assert.deepEqual(errores, []);
  assert.deepEqual(cuerpoPerfilCostes(perfil), POR_DEFECTO);
});

test('should_round_trip_awkward_fractions_and_thousands', () => {
  const guardado = { ...POR_DEFECTO, umbral_pct_presupuesto: 0.07, umbral_total_pct: 1.9, umbral_euros: 12_500.5 };
  const textos = perfilCostesAFormulario(guardado);

  assert.equal(textos.umbral_pct_presupuesto, '7');
  assert.equal(textos.umbral_total_pct, '190');
  assert.equal(textos.umbral_euros, '12.500,5');
  assert.deepEqual(formularioAPerfilCostes(textos).perfil, guardado);
});

test('should_leave_every_field_empty_without_profile', () => {
  const textos = perfilCostesAFormulario(null);

  assert.ok(Object.values(textos).every((t) => t === ''));
  assert.deepEqual(cuerpoPerfilCostes(formularioAPerfilCostes(textos).perfil), {});
});

test('should_cover_every_field_of_the_server_profile_once', () => {
  const claves = GRUPOS_COSTES.flatMap((g) => g.campos.map((c) => c.clave));

  assert.deepEqual([...claves].sort(), Object.keys(POR_DEFECTO).sort());
});
