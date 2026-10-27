import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acumularFoco,
  MAX_TRAMO_FOCO_MS,
  tareaCerrada,
  accionesDeEstado,
  agruparPorCategoria,
  bloqueosAbiertos,
  cajonDeDestino,
  destinoAbre,
  destinoFoco,
  esEventoDe,
  esSoloLectura,
  filasDeModo,
  leerMotivo,
  marcaGravedad,
  modoComprobaciones,
  noComprobados,
  pidePrepararConfirmacion,
  primerBloqueo,
  recuentoBloqueos,
  textoAccionDato,
  textoCierreInterno,
  documentoDeCita,
  preguntaCambiosSinGuardar,
  salidaDeDestino,
  textoDescarte,
  motivoDeHermes,
  textoEta,
  textoMinutos,
  apartadosDeCoste,
  memoriaDeVersion,
  pedidoSuavizarFila,
  pedidosSuavizarTodos,
  puedeSuavizar,
  textoChipCoste,
  textoCompromisosAnadidos,
  textoCriterioCoste,
  textoRondaSuavizar,
} from './comprobacionesFormato.js';
import { fijarZonaEmpresa } from './formato.js';

// Los textos de estos tests son los de una empresa en Canarias: con la hora de allí al lado.
fijarZonaEmpresa('Atlantic/Canary');

const fila = (clave, categoria, gravedad, extra = {}) => ({
  clave,
  categoria,
  gravedad,
  lote: null,
  estado: 'abierto',
  propuesta: null,
  ...extra,
});

test('should_sort_open_blockers_by_fixed_category_order_then_severity_then_lot', () => {
  const c = {
    bloqueos: [
      fila('firma', 'firma', 'impide'),
      fila('precio:10', 'precio', 'impide', { lote: '10' }),
      fila('precio:2r', 'precio', 'riesgo', { lote: '2' }),
      fila('precio:2', 'precio', 'impide', { lote: '2' }),
      fila('ens', 'elegibilidad', 'riesgo'),
    ],
  };

  const claves = bloqueosAbiertos(c).map((b) => b.clave);

  assert.deepEqual(claves, ['ens', 'precio:2', 'precio:10', 'precio:2r', 'firma']);
  assert.equal(primerBloqueo(c).clave, 'ens');
});

test('should_leave_out_accepted_resolved_and_vamos_blockers', () => {
  const c = {
    bloqueos: [
      fila('a', 'precio', 'riesgo', { estado: 'riesgo_aceptado' }),
      fila('b', 'precio', 'impide', { estado: 'resuelto' }),
      fila('c', 'elegibilidad', 'impide', { estado: 'vamos' }),
      fila('d', 'empresa', 'ok'),
      fila('e', 'empresa', 'no_comprobado'),
      fila('f', 'documentos', 'impide', { estado: 'propuesta', propuesta: { resumen: 'x', campos: 1 } }),
    ],
  };

  assert.deepEqual(
    bloqueosAbiertos(c).map((b) => b.clave),
    ['f'],
  );
  assert.deepEqual(
    noComprobados(c).map((b) => b.clave),
    ['e'],
  );
  assert.equal(primerBloqueo({ bloqueos: [] }), null);
  assert.deepEqual(bloqueosAbiertos(null), []);
});

test('should_offer_vamos_only_on_eligibility_rows', () => {
  const eleg = accionesDeEstado(fila('ens', 'elegibilidad', 'impide')).map((a) => a.accion);
  const precio = accionesDeEstado(fila('p', 'precio', 'impide')).map((a) => a.accion);
  const riesgo = accionesDeEstado(fila('r', 'coherencia', 'riesgo')).map((a) => a.accion);

  assert.deepEqual(eleg, ['vamos', 'descartar']);
  assert.ok(!precio.includes('vamos'));
  assert.ok(!precio.includes('aceptar_riesgo'), 'un «impide» no se acepta como riesgo');
  assert.deepEqual(riesgo, ['aceptar_riesgo']);
  assert.ok(accionesDeEstado(fila('ens', 'elegibilidad', 'impide')).every((a) => a.conMotivo));
});

