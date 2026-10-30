// Formaciones solo de las áreas de formación del perfil (sin áreas, sin regla) y norma de nueva creación
// aparte: lo que Hermes recibe en las instrucciones de la criba y de la ficha, y cuándo la empresa cuenta
// como de nueva creación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instruccionesCriba } from '../../src/dominios/licitaciones/criba.js';
import { instruccionesFicha } from '../../src/dominios/licitaciones/ficha.js';
import { esNuevaCreacion } from '../../src/dominios/licitaciones/fichaVerificacion.js';

const AREAS = ['inteligencia artificial', 'dato (analítica, gobierno del dato)'];

test('should_tell_the_criba_to_discard_trainings_outside_our_areas_and_review_unclear_ones', () => {
  // Act
  const instrucciones = instruccionesCriba(7, 'Analítica Ejemplo', AREAS);

  // Assert
  for (const area of AREAS) assert.ok(instrucciones.includes(area), `nombra «${area}»`);
  assert.match(instrucciones, /«descartar» con el motivo «Formación fuera de nuestras áreas: <materia>»/);
  assert.match(instrucciones, /si el título no deja claro de qué es la formación, «revisar»/);
  assert.ok(
    instrucciones.indexOf('Formaciones') < instrucciones.indexOf('4. Envía'),
    'dentro del paso 3, antes de enviar',
  );
});

test('should_tell_the_ficha_that_a_training_outside_our_areas_is_no_go_and_to_fill_the_new_company_rule', () => {
  // Act
  const instrucciones = instruccionesFicha('p-1', 'Analítica Ejemplo', AREAS);

  // Assert
  for (const area of AREAS) assert.ok(instrucciones.includes(area), `nombra «${area}»`);
  assert.match(instrucciones, /recomendación «no_go» con el motivo «Formación fuera de nuestras áreas: <materia>»/);
  assert.doesNotMatch(instrucciones, /\$\{/, 'sin plantillas sin sustituir');
  assert.match(instrucciones, /pon esa norma en «nueva_creacion» del mismo requisito, con documento y página/);
});

test('should_leave_out_the_training_rule_when_the_profile_has_no_training_areas', () => {
  // Act
  const criba = instruccionesCriba(7, 'Analítica Ejemplo');
  const ficha = instruccionesFicha('p-1', 'Analítica Ejemplo', []);

  // Assert
  for (const instrucciones of [criba, ficha]) assert.doesNotMatch(instrucciones, /Formación fuera de nuestras áreas/);
  assert.doesNotMatch(criba, /\n\s*\n/, 'sin una línea vacía donde iba la regla');
  assert.match(ficha, /a mano\); y senales_pliego/);
});

test('should_count_a_company_as_new_until_its_fifth_anniversary', () => {
  // Arrange
  const hoy = new Date('2026-10-20T10:00:00Z');

  // Act / Assert
  assert.equal(esNuevaCreacion({ fecha_constitucion: '2023-09-29' }, hoy), true);
  assert.equal(esNuevaCreacion({ fecha_constitucion: '2021-10-21' }, hoy), true, 'un día antes de los cinco años');
  assert.equal(esNuevaCreacion({ fecha_constitucion: '2021-10-01' }, hoy), false);
  assert.equal(esNuevaCreacion({ fecha_constitucion: null }, hoy), null, 'sin fecha no se sabe');
  assert.equal(esNuevaCreacion(null, hoy), null);
});
