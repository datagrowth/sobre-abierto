// Memoria técnica, compromisos con coste: la memoria solo promete lo que el pliego exige (con su cita)
// o lo que añadimos porque compensa los puntos que da (con su criterio y su coste). Lo añadido
// caro se marca en la ficha, la persona lo puede quitar y lo quitado no se redacta. Datos
// sintéticos: ningún pliego real.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { problemasDeSolucion, Solucion, solucionEnMarkdown, textosDeSolucion } =
  await import('../../src/dominios/licitaciones/oferta/solucion.js');
const {
  compromisosNoListados,
  esCaro,
  MAX_FRASES_NO_LISTADAS,
  nivelDeCoste,
  problemaDeNoListados,
  solucionNormalizada,
  SOLO_LO_LISTADO,
  UMBRAL_HORAS_CARO,
  UMBRAL_HORAS_MEDIO,
} = await import('../../src/dominios/licitaciones/oferta/compromisosSolucion.js');
const { REGLAS_REDACCION } = await import('../../src/dominios/licitaciones/oferta/memoriaInstrucciones.js');
const { aplicarRevision, camposDeFicha } = await import('../../src/dominios/licitaciones/oferta/fichaCampos.js');
const { lineasFicha } = await import('../../src/dominios/licitaciones/oferta/fichaSolucion.js');
const { COMPROMETE_LO_CARO, DEFECTOS_QUE_BAJAN } = await import('../../src/dominios/licitaciones/oferta/critica.js');
const { chequeosConCoste, chequeosDeCoste } =
  await import('../../src/dominios/licitaciones/oferta/compromisosMemoriaCoste.js');
const { chequeosDelDocumento } = await import('../../src/dominios/licitaciones/oferta/chequeosDocumento.js');

const SIN_FUGAS = { automaticos: [] };
const DOSSIER =
  'Pliego técnico. La entidad adjudicataria realizará una sesión informativa inicial con cada grupo. Las tutorías se atenderán en horario de oficina.';

const RIESGO = (id: string) => ({
  id,
  causa: 'Baja asistencia a las sesiones',
  probabilidad: 'media',
  impacto: 'media',
  disparador: 'Asistencia por debajo del 60 %',
  medida: 'Recordatorio previo y sesión grabada',
  dueno: 'CO',
});
function solucionSintetica(compromisos: unknown[] = []) {
  return Solucion.parse({
    calendario: {
      inicio: '2027-01-11',
      fuente_inicio: 'Cuadro resumen sintético',
      semanas: [
        {
          desde: '2027-01-11',
          hasta: '2027-01-22',
          trabajo: 'Arranque del servicio',
          rol: 'CO',
          entregable: 'Plan de trabajo',
          puerta: 'Acta de arranque',
        },
      ],
      festivos: [],
      desplazamiento: 'Se desplaza lo mismo que el inicio',
    },
    arquitectura: [],
    modelos: [],
    umbrales: [],
    banco_pruebas: null,
    formacion: null,
    soporte: null,
    riesgos: [RIESGO('R1'), RIESGO('R2'), RIESGO('R3')],
    alias_roles: [{ rol: 'Coordinación del servicio', alias: 'CO', dedicacion: '20 % todo el contrato' }],
    casos: [],
    pendientes_legitimos: [],
    compromisos,
  });
}
const EXIGIDO = {
  texto: 'Sesión informativa inicial con cada grupo',
  clase: 'exigido',
  cita: 'realizará una sesión informativa inicial con cada grupo',
  horas: 6,
};
const CARO = {
  texto: 'Entrevista individual con cada alumna al empezar',
  clase: 'anadido',
  criterio: 'Apartado 2: atención personalizada',
  compensa: 'La rúbrica valora el seguimiento individual',
  horas: 150,
  supuesto: '150 alumnas × 1 h',
};
const BARATO = {
  texto: 'Tutoría individual a petición, con respuesta en 48 h',
  clase: 'anadido',
  criterio: 'Apartado 2: atención personalizada',
  compensa: 'Puntúa igual sin horas fijas',
  horas: 20,
  supuesto: 'Unas 20 peticiones × 1 h',
};

const problemas = (s: ReturnType<typeof solucionSintetica>, op: { recortado?: boolean } = {}) =>
  problemasDeSolucion(s, { fugas: SIN_FUGAS, fuentes: DOSSIER, ...op });

test('should_default_commitments_to_empty_so_saved_strategies_still_parse', () => {
  const { compromisos: _c, ...sin } = solucionSintetica();
  assert.deepEqual(Solucion.parse(sin).compromisos, []);
  const s = solucionSintetica([BARATO]);
  assert.deepEqual([s.compromisos[0]!.quitado, s.compromisos[0]!.cita], [false, ''], 'lo que no trae, por defecto');
  assert.equal(
    Solucion.safeParse({ ...s, compromisos: [{ ...BARATO, clase: 'opcional' }] }).success,
    false,
    'clase exigido o anadido',
  );
});

