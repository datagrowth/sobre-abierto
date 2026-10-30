import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avisosDeNavegacion, cuentasDeNavegacion, seccionDeLicitacion } from './navegacion.js';

test('should_hang_our_offers_from_the_pipeline_and_the_rest_from_opportunities', () => {
  assert.equal(seccionDeLicitacion({ estado: 'en_preparacion' }).seccion, 'pipeline');
  assert.equal(seccionDeLicitacion({ estado: 'ganada' }).texto, 'Pipeline');
  assert.equal(seccionDeLicitacion({ estado: 'ficha_por_revisar' }).seccion, 'oportunidades');
  assert.equal(seccionDeLicitacion({ estado: 'descartada' }).texto, 'Oportunidades');
  assert.equal(seccionDeLicitacion(null).seccion, 'pipeline', 'mientras carga, la pantalla principal');
});

test('should_count_licitaciones_work_on_the_pipeline', () => {
  assert.deepEqual(cuentasDeNavegacion({ licitaciones: 3, equipo: 2 }), { pipeline: 3, equipo: 2 });
  assert.deepEqual(cuentasDeNavegacion(), { pipeline: 0 });
  assert.deepEqual(avisosDeNavegacion({ licitaciones: '2 cosas por revisar', biblioteca: 'x' }), {
    pipeline: '2 cosas por revisar',
    biblioteca: 'x',
  });
  assert.deepEqual(avisosDeNavegacion({ equipo: 'y' }), { equipo: 'y' });
});