test('should_never_offer_accept_all_on_eligibility_or_accreditation', () => {
  const filas = [
    fila('medios', 'elegibilidad', 'riesgo', { estado: 'propuesta', propuesta: { resumen: 'docente', campos: 3 } }),
    fila('anexo_vii', 'documentos', 'no_comprobado', { accion: { tipo: 'subir_certificado' } }),
  ];

  const acciones = filas.flatMap((b) => accionesDeEstado(b).map((a) => a.accion));

  assert.ok(acciones.length > 0);
  assert.ok(acciones.every((a) => ['aplicar_propuesta', 'vamos', 'aceptar_riesgo', 'descartar'].includes(a)));
  assert.ok(!acciones.some((a) => /todo/.test(a)));
  assert.deepEqual(accionesDeEstado(fila('x', 'precio', 'riesgo', { estado: 'riesgo_aceptado' })), []);
});

test('should_reject_a_motive_shorter_than_15_characters', () => {
  assert.deepEqual(leerMotivo('  no vale  '), {
    motivo: null,
    error: 'Explica en una frase el motivo (al menos 15 caracteres).',
  });
  assert.equal(leerMotivo(null).error !== null, true);
  assert.deepEqual(leerMotivo('  Tenemos   la docente en Colaboradores '), {
    motivo: 'Tenemos la docente en Colaboradores',
    error: null,
  });
});

test('should_reject_a_motive_longer_than_the_server_accepts', () => {
  // Arrange
  const largo = 'a'.repeat(501);

  // Act
  const r = leerMotivo(largo);

  // Assert
  assert.deepEqual(r, { motivo: null, error: 'El motivo es demasiado largo: resúmelo en 500 caracteres como mucho.' });
  assert.equal(leerMotivo('a'.repeat(500)).error, null);
});

test('should_format_eta_as_peninsular_interval_with_canary_time', () => {
  assert.equal(textoEta({ desde: '15:50', hasta: '16:40' }), 'lista entre 15:50 y 16:40 (14:50-15:40 Canarias)');
  assert.equal(
    textoEta({ desde: '2026-10-15T13:50:00Z', hasta: '2026-10-15T14:40:00Z' }),
    'lista entre 15:50 y 16:40 (14:50-15:40 Canarias)',
  );
  assert.equal(textoEta({ desde: '00:10', hasta: '00:40' }), 'lista entre 00:10 y 00:40 (23:10-23:40 Canarias)');
  assert.equal(textoEta(null), null);
  assert.equal(textoMinutos(5.5), 'unos 6 min tuyos');
  assert.equal(textoMinutos(0), null);
});

test('should_treat_discarded_comprobaciones_as_read_only', () => {
  assert.equal(esSoloLectura({ veredicto: { tipo: 'descartada', texto: 'Descartada' } }), true);
  assert.equal(esSoloLectura({ veredicto: { tipo: 'no_presentable', texto: '' } }), false);
  assert.equal(esSoloLectura(null), false);
});

test('should_match_only_events_of_the_same_licitacion', () => {
  assert.equal(esEventoDe({ tipo: 'licitacion.comprobaciones', recurso: 'p-1' }, 'p-1'), true);
  assert.equal(esEventoDe({ tipo: 'licitacion.oferta', recurso: null, datos: { id: 'p-1' } }, 'p-1'), true);
  assert.equal(esEventoDe({ tipo: 'licitacion.comprobaciones', recurso: 'p-2', datos: { id: 'p-2' } }, 'p-1'), false);
  assert.equal(esEventoDe(null, 'p-1'), false);
  assert.equal(esEventoDe({ recurso: 'p-1' }, null), false);
});

