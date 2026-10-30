// Verificación de la ficha por código: con un perfil de empresa completo (volumen, idiomas,
// notas) el código corrige lo que Hermes no comprobó; lo que no puede comprobar lo deja.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verificarRequisitos,
  importeExigido,
  type ContextoVerificacion,
  type RequisitoVerificable,
} from '../../src/dominios/licitaciones/fichaVerificacion.js';
import type { PerfilEmpresaData } from '../../src/nucleo/empresa.js';
import type { RespuestaCandidatos } from '../../src/nucleo/colaboradores/busqueda.js';
import { candidatos as candidatosDe } from '../../src/nucleo/colaboradores/matching.js';
import { Persona, type PersonaData } from '../../src/nucleo/colaboradores/personas.js';
import { EMPRESA_EJEMPLO, VOLUMEN_2024, VOLUMEN_2025 } from '../fixtures/empresaEjemplo.js';

const PERFIL = {
  ...EMPRESA_EJEMPLO,
  clasificaciones: [],
  volumen_negocio: [VOLUMEN_2024, VOLUMEN_2025],
  certificaciones: [],
  seguro_rc: null,
  notas:
    'Sin ISO ni ENS; solo certificaciones individuales de herramientas de datos. Sin seguro de RC contratado. Concurre siempre en solitario.',
  idiomas: ['es', 'en'],
} as unknown as PerfilEmpresaData;

const HOY = new Date('2026-10-05T10:00:00Z');
const sinCandidatos: ContextoVerificacion['candidatos'] = async () => null;
const ctx = (extra: Partial<ContextoVerificacion> = {}): ContextoVerificacion => ({
  perfil: PERFIL,
  hoy: HOY,
  candidatos: sinCandidatos,
  ...extra,
});
const req = (r: Partial<RequisitoVerificable>): RequisitoVerificable => ({
  tipo: 'otro',
  descripcion: 'Requisito',
  excluyente: true,
  cumple: 'dudoso',
  justificacion: 'Según el perfil.',
  ...r,
});

async function uno(r: Partial<RequisitoVerificable>, c = ctx()) {
  const v = await verificarRequisitos([req(r)], c);
  return { cumple: v.requisitos[0]!.cumple, verificacion: v.verificaciones[0] };
}

test('should_not_accept_an_economic_solvency_the_company_does_not_reach', async () => {
  // la ficha leyó 18.642.035 € (el perfil ×100) y dio por cumplido 363.454 €.
  const r = await uno({ tipo: 'solvencia_economica', valor_exigido: '≥ 363.454 € sin IVA', cumple: 'si' });
  assert.equal(r.cumple, 'no');
  assert.equal(r.verificacion?.resultado_ia, 'si');
  assert.match(r.verificacion?.fuente ?? '', /2025: 268\.420,15/);
  assert.equal((await uno({ tipo: 'solvencia_economica', valor_exigido: '≥ 150.000 €' })).cumple, 'si');
});

test('should_not_guess_a_threshold_when_there_is_more_than_one_amount', async () => {
  assert.equal(importeExigido('Lote 1: 1.500.000 €; lote 2: 300.000 €'), null);
  assert.equal(importeExigido('≥ 1,5 veces el valor estimado'), null);
  assert.equal(
    (await uno({ tipo: 'solvencia_economica', valor_exigido: 'Lote 1: 1.500.000 €; lote 2: 300.000 €' })).verificacion,
    undefined,
  );
});

test('should_decide_languages_with_the_team_languages', async () => {
  assert.equal((await uno({ tipo: 'idioma', descripcion: 'Atención y manuales en castellano' })).cumple, 'si');
  assert.equal((await uno({ tipo: 'idioma', descripcion: 'Documentación en inglés' })).cumple, 'si');
  assert.equal(
    (await uno({ tipo: 'idioma', descripcion: 'Personal con perfil lingüístico de euskera', cumple: 'dudoso' })).cumple,
    'no',
  );
  assert.equal(
    (await uno({ tipo: 'idioma', descripcion: 'Jefe de proyecto con inglés C1' })).verificacion,
    undefined,
    'el nivel no se puede comprobar',
  );
});

