import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  camposDeDecisiones,
  camposDePropuesta,
  camposIniciales,
  importeFormulario,
  motivosDePropuesta,
  propuestaPosterior,
  textoMotivoAutomatico,
  textoOpcionPrecio,
  textoUmbralPrecio,
  candidatosEquipo,
  cita,
  decisionesIniciales,
  documentosDeArchivo,
  estadoGuion,
  guionDesfasado,
  hayCambios,
  leerDecisiones,
  nombrePersona,
  plazoDiscrepa,
  resumenGuion,
  sincronizarAutomaticos,
  ofertasEconomicas,
  referenciaPrecio,
  textoLotesOferta,
  textoPrecioUnitario,
  textoBajaPrecio,
  textoImpuesto,
  textoFormatoMemoria,
  textoPuntosAutomaticos,
  automaticoDeLote,
  lotesDelAmbito,
  puntosEstimados,
  textoPuntosFila,
  bloqueoAutomatico,
} from './ofertaFormato.js';
import { faltaParaRedactar } from './memoriaFormato.js';
import { ARCHIVO_1, GUION, DECISIONES, OFERTA } from '../../tests/fixtures/ofertaFixtures.mjs';

// CASO_E (lotes 2 y 4): un precio por alumno por lote, con máximos distintos, y un criterio con tramos en los dos.
const GUION_CASO_E = {
  ...GUION,
  oferta_economica: null,
  lotes: ['2', '4'],
  ofertas_economicas: [
    {
      lotes: ['2'],
      formula: 'P',
      presupuesto_base: 6063.75,
      impuesto_aparte: 'IGIC',
      precios_unitarios: [{ concepto: 'Alumno', unidad: 'alumno', maximo: 110.25, cantidad: null }],
      archivo: 'Archivo electrónico nº 2',
    },
    {
      lotes: ['4'],
      formula: 'P',
      presupuesto_base: 756,
      impuesto_aparte: 'IGIC',
      precios_unitarios: [{ concepto: 'Alumno', unidad: 'alumno', maximo: 94.5, cantidad: null }],
      archivo: 'Archivo electrónico nº 2',
    },
  ],
  automaticos: [
    {
      criterio: 'Tutorización',
      puntos: 10,
      lotes: ['2', '4'],
      tramos: [
        { descripcion: 'En 48 h', puntos: 5 },
        { descripcion: 'En 24 h o menos', puntos: 10 },
      ],
      casilla_en: 'Anexo VI',
      archivo: 'Archivo electrónico nº 2',
      marcas: [],
    },
    {
      criterio: 'Plataforma propia',
      puntos: 4,
      casilla_en: 'Anexo VI',
      archivo: 'Archivo electrónico nº 2',
      marcas: [],
    },
  ],
};

const PRECIO = {
  base: 100000,
  unidad: null,
  referencia: 'presupuesto',
  comparables: 34,
  ofertas_esperadas: 3,
  umbral_anormal: 0.2,
  equilibrio: { baja: 0.123, importe: 87700, ganadas: 0.8 },
  maxima: { baja: 0.19, importe: 81000, ganadas: 0.97 },
  avisos: [],
};

const PROPUESTA = {
  guion_id: 1,
  creada_en: '2026-10-05T12:00:00Z',
  agente: 'oferta-licitaciones',
  avisos: [],
  datos: {
    lotes: [],
    equipo: [{ persona_id: 3, rol_en_la_oferta: 'Jefa de proyecto', motivo: 'Ocho años de proyectos de datos.' }],
    automaticos: [
      { criterio: 'ISO 14001', tipo: 'acreditacion', nos_acogemos: false, motivo: 'No consta en el perfil.' },
      {
        criterio: 'Discapacidad ≥ 10 %',
        tipo: 'compromiso',
        nos_acogemos: true,
        nivel: '10 % o más',
        motivo: 'Se ofrece entero.',
      },
    ],
    herramientas: ['Power BI'],
    enfoque: 'Trato directo.',
    resumen: 'Confirma la plantilla.',
  },
  decisiones: {
    lotes: [],
    equipo: [{ persona_id: 3, rol_en_la_oferta: 'Jefa de proyecto' }],
    automaticos: [
      { criterio: 'ISO 14001', lote: null, nos_acogemos: false, tramo: null, nota: 'No consta en el perfil.' },
      {
        criterio: 'Discapacidad ≥ 10 %',
        lote: null,
        nos_acogemos: true,
        tramo: null,
        nota: '10 % o más. Se ofrece entero.',
      },
    ],
    herramientas: ['Power BI'],
    enfoque: 'Trato directo.',
    ofertas: [{ lote: null, pendiente: true, importe: null, unitarios: [] }],
  },
};

