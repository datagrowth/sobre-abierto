import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisoDescarte,
  valorOpinion,
  sinMaximoCero,
  textoMaximoLote,
  MOTIVOS_DESCARTE,
  accionCabecera,
  cuerpoDescarte,
  filtrarExpediente,
  opcionesMover,
  pestanasFicha,
  preguntaPreparar,
  seccionDeFicha,
  textoAccionBloqueo,
  textoEstadoPlacsp,
  textoCitaRequisito,
} from './licitacionesFormato.js';
import {
  ESTADOS_LISTA,
  lineasRequisito,
  estadoVisible,
  etiquetaEstado,
  etiquetaResultado,
  textoGarantia,
  ordenarRequisitos,
  porSobre,
  textoLotesInteres,
  textoPresentacion,
  loteSugerido,
  textoReglaFicha,
  etiquetaReorganizacion,
  tonoReorganizacion,
  textoCarpetaPresentada,
  siguienteAccion,
  sePuedeDescartar,
  explicarPrefiltro,
  requisitosALaVista,
  opcionesTriaje,
  DECISIONES,
  requisitosDeFicha,
  textoComprobado,
  resumenCobertura,
  textoCalidad,
  fichaAntigua,
  textoMetricas,
  duracion,
  textoRetirada,
  partesResumen,
  avisoPliegos,
  opinionHermes,
  textoLotesGuardados,
} from './licitacionesFormato.js';
import { fijarZonaEmpresa } from './formato.js';

// Los textos de estos tests son los de una empresa en Canarias: con la hora de allí al lado.
fijarZonaEmpresa('Atlantic/Canary');

test('should_label_opportunity_states', () => {
  assert.equal(etiquetaEstado('en_preparacion'), 'En preparación');
  assert.equal(etiquetaEstado('inventado'), 'inventado');
});

test('should_sort_requirements_by_how_much_they_block', () => {
  const reqs = [
    { id: 'a', resultado: 'cumple', excluyente: true },
    { id: 'b', resultado: 'desconocido', excluyente: true },
    { id: 'c', resultado: 'no_cumple', excluyente: false },
    { id: 'd', resultado: 'no_cumple', excluyente: true },
    { id: 'e', resultado: 'cumple', excluyente: false },
  ];
  assert.deepEqual(
    ordenarRequisitos(reqs).map((r) => r.id),
    ['d', 'c', 'b', 'a', 'e'],
  );
  assert.deepEqual(ordenarRequisitos(), []);
  assert.equal(etiquetaResultado('desconocido'), 'Por confirmar');
});

test('should_not_repeat_placsp_doubts_already_read_from_the_tender_in_the_ficha', () => {
  const placsp = [
    { origen: 'placsp', etiqueta: 'Trabajos similares', resultado: 'desconocido' },
    { origen: 'placsp', etiqueta: 'Volumen anual de negocio', resultado: 'desconocido' },
    { origen: 'placsp', etiqueta: 'Clasificación', resultado: 'cumple' },
  ];
  const ficha = [{ origen: 'ficha', etiqueta: 'Solvencia económica', resultado: 'no_cumple' }];
  const conFicha = requisitosALaVista(placsp, ficha);
  assert.deepEqual(
    conFicha.lista.map((r) => r.etiqueta),
    ['Clasificación', 'Solvencia económica'],
  );
  assert.deepEqual(conFicha.leidosEnFicha, ['Trabajos similares', 'Volumen anual de negocio']);
  const sinFicha = requisitosALaVista(placsp, []);
  assert.equal(sinFicha.lista.length, 3, 'sin ficha se ven todas, con su «por confirmar»');
  assert.deepEqual(sinFicha.leidosEnFicha, []);
});

test('should_group_documents_by_envelope_and_describe_guarantees', () => {
  const grupos = porSobre([
    { sobre: '1', documento: 'DEUC' },
    { sobre: '2', documento: 'Memoria' },
    { sobre: '1', documento: 'Garantía' },
  ]);
  assert.deepEqual(
    grupos.map((g) => [g.sobre, g.documentos.length]),
    [
      ['1', 2],
      ['2', 1],
    ],
  );
  assert.deepEqual(porSobre([]), []);
  assert.equal(textoGarantia({ tipo: '2', porcentaje: 5, importe: null }), 'Definitiva: 5 %');
  assert.match(textoGarantia({ tipo: 'provisional', importe: 15000 }), /^Provisional: 15\.000\s€$/);
  assert.equal(textoGarantia({ tipo: 'otra', descripcion: 'retención en factura' }), 'Otra (retención en factura)');
});

test('should_describe_the_lots_of_interest_and_the_presentation_rule', () => {
  assert.equal(textoLotesInteres([]), null);
  assert.match(textoLotesInteres([{ id: '2', importe: 103_624.32 }]), /^Lote 2 · 103\.624\s€$/);
  assert.match(
    textoLotesInteres([
      { id: '1', importe: 215_073.76 },
      { id: '2', importe: 103_624.32 },
    ]),
    /^Lotes 1, 2 · 318\.698\s€$/,
  );
  assert.equal(textoLotesInteres([{ id: '3', importe: null }]), 'Lote 3');
  assert.equal(
    textoLotesInteres([
      { id: '1', importe: 100_000 },
      { id: '2', importe: null },
    ]),
    'Lotes 1, 2',
    'sin sumar solo los que tienen importe',
  );
  assert.equal(textoPresentacion(null), null);
  assert.equal(
    textoPresentacion({ regla: 'A uno o varios lotes', maximo_lotes: 2, maximo_adjudicables: 2, origen: 'placsp' }),
    'A uno o varios lotes (máx. 2 por oferta; 2 adjudicables)',
  );
  assert.equal(
    textoPresentacion({ regla: 'A todos los lotes', maximo_lotes: null, maximo_adjudicables: null, origen: 'ficha' }),
    'A todos los lotes · confirmada en el pliego',
  );
  assert.equal(loteSugerido([{ id: '2' }]), '2');
  assert.equal(loteSugerido([{ id: '1' }, { id: '2' }]), '');
  assert.equal(loteSugerido(), '');
});