test('should_accept_one_of_several_alternative_languages', async () => {
  // se descartó por no trabajar en valenciano.
  const caso = {
    tipo: 'idioma',
    excluyente: true,
    cumple: 'no' as const,
    descripcion: 'Documentación en castellano o valenciano; otros idiomas requieren traducción oficial.',
  };
  assert.equal((await uno(caso)).cumple, 'si');
  assert.equal((await uno({ tipo: 'idioma', descripcion: 'Ofertas en euskera o castellano' })).cumple, 'si');
  assert.equal(
    (await uno({ tipo: 'idioma', descripcion: 'Atención en cualquiera de las lenguas oficiales: castellano, gallego' }))
      .cumple,
    'si',
  );
  assert.equal(
    (await uno({ tipo: 'idioma', descripcion: 'Entregables en castellano y euskera', cumple: 'dudoso' })).cumple,
    'no',
    '«y» exige las dos',
  );
});

test('should_decide_certifications_with_the_profile_and_its_notes', async () => {
  assert.equal(
    (
      await uno({
        tipo: 'certificacion',
        descripcion: 'Certificación del Esquema Nacional de Seguridad categoría media',
        cumple: 'dudoso',
      })
    ).cumple,
    'no',
    'las notas dicen «sin ISO ni ENS»',
  );
  const sinNotas = { ...PERFIL, notas: '' } as PerfilEmpresaData;
  assert.equal(
    (await uno({ tipo: 'certificacion', descripcion: 'ISO 27001', cumple: 'si' }, ctx({ perfil: sinNotas }))).cumple,
    'dudoso',
    'el perfil no la lista',
  );
  assert.equal(
    (
      await uno(
        { tipo: 'certificacion', descripcion: 'ISO 9001 o equivalente', cumple: 'dudoso' },
        ctx({ perfil: sinNotas }),
      )
    ).verificacion,
    undefined,
  );
  const conIso = { ...PERFIL, certificaciones: ['ISO/IEC 27001:2022'] } as PerfilEmpresaData;
  assert.equal(
    (await uno({ tipo: 'certificacion', descripcion: 'Certificado ISO 27001 vigente' }, ctx({ perfil: conIso })))
      .cumple,
    'si',
  );
});

test('should_use_the_notes_for_subcontracting_and_joint_ventures', async () => {
  assert.equal(
    (await uno({ tipo: 'subcontratacion', descripcion: 'No se admite la subcontratación', cumple: 'dudoso' })).cumple,
    'si',
  );
  assert.equal(
    (
      await uno({
        tipo: 'subcontratacion',
        descripcion: 'Obligatorio subcontratar al menos un 5 % con centros especiales de empleo',
      })
    ).verificacion,
    undefined,
  );
  assert.equal((await uno({ tipo: 'ute', descripcion: 'Compromiso de constitución de UTE' })).cumple, 'no_aplica');
});

test('should_not_take_for_granted_the_new_company_exception_without_a_quote', async () => {
  const exc = {
    tipo: 'solvencia_tecnica',
    cumple: 'si' as const,
    justificacion: 'Exceptuada por ser empresa de nueva creación (art. 90.4).',
  };
  assert.equal((await uno(exc)).cumple, 'dudoso');
  assert.equal(
    (await uno({ ...exc, documento: 'Anexo I.pdf', pagina: 8 })).verificacion,
    undefined,
    'con cita, vale lo que dijo Hermes',
  );
  const antigua = { ...PERFIL, fecha_constitucion: '2015-01-01' } as PerfilEmpresaData;
  assert.equal((await uno({ ...exc, documento: 'Anexo I.pdf', pagina: 8 }, ctx({ perfil: antigua }))).cumple, 'dudoso');
});

test('should_mark_a_classification_that_is_not_required_and_check_the_one_that_is', async () => {
  assert.equal(
    (await uno({ tipo: 'clasificacion', descripcion: 'Clasificación', valor_exigido: 'No se exige' })).cumple,
    'no_aplica',
  );
  assert.equal(
    (await uno({ tipo: 'clasificacion', descripcion: 'Grupo V, subgrupo 2, categoría 3', cumple: 'dudoso' })).cumple,
    'no',
  );
});

test('should_say_we_have_no_insurance_but_never_more', async () => {
  const r = await uno({
    tipo: 'seguro',
    excluyente: false,
    descripcion: 'Seguro de responsabilidad civil',
    valor_exigido: '300.000 €',
  });
  assert.equal(r.cumple, 'no');
});

test('should_mark_insurance_as_not_applicable_when_the_tender_does_not_require_it', async () => {
  const noProcede = await uno({
    tipo: 'seguro',
    excluyente: false,
    cumple: 'no_aplica',
    descripcion: 'Seguro de responsabilidad civil: el cuadro de características indica que no procede.',
  });
  assert.equal(noProcede.cumple, 'no_aplica');
  assert.equal(
    (await uno({ tipo: 'seguro', excluyente: false, descripcion: 'Seguro de RC', valor_exigido: 'No se exige' }))
      .cumple,
    'no_aplica',
  );
});

