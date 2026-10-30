import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parecidasFuertes,
  aprendizajesVisibles,
  avisoBaja,
  camposDeResultado,
  estadisticasVisibles,
  enlaceDocumento,
  etiquetaResultadoActa,
  etiquetaResultadoPropuesta,
  filasCriteriosActa,
  leerPresentacion,
  leerResultado,
  puntosSobre,
  textoGenericos,
  textoLeerActas,
  textoPuntosActa,
  textoGanadas,
  textoPendientes,
  textoSinPropuestas,
  tituloAprendizaje,
} from './propuestasFormato.js';

test('should_format_points_and_result_labels', () => {
  assert.equal(puntosSobre(70, 100), '70 / 100 (70 %)');
  assert.equal(puntosSobre(null, 100), '—');
  assert.equal(etiquetaResultadoPropuesta('perdida'), 'Perdida');
  assert.equal(etiquetaResultadoPropuesta('otro'), 'otro');
});

test('should_link_documents_to_the_library_or_to_salidas', () => {
  assert.equal(
    enlaceDocumento('Conocimiento/Licitaciones/a b.pdf'),
    '/hermes-vault/api/v1/files/raw?path=Licitaciones%2Fa%20b.pdf',
  );
  assert.equal(enlaceDocumento('Salidas/x.md'), '/api/licitaciones/salidas/documento?ruta=Salidas%2Fx.md');
});

test('should_build_the_submission_body_and_reject_bad_fields', () => {
  const ok = leerPresentacion({
    lote: ' 2 ',
    fecha: '2026-10-01',
    importe: '95.000,50',
    documentos: ['Salidas/a.md'],
    otros: 'Conocimiento/b.pdf\nSalidas/a.md',
    notas: 'n',
  });
  assert.deepEqual(ok.body, {
    lote: '2',
    importe_ofertado: 95000.5,
    documentos: ['Salidas/a.md', 'Conocimiento/b.pdf'],
    notas: 'n',
    presentada_en: '2026-10-01',
  });
  assert.equal(leerPresentacion({ importe: '' }).body.importe_ofertado, null);
  assert.equal(leerPresentacion({ importe: '' }).body.presentada_en, undefined, 'sin fecha, hoy en el servidor');
  assert.match(leerPresentacion({ importe: 'abc' }).error, /importe/);
  assert.match(leerPresentacion({ importe: '0' }).error, /importe/);
  assert.match(leerPresentacion({ fecha: '1/10/2026' }).error, /AAAA-MM-DD/);
  assert.match(leerPresentacion({ otros: 'mi-disco/propuesta.pdf' }).error, /Salidas/);
});

test('should_build_the_result_change_and_round_trip_saved_values', () => {
  const campos = {
    resultado: 'perdida',
    puntos_tecnica: '30,5',
    puntos_economica: '40',
    puntos_total: '70.5',
    puntos_ganador: '',
    posicion: '3',
    notas: '',
    lecciones: 'Más equipo',
    fecha: '2026-09-30',
    importe: '95.000,5',
    documentos: 'Salidas/a.md\n\nConocimiento/b.pdf',
  };
  assert.deepEqual(leerResultado(campos, 'pendiente').body, {
    presentada_en: '2026-09-30',
    importe_ofertado: 95000.5,
    documentos: ['Salidas/a.md', 'Conocimiento/b.pdf'],
    resultado: 'perdida',
    notas: '',
    lecciones: 'Más equipo',
    puntos_tecnica: 30.5,
    puntos_economica: 40,
    puntos_total: 70.5,
    puntos_ganador: null,
    posicion: 3,
  });
  assert.match(leerResultado({ ...campos, puntos_total: '2000' }, 'pendiente').error, /0 a 1000/);
  assert.match(leerResultado({ ...campos, posicion: '0' }, 'pendiente').error, /posición/);
  assert.match(leerResultado({ ...campos, importe: '0' }, 'pendiente').error, /importe/);
  assert.match(leerResultado({ ...campos, documentos: 'mi-disco/a.pdf' }, 'pendiente').error, /Salidas/);
  const guardada = {
    resultado: 'ganada',
    puntos_tecnica: 30.5,
    puntos_economica: null,
    puntos_total: 80,
    puntos_ganador: null,
    posicion: 1,
    notas: 'x',
    lecciones: '',
    presentada_en: '2026-09-30',
    importe_ofertado: 95000.5,
    documentos: ['Salidas/a.md'],
  };
  const vuelta = camposDeResultado(guardada);
  assert.deepEqual(vuelta, {
    resultado: 'ganada',
    notas: 'x',
    lecciones: '',
    posicion: '1',
    fecha: '2026-09-30',
    importe: '95000,5',
    documentos: 'Salidas/a.md',
    puntos_tecnica: '30,5',
    puntos_economica: '',
    puntos_total: '80',
    puntos_ganador: '',
  });
  assert.equal(leerResultado(vuelta, 'ganada').body.importe_ofertado, 95000.5, 'el importe guardado vuelve igual');
});