test('should_show_the_lot_rule_read_from_the_tender_documents', () => {
  assert.equal(textoReglaFicha(null), null);
  assert.equal(
    textoReglaFicha({ regla: 'uno_o_varios', maximo_lotes: 2, documento: 'PCAP', pagina: 4 }),
    'A uno o varios lotes (máx. 2 por oferta) · PCAP, pág. 4',
  );
  assert.equal(textoReglaFicha({ regla: 'un_lote' }), 'A un solo lote');
});

test('should_label_folder_reorganization_states_and_tones', () => {
  assert.equal(etiquetaReorganizacion('sincronizando'), 'Esperando a drive-sync');
  assert.equal(etiquetaReorganizacion('inventado'), 'inventado');
  assert.equal(etiquetaReorganizacion(undefined), '—');
  assert.equal(tonoReorganizacion('hecha'), 'exito');
  assert.equal(tonoReorganizacion('error'), 'error');
  assert.equal(tonoReorganizacion('sin_drive'), 'aviso');
  assert.equal(tonoReorganizacion('en_curso'), 'info');
});

test('should_describe_the_submitted_folder_by_state', () => {
  assert.equal(textoCarpetaPresentada(null), null);
  assert.match(
    textoCarpetaPresentada({ estado: 'hecha', ruta: 'Licitaciones/Presentadas/2026-05 - X - Y - Z' }),
    /^Carpeta de lo presentado: Conocimiento\/Licitaciones\/Presentadas\/2026-05 - X - Y - Z\//,
  );
  assert.match(
    textoCarpetaPresentada({ estado: 'error', error: 'GOOGLE_ERROR: caída' }),
    /GOOGLE_ERROR: caída.*reintenta/,
  );
  assert.match(textoCarpetaPresentada({ estado: 'error', error: null }), /error desconocido/);
  assert.match(textoCarpetaPresentada({ estado: 'pendiente' }), /^Creando/);
});

test('should_offer_the_next_step_of_each_opportunity', () => {
  const ficha = (estado, { aprobada = null, pliegos = [] } = {}) => ({
    estado,
    pliegos,
    go_no_go: { ficha: { aprobada } },
  });
  assert.equal(siguienteAccion(ficha('nueva')).clave, 'esperar');
  assert.equal(siguienteAccion(ficha('nueva', { pliegos: [{ estado: 'descargado' }] })).clave, 'generar_ficha');
  assert.equal(siguienteAccion(ficha('nueva', { aprobada: { id: 1 } })).clave, 'preparar');
  assert.equal(siguienteAccion(ficha('en_preparacion')).pestana, 'preparacion');
  assert.equal(siguienteAccion(ficha('presentada')).clave, 'resultado');
  assert.deepEqual(siguienteAccion(ficha('descartada')), { clave: 'reactivar', texto: 'Recuperar' });
  assert.equal(siguienteAccion(ficha('sin_oportunidad')).clave, 'seguir');
  assert.equal(siguienteAccion(ficha('ganada')), null);
  assert.equal(sePuedeDescartar('en_preparacion'), true);
  assert.equal(sePuedeDescartar('presentada'), false);
  assert.equal(sePuedeDescartar('descartada'), false);
});

test('should_explain_why_a_tender_passed_the_prefilter_in_plain_words', () => {
  assert.deepEqual(explicarPrefiltro('CPV 79311… · palabra «datos»', ['79311410', '79311000', '72000000']), [
    'CPV que empieza por 79311, uno de los de tus filtros (79311410, 79311000)',
    'el título contiene «datos», una palabra clave de tus filtros',
  ]);
  assert.deepEqual(explicarPrefiltro('Lote 2 (103.624 €): CPV 72…', ['72212000']), [
    'Lote 2 (103.624 €): CPV que empieza por 72, uno de los de tus filtros (72212000)',
  ]);
  assert.deepEqual(explicarPrefiltro('añadida a mano'), ['la añadió una persona a mano']);
  assert.deepEqual(explicarPrefiltro(null), []);
});

test('should_show_ficha_por_revisar_for_new_opportunities_that_already_have_a_ficha', () => {
  const conFicha = { go_no_go: { ficha: { aprobada: { id: 1 } } } };
  assert.equal(estadoVisible({ estado: 'nueva', ...conFicha }), 'Ficha por revisar');
  assert.equal(estadoVisible({ estado: 'en_preparacion', ...conFicha }), 'En preparación');
  assert.equal(estadoVisible({ estado: 'nueva', go_no_go: { ficha: { aprobada: null } } }), 'Nuevas');
  assert.equal(estadoVisible({ estado: 'sin_oportunidad' }), 'No seguida');
});

test('should_say_the_ficha_is_queued_or_being_generated_instead_of_offering_it_again', () => {
  const base = { estado: 'nueva', pliegos: [{ estado: 'descargado' }], go_no_go: { ficha: {} } };
  assert.equal(
    siguienteAccion({ ...base, ficha_en_curso: { estado: 'generando', desde: 'x' } }).texto,
    'Generando ficha…',
  );
  assert.equal(siguienteAccion({ ...base, ficha_en_curso: { estado: 'en_cola', desde: 'x' } }).texto, 'Ficha en cola…');
  assert.equal(siguienteAccion({ ...base, ficha_en_curso: { estado: 'generando', desde: 'x' } }).clave, 'esperar');
  assert.equal(siguienteAccion({ ...base, ficha_en_curso: null }).clave, 'generar_ficha');
});

test('should_say_first_what_the_tender_asks_and_then_where_we_stand', () => {
  const visita = {
    etiqueta: 'Otro requisito',
    descripcion: 'Visita obligatoria a las instalaciones con certificado del órgano',
    exigido: null,
    motivo: 'No consta que hayamos hecho la visita.',
  };
  assert.deepEqual(lineasRequisito(visita), {
    tipo: 'Otro requisito',
    piden: visita.descripcion,
    exigido: null,
    nosotros: visita.motivo,
  });
  const seguro = {
    etiqueta: 'Seguro de responsabilidad civil',
    descripcion: 'Seguro de RC durante la ejecución',
    exigido: '≥ 300.000 €',
    motivo: 'Sin seguro contratado.',
  };
  assert.equal(lineasRequisito(seguro).exigido, '≥ 300.000 €');
  assert.equal(
    lineasRequisito({ ...seguro, descripcion: 'Seguro de RC ≥ 300.000 €' }).exigido,
    null,
    'no repite la cifra que ya está en el texto',
  );
  assert.equal(
    lineasRequisito({ etiqueta: 'Clasificación', descripcion: 'clasificación', motivo: null }).piden,
    null,
    'no repite el tipo',
  );
  assert.equal(lineasRequisito({ etiqueta: 'Seguro', descripcion: '', motivo: 'x' }).piden, null);
});

