import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentadasPorLote, sinSugerenciasEnLoPresentado } from './comprobacionesPresentada.js';

const mem = (version, extra = {}) => ({
  id: version,
  version,
  estado: 'ensamblada',
  ensayo: false,
  presentada: false,
  lote: null,
  ...extra,
});
// CASO_E: memoria por lote, vamos a los lotes 2 y 4.
const casoE = (memorias) => ({ memoria_lotes: ['2', '4'], memorias });
const fila = (clave, categoria, lote, extra = {}) => ({
  clave,
  categoria,
  lote,
  gravedad: 'riesgo',
  estado: 'abierto',
  accion: { tipo: 'revisar_memoria' },
  ...extra,
});

test('should_mark_only_the_lot_with_its_submitted_memory', () => {
  const o = casoE([mem(3, { lote: '2', presentada: true }), mem(2, { lote: '4' })]);

  assert.deepEqual(presentadasPorLote(o), [
    { lote: '2', presentada: true },
    { lote: '4', presentada: false },
  ]);
  assert.equal(presentadasPorLote(null), null);
});

test('should_count_a_common_submitted_memory_for_every_lot', () => {
  const o = casoE([mem(5, { presentada: true })]);

  assert.deepEqual(presentadasPorLote(o), [
    { lote: '2', presentada: true },
    { lote: '4', presentada: true },
  ]);
});

test('should_not_suggest_memory_fixes_for_a_submitted_lot_but_keep_the_rest', () => {
  const o = casoE([mem(3, { lote: '2', presentada: true }), mem(2, { lote: '4' })]);
  const filas = [
    fila('coherencia:2', 'coherencia', '2'),
    fila('fugas:4', 'fugas', '4'),
    fila('precio:2', 'precio', '2', { accion: { tipo: 'fijar_precio' } }),
    fila('coherencia:oferta', 'coherencia', null),
  ];

  const r = sinSugerenciasEnLoPresentado(filas, o);

  assert.deepEqual(
    r.map((b) => b.clave),
    ['fugas:4', 'precio:2', 'coherencia:oferta'],
  );
});

test('should_keep_every_row_when_nothing_is_submitted', () => {
  const filas = [fila('coherencia:2', 'coherencia', '2')];

  assert.equal(sinSugerenciasEnLoPresentado(filas, casoE([mem(1, { lote: '2' })])), filas);
  assert.equal(sinSugerenciasEnLoPresentado(filas, null), filas);
});
