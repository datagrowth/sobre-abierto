import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  borradoresSueltos,
  cuerpoRevisionBorrador,
  pideMotivoAlAceptar,
  documentoParaEvaluar,
  estadoApartado,
  faltaParaRedactar,
  progresoMemoria,
  revisionDeVersion,
  textoFaltaParaRedactar,
  textoLimitePaginas,
  versionSiguiente,
  apartadosMejorablesIniciales,
  enumerar,
  estadoEvaluacionMemoria,
  filasEvaluacionMemoria,
  leerApartadosMejorar,
  leerIndicaciones,
  motivoNoMejorar,
  textoEvaluacionMemoria,
  textoOrigen,
  estadoVersion,
  filasApartados,
  textoSubida,
  textoArriba,
  textoAlcance,
  textoLeccionesEnCurso,
  lineaFalta,
  etiquetaEnsayo,
  loteEntregado,
  memoriaDeLaOferta,
  ofrecerEnsayo,
  sinMemoria,
  versionesDeLaVista,
  memoriaSePuntuaEnOferta,
  textoRehacerVigente,
  memoriasPorLote,
} from './memoriaFormato.js';
import { memoriaValorable } from './ofertaFormato.js';
import { APARTADOS, GUION, DECISIONES, OFERTA } from '../../tests/fixtures/ofertaFixtures.mjs';

const apartado = (n, extra = {}) => ({
  apartado: n,
  titulo: APARTADOS[n - 1].titulo,
  puntos: APARTADOS[n - 1].puntos,
  estado: 'pendiente',
  trabajo: null,
  rechazos: 0,
  error: null,
  caracteres: null,
  paginas_estimadas: null,
  avisos: [],
  compromisos: [],
  ...extra,
});

const MEMORIA = {
  id: 5,
  version: 1,
  guion_id: 1,
  estado: 'redactando',
  pedida_en: '2026-10-05T12:00:00Z',
  ensamblada_en: null,
  borrador: null,
  progreso: { fase: 'redaccion', ronda: 0, max_rondas: 3 },
  apartados: [
    apartado(1, { estado: 'recibido' }),
    apartado(2, { trabajo: { estado: 'generando' } }),
    apartado(3, { rechazos: 2, error: 'Quita «[PENDIENTE»' }),
    apartado(4),
  ],
  paginas: null,
  paginas_estimadas: null,
  limite_paginas: 25,
  avisos: [],
  guion_cambiado: false,
  error: null,
};

const BORRADOR = {
  id: 40,
  ruta: 'Salidas/Licitaciones/x/memoria-v1.docx',
  ruta_pdf: 'Salidas/Licitaciones/x/memoria-v1.pdf',
  ruta_md: null,
  estado: 'pendiente',
  paginas: 23,
  paginas_estimadas: 22.4,
};

const ENSAMBLADA = {
  ...MEMORIA,
  estado: 'ensamblada',
  ensamblada_en: '2026-10-05T13:00:00Z',
  borrador: BORRADOR,
  progreso: { fase: 'fin', ronda: 0, max_rondas: 3 },
  apartados: APARTADOS.map((_, i) => apartado(i + 1, { estado: 'recibido' })),
  paginas: 23,
};

const SIN_ENFOQUE = { ...OFERTA, decisiones: { ...OFERTA.decisiones, datos: { ...DECISIONES, enfoque: '  ' } } };

const EVALUACION = {
  id: 77,
  estado: 'pendiente',
  puntuacion_total: 19,
  puntuacion_maxima: 25,
  genericos: 3,
  por_apartado: [
    { apartado: 1, puntos: 6, maximo: 8, tramo: 6 },
    { apartado: 2, puntos: 7, maximo: 7, tramo: 7 },
    { apartado: 3, puntos: 4, maximo: 6, tramo: null },
  ],
};

const EVALUADA = { ...ENSAMBLADA, evaluacion: EVALUACION, evaluacion_en_curso: null, mejorable: [1, 3], origen: null };

// CASO_F: descartada con propuesta de decisiones de Hermes; «Ahora» no empuja a prepararla.
// CASO_E: la primera versión se redactó con el guion 13 y el vigente es el 19.
const CASO_E_OTRO_GUION = {
  ...OFERTA,
  guion: { ...OFERTA.guion, id: 19, version: 2 },
  decisiones: { ...OFERTA.decisiones, guion_id: 19 },
  memorias: [{ ...ENSAMBLADA, guion_id: 13, guion_cambiado: true }],
};

const deLoteCasoE = (lote, version, extra = {}) => ({
  ...ENSAMBLADA,
  id: 100 + version,
  version,
  lote,
  ensayo: false,
  presentada: false,
  presentada_sustituida: false,
  ...extra,
});

const OFERTA_CASO_E = { ...OFERTA, memoria_lotes: ['2', '4'] };