test('should_leave_what_was_submitted_out_of_the_opportunity_list', () => {
  assert.deepEqual(
    ESTADOS_LISTA.map((e) => e.key),
    ['nueva', 'ficha_por_revisar', 'en_preparacion', 'descartada', 'candidata'],
  );
});

test('should_say_when_there_are_no_tender_documents_to_download_instead_of_waiting_forever', () => {
  const nueva = (pliegos, documentos = []) => ({
    estado: 'nueva',
    pliegos,
    datos: { documentos },
    go_no_go: { ficha: {} },
  });
  assert.equal(siguienteAccion(nueva([{ estado: 'pendiente' }])).texto, 'Esperando los pliegos');
  assert.equal(
    siguienteAccion(nueva([{ estado: 'error' }, { estado: 'pendiente' }])).texto,
    'Esperando los pliegos',
    'mientras quede alguno por bajar',
  );
  const errores = siguienteAccion(nueva([{ estado: 'error' }, { estado: 'error' }]));
  assert.equal(errores.texto, 'Los pliegos no se pueden bajar');
  assert.match(errores.espera, /fallo suyo/);
  assert.match(siguienteAccion(nueva([], [{ url: 'http://www.madrid.org/a.pdf' }])).espera, /no se bajan solos/);
  assert.match(siguienteAccion(nueva([])).espera, /no los publica/);
  assert.equal(siguienteAccion(nueva([{ estado: 'descargado' }])).clave, 'generar_ficha');
});

test('should_offer_triage_states_in_singular_only_while_a_person_decides', () => {
  const esperadas = [
    { key: 'nueva', label: 'Nueva' },
    { key: 'en_preparacion', label: 'En preparación' },
  ];
  assert.deepEqual(opcionesTriaje('nueva'), esperadas);
  assert.deepEqual(opcionesTriaje('en_preparacion'), esperadas);
  assert.deepEqual(opcionesTriaje('descartada'), esperadas, 'una descartada se puede devolver');
  for (const estado of ['presentada', 'ganada', 'perdida', 'candidata', 'sin_oportunidad', undefined]) {
    assert.deepEqual(opcionesTriaje(estado), [], `${estado} no se cambia a mano`);
  }
});

test('should_not_confuse_the_doubtful_recommendation_with_the_review_states', () => {
  assert.equal(DECISIONES.revisar, 'Con dudas');
  assert.notEqual(DECISIONES.revisar, etiquetaEstado('ficha_por_revisar'));
});

test('should_show_the_requirements_of_the_ficha_with_what_the_code_checked', () => {
  const ficha = {
    version_prompt: 2,
    datos: {
      requisitos: [
        {
          tipo: 'idioma',
          descripcion: 'Castellano',
          excluyente: true,
          cumple: 'si',
          fuente: 'perfil.idiomas',
          justificacion: 'Trabajamos en castellano.',
        },
        {
          tipo: 'ute',
          descripcion: 'Compromiso de UTE',
          excluyente: false,
          cumple: 'no_aplica',
          justificacion: 'Vamos solos.',
          lote: '2',
        },
        { tipo: 'seguro', descripcion: 'Seguro de RC', excluyente: true, cumple: 'no', justificacion: 'Sin seguro.' },
      ],
      verificaciones: [
        {
          indice: 0,
          regla: 'idioma',
          resultado_ia: 'dudoso',
          resultado: 'si',
          fuente: 'perfil.idiomas',
          detalle: null,
        },
      ],
    },
  };
  const r = requisitosDeFicha(ficha);
  assert.deepEqual(
    r.map((x) => [x.etiqueta, x.resultado, x.lote]),
    [
      ['Idioma', 'cumple', null],
      ['UTE', 'no_aplica', '2'],
      ['Seguro de responsabilidad civil', 'no_cumple', null],
    ],
  );
  assert.equal(r[2].excluyente, false, 'el seguro nunca es excluyente');
  assert.equal(
    textoComprobado(r[0].verificacion),
    'Comprobado con los datos de tu empresa. Hermes decía: Por confirmar.',
  );
  assert.equal(textoComprobado(null), null);
  assert.equal(etiquetaResultado('no_aplica'), 'No procede');
  assert.equal(ordenarRequisitos(r).at(-1).resultado, 'no_aplica', 'lo que no procede va al final');
});

test('should_summarise_the_coverage_quality_and_version_of_the_ficha', () => {
  const cob = [
    { tema: 'clasificacion', estado: 'no_lo_pide' },
    { tema: 'habilitacion', estado: 'no_encontrado' },
    { tema: 'idioma', estado: 'en_requisitos' },
  ];
  assert.deepEqual(resumenCobertura(cob), { noLoPide: ['clasificación'], noEncontrado: ['habilitación'] });
  assert.deepEqual(resumenCobertura(undefined), { noLoPide: [], noEncontrado: [] });
  assert.equal(
    textoCalidad({ puntuacion: 72, requisitos: 11, dudosos_pct: 18, corregidos_por_codigo: 2 }),
    'Calidad 72/100 · 11 requisitos · 18 % por confirmar · 2 corregidos con los datos de tu empresa',
  );
  assert.equal(textoCalidad(undefined), null);
  assert.equal(fichaAntigua({ version_prompt: 1 }, 2), true);
  assert.equal(fichaAntigua({}, 2), true, 'sin versión es de la primera');
  assert.equal(fichaAntigua({ version_prompt: 2 }, 2), false);
  assert.equal(fichaAntigua(null, 2), false);
});

test('should_describe_the_run_metrics_of_a_ficha', () => {
  const m = {
    modelo: 'gpt-6-luna',
    duracion_s: 840,
    llamadas_herramientas: 23,
    tokens_entrada: 170_000,
    tokens_salida: 10_000,
    respuestas_recortadas: 2,
    rechazos: 0,
  };
  assert.equal(textoMetricas(m), 'gpt-6-luna · 14 min · 23 llamadas · 180000 tokens · 2 respuestas recortadas');
  assert.equal(
    textoMetricas({
      modelo: null,
      duracion_s: 45,
      llamadas_herramientas: null,
      tokens_entrada: null,
      tokens_salida: null,
      respuestas_recortadas: 0,
      rechazos: 1,
    }),
    '45 s · 1 rechazos',
  );
  assert.equal(textoMetricas(null), null);
  assert.equal(duracion(59), '59 s');
});

