// Reglas de las comprobaciones sobre la memoria: páginas y equipo sin nombres.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reglasDeMemoria, type MemoriaParaReglas } from '../../src/dominios/licitaciones/oferta/reglasMemoria.js';

const memoria = (extra: Partial<MemoriaParaReglas> = {}): MemoriaParaReglas => ({
  version: 5,
  estado: 'ensamblada',
  paginas: 20,
  paginas_estimadas: null,
  limite_paginas: 30,
  anonimato: null,
  ...extra,
});

test('should_block_when_memoria_exceeds_page_limit', () => {
  const filas = reglasDeMemoria(memoria({ paginas: 64, limite_paginas: 30 }), 'máximo 30 páginas');

  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.gravedad, 'impide');
  assert.equal(filas[0]!.clave, 'memoria_paginas');
  assert.equal(filas[0]!.titulo, 'La memoria se pasa de páginas');
  assert.equal(filas[0]!.detalle, 'La v5 ocupa 64 páginas y el pliego limita a 30: recorta 34 antes de presentar.');
  assert.equal(filas[0]!.cita, 'máximo 30 páginas');
});

test('should_not_block_exactly_at_the_limit', () => {
  assert.deepEqual(reglasDeMemoria(memoria({ paginas: 30 })), []);
});

test('should_say_estimated_when_pages_come_from_estimate', () => {
  const [f] = reglasDeMemoria(memoria({ paginas: null, paginas_estimadas: 35 }));

  assert.match(f!.detalle, /ocupa 35 páginas \(estimadas\) y/);
});

test('should_mark_risk_when_pages_are_unknown', () => {
  const [f] = reglasDeMemoria(memoria({ paginas: null, paginas_estimadas: null }));

  assert.equal(f!.gravedad, 'riesgo');
  assert.equal(f!.detalle, 'No se pudo medir la extensión de la v5: compruébala en el Word (límite 30 páginas).');
});

test('should_not_flag_anything_when_there_is_no_limit', () => {
  assert.deepEqual(reglasDeMemoria(memoria({ paginas: null, limite_paginas: null })), []);
});

test('should_block_when_pliego_asks_anonymity_and_memoria_names_team', () => {
  const filas = reglasDeMemoria(memoria({ anonimato: { exige: true, apartados: [2, 4], personas: 3 } }));

  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.clave, 'memoria_nombra_personas');
  assert.equal(filas[0]!.gravedad, 'impide');
  assert.equal(filas[0]!.titulo, 'La memoria nombra al equipo');
  assert.equal(
    filas[0]!.detalle,
    'La v5 nombra a 3 personas del equipo (apartados 2 y 4) y el pliego pide el equipo sin nombres: preséntalas por su rol.',
  );
});

test('should_not_block_when_anonymity_is_asked_and_nobody_is_named', () => {
  assert.deepEqual(reglasDeMemoria(memoria({ anonimato: { exige: true, apartados: [], personas: 0 } })), []);
});

test('should_never_put_person_names_in_the_message', () => {
  const filas = reglasDeMemoria(memoria({ paginas: 40, anonimato: { exige: true, apartados: [1], personas: 2 } }));

  const texto = JSON.stringify(filas);
  assert.doesNotMatch(texto, /Persona|García|Ana/);
  assert.deepEqual(Object.keys(filas[1]!).sort(), ['cita', 'clave', 'detalle', 'gravedad', 'lote', 'titulo']);
});

test('should_suffix_key_with_lote', () => {
  const filas = reglasDeMemoria(
    memoria({ lote: '2', paginas: 64, anonimato: { exige: true, apartados: [1], personas: 1 } }),
  );

  assert.deepEqual(
    filas.map((f) => f.clave),
    ['memoria_paginas-l2', 'memoria_nombra_personas-l2'],
  );
  assert.ok(filas.every((f) => f.lote === '2'));
});

test('should_round_up_pages_to_cut_and_write_estimated_pages_with_comma', () => {
  // Arrange
  const m = memoria({ paginas: null, paginas_estimadas: 31.4 });

  // Act
  const [f] = reglasDeMemoria(m);

  // Assert
  assert.equal(
    f!.detalle,
    'La v5 ocupa 31,4 páginas (estimadas) y el pliego limita a 30: recorta 2 antes de presentar.',
  );
});

test('should_use_singular_when_one_person_is_named_in_one_apartado', () => {
  // Arrange
  const m = memoria({ version: 3, anonimato: { exige: true, apartados: [3], personas: 1 } });

  // Act
  const [f] = reglasDeMemoria(m);

  // Assert
  assert.equal(
    f!.detalle,
    'La v3 nombra a 1 persona del equipo (apartado 3) y el pliego pide el equipo sin nombres: preséntala por su rol.',
  );
});
