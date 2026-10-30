// La memoria final de Hermes frente a la presentada: cambios por apartado, lo que el código
// etiqueta solo y la lista numerada que recibe Hermes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compararEntero,
  compararParrafos,
  lineasComparacion,
  resumenDe,
  tipoPorCodigo,
  type Comparacion,
} from '../../src/dominios/licitaciones/oferta/comparacionMemoria.js';

const TITULOS = ['Metodología', 'Planificación', 'Equipo'];
const METODO = 'La empresa aplica una metodología ágil con entregas quincenales y revisión con la entidad.';
const PLAZO = 'El entorno estará listo en la semana 2 y la formación empezará en la semana 3.';
const LARGO =
  'La consultora atenderá las consultas del personal en un plazo máximo de 24 horas laborables, con un registro de cada consulta, su respuesta y el tiempo empleado, que se revisará cada mes con la entidad para ajustar el servicio.';

test('should_find_moved_modified_removed_and_added_paragraphs_section_by_section', () => {
  // Arrange
  const antes = new Map([
    [1, [METODO, PLAZO]],
    [2, [LARGO]],
    [3, ['Hermes propone un equipo genérico de tres personas.']],
  ]);
  const despues = new Map([
    [1, [METODO]],
    [2, [PLAZO.replace('semana 2', 'semana 1'), LARGO.slice(0, 120)]],
    [3, ['| Rol | Dedicación |']],
  ]);

  // Act
  const cambios = compararParrafos(antes, despues, TITULOS);

  // Assert
  const ver = cambios.map((c) => [c.n, c.apartado, c.accion, c.tipo]);
  assert.deepEqual(ver, [
    [1, 1, 'quitado', null],
    [2, 2, 'modificado', 'recorte'],
    [3, 2, 'anadido', null],
    [4, 3, 'quitado', null],
    [5, 3, 'anadido', 'estructura'],
  ]);
  assert.equal(cambios[0]!.apartado_titulo, 'Metodología');
});

test('should_mark_a_paragraph_moved_to_another_section_as_structure', () => {
  const cambios = compararParrafos(
    new Map([
      [1, [METODO, PLAZO]],
      [2, []],
    ]),
    new Map([
      [1, [METODO]],
      [2, [PLAZO]],
    ]),
    TITULOS,
  );
  assert.deepEqual(
    cambios.map((c) => [c.accion, c.apartado, c.a_apartado, c.tipo, c.por]),
    [['movido', 1, 2, 'estructura', 'codigo']],
  );
});

test('should_label_by_code_only_what_is_evident', () => {
  assert.equal(
    tipoPorCodigo({ accion: 'modificado', antes: PLAZO, despues: PLAZO.replace('semana 2', 'semana 1') }),
    'correccion_dato',
  );
  assert.equal(
    tipoPorCodigo({ accion: 'modificado', antes: METODO, despues: METODO.replace('ágil', 'ágil,') }),
    'estilo',
  );
  assert.equal(
    tipoPorCodigo({
      accion: 'quitado',
      antes: 'La empresa se compromete a 20 horas de soporte sin coste.',
      despues: null,
    }),
    'compromiso',
  );
  assert.equal(
    tipoPorCodigo({
      accion: 'anadido',
      antes: null,
      despues: 'Se cumplirá la Ordenanza municipal de accesibilidad 4/2024.',
    }),
    null,
    'cumplimiento o especificidad: lo dice Hermes',
  );
});

test('should_pair_whole_text_changes_when_the_presentada_has_no_outline_titles', () => {
  const cambios = compararEntero({
    quitados: [PLAZO, 'Un párrafo de Hermes que no sobrevivió.'],
    anadidos: [PLAZO.replace('semana 3', 'semana 4')],
  });
  assert.deepEqual(
    cambios.map((c) => [c.apartado, c.accion, c.tipo]),
    [
      [null, 'modificado', 'correccion_dato'],
      [null, 'quitado', null],
    ],
  );
  assert.deepEqual(resumenDe(cambios), { total: 2, por_tipo: { correccion_dato: 1, sin_clasificar: 1 } });
});

test('should_list_the_untyped_changes_for_hermes_and_say_which_ones_the_code_saw', () => {
  const cambios = compararParrafos(
    new Map([[1, [METODO, PLAZO]]]),
    new Map([
      [
        1,
        [PLAZO.replace('semana 2', 'semana 1'), 'Se aplicará la norma UNE 66181 de calidad de la formación virtual.'],
      ],
    ]),
    TITULOS,
  );
  const c: Comparacion = {
    id: 1,
    licitacion_id: 'p-1',
    lote: null,
    memoria_hermes_id: 1,
    version_hermes: 3,
    memoria_presentada_id: 2,
    version_presentada: 4,
    por_apartado: true,
    cambios,
    resumen: resumenDe(cambios),
    preguntas: [],
    creada_en: 'x',
    clasificada_en: null,
  };
  const lineas = lineasComparacion(c).join('\n');
  assert.match(lineas, /^CAMBIOS ENTRE TU v3 Y LA PRESENTADA v4 \(3, por apartado/);
  assert.match(lineas, /\(apartado 1 «Metodología», modificado\) \[correccion_dato, lo vio el código\]/);
  assert.match(lineas, /\(apartado 1 «Metodología», anadido\) \+ Se aplicará la norma UNE 66181/);
});
