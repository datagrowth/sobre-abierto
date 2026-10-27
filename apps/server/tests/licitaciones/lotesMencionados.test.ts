// A qué lotes se refiere un criterio o un rol, por su texto o por el anexo donde se marca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lotesDeAutomatico, lotesMencionados } from '../../src/dominios/licitaciones/oferta/lotesMencionados.js';
import type { GuionBaseData } from '../../src/dominios/licitaciones/oferta/guion.js';

const SEIS = ['1', '2', '3', '4', '5', '6'];

test('should_read_single_lots_lists_and_ranges', () => {
  assert.deepEqual(lotesMencionados('Personal de apoyo (lote 1)', SEIS), ['1']);
  assert.deepEqual(lotesMencionados('Tutora de los lotes 2 y 4', SEIS), ['2', '4']);
  assert.deepEqual(lotesMencionados('Lotes 2, 3 y 6', SEIS), ['2', '3', '6']);
  assert.deepEqual(lotesMencionados('Anexo III bis de los lotes 1 a 5', SEIS), ['1', '2', '3', '4', '5']);
  assert.deepEqual(lotesMencionados('LOTE Nº 3', SEIS), ['3']);
  assert.deepEqual(lotesMencionados('ANEXO III BIS LOTE 1: 1.C1; LOTE 2: 2.C1', SEIS), ['1', '2']);
});

test('should_return_nothing_for_unknown_lots_or_without_a_lot_number', () => {
  assert.deepEqual(lotesMencionados('Lote 9', SEIS), []);
  assert.deepEqual(lotesMencionados('Materias objeto del lote', SEIS), []);
  assert.deepEqual(lotesMencionados('Anexo II (lote 1, criterio 2B1)', []), [], 'sin lotes en la licitación');
  assert.deepEqual(lotesMencionados(null, SEIS), []);
});

test('should_take_the_lot_of_an_automatic_criterion_from_its_model_when_the_text_does_not_say_it', () => {
  const doc = (n: string, de: string) => ({
    tipo: 'declaracion' as const,
    nombre: `Anexo ${n}`,
    obligatorio: true,
    produce: 'persona' as const,
    origen: { modelo: `Anexo ${n} (${de})`, documento: 'x.pdf' },
  });
  const g = {
    archivos: [
      {
        nombre: 'Único',
        contenido: 'Todo',
        prohibiciones: [],
        documentos: [doc('II', 'lote 1, criterio 2B1'), doc('III', 'lote 2, criterio 2B2')],
      },
    ],
  } as unknown as GuionBaseData;
  const a = (casilla: string, criterio = 'Criterio') => ({
    criterio,
    puntos: 1,
    como_se_acredita: 'Casilla',
    casilla_en: casilla,
    archivo: 'Único',
    marcas: [],
  });
  assert.deepEqual(lotesDeAutomatico(a('Anexo II, casilla 1'), g, SEIS), ['1']);
  assert.deepEqual(lotesDeAutomatico(a('Anexo III, casilla 1'), g, SEIS), ['2'], 'el Anexo III no es el II');
  assert.deepEqual(
    lotesDeAutomatico(a('Anexo II, casilla 1', 'Soporte del lote 4'), g, SEIS),
    ['4'],
    'lo que dice el criterio manda',
  );
  assert.deepEqual(lotesDeAutomatico(a('Anexo VII, casilla 1'), g, SEIS), []);
});

test('should_not_take_a_quantity_or_a_section_number_after_a_lot_for_another_lot', () => {
  assert.deepEqual(lotesMencionados('Lote 3 - 2 técnicos', SEIS), ['3']);
  assert.deepEqual(lotesMencionados('Lote 1 - 2 meses de soporte', SEIS), ['1'], 'sin rango 1..2');
  assert.deepEqual(lotesMencionados('lote 1, 2.1 Mejora', SEIS), ['1']);
  assert.deepEqual(lotesMencionados('lote 1 y 2.500 horas', SEIS), ['1']);
  assert.deepEqual(lotesMencionados('Lote 1 y 2 años de experiencia', SEIS), ['1']);
  assert.deepEqual(lotesMencionados('Lote 2, 3 h de formación', SEIS), ['2']);
  assert.deepEqual(lotesMencionados('Lote 4 - 2 personas', SEIS), ['4']);
  assert.deepEqual(lotesMencionados('Lote 5 y 3 €', SEIS), ['5']);
  assert.deepEqual(lotesMencionados('Lote 2B1', SEIS), [], 'un código de criterio no es un lote');
});

test('should_take_a_second_number_after_a_dash_or_an_a_only_when_it_is_greater', () => {
  assert.deepEqual(lotesMencionados('Lote 3 - 2', SEIS), ['3']);
  assert.deepEqual(lotesMencionados('Lotes 4 a 2', SEIS), ['4']);
  assert.deepEqual(lotesMencionados('Lotes 1-5', SEIS), ['1', '2', '3', '4', '5']);
  assert.deepEqual(lotesMencionados('Lotes 2 - 4', SEIS), ['2', '3', '4']);
  assert.deepEqual(lotesMencionados('Lotes 1a5', SEIS), [], 'sin espacios solo vale el guion');
});

