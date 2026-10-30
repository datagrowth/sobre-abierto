// La forma del texto normal de un .docx (revisión de la): fuente, tamaño e interlineado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { generarDocx } from '../../src/nucleo/documentos/docx.js';
import { formaDeDocx } from '../../src/nucleo/documentos/formaDocx.js';

const memoria = (formato?: { fuente?: string; tamano?: number; interlineado?: number }) => ({
  portada: {
    titulo: 'Memoria técnica',
    expediente: '1/2026',
    organo: 'Cabildo',
    licitadora: { nombre: 'Empresa', nif: 'B12345678' },
    fecha: '2026-10-26',
  },
  ...(formato ? { formato } : {}),
  apartados: [{ numero: '1', titulo: 'Metodología', bloques: [{ parrafos: ['Texto del apartado.'] }] }],
  pie: { texto: 'Empresa', numeracion: true },
});

test('should_read_the_format_the_platform_writes_in_its_memorias', async () => {
  assert.deepEqual(formaDeDocx(new Uint8Array(await generarDocx(memoria()))), {
    fuente: 'Arial',
    tamano: 11,
    interlineado: 1,
  });
  assert.deepEqual(
    formaDeDocx(new Uint8Array(await generarDocx(memoria({ fuente: 'Calibri', tamano: 12, interlineado: 1.5 })))),
    { fuente: 'Calibri', tamano: 12, interlineado: 1.5 },
  );
});

test('should_prefer_the_normal_style_over_the_document_defaults_as_word_saves_it', () => {
  const estilos = `<w:styles><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:styleId="Normal"><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Verdana"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`;
  const docx = zipSync({ 'word/styles.xml': strToU8(estilos) });
  assert.deepEqual(formaDeDocx(docx), { fuente: 'Verdana', tamano: 10, interlineado: 1.5 });
});

test('should_not_take_an_exact_line_height_as_a_line_spacing', () => {
  const docx = zipSync({
    'word/styles.xml': strToU8(
      '<w:styles><w:docDefaults><w:pPr><w:spacing w:line="280" w:lineRule="exact"/></w:pPr></w:docDefaults></w:styles>',
    ),
  });
  assert.equal(formaDeDocx(docx)?.interlineado, null);
});

test('should_return_null_for_something_that_is_not_a_docx', () => {
  assert.equal(formaDeDocx(strToU8('no soy un docx')), null);
});
