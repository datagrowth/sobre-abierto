// Chequeos deterministas del documento ensamblado antes del crítico (numeración
// duplicada, frases repetidas e identificadores de caso repetidos). Guiones sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chequeosDelDocumento, textoDeChequeos } from '../../src/dominios/licitaciones/oferta/chequeosDocumento.js';

const PORTADA =
  '# Memoria técnica\n\n**Expediente:** X-1 · **Órgano:** Ayuntamiento de Ejemplo\n\n## Índice\n\n- 1. Metodología\n- 2. Calidad\n- 3. Equipo\n';
const doc = (...apartados: string[]) =>
  `${PORTADA}\n${apartados.map((t, i) => `## ${i + 1}. Apartado ${i + 1}\n\n${t}\n`).join('\n')}`;

test('should_flag_duplicated_numbering_in_assembled_document', () => {
  const md = doc(
    '### 1.1 1.1 Organización del servicio\n\nTexto.',
    '### 2.1 Calidad\n\nTexto.\n\n### 2.1 Otra calidad\n\nTexto.',
  );
  const cs = chequeosDelDocumento(md).filter((c) => c.tipo === 'numeracion');
  assert.deepEqual(
    cs.map((c) => [c.apartado, c.texto]),
    [
      [1, 'Numeración duplicada en el título «1.1 1.1 Organización del servicio».'],
      [2, 'El número de sección 2.1 sale más de una vez.'],
    ],
  );
});

test('should_flag_case_identifier_repeated_in_more_than_two_apartados', () => {
  const tres = chequeosDelDocumento(
    doc(
      'El CASO-01 entra por registro.',
      'Se revisa el caso-01 con la checklist.',
      'El equipo resuelve CASO-01 en 2 días.',
    ),
  );
  assert.deepEqual(
    tres.filter((c) => c.tipo === 'identificador').map((c) => c.texto),
    ['El identificador «CASO-01» se repite en los apartados 1, 2, 3: el mismo ejemplo en varios apartados.'],
  );
  const dos = chequeosDelDocumento(
    doc('El CASO-01 entra por registro.', 'El CASO-01 recorre las pantallas.', 'Un expediente de contratación menor.'),
  );
  assert.equal(
    dos.filter((c) => c.tipo === 'identificador').length,
    0,
    'en dos apartados (el hilo del mockup) no es defecto',
  );
});

test('should_flag_phrase_repeated_more_than_eight_times', () => {
  const etiqueta = 'el primer perfil técnico de desarrollo e integración revisa la entrega';
  const md = doc(
    Array.from({ length: 5 }, () => `${etiqueta}.`).join(' '),
    Array.from({ length: 5 }, () => `${etiqueta}.`).join(' '),
    'Nada repetido aquí.',
  );
  const cs = chequeosDelDocumento(md).filter((c) => c.tipo === 'repeticion');
  assert.equal(cs.length, 1, 'una frase repetida se avisa una vez');
  assert.match(cs[0]!.texto, /sale 10 veces en el documento \(la primera, en el apartado 1\)/);
});

test('should_report_none_for_clean_document', () => {
  const cs = chequeosDelDocumento(
    doc('### 1.1 Organización\n\nUn texto.', '### 2.1 Calidad\n\nOtro texto.', 'El CASO-02 solo aquí.'),
  );
  assert.deepEqual(cs, []);
  assert.match(textoDeChequeos(cs), /^COMPROBACIONES AUTOMÁTICAS DEL DOCUMENTO .*\n- Ninguna\.$/);
});

test('should_not_flag_a_figure_after_the_section_number_or_a_file_number_as_defects', () => {
  const cs = chequeosDelDocumento(
    doc(
      '### 1.1 24.7 horas de cobertura\n\nEl contrato EXP-2026-0123 lo cubre.',
      '### 2.1 Calidad\n\nSegún el EXP-2026-0123.',
      'El EXP-2026-0123 fija el plazo.',
    ),
  );
  assert.deepEqual(cs, [], 'ni «1.1 24.7 horas» es numeración doble ni el número de expediente es un caso repetido');
  assert.equal(
    chequeosDelDocumento(doc('### 1.1 1.1 Organización\n\nTexto.')).filter((c) => c.tipo === 'numeracion').length,
    1,
    'la doble numeración de verdad sigue',
  );
});
