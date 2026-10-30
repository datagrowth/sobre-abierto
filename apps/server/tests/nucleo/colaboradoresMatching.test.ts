// Matching requisito ↔ colaborador sin IA: lectura del requisito (años, titulación,
// certificaciones, idiomas), cada regla contra el perfil, la afinidad y la puntuación.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PersonaEntrada } from '../../src/nucleo/colaboradores/personas.js';

process.env.NODE_ENV = 'test';

const { Persona } = await import('../../src/nucleo/colaboradores/personas.js');
const { analizarRequisito } = await import('../../src/nucleo/colaboradores/requisito.js');
const { candidatos, evaluarPersona } = await import('../../src/nucleo/colaboradores/matching.js');
const { contieneTermino, normalizar } = await import('../../src/nucleo/colaboradores/texto.js');
const { evidenciaDeMateria, materiasExigidas } = await import('../../src/nucleo/colaboradores/materias.js');

type Entrada = PersonaEntrada;
let siguiente = 1;
function persona(datos: Partial<Entrada> & { nombre: string }) {
  return {
    ...Persona.parse({ tipo: 'interno', ...datos }),
    id: siguiente++,
    creada_en: '2026-01-01T00:00:00.000Z',
    actualizada_en: '2026-01-01T00:00:00.000Z',
  };
}

const JEFE =
  'Jefe de proyecto con titulación universitaria en Informática o Telecomunicaciones, experiencia mínima de 5 años en proyectos de analítica, certificación PMP y nivel de inglés B2.';

const ANA = persona({
  nombre: 'Ana Prueba',
  rol: 'Jefe de proyecto',
  titulaciones: ['Grado en Ingeniería Informática', 'Máster en Big Data'],
  certificaciones: ['PMP', 'Scrum Master (PSM I)'],
  anios_experiencia: 9,
  tecnologias: ['Python', 'Power BI'],
  idiomas: [{ idioma: 'Inglés', nivel: 'C1' }],
  cpv: ['72316000'],
  cv_ruta: 'Colaboradores/cv-ana.pdf',
});
const BEA = persona({
  nombre: 'Bea Prueba',
  tipo: 'externo',
  rol: 'Consultora BI',
  titulaciones: ['Licenciatura en Economía'],
  certificaciones: ['ITIL v4'],
  anios_experiencia: 3,
  tecnologias: ['Power BI'],
  idiomas: [{ idioma: 'inglés', nivel: 'B1' }],
});
const CARLOS = persona({ nombre: 'Carlos Prueba', rol: 'Analista', tecnologias: ['SQL'] });

test('should_read_minimum_years_degree_certifications_and_languages_from_a_requirement', () => {
  const r = analizarRequisito(JEFE);
  assert.equal(r.anios_minimos, 5);
  assert.equal(r.titulacion?.nombre, 'titulación universitaria');
  assert.deepEqual(r.titulacion?.campos, ['informática', 'telecomunicaciones']);
  assert.deepEqual(r.certificaciones, ['PMP']);
  assert.deepEqual(r.idiomas, [{ idioma: 'inglés', nivel: 'B2' }]);
});

test('should_not_take_contract_duration_as_experience_nor_cloud_names_as_certifications', () => {
  const r = analizarRequisito('Consultor con conocimientos de AWS y Azure para un contrato de 2 años.');
  assert.equal(r.anios_minimos, null);
  assert.deepEqual(r.certificaciones, []);
  assert.deepEqual(analizarRequisito('Arquitecto cloud con certificación AWS o Azure').certificaciones, [
    'AWS',
    'Azure',
  ]);
});

test('should_take_the_lowest_accepted_degree_and_native_language_levels', () => {
  const r = analizarRequisito('Grado o máster en estadística; catalán nativo');
  assert.equal(r.titulacion?.nivel, 2);
  assert.deepEqual(r.idiomas, [{ idioma: 'catalán', nivel: 'nativo' }]);
});

test('should_return_empty_analysis_for_an_empty_or_vague_requirement', () => {
  assert.deepEqual(analizarRequisito(''), {
    anios_minimos: null,
    titulacion: null,
    certificaciones: [],
    idiomas: [],
    materias: [],
    docencia: null,
  });
  assert.deepEqual(analizarRequisito('Personal suficiente').certificaciones, []);
});

