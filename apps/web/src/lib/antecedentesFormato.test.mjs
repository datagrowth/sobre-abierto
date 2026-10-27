import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agruparPorEdicion,
  etiquetaNivel,
  fechaNumerica,
  motivoSinEdiciones,
  repartirDelOrgano,
  tituloOtroObjeto,
  nivelVisible,
  textoDuracion,
  textoParecido,
  textoPeriodo,
  textoSenal,
  vistaElegida,
  vistasAntecedentes,
} from './antecedentesFormato.js';

test('should_describe_contract_duration_in_spanish_units', () => {
  assert.equal(textoDuracion({ valor: 24, unidad: 'MON' }), '24 meses');
  assert.equal(textoDuracion({ valor: 1, unidad: 'ANN' }), '1 año');
  assert.equal(textoDuracion({ valor: 112, unidad: 'DAY' }), '112 días');
  assert.equal(textoDuracion(null), '—');
});

test('should_mark_an_estimated_contract_end', () => {
  assert.equal(
    textoPeriodo({ inicio: '2024-01-01', fin: '2025-12-31', fin_estimado: true }),
    '01/01/2024 – ≈ 31/12/2025',
  );
  assert.equal(
    textoPeriodo({ inicio: '2024-01-01', fin: '2025-12-31', fin_estimado: false }),
    '01/01/2024 – 31/12/2025',
  );
  assert.equal(textoPeriodo({ inicio: null, fin: '2025-12-31', fin_estimado: false }), '? – 31/12/2025');
  assert.equal(textoPeriodo({ inicio: null, fin: null }), '—');
});

test('should_format_similarity_and_level_labels', () => {
  assert.equal(textoParecido(0.874), '87 %');
  assert.equal(textoParecido(null), '—');
  assert.equal(etiquetaNivel('alto'), 'Alto');
  assert.equal(etiquetaNivel(undefined), '—');
});

test('should_group_timeline_rows_by_edition_keeping_their_order', () => {
  const hitos = [
    { licitacion_id: 'p-3', anio: '2025', expediente: 'E3', lote: '1' },
    { licitacion_id: 'p-3', anio: '2025', expediente: 'E3', lote: '2' },
    { licitacion_id: 'p-1', anio: '2023', expediente: 'E1', lote: null },
  ];
  const grupos = agruparPorEdicion(hitos);
  assert.deepEqual(
    grupos.map((g) => [g.anio, g.filas.length]),
    [
      ['2025', 2],
      ['2023', 1],
    ],
  );
  assert.deepEqual(agruparPorEdicion(), []);
});

test('should_offer_the_contract_and_each_lot_as_views', () => {
  const datos = {
    ediciones: [{ licitacion_id: 'p-1' }],
    indicios: { nivel: 'medio', puntos: 3, indicios: [], sin_datos: [] },
    lotes: [
      { id: '2', nombre: 'Web', ediciones: [], indicios: { nivel: 'alto', puntos: 5, indicios: [], sin_datos: [] } },
    ],
  };
  assert.deepEqual(
    vistasAntecedentes(datos).map((v) => [v.clave, v.nivel, v.n]),
    [
      ['contrato', 'medio', 1],
      ['lote-2', 'alto', 0],
    ],
  );
  assert.equal(vistaElegida(datos, 'lote-2').titulo, 'Lote 2 · Web');
  assert.equal(vistaElegida(datos, 'contrato').ediciones.length, 1);
  assert.equal(vistaElegida(null, 'contrato').indicios.nivel, 'bajo');
});

test('should_describe_a_tailored_tender_signal_with_its_source', () => {
  const s = {
    tipo: 'marca_o_compatibilidad',
    descripcion: 'Exige compatibilidad con un sistema concreto',
    cita: 'compatible con SIGMA',
    documento: 'PPT.pdf',
    pagina: 7,
  };
  assert.equal(
    textoSenal(s),
    'Marca o compatibilidad obligatoria: Exige compatibilidad con un sistema concreto «compatible con SIGMA» (PPT.pdf, pág. 7)',
  );
  assert.equal(
    textoSenal({ tipo: 'otra', descripcion: 'Plazo de implantación de una semana' }),
    'Otra señal: Plazo de implantación de una semana',
  );
  assert.equal(textoSenal({ tipo: 'otra', descripcion: 'Plazo corto', lote: '2' }), 'Otra señal (lote 2): Plazo corto');
});