// CASO_B (lote 1): C1, C3 y C4 marcados sumaban «35 de 60». C4 por tramos (2 certificaciones → 4 pt);
// C1 y C3 son fórmulas (15 × (T – 2) / 3) que el guion no trae estructuradas: «hasta».
const CASO_B = [
  {
    criterio: 'C1. Años de docencia previa del profesorado',
    puntos: 15,
    casilla_en: 'Anexo III BIS, 1.C1',
    archivo: 'Sobre único',
    marcas: [],
  },
  {
    criterio: 'C2. Horas de docencia acreditadas',
    puntos: 15,
    casilla_en: 'Anexo III BIS, 1.C2',
    archivo: 'Sobre único',
    marcas: [],
  },
  {
    criterio: 'C3. Experiencia profesional fuera de la docencia',
    puntos: 15,
    casilla_en: 'Anexo III BIS, 1.C3',
    archivo: 'Sobre único',
    marcas: [],
  },
  {
    criterio: 'C4. Titulaciones y certificaciones del profesorado',
    puntos: 5,
    casilla_en: 'Anexo III BIS, 1.C4',
    archivo: 'Sobre único',
    marcas: [],
    tramos: [
      { descripcion: 'Una certificación', puntos: 2, valor: '1' },
      { descripcion: 'Dos certificaciones', puntos: 4, valor: '2' },
      { descripcion: 'Tres o más', puntos: 5, valor: '3' },
    ],
  },
  {
    criterio: 'C5. Aula virtual y acceso a los materiales',
    puntos: 5,
    casilla_en: 'Anexo III BIS, 1.C5',
    archivo: 'Sobre único',
    marcas: [],
  },
  {
    criterio: 'C6. Reserva de plazas en ediciones abiertas',
    puntos: 5,
    casilla_en: 'Anexo III BIS, 1.C6',
    archivo: 'Sobre único',
    marcas: [],
  },
];

const DECIDIDOS_CASO_B = [
  { criterio: CASO_B[0].criterio, nos_acogemos: true, valor: 2.25, evidencia: 'CV de Persona F' },
  { criterio: CASO_B[2].criterio, nos_acogemos: true, valor: '4', evidencia: 'CV de Persona F' },
  { criterio: CASO_B[3].criterio, nos_acogemos: true, valor: '2', evidencia: 'Certificados de analítica y de datos' },
];

test('should_cite_document_and_page_of_the_tender', () => {
  assert.equal(cita({ documento: 'PCAP', pagina: 41 }), 'PCAP, pág. 41');
  assert.equal(cita({ documento: 'PPT' }), 'PPT');
  assert.equal(cita(null), null);
});

test('should_tell_when_the_outline_is_older_than_the_sheet', () => {
  assert.equal(guionDesfasado(OFERTA), false);
  assert.equal(guionDesfasado({ ...OFERTA, guion_desfasado: true }), true);
  assert.equal(
    guionDesfasado({ ...OFERTA, guion_desfasado: undefined }, 10),
    true,
    'sin dato del servidor, compara la ficha de origen',
  );
  assert.equal(guionDesfasado({ ...OFERTA, guion_desfasado: undefined }, 9), false);
  assert.equal(guionDesfasado({ ...OFERTA, guion: null }), false);
});

test('should_state_the_outline_step_from_queue_sheet_and_tender_files', () => {
  assert.deepEqual(estadoGuion(OFERTA), { clave: 'hecho', texto: 'Guion v1' });
  assert.equal(estadoGuion({ ...OFERTA, guion_en_curso: { estado: 'generando' } }).texto, 'Extrayendo del pliego…');
  assert.equal(estadoGuion({ ...OFERTA, guion_en_curso: { estado: 'en_cola' } }).clave, 'en_curso');
  assert.equal(estadoGuion({ ...OFERTA, guion: null, ficha_aprobada: false }).clave, 'bloqueado');
  assert.equal(estadoGuion({ ...OFERTA, guion: null, pliegos_listos: false }).clave, 'bloqueado');
  assert.equal(estadoGuion({ ...OFERTA, guion: null }).clave, 'pendiente');
  assert.equal(estadoGuion({ ...OFERTA, guion_desfasado: true }).clave, 'desfasado');
});

test('should_summarize_the_outline_in_one_line', () => {
  assert.equal(
    resumenGuion(GUION),
    '2 archivos electrónicos · memoria de 4 apartados (25 puntos, máx. 25 págs.) · 2 criterios automáticos · hasta mar 13 oct',
  );
  assert.equal(
    resumenGuion({ ...GUION, memoria: null, automaticos: [], plazo: { fecha_limite: null, canal: 'PLACSP' } }),
    '2 archivos electrónicos · sin memoria técnica',
  );
  assert.equal(
    resumenGuion({
      ...GUION,
      memoria: { ...GUION.memoria, valorable: false, limite_paginas: null },
      automaticos: [],
      plazo: { fecha_limite: null, canal: 'PLACSP' },
    }),
    '2 archivos electrónicos · memoria no valorable de 4 apartados',
  );
});

test('should_ask_to_extract_the_outline_again_when_the_lots_we_bid_for_changed', () => {
  const otros = { ...OFERTA, lotes_cambiados: true };
  assert.deepEqual(estadoGuion(otros), { clave: 'desfasado', texto: `Guion v${OFERTA.guion.version}, de otros lotes` });
  assert.ok(faltaParaRedactar(otros).includes('volver a extraer el guion: se hizo para otros lotes'));
  assert.equal(estadoGuion({ ...OFERTA, lotes_cambiados: false }).clave, 'hecho');
});

