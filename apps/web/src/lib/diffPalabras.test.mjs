import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clasificarImpacto } from './impactoFormato.js';
import {
  apartadosAfectados,
  avisoAfectados,
  diffPalabras,
  MAX_PALABRAS_DIFF,
  sinCambios,
  textoAfectados,
  TEXTO_DEMASIADO_LARGO,
} from './diffPalabras.js';

const texto = (trozos, tipos) =>
  trozos
    .filter((t) => tipos.includes(t.tipo))
    .map((t) => t.texto)
    .join('');

test('should_mark_only_the_changed_name', () => {
  const antes = 'La docente principal del lote 2 es Persona A, con diez años de experiencia.';
  const despues = 'La docente principal del lote 2 es Persona B, con diez años de experiencia.';

  const { data, error } = diffPalabras(antes, despues);

  assert.equal(error, null);
  assert.deepEqual(
    data.filter((t) => t.tipo !== 'igual'),
    [
      { tipo: 'quita', texto: 'A, ' },
      { tipo: 'pone', texto: 'B, ' },
    ],
  );
  assert.equal(texto(data, ['igual', 'pone']), despues);
  assert.equal(texto(data, ['igual', 'quita']), antes);
});

test('should_return_all_equal_for_identical_texts', () => {
  const t = 'Plan de trabajo.\n\nCalendario por fases y lotes 1 a 5.';

  const { data } = diffPalabras(t, t);

  assert.deepEqual(data, [{ tipo: 'igual', texto: t }]);
  assert.equal(sinCambios(data), true);
});

test('should_handle_empty_before_or_after', () => {
  assert.deepEqual(diffPalabras('', 'Texto nuevo').data, [{ tipo: 'pone', texto: 'Texto nuevo' }]);
  assert.deepEqual(diffPalabras('Texto viejo', '').data, [{ tipo: 'quita', texto: 'Texto viejo' }]);
  assert.deepEqual(diffPalabras(null, undefined).data, []);
});

test('should_refuse_above_the_word_limit_with_a_message', () => {
  const largo = Array.from({ length: MAX_PALABRAS_DIFF + 1 }, (_, i) => `p${i}`).join(' ');

  const r = diffPalabras('corto', largo);

  assert.deepEqual(r, { data: null, error: TEXTO_DEMASIADO_LARGO });
  assert.equal(TEXTO_DEMASIADO_LARGO, 'El apartado es demasiado largo para comparar palabra a palabra: ábrelo entero');
});

test('should_diff_at_the_word_limit_with_a_change_in_the_middle', () => {
  const palabras = Array.from({ length: MAX_PALABRAS_DIFF }, (_, i) => `p${i}`);
  const cambiadas = palabras.map((p, i) => (i === 2000 ? 'otra' : p));

  const { data, error } = diffPalabras(palabras.join(' '), cambiadas.join(' '));

  assert.equal(error, null);
  assert.deepEqual(
    data.filter((t) => t.tipo !== 'igual').map((t) => t.texto),
    ['p2000 ', 'otra '],
  );
});

test('should_drop_the_removed_lot_sentence_and_keep_the_rest', () => {
  const antes = 'Cubrimos los lotes 2 y 6. El lote 6 incluye talleres en La Palma. El resto sigue igual.';
  const despues = 'Cubrimos el lote 2. El resto sigue igual.';

  const { data } = diffPalabras(antes, despues);

  assert.equal(texto(data, ['igual', 'pone']), despues);
  assert.equal(texto(data, ['igual', 'quita']), antes);
  assert.ok(texto(data, ['quita']).includes('La Palma'));
  assert.equal(sinCambios(data), false);
});

const apartado = (n, extra = {}) => ({
  pieza: 'apartado',
  clave: `v3-${n}`,
  nombre: `Apartado ${n} · Equipo`,
  accion: 'rehacer',
  por: ['lotes'],
  coste: { min: 30, runs: 1 },
  pierde: [],
  ...extra,
});

test('should_sum_cost_of_only_the_sections_to_redo_from_the_impact', () => {
  const c = clasificarImpacto({
    afectadas: [
      apartado(2),
      apartado(5),
      { ...apartado(7), accion: 'revisar' },
      { pieza: 'anexo', clave: 'VI', nombre: 'Anexo VI', accion: 'rehacer', coste: { min: 20, runs: 1 } },
    ],
  }).data;

  const a = apartadosAfectados(c);

  assert.equal(a.version, 3);
  assert.deepEqual(
    a.apartados.map((x) => x.n),
    [2, 5],
  );
  assert.equal(textoAfectados(a), '2 apartados · unos 60 min · 2 runs');
});

test('should_return_null_when_no_section_is_redone_and_null_version_when_versions_mix', () => {
  assert.equal(apartadosAfectados(clasificarImpacto({ afectadas: [] }).data), null);
  assert.equal(apartadosAfectados(null), null);

  const mezcla = clasificarImpacto({ afectadas: [apartado(2), { ...apartado(3), clave: 'v4-3' }] }).data;

  assert.equal(apartadosAfectados(mezcla).version, null);
});

test('should_group_the_sections_to_redo_by_memory_version_when_two_lots_are_touched', () => {
  // Arrange: memoria por lote; el cambio toca la v3 (lote 2) y la v5 (lote 4).
  const c = clasificarImpacto({
    afectadas: [apartado(2), { ...apartado(1), clave: 'v5-1' }, { ...apartado(4), clave: 'v5-4' }],
  }).data;

  // Act
  const a = apartadosAfectados(c);

  // Assert
  assert.deepEqual(
    a.versiones.map((v) => [v.version, v.apartados.map((x) => x.n), v.runs]),
    [
      [3, [2], 1],
      [5, [1, 4], 2],
    ],
  );
  assert.equal(a.runs, 3, 'el coste es el de lo que se pide de verdad');
  assert.equal(a.version, null);
});

test('should_say_which_sections_hermes_redoes_in_the_new_version', () => {
  const a = { apartados: [{ n: 2 }], minutos: 30, runs: 1 };

  assert.equal(
    avisoAfectados({ version: 4, apartados: [2] }, a),
    'Hermes rehace el apartado 2 en la v4 sobre el texto que había (1 apartado · unos 30 min · 1 run). Revisa luego el cambio de cada uno.',
  );
  assert.match(avisoAfectados({ version: 4, apartados: [2, 5, 6] }, a), /los apartados 2, 5 y 6 en la v4/);
});

test('should_diff_two_fully_different_texts_at_the_limit', () => {
  const a = Array.from({ length: MAX_PALABRAS_DIFF }, (_, i) => `a${i}`).join(' ');
  const b = Array.from({ length: MAX_PALABRAS_DIFF }, (_, i) => `b${i}`).join(' ');

  const { data } = diffPalabras(a, b);

  assert.deepEqual(
    data.map((t) => t.tipo),
    ['quita', 'pone'],
  );
});
