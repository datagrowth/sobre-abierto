import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  docenciaDesdeTexto,
  formularioAPersona,
  idiomasATexto,
  idiomasDesdeTexto,
  lineas,
  normalizarLinkedin,
  personaAFormulario,
  resumenDocencia,
  textoRequisito,
} from './colaboradoresFormulario.js';

test('should_read_languages_with_and_without_level', () => {
  assert.deepEqual(idiomasDesdeTexto('Inglés C1, francés,\nalemán nativa'), [
    { idioma: 'Inglés', nivel: 'C1' },
    { idioma: 'francés', nivel: null },
    { idioma: 'alemán', nivel: 'nativo' },
  ]);
  assert.equal(
    idiomasATexto([
      { idioma: 'Inglés', nivel: 'B2' },
      { idioma: 'Gallego', nivel: null },
    ]),
    'Inglés B2, Gallego',
  );
  assert.deepEqual(idiomasDesdeTexto(''), []);
});

test('should_keep_commas_inside_degrees_one_per_line', () => {
  assert.deepEqual(lineas('Grado en Ingeniería, mención en Computación\n\n Máster en Big Data '), [
    'Grado en Ingeniería, mención en Computación',
    'Máster en Big Data',
  ]);
});

test('should_start_an_empty_form_as_an_active_team_member_without_declared_availability', () => {
  const f = personaAFormulario(null);
  assert.equal(f.tipo, 'interno');
  assert.equal('disponibilidad' in f, false, 'la disponibilidad se calcula: no se declara');
  assert.equal(f.docencia, '');
  assert.equal(f.activo, true);
  assert.equal(f.anios_experiencia, '');
});

test('should_round_trip_a_collaborator_through_the_form', () => {
  const p = {
    nombre: 'Ana Prueba',
    tipo: 'externo',
    rol: 'Jefa de proyecto',
    titulaciones: ['Grado en Matemáticas, mención en Estadística'],
    certificaciones: ['PMP', 'ITIL'],
    anios_experiencia: 9,
    sectores: ['sanidad'],
    cpv: ['72', '7331'],
    tecnologias: ['Python', 'Power BI'],
    idiomas: [{ idioma: 'Inglés', nivel: 'C1' }],
    docencia: [
      { materia: 'IA', horas: 160, desde: 2024, hasta: 2026, evidencia: 'CV, pág. 3' },
      { materia: 'Power BI', horas: 40, desde: null, hasta: null, evidencia: null },
    ],
    tarifa_hora: 55,
    cv_ruta: 'Colaboradores/cv-ana.pdf',
    notas: '',
    activo: true,
    linkedin: 'https://www.linkedin.com/in/ana-prueba',
  };
  const { persona, errores } = formularioAPersona(personaAFormulario(p));
  assert.deepEqual(errores, []);
  assert.deepEqual(persona, p);
});

test('should_flag_bad_numbers_short_names_and_bad_cpv_before_sending', () => {
  const f = { ...personaAFormulario(null), nombre: 'A', anios_experiencia: '3,5', tarifa_hora: 'mucho', cpv: '72, 7x' };
  const { persona, errores } = formularioAPersona(f);
  assert.equal(errores.length, 4);
  assert.equal(persona.cv_ruta, null);
});

test('should_read_teaching_lines_with_hours_years_and_evidence', () => {
  const { docencia, errores } = docenciaDesdeTexto(
    'IA generativa · 160 h · 2024-2026 · CV, pág. 3\nExcel · 20 horas · 2025\nsin horas · 2024',
  );
  assert.deepEqual(docencia, [
    { materia: 'IA generativa', horas: 160, desde: 2024, hasta: 2026, evidencia: 'CV, pág. 3' },
    { materia: 'Excel', horas: 20, desde: 2025, hasta: 2025, evidencia: null },
  ]);
  assert.equal(errores.length, 1);
  assert.match(errores[0], /sin horas/);
  assert.deepEqual(docenciaDesdeTexto(''), { docencia: [], errores: [] });
  assert.equal(resumenDocencia(docencia), 'IA generativa 160 h · Excel 20 h');
});

test('should_describe_what_was_understood_from_a_requirement', () => {
  const r = {
    anios_minimos: 5,
    titulacion: { nombre: 'titulación universitaria', campos: ['informática'] },
    certificaciones: ['PMP'],
    idiomas: [{ idioma: 'inglés', nivel: 'B2' }],
  };
  assert.equal(
    textoRequisito(r),
    '≥ 5 años de experiencia · titulación universitaria en informática · PMP · inglés B2',
  );
  assert.match(textoRequisito({ anios_minimos: null, titulacion: null, certificaciones: [], idiomas: [] }), /afinidad/);
  assert.equal(
    textoRequisito({
      anios_minimos: null,
      titulacion: null,
      certificaciones: [],
      idiomas: [],
      docencia: { horas: 150, materia: { texto: 'ia' }, anios: 3 },
    }),
    '≥ 150 h de docencia en ia (3 años)',
  );
});

test('should_show_what_a_cv_changes_for_someone_who_already_exists', async () => {
  const { diferenciasPersona } = await import('./colaboradoresFormulario.js');
  const previa = {
    nombre: 'Ana',
    rol: 'Analista',
    titulaciones: ['Grado en Matemáticas'],
    anios_experiencia: 3,
    idiomas: [],
  };
  assert.deepEqual(diferenciasPersona(previa, { ...previa, rol: 'Data Engineer', anios_experiencia: 4 }), [
    { campo: 'Rol', antes: 'Analista', despues: 'Data Engineer' },
    { campo: 'Años de experiencia', antes: '3', despues: '4' },
  ]);
  assert.deepEqual(diferenciasPersona(null, previa), [], 'persona nueva: no hay antes');
});

test('should_keep_only_public_linkedin_profiles_written_the_same_way', () => {
  assert.equal(normalizarLinkedin('es.linkedin.com/in/ana-perez/?trk=public'), 'https://www.linkedin.com/in/ana-perez');
  assert.equal(normalizarLinkedin('https://www.linkedin.com/in/ana-perez/'), 'https://www.linkedin.com/in/ana-perez');
  assert.equal(normalizarLinkedin('linkedin.com/company/analitica-ejemplo'), null, 'una empresa no es un perfil');
  assert.equal(normalizarLinkedin('https://evil.com/linkedin.com/in/x'), null);
  const vacio = personaAFormulario(null);
  assert.equal(
    formularioAPersona({ ...vacio, nombre: 'Ana', linkedin: 'www.linkedin.com/in/ana' }).persona.linkedin,
    'https://www.linkedin.com/in/ana',
  );
  assert.equal(formularioAPersona({ ...vacio, nombre: 'Ana', linkedin: '' }).persona.linkedin, null);
  assert.match(formularioAPersona({ ...vacio, nombre: 'Ana', linkedin: 'ana perez' }).errores.join(), /LinkedIn/);
});