test('should_check_each_rule_against_the_profile', () => {
  const ana = evaluarPersona(ANA, analizarRequisito(JEFE), { texto: JEFE, cpvs: [], cvs: [] });
  assert.ok(
    ana.reglas.every((r) => r.resultado === 'cumple'),
    JSON.stringify(ana.reglas),
  );
  assert.equal(ana.cumple_minimos, true);
  const bea = evaluarPersona(BEA, analizarRequisito(JEFE), { texto: JEFE, cpvs: [], cvs: [] });
  const por = Object.fromEntries(bea.reglas.map((r) => [r.regla, r.resultado]));
  assert.deepEqual(por, { anios: 'no_cumple', titulacion: 'parcial', certificacion: 'no_cumple', idioma: 'no_cumple' });
  assert.equal(bea.cumple_minimos, false);
});

test('should_treat_missing_profile_data_as_unknown_not_as_failure', () => {
  const c = evaluarPersona(CARLOS, analizarRequisito(JEFE), { texto: JEFE, cpvs: [], cvs: [] });
  assert.ok(c.reglas.every((r) => r.resultado === 'desconocido'));
  assert.equal(c.cumple_minimos, true);
  assert.equal(c.coincidencias, 0);
});

test('should_score_rules_and_affinity_and_rank_who_meets_the_minimums_first', () => {
  const r = candidatos([BEA, CARLOS, ANA], { texto: JEFE, cpvs: ['72310000'], cvs: ['Colaboradores/cv-ana.pdf'] }, 5);
  assert.equal(r.internos[0]?.nombre, 'Ana Prueba');
  // 70 (todas las reglas) + 5 (cita su rol) + 5 (misma clase CPV) + 10 (primer CV de la búsqueda).
  assert.equal(r.internos[0]?.puntuacion, 90);
  assert.ok(r.internos[0]?.afinidad.some((m) => /CPV/.test(m)));
  assert.ok(r.internos[0]?.afinidad.some((m) => /búsqueda por significado/.test(m)));
  assert.equal(r.internos.length, 1, 'quien no casa en nada no es candidato');
  assert.deepEqual(
    r.externos.map((c) => c.nombre),
    ['Bea Prueba'],
  );
});

test('should_lower_the_score_of_unavailable_people_and_skip_inactive_ones', () => {
  const ocupada = { ...ANA, id: 90 };
  const inactiva = { ...ANA, id: 91, activo: false };
  const disponibilidad = new Map([
    [90, { estado: 'no_disponible' as const, motivo: 'En ejecución: calidad del aire', hasta: '2026-11-15' }],
  ]);
  const r = candidatos([ocupada, inactiva], { texto: JEFE, cpvs: [], cvs: [], disponibilidad }, 5);
  assert.equal(r.internos.length, 1);
  assert.equal(r.internos[0]?.id, 90);
  assert.equal(r.internos[0]?.disponibilidad, 'no_disponible');
  assert.ok((r.internos[0]?.puntuacion ?? 100) <= 50);
  assert.ok(r.internos[0]?.afinidad.includes('No disponible ahora: En ejecución: calidad del aire'));
});

test('should_rank_by_affinity_alone_when_the_requirement_has_no_checkable_rules', () => {
  const texto = 'Perfil con experiencia en Power BI y SQL';
  const r = candidatos([ANA, BEA, CARLOS], { texto, cpvs: [], cvs: [] }, 1);
  assert.equal(r.internos.length, 1, 'respeta el límite por tipo');
  assert.equal(r.externos[0]?.nombre, 'Bea Prueba');
  assert.ok((r.internos[0]?.puntuacion ?? 0) > 0);
});

test('should_match_terms_as_whole_words_without_accents', () => {
  assert.equal(normalizar('  Titulación  en INFORMÁTICA '), 'titulacion en informatica');
  assert.equal(contieneTermino('experiencia en c++ y .net', 'c++'), true);
  assert.equal(contieneTermino('experiencia en c++ y .net', '.net'), true);
  assert.equal(contieneTermino('experiencia en rust', 'r'), false);
  assert.equal(contieneTermino('experiencia en power bi', 'power bi'), true);
});