test('should_describe_the_documents_of_an_electronic_file', () => {
  const docs = documentosDeArchivo(ARCHIVO_1);
  assert.deepEqual(docs[0], {
    nombre: 'DEUC',
    tipo: 'DEUC',
    obligatorio: true,
    quien: 'Lo prepara una persona',
    modelo: 'Anexo II',
    cita: 'PCAP, pág. 41',
    notas: null,
  });
  assert.equal(docs[1].quien, 'La redacta Hermes');
  assert.equal(docs[1].cita, 'PCAP, pág. 41', 'sin origen propio, la cita del archivo');
  assert.deepEqual(documentosDeArchivo({ nombre: 'x' }), []);
});

test('should_describe_the_format_the_tender_fixes_for_the_report', () => {
  assert.equal(textoFormatoMemoria(GUION.memoria), 'máx. 25 págs. · Arial 11 · interlineado sencillo');
  assert.equal(
    textoFormatoMemoria({ limite_paginas: null, limite_detalle: 'no fija extensión' }),
    'sin límite de páginas (no fija extensión)',
  );
  assert.equal(textoFormatoMemoria(null), null);
});

test('should_flag_a_deadline_that_differs_from_placsp', () => {
  assert.equal(plazoDiscrepa('2026-10-13T14:00:00', '2026-10-13T14:00:00'), false);
  assert.equal(plazoDiscrepa('2026-10-13', '2026-10-13T14:00:00'), false, 'sin hora en el guion no se compara la hora');
  assert.equal(plazoDiscrepa('2026-10-13T12:00:00', '2026-10-13T14:00:00'), true);
  assert.equal(plazoDiscrepa('2026-10-14', '2026-10-13T14:00:00'), true);
  assert.equal(plazoDiscrepa(null, '2026-10-13T14:00:00'), false);
});

test('should_keep_decided_automatic_criteria_in_outline_order_and_add_the_new_ones', () => {
  const filas = sincronizarAutomaticos(
    [
      { criterio: 'Discapacidad ≥ 10 %', nos_acogemos: true, nota: 'ok' },
      { criterio: 'Ya no existe', nos_acogemos: true },
    ],
    GUION.automaticos,
  );
  assert.deepEqual(
    filas,
    [
      { criterio: 'ISO 14001', lote: null, nos_acogemos: false, tramo: null, valor: '', evidencia: '', nota: '' },
      {
        criterio: 'Discapacidad ≥ 10 %',
        lote: null,
        nos_acogemos: true,
        tramo: 'Discapacidad ≥ 10 %',
        valor: '',
        evidencia: '',
        nota: 'ok',
      },
    ],
    'un criterio de un solo tramo al que nos acogemos lleva ese tramo',
  );
  assert.deepEqual(sincronizarAutomaticos(undefined, []), []);
});

test('should_drop_automatic_decisions_of_lots_we_no_longer_bid_for', () => {
  const decididos = [
    { criterio: 'Tutorización', lote: '1', nos_acogemos: true, tramo: 'En 24 h o menos' },
    { criterio: 'Tutorización', lote: '2', nos_acogemos: true, tramo: 'En 48 h' },
  ];
  const filas = sincronizarAutomaticos(decididos, GUION_CASO_E.automaticos, ['2']);
  assert.deepEqual(
    filas.map((f) => [f.criterio, f.lote, f.tramo]),
    [
      ['Tutorización', '2', 'En 48 h'],
      ['Plataforma propia', null, null],
    ],
    'CASO_D: el lote 1 ya no está',
  );
  assert.deepEqual(
    sincronizarAutomaticos([], GUION_CASO_E.automaticos, ['2', '4']).map((f) => f.lote),
    ['2', '4', null],
  );
});

test('should_start_decisions_from_the_screening_scope', () => {
  const ambito = { por_lotes: true, lotes: [{ id: '1' }, { id: '3' }] };
  assert.deepEqual(decisionesIniciales(GUION, ambito).lotes, ['1', '3']);
  assert.deepEqual(
    decisionesIniciales({ ...GUION, lotes: ['3'] }, ambito).lotes,
    ['1', '3'],
    'los lotes son los de interés, aunque el guion sea de otros',
  );
  assert.deepEqual(decisionesIniciales(GUION, { por_lotes: false, lotes: [] }).lotes, [], 'contrato entero');
  const inicial = decisionesIniciales(GUION, null);
  assert.deepEqual(inicial.lotes, []);
  assert.equal(inicial.automaticos.length, 2);
  assert.deepEqual(inicial.ofertas, [{ lote: null, pendiente: true, importe: '', unitarios: [] }]);
  assert.deepEqual(inicial.equipo, []);
  const casoE = decisionesIniciales(GUION_CASO_E, { por_lotes: true, lotes: [{ id: '2' }, { id: '4' }] });
  assert.deepEqual(
    casoE.ofertas,
    [
      { lote: '2', pendiente: true, importe: '', unitarios: [{ concepto: 'Alumno', precio: '' }] },
      { lote: '4', pendiente: true, importe: '', unitarios: [{ concepto: 'Alumno', precio: '' }] },
    ],
    'un precio por alumno en cada lote',
  );
});