test('should_show_no_data_instead_of_a_green_low_level_when_there_is_nothing_to_judge', () => {
  const vacio = { nivel: 'bajo', puntos: 0, indicios: [], sin_datos: [] };
  assert.equal(nivelVisible(vacio, []), 'sin_datos');
  assert.equal(
    nivelVisible({ ...vacio, indicios: [{ codigo: 'plazo_corto', peso: 0 }] }, []),
    'sin_datos',
    'un plazo en el mínimo no suma',
  );
  assert.equal(
    nivelVisible(vacio, [{ licitacion_id: 'p-1' }]),
    'bajo',
    'con ediciones y sin indicios, bajo es un resultado',
  );
  assert.equal(nivelVisible({ nivel: 'medio', puntos: 3, indicios: [], sin_datos: [] }, []), 'medio');
  assert.equal(etiquetaNivel('sin_datos'), 'Sin datos');
  assert.equal(vistasAntecedentes({ ediciones: [], indicios: vacio, lotes: [] })[0].nivel, 'sin_datos');
});

test('should_count_editions_and_not_timeline_rows_in_the_view_pills', () => {
  const fila = (id, lote) => ({ licitacion_id: id, lote });
  const datos = {
    ediciones: [
      fila('p-2', '1'),
      fila('p-2', '2'),
      fila('p-2', '3'),
      fila('p-2', '4'),
      fila('p-1', '1'),
      fila('p-1', '2'),
      fila('p-1', '3'),
      fila('p-1', '4'),
    ],
    indicios: { nivel: 'medio', puntos: 3, indicios: [], sin_datos: [] },
    lotes: [],
  };
  assert.equal(vistasAntecedentes(datos)[0].n, 2);
});

test('should_say_why_there_are_no_editions_outside_the_folded_explanation', () => {
  assert.match(motivoSinEdiciones({ licitacion: { organo_por: null } }), /No se puede identificar el órgano/);
  assert.match(
    motivoSinEdiciones({ licitacion: { organo_por: 'mismo NIF del órgano' } }),
    /Fuentes y filtros › Histórico\.$/,
  );
  assert.match(
    motivoSinEdiciones({
      licitacion: { organo_por: 'mismo código DIR3 o mismo nombre de órgano (la plataforma no publica su NIF)' },
    }),
    /órgano superior/,
  );
});

test('should_format_contract_dates_as_numbers_without_shifting_the_day', () => {
  assert.equal(fechaNumerica('2024-01-01'), '01/01/2024');
  assert.equal(fechaNumerica('2025-12-31T23:30:00Z'), '31/12/2025', 'se toma el día del texto');
  assert.equal(fechaNumerica(null), null);
  assert.equal(fechaNumerica('sin fecha'), null);
});

// CASO_B (p-91000740): «No hay ediciones anteriores del mismo órgano» y debajo, en Precios, seis
// contratos «mismo órgano» (Devoteam 2024, CAS Training 2023, EOI 2022).
const CASO_B = { licitacion: { organo_por: 'mismo NIF del órgano' } };
const adj = (adjudicatario_nombre, otro_objeto, mismo_organo = true) => ({
  adjudicatario_nombre,
  mismo_organo,
  otro_objeto,
});

test('should_not_say_no_previous_editions_when_same_nif_has_awards', () => {
  const delOrgano = repartirDelOrgano([
    adj('Empresa A', false),
    adj('Empresa B', true),
    adj('Empresa C', true),
    adj('De otro órgano', false, false),
  ]);

  const motivo = motivoSinEdiciones(CASO_B, delOrgano);

  assert.doesNotMatch(motivo, /No hay ediciones anteriores/);
  assert.equal(
    motivo,
    'Ninguna licitación anterior del mismo órgano (mismo NIF del órgano) cuenta como edición de esta: 1 adjudicación suya de objeto parecido no cumple las reglas de edición (publicada al menos seis meses antes, en el mismo sitio y con un importe parecido): está en Precios → Adjudicaciones parecidas; 2 adjudicaciones son de otro objeto y van plegadas debajo.',
  );
  assert.match(
    motivoSinEdiciones(CASO_B, repartirDelOrgano([])),
    /^No hay ediciones anteriores del mismo órgano/,
    'sin adjudicaciones del órgano, el texto de siempre',
  );
  assert.match(
    motivoSinEdiciones(CASO_B),
    /^No hay ediciones anteriores/,
    'mientras no han llegado las adjudicaciones',
  );
});

test('should_fold_same_organ_awards_with_another_subject', () => {
  const r = repartirDelOrgano([adj('Empresa A', false), adj('Empresa B', true), adj('De otro órgano', false, false)]);

  assert.deepEqual(
    r.otro_objeto.map((c) => c.adjudicatario_nombre),
    ['Empresa B'],
  );
  assert.deepEqual(
    r.parecidas.map((c) => c.adjudicatario_nombre),
    ['Empresa A'],
  );
  assert.equal(tituloOtroObjeto(r.otro_objeto.length), 'Otro objeto del mismo órgano (1)');
  assert.match(
    motivoSinEdiciones(CASO_B, { parecidas: [], otro_objeto: r.otro_objeto }),
    /: 1 adjudicación es de otro objeto y va plegada debajo\.$/,
  );
});