test('should_send_the_result_only_when_the_person_changes_it', () => {
  const p = {
    resultado: 'ganada',
    puntos_total: 80,
    presentada_en: '2026-09-30',
    importe_ofertado: 1000,
    documentos: [],
  };
  const soloPuntos = leerResultado({ ...camposDeResultado(p), puntos_total: '85' }, p.resultado).body;
  assert.equal('resultado' in soloPuntos, false, 'guardar puntos no pasa el resultado de la PLACSP a manual');
  assert.equal(leerResultado({ ...camposDeResultado(p), resultado: 'perdida' }, p.resultado).body.resultado, 'perdida');
});

test('should_tell_an_empty_filter_apart_from_nothing_submitted', () => {
  assert.match(textoSinPropuestas({ total: 0, filtro: 'ganada' }), /^Aún no hay nada presentado/);
  assert.match(textoSinPropuestas(), /^Aún no hay nada presentado/);
  assert.equal(textoSinPropuestas({ total: 4, filtro: 'ganada' }), 'Ninguna con el resultado «Ganada».');
  assert.equal(textoSinPropuestas({ total: 4, busqueda: 'cabildo' }), 'Ninguna coincide con «cabildo».');
  assert.equal(
    textoSinPropuestas({ total: 4, filtro: 'perdida', busqueda: 'cabildo' }),
    'Ninguna con el resultado «Perdida» coincide con «cabildo».',
  );
  assert.equal(textoSinPropuestas({ total: 4 }), 'Nada que enseñar con estos filtros.');
});

test('should_count_generic_paragraphs', () => {
  assert.equal(textoGenericos(0), 'Ningún párrafo genérico');
  assert.equal(textoGenericos(undefined), 'Ningún párrafo genérico');
  assert.equal(textoGenericos(1), '1 párrafo genérico');
  assert.equal(textoGenericos(4), '4 párrafos genéricos');
});

test('should_label_the_result_read_from_a_board_report', () => {
  assert.equal(etiquetaResultadoActa('perdida'), 'Perdida');
  assert.equal(etiquetaResultadoActa('desconocido'), 'Sin resultado claro');
});

test('should_phrase_our_points_and_the_winners_from_the_report', () => {
  assert.equal(
    textoPuntosActa({ puntos_nuestros: 62.5, puntos_ganador: 78, ganador: 'Empresa X' }),
    'Tu empresa 62,5 · ganador 78 (Empresa X)',
  );
  assert.equal(
    textoPuntosActa({ puntos_nuestros: null, puntos_ganador: null, ganador: 'Empresa X' }),
    'Ganador (Empresa X)',
  );
  assert.equal(textoPuntosActa({ puntos_nuestros: 40, puntos_ganador: null, ganador: null }), 'Tu empresa 40');
  assert.equal(textoPuntosActa({ puntos_nuestros: null, puntos_ganador: null, ganador: null }), null);
  assert.equal(textoPuntosActa(undefined), null);
});

test('should_build_the_criteria_rows_of_a_board_report', () => {
  const [f, g] = filasCriteriosActa([
    { criterio: 'Metodología', puntos_max: 8, nuestros: 5, ganador: 7.5, comentario_mesa: 'Genérica', pagina: 3 },
    { criterio: 'Equipo', puntos_max: 6, nuestros: null, ganador: null, comentario_mesa: '', pagina: null },
  ]);
  assert.deepEqual(f, {
    clave: '0-Metodología',
    criterio: 'Metodología',
    nuestros: '5 / 8',
    ganador: '7,5 / 8',
    comentario: 'Genérica',
    pagina: 'pág. 3',
  });
  assert.equal(g.nuestros, '— / 6');
  assert.equal(g.ganador, '—');
  assert.equal(g.pagina, null);
  assert.deepEqual(filasCriteriosActa(), []);
});

test('should_hide_discarded_learnings_and_put_pending_ones_first', () => {
  const items = [
    { id: 1, estado: 'aceptada', creado_en: '2026-10-03' },
    { id: 2, estado: 'descartada', creado_en: '2026-10-04' },
    { id: 3, estado: 'pendiente', creado_en: '2026-10-01' },
    { id: 4, estado: 'aceptada', creado_en: '2026-10-05' },
  ];
  assert.deepEqual(
    aprendizajesVisibles(items).map((a) => a.id),
    [3, 4, 1],
  );
  assert.deepEqual(aprendizajesVisibles(), []);
});