const LOTES_LICITACION_CASO_E = [
  { id: '2', nombre: 'Formación en Gran Canaria' },
  { id: '4', nombre: 'Formación en Lanzarote' },
];

test('should_show_neither_grade_nor_points_for_a_report_the_tender_does_not_score', () => {
  const noValorable = { ...ENSAMBLADA, valorable: false, evaluacion: null, evaluacion_en_curso: null };
  assert.equal(estadoEvaluacionMemoria(noValorable), null, 'sin bloque de evaluación');
  assert.deepEqual(
    filasApartados(noValorable).map((a) => a.puntos),
    noValorable.apartados.map(() => null),
  );
  assert.ok(
    filasApartados(ENSAMBLADA).every((a) => typeof a.puntos === 'number'),
    'una memoria que puntúa conserva sus puntos',
  );
});

test('should_treat_a_report_with_zero_points_as_not_scored_even_without_the_valorable_field', () => {
  const sinPuntos = {
    ...ENSAMBLADA,
    evaluacion: null,
    evaluacion_en_curso: null,
    apartados: ENSAMBLADA.apartados.map((a) => ({ ...a, puntos: 0 })),
  };
  assert.equal(memoriaValorable(sinPuntos), false);
  assert.equal(estadoEvaluacionMemoria(sinPuntos), null);
});

test('should_not_require_enfoque_to_write_the_memoria', () => {
  const falta = faltaParaRedactar(SIN_ENFOQUE);

  assert.deepEqual(falta, []);
});

test('should_list_what_is_missing_to_write_the_report_from_what_is_saved', () => {
  assert.deepEqual(faltaParaRedactar(OFERTA), []);
  assert.deepEqual(faltaParaRedactar({ ...OFERTA, guion: null }), ['el guion del pliego (paso 1)']);
  assert.deepEqual(faltaParaRedactar({ ...OFERTA, decisiones: null }), ['las decisiones de la oferta (paso 2)']);
  const sinEquipo = {
    ...OFERTA,
    decisiones: { ...OFERTA.decisiones, datos: { ...DECISIONES, equipo: [], enfoque: ' ' } },
  };
  assert.deepEqual(faltaParaRedactar(sinEquipo), ['al menos una persona en el equipo'], 'el enfoque es opcional');
  const guionDeLotes = { ...OFERTA, guion: { ...OFERTA.guion, datos: { ...GUION, lotes: ['2'] } } };
  assert.deepEqual(
    faltaParaRedactar(guionDeLotes, [{ id: '1' }, { id: '2' }]),
    ['el lote al que vamos'],
    'un guion de unos lotes pide lotes en las decisiones',
  );
  assert.deepEqual(
    faltaParaRedactar(OFERTA, [{ id: '1' }, { id: '2' }]),
    [],
    'a todos los lotes (o el contrato entero), sin lotes',
  );
  assert.deepEqual(
    faltaParaRedactar({ ...OFERTA, guion_cambiado: true, decisiones_problemas: ['Falta decidir sobre «X».'] }),
    ['guardar otra vez las decisiones: el guion cambió desde que se fijaron', 'Falta decidir sobre «X».'],
  );
  assert.match(
    faltaParaRedactar({ ...OFERTA, guion: { ...OFERTA.guion, datos: { ...GUION, memoria: null } } })[0],
    /memoria técnica/,
  );
  const sinPrecio = {
    ...OFERTA,
    decisiones: {
      ...OFERTA.decisiones,
      datos: { ...DECISIONES, ofertas: [{ lote: null, pendiente: true, importe: null, unitarios: [] }] },
    },
  };
  assert.deepEqual(faltaParaRedactar(sinPrecio), [], 'el precio no bloquea la memoria');
});

test('should_phrase_the_missing_list', () => {
  assert.equal(textoFaltaParaRedactar([]), null);
  assert.equal(textoFaltaParaRedactar(['a']), 'Para redactar falta: a.');
  assert.equal(textoFaltaParaRedactar(['a', 'b', 'c']), 'Para redactar falta: a, b y c.');
});

test('should_number_the_next_report_version', () => {
  assert.equal(versionSiguiente([]), 1);
  assert.equal(versionSiguiente([{ version: 2 }, { version: 1 }]), 3);
});

