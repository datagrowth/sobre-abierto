// Modelos en PDF sin campos: texto por página, párrafos rehechos sin unir los elementos de
// lista, huecos literales y un .docx en el que localizarHuecos encuentra los mismos huecos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODELO_ANEXO, pdfDeLineas, pdfEscaneado } from './fixtures/pdfSinCampos.js';

const { docxDeParrafos, paginasDePdf, parrafosDePaginas } = await import('../../src/nucleo/documentos/modeloPdf.js');
const { localizarHuecos } = await import('../../src/nucleo/documentos/rellenar.js');

test('should_return_the_text_of_each_page_separately', async () => {
  const pdf = await pdfDeLineas([['Primera página'], ['Segunda página', 'otra línea']]);

  const r = await paginasDePdf(pdf);

  assert.equal(r.error, null);
  assert.equal(r.data!.length, 2);
  assert.match(r.data![0]!, /Primera página/);
  assert.doesNotMatch(r.data![0]!, /Segunda/);
  assert.match(r.data![1]!, /Segunda página\notra línea/);
});

test('should_join_lines_wrapped_by_width_but_not_list_items', async () => {
  const paginas = (await paginasDePdf(await pdfDeLineas(MODELO_ANEXO))).data!;

  const textos = parrafosDePaginas(paginas).map((p) => p.texto);

  assert.equal(
    textos[1],
    'D./Dña. ................................ con NIF ____________, en nombre y representación de la empresa …………………, con domicilio en la calle ........................',
  );
  assert.deepEqual(textos.slice(2, 9), [
    'DECLARA:',
    'a) que la empresa cumple los requisitos',
    'b) que no está incursa en prohibición',
    '1. Que acepta el pliego',
    '- Que se somete a los juzgados',
    '[ ] Pyme',
    '( ) Gran empresa',
  ]);
});

test('should_keep_dots_underscores_and_checkboxes_as_holes', () => {
  const paginas = [
    'Nombre ......\nde la empresa',
    'NIF ____\nque firma',
    'Lugar …\ny fecha',
    '☐  Acepto   las\ncondiciones ☐\nsi procede',
  ];

  const parrafos = parrafosDePaginas(paginas);

  assert.deepEqual(
    parrafos.map((p) => p.texto),
    [
      'Nombre ......',
      'de la empresa',
      'NIF ____',
      'que firma',
      'Lugar …',
      'y fecha',
      '☐ Acepto las condiciones ☐',
      'si procede',
    ],
  );
  assert.deepEqual(parrafos.map((p) => [p.indice, p.pagina]).slice(0, 3), [
    [1, 1],
    [2, 1],
    [3, 2],
  ]);
});

test('should_produce_a_docx_whose_holes_localizarHuecos_finds', async () => {
  const parrafos = parrafosDePaginas((await paginasDePdf(await pdfDeLineas(MODELO_ANEXO))).data!);

  const docx = await docxDeParrafos(parrafos, 'Anexo II');
  const h = localizarHuecos(docx.data!);

  assert.equal(docx.error, null);
  assert.equal(h.error, null);
  assert.deepEqual(
    h.data!.parrafos.map((p) => [p.indice, p.texto]),
    parrafos.map((p) => [p.indice, p.texto]),
  );
  const declaracion = h.data!.parrafos[1]!.huecos;
  assert.deepEqual(
    declaracion.map((x) => x.etiqueta),
    ['nombre', 'nif', 'representacion', 'domicilio'],
  );
  assert.ok(h.data!.parrafos.some((p) => p.huecos.some((x) => x.tipo === 'casilla')));
  assert.ok(h.data!.parrafos.some((p) => p.huecos.some((x) => x.etiqueta === 'firma')));
});

test('should_fail_with_a_clear_message_when_the_pdf_is_scanned_or_broken', async () => {
  const escaneado = await paginasDePdf(await pdfEscaneado());
  const roto = await paginasDePdf(Buffer.from('%PDF-1.7\nesto no es un pdf'));
  const vacio = await paginasDePdf(new Uint8Array());

  assert.deepEqual(escaneado.error, {
    code: 'invalid_input',
    message: 'El PDF es una imagen escaneada: rellénalo a mano.',
  });
  assert.equal(roto.error?.code, 'invalid_input');
  assert.match(roto.error!.message, /^No se puede leer el texto del PDF: /);
  assert.match(vacio.error!.message, /^No se puede leer el texto del PDF: /);
});

test('should_return_empty_paragraphs_for_an_empty_page_without_failing', async () => {
  const r = await paginasDePdf(await pdfDeLineas([[], ['ANEXO V'], []]));

  const parrafos = parrafosDePaginas(r.data!);

  assert.equal(r.error, null);
  assert.equal(r.data!.length, 3);
  assert.deepEqual(parrafos, [{ indice: 1, pagina: 2, texto: 'ANEXO V' }]);
  assert.deepEqual(parrafosDePaginas([]), []);
  assert.equal((await docxDeParrafos([], 'Vacío')).error, null);
});
