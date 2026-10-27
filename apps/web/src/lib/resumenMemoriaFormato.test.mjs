import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filaCompromiso,
  loteDeLaVista,
  lotesDelResumen,
  necesitaMotivo,
  pedidoActualizarAfectados,
  pedidoSuavizar,
  puedeActualizarAfectados,
  textoCoste,
  textoDescarte,
  textoHoras,
  textoNota,
  textoPaginas,
  textoSeDescartan,
  textoSinRedactar,
  versionDeClave,
  vistaCostes,
  vistaPreviaAfectados,
} from './resumenMemoriaFormato.js';

const limpio = { paginas: 28, limite: 30, avisos: [], sin_redactar: [], se_descartan: [] };

test('should_format_blind_critic_score_with_margin', () => {
  const nota = { total: 31.2, maximo: 40, margen: 3, fuente: 'critico_ciego' };

  const t = textoNota(nota);

  assert.equal(t, 'Nota del crítico ciego: 31,2 / 40 (± 3)');
});

test('should_show_no_score_when_there_is_no_blind_critique', () => {
  const t = textoNota(null);

  assert.doesNotMatch(t, /\d/);
  assert.match(t, /Sin nota/);
});

test('should_require_reason_when_paragraphs_remain_marked', () => {
  const marcados = [{ apartado: 3, cita: 'Los cursos empiezan en la semana 6' }];

  assert.equal(necesitaMotivo(limpio, marcados), true);
  assert.equal(necesitaMotivo({ ...limpio, avisos: ['Falta el lugar de firma'] }, []), true);
  assert.equal(necesitaMotivo({ ...limpio, sin_redactar: [4] }, []), true);
  assert.equal(necesitaMotivo(limpio, []), false);
  assert.equal(necesitaMotivo(null, null), false);
});

test('should_say_pages_against_limit', () => {
  assert.equal(textoPaginas(28, 30), '28 de 30 páginas');
  assert.equal(textoPaginas(32, 30), '32 de 30 páginas: sobran 2');
  assert.equal(textoPaginas(1, null), '1 página');
  assert.equal(textoPaginas(null, 30), null);
});

test('should_list_discarded_versions_newest_first', () => {
  assert.equal(textoSeDescartan([1, 2]), 'Se descartan: v2, v1');
  assert.equal(textoSeDescartan([]), null);
});

test('should_name_unwritten_sections', () => {
  assert.equal(textoSinRedactar([2, 4]), 'Sin redactar: apartados 2 y 4');
  assert.equal(textoSinRedactar([5]), 'Sin redactar: apartado 5');
  assert.equal(textoSinRedactar([]), null);
});

test('should_read_the_version_from_the_card_key', () => {
  assert.equal(versionDeClave('memoria:v3'), 3);
  assert.equal(versionDeClave('propuesta'), null);
  assert.equal(versionDeClave(undefined), null);
});

test('should_offer_lot_tabs_only_with_more_than_one_lot', () => {
  assert.deepEqual(
    lotesDelResumen({ decisiones: { datos: { lotes: [2, 4] } }, guion: { datos: { lotes: ['2', '4', '6'] } } }),
    ['2', '4'],
  );
  assert.deepEqual(lotesDelResumen({ decisiones: { datos: { lotes: [] } }, guion: { datos: { lotes: ['1', '2'] } } }), [
    '1',
    '2',
  ]);
  assert.deepEqual(lotesDelResumen({ guion: { datos: { lotes: ['1'] } } }), []);
  assert.deepEqual(lotesDelResumen(null), []);
});

test('should_mark_a_commitment_that_clashes', () => {
  const c = {
    que: 'Inicio de los cursos',
    quien: null,
    valor: 'semana 6',
    choca: '«semana 6» frente a 15 días desde la formalización',
  };

  const f = filaCompromiso(c);

  assert.equal(f.quien, '—');
  assert.equal(f.choca, 'choca con «semana 6» frente a 15 días desde la formalización');
  assert.equal(filaCompromiso({ ...c, choca: null }).choca, null);
});

test('should_say_who_discarded_a_previous_version_and_why', () => {
  const descartes = [
    { version: 2, motivo: 'Contradice el calendario del Anexo V', quien: 'Persona A', en: '2026-10-13T10:00:00Z' },
    { version: 1, motivo: null, quien: null, en: null },
  ];

  assert.equal(textoDescarte(2, descartes), 'Descartada por Persona A: «Contradice el calendario del Anexo V»');
  assert.equal(textoDescarte(1, descartes), 'Descartada, sin motivo guardado');
  assert.equal(textoDescarte(3, descartes), null);
  assert.equal(textoDescarte(2, undefined), null);
});