test('should_flag_an_exigido_commitment_without_a_verifiable_quote', () => {
  assert.deepEqual(problemas(solucionSintetica([EXIGIDO])).blandos, [], 'con la cita literal del dossier, nada');
  const sinCita = problemas(solucionSintetica([{ ...EXIGIDO, cita: '' }])).blandos;
  assert.match(
    sinCita.join(' '),
    /El compromiso «Sesión informativa inicial con cada grupo» va como exigido y no trae la cita del pliego que lo exige/,
  );
  const inventada = problemas(
    solucionSintetica([{ ...EXIGIDO, cita: 'realizará una entrevista individual con cada alumna' }]),
  );
  assert.match(
    inventada.blandos.join(' '),
    /La cita del compromiso exigido «Sesión informativa inicial con cada grupo» \(«realizará una entrevista individual con cada alumna»\) no está en el dossier/,
  );
  const recortado = problemas(
    solucionSintetica([{ ...EXIGIDO, cita: 'realizará una entrevista individual con cada alumna' }]),
    { recortado: true },
  );
  assert.deepEqual(recortado.blandos, [], 'con el dossier recortado puede estar en lo recortado');
  assert.match(recortado.avisos.join(' '), /el dossier tiene secciones recortadas: compruébala/);
});

test('should_flag_an_added_commitment_without_cost_or_scoring_criterion_as_soft', () => {
  assert.deepEqual(problemas(solucionSintetica([BARATO])).blandos, []);
  const sinCriterio = problemas(solucionSintetica([{ ...BARATO, criterio: '' }])).blandos.join(' ');
  assert.match(
    sinCriterio,
    /El compromiso añadido «Tutoría individual a petición, con respuesta en 48 h» no dice qué criterio o apartado lo puntúa/,
  );
  const sinCoste = problemas(solucionSintetica([{ ...BARATO, horas: null }])).blandos.join(' ');
  assert.match(
    sinCoste,
    /no trae coste: estima las horas de persona o, si no son horas, el nivel de coste, con su supuesto/,
  );
  assert.deepEqual(
    problemas(solucionSintetica([{ ...BARATO, horas: null, nivel: 'bajo' }])).blandos,
    [],
    'el nivel basta si no son horas',
  );
  const sinSupuesto = problemas(solucionSintetica([{ ...BARATO, supuesto: '' }])).blandos.join(' ');
  assert.match(sinSupuesto, /no dice de dónde sale su coste/);
});

test('should_warn_when_an_added_commitment_passes_the_cost_threshold', () => {
  assert.deepEqual([UMBRAL_HORAS_CARO, UMBRAL_HORAS_MEDIO], [40, 10]);
  assert.deepEqual(
    [esCaro({ horas: 40 }), esCaro({ horas: 41 }), esCaro({ horas: null, nivel: 'alto' }), esCaro({ horas: null })],
    [false, true, true, false],
  );
  assert.deepEqual(
    [
      nivelDeCoste({ horas: 10 }),
      nivelDeCoste({ horas: 11 }),
      nivelDeCoste({ horas: 41 }),
      nivelDeCoste({ horas: 5, nivel: 'alto' }),
      nivelDeCoste({ horas: 50, nivel: 'bajo' }),
      nivelDeCoste({ horas: null }),
    ],
    ['bajo', 'medio', 'alto', 'alto', 'alto', null],
    'el mayor de sus horas y el declarado',
  );
  const p = problemas(solucionSintetica([CARO, BARATO, { ...EXIGIDO, horas: 400 }]));
  assert.deepEqual(p.blandos, [], 'caro no es un error: lo decide la persona');
  assert.equal(p.avisos.length, 2, 'el añadido caro y el exigido caro (para comprobar su cita); lo barato no');
  assert.match(
    p.avisos[1]!,
    /^Compromiso exigido caro: «Sesión informativa inicial con cada grupo» cuesta 400 h, coste alto .*Comprueba que la cita del pliego/,
  );
  assert.match(
    p.avisos[0]!,
    /^Compromiso añadido caro: «Entrevista individual con cada alumna al empezar» cuesta 150 h, coste alto \(150 alumnas × 1 h; umbral 40 h o coste alto\) y el pliego no lo exige. Mantenlo solo si compensa los puntos de «Apartado 2: atención personalizada»/,
  );
  assert.deepEqual(problemas(solucionSintetica([{ ...CARO, quitado: true }])).avisos, [], 'lo quitado ya no avisa');
});