test('should_choose_read_only_mode_for_a_discarded_offer', () => {
  const descartada = {
    estado: 'descartada',
    motivo_descarte: 'Sin solvencia técnica mínima',
    categoria_descarte: 'solvencia',
  };

  assert.equal(modoComprobaciones(descartada, { veredicto: { tipo: 'descartada' } }), 'solo_lectura');
  assert.equal(modoComprobaciones({ estado: 'en_preparacion' }, { veredicto: { tipo: 'descartada' } }), 'solo_lectura');
  assert.equal(modoComprobaciones({ estado: 'en_preparacion' }, { veredicto: { tipo: 'no_presentable' } }), 'completa');
  assert.equal(textoDescarte(descartada), 'Descartada por falta de solvencia: Sin solvencia técnica mínima');
  assert.equal(textoDescarte({ motivo_descarte: 'No llegamos' }), 'Descartada: No llegamos');
});

test('should_say_when_an_offer_was_discarded', () => {
  // Arrange
  const ahora = Date.parse('2026-10-15T10:00:00Z');
  const f = {
    estado: 'descartada',
    motivo_descarte: 'No encaja con lo que hacemos',
    categoria_descarte: 'encaje',
    descartada_en: '2026-10-12T09:30:00.000Z',
  };

  // Act
  const t = textoDescarte(f, ahora);

  // Assert
  assert.equal(t, 'Descartada el lun 12 oct por falta de encaje: No encaja con lo que hacemos');
  assert.equal(
    textoDescarte({ ...f, descartada_en: '2025-03-02T09:30:00.000Z' }, ahora),
    'Descartada el dom 2 mar 2025 por falta de encaje: No encaja con lo que hacemos',
  );
});

test('should_say_hermes_no_go_when_the_ficha_discarded_the_offer', () => {
  // Arrange
  const ahora = Date.parse('2026-10-15T10:00:00Z');
  const f = {
    estado: 'descartada',
    categoria_descarte: 'hermes_no_go',
    motivo_descarte: 'Hermes: no go — Obra civil sin clasificación',
    descartada_en: '2026-10-12T09:30:00.000Z',
  };

  // Act
  const t = textoDescarte(f, ahora);

  // Assert
  assert.equal(t, 'Descartada el lun 12 oct · Hermes: no ir — Obra civil sin clasificación');
  assert.equal(textoDescarte({ ...f, motivo_descarte: null, descartada_en: null }), 'Descartada · Hermes: no ir');
  assert.equal(motivoDeHermes('Hermes: no go — Sin ENS'), 'Sin ENS');
});

test('should_choose_decide_mode_for_a_ficha_por_revisar', () => {
  const c = {
    bloqueos: [
      fila('ens', 'elegibilidad', 'impide'),
      fila('precio:2', 'precio', 'impide', { lote: '2' }),
      fila('medios', 'elegibilidad', 'no_comprobado'),
    ],
    fases: [
      { nombre: 'decidir', estado: 'te_toca' },
      { nombre: 'pliegos', estado: 'hecho' },
    ],
  };

  const modo = modoComprobaciones({ estado: 'ficha_por_revisar' }, c);
  const filas = filasDeModo(c, modo);

  assert.equal(modo, 'decidir');
  assert.deepEqual(
    filas.abiertas.map((b) => b.clave),
    ['ens'],
  );
  assert.deepEqual(
    filas.noComprobadas.map((b) => b.clave),
    ['medios'],
  );
  assert.equal(pidePrepararConfirmacion({ go_no_go: { semaforo: { color: 'rojo' } } }), true);
  assert.equal(pidePrepararConfirmacion({ retirada: { etiqueta: 'Retirada' } }), true);
  assert.equal(pidePrepararConfirmacion({ go_no_go: { semaforo: { color: 'ambar' } }, retirada: null }), false);
});

test('should_label_an_echo_leak_as_suspicion_and_a_hard_leak_as_blocking', () => {
  assert.deepEqual(marcaGravedad(fila('eco', 'fugas', 'riesgo')), { texto: 'Sospecha', tono: 'aviso' });
  assert.deepEqual(marcaGravedad(fila('fuga', 'fugas', 'impide')), { texto: 'Impide', tono: 'peligro' });
  assert.deepEqual(marcaGravedad(fila('r', 'documentos', 'riesgo')), { texto: 'Riesgo', tono: 'aviso' });
});