const previaCasoE = {
  cambios: [{ lotes: ['2'] }],
  afectadas: [
    {
      pieza: 'apartado',
      clave: 'v3-2',
      nombre: 'Apartado 2 · Metodología',
      accion: 'rehacer',
      por: ['lotes'],
      coste: { min: 15, runs: 1 },
      pierde: [],
    },
    {
      pieza: 'apartado',
      clave: 'v3-5',
      nombre: 'Apartado 5 · Equipo',
      accion: 'rehacer',
      por: ['lotes'],
      coste: { min: 15, runs: 1 },
      pierde: [],
    },
  ],
  apartados: [2, 5],
  indicaciones: 'Ya no vamos al lote 4.',
};

test('should_list_affected_sections_with_their_cost_from_the_preview', () => {
  const v = vistaPreviaAfectados(previaCasoE);

  assert.deepEqual(v.apartados, [
    { n: 2, nombre: 'Apartado 2 · Metodología' },
    { n: 5, nombre: 'Apartado 5 · Equipo' },
  ]);
  assert.equal(v.minutos, 30);
  assert.equal(v.runs, 2);
  assert.deepEqual(v.cambios, [{ lotes: ['2'] }]);
});

test('should_offer_nothing_when_nothing_changed_or_the_preview_is_malformed', () => {
  assert.equal(vistaPreviaAfectados({ cambios: [], afectadas: [], apartados: [] }), null);
  assert.equal(vistaPreviaAfectados(null), null);
  assert.equal(vistaPreviaAfectados({ cambios: 'x', afectadas: {} }), null);
});

test('should_ask_by_section_number_together_with_the_changes', () => {
  const v = vistaPreviaAfectados(previaCasoE);

  assert.deepEqual(pedidoActualizarAfectados(v), { apartados: [2, 5], cambios: [{ lotes: ['2'] }] });
});

test('should_leave_the_sections_to_the_server_when_none_has_a_number', () => {
  const v = { cambios: [{ lotes: ['2'] }], apartados: [{ n: null, nombre: 'Equipo' }] };

  assert.deepEqual(pedidoActualizarAfectados(v), { cambios: [{ lotes: ['2'] }] });
});

test('should_send_at_most_five_changes', () => {
  const cambios = Array.from({ length: 7 }, (_, i) => ({ lotes: [String(i)] }));

  assert.equal(pedidoActualizarAfectados({ cambios, apartados: [] }).cambios.length, 5);
});

test('should_not_offer_updating_the_submitted_or_a_trial_memory', () => {
  assert.equal(puedeActualizarAfectados({ version: 3, presentada: true }), false);
  assert.equal(puedeActualizarAfectados({ version: 4, ensayo: true }), false);
  assert.equal(
    puedeActualizarAfectados({ version: 5, sin_repartir: true }),
    false,
    'subida entera: sin apartados que rehacer',
  );
  assert.equal(
    puedeActualizarAfectados({ version: 6, progreso: null, origen: { subida: 'memoria-editada.docx' } }),
    false,
    'subida a mano: el servidor no la rehace',
  );
  assert.equal(puedeActualizarAfectados(null), false);
  assert.equal(puedeActualizarAfectados({ version: 3, progreso: { fase: 'fin' } }), true);
  assert.equal(
    puedeActualizarAfectados({ version: 2, progreso: null, origen: null }),
    true,
    'montada por el método anterior: sirve de base',
  );
});

test('should_read_a_lot_memory_with_its_own_lot_and_without_tabs', () => {
  // Arrange: CASO_E con los lotes 2 y 4; la v4 es la memoria propia del lote 2 y la primera, la común.
  const o = {
    decisiones: { datos: { lotes: ['2', '4'] } },
    memorias: [
      { version: 4, lote: '2' },
      { version: 1, lote: null },
    ],
  };

  // Act / Assert
  assert.deepEqual(
    loteDeLaVista(o, 4, '4'),
    { pestanas: [], lote: '2' },
    'la v4 es del lote 2: no se abre con el filtro de otro',
  );
  assert.deepEqual(loteDeLaVista(o, 1, null), { pestanas: ['2', '4'], lote: '2' });
  assert.deepEqual(loteDeLaVista(o, 1, '4'), { pestanas: ['2', '4'], lote: '4' });
  assert.deepEqual(loteDeLaVista({ memorias: [{ version: 1 }] }, 1, null), { pestanas: [], lote: null });
});