test('should_take_the_experience_years_not_periods_nor_the_upper_bound_of_a_range', () => {
  const texto =
    'Jefe de proyecto con experiencia mínima de 5 años en proyectos similares ejecutados en los últimos 10 años';
  assert.equal(analizarRequisito(texto).anios_minimos, 5);
  assert.equal(analizarRequisito('Analista con 3-5 años de experiencia').anios_minimos, 3);
  assert.equal(analizarRequisito('Analista con entre 3 y 5 años de experiencia').anios_minimos, 3);
  assert.equal(analizarRequisito('Experiencia de 3 años. Duración del contrato: 4 años').anios_minimos, 3);
  const veterano = persona({ nombre: 'Vera Prueba', anios_experiencia: 8 });
  const v = evaluarPersona(veterano, analizarRequisito(texto), { texto, cpvs: [], cvs: [] });
  assert.equal(v.cumple_minimos, true);
  assert.deepEqual(
    v.reglas.map((r) => r.resultado),
    ['cumple'],
  );
});

test('should_not_read_institutions_or_job_titles_as_required_languages_or_certifications', () => {
  assert.deepEqual(analizarRequisito('Consultor con experiencia en proyectos para el Gobierno Vasco').idiomas, []);
  assert.deepEqual(analizarRequisito('Analista para el Servicio Gallego de Salud').idiomas, []);
  assert.deepEqual(analizarRequisito('Técnico con euskera nivel B2').idiomas, [{ idioma: 'euskera', nivel: 'B2' }]);
  assert.deepEqual(analizarRequisito('Se valorarán conocimientos de valenciano').idiomas, [
    { idioma: 'catalán', nivel: null },
  ]);
  assert.deepEqual(analizarRequisito('Product Owner con 3 años de experiencia').certificaciones, []);
  assert.deepEqual(analizarRequisito('Scrum Master con certificación oficial').certificaciones, ['Scrum']);
  assert.deepEqual(analizarRequisito('Responsable con PSPO o PSM').certificaciones, ['Scrum']);
  const conPmp = persona({
    nombre: 'Paco Prueba',
    certificaciones: ['PMP'],
    idiomas: [{ idioma: 'Inglés', nivel: 'C1' }],
  });
  const texto = 'Product Owner con experiencia en proyectos para el Gobierno Vasco';
  assert.equal(evaluarPersona(conPmp, analizarRequisito(texto), { texto, cpvs: [], cvs: [] }).cumple_minimos, true);
});

test('should_read_the_language_level_written_right_before_the_language', () => {
  assert.deepEqual(analizarRequisito('Analista con nivel C1 de inglés').idiomas, [{ idioma: 'inglés', nivel: 'C1' }]);
  assert.deepEqual(analizarRequisito('Nivel C1 de inglés y francés B1').idiomas, [
    { idioma: 'inglés', nivel: 'C1' },
    { idioma: 'francés', nivel: 'B1' },
  ]);
  const a2 = persona({ nombre: 'Alba Prueba', idiomas: [{ idioma: 'Inglés', nivel: 'A2' }] });
  const texto = 'Analista con nivel C1 de inglés';
  assert.equal(
    evaluarPersona(a2, analizarRequisito(texto), { texto, cpvs: [], cvs: [] }).reglas[0]?.resultado,
    'no_cumple',
  );
});

test('should_not_read_the_company_or_a_right_as_a_degree_field', () => {
  assert.deepEqual(
    analizarRequisito('Titulado universitario. Tendrá derecho a dietas. 3 años de experiencia').titulacion?.campos,
    [],
  );
  assert.deepEqual(
    analizarRequisito('Técnico de la empresa adjudicataria con titulación universitaria en informática').titulacion
      ?.campos,
    ['informática'],
  );
  assert.deepEqual(analizarRequisito('Licenciatura en Derecho con solvencia económica acreditada').titulacion?.campos, [
    'derecho',
  ]);
  assert.deepEqual(analizarRequisito('Grado en ADE o Economía').titulacion?.campos, ['economía o empresa']);
});