test('should_report_the_progress_of_a_report_in_writing', () => {
  const p = progresoMemoria(MEMORIA);
  assert.deepEqual(p, {
    total: 4,
    recibidos: 1,
    fallidos: 0,
    pct: 25,
    enCurso: true,
    texto: 'Hermes redacta la memoria entera: 1 de 4 apartados recibidos',
  });
  assert.equal(progresoMemoria({ ...MEMORIA, estado: 'ensamblando' }).texto, 'Ensamblando el documento…');
  assert.equal(
    progresoMemoria({
      ...MEMORIA,
      apartados: [apartado(1, { estado: 'recibido' }), apartado(2, { estado: 'fallido' })],
    }).pct,
    100,
  );
  assert.equal(
    progresoMemoria({
      ...MEMORIA,
      apartados: [apartado(1, { estado: 'recibido' }), apartado(2, { estado: 'fallido' })],
    }).texto,
    'Hermes redacta la memoria entera: 1 de 2 apartados recibidos',
  );
  assert.equal(progresoMemoria({ ...ENSAMBLADA }).enCurso, false);
  assert.equal(
    progresoMemoria({ ...ENSAMBLADA, estado: 'fallida' }).texto,
    'Falló el ensamblado',
    'llegó a la fase final: lo que falló es el montaje',
  );
  assert.equal(
    progresoMemoria({ ...MEMORIA, estado: 'fallida' }).texto,
    'No llegó a redactarse',
    'falló antes de acabar: no hay Word que montar',
  );
});

test('should_label_each_section_by_its_state', () => {
  assert.deepEqual(estadoApartado(MEMORIA.apartados[0]), { clave: 'recibido', texto: 'Recibido' });
  assert.deepEqual(estadoApartado(MEMORIA.apartados[1]), { clave: 'redactando', texto: 'Redactando…' });
  assert.deepEqual(estadoApartado(MEMORIA.apartados[2]), { clave: 'rechazado', texto: 'Rechazado 2 veces' });
  assert.deepEqual(estadoApartado(MEMORIA.apartados[3]), { clave: 'pendiente', texto: 'Pendiente' });
  assert.deepEqual(estadoApartado(apartado(1, { rechazos: 1 })), { clave: 'rechazado', texto: 'Rechazado una vez' });
  assert.deepEqual(estadoApartado(apartado(1, { trabajo: { estado: 'en_cola' } })), {
    clave: 'en_cola',
    texto: 'En cola',
  });
  assert.deepEqual(estadoApartado(apartado(1, { estado: 'recibido', avisos: ['largo'] })), {
    clave: 'recibido',
    texto: 'Recibido con avisos',
  });
  assert.deepEqual(estadoApartado(apartado(1, { estado: 'fallido' })), { clave: 'fallido', texto: 'Fallido' });
});

test('should_compare_real_or_estimated_pages_with_the_limit', () => {
  assert.deepEqual(textoLimitePaginas({ paginas: 27, paginas_estimadas: 26, limite_paginas: 25 }), {
    texto: '27 págs. de 25: se pasa 2',
    aviso: true,
  });
  assert.deepEqual(textoLimitePaginas({ paginas: 24, limite_paginas: 25 }), {
    texto: '24 págs. de 25: al límite',
    aviso: true,
  });
  assert.deepEqual(textoLimitePaginas({ paginas: 20, limite_paginas: 25 }), { texto: '20 págs. de 25', aviso: false });
  assert.deepEqual(textoLimitePaginas({ paginas: null, paginas_estimadas: 12.4, limite_paginas: 25 }), {
    texto: '12 págs. estimadas de 25',
    aviso: false,
  });
  assert.deepEqual(textoLimitePaginas({ paginas: null, paginas_estimadas: 12.4, limite_paginas: null }), {
    texto: '12 págs. estimadas',
    aviso: false,
  });
  assert.equal(textoLimitePaginas({ paginas: null, paginas_estimadas: null, limite_paginas: 25 }), null);
});

test('should_expose_the_assembled_document_for_review', () => {
  assert.deepEqual(revisionDeVersion(ENSAMBLADA), {
    id: 40,
    estado: 'pendiente',
    rutas: ['Salidas/Licitaciones/x/memoria-v1.docx', 'Salidas/Licitaciones/x/memoria-v1.pdf'],
  });
  assert.equal(revisionDeVersion(MEMORIA), null);
});

test('should_separate_old_drafts_from_assembled_reports', () => {
  const borradores = [
    { id: 40, origen: 'ensamblado' },
    { id: 12, origen: 'hermes' },
    { id: 13 },
    { id: 41, origen: 'ensamblado' },
  ];
  assert.deepEqual(
    borradoresSueltos(borradores, [ENSAMBLADA]).map((b) => b.id),
    [12, 13],
  );
  assert.deepEqual(borradoresSueltos([], []), []);
});

test('should_send_the_motivo_only_when_there_is_one_when_reviewing_a_draft', () => {
  assert.deepEqual(cuerpoRevisionBorrador('descartar'), { decision: 'descartar' });
  assert.deepEqual(cuerpoRevisionBorrador('aceptar', { motivo: '  ' }), { decision: 'aceptar' });
  assert.deepEqual(cuerpoRevisionBorrador('aceptar', { motivo: ' Lo revisó Elisa ' }), {
    decision: 'aceptar',
    motivo: 'Lo revisó Elisa',
  });
  assert.deepEqual(cuerpoRevisionBorrador('aceptar', { anularFugas: 'Es la cifra del pliego' }), {
    decision: 'aceptar',
    anular_fugas: 'Es la cifra del pliego',
  });
});