// ── Compromisos añadidos y su coste ──

const CIERRE = 'no añadas compromisos con coste que el pliego no pide.';
const compromiso = (o) => ({
  texto: 'Kit a cada alumna',
  cita: 'enviaremos un kit a cada alumna',
  apartados: [3],
  clase: 'anadido',
  criterio: null,
  horas: null,
  euros: 4700,
  supuesto: '329 alumnas × 14 €',
  barata: 'Utensilios de casa y vídeos',
  caro: true,
  instruccion: `En el apartado 3, sustituye «enviaremos un kit a cada alumna» por: Utensilios de casa y vídeos; ${CIERRE}`,
  ...o,
});
const entrevista = compromiso({
  texto: 'Entrevista de 30 min con cada alumna',
  cita: 'una entrevista de 30 minutos',
  apartados: [5, 2],
  horas: 165,
  euros: 4125,
  barata: 'A petición de la alumna',
  instruccion: `En el apartado 2, sustituye «una entrevista de 30 minutos» por: A petición de la alumna; En el apartado 5, sustituye «entrevista individual» por: A petición de la alumna; ${CIERRE}`,
});
// Intl separa el «€» con un espacio duro: se compara como espacio normal.
const llano = (t) => t?.replace(/\s/g, ' ');
const costes = (o) => ({
  cotejado: true,
  compromisos: [compromiso(), entrevista],
  total_anadidos: { horas: 1500, euros: 37000 },
  caros: 2,
  presupuesto_pct: 192,
  umbral_total_pct: 50,
  total_riesgo: true,
  ...o,
});

test('should_format_hours_and_euros_with_spanish_separators', () => {
  const k = costes();

  const v = vistaCostes(k);

  assert.equal(textoHoras(1500), '1.500 h');
  assert.equal(textoHoras(6.5), '6,5 h');
  assert.equal(llano(textoCoste(650, 16250)), '650 h · 16.250 €');
  assert.equal(llano(textoCoste(null, 4700)), '4.700 €');
  assert.equal(textoCoste(null, null), 'sin cifra');
  assert.equal(llano(v.total), 'Total añadido: ~1.500 h · 37.000 € (192 % del presupuesto)');
  assert.equal(v.totalRiesgo, true);
});

test('should_put_costliest_added_commitments_first_and_skip_required_ones', () => {
  const exigido = compromiso({ texto: 'Tutoría semanal', clase: 'exigido', caro: false, euros: 9000 });
  const barato = compromiso({ texto: 'Informe breve', caro: false, euros: 100 });

  const v = vistaCostes(costes({ compromisos: [barato, entrevista, exigido, compromiso()] }));

  assert.deepEqual(
    v.filas.map((f) => f.texto),
    ['Kit a cada alumna', 'Entrevista de 30 min con cada alumna', 'Informe breve'],
  );
  assert.equal(v.filas[1].donde, 'Apartados 5 y 2');
  assert.equal(v.vacio, null);
});

test('should_join_instructions_by_apartado_for_one_round', () => {
  const k = costes({
    compromisos: [
      compromiso({ apartados: [3] }),
      entrevista,
      compromiso({ texto: 'Barato', caro: false, apartados: [7] }),
    ],
  });

  const p = pedidoSuavizar(k);

  assert.deepEqual(p.apartados, [2, 3, 5]);
  const lineas = p.indicaciones.split('\n');
  assert.match(lineas[0], /^· En el apartado 2, sustituye «una entrevista de 30 minutos»/);
  assert.match(
    lineas[1],
    /^· En el apartado 3, sustituye «enviaremos un kit a cada alumna» por: Utensilios de casa y vídeos\.$/,
  );
  assert.equal(lineas.at(-1), 'No añadas compromisos con coste que el pliego no pide.');
  assert.equal(p.indicaciones.match(/no añadas compromisos/gi).length, 1);
  assert.ok(p.indicaciones.length >= 10);
});

test('should_ask_for_whole_memory_when_costly_commitments_have_no_apartado', () => {
  const k = costes({ compromisos: [compromiso({ apartados: [] })], caros: 1 });

  const p = pedidoSuavizar(k);

  assert.equal(p.apartados, null);
  assert.equal(
    pedidoSuavizar(costes({ compromisos: [compromiso({ caro: false })], caros: 0, total_riesgo: false })),
    null,
  );
});