test('should_label_data_actions_and_hide_the_ones_that_ask_nothing', () => {
  assert.equal(textoAccionDato({ tipo: 'fijar_precio', destino: 'precio-lote-2' }), 'Fijar el precio');
  assert.equal(textoAccionDato({ tipo: 'completar_empresa' }), 'Completar en Ajustes › Empresa');
  assert.equal(textoAccionDato({ tipo: 'campo', destino: 'decisiones.datos_anexo.impuesto' }), 'Decidir el dato');
  assert.equal(textoAccionDato({ tipo: 'algo_nuevo' }), 'Abrir');
  assert.equal(textoAccionDato({ tipo: 'esperar_hermes' }), null);
  assert.equal(textoAccionDato({ tipo: 'vamos' }), null);
  assert.equal(textoAccionDato(null), null);
});

test('should_count_and_group_open_blockers_in_category_order', () => {
  const filas = bloqueosAbiertos({
    bloqueos: [
      fila('a', 'empresa', 'riesgo'),
      fila('b', 'precio', 'impide'),
      fila('c', 'precio', 'riesgo'),
      fila('d', 'empresa', 'impide'),
    ],
  });

  const grupos = agruparPorCategoria(filas);

  assert.equal(recuentoBloqueos(filas), '2 impiden · 2 riesgos');
  assert.equal(recuentoBloqueos([fila('x', 'precio', 'impide'), fila('y', 'precio', 'riesgo')]), '1 impide · 1 riesgo');
  assert.deepEqual(
    grupos.map((g) => [g.etiqueta, g.filas.map((b) => b.clave)]),
    [
      ['Precio', ['b', 'c']],
      ['Datos de empresa', ['d', 'a']],
    ],
  );
  assert.deepEqual(agruparPorCategoria([]), []);
});

test('should_format_internal_close_in_peninsular_time_with_canary_time', () => {
  const ahora = Date.parse('2026-10-14T12:00:00Z');

  assert.equal(
    textoCierreInterno('2026-10-15T04:00:00.000Z', ahora),
    'Cierre interno: jue 15 oct 06:00 (05:00 Canarias)',
  );
  assert.equal(textoCierreInterno(null, ahora), null);
});

test('should_focus_the_same_row_or_the_first_one_when_it_is_already_resolved', () => {
  const filas = [fila('ens', 'elegibilidad', 'impide'), fila('precio:2', 'precio', 'impide')];

  assert.deepEqual(destinoFoco(filas, 'precio:2'), { clave: 'precio:2', resuelta: false });
  assert.deepEqual(destinoFoco(filas, 'ya_no'), { clave: 'ens', resuelta: true });
  assert.deepEqual(destinoFoco([], 'ya_no'), { clave: null, resuelta: true });
  assert.equal(destinoFoco(filas, null), null);
});

test('should_split_destino_into_drawer_and_field', () => {
  assert.deepEqual(cajonDeDestino('decisiones.precio.3'), { nombre: 'decisiones', campo: 'precio.3' });
  assert.deepEqual(cajonDeDestino('decisiones'), { nombre: 'decisiones', campo: null });
  assert.deepEqual(cajonDeDestino('precio-lote-2'), { nombre: 'decisiones', campo: 'precio.2' });
  assert.deepEqual(cajonDeDestino('precio-lote-unico'), { nombre: 'decisiones', campo: 'precio.unico' });
  assert.deepEqual(
    cajonDeDestino('equipo:tutor'),
    { nombre: 'decisiones', campo: 'equipo' },
    'el data-foco de la sección Equipo',
  );
  assert.deepEqual(cajonDeDestino('automatico:Formatos de descarga|2'), {
    nombre: 'decisiones',
    campo: 'automatico:Formatos de descarga|2',
  });
  assert.deepEqual(cajonDeDestino('propuesta'), { nombre: 'decisiones', campo: null });
  assert.deepEqual(cajonDeDestino('memoria.apartado.2.1'), { nombre: 'memoria', campo: 'apartado.2.1' });
  assert.deepEqual(cajonDeDestino('documentos.a3-d2'), { nombre: 'documentos', campo: 'a3-d2' });
  assert.deepEqual(cajonDeDestino('guion'), { nombre: 'guion', campo: null });
});