test('should_not_discard_for_a_solvency_proven_with_an_insurance_we_can_take_out', async () => {
  // se descartó sola por no tener el seguro de las empresas nuevas.
  const nueva = {
    tipo: 'solvencia_economica',
    excluyente: true,
    cumple: 'no' as const,
    descripcion:
      'Volumen anual de negocios igual o superior al valor estimado medio anual; empresas de nueva creación deben acreditar seguro de RC que cubra posibles incumplimientos contractuales por el importe de la solvencia económica.',
  };
  assert.equal((await uno(nueva)).cumple, 'dudoso');
  const conVolumen = {
    tipo: 'solvencia_economica',
    cumple: 'dudoso' as const,
    descripcion: 'Volumen anual de negocios',
    valor_exigido: '450.000 €',
  };
  assert.equal((await uno(conVolumen)).cumple, 'no', 'sin seguro de por medio, el volumen decide');
});

test('should_leave_insurance_in_doubt_when_it_is_unknown_whether_the_tender_requires_it', async () => {
  const ilegible = {
    tipo: 'seguro',
    excluyente: false,
    descripcion: 'No se ha podido comprobar si se exige seguro de responsabilidad civil ni su cobertura.',
  };
  assert.equal((await uno(ilegible)).verificacion, undefined, 'queda como lo dejó Hermes');
  assert.equal((await uno({ ...ilegible, cumple: 'no' })).cumple, 'no', 'si Hermes dice que se exige, no lo tenemos');
});

function respuesta(cumplen: boolean[], reglas = true): RespuestaCandidatos {
  const candidato = (cumple: boolean, i: number) => ({
    id: i,
    nombre: `P${i}`,
    tipo: 'interno',
    cumple_minimos: cumple,
    puntuacion: 70,
    coincidencias: 1,
    reglas: [],
    afinidad: [],
    materias: [],
  });
  return {
    requisitos: [
      {
        texto: 't',
        requisito: {
          anios_minimos: reglas ? 5 : null,
          titulacion: null,
          certificaciones: [],
          idiomas: [],
          materias: [],
        },
        internos: cumplen.map(candidato),
        externos: [],
      },
    ],
    busqueda_semantica: false,
    aviso: null,
  } as unknown as RespuestaCandidatos;
}

test('should_use_the_collaborators_for_personnel_requirements_only_to_lower_to_doubtful', async () => {
  const jefe = {
    tipo: 'medios_personales',
    descripcion: 'Jefe de proyecto con titulación universitaria y 5 años de experiencia',
  };
  assert.equal(
    (await uno({ ...jefe, cumple: 'si' }, ctx({ candidatos: async () => respuesta([false]) }))).cumple,
    'dudoso',
  );
  assert.equal(
    (await uno({ ...jefe, cumple: 'no' }, ctx({ candidatos: async () => respuesta([true]) }))).cumple,
    'dudoso',
  );
  const cinco = {
    tipo: 'medios_personales',
    descripcion: 'Adscripción de cinco personas distintas con 6 años de experiencia',
    cumple: 'no' as const,
  };
  assert.equal(
    (await uno(cinco, ctx({ candidatos: async () => respuesta([true]) }))).cumple,
    'dudoso',
    'uno que cumple no cubre cinco perfiles',
  );
  assert.equal(
    (await uno(jefe, ctx({ candidatos: async () => respuesta([true], false) }))).verificacion,
    undefined,
    'sin mínimos leídos no se decide',
  );
});

test('should_lower_to_doubtful_a_yes_whose_justification_says_it_is_not_proven', async () => {
  // Caso casoC (p-91000770): tutores en «sí» con «la búsqueda no confirma … 30 h/60 h online».
  const tutores = {
    tipo: 'medios_personales',
    cumple: 'si' as const,
    descripcion: 'Tutor/a con 30 h de formación en teleformación',
    justificacion: 'La búsqueda no confirma requisitos curriculares en topografía ni 30 h/60 h online.',
  };
  const r = await uno(tutores);
  assert.equal(r.cumple, 'dudoso');
  assert.equal(r.verificacion?.regla, 'evidencia');
  assert.equal(r.verificacion?.resultado_ia, 'si');
  assert.match(r.verificacion?.detalle ?? '', /no confirma/);
  for (const justificacion of [
    'No consta acreditación de la experiencia exigida.',
    'Pendiente de acreditar con certificados de buena ejecución.',
    'Cumpliríamos, por confirmar con la gestoría.',
    'Experiencia no verificada en el perfil.',
    'Sin acreditar todavía.',
    'No se ha podido comprobar en el ROLECE.',
  ]) {
    assert.equal((await uno({ tipo: 'experiencia', cumple: 'si', justificacion })).cumple, 'dudoso', justificacion);
  }
});

