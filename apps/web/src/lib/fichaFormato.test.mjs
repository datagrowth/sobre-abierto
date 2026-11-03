import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  indicesDeMercado,
  textoUmbral,
  textoUnLicitador,
  preguntaLlegamos,
  preguntaMerece,
  preguntaPodemos,
  repartoCriterios,
  resumenArea,
} from './fichaFormato.js';
import { fijarZonaEmpresa } from './formato.js';

// Los textos de estos tests son los de una empresa en Canarias: con la hora de allí al lado.
fijarZonaEmpresa('Atlantic/Canary');

const AHORA = Date.parse('2026-10-22T08:00:00Z');
// Como llega de GET …/indices.
const INDICES = {
  muestra: { n: 41, cifras_cpv: 4, descripcion: 'CPV 7226… · 5 años · procedimiento abierto' },
  confianza: 'alta',
  competencia: { ofertas: 3, p_un_licitador: 0.25 },
  baja: { esperada: 0.085, rango: { p25: 0.051, p50: 0.08, p75: 0.128 }, umbral_anormal: 0.25 },
  resumen: '3 ofertas esperadas (2-5) · 1 de cada 4 con un solo licitador · n = 41, CPV 4 dígitos, confianza alta',
  licitadores: [{ nif: 'B00765438', nombre: 'Sistemas Ejemplo', evidencia: 'ganó 4 parecidas' }],
  concentracion: null,
  acierto: {
    baja: { texto: 'La baja esperada se desvía de media 5,8 puntos (prueba hacia atrás, 12 meses, n = 120)' },
  },
};

test('should_answer_can_we_from_the_comprobaciones_verdict_or_the_requirements_light', () => {
  assert.deepEqual(
    preguntaPodemos({}, { veredicto: { tipo: 'no_presentable', texto: 'No presentable: falta el ENS' } }),
    {
      valor: 'No presentable: falta el ENS',
      detalle: null,
      tono: 'impide',
      testid: 'veredicto-cabecera',
      estado: 'no_presentable',
    },
  );
  const sinComprobaciones = preguntaPodemos({
    go_no_go: { semaforo: { color: 'ambar', motivo: '2 excluyentes por confirmar' } },
  });
  assert.equal(sinComprobaciones.valor, 'Elegible con dudas');
  assert.equal(sinComprobaciones.detalle, '2 excluyentes por confirmar');
  assert.equal(sinComprobaciones.testid, 'ficha-indicador-requisitos');
  assert.equal(preguntaPodemos({}).valor, 'Sin evaluar');
});

test('should_turn_market_indices_into_header_figures_with_range_sample_and_confidence', () => {
  // Act
  const i = indicesDeMercado(INDICES);

  // Assert
  assert.equal(i.n, 41);
  assert.equal(i.confianza, 'alta');
  assert.equal(i.baja, '8,5 %');
  assert.equal(i.rango, '5,1 %-12,8 %');
  assert.equal(i.ofertas, 3);
  assert.equal(i.umbral, 0.25);
  assert.equal(i.unLicitador, 0.25);
  assert.match(i.acierto.baja, /5,8 puntos/);
  assert.equal(i.acierto.ofertas, null);
  assert.equal(i.licitadores[0].nombre, 'Sistemas Ejemplo');
  assert.equal(indicesDeMercado(null), null);
  assert.equal(
    indicesDeMercado({ ...INDICES, confianza: 'baja' }).confianza,
    'baja',
    'la confianza es la del servidor',
  );
});

test('should_answer_is_it_worth_it_without_figures_when_confidence_is_low', () => {
  // Arrange
  const alta = indicesDeMercado(INDICES);
  const baja = indicesDeMercado({ ...INDICES, muestra: { ...INDICES.muestra, n: 7 }, confianza: 'baja' });

  // Act / Assert
  assert.equal(preguntaMerece(alta).valor, '3 ofertas esperadas · baja 8,5 %');
  assert.equal(
    preguntaMerece(alta, 'Hermes: Encaja').detalle,
    'rango 5,1 %-12,8 % · n = 41 · confianza alta · Hermes: Encaja',
  );
  assert.deepEqual(preguntaMerece(baja), {
    valor: 'Pocos datos de mercado',
    detalle: 'pocos datos (n = 7)',
    tono: 'neutro',
  });
  assert.equal(preguntaMerece(null, 'Ficha: Con dudas').valor, 'Ficha: Con dudas');
});

test('should_answer_will_we_make_it_with_the_canary_hour_and_the_internal_close', () => {
  // Act
  const r = preguntaLlegamos({ fecha_limite: '2026-10-29T14:00:00' }, null, AHORA);

  // Assert
  assert.equal(r.valor, 'en 7 días · jue 29 oct · 14:00');
  assert.equal(r.detalle, '13:00 en Canarias');
  assert.equal(preguntaLlegamos({ fecha_limite: '2026-10-23T14:00:00' }, null, AHORA).tono, 'impide', 'mañana');
  assert.equal(preguntaLlegamos({ retirada: { etiqueta: 'Anulada' } }, null, AHORA).valor, 'Anulada');
  assert.ok(
    preguntaLlegamos(
      { fecha_limite: '2026-10-29T14:00:00' },
      { hora_interna_cierre: '2026-10-29T10:00:00.000Z' },
      AHORA,
    ).detalle.includes('Cierre interno'),
  );
});