test('should_ask_for_the_motivo_only_when_the_server_rejects_accepting_without_it', () => {
  const sinMotivo = {
    status: 400,
    message: 'Queda algo marcado: di por qué la das por buena (quedan 2 párrafos marcados).',
  };
  assert.equal(pideMotivoAlAceptar(sinMotivo), true);
  assert.equal(pideMotivoAlAceptar({ ...sinMotivo, status: 409 }), false);
  assert.equal(pideMotivoAlAceptar({ status: 400, message: 'decision: Invalid option' }), false);
  assert.equal(pideMotivoAlAceptar(null), false);
});

test('should_preselect_the_latest_assembled_docx_for_evaluation', () => {
  const memorias = [{ ...ENSAMBLADA, version: 2, estado: 'redactando', borrador: null }, ENSAMBLADA];
  assert.deepEqual(documentoParaEvaluar(memorias, [BORRADOR.ruta, 'Salidas/otro.md']), {
    elegido: BORRADOR.ruta,
    otro: '',
  });
  assert.deepEqual(documentoParaEvaluar(memorias, []), { elegido: '', otro: BORRADOR.ruta });
  assert.deepEqual(documentoParaEvaluar([MEMORIA], ['x']), { elegido: '', otro: '' });
});

test('should_join_items_with_commas_and_a_final_y', () => {
  assert.equal(enumerar([]), '');
  assert.equal(enumerar([2]), '2');
  assert.equal(enumerar([2, 4]), '2 y 4');
  assert.equal(enumerar([1, 2, 4]), '1, 2 y 4');
});

test('should_describe_the_version_an_improved_report_comes_from', () => {
  assert.equal(textoOrigen(EVALUADA), null);
  assert.equal(
    textoOrigen({ origen: { version_base: 1, apartados_rehechos: [2, 4] } }),
    'Mejora de la v1: rehechos los apartados 2 y 4',
  );
  assert.equal(
    textoOrigen({ origen: { version_base: 2, apartados_rehechos: [3] } }),
    'Mejora de la v2: rehecho el apartado 3',
  );
  assert.equal(textoOrigen({}), null, 'un servidor que aún no trae origen no muestra nada');
});

test('should_show_no_self_evaluation_when_the_server_does_not_send_it_or_the_report_is_not_assembled', () => {
  assert.equal(estadoEvaluacionMemoria(ENSAMBLADA), null);
  assert.equal(estadoEvaluacionMemoria({ ...EVALUADA, estado: 'redactando' }), null);
  assert.deepEqual(estadoEvaluacionMemoria({ ...ENSAMBLADA, evaluacion: null, evaluacion_en_curso: null }), {
    enCurso: null,
    evaluacion: null,
  });
  assert.equal(
    estadoEvaluacionMemoria({ ...ENSAMBLADA, evaluacion: null, evaluacion_en_curso: { estado: 'generando' } }).enCurso,
    'Evaluando…',
  );
  assert.equal(
    estadoEvaluacionMemoria({ ...ENSAMBLADA, evaluacion_en_curso: { estado: 'pendiente' } }).enCurso,
    'En cola para evaluar…',
  );
});

test('should_summarize_the_self_evaluation_and_each_section_against_its_scale', () => {
  assert.equal(textoEvaluacionMemoria(EVALUACION), '19 / 25 (76 %) · 3 párrafos genéricos');
  assert.equal(textoEvaluacionMemoria({ ...EVALUACION, genericos: 0 }), '19 / 25 (76 %) · Ningún párrafo genérico');
  const filas = filasEvaluacionMemoria(EVALUADA);
  assert.deepEqual(filas[0], {
    apartado: 1,
    titulo: 'Organización y metodología',
    pct: 75,
    corto: '6 / 8 pt',
    texto: '6 / 8 pt · tramo 6 de 8',
    mejorable: true,
  });
  assert.equal(filas[1].mejorable, false);
  assert.equal(filas[2].texto, '4 / 6 pt', 'sin tramo, solo los puntos');
  assert.deepEqual(filasEvaluacionMemoria(ENSAMBLADA), []);
});

test('should_preselect_the_improvable_sections_that_exist', () => {
  assert.deepEqual(apartadosMejorablesIniciales(EVALUADA), [1, 3]);
  assert.deepEqual(apartadosMejorablesIniciales({ ...EVALUADA, mejorable: [1, 9] }), [1]);
  assert.deepEqual(apartadosMejorablesIniciales(ENSAMBLADA), []);
});

