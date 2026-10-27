import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asignarAlRol,
  avisosIncompatibles,
  enlaceCelda,
  enlaceFicha,
  pendientesDeGuardar,
  slug,
  textoCelda,
} from './matrizEquipoFormato.js';

// Filas como las que da el servidor para Villaejemplo (fixture cambios/casoC-medios.json, seudonimizado).
const TUTOR = {
  rol: 'Tutor',
  lote: '3',
  materias: ['topografia', 'análisis de datos'],
  pagina: 3,
  asignados: [
    {
      persona_id: 1001,
      nombre: 'Persona F',
      celdas: [
        { materia: 'topografia', estado: 'no', fuente: null },
        { materia: 'análisis de datos', estado: 'si', fuente: 'colaboradores' },
      ],
    },
  ],
  incompatibles: [
    'Persona F es Tutor y también Coordinador/a: el pliego los pide como roles distintos, comprueba que pueda ser la misma persona',
  ],
};
const COORDINACION = {
  rol: 'Coordinador/a',
  lote: '3',
  materias: [],
  pagina: 3,
  asignados: [{ persona_id: 1001, nombre: 'Persona F', celdas: [] }],
  incompatibles: [
    'Persona F es Coordinador/a y también Tutor: el pliego los pide como roles distintos, comprueba que pueda ser la misma persona',
  ],
};

test('should_build_the_person_anchor_with_the_subject', () => {
  assert.equal(enlaceFicha(1001, 'topografia'), '#/equipo/1001#campo=topografia');
  assert.equal(enlaceFicha(7, 'limpieza/mantenimiento'), '#/equipo/7#campo=limpieza%2Fmantenimiento');
  assert.equal(enlaceFicha(7, null), '#/equipo/7');
});

test('should_link_a_missing_subject_to_the_person_card', () => {
  const enlace = enlaceCelda(1001, TUTOR.asignados[0].celdas[0]);

  assert.deepEqual(enlace, { href: '#/equipo/1001#campo=topografia', texto: 'Añadir «topografia» en su ficha' });
  assert.equal(enlaceCelda(1001, TUTOR.asignados[0].celdas[1]), null, 'lo acreditado no lleva enlace');
});

test('should_render_no_comprobado_for_cv_only_evidence', () => {
  const celda = {
    materia: 'topografia',
    estado: 'no_comprobado',
    fuente: 'cv',
    ruta: 'Equipo/CV Persona F.pdf',
    pagina: 2,
  };

  assert.deepEqual(textoCelda(celda), { simbolo: 'no comprobado', tono: 'aviso', fuente: 'su CV (pág. 2)' });
  assert.equal(enlaceCelda(1001, celda).texto, 'Actualizar Colaboradores con el CV (pág. 2)');
  assert.equal(enlaceCelda(1001, { ...celda, pagina: null }).texto, 'Actualizar Colaboradores con el CV');
});

test('should_never_read_an_unknown_state_as_yes', () => {
  assert.equal(textoCelda({ materia: 'x', estado: 'dudoso', fuente: null }).simbolo, 'no comprobado');
  assert.equal(textoCelda(null).simbolo, 'no comprobado');
  assert.deepEqual(textoCelda({ materia: 'x', estado: 'no', fuente: null }), {
    simbolo: '✗',
    tono: 'peligro',
    fuente: null,
  });
  assert.equal(textoCelda({ materia: 'x', estado: 'si', fuente: 'colaboradores' }).fuente, 'Colaboradores');
});

test('should_slug_roles_with_accents', () => {
  assert.equal(slug('Técnico/a de formación'), 'tecnico-a-de-formacion');
  assert.equal(slug('Coordinador/a'), 'coordinador-a');
  assert.equal(slug('  Tutor  '), 'tutor');
  assert.equal(slug(''), 'sin-nombre');
  assert.equal(slug(null), 'sin-nombre');
});

test('should_add_a_new_entry_when_assigning_someone_to_a_second_role', () => {
  const equipo = [
    { persona_id: 1001, rol_en_la_oferta: 'Coordinadora de los cinco cursos', dedicacion: 'Parcial', lotes: [] },
  ];

  const nuevo = asignarAlRol(equipo, '1001', TUTOR);

  assert.equal(nuevo.length, 2);
  assert.deepEqual(nuevo[1], { persona_id: 1001, rol_en_la_oferta: 'Tutor', dedicacion: '', lotes: ['3'] });
});

test('should_not_duplicate_someone_already_in_the_role', () => {
  const equipo = [{ persona_id: 1001, rol_en_la_oferta: 'Tutora docente de los cursos', dedicacion: '', lotes: [] }];

  assert.equal(asignarAlRol(equipo, 1001, TUTOR), equipo);
  assert.equal(asignarAlRol(equipo, 'basura', TUTOR), equipo);
});

test('should_list_unsaved_people_already_named_in_the_role', () => {
  const equipo = [
    { persona_id: 1001, rol_en_la_oferta: 'Coordinadora de los cinco cursos', lotes: [] },
    { persona_id: 1005, rol_en_la_oferta: 'Coordinador adjunto', lotes: [] },
    { persona_id: 1005, rol_en_la_oferta: 'Coordinación técnica', lotes: [] },
  ];

  assert.deepEqual(pendientesDeGuardar(COORDINACION, equipo), [1005]);
  assert.deepEqual(pendientesDeGuardar(TUTOR, equipo), []);
  assert.deepEqual(pendientesDeGuardar(null, equipo), []);
});

test('should_show_each_incompatible_pair_once', () => {
  assert.equal(avisosIncompatibles([TUTOR, COORDINACION]).length, 1);
  assert.deepEqual(avisosIncompatibles([]), []);
});