test('should_round_trip_saved_decisions_through_the_form', () => {
  const campos = camposDeDecisiones(DECISIONES, GUION);
  assert.deepEqual(campos.ofertas, [{ lote: null, pendiente: false, importe: '87.500', unitarios: [] }]);
  assert.equal(campos.herramientas, 'Power BI, Python');
  assert.deepEqual(campos.equipo, [
    { persona_id: 3, rol_en_la_oferta: 'Jefa de proyecto', dedicacion: '50 %', lotes: [] },
  ]);
  assert.deepEqual(leerDecisiones(campos).body, DECISIONES);
  const sinPrecio = camposDeDecisiones(
    { ...DECISIONES, ofertas: [{ lote: null, pendiente: true, importe: null, unitarios: [] }] },
    GUION,
  );
  assert.deepEqual(sinPrecio.ofertas, [{ lote: null, pendiente: true, importe: '', unitarios: [] }]);
  const v1 = camposDeDecisiones(
    { ...DECISIONES, ofertas: undefined, precio: { importe: 72, pendiente: false }, lotes: ['2', '4'] },
    GUION_CASO_E,
  );
  assert.deepEqual(
    v1.ofertas.map((o) => o.unitarios[0].precio),
    ['72', '72'],
    'un precio de antes vale para cada lote',
  );
});

test('should_reject_a_bad_price_and_a_person_without_role', () => {
  const campos = camposDeDecisiones(DECISIONES, GUION);
  const con = (importe) => ({ ...campos, ofertas: [{ ...campos.ofertas[0], importe }] });
  assert.match(leerDecisiones(con('mucho')).error, /número en €/);
  assert.match(leerDecisiones(con('0')).error, /número en €/);
  assert.match(
    leerDecisiones({ ...campos, equipo: [{ persona_id: 3, rol_en_la_oferta: ' ' }] }).error,
    /rol en la oferta/,
  );
  assert.match(leerDecisiones({ ...campos, equipo: [{ persona_id: '', rol_en_la_oferta: 'Jefa' }] }).error, /Elige/);
});

test('should_clear_pending_when_a_price_is_given_and_keep_it_otherwise', () => {
  const campos = camposDeDecisiones(DECISIONES, GUION);
  const oferta = (cambio) =>
    leerDecisiones({ ...campos, ofertas: [{ ...campos.ofertas[0], ...cambio }] }).body.ofertas[0];
  assert.deepEqual(oferta({ importe: '95.000,50', pendiente: true }), {
    lote: null,
    pendiente: false,
    importe: 95000.5,
    unitarios: [],
  });
  assert.deepEqual(oferta({ importe: '', pendiente: true }), {
    lote: null,
    pendiente: true,
    importe: null,
    unitarios: [],
  });
  assert.deepEqual(oferta({ importe: ' ', pendiente: false }), {
    lote: null,
    pendiente: false,
    importe: null,
    unitarios: [],
  });
  const body = leerDecisiones({
    ...campos,
    equipo: [{ persona_id: '3', rol_en_la_oferta: ' Analista ', dedicacion: '' }],
    automaticos: [{ criterio: 'ISO 14001', nos_acogemos: true, tramo: 'ISO 14001', nota: ' ' }],
  }).body;
  assert.deepEqual(
    body.equipo,
    [{ persona_id: 3, rol_en_la_oferta: 'Analista' }],
    'sin dedicación ni lotes no se envían',
  );
  assert.deepEqual(
    body.automaticos,
    [{ criterio: 'ISO 14001', lote: null, nos_acogemos: true, tramo: 'ISO 14001' }],
    'una nota vacía no se envía',
  );
  const casoE = camposDeDecisiones({ ...DECISIONES, lotes: ['2', '4'], ofertas: [] }, GUION_CASO_E);
  casoE.ofertas[0].unitarios[0].precio = '98,50';
  assert.deepEqual(
    leerDecisiones(casoE).body.ofertas,
    [
      { lote: '2', pendiente: false, importe: null, unitarios: [{ concepto: 'Alumno', precio: 98.5 }] },
      { lote: '4', pendiente: true, importe: null, unitarios: [] },
    ],
    'cada lote con lo suyo',
  );
});

test('should_detect_unsaved_changes_regardless_of_key_order', () => {
  const base = camposDeDecisiones(DECISIONES, GUION);
  assert.equal(hayCambios({ ...base }, base), false);
  assert.equal(hayCambios({ ...base, enfoque: 'otro' }, base), true);
  assert.equal(
    hayCambios(
      { ...base, equipo: [{ lotes: [], dedicacion: '50 %', rol_en_la_oferta: 'Jefa de proyecto', persona_id: 3 }] },
      base,
    ),
    false,
  );
  assert.equal(hayCambios({ ...base, equipo: [] }, base), true);
});