test('should_tell_why_a_report_cannot_be_improved_now', () => {
  const o = { ...OFERTA, memorias: [EVALUADA] };
  assert.equal(motivoNoMejorar(EVALUADA, o), null);
  assert.equal(
    motivoNoMejorar({ ...EVALUADA, evaluacion: null }, o),
    'Primero hace falta su evaluación («Volver a evaluar») o tus indicaciones.',
  );
  assert.equal(
    motivoNoMejorar({ ...EVALUADA, evaluacion: null, evaluacion_en_curso: { estado: 'generando' } }, o),
    'Espera a que termine la evaluación o escribe tus indicaciones.',
  );
  assert.equal(
    motivoNoMejorar({ ...EVALUADA, evaluacion: null }, o, true),
    null,
    'con indicaciones no hace falta esperar',
  );
  assert.match(motivoNoMejorar(EVALUADA, { ...o, memorias: [MEMORIA, EVALUADA] }), /redactándose/);
  assert.match(motivoNoMejorar(EVALUADA, { ...o, guion_cambiado: true }), /decisiones no están al día/);
  assert.equal(motivoNoMejorar({ ...EVALUADA, estado: 'fallida' }, o), 'Solo se mejora una memoria ensamblada.');
});

test('should_read_the_sections_to_improve_without_duplicates_or_unknown_ones', () => {
  assert.deepEqual(leerApartadosMejorar([3, 1, 3, 9], EVALUADA), { apartados: [1, 3] });
  assert.deepEqual(leerApartadosMejorar([], EVALUADA), { error: 'Elige al menos un apartado que rehacer.' });
});

test('should_read_the_persons_instructions_for_a_new_version', () => {
  assert.deepEqual(leerIndicaciones('  '), { indicaciones: null });
  assert.deepEqual(leerIndicaciones('corto'), { error: 'Las indicaciones son muy cortas: di qué quieres que cambie.' });
  assert.deepEqual(leerIndicaciones(' Paco es el responsable del proyecto. '), {
    indicaciones: 'Paco es el responsable del proyecto.',
  });
  assert.equal(leerIndicaciones('x'.repeat(20_000)).indicaciones.length, 20_000, 'sin límite: no se corta');
  assert.equal(
    textoOrigen({ origen: { version_base: 4, apartados_rehechos: [2], indicaciones: 'Menos condicionales' } }),
    'Mejora de la v4: rehecho el apartado 2, con tus indicaciones',
  );
});

test('should_label_each_version_by_where_it_is_in_the_review', () => {
  assert.deepEqual(estadoVersion(MEMORIA), { clave: 'en_curso', texto: 'Redactando' });
  assert.deepEqual(estadoVersion(ENSAMBLADA), { clave: 'pendiente', texto: 'Pendiente de tu revisión' });
  assert.equal(estadoVersion({ ...ENSAMBLADA, borrador: { ...BORRADOR, estado: 'aceptada' } }).texto, 'Dada por buena');
  assert.equal(estadoVersion({ ...ENSAMBLADA, borrador: { ...BORRADOR, estado: 'descartada' } }).texto, 'Descartada');
  assert.equal(estadoVersion({ ...MEMORIA, estado: 'fallida' }).clave, 'fallida');
});

test('should_label_an_ensayo_version_as_not_presented_and_keep_it_out_of_the_offer', () => {
  const ensayo = { ...ENSAMBLADA, id: 9, version: 2, ensayo: true };
  assert.deepEqual(estadoVersion(ensayo), { clave: 'ensayo', texto: 'Ensayo (no presentada)' });
  assert.equal(
    estadoVersion({ ...ensayo, borrador: { ...BORRADOR, estado: 'descartada' } }).texto,
    'Ensayo (no presentada)',
    'sigue siendo de ensayo',
  );
  assert.deepEqual(
    estadoVersion({ ...MEMORIA, ensayo: true }),
    { clave: 'en_curso', texto: 'Redactando' },
    'mientras se redacta, su avance',
  );
  assert.equal(etiquetaEnsayo({ ...MEMORIA, ensayo: true }), 'Ensayo (no presentada)');
  assert.equal(etiquetaEnsayo(ENSAMBLADA), null);
  assert.equal(memoriaDeLaOferta({ memorias: [ensayo, ENSAMBLADA] }), ENSAMBLADA, 'la de ensayo no es la de la oferta');
  assert.equal(memoriaDeLaOferta({ memorias: [ensayo] }), null);
});