test('should_keep_a_yes_whose_justification_only_says_there_is_nothing_against_us', async () => {
  for (const justificacion of [
    'No consta ninguna prohibición de contratar.',
    'No consta en el ROLECE ninguna sanción ni deuda.',
    'Tenemos el certificado vigente.',
  ]) {
    assert.equal((await uno({ tipo: 'otro', cumple: 'si', justificacion })).verificacion, undefined, justificacion);
  }
  assert.equal(
    (await uno({ tipo: 'otro', cumple: 'no', justificacion: 'No consta la solvencia.' })).verificacion,
    undefined,
    'solo baja un «sí»',
  );
  const castellano = await uno({
    tipo: 'idioma',
    cumple: 'si',
    descripcion: 'Documentación en castellano',
    justificacion: 'Idioma no verificado.',
  });
  assert.deepEqual(
    [castellano.cumple, castellano.verificacion?.regla],
    ['si', 'idioma'],
    'con el dato, decide el código',
  );
});

test('should_not_count_as_failed_what_the_tender_exempts', async () => {
  // «No se exige ISO/ENS» pasaba a «no» porque la empresa no tiene ninguna.
  const iso = await uno({
    tipo: 'certificacion',
    cumple: 'no',
    descripcion: 'Certificaciones de calidad o seguridad (ISO 9001, ISO 27001, ENS)',
    valor_exigido: 'No se exige',
  });
  assert.equal(iso.cumple, 'no_aplica');
  const casos: Partial<RequisitoVerificable>[] = [
    { tipo: 'seguro', descripcion: 'Seguro de responsabilidad civil', valor_exigido: 'Lote 3: exento' },
    { tipo: 'certificacion', descripcion: 'Certificado ENS: no será necesario acreditarlo para este lote' },
    { tipo: 'clasificacion', descripcion: 'Se dispensa de la clasificación en este contrato' },
    { tipo: 'seguro', descripcion: 'Seguro de RC', valor_exigido: '300.000 €; no se exige para este lote' },
  ];
  for (const c of casos) assert.equal((await uno({ cumple: 'no', ...c })).cumple, 'no_aplica', c.descripcion);
});

test('should_respect_hermes_not_applicable_when_its_justification_cites_the_exemption', async () => {
  // Hermes dijo «no aplica» por la exención del lote 3 y el código lo pasó a «no».
  const casoC = {
    tipo: 'seguro',
    excluyente: false,
    cumple: 'no_aplica' as const,
    descripcion: 'Seguro de responsabilidad civil',
    valor_exigido: '57.596 €',
    justificacion: 'Para el LOTE 3 no se exige seguro de accidentes ni de responsabilidad civil (PCAP p. 54).',
  };
  assert.equal((await uno(casoC)).cumple, 'no_aplica');
  assert.equal((await uno({ ...casoC, cumple: 'no' })).cumple, 'no', 'con Hermes en «no», la justificación no exime');
});

test('should_not_take_tax_class_or_partial_exemptions_as_ours', async () => {
  assert.equal(
    (await uno({ tipo: 'seguro', descripcion: 'Seguro de RC', valor_exigido: '300.000 € (importe exento de IVA)' }))
      .cumple,
    'no',
  );
  const ue = {
    tipo: 'clasificacion',
    descripcion:
      'Grupo V, subgrupo 2, categoría 3; los empresarios no españoles de la UE están exentos de clasificación',
    cumple: 'dudoso' as const,
  };
  assert.equal((await uno(ue)).cumple, 'no');
  assert.equal(
    (
      await uno({
        tipo: 'certificacion',
        descripcion: 'No se exige ISO 9001, pero sí el ENS categoría media',
        cumple: 'dudoso',
      })
    ).cumple,
    'no',
  );
  assert.equal(
    (await uno({ tipo: 'certificacion', descripcion: 'ISO 9001 obligatoria; no se exige el ENS', cumple: 'dudoso' }))
      .cumple,
    'no',
  );
});