test('should_count_the_automatic_points_we_go_for', () => {
  assert.equal(
    textoPuntosAutomaticos(GUION.automaticos, DECISIONES.automaticos),
    'Nos acogemos a 1 de 2 criterios automáticos. Puntos estimados: 0 de 25 (1 sin poder calcular: hasta 15 pt).',
  );
  assert.equal(
    textoPuntosAutomaticos(GUION.automaticos, []),
    'Nos acogemos a 0 de 2 criterios automáticos. Puntos estimados: 0 de 25.',
  );
  assert.equal(textoPuntosAutomaticos([], []), null);
  const decididos = [
    {
      criterio: 'Tutorización',
      lote: '2',
      nos_acogemos: true,
      tramo: 'En 48 h',
      evidencia: 'Turnos de tutoría de 2025',
    },
    { criterio: 'Tutorización', lote: '4', nos_acogemos: true, tramo: 'En 24 h o menos' },
    { criterio: 'Plataforma propia', lote: null, nos_acogemos: false },
  ];
  assert.equal(
    textoPuntosAutomaticos(GUION_CASO_E.automaticos, decididos, ['2', '4']),
    'Nos acogemos a 2 de 3 criterios automáticos. Puntos estimados: 15 de 24.',
    'por tramo',
  );
});

test('should_compute_the_bid_discount_over_the_base_budget', () => {
  assert.match(textoBajaPrecio(87500, 100000), /^Baja del 12,5 % sobre 100\.000\s€\.$/);
  assert.match(textoBajaPrecio(120000, 100000), /^Por encima del presupuesto base/);
  assert.equal(textoBajaPrecio(null, 100000), null);
  assert.equal(textoBajaPrecio(87500, null), null);
});

test('should_compare_a_unit_price_with_the_maximum_unit_price_when_the_bid_is_per_unit', () => {
  const oe = { presupuesto_base: 18557, impuesto_aparte: 'exento', precio_unitario: { unidad: 'hora', maximo: 1.54 } };
  const ref = referenciaPrecio(oe);
  assert.deepEqual(ref, { base: 1.54, unidad: 'hora' });
  assert.match(textoBajaPrecio(1.5, ref.base, ref.unidad), /^Baja del 2,6 % sobre 1,54\s€ por hora\.$/);
  assert.match(textoBajaPrecio(1.7, ref.base, ref.unidad), /^Por encima del precio máximo \(1,54\s€ por hora\)/);
  assert.deepEqual(referenciaPrecio({ presupuesto_base: 100000 }), { base: 100000, unidad: null });
});

test('should_say_exempt_instead_of_tax_apart_when_the_service_is_tax_exempt', () => {
  assert.equal(textoImpuesto('exento'), 'exento de impuestos');
  assert.equal(textoImpuesto('IGIC'), 'IGIC aparte');
  assert.equal(textoImpuesto(null), null);
});

test('should_offer_suggested_candidates_first_without_repeating_or_listing_the_chosen', () => {
  const equipo = {
    requisitos: [
      {
        internos: [{ id: 1, nombre: 'Ana', rol: 'Analista', tipo: 'interno', puntuacion: 60 }],
        externos: [{ id: 7, nombre: 'Luis', rol: 'Consultor', tipo: 'externo', puntuacion: 80 }],
      },
      {
        internos: [
          { id: 1, nombre: 'Ana', rol: 'Analista', tipo: 'interno', puntuacion: 90 },
          { id: 3, nombre: 'Elisa', rol: 'Jefa', tipo: 'interno', puntuacion: 70 },
        ],
        externos: [],
      },
    ],
  };
  const personas = [
    { id: 1, nombre: 'Ana', tipo: 'interno', rol: 'Analista' },
    { id: 2, nombre: 'Paco', tipo: 'interno', rol: 'CEO' },
    { id: 8, nombre: 'Marta', tipo: 'externo' },
  ];
  const c = candidatosEquipo(equipo, personas, [3]);
  assert.deepEqual(
    c.sugeridos.map((p) => [p.id, p.puntuacion]),
    [
      [1, 90],
      [7, 80],
    ],
  );
  assert.deepEqual(
    c.internos.map((p) => p.id),
    [2],
  );
  assert.deepEqual(
    c.externos.map((p) => [p.id, p.rol]),
    [[8, '']],
  );
  assert.deepEqual(candidatosEquipo(null, [], []), { sugeridos: [], internos: [], externos: [] });
  assert.equal(nombrePersona(7, personas, equipo), 'Luis');
  assert.equal(nombrePersona(2, personas), 'Paco');
  assert.equal(nombrePersona(99, personas), 'persona 99');
});