test('should_understand_roman_numerals_letters_prefixes_and_leading_zeros', () => {
  assert.deepEqual(lotesMencionados('LOTE II y LOTE III', SEIS), ['2', '3']);
  assert.deepEqual(lotesMencionados('Lotes I a III', SEIS), ['1', '2', '3']);
  assert.deepEqual(lotesMencionados('lote número 3', SEIS), ['3']);
  assert.deepEqual(lotesMencionados('lote núm. 3', SEIS), ['3']);
  assert.deepEqual(lotesMencionados('Lote nº 4', SEIS), ['4']);
  assert.deepEqual(lotesMencionados('lote n.º 5', SEIS), ['5']);
  assert.deepEqual(lotesMencionados('lote 01', SEIS), ['1']);
  assert.deepEqual(lotesMencionados('lote 03 y 06', SEIS), ['3', '6']);
  assert.deepEqual(lotesMencionados('lote 2', ['02']), ['02'], 'los existentes se normalizan igual');
  assert.deepEqual(lotesMencionados('lote II', ['II']), ['II']);
});

test('should_read_a_letter_lot_only_when_it_is_one_of_the_existing_lots', () => {
  assert.deepEqual(lotesMencionados('Lote A y lote B', ['A', 'B']), ['A', 'B']);
  assert.deepEqual(lotesMencionados('Lote B', ['A', 'B']), ['B']);
  assert.deepEqual(lotesMencionados('Lote A', SEIS), [], 'no hay lote A');
  assert.deepEqual(lotesMencionados('Lote de formación', ['A', 'D']), [], 'una palabra no es un lote');
});

const LETRAS = ['A', 'B', 'C'];

test('should_not_read_a_preposition_or_a_lowercase_letter_as_a_lot_id', () => {
  assert.deepEqual(lotesMencionados('la adjudicación se hará lote a lote', LETRAS), []);
  assert.deepEqual(lotesMencionados('Se paga por lote a la empresa adjudicataria', LETRAS), []);
  assert.deepEqual(lotesMencionados('lote i', ['1', '10']), []);
  assert.deepEqual(lotesMencionados('lote x', ['1', '10']), []);
  assert.deepEqual(lotesMencionados('Lote A', LETRAS), ['A']);
  assert.deepEqual(lotesMencionados('LOTE III', ['3']), ['3']);
});

test('should_expand_ranges_of_letters_and_roman_numerals', () => {
  assert.deepEqual(lotesMencionados('Lotes A a C', LETRAS), ['A', 'B', 'C']);
  assert.deepEqual(lotesMencionados('Lotes I a III', ['1', '2', '3']), ['1', '2', '3']);
  assert.deepEqual(
    lotesMencionados('Lotes C a A', LETRAS),
    ['C'],
    'un intervalo al revés no es un intervalo: el segundo no es otro lote',
  );
});

test('should_not_read_a_short_quantity_after_a_number_as_another_lot', () => {
  for (const q of [
    'hrs',
    'trabajadores',
    'vehículos',
    'ud',
    'uds',
    'unidades',
    'equipos',
    'licencias',
    'jornadas',
    'sesiones',
    'cursos',
    'plazas',
    'alumnos',
    'usuarios',
  ]) {
    assert.deepEqual(lotesMencionados(`lote 1 y 2 ${q}`, SEIS), ['1'], q);
  }
  assert.deepEqual(lotesMencionados('Lotes 1–3', SEIS), ['1', '2', '3'], 'la raya entre dígitos es un intervalo');
});

test('should_read_the_first_id_after_lote_as_the_lot_even_if_a_quantity_word_follows', () => {
  for (const t of ['LOTE 2 EQUIPOS INFORMÁTICOS', 'Lote 2 Equipos de protección individual'])
    assert.deepEqual(lotesMencionados(t, SEIS), ['2'], t);
  assert.deepEqual(lotesMencionados('Lote 1 Vehículos eléctricos', SEIS), ['1']);
  assert.deepEqual(lotesMencionados('Lote 3 Licencias de software', SEIS), ['3']);
  assert.deepEqual(lotesMencionados('Lote 1 Cursos de formación', SEIS), ['1']);
  assert.deepEqual(lotesMencionados('Lote 4 Jornadas técnicas', SEIS), ['4']);
  assert.deepEqual(lotesMencionados('Lote 1 Sesiones de fisioterapia', SEIS), ['1']);
  assert.deepEqual(lotesMencionados('Lote 3 Trabajadores sociales', SEIS), ['3']);
  assert.deepEqual(lotesMencionados('Lote 3 - 2 técnicos', SEIS), ['3']);
  assert.deepEqual(lotesMencionados('lote 1 y 2.500 horas', SEIS), ['1']);
  assert.deepEqual(lotesMencionados('lote 1 y 2 hrs', SEIS), ['1']);
});

test('should_expand_glued_dash_ranges_of_uppercase_letters_and_romans', () => {
  assert.deepEqual(lotesMencionados('Lotes A-C', LETRAS), ['A', 'B', 'C']);
  assert.deepEqual(lotesMencionados('Lotes I-III', ['1', '2', '3']), ['1', '2', '3']);
});

test('should_not_read_a_letter_glued_to_a_dash_and_lowercase_as_a_lot', () => {
  assert.deepEqual(lotesMencionados('el lote E-learning', ['E', 'F']), []);
});

test('should_not_take_a_lot_named_only_to_compare_or_exclude_with_a_preposition_in_between', () => {
  for (const t of [
    'igual que en el lote 1',
    'Al igual que en el Lote 1',
    'igual que para el lote 1',
    'del mismo modo que en el lote 1',
    'salvo en el lote 1',
    'excepto para el lote 1',
    'sustituye a la persona del lote 1',
    'como en el lote 1',
  ]) {
    assert.deepEqual(lotesMencionados(t, SEIS), [], t);
  }
  assert.deepEqual(lotesMencionados('excepto para los lotes 1 y 2', SEIS), []);
  assert.deepEqual(lotesMencionados('Se presenta como lote 2', SEIS), ['2'], '«como» suelto no es una comparación');
  assert.deepEqual(lotesMencionados('Igual que en el lote 1, en el lote 2 se exige', SEIS), ['2']);
});