test('should_keep_hermes_doubt_when_candidates_meet_only_the_minimums_read', async () => {
  // la búsqueda lee «5 años», no la experiencia POCTEFA que pide el pliego.
  const poctefa = {
    tipo: 'medios_personales',
    cumple: 'dudoso' as const,
    descripcion: 'Dirección con cinco años de experiencia en coordinación de proyectos INTERREG POCTEFA',
  };
  assert.equal(
    (await uno(poctefa, ctx({ candidatos: async () => respuesta([true, true, true, true]) }))).verificacion,
    undefined,
  );
});

test('should_keep_an_unmet_requirement_when_the_tender_only_says_when_it_is_delivered', async () => {
  // «No será necesario aportar/presentar…» dice cuándo se entrega, no que no se exija.
  const iso = await uno({
    tipo: 'certificacion',
    cumple: 'no',
    descripcion:
      'Certificado ISO/IEC 27001 vigente del licitador. No será necesario aportarlo si figura inscrito en el ROLECE',
  });
  assert.equal(iso.cumple, 'no');
  const conSeguro = ctx({ perfil: { ...PERFIL, seguro_rc: 100_000 } as PerfilEmpresaData });
  const rc = await uno(
    {
      tipo: 'seguro',
      cumple: 'no',
      descripcion: 'Seguro de RC',
      valor_exigido: 'Importe mínimo de 300.000 €. No será necesario presentar la póliza en el sobre A',
    },
    conSeguro,
  );
  assert.equal(rc.cumple, 'no');
  const rolece = await uno({
    tipo: 'certificacion',
    cumple: 'no',
    descripcion: 'Certificado ENS. No será necesario acreditarlo si figura inscrito en el ROLECE',
  });
  assert.equal(rolece.cumple, 'no', 'una dispensa con condición no exime');
});

// Los colaboradores pasan por el matching real: lo que acredita cada uno sale de su perfil.
let siguiente = 1;
const persona = (datos: Partial<PersonaData> & { nombre: string }) => ({
  ...Persona.parse({ tipo: 'interno', ...datos }),
  id: siguiente++,
  creada_en: '2026-10-01T00:00:00.000Z',
  actualizada_en: '2026-10-01T00:00:00.000Z',
});
const conEquipo =
  (personas: ReturnType<typeof persona>[]): ContextoVerificacion['candidatos'] =>
  async (textos) => ({
    requisitos: textos.map((texto) => ({ ...candidatosDe(personas, { texto, cpvs: [], cvs: [] }, 20), texto })),
    busqueda_semantica: false,
    aviso: null,
  });
// Años y títulos de sobra, ninguno en la materia.
const SARA = persona({
  nombre: 'Sara Prueba',
  anios_experiencia: 7,
  titulaciones: ['Grado en Periodismo'],
  sectores: ['atención al público', 'medios propios'],
});
const BEA = persona({
  nombre: 'Bea Prueba',
  anios_experiencia: 9,
  titulaciones: ['Licenciatura en Matemáticas'],
  tecnologias: ['Python', 'Power BI'],
});
const DIRECTOR = {
  tipo: 'medios_personales',
  descripcion:
    'Director/a técnico/a: titulación universitaria y ≥5 años en auditoría de accesibilidad web o evaluación de usabilidad.',
  valor_exigido: '1 perfil, grado universitario y ≥5 años experiencia específica',
};

test('should_lower_a_yes_to_doubtful_when_nobody_has_the_specific_subject_registered', async () => {
  // «7 de 11 cumplen los mínimos leídos» pasó el director a «sí» por los años totales.
  const r = await uno(
    { ...DIRECTOR, cumple: 'si', justificacion: 'Tenemos perfiles senior.' },
    ctx({ candidatos: conEquipo([SARA, BEA]) }),
  );
  assert.equal(r.cumple, 'dudoso');
  assert.equal(r.verificacion?.regla, 'medios_personales');
  assert.equal(
    r.verificacion?.fuente,
    'colaboradores: nadie acredita «auditoria de accesibilidad web o evaluacion de usabilidad»',
  );
  assert.match(
    r.verificacion?.detalle ?? '',
    /Bea Prueba, Sara Prueba cumplen los años o la titulación, pero no lo tienen registrado/,
  );
  assert.match(r.verificacion?.detalle ?? '', /los años totales no lo acreditan/);
});