test('should_return_null_drawer_for_unknown_destino', () => {
  for (const d of ['empresa.domicilio', 'empresa', 'ficha', 'pliegos', 'otra.cosa', '', null, undefined, 3])
    assert.equal(cajonDeDestino(d), null);
  assert.equal(salidaDeDestino('empresa.contacto.email'), 'ajustes');
  assert.equal(salidaDeDestino('pliegos'), 'expediente');
  assert.equal(salidaDeDestino('otra.cosa'), null);
  assert.equal(destinoAbre('otra.cosa'), false);
  assert.equal(destinoAbre(undefined), false);
  assert.equal(destinoAbre('ficha'), true);
});

test('should_name_every_drawer_with_unsaved_changes_in_the_question', () => {
  assert.equal(
    preguntaCambiosSinGuardar(['decisiones']),
    'Tienes cambios sin guardar en Decisiones. ¿Salir sin guardarlos?',
  );
  assert.equal(
    preguntaCambiosSinGuardar(['decisiones', 'memoria', 'guion']),
    'Tienes cambios sin guardar en Decisiones, Memoria y Guion. ¿Salir sin guardarlos?',
  );
});

test('should_sum_focus_only_while_visible_and_focused', () => {
  // Arrange
  const con = (ahora, extra = {}) => ({ ahora, abierta: true, visible: true, foco: true, ...extra });
  let s = { ms: 0, desde: null };

  // Act: 10 s con foco; 20 s con la pestaña oculta; 5 s con la ventana sin foco; 3 s con foco; 4 s con la fila plegada.
  s = acumularFoco(s, con(0));
  s = acumularFoco(s, con(10_000, { visible: false }));
  s = acumularFoco(s, con(30_000, { foco: false }));
  s = acumularFoco(s, con(35_000));
  s = acumularFoco(s, con(38_000, { abierta: false }));
  const plegada = acumularFoco(s, con(42_000));

  // Assert
  assert.equal(s.ms, 13_000);
  assert.equal(s.desde, null);
  assert.equal(plegada.ms, 13_000);
  assert.equal(plegada.desde, 42_000);
  assert.equal(acumularFoco({ ms: 0, desde: 0 }, con(10 * 60 * 60_000)).ms, MAX_TRAMO_FOCO_MS);
  assert.equal(acumularFoco({ ms: 5, desde: 100 }, con(50)).ms, 5);
  assert.deepEqual(['resuelto', 'riesgo_aceptado', 'vamos', 'abierto', 'propuesta'].map(tareaCerrada), [
    true,
    true,
    true,
    false,
    false,
  ]);
});

test('should_find_the_downloaded_document_and_page_of_a_quote', () => {
  // Arrange
  const pliegos = [
    { nombre: 'PCAP.pdf', ruta: 'Licitaciones/Radar/2026/p-1/0-PCAP.pdf' },
    { nombre: 'Sin bajar.pdf', ruta: null },
  ];

  // Act
  const conPagina = documentoDeCita({ documento: 'PCAP.pdf', pagina: 12, texto: 'x' }, pliegos);

  // Assert
  assert.deepEqual(conPagina, { ruta: 'Licitaciones/Radar/2026/p-1/0-PCAP.pdf', pagina: 12 });
  assert.deepEqual(documentoDeCita({ documento: 'PCAP.pdf', pagina: null }, pliegos), {
    ruta: 'Licitaciones/Radar/2026/p-1/0-PCAP.pdf',
    pagina: null,
  });
  assert.equal(documentoDeCita({ documento: 'Sin bajar.pdf', pagina: 1 }, pliegos), null);
  assert.deepEqual(
    documentoDeCita({ documento: 'Nota de rectificación.pdf', pagina: 1 }, [
      { nombre: 'Nota de rectificación', ruta: 'L/R/8-Nota de rectificación' },
    ]),
    { ruta: 'L/R/8-Nota de rectificación', pagina: 1 },
    'el pliego sin extensión también',
  );
  assert.equal(documentoDeCita({ documento: 'Otro.pdf', pagina: 1 }, pliegos), null);
  assert.equal(documentoDeCita(null, pliegos), null);
});

