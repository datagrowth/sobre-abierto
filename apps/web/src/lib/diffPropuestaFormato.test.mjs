import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esObsoleta,
  etiquetaCampo,
  filasVisibles,
  resumenAplicar,
  textoCabeceraDiff,
  textoObsoleta,
  textoValor,
} from './diffPropuestaFormato.js';

const fila = (campo, extra = {}) => ({
  campo,
  seccion: 'automaticos',
  guardado: null,
  propuesto: null,
  motivo_hermes: null,
  acreditacion: false,
  igual: false,
  ...extra,
});

const CASO_D = [
  fila('lotes', { seccion: 'lotes', igual: true }),
  fila('automatico:plazo de los compromisos|2'),
  fila('automatico:sla 8 h|2'),
  fila('automatico:recursos adicionales|2'),
  fila('automatico:certificado chamilo|2', { acreditacion: true }),
  fila('automatico:iso 9001|', { acreditacion: true }),
  fila('equipo:7', { seccion: 'equipo' }),
  fila('herramientas', { seccion: 'herramientas' }),
  fila('enfoque', { seccion: 'enfoque' }),
];

test('should_exclude_accreditation_rows_from_apply_all', () => {
  const r = resumenAplicar(CASO_D);

  assert.equal(r.claves.length, 6);
  assert.ok(!r.claves.includes('automatico:certificado chamilo|2'));
  assert.ok(!r.claves.includes('automatico:iso 9001|'));
  assert.ok(!r.claves.includes('lotes'), 'una fila igual no se vuelve a aplicar');
});

test('should_say_how_many_accreditation_rows_remain', () => {
  assert.equal(resumenAplicar(CASO_D).texto, 'Aplicar 6 (las 2 de acreditación, una a una)');
  assert.equal(resumenAplicar(CASO_D.slice(0, 5)).texto, 'Aplicar 3 (la de acreditación, una a una)');
  assert.equal(resumenAplicar(CASO_D.slice(0, 4)).texto, 'Aplicar todo y guardar');
  assert.deepEqual(resumenAplicar([]).claves, []);
});

test('should_fold_equal_rows', () => {
  const { cambios, iguales } = filasVisibles(CASO_D);

  assert.deepEqual(
    iguales.map((f) => f.campo),
    ['lotes'],
  );
  assert.equal(cambios.length, 8);
  assert.deepEqual(filasVisibles(null), { cambios: [], iguales: [] });
});

test('should_render_a_team_member_with_role_and_dedication', () => {
  const m = { persona_id: 7, rol_en_la_oferta: 'Docente principal', dedicacion: '40 %' };

  assert.equal(
    textoValor('equipo', m, (id) => (id === 7 ? 'Persona A' : null)),
    'Persona A · Docente principal · 40 %',
  );
  assert.equal(textoValor('equipo', { ...m, dedicacion: null }), 'Persona 7 · Docente principal');
  assert.equal(textoValor('equipo', null), 'Fuera del equipo');
});

test('should_render_the_casoD_term_as_the_proposed_level', () => {
  const guardado = {
    criterio: 'Plazo de los compromisos',
    lote: '2',
    nos_acogemos: true,
    tramo: '6 meses',
    evidencia: null,
    nota: 'desde la puesta en marcha',
  };
  const propuesto = {
    criterio: 'Plazo de los compromisos',
    lote: '2',
    nos_acogemos: true,
    tramo: '6 meses',
    evidencia: null,
    nivel: 'a contar desde el 28 de diciembre de 2027',
  };

  assert.equal(textoValor('automaticos', guardado), 'Nos acogemos: «6 meses» · Nota: desde la puesta en marcha');
  assert.equal(
    textoValor('automaticos', propuesto),
    'Nos acogemos: «6 meses» · a contar desde el 28 de diciembre de 2027',
  );
  assert.equal(textoValor('automaticos', { ...propuesto, nos_acogemos: false }), 'No nos acogemos');
});

test('should_render_lots_tools_and_empty_values', () => {
  assert.equal(textoValor('lotes', ['2', '4']), 'Lotes 2 y 4');
  assert.equal(textoValor('lotes', ['2']), 'Lote 2');
  assert.equal(textoValor('lotes', []), 'Ningún lote');
  assert.equal(textoValor('herramientas', ['Chamilo', 'Teams']), 'Chamilo, Teams');
  assert.equal(textoValor('herramientas', null), '—');
  assert.equal(textoValor('enfoque', '  '), '—');
});

test('should_mark_a_proposal_from_another_outline_as_obsolete', () => {
  const d = { guion_version: 2, guion_vigente: 3, propuesta_creada_en: '2026-10-14T16:50:00.000Z', campos: [] };

  assert.equal(esObsoleta(d), true);
  assert.equal(esObsoleta({ ...d, guion_version: 3 }), false);
  assert.equal(textoObsoleta(d), 'Hecha con el guion v2: Hermes la está rehaciendo');
  assert.match(textoCabeceraDiff({ ...d, guion_version: 3 }), /^Propuesta de Hermes del .+ con el guion v3$/);
  assert.equal(textoObsoleta({ ...d, guion_version: null }), 'Hecha con un guion anterior: Hermes la está rehaciendo');
});

test('should_label_a_criterion_with_its_lot_and_a_person_by_name', () => {
  const a = fila('automatico:plazo|2', { propuesto: { criterio: 'Plazo de los compromisos', lote: '2' } });
  const m = fila('equipo:7', { seccion: 'equipo', guardado: { persona_id: 7 } });

  assert.equal(etiquetaCampo(a), 'Plazo de los compromisos · lote 2');
  assert.equal(
    etiquetaCampo(m, () => 'Persona A'),
    'Equipo · Persona A',
  );
  assert.equal(etiquetaCampo(m), 'Equipo · Persona 7');
  assert.equal(etiquetaCampo(fila('enfoque', { seccion: 'enfoque' })), 'Enfoque');
});