test('should_not_raise_a_doubtful_staff_requirement_by_total_years', async () => {
  for (const cumple of ['dudoso', 'no'] as const) {
    assert.equal(
      (await uno({ ...DIRECTOR, cumple }, ctx({ candidatos: conEquipo([SARA, BEA]) }))).verificacion,
      undefined,
      cumple,
    );
  }
});

test('should_raise_to_yes_only_when_one_person_meeting_the_minimums_has_the_subject_registered', async () => {
  const lucia = persona({
    nombre: 'Lucía Prueba',
    anios_experiencia: 6,
    titulaciones: ['Grado en Publicidad'],
    sectores: ['Auditoría de accesibilidad web'],
  });
  const r = await uno({ ...DIRECTOR, cumple: 'dudoso' }, ctx({ candidatos: conEquipo([SARA, lucia]) }));
  assert.equal(r.cumple, 'si');
  assert.equal(r.verificacion?.fuente, 'colaboradores: acredita Lucía Prueba');
  assert.match(
    r.verificacion?.detalle ?? '',
    /«auditoria de accesibilidad web o evaluacion de usabilidad» \(sectores: Auditoría de accesibilidad web\)/,
  );
  const junior = persona({
    nombre: 'Iván Prueba',
    anios_experiencia: 2,
    titulaciones: ['Grado en Publicidad'],
    sectores: ['auditoría de accesibilidad web'],
  });
  assert.equal(
    (await uno({ ...DIRECTOR, cumple: 'dudoso' }, ctx({ candidatos: conEquipo([junior]) }))).verificacion,
    undefined,
    'la materia sin los cinco años no basta',
  );
  const varios = { ...DIRECTOR, descripcion: `Dos técnicos con ${DIRECTOR.descripcion.slice(20)}` };
  const dudosoConLucia = await uno({ ...varios, cumple: 'dudoso' }, ctx({ candidatos: conEquipo([lucia]) }));
  assert.equal(dudosoConLucia.cumple, 'dudoso', 'una persona no cubre dos perfiles');
  assert.match(dudosoConLucia.verificacion?.detalle ?? '', /Lucía Prueba.*varios perfiles/);
});

test('should_keep_doubtful_when_the_person_with_the_subject_has_unchecked_minimums', async () => {
  // cumple_minimos es true con reglas «desconocido»: sin años ni titulación registrados no se escribe «cumple los mínimos».
  const sinDatos = persona({ nombre: 'Nuria Prueba', sectores: ['Auditoría de accesibilidad web'] });
  const r = await uno({ ...DIRECTOR, cumple: 'dudoso' }, ctx({ candidatos: conEquipo([sinDatos]) }));
  assert.equal(r.cumple, 'dudoso');
  assert.match(r.verificacion?.detalle ?? '', /falta comprobar.*años de experiencia/);
  assert.doesNotMatch(r.verificacion?.detalle ?? '', /cumple los mínimos/);
});

test('should_not_raise_to_yes_when_the_requirement_asks_for_several_profiles_in_any_wording', async () => {
  const lucia = persona({
    nombre: 'Lucía Prueba',
    anios_experiencia: 6,
    titulaciones: ['Grado en Publicidad'],
    sectores: ['Auditoría de accesibilidad web'],
  });
  for (const descripcion of [
    'Un director y un técnico con titulación universitaria y ≥5 años en auditoría de accesibilidad web.',
    'Cuatro auditores con ≥5 años en auditoría de accesibilidad web.',
    'Coordinadores con titulación universitaria y ≥5 años en auditoría de accesibilidad web.',
  ]) {
    const r = await uno({ ...DIRECTOR, descripcion, cumple: 'dudoso' }, ctx({ candidatos: conEquipo([lucia]) }));
    assert.equal(r.cumple, 'dudoso', descripcion);
    assert.match(r.verificacion?.fuente ?? '', /acredita Lucía Prueba/, descripcion);
  }
});

test('should_not_lower_to_doubtful_when_someone_accredits_the_subject_only_in_certifications', async () => {
  // Sin otra coincidencia, quien acredita la materia solo en certificaciones salía de la lista y el «sí» bajaba a «nadie acredita».
  const copilot = {
    tipo: 'medios_personales',
    cumple: 'si' as const,
    descripcion: 'Docente con formación específica en hojas de cálculo avanzadas.',
  };
  const marta = persona({ nombre: 'Marta Prueba', certificaciones: ['hojas de cálculo avanzadas'] });
  assert.equal((await uno(copilot, ctx({ candidatos: conEquipo([marta]) }))).cumple, 'si');
});

