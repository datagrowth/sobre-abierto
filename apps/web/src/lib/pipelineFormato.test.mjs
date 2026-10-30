import { test } from 'node:test';
import assert from 'node:assert/strict';
import { euros, fijarZonaEmpresa } from './formato.js';
import {
  accionAlSoltar,
  cierreDeTarjeta,
  destinosDe,
  detallePorRevisar,
  filasDelPipeline,
  textoPorRevisar,
  textoResultado,
} from './pipelineFormato.js';

// Los textos de estos tests son los de una empresa en Canarias: con la hora de allí al lado.
fijarZonaEmpresa('Atlantic/Canary');

// Jueves 22 de octubre de 2026, 10:00 en la península.
const AHORA = Date.parse('2026-10-22T08:00:00Z');

test('should_show_the_peninsular_closing_with_the_canary_hour_and_flag_three_days_or_less', () => {
  assert.deepEqual(cierreDeTarjeta('2026-10-29T14:00:00', AHORA), {
    fecha: 'jue 29 oct, 14:00',
    canarias: '13:00 en Canarias',
    urgente: false,
  });
  assert.equal(cierreDeTarjeta('2026-10-25T23:59:00', AHORA).urgente, true, 'el domingo, a 3 días');
  assert.equal(cierreDeTarjeta('2026-10-26T10:00:00', AHORA).urgente, false, 'a 4 días');
  assert.equal(cierreDeTarjeta('2026-10-20T14:00:00', AHORA).urgente, false, 'lo pasado no urge');
  assert.equal(cierreDeTarjeta('2026-10-30', AHORA).canarias, null, 'sin hora no hay hora de Canarias');
  assert.equal(cierreDeTarjeta(null, AHORA), null);
});

test('should_say_the_result_instead_of_the_date_when_resolved', () => {
  assert.equal(textoResultado({ resultado: 'ganada' }), 'Ganada');
  assert.equal(textoResultado({ resultado: 'perdida' }), 'Perdida');
  assert.equal(textoResultado({ resultado: null }), 'Adjudicada, sin resultado propio');
});

test('should_count_what_is_pending_review_in_singular_and_plural', () => {
  assert.equal(textoPorRevisar(1), '1 oportunidad puede encajar y está pendiente de revisión');
  assert.equal(textoPorRevisar(4), '4 oportunidades pueden encajar y están pendientes de revisión');
  assert.equal(
    detallePorRevisar({ importe: 95000, veredicto_ia: 'interesa' }),
    `${euros(95000)} · Hermes: Encaja`,
    'con las palabras de la criba en la web',
  );
  assert.equal(detallePorRevisar({ importe: null, veredicto_ia: null }), '—');
});

const PIPELINE = {
  columnas: [
    {
      clave: 'en_preparacion',
      titulo: 'En preparación',
      tarjetas: [
        {
          id: 'p-1',
          expediente: 'E-1',
          titulo: 'Análisis; de "datos"',
          organo: 'Cabildo',
          importe: 1234.5,
          fecha_limite: '2026-10-29T14:00:00',
          columna: 'en_preparacion',
          resultado: null,
        },
      ],
    },
    {
      clave: 'resuelta',
      titulo: 'Resuelta',
      tarjetas: [
        {
          id: 'p-2',
          expediente: 'E-2',
          titulo: 'Formación',
          organo: 'Ayto',
          importe: null,
          fecha_limite: null,
          columna: 'resuelta',
          resultado: 'ganada',
        },
      ],
    },
  ],
};

test('should_flatten_the_board_into_rows_with_their_state', () => {
  assert.deepEqual(
    filasDelPipeline(PIPELINE).map((f) => [f.id, f.estado]),
    [
      ['p-1', 'En preparación'],
      ['p-2', 'Resuelta'],
    ],
  );
  assert.deepEqual(filasDelPipeline(null), []);
});

test('should_turn_a_drop_into_a_real_action_or_explain_why_not', () => {
  assert.deepEqual(accionAlSoltar('en_preparacion', 'presentada'), { tipo: 'registrar' });
  assert.deepEqual(accionAlSoltar('lista_para_firmar', 'presentada'), { tipo: 'registrar' });
  assert.deepEqual(accionAlSoltar('presentada', 'resuelta'), { tipo: 'resultado' });
  assert.deepEqual(accionAlSoltar('en_evaluacion', 'resuelta'), { tipo: 'resultado' });
  assert.deepEqual(accionAlSoltar('presentada', 'en_preparacion'), { tipo: 'deshacer' });
  assert.deepEqual(accionAlSoltar('en_evaluacion', 'en_preparacion'), { tipo: 'deshacer' });
  assert.equal(accionAlSoltar('presentada', 'presentada'), null, 'en su columna no pasa nada');
});

test('should_block_drops_on_automatic_columns_and_from_resolved', () => {
  assert.match(accionAlSoltar('en_preparacion', 'lista_para_firmar').bloqueo, /comprobaciones/);
  assert.match(accionAlSoltar('presentada', 'en_evaluacion').bloqueo, /PLACSP/);
  assert.match(accionAlSoltar('resuelta', 'en_preparacion').bloqueo, /resultado/);
  assert.match(accionAlSoltar('en_preparacion', 'resuelta').bloqueo, /presentada/);
  assert.match(accionAlSoltar('en_evaluacion', 'presentada').bloqueo, /En evaluación/);
  assert.match(accionAlSoltar('lista_para_firmar', 'en_preparacion').bloqueo, /comprobaciones/);
});

test('should_list_only_the_columns_a_card_can_move_to', () => {
  const columnas = ['en_preparacion', 'lista_para_firmar', 'presentada', 'en_evaluacion', 'resuelta'].map((clave) => ({
    clave,
    titulo: clave,
  }));
  assert.deepEqual(
    destinosDe('en_preparacion', columnas).map((c) => [c.clave, c.tipo]),
    [['presentada', 'registrar']],
  );
  assert.deepEqual(
    destinosDe('en_evaluacion', columnas).map((c) => [c.clave, c.tipo]),
    [
      ['en_preparacion', 'deshacer'],
      ['resuelta', 'resultado'],
    ],
  );
  assert.deepEqual(destinosDe('resuelta', columnas), []);
});