test('should_open_form_with_lots_pending_and_empty_when_nothing_is_saved_even_with_suggested_price', () => {
  const sinGuardar = {
    ...OFERTA,
    decisiones: null,
    propuesta_decisiones: PROPUESTA,
    precios_sugeridos: { '': PRECIO },
  };
  const c = camposIniciales(sinGuardar);
  assert.deepEqual(
    [c.equipo[0].rol_en_la_oferta, c.herramientas, c.ofertas[0].importe, c.ofertas[0].pendiente],
    ['Jefa de proyecto', 'Power BI', '', true],
  );
  assert.deepEqual(
    c.automaticos.map((a) => a.nos_acogemos),
    [false, true],
  );
  assert.equal(
    camposIniciales({ ...OFERTA, decisiones: null, precios_sugeridos: {} }).ofertas[0].pendiente,
    true,
    'sin propuesta ni precio, vacío',
  );
  assert.equal(importeFormulario(1.408), '1,408');
  const casoE = {
    ...OFERTA,
    guion: { ...OFERTA.guion, datos: GUION_CASO_E },
    decisiones: null,
    precios_sugeridos: { 2: { ...PRECIO, equilibrio: { baja: 0.15, importe: 98.5 } }, 4: null },
  };
  assert.deepEqual(
    camposIniciales(casoE, { por_lotes: true, lotes: [{ id: '2' }, { id: '4' }] }).ofertas.map((o) => [
      o.lote,
      o.unitarios[0].precio,
      o.pendiente,
    ]),
    [
      ['2', '', true],
      ['4', '', true],
    ],
  );
});

test('should_not_fill_proposal_form_with_balance_price', () => {
  const sinGuardar = {
    ...OFERTA,
    decisiones: null,
    propuesta_decisiones: PROPUESTA,
    precios_sugeridos: { '': PRECIO },
  };
  const c = camposDePropuesta(sinGuardar);
  assert.deepEqual([c.ofertas[0].importe, c.ofertas[0].pendiente], ['', true]);
});

test('should_keep_saved_prices_when_reopening_the_form', () => {
  const c = camposIniciales({ ...OFERTA, propuesta_decisiones: PROPUESTA, precios_sugeridos: { '': PRECIO } });
  assert.equal(c.ofertas[0].importe, '87.500');
  assert.equal(c.ofertas[0].pendiente, false);
});

test('should_offer_to_load_a_proposal_newer_than_the_saved_decisions', () => {
  assert.equal(propuestaPosterior({ ...OFERTA, propuesta_decisiones: PROPUESTA }), true);
  assert.equal(
    propuestaPosterior({ ...OFERTA, propuesta_decisiones: { ...PROPUESTA, creada_en: '2026-10-05T10:30:00Z' } }),
    false,
  );
  assert.equal(propuestaPosterior({ ...OFERTA, decisiones: null, propuesta_decisiones: PROPUESTA }), false);
});

test('should_explain_why_hermes_proposed_each_person_and_criterion', () => {
  const m = motivosDePropuesta(PROPUESTA);
  assert.equal(m.equipo.get(3), 'Ocho años de proyectos de datos.');
  assert.deepEqual(m.automaticos.get('Discapacidad ≥ 10 %|'), {
    tipo: 'compromiso',
    cumple: null,
    nivel: '10 % o más',
    nos_acogemos: true,
    capacidad: null,
    evidencia: null,
    documento_en_mano: null,
    motivo: 'Se ofrece entero.',
  });
  assert.equal(textoMotivoAutomatico(m.automaticos.get('Discapacidad ≥ 10 %|')), 'tramo «10 % o más»');
  assert.equal(
    textoMotivoAutomatico({
      tipo: 'compromiso',
      nos_acogemos: true,
      nivel: '2 h o menos',
      capacidad: 'demostrada',
      evidencia: 'turnos de 2025',
    }),
    'tramo «2 h o menos» (capacidad demostrada: turnos de 2025)',
  );
  assert.equal(
    textoMotivoAutomatico(
      { tipo: 'acreditacion', nos_acogemos: false, documento_en_mano: false },
      { exige_documento: 'el Dossier Técnico Homologado del fabricante' },
    ),
    '0 puntos — exige el Dossier Técnico Homologado del fabricante, que no está en la Biblioteca',
  );
  assert.equal(textoMotivoAutomatico({ tipo: 'acreditacion', cumple: 'falta_dato' }), 'falta el dato: confírmalo');
  assert.equal(textoMotivoAutomatico({ tipo: 'acreditacion', cumple: 'si' }), 'acreditado');
  assert.equal(
    textoMotivoAutomatico({ tipo: 'compromiso', nos_acogemos: false, cumple: null }),
    'compromiso: no nos acogemos',
    'sin poder cumplirlo no se acoge',
  );
  assert.equal(
    textoMotivoAutomatico({ tipo: 'compromiso', nos_acogemos: false, cumple: 'no' }),
    'no lo cumplimos',
    'el que pide un dossier se lee como una acreditación',
  );
  assert.equal(motivosDePropuesta(null).equipo.size, 0);
});