test('should_carry_live_commitments_to_the_solution_text_and_markdown', () => {
  const s = solucionSintetica([EXIGIDO, { ...CARO, quitado: true }, BARATO]);
  assert.ok(textosDeSolucion(s).includes(BARATO.texto), 'se vigila como lo demás');
  assert.ok(!textosDeSolucion(s).includes(CARO.texto));
  const md = solucionEnMarkdown(s).join('\n');
  assert.match(md, /### Compromisos \(lo único que la memoria compromete/);
  assert.match(
    md,
    /\| exigido \| Sesión informativa inicial con cada grupo \| «realizará una sesión informativa inicial con cada grupo» \| 6 h, coste bajo \|/,
  );
  assert.match(
    md,
    /\| añadido \| Tutoría individual a petición, con respuesta en 48 h \| Apartado 2: atención personalizada: Puntúa igual sin horas fijas \| 20 h, coste medio \|/,
  );
  assert.doesNotMatch(md, /€|euros/i, 'sin importes');
});

// La ficha tal como la guarda la plataforma, sin base de datos.
const ficha = (campos: ReturnType<typeof camposDeFicha>, estado: 'aprobada' | 'pendiente' = 'aprobada') => ({
  memoria_id: 1,
  estado,
  campos,
  creada_en: '2027-01-01T00:00:00Z',
  vence_en: '2027-01-02T00:00:00Z',
  revisada_en: null,
  revisada_por: 'Elisa',
  editados: [],
  no_revisados: [],
});

test('should_show_added_commitments_with_cost_and_an_expensive_warning_in_the_sheet', () => {
  const s = solucionSintetica([EXIGIDO, CARO, BARATO]);
  const campos = camposDeFicha(s, []).filter((c) => c.clave.startsWith('compromiso-'));
  assert.deepEqual(
    campos.map((c) => [c.clave, c.grupo, c.etiqueta, c.valor]),
    [
      [
        'compromiso-2',
        'Compromisos añadidos (cuestan: mantener, suavizar o quitar)',
        'Para «Apartado 2: atención personalizada» (compromiso · horas · nivel · decisión)',
        'Entrevista individual con cada alumna al empezar · 150 h · sin estimar · mantener',
      ],
      [
        'compromiso-3',
        'Compromisos añadidos (cuestan: mantener, suavizar o quitar)',
        'Para «Apartado 2: atención personalizada» (compromiso · horas · nivel · decisión)',
        'Tutoría individual a petición, con respuesta en 48 h · 20 h · sin estimar · mantener',
      ],
    ],
    'solo lo añadido: lo exigido no se puede quitar',
  );
  assert.match(
    campos[0]!.alerta ?? '',
    /^Compromiso añadido caro: «Entrevista individual con cada alumna al empezar» cuesta 150 h/,
  );
  assert.equal(campos[1]!.alerta, undefined, 'lo barato no avisa');
});

test('should_drop_the_warning_when_the_person_softens_an_expensive_commitment', () => {
  const s = solucionSintetica([CARO]);
  const campos = camposDeFicha(s, []);
  const r = aplicarRevision(
    s,
    [],
    campos,
    new Map([['compromiso-1', 'Entrevista individual a petición de la alumna · muchas · sin estimar · tal vez']]),
  );
  assert.match(
    r.error?.message ?? '',
    /«horas» va como número o «sin estimar» \(llegó «muchas»\)/,
    'cada parte con su tipo',
  );
  const bien = aplicarRevision(
    s,
    [],
    campos,
    new Map([['compromiso-1', 'Entrevista individual a petición de la alumna · 30 h · sin estimar · mantener']]),
  );
  assert.equal(bien.error, null);
  assert.deepEqual(
    [bien.data!.solucion.compromisos[0]!.texto, bien.data!.solucion.compromisos[0]!.horas],
    ['Entrevista individual a petición de la alumna', 30],
  );
  assert.equal(
    bien.data!.campos.find((c) => c.clave === 'compromiso-1')!.alerta,
    undefined,
    'suavizado por debajo del umbral, sin aviso',
  );
  const euros = aplicarRevision(
    s,
    [],
    campos,
    new Map([['compromiso-1', 'Kit digital · sin estimar · 4.000 € · mantener']]),
  );
  assert.match(
    euros.error?.message ?? '',
    /«nivel» va como «bajo», «medio», «alto» o «sin estimar» \(llegó «4\.000 €»\)/,
    'sin euros: el nivel',
  );
  const conImporte = aplicarRevision(
    s,
    [],
    campos,
    new Map([['compromiso-1', 'Kit digital de 4.000 euros · sin estimar · alto · mantener']]),
  );
  assert.match(
    conImporte.error?.message ?? '',
    /«compromiso» va como texto sin importes ni moneda/,
    'la memoria copia el texto: sin importes',
  );
  const alto = aplicarRevision(
    s,
    [],
    campos,
    new Map([['compromiso-1', 'Kit digital · sin estimar · alto · mantener']]),
  );
  assert.deepEqual(
    [alto.data!.solucion.compromisos[0]!.nivel, alto.data!.campos.find((c) => c.clave === 'compromiso-1')!.caro],
    ['alto', true],
  );
});

test('should_not_carry_a_commitment_removed_in_the_sheet_to_the_redaction', () => {
  const s = solucionSintetica([EXIGIDO, CARO, BARATO]);
  const campos = camposDeFicha(s, []);
  const r = aplicarRevision(
    s,
    [],
    campos,
    new Map([['compromiso-2', 'Entrevista individual con cada alumna al empezar · 150 h · sin estimar · quitar']]),
  );
  assert.equal(r.error, null);
  const sol = r.data!.solucion;
  assert.deepEqual(
    sol.compromisos.map((c) => c.quitado),
    [false, true, false],
  );
  assert.equal(r.data!.campos.find((c) => c.clave === 'compromiso-2')!.alerta, undefined, 'quitado, ya no avisa');
  const md = solucionEnMarkdown(sol).join('\n');
  const tablaDeCompromisos = md.slice(md.indexOf('### Compromisos'), md.indexOf('Quitados por la persona'));
  assert.ok(!tablaDeCompromisos.includes(CARO.texto), 'no está entre lo que se compromete');
  assert.match(
    md,
    /Quitados por la persona en la ficha \(no se escriben ni se prometen, aunque los traiga otra parte de la estrategia o la hoja de hechos\): «Entrevista individual con cada alumna al empezar»\./,
  );
  const lineas = lineasFicha(ficha(r.data!.campos)).join('\n');
  assert.ok(!lineas.includes(CARO.texto), 'la ficha que lee la redacción no lo trae como valor que copiar');
  assert.match(lineas, /Tutoría individual a petición, con respuesta en 48 h · 20 h · sin estimar · mantener/);
  assert.ok(!textosDeSolucion(sol).includes(CARO.texto));
});

test('should_flag_quantified_commitments_in_the_text_that_are_not_in_the_list', () => {
  const s = solucionSintetica([EXIGIDO, BARATO, { ...CARO, quitado: true }]);
  const listados = [...textosDeSolucion(s), 'Horario de atención: L-V 9:00-17:00'];
  const texto = [
    'La coordinadora atiende las consultas en horario de oficina.',
    'Cada alumna recibe un kit de materiales impresos al empezar el curso.',
    'Una persona del equipo está de guardia el domingo para incidencias.',
    'Cada subgrupo tiene 3,5 horas de tutoría fija cada semana.',
    'Se hace una entrevista individual con cada alumna al empezar.',
    'Se realiza una sesión informativa inicial con cada grupo, de 2 horas.',
    'La tutoría individual a petición, con respuesta en 48 h, se pide por correo.',
    'A petición de la entidad, el equipo puede hacer una sesión extra el sábado con cada alumna.',
  ].join(' ');
  assert.deepEqual(
    compromisosNoListados(texto, listados),
    [
      'Cada alumna recibe un kit de materiales impresos al empezar el curso.',
      'Una persona del equipo está de guardia el domingo para incidencias.',
      'Cada subgrupo tiene 3,5 horas de tutoría fija cada semana.',
      'Se hace una entrevista individual con cada alumna al empezar.',
      'Se realiza una sesión informativa inicial con cada grupo, de 2 horas.',
    ],
    'lo quitado en la ficha cuenta como no listado; lo escrito a petición, no',
  );
  assert.deepEqual(
    compromisosNoListados('La tutoría individual a petición, con respuesta en 48 h, se pide por correo.', listados),
    [],
  );
  assert.deepEqual(
    compromisosNoListados('Un calendario semanal de trabajo con una meta mensual.', []),
    [],
    '«semanal» suelto es planificación',
  );
});

test('should_report_unlisted_commitments_as_a_soft_problem_quoting_the_sentence', () => {
  assert.equal(problemaDeNoListados([]), null);
  const p = problemaDeNoListados(['Una persona del equipo está de guardia el domingo para incidencias.'])!;
  assert.match(
    p,
    /^Estas frases comprometen una frecuencia, una cantidad, horas, material físico o disponibilidad fuera de horario que no está en la lista de compromisos de la solución: «Una persona del equipo está de guardia el domingo para incidencias\.» Escríbelas como capacidad o a petición/,
  );
  const muchas = Array.from(
    { length: 8 },
    (_, i) => `El equipo hace ${i + 1} horas de guardia cada domingo número ${i + 1}.`,
  ).join(' ');
  assert.equal(compromisosNoListados(muchas, []).length, MAX_FRASES_NO_LISTADAS, 'con un tope de frases');
});

test('should_tell_redaction_to_commit_only_the_listed_commitments', () => {
  assert.equal(REGLAS_REDACCION.compromisos, SOLO_LO_LISTADO);
  assert.match(
    SOLO_LO_LISTADO,
    /compromete solo lo que está en la lista de compromisos, en la solución y en la hoja de hechos \(y en la ficha, sin lo que la persona quitó\): eso sí va con sus cifras\. Cualquier otra frecuencia, cantidad, número de horas, material físico o disponibilidad fuera de horario se escribe como capacidad o a petición/,
  );
});

test('should_count_committing_expensive_unrequired_things_as_a_defect_for_the_critic', () => {
  assert.ok(DEFECTOS_QUE_BAJAN.includes(COMPROMETE_LO_CARO));
  assert.match(
    COMPROMETE_LO_CARO,
    /^compromete lo caro que el pliego no exige y no puntúa .*: no suma puntos y crea riesgo de ejecución$/,
  );
});

const DOCUMENTO = [
  '# Memoria técnica',
  '',
  '## 1. Metodología',
  '',
  'Se hace una entrevista individual con cada alumna al empezar.',
  '',
  '## 2. Seguimiento',
  '',
  'La tutoría individual se atiende a petición, con respuesta en 48 h.',
].join('\n');

test('should_leave_the_document_checks_unchanged_without_a_cost_provider', () => {
  assert.deepEqual(chequeosDeCoste(DOCUMENTO), []);
  assert.deepEqual(chequeosConCoste(DOCUMENTO), chequeosDelDocumento(DOCUMENTO));
});

test('should_add_expensive_added_commitments_from_the_provider_to_the_document_checks', () => {
  const vistos: string[] = [];
  const proveedor = (texto: string) => {
    vistos.push(texto);
    return [
      {
        texto: 'Entrevista individual con cada alumna',
        cita: 'una entrevista individual con cada alumna al empezar',
        clase: 'anadido' as const,
        criterio: 'Apartado 1',
        horas: 150,
        euros: 6_000,
        supuesto: '150 alumnas × 1 h',
      },
      {
        texto: 'Tutoría a petición',
        cita: 'se atiende a petición',
        clase: 'anadido' as const,
        criterio: 'Apartado 2',
        horas: 20,
        euros: 800,
        supuesto: '20 × 1 h',
      },
      {
        texto: 'Sesión inicial exigida',
        cita: 'no está en el texto',
        clase: 'exigido' as const,
        criterio: null,
        horas: 300,
        euros: 5_000,
        supuesto: '',
      },
      {
        texto: 'Material impreso por alumna',
        cita: null,
        clase: 'anadido' as const,
        criterio: null,
        horas: 60,
        euros: 4_500,
        supuesto: '150 kits',
      },
    ];
  };
  const cs = chequeosConCoste(DOCUMENTO, proveedor);
  assert.deepEqual(vistos, [DOCUMENTO], 'lee el documento entero');
  assert.deepEqual(
    cs.slice(0, chequeosDelDocumento(DOCUMENTO).length),
    chequeosDelDocumento(DOCUMENTO),
    'lo de siempre, delante',
  );
  assert.deepEqual(
    cs.filter((c) => c.tipo === 'coste'),
    [
      {
        tipo: 'coste',
        apartado: 1,
        texto:
          'Compromete «Entrevista individual con cada alumna» (150 h, coste alto), que el pliego no exige: si no lo puntúa, es coste y riesgo de ejecución sin puntos.',
      },
      {
        tipo: 'coste',
        apartado: null,
        texto:
          'Compromete «Material impreso por alumna» (60 h, coste alto), que el pliego no exige: si no lo puntúa, es coste y riesgo de ejecución sin puntos.',
      },
    ],
    'solo lo añadido caro; lo exigido y lo barato no',
  );
  assert.doesNotMatch(JSON.stringify(cs), /€|euros|6\.000|4\.500/i, 'los euros del extractor no llegan al crítico');
});

// ── Defectos de la revisión escéptica ──

const { RONDA_SIN_COMPROMISOS_NUEVOS } = await import('../../src/dominios/licitaciones/oferta/compromisosSolucion.js');
const { definicionesDeFicha } = await import('../../src/dominios/licitaciones/oferta/solucion.js');
const { ALERTA_CERTIFICACION, seguirCambioDeHecho } =
  await import('../../src/dominios/licitaciones/oferta/fichaCampos.js');
const { registrarProveedorCoste } = await import('../../src/dominios/licitaciones/oferta/compromisosMemoriaCoste.js');

test('should_flag_a_commitment_when_may_or_until_does_not_qualify_the_trigger', () => {
  assert.deepEqual(compromisosNoListados('Cada alumna recibirá un kit de robótica que podrá llevarse a casa.', []), [
    'Cada alumna recibirá un kit de robótica que podrá llevarse a casa.',
  ]);
  assert.deepEqual(compromisosNoListados('Mantendremos una guardia telefónica los domingos hasta las 20:00.', []), [
    'Mantendremos una guardia telefónica los domingos hasta las 20:00.',
  ]);
  assert.deepEqual(
    compromisosNoListados('Cada alumna puede pedir una tutoría de refuerzo de hasta 2 horas al mes.', []),
    [],
    '«hasta N» pegado a lo que compromete sí es capacidad',
  );
});

test('should_require_a_shared_word_beyond_the_trigger_and_check_every_match', () => {
  assert.deepEqual(
    compromisosNoListados('Haremos una entrevista con cada alumna al inicio del curso.', [
      'Acceso a la plataforma con cada alumna matriculada',
    ]),
    ['Haremos una entrevista con cada alumna al inicio del curso.'],
    '«cada alumna» no dice de qué habla',
  );
  const dos = 'Cada grupo tiene una sesión de seguimiento de 2 h y un refuerzo de 630 h en total.';
  assert.deepEqual(
    compromisosNoListados(dos, ['Sesión de seguimiento de 2 horas con el grupo']),
    [dos],
    'la segunda cifra también se compara',
  );
  assert.deepEqual(
    compromisosNoListados('Cada grupo tiene una sesión de seguimiento de 2 h.', [
      'Sesión de seguimiento de 12 horas con el grupo',
    ]),
    ['Cada grupo tiene una sesión de seguimiento de 2 h.'],
    '«2 h» no está en «12 h»',
  );
});

test('should_not_flag_technical_frequencies_clock_hours_or_listed_commitments_reworded', () => {
  const tecnico = [
    'El sistema asigna permisos por usuario y rol.',
    'La carga de datos se ejecuta cada día a las 02:00 y deja un registro.',
    'El horario de atención es de 9 a 14 h.',
    'El soporte se presta de 9:00 a 14:00 h de lunes a viernes.',
  ];
  assert.deepEqual(compromisosNoListados(tecnico.join(' '), []), []);
  assert.deepEqual(
    compromisosNoListados('Cada semana, cada subgrupo tiene una sesión de seguimiento de 2 horas.', [
      'Sesión semanal de seguimiento de 2 h por subgrupo',
    ]),
    [],
    '«semanal» es «cada semana»',
  );
  assert.deepEqual(
    compromisosNoListados('La técnica hace una llamada de seguimiento cada día a cada usuario.', []),
    ['La técnica hace una llamada de seguimiento cada día a cada usuario.'],
    'con personas, sí',
  );
});

test('should_count_a_commitment_removed_in_the_sheet_as_unlisted_even_if_a_fact_repeats_it', () => {
  const frase = 'Cada subgrupo tiene 3,5 h de tutoría fija cada semana.';
  const hoja = ['Horas por subgrupo: 3,5 h de tutoría cada semana'];
  assert.deepEqual(compromisosNoListados(frase, hoja), [], 'listado en la hoja');
  assert.deepEqual(
    compromisosNoListados(frase, hoja, ['3,5 h de tutoría fija por subgrupo y semana']),
    [frase],
    'pero la persona lo quitó',
  );
});

test('should_tell_rounds_to_concretize_what_the_criterion_values', () => {
  assert.match(
    RONDA_SIN_COMPROMISOS_NUEVOS,
    /que no está en la lista de compromisos, la solución ni la hoja de hechos/,
  );
  assert.match(
    RONDA_SIN_COMPROMISOS_NUEVOS,
    /Excepción: si lo que falta es lo que el criterio valora expresamente \(«se valorará…»\), concrétalo con las cifras/,
  );
  assert.match(
    SOLO_LO_LISTADO,
    /Lo que la persona quitó en la ficha no se escribe aunque lo traigan la hoja de hechos/,
  );
});

const INFLADO = {
  clase: 'exigido',
  texto: 'Entrevista individual semanal con cada alumna',
  cita: 'realizará una sesión informativa inicial con cada grupo',
  horas: 630,
  supuesto: '30 alumnas × 21 semanas × 1 h',
};

test('should_show_an_expensive_exigido_commitment_in_the_sheet_without_a_remove_option', () => {
  const s = solucionSintetica([INFLADO]);
  const [c] = camposDeFicha(s, []).filter((x) => x.clave.startsWith('exigido-'));
  assert.deepEqual(
    [c!.clave, c!.grupo, c!.valor, c!.caro],
    [
      'exigido-1',
      'Compromisos exigidos caros (comprueba que el pliego los pide tal cual)',
      'Entrevista individual semanal con cada alumna · 630 h · sin estimar',
      true,
    ],
  );
  assert.match(c!.alerta!, /^Compromiso exigido caro: «Entrevista individual semanal con cada alumna» cuesta 630 h/);
  const r = aplicarRevision(
    s,
    [],
    camposDeFicha(s, []),
    new Map([['exigido-1', 'Sesión informativa inicial con cada grupo · 6 h · sin estimar']]),
  );
  assert.equal(r.error, null);
  assert.deepEqual(
    [r.data!.solucion.compromisos[0]!.texto, r.data!.campos.find((x) => x.clave === 'exigido-1')!.alerta],
    ['Sesión informativa inicial con cada grupo', undefined],
  );
  assert.deepEqual(
    camposDeFicha(solucionSintetica([EXIGIDO]), []).filter((x) => x.clave.startsWith('exigido-')),
    [],
    'lo exigido barato no ocupa la ficha',
  );
  assert.match(
    problemas(solucionSintetica([{ ...EXIGIDO, horas: null }])).blandos.join(' '),
    /El compromiso exigido «Sesión informativa inicial con cada grupo» no trae coste/,
  );
});

test('should_not_break_the_sheet_with_a_strategy_saved_before_commitments', () => {
  const { compromisos: _c, ...cruda } = solucionSintetica();
  const s = cruda as unknown as ReturnType<typeof solucionSintetica>;
  assert.doesNotThrow(() => definicionesDeFicha(s));
  const campos = camposDeFicha(s, []);
  const r = aplicarRevision(s, [], campos, new Map([['rol-1', '30 % todo el contrato']]));
  assert.equal(r.error, null);
  assert.doesNotThrow(() => seguirCambioDeHecho(s, campos, { clave: 'x', antes: 'a', despues: 'b' }, 1));
  assert.doesNotThrow(() => textosDeSolucion(s));
});

const HECHO = {
  clave: 'entrevistas',
  categoria: 'otro' as const,
  sobre: 'Entrevistas',
  valor: 'Entrevista individual con cada alumna al empezar',
  palabras: ['entrevista'],
};

test('should_tie_the_matching_fact_to_the_commitment_and_drop_or_soften_it_with_the_sheet', () => {
  const s = solucionSintetica([CARO]);
  const campos = camposDeFicha(s, [HECHO]);
  assert.deepEqual(
    campos.find((c) => c.clave === 'compromiso-1')!.hechos,
    [{ clave: 'entrevistas', valor: HECHO.valor }],
    'atado a su compromiso',
  );
  assert.ok(!campos.some((c) => c.clave === 'hecho-entrevistas'), 'no se enseña dos veces');
  const quitado = aplicarRevision(
    s,
    [HECHO],
    campos,
    new Map([['compromiso-1', `${CARO.texto} · 150 h · sin estimar · quitar`]]),
  );
  assert.deepEqual(quitado.data!.hechos, [], 'quitado, sale de la hoja que copia la redacción');
  const suave = aplicarRevision(
    s,
    [HECHO],
    campos,
    new Map([['compromiso-1', 'Entrevista individual a petición de la alumna · 20 h · sin estimar · mantener']]),
  );
  assert.equal(
    suave.data!.hechos[0]!.valor,
    'Entrevista individual a petición de la alumna',
    'suavizado, la hoja cambia con él',
  );
});

test('should_keep_the_cost_warning_when_a_commitment_also_names_a_certificate', () => {
  const s = solucionSintetica([
    { ...CARO, texto: 'Certificado de aprovechamiento y entrevista final con cada alumna' },
    { ...BARATO, texto: 'Certificado digital de asistencia', horas: 2, supuesto: 'Plantilla × 2 h' },
  ]);
  const [caro, barato] = camposDeFicha(s, []).filter((c) => c.clave.startsWith('compromiso-'));
  assert.match(caro!.alerta!, /^Compromiso añadido caro: .*cuesta 150 h/);
  assert.ok(caro!.alerta!.endsWith(ALERTA_CERTIFICACION));
  assert.equal(caro!.caro, true);
  assert.deepEqual(
    [barato!.alerta, barato!.caro],
    [ALERTA_CERTIFICACION, undefined],
    'barato: se comprueba la certificación, no «Coste alto»',
  );
});

test('should_use_a_registered_cost_provider_in_the_critic_checks', () => {
  const proveedor = () => [
    {
      texto: 'Kit físico por alumna',
      cita: 'no está',
      clase: 'anadido' as const,
      criterio: null,
      horas: 90,
      euros: 4_500,
      supuesto: '150 kits × 0,6 h',
    },
  ];
  registrarProveedorCoste(proveedor);
  try {
    assert.ok(
      chequeosConCoste(DOCUMENTO).some(
        (c) => c.tipo === 'coste' && c.texto.startsWith('Compromete «Kit físico por alumna»'),
      ),
    );
  } finally {
    registrarProveedorCoste();
  }
  assert.deepEqual(chequeosConCoste(DOCUMENTO), chequeosDelDocumento(DOCUMENTO), 'sin registrar, como siempre');
});

test('should_read_commitments_saved_with_origen_and_euros_in_the_current_vocabulary', () => {
  const guardada = {
    compromisos: [
      {
        texto: 'Kits impresos por alumna',
        origen: 'añadido',
        criterio: 'Apartado 2',
        compensa: 'Lo valora',
        horas: null,
        euros: 4_000,
        supuesto: '150 kits a 4.000 € en total',
      },
      {
        texto: 'Sesión informativa inicial con cada grupo',
        origen: 'exigido',
        cita: 'realizará una sesión informativa inicial con cada grupo',
        horas: 6,
        euros: null,
      },
      { ...BARATO },
    ],
  };
  const s = solucionSintetica(solucionNormalizada(guardada).compromisos);
  assert.deepEqual(
    s.compromisos.map((c) => [c.clase, c.horas, c.nivel, c.supuesto]),
    [
      ['anadido', null, 'alto', ''],
      ['exigido', 6, null, ''],
      ['anadido', 20, null, BARATO.supuesto],
    ],
    'los euros pasan a un nivel y el supuesto con importe se vacía',
  );
  assert.ok(!JSON.stringify(s).includes('4.000') && !JSON.stringify(s).includes('euros'), 'ningún importe sobrevive');
  assert.equal(guardada.compromisos[0]!.origen, 'añadido', 'no cambia lo leído');
  assert.equal(
    Solucion.safeParse({ ...s, compromisos: [{ ...BARATO, euros: 300 }] }).success,
    false,
    'el esquema de la tool no acepta euros',
  );
  assert.equal(
    Solucion.safeParse({ ...s, compromisos: [{ ...BARATO, supuesto: '20 h a 40 €/h' }] }).success,
    false,
    'ni importes en el supuesto',
  );
});

// ── Defectos de la revisión escéptica del contrato sin euros ──

test('should_keep_a_saved_strategy_valid_when_old_commitment_texts_carry_amounts', () => {
  const guardada = {
    compromisos: [
      {
        texto: 'Kits impresos por alumna (4.000 €)',
        origen: 'añadido',
        criterio: 'Apartado 2',
        compensa: '4.000 euros frente a 10 puntos',
        horas: null,
        euros: 4_000,
        supuesto: '',
      },
      {
        texto: 'Material de 20 € por alumna',
        origen: 'añadido',
        criterio: 'Apartado 2 (vale 500 €)',
        compensa: 'Lo valora',
        horas: 10,
        euros: null,
        supuesto: '',
      },
    ],
  };
  const r = Solucion.safeParse({ ...solucionSintetica(), compromisos: solucionNormalizada(guardada).compromisos });
  assert.equal(r.success, true, 'la estrategia guardada sigue validando');
  assert.deepEqual(
    r.data!.compromisos.map((c) => [c.texto, c.criterio, c.compensa]),
    [
      ['Kits impresos por alumna', 'Apartado 2', ''],
      ['Material de por alumna', '', 'Lo valora'],
    ],
    'lo prometido pierde el importe; la justificación con importe se vacía',
  );
  assert.doesNotMatch(JSON.stringify(r.data), /€|euros?\b|4\.000/i);
});

test('should_strip_amounts_the_extractor_writes_in_the_commitment_text_before_the_critic', () => {
  const proveedor = () => [
    {
      texto: 'Kits físicos por alumna (4.500 €)',
      cita: null,
      clase: 'anadido' as const,
      criterio: null,
      horas: 90,
      euros: 4_500,
      supuesto: '150 kits',
    },
  ];
  const cs = chequeosDeCoste(DOCUMENTO, proveedor);
  assert.equal(cs.length, 1);
  assert.match(cs[0]!.texto, /^Compromete «Kits físicos por alumna» \(90 h, coste alto\)/);
  assert.doesNotMatch(JSON.stringify(cs), /€|euros|4\.500/i);
});

test('should_not_carry_a_cost_level_change_into_the_facts_of_the_commitment', () => {
  const s = solucionSintetica([{ ...CARO, nivel: 'medio' }]);
  const hechos = [
    {
      clave: 'entrevista',
      categoria: 'otro' as const,
      sobre: 'entrevista inicial',
      valor: 'Entrevista individual con cada alumna al empezar, por medios telemáticos',
      palabras: ['entrevista'],
    },
  ];
  const campos = camposDeFicha(s, hechos);
  assert.deepEqual(
    campos.find((c) => c.clave === 'compromiso-1')!.hechos?.map((h) => h.clave),
    ['entrevista'],
    'el hecho va atado al compromiso',
  );
  const r = aplicarRevision(
    s,
    hechos,
    campos,
    new Map([['compromiso-1', 'Entrevista individual con cada alumna al empezar · 150 h · alto · mantener']]),
  );
  assert.equal(r.error, null);
  assert.equal(r.data!.solucion.compromisos[0]!.nivel, 'alto');
  assert.equal(
    r.data!.hechos[0]!.valor,
    hechos[0]!.valor,
    '«medio» → «alto» no cambia «medios» por «altos» en la hoja',
  );
});

test('should_reject_amounts_typed_in_any_sheet_field_that_reaches_the_facts', () => {
  const s = solucionSintetica([BARATO]);
  const hechos = [
    {
      clave: 'kit_bienvenida',
      categoria: 'otro' as const,
      sobre: 'kit de bienvenida',
      valor: 'Guía digital de bienvenida para cada alumna',
      palabras: ['bienvenida'],
    },
  ];
  const campos = camposDeFicha(s, hechos);
  assert.ok(
    campos.some((c) => c.clave === 'hecho-kit_bienvenida'),
    'el hecho va como campo propio',
  );
  const r = aplicarRevision(
    s,
    hechos,
    campos,
    new Map([['hecho-kit_bienvenida', 'Kit impreso de bienvenida de 25 € por alumna']]),
  );
  assert.match(r.error?.message ?? '', /«kit de bienvenida» lleva un importe: la memoria va en un sobre sin precios/);
  const bien = aplicarRevision(
    s,
    hechos,
    campos,
    new Map([['hecho-kit_bienvenida', 'Kit impreso de bienvenida por alumna']]),
  );
  assert.equal(bien.data!.hechos[0]!.valor, 'Kit impreso de bienvenida por alumna', 'sin importe, se aplica');
});
