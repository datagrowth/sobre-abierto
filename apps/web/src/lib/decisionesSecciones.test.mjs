import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptarBase, cambioDeImpacto, datosDeSeccion, seccionesSucias } from './decisionesSecciones.js';

// Un formulario de decisiones de CASO_E (lotes 2, 6 y 4), como lo deja camposDeDecisiones.
function formulario(cambios = {}) {
  return {
    lotes: ['2', '6', '4'],
    equipo: [
      { persona_id: 1, rol_en_la_oferta: 'Tutora académica', dedicacion: '', lotes: [] },
      { persona_id: 2, rol_en_la_oferta: 'Docente principal del lote 2', dedicacion: 'Parcial', lotes: ['2'] },
    ],
    automaticos: [
      {
        criterio: 'Formatos de descarga de los registros de actividad',
        lote: null,
        nos_acogemos: true,
        tramo: null,
        evidencia: '',
        nota: '',
      },
    ],
    herramientas: 'Aula Abierta, Teams',
    enfoque: 'Formación práctica',
    ofertas: [
      { lote: '2', pendiente: false, importe: '', unitarios: [{ concepto: 'alumno', precio: '98,50' }] },
      { lote: '6', pendiente: true, importe: '', unitarios: [{ concepto: 'alumno', precio: '' }] },
    ],
    ...cambios,
  };
}

test('should_extract_only_the_price_section_payload', () => {
  // Arrange: el equipo tiene un rol vacío, que impediría guardar todo junto.
  const campos = formulario({ equipo: [{ persona_id: 1, rol_en_la_oferta: '', dedicacion: '', lotes: [] }] });

  // Act
  const r = datosDeSeccion(campos, 'precio');

  // Assert
  assert.equal(r.error, null);
  assert.deepEqual(r.data, [
    { lote: '2', pendiente: false, importe: null, unitarios: [{ concepto: 'alumno', precio: 98.5 }] },
    { lote: '6', pendiente: true, importe: null, unitarios: [] },
  ]);
});

test('should_detect_which_sections_are_dirty', () => {
  // Arrange
  const base = formulario();
  const campos = formulario({ lotes: ['2', '4'], enfoque: 'Formación práctica con casos reales' });

  // Act
  const sucias = seccionesSucias(campos, base);

  // Assert
  assert.deepEqual(sucias, ['lotes', 'enfoque']);
  assert.deepEqual(seccionesSucias(base, formulario()), []);
});

test('should_keep_lot_ids_of_people_when_extracting_the_team_section', () => {
  // Act
  const r = datosDeSeccion(formulario(), 'equipo');

  // Assert
  assert.equal(r.error, null);
  assert.deepEqual(r.data, [
    { persona_id: 1, rol_en_la_oferta: 'Tutora académica' },
    { persona_id: 2, rol_en_la_oferta: 'Docente principal del lote 2', dedicacion: 'Parcial', lotes: ['2'] },
  ]);
});

test('should_return_the_team_error_only_for_the_team_section', () => {
  // Arrange
  const campos = formulario({ equipo: [{ persona_id: 1, rol_en_la_oferta: 'x', dedicacion: '', lotes: [] }] });

  // Act
  const equipo = datosDeSeccion(campos, 'equipo');
  const enfoque = datosDeSeccion(campos, 'enfoque');

  // Assert
  assert.match(equipo.error, /rol en la oferta/);
  assert.deepEqual(enfoque, { data: 'Formación práctica', error: null });
});

test('should_return_an_error_for_an_unknown_section', () => {
  assert.equal(datosDeSeccion(formulario(), 'presupuesto').data, null);
  assert.match(datosDeSeccion(formulario(), 'presupuesto').error, /presupuesto/);
});

test('should_split_tools_and_trim_the_approach', () => {
  assert.deepEqual(datosDeSeccion(formulario({ herramientas: ' Aula Abierta ,, Teams\nZoom ' }), 'herramientas').data, [
    'Aula Abierta',
    'Teams',
    'Zoom',
  ]);
  assert.deepEqual(datosDeSeccion({}, 'lotes'), { data: [], error: null });
});

test('should_describe_who_leaves_and_who_changes_for_the_team_impact', () => {
  // Arrange: sale la persona 2 y la 1 cambia de rol.
  const base = formulario();
  const campos = formulario({
    equipo: [{ persona_id: '1', rol_en_la_oferta: 'Coordinadora', dedicacion: '', lotes: [] }],
  });

  // Act
  const c = cambioDeImpacto('equipo', campos, base);

  // Assert
  assert.deepEqual(c, {
    decisiones: {
      equipo: [
        { persona_id: 2, sale: true },
        { persona_id: 1, sale: false },
      ],
    },
  });
});

test('should_build_the_impact_change_of_each_section_without_amounts', () => {
  const campos = formulario({ lotes: ['2', '4'] });
  assert.deepEqual(cambioDeImpacto('lotes', campos, formulario()), { lotes: ['2', '4'] });
  assert.deepEqual(cambioDeImpacto('precio', campos, formulario(), '2'), { decisiones: { precio: { lote: '2' } } });
  assert.deepEqual(cambioDeImpacto('enfoque', campos, formulario()), { decisiones: { enfoque: true } });
  assert.deepEqual(cambioDeImpacto('automaticos', campos, formulario()), { decisiones: { automaticos: true } });
  assert.equal(cambioDeImpacto('equipo', formulario({ equipo: [] }), formulario({ equipo: [] })), null);
  assert.equal(cambioDeImpacto('otra', campos, formulario()), null);
});

test('should_adopt_new_base_only_in_clean_sections_and_flag_the_others', () => {
  // Arrange: se edita el enfoque; llega del servidor otro enfoque y otras herramientas.
  const base = formulario();
  const form = { campos: formulario({ enfoque: 'Lo mío' }), base };
  const llega = formulario({ enfoque: 'Lo de otra persona', herramientas: 'Aula Abierta' });

  // Act
  const r = adoptarBase(form, llega);

  // Assert
  assert.equal(r.campos.herramientas, 'Aula Abierta');
  assert.equal(r.campos.enfoque, 'Lo mío');
  assert.equal(r.base.enfoque, 'Formación práctica');
  assert.deepEqual(r.ajenas, ['enfoque']);
});

test('should_adopt_the_just_saved_section_and_keep_the_same_objects_when_nothing_arrives', () => {
  // Arrange
  const base = formulario();
  const guardado = formulario({ lotes: ['2', '4'] });
  const form = { campos: guardado, base };

  // Act
  const r = adoptarBase(form, guardado);
  const igual = adoptarBase(form, base);

  // Assert
  assert.deepEqual(r.base.lotes, ['2', '4']);
  assert.deepEqual(r.ajenas, []);
  assert.equal(igual.campos, form.campos);
  assert.equal(igual.base, form.base);
});