// Requisitos que el código dio por cumplidos con los años totales.
const CASO_F_DIRECTOR =
  'Director/a técnico/a: titulación universitaria y ≥5 años en auditoría de accesibilidad web o evaluación de usabilidad.';
const CASO_C_TUTORES =
  'Cada tutor debe cumplir título o experiencia mínima: comunicación institucional 1 año, administración electrónica 1, análisis de datos 1, topografía 1, jardinería/arbolado 2; además 30 h de formación teleformación/TIC o 60 h de impartición online.';
const CASO_E_DOCENTE =
  'Un docente principal por lote con grado universitario, ciclo superior o equivalente afín y formación o certificación comprobable relacionada con el curso; indicarlo en la memoria y adjuntar títulos, certificados y currículum firmado.';

test('should_read_the_specific_subject_a_staff_requirement_asks_for', () => {
  assert.deepEqual(materiasExigidas(CASO_F_DIRECTOR), [
    {
      texto: 'auditoria de accesibilidad web o evaluacion de usabilidad',
      alternativas: ['auditoria de accesibilidad web', 'evaluacion de usabilidad'],
    },
  ]);
  assert.deepEqual(materiasExigidas('≥3 años en pruebas de usabilidad/analítica web')[0]?.alternativas, [
    'pruebas de usabilidad',
    'analitica web',
  ]);
  assert.deepEqual(
    materiasExigidas(CASO_C_TUTORES).map((m) => m.texto),
    [
      'comunicacion institucional',
      'administracion electronica',
      'analisis de datos',
      'topografia',
      'jardineria/arbolado',
      'teleformacion/tic o 60 h de imparticion online',
    ],
  );
  assert.deepEqual(
    materiasExigidas(CASO_C_TUTORES).at(-1)?.alternativas,
    ['teleformacion', 'tic', 'imparticion online'],
    'las 30 h o las 60 h: basta una',
  );
  assert.deepEqual(
    materiasExigidas(CASO_E_DOCENTE),
    [{ texto: 'relacionada con el curso', alternativas: [] }],
    'no la nombra: no se puede comprobar',
  );
  assert.deepEqual(
    materiasExigidas('Docente con formación específica en hojas de cálculo avanzadas')[0]?.alternativas,
    ['hojas de calculo avanzadas'],
  );
  assert.deepEqual(
    materiasExigidas('Analista con 3 años de experiencia en Python y Power BI').map((m) => m.texto),
    ['python', 'power bi'],
    'hacen falta las dos',
  );
  assert.deepEqual(materiasExigidas('Experiencia mínima de 2 años en proyectos similares'), [
    { texto: 'proyectos similares', alternativas: [] },
  ]);
});

test('should_not_read_a_subject_when_the_requirement_only_asks_for_years_or_degree', () => {
  for (const t of [
    '',
    'Jefe de proyecto con titulación universitaria y 5 años de experiencia',
    JEFE.replace(' en proyectos de analítica', ''),
    'Personal suficiente para impartir la formación',
  ]) {
    assert.deepEqual(materiasExigidas(t), [], t);
  }
});

test('should_accredit_a_subject_only_with_what_the_person_has_registered', () => {
  const [medios] = materiasExigidas(CASO_F_DIRECTOR);
  const olga = persona({
    nombre: 'Olga Prueba',
    rol: 'Social media',
    anios_experiencia: 12,
    titulaciones: ['Grado en Periodismo'],
    sectores: ['atención al público', 'web propia'],
  });
  const lucia = persona({
    nombre: 'Lucía Prueba',
    anios_experiencia: 6,
    sectores: ['Auditoría de accesibilidad web y usabilidad'],
  });
  assert.equal(
    evidenciaDeMateria(olga, medios!),
    null,
    'doce años y «web propia» no son auditoría de accesibilidad web',
  );
  assert.equal(evidenciaDeMateria(lucia, medios!), 'sectores: Auditoría de accesibilidad web y usabilidad');
  const [usabilidad] = materiasExigidas('3 años en pruebas de usabilidad');
  assert.equal(
    evidenciaDeMateria(
      persona({ nombre: 'Raúl Prueba', tecnologias: ['Prueba de usabilidad (moderada)'] }),
      usabilidad!,
    ),
    'tecnologias: Prueba de usabilidad (moderada)',
  );
  const [curso] = materiasExigidas(CASO_E_DOCENTE);
  assert.equal(
    evidenciaDeMateria(persona({ nombre: 'Marta Prueba', certificaciones: ['hojas de cálculo avanzadas'] }), curso!),
    null,
    'sin materia nombrada nadie la acredita',
  );
  const c = evaluarPersona(olga, analizarRequisito(CASO_F_DIRECTOR), { texto: CASO_F_DIRECTOR, cpvs: [], cvs: [] });
  assert.equal(c.cumple_minimos, true, 'los años y el título sí los cumple');
  assert.deepEqual(c.materias, [
    { materia: 'auditoria de accesibilidad web o evaluacion de usabilidad', evidencia: null },
  ]);
});

