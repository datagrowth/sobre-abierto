// El libro de lecciones: tema de apartado por código, fuerza por evidencias independientes y
// sin nombres de personas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuerzaDe, personasEn } from '../../src/dominios/licitaciones/oferta/libroLecciones.js';
import { temaDeApartado } from '../../src/dominios/licitaciones/oferta/temasApartado.js';

const evidencia = (licitacion_id: string | null, documento: string | null = null) => ({
  licitacion_id,
  memoria_id: null,
  documento,
  ubicacion: null,
  texto: '',
});

test('should_give_the_theme_of_a_section_from_its_title_whatever_its_wording', () => {
  assert.equal(temaDeApartado('Cronograma de ejecución'), 'planificacion');
  assert.equal(temaDeApartado('Plan de trabajo y fases'), 'planificacion');
  assert.equal(temaDeApartado('Metodología de impartición'), 'metodologia');
  assert.equal(temaDeApartado('Equipo de trabajo adscrito'), 'equipo');
  assert.equal(temaDeApartado('Mejoras sin coste'), 'mejoras');
  assert.equal(temaDeApartado('Plan de calidad e indicadores de seguimiento'), 'calidad');
  assert.equal(temaDeApartado('Anexo'), null);
  assert.equal(temaDeApartado(null), null);
});

test('should_count_strength_as_independent_offers_and_not_as_changes_of_the_same_one', () => {
  assert.equal(fuerzaDe([]), 1, 'una lección tiene al menos su origen');
  assert.equal(fuerzaDe([evidencia('alm'), evidencia('alm')]), 1, 'dos cambios de la misma oferta');
  assert.equal(fuerzaDe([evidencia('alm'), evidencia('nav')]), 2);
  assert.equal(
    fuerzaDe([evidencia(null, 'Presentadas/acta.pdf'), evidencia(null, 'Presentadas/otra.pdf')]),
    2,
    'sin licitación, por documento',
  );
});

test('should_detect_a_team_member_name_in_a_lesson_only_when_names_are_known', () => {
  const tapar = (t: string) => t.split('Persona D').join('la persona 4');
  assert.equal(personasEn('Pon a Persona D como responsable.', tapar), true);
  assert.equal(personasEn('Pon a la persona responsable del proyecto.', tapar), false);
  assert.equal(personasEn('Pon a Persona D como responsable.', null), false);
});