test('should_title_a_learning_by_file_number_or_folder', () => {
  assert.equal(
    tituloAprendizaje({
      id: 1,
      expediente: 'EXP-2026-0412',
      organo: 'CASO_A',
      carpeta: 'Conocimiento/Licitaciones/Presentadas/X',
    }),
    'EXP-2026-0412 · CASO_A',
  );
  assert.equal(
    tituloAprendizaje({
      id: 1,
      expediente: null,
      organo: null,
      carpeta: 'Conocimiento/Licitaciones/Presentadas/2025 Cabildo/',
    }),
    '2025 Cabildo',
  );
  assert.equal(tituloAprendizaje({ id: 7 }), 'Aprendizaje 7');
});

test('should_disable_reading_reports_when_none_is_pending', () => {
  assert.deepEqual(textoLeerActas(3), { texto: 'Leer actas pendientes (3)', motivo: null });
  assert.equal(textoLeerActas(0).motivo, 'No hay actas sin leer en Presentadas.');
  assert.equal(textoLeerActas(undefined).texto, 'Leer actas pendientes (0)');
});

// Intl separa la cifra y el «€» con un espacio duro.
const espacios = (s) => s?.replace(/\s/g, ' ');

test('should_warn_about_a_discount_above_40_percent', () => {
  assert.equal(
    espacios(avisoBaja({ baja_ofertada: 0.577, presupuesto: 100_000 })),
    'Revisa: baja del 57,7 % sobre 100.000 €',
  );
  assert.equal(avisoBaja({ baja_ofertada: 0.45, presupuesto: null }), 'Revisa: baja del 45,0 %');
  assert.equal(avisoBaja({ baja_ofertada: 0.4, presupuesto: 100_000 }), null, 'el 40 % justo no avisa');
  assert.equal(avisoBaja({ baja_ofertada: null }), null);
  assert.equal(avisoBaja(null), null);
});

test('should_fold_statistics_until_5_decided', () => {
  assert.deepEqual(
    estadisticasVisibles({ por_resultado: { ganada: 1, perdida: 2, excluida: 1, pendiente: 9, desierta: 3 } }),
    { visibles: false, decididas: 4, texto: 'Con 4 decididas aún no dicen nada' },
  );
  assert.equal(estadisticasVisibles({ por_resultado: { perdida: 1 } }).texto, 'Con 1 decidida aún no dicen nada');
  assert.equal(estadisticasVisibles({ por_resultado: {} }).texto, 'Con 0 decididas aún no dicen nada');
  assert.deepEqual(estadisticasVisibles({ por_resultado: { ganada: 2, perdida: 3 } }), {
    visibles: true,
    decididas: 5,
    texto: null,
  });
  assert.equal(estadisticasVisibles(undefined).visibles, false);
});

test('should_pluralize_pending', () => {
  assert.equal(textoPendientes({ por_resultado: { pendiente: 1 } }), '1 pendiente de resultado');
  assert.equal(textoPendientes({ por_resultado: { pendiente: 3 } }), '3 pendientes de resultado');
  assert.equal(textoPendientes({ por_resultado: {} }), '0 pendientes de resultado');
});

test('should_say_where_each_win_comes_from', () => {
  const soloActa = {
    por_resultado: { pendiente: 1 },
    importe_ganado: 0,
    ganadas: { total: 1, registradas: 0, de_actas: 1, lista: [{ fuente: 'acta', nombre: 'PSTD_2-2026' }] },
  };
  assert.deepEqual(textoGanadas(soloActa), { valor: 1, texto: 'del acta de PSTD_2-2026' });
  const mixtas = {
    importe_ganado: 42_300,
    ganadas: {
      total: 3,
      registradas: 1,
      de_actas: 2,
      lista: [
        { fuente: 'registro', nombre: 'E1' },
        { fuente: 'acta', nombre: 'A' },
        { fuente: 'acta', nombre: 'B' },
      ],
    },
  };
  assert.equal(espacios(textoGanadas(mixtas).texto), '1 registrada (42.300 €) · 2 de las actas de A, B');
  assert.equal(
    espacios(textoGanadas({ por_resultado: { ganada: 2 }, importe_ganado: 10_000 }).texto),
    '2 registradas (10.000 €)',
    'servidor anterior',
  );
  assert.deepEqual(textoGanadas({ por_resultado: {}, ganadas: { total: 0, registradas: 0, de_actas: 0, lista: [] } }), {
    valor: 0,
    texto: 'ninguna aún',
  });
});

test('should_hide_weak_similar_offers', () => {
  const items = [{ id: 1, debil: false }, { id: 2, debil: true }, { id: 3 }];

  assert.deepEqual(
    parecidasFuertes(items).map((p) => p.id),
    [1, 3],
  );
  assert.deepEqual(parecidasFuertes(undefined), []);
});