test('should_match_a_subject_by_whole_word_or_plural_and_not_by_stem', () => {
  const casa = (valor: string, requisito: string) =>
    evidenciaDeMateria(persona({ nombre: 'Prueba', sectores: [valor] }), materiasExigidas(requisito)[0]!);
  assert.equal(casa('Analista de datos', '3 años de experiencia en análisis'), null, 'análisis no es analista');
  assert.equal(casa('Gestionar equipos', '3 años en gestión'), null, 'gestión no es gestionar');
  assert.equal(
    casa('Medio ambiente', '3 años en medios'),
    null,
    'una materia de una palabra casa en el mismo número: medios no es medio ambiente',
  );
  assert.equal(casa('Medios de comunicación', '3 años en medios'), 'sectores: Medios de comunicación');
  assert.equal(casa('Medios de comunicación', '3 años en medioambiente'), null, 'palabras distintas');
  assert.equal(casa('Prueba de usabilidad', '3 años en pruebas de usabilidad'), 'sectores: Prueba de usabilidad');
});

test('should_require_every_subject_of_a_comma_list', () => {
  const t = 'Experiencia en auditoría de accesibilidad web, pruebas de usabilidad y diseño inclusivo';
  assert.deepEqual(
    materiasExigidas(t).map((m) => m.texto),
    ['auditoria de accesibilidad web', 'pruebas de usabilidad', 'diseno inclusivo'],
  );
  const soloLaPrimera = persona({ nombre: 'Prueba', sectores: ['Auditoría de accesibilidad web'] });
  assert.equal(
    materiasExigidas(t).filter((m) => evidenciaDeMateria(soloLaPrimera, m)).length,
    1,
    'no acredita las tres',
  );
});

test('should_not_require_a_partial_subject_when_the_comma_list_is_ambiguous', () => {
  const alt = materiasExigidas(
    'Experiencia en auditoría de accesibilidad web, pruebas de usabilidad o diseño inclusivo',
  );
  assert.deepEqual(alt, [
    { texto: 'auditoria de accesibilidad web, pruebas de usabilidad o diseno inclusivo', alternativas: [] },
  ]);
  const [cola] = materiasExigidas('Experiencia en gestión de proyectos, aunque se valorará la de más de cinco años');
  assert.deepEqual(cola?.alternativas, [], 'no se exige una parte');
});

test('should_read_a_single_capital_letter_as_a_subject', () => {
  const [r] = materiasExigidas('Experiencia en R y Python');
  assert.deepEqual(r?.alternativas, ['R']);
  assert.deepEqual(
    materiasExigidas('3 años de experiencia en R y Python').map((m) => m.alternativas[0]),
    ['R', 'python'],
  );
  assert.equal(evidenciaDeMateria(persona({ nombre: 'Prueba', tecnologias: ['R'] }), r!), 'tecnologias: R');
  assert.equal(evidenciaDeMateria(persona({ nombre: 'Prueba', tecnologias: ['Rust'] }), r!), null);
});