test('should_explain_in_words_a_tender_cancelled_in_placsp_with_the_canary_time', () => {
  const ahora = Date.parse('2026-10-05T18:00:00Z');
  assert.equal(
    textoRetirada({ en: '2026-10-05T14:58:56', motivo: 'ANULADA', etiqueta: 'Anulada' }, ahora),
    'Anulada en la PLACSP el lun 5 oct a las 14:58 (13:58 Canarias): ya no se puede presentar. Si el órgano la vuelve a publicar, llegará como una licitación nueva.',
  );
  assert.match(
    textoRetirada({ en: '2026-10-05T14:58:56', motivo: null, etiqueta: 'Retirada de la PLACSP' }, ahora),
    /^Retirada de la PLACSP el lun 5 oct/,
  );
  assert.equal(textoRetirada(null), null);
});

test('should_split_summary_source_with_several_pages_markers', () => {
  const casoF = 'Suministro e instalación del sistema de control. Fuentes: PPT págs. 2-7; CC págs. 8-15.';
  assert.deepEqual(partesResumen(casoF), {
    texto: 'Suministro e instalación del sistema de control.',
    fuente: 'Fuentes: PPT págs. 2-7; CC págs. 8-15',
  });
  assert.deepEqual(partesResumen('Servicio anual. PCAP pág. 3; PPT §§ 2-4; Anexo II págs. 1-2.'), {
    texto: 'Servicio anual.',
    fuente: 'PCAP pág. 3; PPT §§ 2-4; Anexo II págs. 1-2',
  });
});

test('should_not_hang_on_a_long_summary_full_of_section_signs', () => {
  const t = `Texto ${'§ '.repeat(1000)}( fin`;
  const inicio = Date.now();
  partesResumen(t);
  assert.ok(Date.now() - inicio < 500);
});

test('should_keep_existing_summary_cases', () => {
  const casoG =
    'Desarrollo e implantación en la nube de la Fase 1 de un asistente de IA; incluye pruebas, despliegue, formación y soporte. Contrato único, 80.000 € sin IVA, cuatro meses más soporte. PCP págs. 2-4; ETC §§1-3.';
  assert.deepEqual(partesResumen(casoG), {
    texto:
      'Desarrollo e implantación en la nube de la Fase 1 de un asistente de IA; incluye pruebas, despliegue, formación y soporte. Contrato único, 80.000 € sin IVA, cuatro meses más soporte.',
    fuente: 'PCP págs. 2-4; ETC §§1-3',
  });
  assert.deepEqual(partesResumen('Mantenimiento de 15 pantallas durante 2 años (Anexo I PCAP, págs. 1-6).'), {
    texto: 'Mantenimiento de 15 pantallas durante 2 años',
    fuente: 'Anexo I PCAP, págs. 1-6',
  });
  assert.deepEqual(partesResumen('Servicio de analítica durante 2 años, 450.000 € sin IVA.'), {
    texto: 'Servicio de analítica durante 2 años, 450.000 € sin IVA.',
    fuente: null,
  });
  assert.equal(partesResumen(''), null);
});

test('should_explain_which_published_documents_are_missing_from_drive_and_why', () => {
  const c = {
    completa: false,
    descarga_completa: true,
    publicados: 5,
    descargados: 1,
    faltan: [
      { nombre: 'ANEXO IV.docx', motivo: 'error', error: 'placsp_http_404: Not Found', citado: true },
      {
        nombre: 'Memoria justificativa',
        motivo: 'pendiente',
        error: 'placsp_http_503: Service Unavailable',
        citado: false,
      },
      { nombre: 'ANEXO V.docx', motivo: 'pendiente', error: null, citado: false },
      { nombre: 'Anexo en otra web.pdf', motivo: 'no_descargable', error: null, citado: false },
    ],
    citados_sin_pliego: [{ documento: 'ANEXO XII.docx', en: 'guion' }],
  };
  assert.deepEqual(avisoPliegos(c), {
    titulo: 'Faltan 4 documentos publicados en Drive (1 de 5 bajados)',
    lineas: [
      '«ANEXO IV.docx»: da error al bajarlo (lo usa el guion)',
      '«Memoria justificativa»: falla al bajarlo; se reintenta solo',
      '«ANEXO V.docx»: en cola para bajarse',
      '«Anexo en otra web.pdf»: está en una web de la que no se baja solo: bájalo a mano',
      '«ANEXO XII.docx»: lo cita el guion, pero no está entre los pliegos publicados',
    ],
  });
  assert.equal(
    avisoPliegos({ ...c, descarga_completa: false }),
    null,
    'lo nuevo sin ficha solo baja lo que lee la ficha',
  );
  assert.equal(avisoPliegos({ ...c, faltan: [], citados_sin_pliego: [] }), null);
  assert.equal(avisoPliegos(null), null);
  assert.equal(avisoPliegos({ ...c, faltan: [] }).titulo, 'Hay documentos citados que no están entre los pliegos');
});

test('should_say_the_pliegos_are_unchecked_when_the_data_predates_reading_the_other_documents', () => {
  const c = {
    completa: null,
    descarga_completa: true,
    publicados: 2,
    descargados: 2,
    faltan: [],
    citados_sin_pliego: [],
    sin_comprobar: true,
    expediente: null,
  };
  assert.equal(avisoPliegos(c)?.titulo, 'Pliegos sin comprobar');
  assert.match(avisoPliegos(c)?.lineas[0] ?? '', /Puede haber más documentos publicados/);
  assert.equal(avisoPliegos(c)?.lineas.length, 1);
  const fallida = {
    ...c,
    expediente: {
      revisado_en: '2026-10-14T10:00:00Z',
      comprobado_en: null,
      documentos: 0,
      error: 'placsp_http_503: Service Unavailable',
    },
  };
  assert.equal(
    avisoPliegos(fallida)?.lineas[1],
    'La última revisión de la página del expediente falló (placsp_http_503: Service Unavailable).',
  );
  assert.equal(avisoPliegos({ ...c, completa: true, sin_comprobar: false }), null);
});