test('should_describe_each_price_option_with_its_discount_and_how_often_it_would_have_won', () => {
  assert.match(
    textoOpcionPrecio(PRECIO.equilibrio, PRECIO),
    /^87\.700\s€ · baja del 12,3 % · habría ganado en precio el 80 % de 34 adjudicaciones parecidas$/,
  );
  const hora = { ...PRECIO, unidad: 'hora', comparables: 1 };
  assert.match(
    textoOpcionPrecio({ baja: 0.12, importe: 1.408, ganadas: 1 }, hora),
    /^1,408\s€ por hora · baja del 12 % · habría ganado en precio el 100 % de 1 adjudicación parecida$/,
  );
  assert.equal(textoOpcionPrecio(null, PRECIO), null);
  assert.match(
    textoUmbralPrecio(PRECIO),
    /^Umbral de anormalidad estimado: baja del 20 % \(3 ofertas esperadas, art\. 85 RGLCAP\)/,
  );
  assert.equal(textoUmbralPrecio({ ...PRECIO, umbral_anormal: null }), null);
});

test('should_fill_the_decision_lots_with_the_lots_we_bid_for_whatever_was_saved_or_proposed', () => {
  const ambito = { por_lotes: true, lotes: [{ id: '2' }, { id: '4' }] };
  const guardadas = {
    ...OFERTA,
    decisiones: { ...OFERTA.decisiones, datos: { ...DECISIONES, lotes: ['2', '6', '4'] } },
  };
  assert.deepEqual(camposIniciales(guardadas, ambito).lotes, ['2', '4']);
  assert.deepEqual(camposIniciales(guardadas).lotes, ['2', '6', '4'], 'sin ámbito a mano, lo guardado');
  const propuesta = {
    ...OFERTA,
    decisiones: null,
    propuesta_decisiones: { ...PROPUESTA, decisiones: { ...PROPUESTA.decisiones, lotes: ['6'] } },
    precios_sugeridos: { '': PRECIO },
  };
  assert.deepEqual(camposIniciales(propuesta, ambito).lotes, ['2', '4']);
  assert.deepEqual(camposDePropuesta(propuesta, ambito).lotes, ['2', '4']);
  assert.deepEqual(lotesDelAmbito({ por_lotes: false, lotes: [] }), []);
  assert.deepEqual(lotesDelAmbito(null), []);
});

test('referenciaPrecio toma el primer precio unitario de una oferta por lote (v4) y el precio_unitario de una v3', () => {
  const v4 = {
    ofertas_economicas: [
      {
        lotes: ['2'],
        presupuesto_base: 51744,
        precios_unitarios: [{ concepto: 'Edición nivel básico', unidad: 'edición', maximo: 4704, cantidad: 6 }],
      },
    ],
  };
  assert.deepEqual(referenciaPrecio(ofertasEconomicas(v4)[0]), { base: 4704, unidad: 'edición' });
  const v3 = {
    lotes: ['2'],
    oferta_economica: { presupuesto_base: 6063.75, precio_unitario: { unidad: 'alumno', maximo: 110.25 } },
  };
  const [o] = ofertasEconomicas(v3);
  assert.deepEqual(o.lotes, ['2']);
  assert.deepEqual(o.precios_unitarios, [{ concepto: 'alumno', unidad: 'alumno', maximo: 110.25, cantidad: null }]);
  assert.deepEqual(referenciaPrecio(o), { base: 110.25, unidad: 'alumno' });
  assert.deepEqual(ofertasEconomicas({ oferta_economica: null }), []);
});

test('textoLotesOferta y textoPrecioUnitario describen la oferta de cada lote', () => {
  assert.equal(textoLotesOferta([]), null);
  assert.equal(textoLotesOferta(['2']), 'Lote 2');
  assert.equal(textoLotesOferta(['2', '4', '5']), 'Lotes 2, 4 y 5');
  assert.equal(
    textoPrecioUnitario({ concepto: 'Edición nivel básico', unidad: 'edición', maximo: 4704, cantidad: 6 }).replace(
      /\u00A0/g,
      ' ',
    ),
    'Edición nivel básico: máx. 4.704,00 € por edición × 6',
  );
  assert.equal(
    textoPrecioUnitario({ concepto: 'Informe', unidad: 'informe', maximo: null, cantidad: null }),
    'Informe: por informe, sin máximo',
  );
});

test('should_use_the_tiers_of_the_lot_when_two_criteria_share_the_same_text', () => {
  const autos = [
    {
      criterio: 'Horas adicionales',
      puntos: 10,
      lotes: ['2'],
      tramos: [
        { descripcion: '10 h', puntos: 5 },
        { descripcion: '20 h', puntos: 10 },
      ],
      casilla_en: 'A',
      archivo: 'x',
      marcas: [],
    },
    {
      criterio: 'Horas adicionales',
      puntos: 20,
      lotes: ['4'],
      tramos: [
        { descripcion: '30 h', puntos: 10 },
        { descripcion: '60 h', puntos: 20 },
      ],
      casilla_en: 'B',
      archivo: 'x',
      marcas: [],
    },
  ];
  assert.equal(automaticoDeLote(autos, 'Horas adicionales', '4').casilla_en, 'B');
  const decididos = [{ criterio: 'Horas adicionales', lote: '4', nos_acogemos: true, tramo: '60 h', evidencia: 'x' }];
  assert.equal(
    textoPuntosAutomaticos(autos, decididos, ['4']),
    'Nos acogemos a 1 de 1 criterio automático. Puntos estimados: 20 de 20.',
  );
});