test('should_not_conclude_nobody_accredits_when_the_candidate_list_was_trimmed_or_empty', async () => {
  const copilot = {
    tipo: 'medios_personales',
    cumple: 'si' as const,
    descripcion: 'Docente con formación específica en hojas de cálculo avanzadas.',
  };
  const varios = ['Ana', 'Beto', 'Cira'].map((n) => persona({ nombre: `${n} Prueba`, sectores: ['hojas de cálculo'] }));
  const recortado: ContextoVerificacion['candidatos'] = async (textos) => ({
    requisitos: textos.map((texto) => ({ ...candidatosDe(varios, { texto, cpvs: [], cvs: [] }, 1), texto })),
    busqueda_semantica: false,
    aviso: null,
  });
  assert.equal((await uno(copilot, ctx({ candidatos: recortado }))).cumple, 'si', 'lista recortada');
  assert.equal((await uno(copilot, ctx({ candidatos: conEquipo([]) }))).cumple, 'si', 'sin colaboradores');
});

test('should_keep_the_casoC_tutors_doubtful_without_the_online_hours_or_the_gardening_subject', async () => {
  // Caso casoC (p-91000770): «9 de 9 cumplen» por años; nadie con jardinería ni con las 30 h/60 h online.
  const tutores = {
    tipo: 'medios_personales',
    cumple: 'si' as const,
    justificacion: 'El equipo tiene experiencia docente.',
    descripcion:
      'Tutores: título o experiencia mínima: comunicación institucional 1 año, administración electrónica 1, análisis de datos 1, topografía 1, jardinería/arbolado 2; además 30 h de formación teleformación/TIC o 60 h de impartición online.',
  };
  const maria = persona({
    nombre: 'María Prueba',
    anios_experiencia: 4,
    sectores: ['comunicación institucional', 'administración electrónica'],
    tecnologias: ['análisis de datos'],
  });
  const r = await uno(tutores, ctx({ candidatos: conEquipo([maria, BEA]) }));
  assert.equal(r.cumple, 'dudoso');
  assert.match(
    r.verificacion?.fuente ?? '',
    /«topografia», «jardineria\/arbolado», «teleformacion\/tic o 60 h de imparticion online»/,
  );
  assert.doesNotMatch(
    r.verificacion?.fuente ?? '',
    /comunicacion institucional/,
    'lo que sí tiene registrado no falta',
  );
});

test('should_keep_the_casoE_main_teacher_doubtful_when_the_tender_asks_for_training_related_to_the_course', async () => {
  // docente principal en «sí» por la titulación; la formación del curso no se comprueba con datos.
  const docente = {
    tipo: 'medios_personales',
    cumple: 'si' as const,
    justificacion: 'Hay docentes con titulación.',
    descripcion:
      'Docente principal por lote con titulación oficial universitaria y formación específica o certificación acreditable relacionada con el curso.',
  };
  const marta = persona({
    nombre: 'Marta Prueba',
    titulaciones: ['Grado en Informática'],
    certificaciones: ['hojas de cálculo avanzadas'],
  });
  const r = await uno(docente, ctx({ candidatos: conEquipo([marta]) }));
  assert.equal(r.cumple, 'dudoso');
  assert.match(r.verificacion?.detalle ?? '', /«relacionada con el curso»/);
  const copilot = {
    ...docente,
    cumple: 'dudoso' as const,
    descripcion: 'Docente principal con titulación universitaria y formación específica en hojas de cálculo avanzadas.',
  };
  assert.equal(
    (await uno(copilot, ctx({ candidatos: conEquipo([marta]) }))).cumple,
    'si',
    'con la materia nombrada y registrada, sí',
  );
});

test('should_raise_to_yes_when_the_requirement_names_things_or_people_as_object_and_not_several_profiles', async () => {
  const lucia = persona({
    nombre: 'Lucía Prueba',
    anios_experiencia: 6,
    titulaciones: ['Grado en Publicidad'],
    sectores: ['Auditoría de accesibilidad web'],
  });
  for (const descripcion of [
    'Titulación universitaria y al menos 3 proyectos de ≥5 años en auditoría de accesibilidad web.',
    'Titulación universitaria y ≥5 años en auditoría de accesibilidad web con 2 ediciones impartidas y 10 municipios.',
    'Titulación universitaria, atención a personas mayores y ≥5 años en auditoría de accesibilidad web.',
    'Titulación universitaria, formación de formadores y ≥5 años en auditoría de accesibilidad web.',
  ]) {
    const r = await uno({ ...DIRECTOR, descripcion, cumple: 'dudoso' }, ctx({ candidatos: conEquipo([lucia]) }));
    assert.equal(r.cumple, 'si', descripcion);
  }
  for (const descripcion of [
    'Dos técnicos con ≥5 años en auditoría de accesibilidad web.',
    'Un director y un técnico con ≥5 años en auditoría de accesibilidad web.',
  ]) {
    assert.equal(
      (await uno({ ...DIRECTOR, descripcion, cumple: 'dudoso' }, ctx({ candidatos: conEquipo([lucia]) }))).cumple,
      'dudoso',
      descripcion,
    );
  }
});