test('should_say_checked_zero_when_no_costly_commitments', () => {
  const k = costes({
    compromisos: [compromiso({ caro: false, euros: 100 })],
    caros: 0,
    total_anadidos: { horas: 0, euros: 100 },
    presupuesto_pct: 1,
    total_riesgo: false,
  });

  const v = vistaCostes(k);

  assert.equal(v.vacio, 'Comprobado: 0 compromisos caros que el pliego no pida');
  assert.deepEqual(v.filas, []);
  assert.equal(v.sinCotejar, null);
});

test('should_mark_not_cotejado_and_tolerate_missing_costes', () => {
  const sinPliego = vistaCostes(costes({ cotejado: false }));
  const sinPresupuesto = vistaCostes(costes({ presupuesto_pct: null, total_riesgo: false }));

  assert.match(sinPliego.sinCotejar, /Sin cotejar/);
  assert.equal(llano(sinPresupuesto.total), 'Total añadido: ~1.500 h · 37.000 €');
  assert.equal(sinPresupuesto.totalRiesgo, false);
  assert.equal(vistaCostes(undefined), null);
  assert.equal(vistaCostes({}), null);
});

test('should_show_total_risk_from_server_even_without_costly_rows', () => {
  // El perfil pone el umbral total en 5 %: tres añadidos baratos que juntos lo pasan.
  const barato = (n) =>
    compromiso({
      texto: `Informe ${n}`,
      caro: false,
      euros: 1800,
      horas: 10,
      apartados: [n],
      instruccion: `En el apartado ${n}, sustituye «informe ${n}» por: a petición; ${CIERRE}`,
    });
  const k = costes({
    compromisos: [barato(2), barato(3), barato(4)],
    caros: 0,
    presupuesto_pct: 5,
    umbral_total_pct: 5,
    total_riesgo: true,
  });

  const v = vistaCostes(k);
  const p = pedidoSuavizar(k);

  assert.equal(v.vacio, null);
  assert.equal(v.totalRiesgo, true);
  assert.equal(v.filas.length, 3);
  assert.equal(v.aSuavizar, 3);
  assert.deepEqual(p.apartados, [2, 3, 4]);
  assert.equal(p.indicaciones.match(/no añadas compromisos/gi).length, 1);
});

test('should_show_justified_rows_and_not_soften_them_again_when_only_the_total_weighs', () => {
  // La ficha de solución justificó el informe 3 (compensa) y quitó el 4: el total sigue pesando.
  const barato = (n, o) =>
    compromiso({
      texto: `Informe ${n}`,
      caro: false,
      euros: 1800,
      horas: 10,
      apartados: [n],
      instruccion: `En el apartado ${n}, sustituye «informe ${n}» por: a petición; ${CIERRE}`,
      ...o,
    });
  const k = costes({
    compromisos: [
      barato(2),
      barato(3, { justificado: true, ficha: 'En la ficha de solución compensa: 2 puntos' }),
      barato(4, { justificado: true }),
    ],
    caros: 0,
    presupuesto_pct: 5,
    umbral_total_pct: 5,
    total_riesgo: true,
  });

  const v = vistaCostes(k);
  const p = pedidoSuavizar(k);

  assert.deepEqual(
    v.filas.map((f) => f.justificado),
    [false, true, true],
  );
  assert.equal(v.aSuavizar, 1, 'solo el que la ficha no decidió');
  assert.deepEqual(p.apartados, [2]);
});

test('should_not_mark_total_as_risk_when_server_says_it_is_below_profile_threshold', () => {
  // Umbral en 80 %: un 60 % no es riesgo aunque pase del 50 % de antes.
  const v = vistaCostes(costes({ presupuesto_pct: 60, umbral_total_pct: 80, total_riesgo: false }));

  assert.equal(v.totalRiesgo, false);
  assert.equal(v.vacio, null, 'hay caros: se enseñan');
});

test('should_bring_what_the_solution_sheet_says_of_each_commitment', () => {
  const v = vistaCostes(
    costes({
      compromisos: [compromiso({ caro: false, ficha: 'En la ficha de solución compensa: da 6 puntos' }), entrevista],
    }),
  );

  assert.deepEqual(
    v.filas.map((f) => f.ficha),
    [null, 'En la ficha de solución compensa: da 6 puntos'],
  );
});