test('should_prefer_ficha_recommendation_over_criba', () => {
  const o = opinionHermes({
    veredicto_ia: 'interesa',
    motivo_ia: 'Encaja por CPV',
    recomendacion_ficha: { decision: 'revisar', motivo: 'Solvencia justa' },
  });
  assert.deepEqual(o, { texto: 'Ficha: Con dudas', motivo: 'Solvencia justa', clave: 'ficha' });
  assert.equal(
    opinionHermes({ veredicto_ia: 'descartar', motivo_ia: 'Obras', recomendacion_ficha: null }).texto,
    'Hermes: No encaja',
  );
  assert.equal(
    opinionHermes({ veredicto_ia: 'descartar', motivo_ia: 'Obras', recomendacion_ficha: null }).motivo,
    'Obras',
  );
});

test('should_say_sin_evaluar_when_criba_lacked_profile', () => {
  const o = opinionHermes({
    veredicto_ia: 'revisar',
    motivo_ia: 'Falta el perfil de licitaciones de la empresa: no puedo valorar.',
    recomendacion_ficha: null,
  });
  assert.deepEqual(o, { texto: 'Hermes: sin evaluar (faltaba el perfil)', motivo: null, clave: 'sin_evaluar' });
});

test('should_return_null_without_opinion', () => {
  assert.equal(opinionHermes({ veredicto_ia: null, motivo_ia: null, recomendacion_ficha: null }), null);
  assert.equal(opinionHermes({}), null);
});

test('should_not_promise_reextracting_guion_when_only_removing_lots', () => {
  const t = textoLotesGuardados({
    lotes: ['2', '4'],
    anadidos: [],
    quitados: ['6'],
    rehace: { ficha: false, guion: false },
  });
  assert.equal(
    t,
    'Vamos a los lotes 2 y 4. La ficha y el guion siguen valiendo: revisa en Decisiones lo que era del lote 6.',
  );
  assert.doesNotMatch(t, /extraer|genérala|guárdalas/);
});

test('should_announce_ficha_and_guion_redo_with_time_when_adding_lot', () => {
  const ambos = textoLotesGuardados({
    lotes: ['2', '4'],
    anadidos: ['4'],
    quitados: [],
    rehace: { ficha: true, guion: true },
  });
  assert.equal(
    ambos,
    'Vamos a los lotes 2 y 4. Hermes rehace la ficha y el guion para el lote 4 (unos 85 min) y después la propuesta.',
  );
  const guion = textoLotesGuardados({
    lotes: ['2', '4'],
    anadidos: ['4'],
    quitados: [],
    rehace: { ficha: false, guion: true },
  });
  assert.match(guion, /Hermes rehace el guion para el lote 4 \(unos 45 min\)/);
  const fuera = textoLotesGuardados({
    lotes: ['2', '4'],
    anadidos: ['4'],
    quitados: [],
    rehace: { ficha: false, guion: false },
  });
  assert.match(fuera, /Cuando prepares la oferta, Hermes hará la ficha y el guion para el lote 4\./);
});

test('should_use_singular_for_one_lot', () => {
  const t = textoLotesGuardados({
    lotes: ['2'],
    anadidos: [],
    quitados: ['4', '6'],
    rehace: { ficha: false, guion: false },
  });
  assert.equal(
    t,
    'Vamos al lote 2. La ficha y el guion siguen valiendo: revisa en Decisiones lo que era de los lotes 4 y 6.',
  );
});

test('should_replace_false_zero_max_price_in_criterion_text', () => {
  assert.equal(
    sinMaximoCero('Oferta proporcional; precio máximo 0.'),
    'Oferta proporcional; precio máximo: no consta (ver por lote).',
  );
  assert.equal(sinMaximoCero('Precio máximo: 0 euros;'), 'precio máximo: no consta (ver por lote);');
});

test('should_not_touch_real_max_prices', () => {
  assert.equal(sinMaximoCero('precio máximo 0,50 €'), 'precio máximo 0,50 €');
  assert.equal(sinMaximoCero('precio máximo 10 €'), 'precio máximo 10 €');
});

test('should_say_max_not_stated_with_lot_budget', () => {
  const sinMax = textoMaximoLote({ lote: '2', unidad: 'alumno', maximo: null, presupuesto: 6063.75 }).replace(
    /\s/g,
    ' ',
  );
  assert.equal(sinMax, 'Lote 2: no consta el máximo por alumno (presupuesto del lote 6.063,75 €)');
  assert.equal(
    textoMaximoLote({ lote: '2', unidad: 'alumno', maximo: 110.25, presupuesto: 1 }).replace(/\s/g, ' '),
    'Lote 2: máx. 110,25 € por alumno',
  );
});

// Ficha: pestañas, cabecera y descarte.
const AHORA_FICHA = Date.parse('2026-10-14T10:00:00Z');
const claves = (pestanas) => pestanas.map((p) => p.key);
const conFicha = (extra = {}) => ({
  estado: 'nueva',
  fecha_limite: '2026-10-30T14:00:00',
  go_no_go: { requisitos: [], ficha: { aprobada: { id: 1 } } },
  ...extra,
});

test('should_show_the_same_tabs_and_open_the_offer_for_an_offer_in_preparation', () => {
  // Arrange
  const f = {
    estado: 'en_preparacion',
    fecha_limite: '2026-11-30T14:00:00',
    go_no_go: { requisitos: [{ resultado: 'desconocido' }] },
  };

  // Act
  const pestanas = pestanasFicha(f, AHORA_FICHA);

  // Assert
  assert.deepEqual(claves(pestanas), ['resumen', 'requisitos', 'criterios', 'mercado', 'oferta', 'revision']);
  assert.equal(pestanas.find((p) => p.key === 'oferta').label, 'Oferta');
  assert.equal(pestanas[1].cuenta, 1);
  assert.equal(seccionDeFicha(null, pestanas), 'oferta', 'la Oferta (el asistente), por defecto');
  assert.equal(
    seccionDeFicha('comprobaciones', pestanas),
    'oferta',
    'el enlace de las comprobaciones lleva a la Oferta',
  );
  assert.equal(
    seccionDeFicha('comprobaciones', pestanas, { bloqueo: 'precio:1' }),
    'revision',
    'con una fila, a la Revisión, donde están las filas',
  );
  assert.equal(
    seccionDeFicha('comprobaciones', pestanas, { testid: 'registrar-paquete' }),
    'revision',
    'y el registro',
  );
  assert.equal(seccionDeFicha('preparacion', pestanas), 'oferta', 'el enlace antiguo lleva a la Oferta');
  assert.equal(seccionDeFicha('expediente', pestanas), 'requisitos', 'el Expediente de antes, a Requisitos');
  assert.equal(seccionDeFicha('pliegos', pestanas), 'resumen');
});

