import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultaParaGuardar, deConsulta, nombreSugerido, textoBusqueda } from './busquedasFormato.js';
import { filtrosIniciales } from './oportunidadesFormato.js';

const FILTROS = {
  ...filtrosIniciales(null),
  comunidades: ['ES70'],
  cpv: ['72', '80'],
  importe_min: 15000,
  opinion: ['interesa'],
};

test('should_save_the_list_query_without_tab_or_page', () => {
  const c = consultaParaGuardar({ texto: ' formación ', pliegos: true, filtros: FILTROS });
  assert.deepEqual(c, {
    texto: 'formación',
    pliegos: '1',
    opinion: 'interesa',
    comunidad: 'ES70',
    importe_min: '15000',
    cpv: '72,80',
  });
});

test('should_open_a_saved_search_back_as_the_same_list_filters', () => {
  const vuelta = deConsulta(consultaParaGuardar({ texto: 'formación', pliegos: true, filtros: FILTROS }));
  assert.deepEqual(vuelta, { texto: 'formación', pliegos: true, filtros: FILTROS });
  assert.deepEqual(deConsulta({}).filtros.opinion, ['interesa', 'revisar', 'descartar'], 'sin opinión guardada, todas');
});

test('should_suggest_a_name_from_the_text_or_the_cpvs', () => {
  assert.equal(nombreSugerido({ texto: ' IA generativa ', filtros: FILTROS }), 'IA generativa');
  assert.equal(nombreSugerido({ texto: '', filtros: FILTROS }), 'CPV 72, 80');
  assert.equal(nombreSugerido({ texto: '', filtros: filtrosIniciales(null) }), 'Mi búsqueda');
});

test('should_say_how_often_and_how_many_new_ones', () => {
  assert.equal(textoBusqueda({ frecuencia: 'diaria', activa: true, nuevas: 2 }), 'Cada día · 2 nuevas esta semana');
  assert.equal(textoBusqueda({ frecuencia: 'semanal', activa: true, nuevas: 1 }), 'Cada semana · 1 nueva esta semana');
  assert.equal(textoBusqueda({ frecuencia: 'semanal', activa: false, nuevas: 3 }), 'Cada semana · en pausa');
});