test('should_keep_the_offer_memoria_as_the_current_version_when_a_newer_ensayo_exists', () => {
  const v1 = { ...ENSAMBLADA, id: 1, version: 1, borrador: { ...BORRADOR, estado: 'descartada' } };
  const v2 = { ...ENSAMBLADA, id: 2, version: 2 };
  const ensayo = { ...ENSAMBLADA, id: 3, version: 3, ensayo: true };
  assert.deepEqual(
    versionesDeLaVista([ensayo, v2, v1]),
    { actual: v2, ensayo, anteriores: [v1] },
    'la v2 sigue con sus acciones; el ensayo, aparte',
  );
  assert.deepEqual(versionesDeLaVista([v2, v1]), { actual: v2, ensayo: null, anteriores: [v1] });
  assert.deepEqual(versionesDeLaVista([ensayo]), { actual: null, ensayo, anteriores: [] });
  const viejo = { ...ensayo, id: 0, version: 0 };
  assert.deepEqual(versionesDeLaVista([ensayo, v2, viejo]).anteriores, [viejo], 'los ensayos anteriores, al historial');
  assert.deepEqual(versionesDeLaVista(), { actual: null, ensayo: null, anteriores: [] });
});

test('should_offer_the_ensayo_memoria_only_when_the_deadline_has_passed', () => {
  const ahora = Date.parse('2026-10-14T10:00:00Z');
  const o = { guion: { id: 1 }, salidas_configurado: true, memorias: [ENSAMBLADA] };
  assert.equal(ofrecerEnsayo(o, '2026-10-08T13:00:00', ahora), true);
  assert.equal(ofrecerEnsayo(o, '2026-10-20T13:00:00', ahora), false, 'con plazo, la memoria normal');
  assert.equal(ofrecerEnsayo(o, null, ahora), false, 'sin plazo conocido');
  assert.equal(
    ofrecerEnsayo({ ...o, memorias: [MEMORIA] }, '2026-10-08T13:00:00', ahora),
    false,
    'con una redactándose',
  );
  assert.equal(ofrecerEnsayo({ ...o, salidas_configurado: false }, '2026-10-08T13:00:00', ahora), false);
  assert.equal(ofrecerEnsayo({ ...o, guion: null }, '2026-10-08T13:00:00', ahora), false);
});

test('should_join_each_section_with_its_writing_state_and_estimated_mark', () => {
  const filas = filasApartados(EVALUADA);
  assert.deepEqual(
    filas.map((f) => [f.apartado, f.chip.texto, f.nota?.texto ?? null, f.nota?.mejorable ?? null]),
    [
      [1, 'Recibido', '6 / 8 pt · tramo 6 de 8', true],
      [2, 'Recibido', '7 / 7 pt · tramo 7 de 7', false],
      [3, 'Recibido', '4 / 6 pt', true],
      [4, 'Recibido', null, null],
    ],
  );
  assert.deepEqual(filasApartados(null), []);
});

test('should_say_where_a_hand_uploaded_version_comes_from_and_what_was_recognised', () => {
  assert.equal(
    textoOrigen({
      origen: { version_base: 9, apartados_rehechos: [], indicaciones: null, subida: 'memoria-paco.docx' },
    }),
    'Subida a mano a partir de la v9 («memoria-paco.docx»)',
  );
  assert.equal(
    textoOrigen({ origen: { version_base: null, apartados_rehechos: [], indicaciones: null, subida: 'm.docx' } }),
    'Subida a mano («m.docx»)',
  );
  assert.equal(
    textoSubida({ version: 10, reconocidos: 5, total: 5, avisos: [] }),
    'Subida como v10: 5 de 5 apartados reconocidos. Hermes la evalúa ahora.',
  );
  assert.match(
    textoSubida({ version: 10, reconocidos: 4, total: 5, avisos: ['No encuentro en el Word el apartado 5.'] }),
    /reconocidos\. Hermes la evalúa ahora\. No encuentro en el Word el apartado 5\.$/,
  );
});

test('should_say_which_pending_version_was_discarded_after_upload', () => {
  const base = { version: 3, reconocidos: 5, total: 5, avisos: [] };
  assert.equal(
    textoSubida({ ...base, descartadas: [2] }),
    'Subida como v3: 5 de 5 apartados reconocidos. Hermes la evalúa ahora. La v2 sin revisar pasó a descartada.',
  );
  assert.match(
    textoSubida({ ...base, version: 5, descartadas: [3, 4] }),
    / Las v3 y v4 sin revisar pasaron a descartadas\.$/,
  );
  assert.equal(
    textoSubida({ ...base, descartadas: [] }),
    'Subida como v3: 5 de 5 apartados reconocidos. Hermes la evalúa ahora.',
  );
  assert.equal(
    textoSubida(base),
    'Subida como v3: 5 de 5 apartados reconocidos. Hermes la evalúa ahora.',
    'una respuesta sin el campo, como antes',
  );
});

test('should_lift_the_success_text_of_an_action_that_creates_a_new_version', () => {
  const dichos = [];
  const t = textoArriba(
    (a) => dichos.push(a),
    (r) => `Subida como v${r.version}.`,
  );
  assert.equal(t({ version: 3 }), null, 'el aviso local queda sin texto');
  assert.deepEqual(dichos, [{ tono: 'info', texto: 'Subida como v3.' }]);
  textoArriba((a) => dichos.push(a), 'Hermes rehace la memoria.')({});
  assert.equal(dichos.at(-1).texto, 'Hermes rehace la memoria.');
  assert.equal(textoArriba(undefined, 'Igual que siempre.'), 'Igual que siempre.', 'sin onAviso, el de siempre');
});