test('should_add_the_offer_tab_for_a_ficha_por_revisar_due_in_3_days_or_less', () => {
  // Arrange: visto el mié 14, el sáb 17 está a 3 días de calendario y el dom 18 a 4.
  const en3 = conFicha({ fecha_limite: '2026-10-17T14:00:00' });
  const en4 = conFicha({ fecha_limite: '2026-10-18T14:00:00' });
  const solicitudCerca = conFicha({ fecha_limite: '2026-11-30T14:00:00', fecha_solicitud: '2026-10-16T14:00:00' });
  const sinFicha = { ...en3, go_no_go: { requisitos: [], ficha: { aprobada: null } } };
  const conOferta = (f) => claves(pestanasFicha(f, AHORA_FICHA)).includes('oferta');
  assert.equal(
    seccionDeFicha('comprobaciones', pestanasFicha(en3, AHORA_FICHA), { bloqueo: 'x' }),
    'oferta',
    'por decidir con prisa no hay Revisión: las filas van en la Oferta',
  );

  // Act / Assert
  assert.equal(conOferta(en3), true);
  assert.equal(conOferta(en4), false);
  assert.equal(conOferta(solicitudCerca), true, 'cuenta la solicitud de participación');
  assert.equal(conOferta(sinFicha), false, 'sin ficha no hay nada que decidir');
});

test('should_open_the_summary_outside_preparation_and_the_presentation_when_presented', () => {
  // Arrange
  const nueva = conFicha();
  const presentada = {
    estado: 'presentada',
    fecha_limite: '2026-10-01T14:00:00',
    oferta: { memoria: { por_revisar: true } },
  };
  const descartadaSinOferta = { estado: 'descartada', fecha_limite: '2026-10-30T14:00:00', oferta: { guion: null } };
  const descartadaConOferta = { estado: 'descartada', oferta: { guion: { version: 1 } } };

  // Act / Assert
  assert.deepEqual(claves(pestanasFicha(nueva, AHORA_FICHA)), ['resumen', 'requisitos', 'criterios', 'mercado']);
  assert.equal(seccionDeFicha(null, pestanasFicha(nueva, AHORA_FICHA)), 'resumen');
  assert.deepEqual(
    claves(pestanasFicha(presentada, AHORA_FICHA)),
    ['resumen', 'requisitos', 'criterios', 'mercado', 'preparacion'],
    'lo presentado anota el resultado en Presentación',
  );
  assert.equal(pestanasFicha(presentada, AHORA_FICHA).at(-1).cuenta, 1);
  assert.deepEqual(claves(pestanasFicha(descartadaSinOferta, AHORA_FICHA)), [
    'resumen',
    'requisitos',
    'criterios',
    'mercado',
  ]);
  assert.equal(
    seccionDeFicha(null, pestanasFicha(descartadaConOferta, AHORA_FICHA)),
    'oferta',
    'descartada tras empezar la oferta: su Oferta en solo lectura',
  );
  assert.equal(seccionDeFicha('comprobaciones', pestanasFicha(nueva, AHORA_FICHA)), 'resumen');
});

const fila = (clave, extra) => ({
  clave,
  categoria: 'precio',
  lote: null,
  gravedad: 'impide',
  titulo: clave,
  actor: 'tu',
  accion: { tipo: 'fijar_precio' },
  estado: 'abierto',
  ...extra,
});

test('should_take_the_header_action_from_the_first_open_user_blocker', () => {
  // Arrange: una de negocio delante (no es tuya), una resuelta y luego las tuyas.
  const comprobaciones = {
    veredicto: { tipo: 'no_presentable', texto: 'No presentable: Exigen ENS' },
    bloqueos: [
      fila('ens', { categoria: 'elegibilidad', actor: 'negocio', accion: { tipo: 'subir_certificado' } }),
      fila('medios:3:topografía', {
        categoria: 'elegibilidad',
        lote: '3',
        gravedad: 'riesgo',
        titulo: 'Docente de topografía (lote 3): Persona A lo tiene, asígnala al rol',
        accion: { tipo: 'asignar_rol' },
      }),
      fila('precio:3', { lote: '3' }),
      fila('precio:1', { lote: '1', estado: 'resuelto' }),
    ],
  };
  const f = { estado: 'en_preparacion' };
  const sinMedios = {
    ...comprobaciones,
    bloqueos: comprobaciones.bloqueos.filter((b) => !b.clave.startsWith('medios')),
  };

  // Act
  const accion = accionCabecera(comprobaciones, f);
  const hermes = accionCabecera(
    { veredicto: { tipo: 'hermes_trabajando', texto: 'Hermes trabajando: hacia las 16:40' }, bloqueos: [] },
    f,
  );

  // Assert
  assert.deepEqual(accion, {
    clave: 'bloqueo',
    bloqueo: 'medios:3:topografía',
    texto: 'Asignar a alguien al rol de docente de topografía',
  });
  assert.equal(accionCabecera(sinMedios, f).texto, 'Fijar el precio del lote 3');
  assert.deepEqual(
    accionCabecera({ veredicto: { tipo: 'lista_para_firmar', texto: 'Lista para firmar' }, bloqueos: [] }, f),
    { clave: 'paquete', texto: 'Ir al paquete' },
  );
  assert.equal(hermes.clave, 'esperar', 'sin botón: la línea de Hermes');
  assert.equal(hermes.espera, 'Hermes trabajando: hacia las 16:40');
  assert.equal(accionCabecera(null, f), null, 'sin las comprobaciones aún, sin botón');
  const criterio = fila('nos', {
    accion: { tipo: 'desmarcar_criterio' },
    titulo: 'Te acoges a «Soporte con IA» sin con qué acreditarlo',
  });
  assert.equal(textoAccionBloqueo(criterio), 'Revisar el criterio «Soporte con IA»');
  assert.equal(
    accionCabecera(comprobaciones, conFicha()).clave,
    'preparar',
    'fuera de preparación, el siguiente paso de siempre',
  );
});

