// Decidir en vez de aplazar. Las órdenes de «no inventar» protegen
// acreditaciones, licencias y certificaciones, no el diseño de la solución; la estrategia
// que aplaza («T0», «a acordar» sin cifra) o deja apartados sin cifras se rechaza.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { apartadoCasoA, GUION_CASO_A } from './fixtures/casoA.js';

const { CAUTELAS_ENFOQUE, textoHerramientas, tieneCautelas } =
  await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { EstrategiaDatos, problemasDePrudencia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { aplazamientosEn } = await import('../../src/dominios/licitaciones/oferta/aplazamientos.js');
const { inicioDelDossier } = await import('../../src/dominios/licitaciones/oferta/calendario.js');
const { revisarApartado } = await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');

const MEM = GuionBase.parse(GUION_CASO_A).memoria!;
function estrategia() {
  const { id: _id, memoria_id: _m, version: _v, ...datos } = estrategiaCasoA({ memoria_id: 1, version: 1 });
  return EstrategiaDatos.parse(datos);
}
const aplazados = (e: ReturnType<typeof estrategia>, inicio: string | null = null) =>
  problemasDePrudencia(e, { mem: MEM, inicio }).filter((p) => p.startsWith('Aplaza'));

test('should_let_the_writer_choose_services_but_not_invent_licences_or_certifications', () => {
  const t = textoHerramientas(['Gestor de tickets']);
  assert.equal(
    t,
    'Herramientas decididas: Gestor de tickets. Además, elige y nombra los servicios y componentes que pide el pliego, con versión o configuración: es diseño de la solución. Lo que no se inventa son licencias, accesos concedidos, certificaciones y productos propios.',
  );
  assert.match(textoHerramientas([]), /^Herramientas decididas: ninguna fijada por el equipo\. Además, elige y nombra/);
  assert.doesNotMatch(textoHerramientas([]), /no inventes productos/, 'ya no prohíbe elegir componentes');
});

test('should_add_the_caution_line_only_when_the_approach_has_negatives', () => {
  assert.equal(tieneCautelas('No prometer plazos de integración con sistemas del órgano.'), true);
  assert.equal(tieneCautelas('Contar el servicio cercano con una responsable de referencia.'), false);
  assert.equal(CAUTELAS_ENFOQUE, 'Sus cautelas se cumplen sin escribirlas y sin dejar valores abiertos.');
});

test('should_flag_T0_or_a_acordar_without_a_value_as_a_problem', () => {
  const e = estrategia();
  e.hechos.push({
    clave: 't0',
    categoria: 'calendario',
    sobre: 'inicio del servicio',
    valor: 'T0: fecha acordada con el órgano',
    palabras: ['inicio'],
  });
  e.solucion.arquitectura.push({
    capa: 'Datos',
    servicio: 'Servicio de almacenamiento a acordar',
    tier: 'Estándar',
    region: 'UE',
    motivo: 'Aloja los documentos del servicio.',
    control: 'Cifrado en reposo',
    alternativa: 'Otro proveedor',
  });
  const p = aplazados(e);
  assert.equal(p.length, 2, p.join('\n'));
  assert.equal(
    p[0],
    'Aplaza un valor de diseño en vez de fijarlo (hecho «t0»): «inicio del servicio: T0: fecha acordada con el órgano». Escribe el valor como hecho («La solución usa…», «El servicio se presta de 9:00 a 18:00 h») o, si el pliego lo reserva expresamente al órgano, llévalo a «pendientes_legitimos» con su cita y nuestra propuesta por defecto.',
  );
  assert.match(
    p[1]!,
    /^Aplaza un valor de diseño en vez de fijarlo \(solución\): «Datos: Servicio de almacenamiento a acordar/,
  );
});

test('should_accept_a_proposed_value_ratified_in_a_later_week', () => {
  const e = estrategia();
  e.hechos.push({
    clave: 'region',
    categoria: 'otro',
    sobre: 'región de la nube',
    valor: 'La empresa propone Spain Central; se ratifica en S2',
    palabras: ['región'],
  });
  e.reglas.push('El umbral de citas se fijará en la semana 2 con un mínimo del 90 %.');
  assert.deepEqual(aplazados(e), [], 'con su valor o con cifra al lado, no aplaza');
});

test('should_exempt_what_the_pliego_reserves_to_the_contracting_body', () => {
  const e = estrategia();
  e.hechos.push({
    clave: 'muestra',
    categoria: 'otro',
    sobre: 'muestra de aceptación',
    valor: 'Tamaño de la muestra pendiente de aprobación del órgano',
    palabras: ['muestra'],
  });
  assert.equal(aplazados(e).length, 1);
  e.solucion.pendientes_legitimos = [
    {
      parametro: 'Tamaño de la muestra',
      cita: 'La muestra de aceptación la fijará el órgano de contratación',
      por_defecto: '100 expedientes',
    },
  ];
  assert.deepEqual(aplazados(e), [], 'un pendiente legítimo no cuenta');
});

test('should_require_absolute_dates_when_the_dossier_knows_the_start', () => {
  const e = estrategia();
  e.hechos.push({
    clave: 'arranque',
    categoria: 'calendario',
    sobre: 'reunión de arranque',
    valor: 'Semana 1 del contrato',
    palabras: ['arranque'],
  });
  const inicio = e.solucion.calendario.inicio;
  assert.deepEqual(
    problemasDePrudencia(e, { mem: MEM, inicio: null }).filter((p) => /fecha/.test(p)),
    [],
    'sin inicio conocido no se exige',
  );
  const p = problemasDePrudencia(e, { mem: MEM, inicio });
  assert.ok(
    p.includes(
      `El hecho de calendario «arranque» no lleva fecha («Semana 1 del contrato»): el dossier da el inicio previsto (${inicio}); escribe la fecha absoluta.`,
    ),
    p.join('\n'),
  );
  e.hechos.at(-1)!.valor = 'Lunes 16/11/2026';
  e.solucion.calendario.inicio = '2000-01-03';
  assert.ok(
    problemasDePrudencia(e, { mem: MEM, inicio }).includes(
      `El calendario de la solución empieza el 2000-01-03, antes del inicio previsto del dossier (${inicio}): fecha desde ese inicio.`,
    ),
  );
});

test('should_require_a_minimum_of_quantitative_facts_per_apartado', () => {
  const e = estrategia();
  const deCifras = () => problemasDePrudencia(e, { mem: MEM }).filter((p) => /cifras o indicadores/.test(p));
  assert.deepEqual(deCifras(), [], 'la estrategia de ejemplo los tiene en el mapa');
  e.mapa = e.mapa.map((m) => (m.apartado === 4 ? { ...m, evidencia: 'Guía rápida para el personal.' } : m));
  assert.deepEqual(deCifras(), [
    'El apartado 4 «Mejoras vinculadas al objeto del contrato» no lleva al menos 2 cifras o indicadores (tiene 0): añade hechos de cifra o indicador con «apartados» que lo incluyan, o evidencias con su número en el «mapa».',
  ]);
  e.hechos.push(
    { clave: 'guias', categoria: 'cifra', sobre: 'guías', valor: '3 guías', palabras: ['guías'], apartados: [4] },
    {
      clave: 'pildoras',
      categoria: 'indicador',
      sobre: 'píldoras',
      valor: '6 píldoras al año',
      palabras: ['píldoras'],
      apartados: [4],
    },
  );
  assert.deepEqual(deCifras(), [], 'con dos hechos cuantitativos del apartado, vale');
});

test('should_read_the_start_date_from_the_dossier_identification', () => {
  assert.equal(
    inicioDelDossier(
      '- Plazo: …\n- Inicio previsto: domingo 15/11/2026 (PCAP, pág. 2); no es laborable: el primer día laborable es el lunes 16/11/2026.\n- Duración: …',
    ),
    '2026-11-16',
  );
  assert.equal(inicioDelDossier('- Inicio previsto: martes 01/12/2026 (ficha).'), '2026-12-01');
  assert.equal(
    inicioDelDossier(
      '- Inicio previsto: sin fecha en el pliego, la ficha ni la plataforma, y sin fecha límite: fecha el calendario por semanas y dilo.',
    ),
    null,
  );
});

test('should_count_postponements_in_an_apartado_and_tolerate_one_every_two_pages', () => {
  assert.deepEqual(
    aplazamientosEn(
      'El calendario es relativo a T0. La región se fijará con el órgano. La empresa propone 9:00-18:00.',
    ),
    ['El calendario es relativo a T0.', 'La región se fijará con el órgano.'],
  );
  const c = {
    automaticos: [],
    apartado: { titulo: MEM.apartados[0]!.titulo, puntos: 8, se_valorara: MEM.apartados[0]!.se_valorara },
    cuota: null,
  };
  const a = apartadoCasoA(1, { memoria_id: 1, guion_id: 1, version: 1 });
  assert.equal(
    revisarApartado(a, c).blandos.some((b) => b.startsWith('APLAZAMIENTOS')),
    false,
  );
  a.bloques = a.bloques.slice(0, 1).map((b) => ({
    ...b,
    lista: [],
    parrafos: [
      ...b.parrafos,
      'La región de alojamiento está sujeta a validación por el órgano.',
      'Los umbrales de calidad quedan a acordar con el órgano.',
      'El horario de soporte se definirá con el órgano.',
    ],
  }));
  const r = revisarApartado(a, c).blandos.find((b) => b.startsWith('APLAZAMIENTOS'));
  assert.match(
    r ?? '',
    /^APLAZAMIENTOS: el apartado deja 3 valores sin fijar \(«La región de alojamiento está sujeta a validación por el órgano\.»; /,
    r,
  );
});

// C-5: el rol se presenta entero una vez y después por su sigla; una frase repetida por toda la
// memoria se avisa.
const { problemasDeEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { hallazgosDeCoherencia, textoDeHallazgo } = await import('../../src/dominios/licitaciones/oferta/hechos.js');
const { repeticionesEn } = await import('../../src/dominios/licitaciones/oferta/repeticion.js');

test('should_flag_a_long_role_without_its_short_form', () => {
  const e = estrategia();
  const ctx = { mem: MEM, fugas: { automaticos: [] }, porRoles: false, equipo: [], herramientas: [] };
  e.hechos.push({
    clave: 'perfil_1',
    categoria: 'rol',
    sobre: 'primer perfil técnico',
    valor: 'Primer perfil técnico de desarrollo e integración de datos',
    palabras: ['perfil'],
  });
  assert.ok(
    problemasDeEstrategia(e, ctx).blandos.includes(
      'El rol del hecho «perfil_1» («Primer perfil técnico de desarrollo e integración de datos») pasa de 40 caracteres: dale una sigla en «corto» (la de «alias_roles»); la memoria lo presenta entero una vez y después lo cita por ella.',
    ),
  );
  e.hechos.at(-1)!.corto = 'TEC-1';
  assert.equal(
    problemasDeEstrategia(e, ctx).blandos.some((b) => b.startsWith('El rol del hecho')),
    false,
    'con su sigla, vale',
  );
});

test('should_accept_the_short_form_of_a_role_as_the_same_role', () => {
  const hechos = [
    {
      clave: 'rs',
      categoria: 'rol' as const,
      sobre: 'responsable del servicio',
      valor: 'Ana García Pérez, responsable del servicio',
      palabras: ['responsable'],
      corto: 'RS',
    },
    {
      clave: 'ct',
      categoria: 'rol' as const,
      sobre: 'coordinador técnico',
      valor: 'Luis Martín Díaz, coordinador técnico',
      palabras: ['coordinador'],
      corto: 'CT',
    },
  ];
  const op = { equipo: ['Ana García Pérez', 'Luis Martín Díaz'] };
  assert.deepEqual(
    hallazgosDeCoherencia(['Ana García (RS) revisará cada consulta el mismo día.'], hechos, op),
    [],
    'su propio rol por la sigla',
  );
  const cruzado = hallazgosDeCoherencia(['Luis Martín (RS) revisará cada consulta el mismo día.'], hechos, op);
  assert.deepEqual(
    cruzado.map((h) => [h.tipo, h.hecho]),
    [['contradiccion', 'rs']],
    'la sigla de otro rol también se detecta',
  );
});

test('should_warn_about_six_word_phrases_repeated_more_than_eight_times', () => {
  const frase = 'El perfil de arquitectura de la solución revisará la entrega.';
  const textos = [Array(5).fill(frase).join(' '), Array(4).fill(frase).join(' ')];
  const r = repeticionesEn(textos);
  assert.equal(r.length, 1, 'una frase larga repetida se avisa una vez, no por cada n-grama solapado');
  assert.equal(r[0]!.veces, 9);
  assert.equal(r[0]!.apartado, 1);
  assert.deepEqual(repeticionesEn([Array(8).fill(frase).join(' ')]), [], 'ocho veces se toleran');
  const h = {
    apartado: 1,
    hecho: '',
    cita: r[0]!.frase,
    encontrado: '9 veces',
    esperado: '',
    tipo: 'repeticion' as const,
  };
  assert.equal(
    textoDeHallazgo(h),
    `«${r[0]!.frase}» sale 9 veces en la memoria: varía la frase y, si es un rol, preséntalo entero una vez y después cítalo por su sigla.`,
  );
});

// C-6: un apartado de pantallas admite hasta 10 figuras, cada una con su leyenda numerada.
const { erroresDeFiguras, esMockup, figurasMaximas } =
  await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');
const PANTALLA =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" font-family="Arial, sans-serif"><rect x="20" y="20" width="760" height="260" fill="#F2F4F7" stroke="#5B6B7F"/><text x="60" y="80" font-size="16">1 Bandeja</text><text x="60" y="140" font-size="16">2 Filtros</text></svg>';

test('should_allow_up_to_ten_figures_with_numbered_legend_in_mockup_apartados', () => {
  const mockup = { titulo: 'Prototipo funcional', puntos: 5, se_valorara: ['Mockup de las pantallas principales'] };
  assert.equal(esMockup(mockup), true);
  assert.equal(esMockup({ titulo: MEM.apartados[0]!.titulo, se_valorara: MEM.apartados[0]!.se_valorara }), false);
  const bloque = (i: number, leyenda: boolean) => ({
    subtitulo: `Pantalla ${i}`,
    parrafos: ['La figura siguiente muestra la pantalla con sus llamadas numeradas.'],
    figura: { titulo: `Pantalla ${i} del expediente`, svg: PANTALLA },
    ...(leyenda ? { lista_numerada: ['Bandeja de expedientes.', 'Filtros por estado.'] } : {}),
  });
  const seis = Array.from({ length: 6 }, (_, i) => bloque(i + 1, true));
  assert.equal(erroresDeFiguras(seis, figurasMaximas(mockup)), null, 'seis pantallas caben');
  assert.match(
    erroresDeFiguras(seis) ?? '',
    /El apartado trae 6 figuras y el máximo es 4/,
    'fuera de un mockup, el tope de siempre',
  );
  assert.match(
    erroresDeFiguras(
      Array.from({ length: 11 }, (_, i) => bloque(i + 1, true)),
      figurasMaximas(mockup),
    ) ?? '',
    /El apartado trae 11 figuras y el máximo es 10/,
  );
  const c = { automaticos: [], apartado: mockup, cuota: null };
  const a = {
    titulo: mockup.titulo,
    bloques: [bloque(1, true), bloque(2, false)],
    cubre: [{ item: mockup.se_valorara[0]!, bloque: 1 }],
    compromisos: [],
  };
  const blandos = revisarApartado(a, c).blandos;
  assert.ok(
    blandos.includes(
      'Cada pantalla lleva sus llamadas numeradas (1, 2, 3…) dentro del SVG y, en el mismo bloque, la lista numerada que las explica: falta en los bloques 2.',
    ),
    blandos.join('\n'),
  );
  assert.ok(
    blandos.includes('Con varias pantallas, añade una tabla de pantallas (pantalla, para qué sirve, quién la usa).'),
  );
});

// Lo que la prudencia marcaba sin ser un aplazamiento, y lo que se le escapaba.
const { problemasDeSolucion } = await import('../../src/dominios/licitaciones/oferta/solucion.js');
const solucionDe = () => estrategia().solucion;
const SIN_FUGAS = { automaticos: [] };

test('should_not_count_the_human_review_flow_as_a_postponement', () => {
  const flujo =
    'Cada borrador generado queda sujeto a validación del técnico antes de enviarse. Los expedientes pendientes de validación aparecen en la bandeja del gestor. Las respuestas sujetas a aprobación del jefe de servicio se registran con su firma.';
  assert.deepEqual(aplazamientosEn(flujo), [], 'la revisión humana es diseño, no un valor aplazado');
  assert.deepEqual(
    aplazamientosEn('La región de alojamiento queda sujeta a aprobación del órgano.'),
    ['La región de alojamiento queda sujeta a aprobación del órgano.'],
    'un valor que se aplaza sigue contando',
  );
});

test('should_not_let_a_generic_reserved_parameter_silence_the_postponement_detector', () => {
  const texto =
    'El calendario queda a acordar con el responsable del contrato. Los hitos del calendario están pendientes de definir.';
  assert.equal(aplazamientosEn(texto, ['calendario']).length, 2, 'un nombre genérico no exime');
  assert.deepEqual(
    aplazamientosEn('La región de alojamiento de los datos queda a acordar.', ['Región de alojamiento de los datos']),
    [],
    'uno concreto, sí',
  );
  const s = solucionDe();
  s.pendientes_legitimos = [
    {
      parametro: 'calendario',
      cita: 'El plan de trabajo lo aprobará el órgano de contratación',
      por_defecto: 'Plan en la semana 2',
    },
  ];
  assert.ok(
    problemasDeSolucion(s, { fugas: SIN_FUGAS }).blandos.some((b) =>
      b.startsWith('El pendiente «calendario» nombra el parámetro de forma genérica'),
    ),
  );
});

test('should_check_leaks_in_the_default_proposal_of_a_reserved_parameter', () => {
  const fugas = {
    automaticos: [
      {
        criterio: 'Reducción del plazo de entrega',
        archivo: 'Archivo electrónico nº 2',
        marcas: ['reducción del plazo de entrega'],
      },
    ],
  };
  const s = solucionDe();
  s.pendientes_legitimos = [
    {
      parametro: 'Plazo de puesta en producción',
      cita: 'El plazo de puesta en producción lo fijará el órgano',
      por_defecto: 'reducción del plazo de entrega a 8 semanas',
    },
  ];
  assert.match(
    problemasDeSolucion(s, { fugas }).duros.join(' '),
    /La solución delata «reducción del plazo de entrega»/,
  );
});

test('should_not_ask_a_date_for_cadences_durations_or_month_and_year', () => {
  const e = estrategia();
  const inicio = e.solucion.calendario.inicio;
  const conHecho = (valor: string) => {
    const x = estrategia();
    x.hechos.push({ clave: 'cal', categoria: 'calendario', sobre: 'calendario', valor, palabras: ['calendario'] });
    return problemasDePrudencia(x, { mem: MEM, inicio }).filter((p) => p.startsWith('El hecho de calendario'));
  };
  for (const v of [
    'Comité de seguimiento cada 15 días',
    'Duración total 12 semanas',
    'Cierre en noviembre de 2026',
    'Reunión quincenal de seguimiento',
  ])
    assert.deepEqual(conHecho(v), [], v);
  assert.equal(conHecho('Entrega del piloto en la semana 6').length, 1, 'lo relativo sí');
});

test('should_find_quotes_with_omissions_and_only_warn_when_the_dossier_was_cut', () => {
  const s = solucionDe();
  s.pendientes_legitimos = [
    {
      parametro: 'Región de alojamiento de los datos',
      cita: '«La región de alojamiento […] la determinará el órgano de contratación»',
      por_defecto: 'Región de la UE',
    },
  ];
  const fuentes =
    'Cláusula 7. La región de alojamiento de los datos personales la determinará el órgano de contratación antes del inicio.';
  assert.deepEqual(
    problemasDeSolucion(s, { fugas: SIN_FUGAS, fuentes }).blandos,
    [],
    'cada trozo de la cita está en el pliego',
  );
  s.pendientes_legitimos[0]!.cita = 'La ubicación de los servidores será decidida por la entidad contratante';
  assert.equal(
    problemasDeSolucion(s, { fugas: SIN_FUGAS, fuentes }).blandos.length,
    1,
    'sin recorte, una cita que no está se rechaza',
  );
  const recortado = problemasDeSolucion(s, { fugas: SIN_FUGAS, fuentes, recortado: true });
  assert.deepEqual(
    [recortado.blandos.length, recortado.avisos.length],
    [0, 1],
    'con secciones recortadas puede estar en lo recortado: aviso',
  );
});
