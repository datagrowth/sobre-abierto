// licitaciones_oportunidades recortada: la pista de cómo seguir solo propone «limite» y
// «pagina» cuando lo recortado son filas; con 0 filas o con un texto recortado, no inventa una
// llamada que zod rechazaría.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seguir-oportunidades-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.NODE_ENV = 'test';

const { seguirOportunidades } = await import('../../src/dominios/licitaciones/tools.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('should_propose_next_page_when_rows_were_cut', () => {
  // Arrange
  const args = { pagina: 1, limite: 10 };
  // Act
  const r = seguirOportunidades(args, { campo: 'items', devueltos: 5, total: 10 });
  // Assert
  assert.deepEqual(r, { limite: 5, pagina: 2 });
});

test('should_not_propose_limite_zero_when_no_row_fits', () => {
  // Act
  const r = seguirOportunidades({ pagina: 2, limite: 10 }, { campo: 'items', devueltos: 0, total: 10 });
  // Assert
  assert.equal(typeof r, 'string');
  assert.match(String(r), /limite=1/);
  assert.doesNotMatch(String(r), /NaN|limite menor \(p\. ej\. 0\)/);
});

test('should_not_use_characters_as_limite_when_a_text_was_cut', () => {
  // Act: recorte de cadenas, «devueltos» son caracteres.
  const r = seguirOportunidades(
    { pagina: 1, limite: 10 },
    { campo: 'items.0.motivo_ia', devueltos: 3000, total: 30_000 },
  );
  // Assert
  assert.equal(typeof r, 'string');
  assert.doesNotMatch(String(r), /3000/);
  assert.match(String(r), /licitaciones_ver/);
});
