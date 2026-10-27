// CSV para Excel en español: BOM, «;», coma decimal, porcentajes, comillas solo
// donde hacen falta y ningún texto que Excel tome por fórmula.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aCsv, type Columna } from '../../src/nucleo/csv.js';

type Fila = { titulo: string | null; importe: number | null; baja: number | null; seguido: boolean };
const COLUMNAS: Columna<Fila>[] = [
  { titulo: 'Título', valor: (f) => f.titulo },
  { titulo: 'Importe', valor: (f) => f.importe, tipo: 'numero' },
  { titulo: 'Baja', valor: (f) => f.baja, tipo: 'porcentaje' },
  { titulo: 'Seguido', valor: (f) => f.seguido },
];

test('should_write_excel_spanish_csv_with_bom_semicolons_and_decimal_commas', () => {
  // Act
  const csv = aCsv(COLUMNAS, [{ titulo: 'Formación en IA', importe: 48_250.5, baja: 0.085, seguido: true }]);

  // Assert
  assert.ok(csv.startsWith('﻿'), 'BOM para las tildes');
  assert.equal(csv, '﻿Título;Importe;Baja;Seguido\r\nFormación en IA;48250,5;8,5%;Sí\r\n');
});

test('should_quote_only_what_needs_it_and_leave_empty_cells_for_nothing', () => {
  // Act
  const csv = aCsv(COLUMNAS, [
    { titulo: 'Datos; analítica y "BI"\nlínea 2', importe: null, baja: null, seguido: false },
  ]);

  // Assert
  assert.equal(csv.split('\r\n')[1], '"Datos; analítica y ""BI""\nlínea 2";;;No');
});

test('should_not_let_a_text_become_a_formula_in_excel', () => {
  // Arrange
  const peligrosos = ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tTab'];

  // Act
  const filas = aCsv([{ titulo: 'T', valor: (t: string) => t }], peligrosos)
    .split('\r\n')
    .slice(1, -1);

  // Assert
  assert.deepEqual(filas, ['"\'=HYPERLINK(""http://x"")"', "'+1+1", "'-2+3", "'@SUM(A1)", "'\tTab"]);
  assert.equal(
    aCsv([{ titulo: 'N', valor: (n: number) => n, tipo: 'numero' }], [-2.5]).split('\r\n')[1],
    '-2,5',
    'un número negativo sigue siendo número',
  );
});