test('should_not_offer_any_action_on_a_discarded_offer', () => {
  // Arrange
  const descartada = { estado: 'descartada', oferta: { guion: { version: 1 } } };
  const comprobaciones = {
    veredicto: { tipo: 'descartada', texto: 'Descartada: sin solvencia' },
    bloqueos: [fila('precio:-')],
  };

  // Act / Assert
  assert.equal(
    accionCabecera(comprobaciones, descartada),
    null,
    'en solo lectura solo queda «Recuperar», dentro de las comprobaciones',
  );
  assert.equal(
    accionCabecera(comprobaciones, { ...descartada, estado: 'en_preparacion' }),
    null,
    'el veredicto descartada tampoco empuja',
  );
  assert.equal(textoEstadoPlacsp({ estado: 'descartada', estado_placsp: 'Publicada' }), 'En plazo en la PLACSP');
  assert.equal(textoEstadoPlacsp({ estado: 'nueva', estado_placsp: 'Publicada' }), 'Publicada');
});

test('should_require_a_typed_motive_when_discarding_from_the_web', () => {
  // Arrange / Act
  const sinTipo = cuerpoDescarte({ motivo: 'Exigen ISO 27001' });
  const sinTexto = cuerpoDescarte({ tipo: 'certificacion', motivo: ' ' });
  const bien = cuerpoDescarte({ tipo: 'certificacion', motivo: ' Exigen ISO 27001 ' });

  // Assert
  assert.equal(sinTipo.error, 'Elige el motivo del descarte.');
  assert.equal(sinTexto.error, 'Dilo en pocas palabras.');
  assert.deepEqual(bien.data, {
    estado: 'descartada',
    motivo_descarte: 'Exigen ISO 27001',
    categoria_descarte: 'certificacion',
  });
  assert.deepEqual(
    MOTIVOS_DESCARTE.map((m) => m.label),
    ['Solvencia', 'Certificación', 'Plazo', 'Precio', 'Encaje', 'Otro'],
  );
});

test('should_ask_before_preparing_a_red_or_withdrawn_ficha', () => {
  assert.equal(
    preguntaPreparar({ go_no_go: { semaforo: { color: 'rojo' } } }),
    'La ficha dice «No cumplimos»: ¿prepararla igualmente?',
  );
  assert.match(preguntaPreparar({ retirada: { etiqueta: 'Anulada' } }), /retirada/);
  assert.equal(preguntaPreparar({ go_no_go: { semaforo: { color: 'ambar' } } }), null);
});

test('should_move_only_to_a_different_state', () => {
  assert.deepEqual(
    opcionesMover('nueva').map((o) => o.key),
    ['en_preparacion'],
  );
  assert.deepEqual(
    opcionesMover('descartada').map((o) => o.key),
    ['nueva', 'en_preparacion'],
  );
  assert.deepEqual(opcionesMover('presentada'), []);
});

test('should_filter_requirements_criteria_and_documents_of_the_expediente_by_text', () => {
  // Arrange
  const datosFicha = {
    requisitos: [
      { tipo: 'certificacion', descripcion: 'ENS media' },
      { tipo: 'solvencia_tecnica', descripcion: 'Tres trabajos similares' },
    ],
    verificaciones: [{ indice: 1, resultado: 'cumple' }],
    criterios: [{ descripcion: 'Precio' }, { descripcion: 'Plan de formación' }],
  };
  const f = {
    go_no_go: {
      requisitos: [
        { etiqueta: 'Clasificación', descripcion: 'Grupo V' },
        { etiqueta: 'Solvencia económica', descripcion: 'Volumen anual' },
      ],
      ficha: { aprobada: { datos: datosFicha } },
    },
    datos: { criterios: [], documentos: [] },
    pliegos: [{ nombre: 'PCAP.pdf' }, { nombre: 'Anexo de solvencia.docx' }],
  };

  // Act
  const r = filtrarExpediente(f, 'SOLVENCIA');
  const trabajos = filtrarExpediente(f, 'trabajos similares');
  const vacio = filtrarExpediente(f, '  ');

  // Assert
  assert.deepEqual(
    r.f.go_no_go.requisitos.map((x) => x.etiqueta),
    ['Solvencia económica'],
  );
  assert.deepEqual(
    r.f.pliegos.map((p) => p.nombre),
    ['Anexo de solvencia.docx'],
  );
  assert.deepEqual(r.cuentas, { requisitos: 2, criterios: 0, pliegos: 1 });
  assert.deepEqual(
    trabajos.f.go_no_go.ficha.aprobada.datos.verificaciones,
    [{ indice: 0, resultado: 'cumple' }],
    'la comprobación sigue a su requisito',
  );
  assert.equal(vacio.filtrada, false);
  assert.equal(vacio.f, f);
  assert.equal(filtrarExpediente(f, 'formacion').cuentas.criterios, 1, 'sin tildes');
});

test('should_label_old_hermes_agent_metrics_as_sin_metrica', async () => {
  // Arrange
  const { etiquetaModelo } = await import('./licitacionesFormato.js');
  const antigua = {
    modelo: 'hermes-agent',
    duracion_s: 840,
    llamadas_herramientas: null,
    tokens_entrada: null,
    tokens_salida: null,
  };

  // Act
  const texto = textoMetricas(antigua);

  // Assert
  assert.equal(texto, 'sin métrica · 14 min');
  assert.equal(etiquetaModelo('hermes-agent'), 'sin métrica');
  assert.equal(etiquetaModelo('gpt-6-luna'), 'gpt-6-luna');
  assert.equal(etiquetaModelo(null), null);
});

test('should_say_al_dia_only_when_ingestion_brings_news', async () => {
  const { textoIngesta } = await import('./licitacionesFormato.js');
  const base = { ingesta: { activa: true, estado: { fase: 'esperando' } }, al_dia_hasta: '2026-10-13T18:08:00Z' };
  assert.equal(textoIngesta({ ...base, alertas_operacion: [] }).valor, 'al día');
  assert.equal(
    textoIngesta({ ...base, alertas_operacion: [{ motivo: 'ingesta_sin_novedades', desde: base.al_dia_hasta }] }).valor,
    'sin novedades',
  );
  assert.match(textoIngesta(base).pista, /^Al día hasta /);
  assert.equal(textoIngesta({ ingesta: { activa: false } }).valor, 'parada');
  assert.equal(
    textoIngesta({ ingesta: { activa: true, estado: { fase: 'sincronizando perfiles' } } }).valor,
    'sincronizando perfiles…',
  );
});