test('should_lower_to_doubtful_when_an_active_person_lacks_the_subject_and_the_years_but_keep_yes_with_no_team', async () => {
  const hostelero = persona({ nombre: 'Hugo Prueba', anios_experiencia: 1, sectores: ['hostelería'] });
  const r = await uno(
    { ...DIRECTOR, cumple: 'si', justificacion: 'Tenemos perfiles senior.' },
    ctx({ candidatos: conEquipo([hostelero]) }),
  );
  assert.equal(r.cumple, 'dudoso');
  assert.match(r.verificacion?.fuente ?? '', /^colaboradores: nadie acredita «auditoria de accesibilidad web/);
  assert.equal(
    (
      await uno(
        { ...DIRECTOR, cumple: 'si', justificacion: 'Tenemos perfiles senior.' },
        ctx({ candidatos: conEquipo([]) }),
      )
    ).cumple,
    'si',
    'nadie dado de alta',
  );
});

test('should_treat_a_role_as_several_profiles_with_long_wording_but_not_non_team_plurals', async () => {
  const lucia = persona({
    nombre: 'Lucía Prueba',
    anios_experiencia: 6,
    titulaciones: ['Grado en Publicidad'],
    sectores: ['Auditoría de accesibilidad web'],
  });
  const estado = async (descripcion: string) =>
    (await uno({ ...DIRECTOR, descripcion, cumple: 'dudoso' }, ctx({ candidatos: conEquipo([lucia]) }))).cumple;
  assert.equal(
    await estado('Un técnico con titulación universitaria y ≥5 años en auditoría de accesibilidad web y un auxiliar.'),
    'dudoso',
  );
  for (const objeto of [
    'con 20 expedientes',
    'con varios componentes',
    'con restaurantes',
    'con clientes',
    'con pacientes',
  ]) {
    assert.equal(
      await estado(`Titulación universitaria y ≥5 años en auditoría de accesibilidad web ${objeto}.`),
      'si',
      objeto,
    );
  }
});

test('should_turn_a_yes_that_still_needs_confirming_into_doubtful', async () => {
  // CASO_E, apartado K: «concurre en solitario» daba «Cumple» aunque la ficha dijera que falta confirmar.
  const apartadoK = {
    tipo: 'subcontratacion',
    excluyente: false,
    cumple: 'si' as const,
    descripcion:
      'El apartado K determina si hay tareas no subcontratables; la selección Sí/No no es legible en el pasaje extraído.',
    justificacion:
      'Falta confirmar la casilla del apartado K del original; concurrir en solitario no resuelve si se prohíbe subcontratar.',
  };

  const r = await uno(apartadoK);

  assert.equal(r.cumple, 'dudoso');
  assert.deepEqual(
    [r.verificacion?.regla, r.verificacion?.resultado_ia, r.verificacion?.detalle],
    ['falta_confirmar', 'si', 'La ficha dice que falta confirmarlo: no se da por cumplido.'],
  );
  for (const justificacion of ['Cumplimos, por confirmar con la entidad.', 'Pendiente de confirmar el certificado.']) {
    assert.equal(
      (await uno({ tipo: 'otro', cumple: 'si', justificacion })).verificacion?.regla,
      'falta_confirmar',
      justificacion,
    );
  }
  assert.equal(
    (
      await uno({
        tipo: 'certificacion',
        descripcion: 'ENS categoría básica',
        cumple: 'si',
        justificacion: 'Falta confirmar la categoría.',
      })
    ).cumple,
    'no',
    'un «no» del código con el dato manda',
  );
  assert.equal(
    (await uno({ ...apartadoK, cumple: 'dudoso' })).verificacion?.regla,
    'subcontratacion',
    'solo baja un «sí»',
  );
});