// ── Compromisos caros (TC-12): filas como las de comprobacionesReglasCostes.ts ──

const instruccion = (n, cita, barata) =>
  `En el apartado ${n}, sustituye «${cita}» por: ${barata}; no añadas compromisos con coste que el pliego no pide.`;
// El € va tras un espacio duro (Intl): se compara con espacios normales.
const plano = (t) => (t === null ? null : t.replace(/\s/g, ' '));
const caro = (sujeto, coste, extra = {}) =>
  fila(`compromiso_caro:3:${sujeto}`, 'coherencia', 'riesgo', {
    lote: '3',
    accion: { tipo: 'suavizar', destino: 'memoria.apartado.4' },
    coste: {
      horas: null,
      euros: null,
      supuesto: 's',
      clase: 'anadido',
      criterio: null,
      barata: 'b',
      instruccion: 'i',
      memoria_version: 2,
      apariciones: [],
      ...coste,
    },
    ...extra,
  });

test('should_format_cost_chip', () => {
  assert.equal(plano(textoChipCoste({ horas: 650, euros: 16250 })), '~650 h · ~16.250 €');
  assert.equal(textoChipCoste({ horas: 1500, euros: null }), '~1.500 h');
  assert.equal(plano(textoChipCoste({ horas: 0, euros: 4700 })), '~4.700 €');
  assert.equal(textoChipCoste({ horas: null, euros: null }), null);
  assert.equal(textoChipCoste(undefined), null);
  assert.equal(textoCriterioCoste({ criterio: 'Plan de seguimiento' }), 'Puntúa en «Plan de seguimiento»');
  assert.equal(textoCriterioCoste({ criterio: null }), null);
});

test('should_take_sorted_unique_sections_of_all_appearances', () => {
  const coste = {
    apariciones: [
      { cita: 'a', apartado: 6 },
      { cita: 'b', apartado: 4 },
      { cita: 'c', apartado: 6 },
      { cita: 'd', apartado: null },
    ],
  };

  assert.deepEqual(apartadosDeCoste(coste), [4, 6]);
  assert.equal(apartadosDeCoste({ apariciones: [{ cita: 'x', apartado: null }] }), null);
  assert.equal(apartadosDeCoste(null), null);
});

test('should_send_row_instruction_and_its_memoria_version_when_softening_one_row', () => {
  const b = caro('entrevista_alumna', {
    instruccion: instruccion(6, 'entrevista de 30 min', 'a petición'),
    apariciones: [{ cita: 'entrevista de 30 min', apartado: 6 }],
  });

  assert.deepEqual(pedidoSuavizarFila(b), {
    version: 2,
    apartados: [6],
    indicaciones: instruccion(6, 'entrevista de 30 min', 'a petición'),
  });
});

test('should_build_one_round_for_all_soften_rows', () => {
  const filas = [
    caro('kit_alumna', {
      instruccion: instruccion(5, 'un kit a cada alumna', 'utensilios de casa'),
      apariciones: [{ cita: 'un kit a cada alumna', apartado: 5 }],
    }),
    caro('entrevista_alumna', {
      instruccion: instruccion(4, 'entrevista', 'a petición'),
      apariciones: [
        { cita: 'entrevista', apartado: 4 },
        { cita: 'entrevista', apartado: 5 },
      ],
    }),
    fila('compromisos_caros:3:total', 'coherencia', 'riesgo', {
      lote: '3',
      coste: {
        horas: 1500,
        euros: 37000,
        supuesto: '12 compromisos añadidos: 1.500 h y material, el 190 % del presupuesto base del lote',
        instruccion: 'todo',
        memoria_version: 2,
        apariciones: [],
      },
    }),
    fila('precio:3', 'precio', 'impide', { lote: '3' }),
  ];

  const pedidos = pedidosSuavizarTodos(filas);

  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].version, 2);
  assert.deepEqual(pedidos[0].apartados, [4, 5]);
  assert.equal(
    pedidos[0].indicaciones,
    [
      '· En el apartado 4, sustituye «entrevista» por: a petición.',
      '· En el apartado 5, sustituye «un kit a cada alumna» por: utensilios de casa.',
      'No añadas compromisos con coste que el pliego no pide.',
    ].join('\n'),
  );
});

