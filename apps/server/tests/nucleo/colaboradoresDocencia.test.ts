// Horas de docencia por materia: lo que pide el pliego («150 h impartidas en IA en los 3
// últimos años»), la regla contra el perfil y la docencia como evidencia de la materia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PersonaEntrada } from '../../src/nucleo/colaboradores/personas.js';

process.env.NODE_ENV = 'test';

const { Persona } = await import('../../src/nucleo/colaboradores/personas.js');
const { analizarRequisito, docenciaExigida } = await import('../../src/nucleo/colaboradores/requisito.js');
const { reglasDe, candidatos } = await import('../../src/nucleo/colaboradores/matching.js');
const { evidenciaDeMateria, materiasExigidas } = await import('../../src/nucleo/colaboradores/materias.js');

let siguiente = 1;
function persona(datos: Partial<PersonaEntrada> & { nombre: string }) {
  return {
    ...Persona.parse({ tipo: 'interno', ...datos }),
    id: siguiente++,
    creada_en: '2026-01-01T00:00:00.000Z',
    actualizada_en: '2026-01-01T00:00:00.000Z',
  };
}

const DOCENTE =
  'Docente con al menos 150 h impartidas en inteligencia artificial en los 3 últimos años y titulación universitaria.';
const ANIO = 2026;

test('should_read_hours_subject_and_period_from_a_teaching_requirement', () => {
  const d = docenciaExigida(DOCENTE);
  assert.equal(d?.horas, 150);
  assert.equal(d?.anios, 3);
  assert.equal(d?.materia?.texto, 'inteligencia artificial');
});

test('should_read_other_ways_of_asking_for_teaching_hours', () => {
  assert.deepEqual(
    {
      horas: docenciaExigida('Experiencia docente mínima de 200 horas en Power BI')?.horas,
      materia: docenciaExigida('Experiencia docente mínima de 200 horas en Power BI')?.materia?.texto,
    },
    { horas: 200, materia: 'power bi' },
  );
  assert.equal(
    docenciaExigida(
      'Haber impartido un mínimo de 1.000 horas de formación en ciberseguridad durante los cinco últimos años',
    )?.horas,
    1000,
  );
  assert.equal(
    docenciaExigida(
      'Haber impartido un mínimo de 1.000 horas de formación en ciberseguridad durante los cinco últimos años',
    )?.anios,
    5,
  );
  assert.equal(docenciaExigida('300 horas de docencia')?.materia, null, 'sin materia: vale cualquiera');
});

test('should_not_take_course_length_or_training_received_as_teaching_hours', () => {
  assert.equal(docenciaExigida('Curso de 30 horas de duración para el personal'), null);
  assert.equal(docenciaExigida('Formación mínima de 6 horas al personal de la entidad'), null);
  assert.equal(docenciaExigida(''), null);
  assert.equal(analizarRequisito('Jefe de proyecto con PMP').docencia, null);
});

test('should_meet_the_rule_with_enough_hours_in_the_period', () => {
  // Arrange
  const luis = persona({
    nombre: 'Luis Prueba',
    docencia: [{ materia: 'IA generativa', horas: 160, desde: 2024, hasta: 2026, evidencia: 'CV, pág. 3' }],
  });

  // Act
  const [regla] = reglasDe(luis, { ...analizarRequisito(DOCENTE), titulacion: null }, ANIO);

  // Assert
  assert.equal(regla?.regla, 'docencia');
  assert.equal(regla?.resultado, 'cumple');
});

test('should_say_how_many_hours_are_missing_when_they_do_not_reach', () => {
  const marta = persona({
    nombre: 'Marta Prueba',
    docencia: [
      { materia: 'Power BI', horas: 180, desde: 2023, hasta: 2026 },
      { materia: 'Inteligencia artificial', horas: 90, desde: 2025, hasta: 2026 },
    ],
  });
  const regla = reglasDe(marta, analizarRequisito(DOCENTE), ANIO).find((r) => r.regla === 'docencia');
  assert.equal(regla?.resultado, 'no_cumple');
  assert.match(regla?.detalle ?? '', /90 de 150 h/);
});

test('should_not_fail_someone_whose_profile_has_no_teaching_data', () => {
  const sinDato = persona({ nombre: 'Sin Dato', titulaciones: ['Grado en Informática'] });
  assert.equal(
    reglasDe(sinDato, analizarRequisito(DOCENTE), ANIO).find((r) => r.regla === 'docencia')?.resultado,
    'desconocido',
  );
});

test('should_fail_someone_who_teaches_only_other_subjects', () => {
  const ana = persona({
    nombre: 'Ana Prueba',
    docencia: [{ materia: 'competencias digitales', horas: 320, desde: 2023, hasta: 2026 }],
  });
  const regla = reglasDe(ana, analizarRequisito(DOCENTE), ANIO).find((r) => r.regla === 'docencia');
  assert.equal(regla?.resultado, 'no_cumple');
  assert.match(regla?.detalle ?? '', /Sin docencia en inteligencia artificial/);
});

test('should_leave_partly_when_hours_may_fall_outside_the_period', () => {
  const larga = persona({
    nombre: 'Larga Prueba',
    docencia: [{ materia: 'machine learning', horas: 400, desde: 2015, hasta: 2026 }],
  });
  const regla = reglasDe(larga, analizarRequisito(DOCENTE), ANIO).find((r) => r.regla === 'docencia');
  assert.equal(regla?.resultado, 'parcial', 'machine learning acredita IA, pero empezó antes del periodo');
  const vieja = persona({
    nombre: 'Vieja Prueba',
    docencia: [{ materia: 'IA', horas: 400, desde: 2015, hasta: 2019 }],
  });
  assert.equal(
    reglasDe(vieja, analizarRequisito(DOCENTE), ANIO).find((r) => r.regla === 'docencia')?.resultado,
    'no_cumple',
  );
});

test('should_count_taught_subjects_as_evidence_of_the_subject', () => {
  const p = persona({ nombre: 'Tutora Prueba', docencia: [{ materia: 'topografía urbana', horas: 40 }] });
  const [materia] = materiasExigidas('Tutor con experiencia en topografía');
  assert.ok(materia);
  assert.equal(evidenciaDeMateria(p, materia), 'docencia: topografía urbana');
});

test('should_reject_a_teaching_period_that_ends_before_it_starts', () => {
  assert.equal(
    Persona.safeParse({
      nombre: 'Mal Prueba',
      tipo: 'interno',
      docencia: [{ materia: 'IA', horas: 10, desde: 2026, hasta: 2024 }],
    }).success,
    false,
  );
});

test('should_put_who_meets_the_hours_first_and_flag_the_rest', () => {
  const luis = persona({
    nombre: 'Luis Prueba',
    tipo: 'externo',
    titulaciones: ['Grado en Informática'],
    docencia: [{ materia: 'IA', horas: 160, desde: 2024, hasta: 2026 }],
  });
  const marta = persona({
    nombre: 'Marta Prueba',
    tipo: 'externo',
    titulaciones: ['Grado en Matemáticas'],
    docencia: [{ materia: 'IA', horas: 90, desde: 2025, hasta: 2026 }],
  });
  const r = candidatos([marta, luis], { texto: DOCENTE, cpvs: [], cvs: [], anio: ANIO }, 5);
  assert.deepEqual(
    r.externos.map((c) => [c.nombre, c.cumple_minimos]),
    [
      ['Luis Prueba', true],
      ['Marta Prueba', false],
    ],
  );
});