test('should_estimate_points_from_the_chosen_tier_not_the_maximum', () => {
  const elegido = puntosEstimados(CASO_B[3], { nos_acogemos: true, tramo: 'Tres o más' });

  const porValor = puntosEstimados(CASO_B[3], { nos_acogemos: true, tramo: null, valor: '2' });
  const texto = textoPuntosAutomaticos(CASO_B, DECIDIDOS_CASO_B);

  assert.deepEqual(elegido, { puntos: 5, hasta: 5 }, 'el tramo elegido manda');
  assert.deepEqual(porValor, { puntos: 4, hasta: 5 }, 'sin tramo, el que casa con el valor ofertado');
  assert.deepEqual(
    puntosEstimados(CASO_B[3], { nos_acogemos: false, valor: '3' }),
    { puntos: 0, hasta: 5 },
    'sin acogernos, 0',
  );
  assert.deepEqual(
    puntosEstimados(CASO_B[3], { nos_acogemos: true, tramo: null, valor: '7' }),
    { puntos: null, hasta: 5 },
    'un valor sin tramo no se inventa',
  );
  assert.equal(
    texto,
    'Nos acogemos a 3 de 6 criterios automáticos. Puntos estimados: 4 de 60 (2 sin poder calcular: hasta 30 pt).',
  );
  assert.doesNotMatch(texto, /35 de 60/);
  assert.equal(textoPuntosFila(porValor), 'Puntos estimados: 4 de 5');
});

test('should_say_up_to_n_points_when_there_is_no_formula', () => {
  const p = puntosEstimados(CASO_B[0], DECIDIDOS_CASO_B[0]);

  const fila = textoPuntosFila(p);

  assert.deepEqual(p, { puntos: null, hasta: 15 });
  assert.equal(fila, 'Puntos estimados: sin calcular (hasta 15 pt)');
  assert.deepEqual(
    puntosEstimados(undefined, { nos_acogemos: true }),
    { puntos: null, hasta: 0 },
    'sin criterio en el guion',
  );
});

test('should_block_ticking_a_criterion_whose_note_says_no_nos_acogemos', () => {
  // CASO_E 2.3: marcado como sí con una nota que dice lo contrario.
  const fila = {
    criterio: 'Volumen de indicadores automáticos',
    lote: null,
    nos_acogemos: true,
    tramo: 'Volumen de indicadores automáticos',
    valor: '',
    evidencia: '',
    nota: 'Nos acogemos aunque no tenemos el dossier',
  };
  const casoE = { ...fila, nota: 'No nos acogemos: exige dossier técnico homologado del fabricante, que no tenemos' };
  const conDossier = {
    criterio: fila.criterio,
    puntos: 5,
    exige_documento: 'Dossier técnico homologado del fabricante',
  };

  const bloqueo = bloqueoAutomatico({ ...casoE, nota: '  NO NOS ACÓGEMOS: falta el dossier' });
  const leido = leerDecisiones({ automaticos: [casoE] });

  assert.equal(
    bloqueo,
    'La nota dice que no nos acogemos: desmarca el criterio o cambia la nota',
    'sin distinguir mayúsculas ni tildes',
  );
  assert.equal(
    leido.error,
    'Volumen de indicadores automáticos: La nota dice que no nos acogemos: desmarca el criterio o cambia la nota.',
  );
  assert.equal(bloqueoAutomatico({ ...casoE, nos_acogemos: false }), null, 'desmarcado se puede guardar');
  assert.equal(bloqueoAutomatico(fila), null, 'la nota no empieza por «No nos acogemos»');
  assert.match(
    bloqueoAutomatico({ ...fila, nota: '' }, conDossier),
    /^Pide Dossier técnico homologado del fabricante: di en «Evidencia» dónde consta/,
  );
  assert.equal(bloqueoAutomatico({ ...fila, nota: '', evidencia: 'Dossier en la Biblioteca' }, conDossier), null);
});

test('should_send_the_offered_value_only_when_we_go_for_the_criterion', () => {
  const base = {
    criterio: 'Alumnas adicionales',
    lote: null,
    nos_acogemos: true,
    tramo: 'Alumnas adicionales',
    evidencia: '',
    nota: '',
  };

  const leido = leerDecisiones({
    automaticos: [
      { ...base, valor: '30' },
      { ...base, criterio: 'Otro', nos_acogemos: false, valor: '5' },
    ],
  });

  assert.deepEqual(
    leido.body.automaticos.map((a) => a.valor),
    [30, undefined],
  );
  assert.match(
    leerDecisiones({ automaticos: [{ ...base, valor: 'treinta' }] }).error,
    /El valor ofertado es una cifra/,
  );
  assert.equal(
    sincronizarAutomaticos(
      [{ criterio: 'Alumnas adicionales', nos_acogemos: true, valor: 2.25 }],
      [{ criterio: 'Alumnas adicionales', puntos: 6 }],
    )[0].valor,
    '2,25',
  );
});