test('should_describe_the_lessons_hermes_draws_from_a_hand_edited_version', () => {
  assert.equal(
    textoSubida({ version: 10, reconocidos: 5, total: 5, avisos: [], aprende: true }),
    'Subida como v10: 5 de 5 apartados reconocidos. Hermes la evalúa ahora y saca lecciones de tus cambios.',
  );
  assert.equal(textoAlcance({ alcance: 'general', apartado: null }), 'General');
  assert.equal(textoAlcance({ alcance: 'licitacion', apartado: 2 }), 'Solo esta licitación · apartado 2');
  assert.equal(
    textoAlcance({ alcance: 'organo', alcance_valor: 'Ayuntamiento de Villaejemplo', apartado: null }),
    'Órgano: Ayuntamiento de Villaejemplo',
  );
  assert.equal(
    textoLeccionesEnCurso({ lecciones_en_curso: { estado: 'generando' } }),
    'Hermes está comparando tus cambios…',
  );
  assert.equal(textoLeccionesEnCurso({ lecciones_en_curso: null }), null);
});

test('should_block_asking_changes_on_memoria_from_another_outline', () => {
  const m = { ...EVALUADA, guion_cambiado: true };

  const motivo = motivoNoMejorar(m, { ...OFERTA, memorias: [m] }, true);

  assert.equal(motivo, 'La v1 es de otro guion: «Pedir cambios» no sirve; rehazla con el guion vigente.');
});

test('should_block_asking_changes_on_a_hand_uploaded_memoria', () => {
  const m = { ...EVALUADA, progreso: null, origen: { version_base: 1, apartados_rehechos: [], subida: 'v2.docx' } };

  const motivo = motivoNoMejorar(m, { ...OFERTA, memorias: [m] }, true);

  assert.match(motivo, /se subió a mano y Hermes no la rehace/);
});

test('should_allow_asking_changes_on_a_memoria_assembled_before_the_phases', () => {
  // Arrange: sin progreso (montada por el método anterior) y sin subida.
  const m = { ...EVALUADA, progreso: null, origen: null };

  // Act
  const motivo = motivoNoMejorar(m, { ...OFERTA, memorias: [m] }, true);

  // Assert
  assert.equal(motivo, null);
});

test('should_take_scoring_from_current_outline_not_from_version', () => {
  const noValorable = {
    ...OFERTA,
    guion: { ...OFERTA.guion, datos: { ...GUION, memoria: { ...GUION.memoria, valorable: false } } },
  };

  assert.equal(
    memoriaSePuntuaEnOferta(noValorable, ENSAMBLADA),
    false,
    'la versión trae puntos, pero el guion vigente no puntúa',
  );
  assert.equal(memoriaSePuntuaEnOferta(OFERTA, ENSAMBLADA), true);
  assert.equal(
    memoriaSePuntuaEnOferta(null, { ...ENSAMBLADA, valorable: false }),
    false,
    'sin guion, manda la versión',
  );
});

test('should_build_redo_confirmation_with_next_version_and_cost', () => {
  const m = CASO_E_OTRO_GUION.memorias[0];

  assert.equal(
    textoRehacerVigente(m, CASO_E_OTRO_GUION),
    'Hermes redacta la v2 desde cero con el guion vigente (v2): unas 3 h de máquina. La v1 se queda en el historial. ¿Seguimos?',
  );
});

test('should_not_say_falta_twice_when_the_server_already_says_it', () => {
  assert.equal(lineaFalta('Falta decidir 1 criterio automático: «X».'), 'Falta decidir 1 criterio automático: «X».');
  assert.equal(lineaFalta('el enfoque de la oferta'), 'Falta el enfoque de la oferta');
});

test('should_take_the_uploaded_presentada_as_the_memoria_of_the_offer', () => {
  // La memoria presentada subida manda aunque la oportunidad no esté marcada presentada.
  const desfasada = { ...ENSAMBLADA, guion_cambiado: true };
  const subida = {
    ...ENSAMBLADA,
    id: 9,
    version: 2,
    presentada: true,
    presentada_sustituida: false,
    borrador: { ...BORRADOR, id: 41, estado: 'aceptada' },
  };
  const conSubida = { ...OFERTA, memorias: [subida, desfasada] };
  assert.equal(memoriaDeLaOferta(conSubida), subida);
  assert.deepEqual(estadoVersion(subida), { clave: 'aceptada', texto: 'Presentada' });
});