test('should_translate_queue_failure_codes', async () => {
  const { causaFallo, nombreTipoTrabajo } = await import('./licitacionesFormato.js');
  assert.equal(causaFallo('run_inactivo'), 'Hermes dejó de responder');
  assert.equal(causaFallo(null), 'error de Hermes sin clasificar');
  assert.equal(causaFallo('nuevo_codigo'), 'nuevo_codigo');
  assert.equal(nombreTipoTrabajo('licitaciones.memoria_apartado'), 'Memoria apartado');
});

// NG-01: la ficha «No go» de Hermes descarta sola; la descartada ya no se lee como algo que revisar.
const NO_GO = {
  estado: 'descartada',
  categoria_descarte: 'hermes_no_go',
  descarte_automatico: true,
  motivo_descarte: 'Hermes: no go — No tenemos la clasificación exigida.',
};

test('should_show_hermes_no_go_as_the_discard_reason_instead_of_a_ficha_to_review', () => {
  const recomendacion = { decision: 'no_go', motivo: 'No tenemos la clasificación exigida.' };

  const descartada = opinionHermes({ ...NO_GO, recomendacion_ficha: recomendacion });
  const porRevisar = opinionHermes({ estado: 'nueva', recomendacion_ficha: recomendacion });

  assert.deepEqual(descartada, {
    texto: 'Hermes: no ir',
    motivo: 'No tenemos la clasificación exigida.',
    clave: 'descarte',
  });
  assert.equal(porRevisar.texto, 'Ficha: No go', 'sin descartar, la ficha sigue diciendo lo suyo');
});

test('should_explain_the_discard_with_the_no_go_that_caused_it_not_the_current_ficha', () => {
  const ahoraGo = { decision: 'go', motivo: 'Encaja y cumplimos solvencia' };

  const conMotivo = opinionHermes({ ...NO_GO, recomendacion_ficha: ahoraGo });
  const enLaLista = opinionHermes({
    estado: 'descartada',
    categoria_descarte: 'hermes_no_go',
    recomendacion_ficha: ahoraGo,
  });

  assert.equal(conMotivo.motivo, 'No tenemos la clasificación exigida.');
  assert.equal(enLaLista.motivo, null, 'sin motivo_descarte, el de una ficha que no dice «No go» no vale');
});

test('should_show_the_hermes_indicator_without_repeating_hermes', () => {
  const descartada = opinionHermes(NO_GO);

  assert.equal(valorOpinion(descartada), 'no ir');
  assert.equal(valorOpinion(opinionHermes({ veredicto_ia: 'descartar', motivo_ia: 'Obras' })), 'No encaja');
  assert.equal(valorOpinion(null), 'Sin cribar');
});

test('should_format_the_discard_notice_by_its_origin', () => {
  assert.equal(
    avisoDescarte(NO_GO),
    'Se descartó sola: Hermes leyó los pliegos y recomienda no ir (No tenemos la clasificación exigida). Si no es así, pulsa «Recuperar».',
  );
  assert.equal(
    avisoDescarte({
      estado: 'descartada',
      descarte_automatico: true,
      motivo_descarte: 'Requisito excluyente no cumplido: ENS',
    }),
    'Se descartó sola porque no la podemos presentar. Requisito excluyente no cumplido: ENS Si no es así, pulsa «Recuperar».',
  );
  assert.equal(
    avisoDescarte({ estado: 'descartada', descarte_automatico: false, motivo_descarte: 'Plazo imposible' }),
    'Descartada: Plazo imposible',
  );
  assert.equal(avisoDescarte({ estado: 'nueva', motivo_descarte: null }), null);
  assert.equal(avisoDescarte({ estado: 'descartada', motivo_descarte: '' }), null);
});

test('should_say_if_the_literal_quote_of_a_requirement_is_in_the_pliego', () => {
  const base = { documento: 'PCAP.pdf', pagina: 11 };
  assert.deepEqual(
    textoCitaRequisito({
      ...base,
      cita: 'al menos 72.000 euros',
      comprobacion_cita: { estado: 'comprobada', documento: 'Licitaciones/Ofertas/X/Pliegos/PCAP.pdf', pagina: 12 },
    }),
    { donde: 'PCAP.pdf · pág. 12', estado: { texto: 'cita comprobada', tono: 'ok' } },
    'la página donde de verdad está',
  );
  assert.deepEqual(
    textoCitaRequisito({
      ...base,
      cita: 'resumida',
      comprobacion_cita: { estado: 'no_localizada', documento: null, pagina: null },
    }),
    { donde: 'PCAP.pdf · pág. 11', estado: { texto: 'cita no localizada', tono: 'riesgo' } },
  );
  assert.deepEqual(
    textoCitaRequisito({
      ...base,
      cita: 'x',
      comprobacion_cita: { estado: 'sin_indice', documento: null, pagina: null },
    }),
    { donde: 'PCAP.pdf · pág. 11', estado: null },
  );
  assert.deepEqual(textoCitaRequisito({ ...base, cita: null }), { donde: 'PCAP.pdf · pág. 11', estado: null });
  assert.equal(textoCitaRequisito({ documento: null, pagina: null, cita: null }), null);
});

test('should_carry_the_quote_check_of_each_ficha_requirement_by_order', () => {
  const ficha = {
    datos: {
      requisitos: [
        {
          tipo: 'seguro',
          descripcion: 'Seguro',
          excluyente: false,
          cumple: 'si',
          justificacion: 'x',
          cita: 'póliza de 300.000 euros',
        },
        { tipo: 'idioma', descripcion: 'Castellano', excluyente: false, cumple: 'si', justificacion: 'x' },
      ],
    },
  };
  const [a, b] = requisitosDeFicha(ficha, [{ estado: 'comprobada', documento: 'P.pdf', pagina: 3 }, null]);
  assert.equal(a.comprobacion_cita.pagina, 3);
  assert.deepEqual([b.cita, b.comprobacion_cita], [null, null]);
});