test('should_match_ai_with_its_synonyms_and_ai_certifications', () => {
  const [ia] = materiasExigidas('Experiencia en IA');
  const tiene = (campo: 'sectores' | 'tecnologias' | 'certificaciones' | 'titulaciones', valor: string) =>
    evidenciaDeMateria(persona({ nombre: 'Prueba', [campo]: [valor] }), ia!);
  assert.equal(tiene('sectores', 'inteligencia artificial'), 'sectores: inteligencia artificial');
  assert.equal(
    tiene('titulaciones', 'Máster en Inteligencia Artificial'),
    'titulaciones: Máster en Inteligencia Artificial',
  );
  assert.equal(tiene('tecnologias', 'Machine Learning'), 'tecnologias: Machine Learning');
  assert.equal(tiene('tecnologias', 'Deep Learning'), 'tecnologias: Deep Learning');
  assert.equal(
    tiene('certificaciones', 'AI-900: Microsoft Azure AI Fundamentals'),
    'certificaciones: AI-900: Microsoft Azure AI Fundamentals',
  );
  assert.equal(tiene('certificaciones', 'AI-102'), 'certificaciones: AI-102');
  assert.equal(
    tiene('certificaciones', 'Aplicación Práctica de la IA'),
    'certificaciones: Aplicación Práctica de la IA',
  );
  assert.equal(tiene('tecnologias', 'Python'), null);
});

test('should_not_take_ai_as_machine_learning_nor_join_doubtful_terms', () => {
  const [ml] = materiasExigidas('Experiencia en machine learning');
  const [td] = materiasExigidas('Experiencia en transformación digital');
  assert.equal(
    evidenciaDeMateria(persona({ nombre: 'Prueba', sectores: ['inteligencia artificial'] }), ml!),
    null,
    'la IA no es por fuerza aprendizaje automático',
  );
  assert.equal(
    evidenciaDeMateria(persona({ nombre: 'Prueba', tecnologias: ['aprendizaje automático'] }), ml!),
    'tecnologias: aprendizaje automático',
  );
  assert.equal(evidenciaDeMateria(persona({ nombre: 'Prueba', sectores: ['digitalización'] }), td!), null);
});

test('should_take_the_application_field_of_a_technique_as_part_of_it', () => {
  const [iaAdm] = materiasExigidas('Experiencia en IA administrativa');
  const [gestAdm] = materiasExigidas('Experiencia en gestión administrativa');
  const [bi] = materiasExigidas('Experiencia en BI aplicado');
  assert.equal(
    evidenciaDeMateria(persona({ nombre: 'Prueba', certificaciones: ['AI-900'] }), iaAdm!),
    'certificaciones: AI-900',
  );
  assert.equal(
    evidenciaDeMateria(persona({ nombre: 'Prueba', tecnologias: ['Business Intelligence'] }), bi!),
    'tecnologias: Business Intelligence',
  );
  assert.equal(
    evidenciaDeMateria(persona({ nombre: 'Prueba', sectores: ['gestión'] }), gestAdm!),
    null,
    'fuera de una técnica, el ámbito se exige',
  );
});

test('should_count_the_accredited_subject_as_a_match_and_as_score', () => {
  const req = 'Docente con formación específica en hojas de cálculo avanzadas';
  const marta = persona({ nombre: 'Marta Prueba', certificaciones: ['hojas de cálculo avanzadas'] });
  const c = evaluarPersona(marta, analizarRequisito(req), { texto: req, cpvs: [], cvs: [] });
  assert.equal(c.coincidencias, 1);
  assert.ok(c.puntuacion > 0);
  const lista = candidatos([marta], { texto: req, cpvs: [], cvs: [] }, 5);
  assert.deepEqual(
    lista.internos.map((x) => x.nombre),
    ['Marta Prueba'],
  );
});

test('should_flag_a_result_as_trimmed_only_when_the_limit_dropped_candidates', () => {
  const req = 'Analista con 3 años de experiencia';
  const equipo = ['A', 'B', 'C'].map((n) => persona({ nombre: `${n} Prueba`, anios_experiencia: 5 }));
  assert.equal(candidatos(equipo, { texto: req, cpvs: [], cvs: [] }, 2).recortado, true);
  assert.equal(candidatos(equipo, { texto: req, cpvs: [], cvs: [] }, 3).recortado, false);
});