test('should_use_total_row_when_there_are_no_single_rows_and_nothing_without_cost_rows', () => {
  const total = fila('compromisos_caros:-:total', 'coherencia', 'riesgo', {
    coste: {
      horas: 40,
      euros: 900,
      supuesto: '3 compromisos añadidos: 40 h y material, el 60 % del presupuesto base del lote',
      instruccion: instruccion(2, 'x', 'y'),
      memoria_version: 7,
      apariciones: [{ cita: 'x', apartado: 2 }],
    },
  });

  assert.deepEqual(
    pedidosSuavizarTodos([total]).map((p) => [p.version, p.apartados]),
    [[7, [2]]],
  );
  assert.deepEqual(pedidosSuavizarTodos([fila('precio:1', 'precio', 'impide')]), []);
  assert.deepEqual(pedidosSuavizarTodos(null), []);
});

test('should_hide_soften_when_memoria_presented_or_round_running', () => {
  const b = caro('kit_alumna', {});
  const o = {
    memorias: [
      { version: 1, estado: 'ensamblada' },
      { version: 2, estado: 'ensamblada', presentada: false },
    ],
  };
  const m = memoriaDeVersion(o, 2);

  assert.equal(puedeSuavizar(b, m, false), true);
  assert.equal(puedeSuavizar(b, { ...m, presentada: true }, false), false);
  assert.equal(puedeSuavizar(b, m, true), false);
  assert.equal(puedeSuavizar(b, memoriaDeVersion(o, 9), false), false);
  assert.equal(puedeSuavizar({ ...b, estado: 'riesgo_aceptado' }, m, false), false);
  assert.equal(puedeSuavizar(fila('precio:1', 'precio', 'riesgo'), m, false), false);
  assert.equal(memoriaDeVersion(null, 2), null);
});

test('should_summarize_added_commitments_from_server_summary_with_or_without_total_row', () => {
  const resumen = { anadidos: 12, caros: 2, horas: 1500, euros: 37000, presupuesto_pct: 190 };
  const filas = [
    caro('kit_alumna', { horas: null, euros: 4700, resumen }),
    caro('dedicacion_subgrupo', { horas: 650, euros: 16250, resumen }),
    fila('compromisos_caros:3:total', 'coherencia', 'riesgo', {
      lote: '3',
      coste: {
        horas: 1500,
        euros: 37000,
        supuesto: 's',
        instruccion: 'i',
        memoria_version: 2,
        apariciones: [],
        resumen,
      },
    }),
  ];
  const debajo = { anadidos: 5, caros: 5, horas: 300, euros: 7500, presupuesto_pct: 40 };
  const otroLote = caro(
    'informe',
    { horas: 20, euros: 500, resumen: { anadidos: 1, caros: 1, horas: 20, euros: 500, presupuesto_pct: 3 } },
    { lote: '4' },
  );

  assert.equal(
    plano(textoCompromisosAnadidos(filas)),
    'Compromisos añadidos: 12 · ~1.500 h · ~37.000 € (190 % del presupuesto)',
  );
  assert.equal(
    plano(textoCompromisosAnadidos(filas.slice(0, 2))),
    'Compromisos añadidos: 12 · ~1.500 h · ~37.000 € (190 % del presupuesto)',
    'lo mismo sin la fila del total',
  );
  assert.equal(
    plano(textoCompromisosAnadidos([caro('kit', { horas: 300, euros: 7500, resumen: debajo })])),
    'Compromisos añadidos: 5 · ~300 h · ~7.500 € (40 % del presupuesto)',
    'con el % aunque no haya fila del total',
  );
  assert.equal(
    plano(textoCompromisosAnadidos([...filas, otroLote])),
    'Compromisos añadidos: 13 · ~1.520 h · ~37.500 €',
    'dos lotes: sin %',
  );
  assert.equal(textoCompromisosAnadidos([caro('viejo', { horas: 10 })]), null, 'sin resumen del servidor');
  assert.equal(textoCompromisosAnadidos([fila('precio:1', 'precio', 'impide')]), null);
  assert.equal(textoCompromisosAnadidos([]), null);
});