test('should_add_the_next_milestone_and_warn_when_it_is_overdue', () => {
  // Arrange
  const hitos = [
    { clave: 'decidir', titulo: 'Decidir si vamos', fecha: '2026-10-19T10:00:00.000Z', estado: 'hecho' },
    { clave: 'decisiones', titulo: 'Decisiones y precio', fecha: '2026-10-22T09:00:00.000Z', estado: 'vencido' },
  ];
  const f = { fecha_limite: '2026-10-29T14:00:00' };

  // Act
  const vencido = preguntaLlegamos(f, { hora_interna_cierre: '2026-10-29T10:00:00.000Z', hitos }, AHORA);
  const proximo = preguntaLlegamos(
    f,
    { hitos: [{ ...hitos[1], estado: 'pendiente', fecha: '2026-10-26T11:00:00.000Z' }] },
    AHORA,
  );

  // Assert
  assert.match(vencido.detalle, /Hito vencido: Decisiones y precio, era el .*22 oct.* 11:00$/);
  assert.equal(vencido.tono, 'riesgo');
  assert.match(proximo.detalle, /Próximo hito: Decisiones y precio, .*26 oct.* 12:00$/);
  assert.equal(proximo.tono, 'neutro');
  assert.equal(
    preguntaLlegamos(f, { hitos: hitos.map((h) => ({ ...h, estado: 'hecho' })) }, AHORA).detalle,
    '13:00 en Canarias',
    'todo hecho, nada que decir',
  );
});

test('should_summarize_each_requirement_area', () => {
  assert.deepEqual(resumenArea([]), { tono: 'neutro', texto: 'No lo pide' });
  assert.deepEqual(resumenArea([{ resultado: 'cumple' }, { resultado: 'no_aplica' }]), { tono: 'ok', texto: 'Cumple' });
  assert.deepEqual(resumenArea([{ resultado: 'cumple' }, { resultado: 'desconocido' }]), {
    tono: 'riesgo',
    texto: '1 sin comprobar',
  });
  assert.deepEqual(resumenArea([{ resultado: 'desconocido' }, { resultado: 'no_cumple' }]), {
    tono: 'impide',
    texto: 'No cumple',
  });
});

test('should_split_points_between_value_judgement_and_formulas', () => {
  assert.deepEqual(
    repartoCriterios([
      { peso: 60, tipo: 'formula' },
      { peso: 25, tipo: 'juicio_valor' },
      { peso: 15, tipo: 'juicio_valor' },
    ]),
    { juicio: 40, formula: 60, total: 100 },
  );
  assert.equal(repartoCriterios([{ descripcion: 'Precio', peso: 60 }]), null, 'los de la PLACSP no traen tipo');
  assert.equal(repartoCriterios(), null);
});

test('should_put_the_encaje_first_in_merece_la_pena', () => {
  const encaje = { valor: 82, elegible: true, etiqueta: null, componentes: [] };
  assert.equal(preguntaMerece(null, null, encaje).valor, 'Encaje 82 · Sin datos de mercado');
  assert.equal(
    preguntaMerece(null, null, { ...encaje, valor: null }).valor,
    'Sin datos de mercado',
    'sin número, nada que poner',
  );
});

test('should_say_how_often_comparables_had_a_single_bidder', () => {
  assert.equal(textoUnLicitador(0.25), '1 de cada 4 comparables tuvo un solo licitador.');
  assert.equal(textoUnLicitador(0.01), 'Casi ningún comparable tuvo un solo licitador.');
  assert.equal(textoUnLicitador(0.6), 'La mitad o más de los comparables tuvo un solo licitador.');
  assert.equal(textoUnLicitador(null), null);
});

test('should_say_where_the_abnormality_threshold_comes_from', () => {
  assert.equal(
    textoUmbral({ umbral_anormal: 0.15, regla_umbral: 'pliego' }),
    'Anormal desde 15,0 % de baja, el umbral que fija el pliego.',
  );
  assert.match(
    textoUmbral({ umbral_anormal: 0.196, regla_umbral: 'art85' }),
    /^Anormal desde 19,6 % de baja según el art. 85/,
  );
  assert.match(
    textoUmbral({ umbral_anormal: 0.2, regla_umbral: 'literal', umbral_literal: 'Más de 10 puntos bajo la media' }),
    /«Más de 10 puntos bajo la media»/,
  );
  assert.equal(textoUmbral({ umbral_anormal: null }), null);
});