test('should_read_the_same_subjects_from_an_all_caps_tender_as_from_a_lowercase_one', () => {
  const textos = [
    'Experiencia en auditoría de accesibilidad web o evaluación de usabilidad',
    'Experiencia en auditoría de accesibilidad web y pruebas de usabilidad',
    'Experiencia en investigación e innovación',
    'Experiencia en formación y empleo',
  ];
  for (const t of textos) {
    const bajas = materiasExigidas(t);
    assert.ok(bajas.length > 0, t);
    for (const variante of [
      t.toUpperCase(),
      t
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
    ])
      assert.deepEqual(materiasExigidas(variante), bajas, variante);
  }
  assert.equal(
    materiasExigidas('EXPERIENCIA EN AUDITORÍA DE ACCESIBILIDAD WEB O EVALUACIÓN DE USABILIDAD')[0]?.alternativas
      .length,
    2,
  );
  assert.deepEqual(
    materiasExigidas('Experiencia en R y Python').map((m) => m.texto),
    ['R', 'python'],
    'una R suelta en texto normal sigue siendo el lenguaje',
  );
});

test('should_read_a_comma_list_without_the_asides_that_qualify_the_subject', () => {
  const textos = (t: string) => materiasExigidas(t).map((m) => m.texto);
  assert.deepEqual(textos('Experiencia en gestión de proyectos, impartida por tutores'), ['gestion de proyectos']);
  assert.deepEqual(textos('Experiencia en comunicación institucional, al menos 3 años'), [
    'comunicacion institucional',
  ]);
  assert.deepEqual(textos('Experiencia en comunicación, preferentemente en el sector público'), ['comunicacion']);
  assert.deepEqual(textos('Experiencia en atención al público, en particular videollamada'), ['atencion al publico']);
  assert.deepEqual(textos('Experiencia en personas mayores, dependientes y personas con discapacidad'), [
    'personas mayores',
    'dependientes',
    'personas con discapacidad',
  ]);
});

test('should_match_single_word_subjects_in_singular_and_plural_except_known_compounds', () => {
  const casa = (valor: string, requisito: string) =>
    evidenciaDeMateria(persona({ nombre: 'Prueba', sectores: [valor] }), materiasExigidas(requisito)[0]!);
  assert.ok(casa('Auditoría', 'experiencia en auditorías'));
  assert.ok(casa('Encuesta', '3 años en encuestas'));
  assert.ok(casa('Dron', '3 años en drones'));
  assert.ok(casa('Evento corporativo', '3 años en eventos'));
  assert.equal(casa('Medio ambiente', '3 años en medios'), null);
  assert.equal(casa('Medio rural', '3 años en medios'), null);
});

test('should_decide_all_caps_with_the_whole_text_and_not_the_neighbour_word', () => {
  assert.deepEqual(
    materiasExigidas('Experiencia en SQL, R y Python').map((m) => m.texto),
    ['SQL', 'R', 'python'].map((x) => (x === 'SQL' ? 'sql' : x)),
  );
  assert.equal(
    materiasExigidas('EXPERIENCIA EN AUDITORÍA DE ACCESIBILIDAD WEB O EVALUACIÓN DE USABILIDAD')[0]?.alternativas
      .length,
    2,
  );
  assert.deepEqual(
    materiasExigidas('Experiencia en Formación Y Empleo').map((m) => m.texto),
    materiasExigidas('Experiencia en formación y empleo').map((m) => m.texto),
  );
});

test('should_cut_at_con_after_people_only_when_it_opens_another_condition', () => {
  const textos = (t: string) => materiasExigidas(t).map((m) => m.texto);
  assert.deepEqual(textos('Experiencia en atención a personas mayores con titulación de grado'), [
    'atencion a personas mayores',
  ]);
  assert.deepEqual(textos('Experiencia en atención a personas con discapacidad'), [
    'atencion a personas con discapacidad',
  ]);
  assert.deepEqual(textos('Experiencia en gestión de contenidos por canales digitales'), [
    'gestion de contenidos por canales digitales',
  ]);
  assert.deepEqual(textos('Experiencia en gestión de proyectos, financiados por la UE'), ['gestion de proyectos']);
});