test('should_keep_the_presentada_out_of_the_working_versions_and_the_replaced_one_in_the_history', () => {
  const presentada = { ...ENSAMBLADA, id: 3, version: 3, presentada: true };
  const sustituida = { ...ENSAMBLADA, id: 2, version: 2, presentada_sustituida: true };
  const v1 = { ...ENSAMBLADA, id: 1, version: 1 };
  assert.deepEqual(versionesDeLaVista([presentada, sustituida, v1]), {
    actual: v1,
    ensayo: null,
    anteriores: [sustituida],
  });
  assert.deepEqual(versionesDeLaVista([presentada]), { actual: null, ensayo: null, anteriores: [] });
  assert.equal(estadoVersion(sustituida).texto, 'Presentada, sustituida');
});

test('should_show_the_presentada_and_its_replaced_ones_instead_of_saying_there_is_no_memoria', () => {
  const presentada = { ...ENSAMBLADA, id: 2, version: 2, presentada: true };
  const sustituida = { ...ENSAMBLADA, id: 1, version: 1, presentada: false, presentada_sustituida: true };
  assert.equal(sinMemoria([presentada, sustituida]), false, 'con solo la presentada no se dice «Aún no hay memoria»');
  assert.equal(sinMemoria([presentada]), false);
  assert.equal(sinMemoria([]), true);
  assert.equal(sinMemoria(), true);
  assert.deepEqual(
    versionesDeLaVista([presentada, sustituida]),
    { actual: null, ensayo: null, anteriores: [sustituida] },
    'la sustituida, al historial',
  );
});

test('should_group_memorias_by_lote_when_pliego_asks_one_per_lote', () => {
  // Arrange
  const v6 = deLoteCasoE('4', 6);
  const v5 = deLoteCasoE('2', 5);
  const v4 = deLoteCasoE('4', 4, { presentada_sustituida: true });
  const comun = deLoteCasoE(null, 1);
  // Act
  const grupos = memoriasPorLote({ ...OFERTA_CASO_E, memorias: [v6, v5, v4, comun] }, LOTES_LICITACION_CASO_E);
  // Assert
  assert.deepEqual(
    grupos.map((g) => [g.lote, g.nombre, g.memorias.map((m) => m.version)]),
    [
      ['2', 'Formación en Gran Canaria', [5]],
      ['4', 'Formación en Lanzarote', [6, 4]],
      [null, null, [1]],
    ],
  );
  assert.deepEqual(
    memoriasPorLote({ ...OFERTA_CASO_E, memorias: [v5] }).map((g) => [g.lote, g.nombre]),
    [
      ['2', null],
      ['4', null],
    ],
    'sin memorias comunes no hay grupo común; sin lotes de la licitación, sin nombre',
  );
});

test('should_keep_a_single_group_without_memoria_lotes', () => {
  // Arrange
  const memorias = [ENSAMBLADA];
  // Act
  const sinCampo = memoriasPorLote({ ...OFERTA, memorias });
  const nulo = memoriasPorLote({ ...OFERTA, memorias, memoria_lotes: null });
  // Assert
  assert.deepEqual(sinCampo, [{ lote: null, nombre: null, memorias }]);
  assert.deepEqual(nulo, sinCampo);
  assert.deepEqual(memoriasPorLote(null), [{ lote: null, nombre: null, memorias: [] }]);
});

test('should_take_the_presentada_of_the_lote_or_the_common_one', () => {
  // Arrange
  const presentada2 = deLoteCasoE('2', 7, { presentada: true });
  const lote4 = deLoteCasoE('4', 6);
  const comun = deLoteCasoE(null, 8, { presentada: true });
  // Act / Assert
  assert.equal(memoriaDeLaOferta({ memorias: [presentada2, lote4] }, '4'), lote4);
  assert.equal(memoriaDeLaOferta({ memorias: [comun, lote4] }, '4'), comun);
});

test('should_say_a_lote_is_delivered_with_its_own_presentada_or_the_common_one', () => {
  // Arrange
  const presentada2 = deLoteCasoE('2', 7, { presentada: true });
  const lote4 = deLoteCasoE('4', 6);
  const comun = deLoteCasoE(null, 8, { presentada: true });

  // Act
  const soloEl2 = ['2', '4'].map((l) => loteEntregado({ ...OFERTA_CASO_E, memorias: [presentada2, lote4] }, l));
  const conComun = ['2', '4'].map((l) => loteEntregado({ ...OFERTA_CASO_E, memorias: [comun, lote4] }, l));
  const sustituida = loteEntregado(
    { ...OFERTA_CASO_E, memorias: [deLoteCasoE('2', 3, { presentada_sustituida: true })] },
    '2',
  );

  // Assert
  assert.deepEqual(soloEl2, [true, false]);
  assert.deepEqual(conComun, [true, true], 'la común vale para los lotes sin memoria propia');
  assert.equal(sustituida, false, 'una sustituida ya no es la presentada');
});