test('should_take_count_and_budget_share_from_the_total_row_numeric_fields', () => {
  // El resumen de una fila suelta se quedó antes que el total; la fila del total trae n y pct_presupuesto.
  const viejo = { anadidos: 9, caros: 1, horas: 1500, euros: 37000, presupuesto_pct: 150 };
  const total = (coste) =>
    fila('compromisos_caros:3:total', 'coherencia', 'riesgo', {
      lote: '3',
      coste: {
        horas: 1500,
        euros: 37000,
        supuesto: 's',
        instruccion: 'i',
        memoria_version: 2,
        apariciones: [],
        resumen: viejo,
        ...coste,
      },
    });
  const filas = [caro('kit_alumna', { euros: 4700, resumen: viejo }), total({ n: 14, pct_presupuesto: 190 })];

  assert.equal(
    plano(textoCompromisosAnadidos(filas)),
    'Compromisos añadidos: 14 · ~1.500 h · ~37.000 € (190 % del presupuesto)',
  );
  assert.equal(
    plano(textoCompromisosAnadidos([total({ n: 14, pct_presupuesto: null })])),
    'Compromisos añadidos: 14 · ~1.500 h · ~37.000 €',
    'sin presupuesto, sin %',
  );
  assert.equal(
    plano(textoCompromisosAnadidos([total({})])),
    'Compromisos añadidos: 9 · ~1.500 h · ~37.000 € (150 % del presupuesto)',
    'un servidor anterior: el resumen',
  );
});

test('should_put_closing_clause_once_when_softening_total_row_with_joined_instructions', () => {
  const unidas = `${instruccion(2, 'x', 'y').replace(/; no añadas.*$/, '')}; En el apartado 4, sustituye «z» por: w; no añadas compromisos con coste que el pliego no pide.`;
  const vieja = `${instruccion(2, 'x', 'y')} ${instruccion(4, 'z', 'w')}`;
  const total = (i) =>
    fila('compromisos_caros:-:total', 'coherencia', 'riesgo', {
      coste: {
        horas: 40,
        euros: 900,
        supuesto: 's',
        instruccion: i,
        memoria_version: 7,
        apariciones: [
          { cita: 'x', apartado: 2 },
          { cita: 'z', apartado: 4 },
        ],
      },
    });

  const [nueva, antigua] = [unidas, vieja].map((i) => pedidosSuavizarTodos([total(i)])[0].indicaciones);

  for (const t of [nueva, antigua]) assert.equal(t.match(/no añadas compromisos/gi).length, 1, t);
  assert.equal(nueva.split(/\n/).at(-1), 'No añadas compromisos con coste que el pliego no pide.');
});

test('should_offer_see_in_memoria_as_data_button_of_soften_rows', () => {
  assert.equal(textoAccionDato({ tipo: 'suavizar', destino: 'memoria.apartado.4' }), 'Ver en la memoria');
  assert.deepEqual(cajonDeDestino('memoria.apartado.4'), { nombre: 'memoria', campo: 'apartado.4' });
});

test('should_say_which_sections_the_soften_round_rewrites', () => {
  assert.equal(textoRondaSuavizar([4]), 'Hermes rehará el apartado 4 en una versión nueva, con esta instrucción:');
  assert.equal(
    textoRondaSuavizar([4, 5, 6]),
    'Hermes rehará los apartados 4, 5 y 6 en una versión nueva, con esta instrucción:',
  );
  assert.equal(textoRondaSuavizar(null), 'Hermes rehará la memoria entera en una versión nueva, con esta instrucción:');
});
