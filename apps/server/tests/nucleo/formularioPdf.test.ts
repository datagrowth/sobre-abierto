// Formularios PDF de los modelos: listar los campos con su página, rellenar texto, casilla y
// opciones sin aplanar, negarse con las firmas y los campos de solo lectura, decir pronto que un
// PDF sin campos, con XFA o roto no se puede rellenar y no dejarse tumbar por un árbol de campos
// con nodos repetidos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDict, PDFDocument, PDFName, PDFRef } from 'pdf-lib';
import { pdfConFormulario } from './fixtures/formularioPdf.js';

const { camposDePdf, formularioDePdf, rellenarPdf, textoDeCampos } =
  await import('../../src/nucleo/documentos/formularioPdf.js');

test('should_list_the_fields_of_a_pdf_form', async () => {
  const r = await camposDePdf(await pdfConFormulario({ soloLectura: true }));
  assert.equal(r.error, null);
  const por = new Map(r.data!.map((c) => [c.nombre, c]));
  assert.deepEqual([...por.keys()].sort(), [
    'Acepta_condiciones',
    'Expediente',
    'Firma',
    'Importe',
    'Lote',
    'Lugar',
    'NIF',
    'Tipo_empresa',
  ]);
  assert.deepEqual([por.get('NIF')!.tipo, por.get('NIF')!.pagina, por.get('NIF')!.valor], ['texto', 1, null]);
  assert.deepEqual([por.get('Acepta_condiciones')!.tipo, por.get('Acepta_condiciones')!.valor], ['casilla', false]);
  assert.deepEqual(
    [por.get('Tipo_empresa')!.tipo, por.get('Tipo_empresa')!.opciones],
    ['radio', ['Pyme', 'Gran empresa']],
  );
  assert.deepEqual([por.get('Lote')!.tipo, por.get('Lote')!.opciones], ['desplegable', ['1', '2', '3']]);
  assert.deepEqual([por.get('Lugar')!.pagina, por.get('Firma')!.pagina], [2, 2]);
  assert.deepEqual([por.get('Firma')!.es_firma, por.get('Firma')!.tipo], [true, 'firma']);
  assert.deepEqual(
    [por.get('Expediente')!.solo_lectura, por.get('Expediente')!.valor, por.get('NIF')!.solo_lectura],
    [true, '17-26', false],
  );
});

test('should_fill_text_and_checkbox_fields_and_keep_the_form_editable', async () => {
  const modelo = await pdfConFormulario();
  const r = await rellenarPdf(modelo, [
    { nombre: 'NIF', valor: 'B12345678' },
    { nombre: 'Importe', valor: '1.234,50 €' },
    { nombre: 'Acepta_condiciones', valor: true },
    { nombre: 'Tipo_empresa', valor: 'Pyme' },
    { nombre: 'Lote', valor: '2' },
    { nombre: 'Inexistente', valor: 'x' },
  ]);
  assert.equal(r.error, null);
  assert.deepEqual([r.data!.aplicados, r.data!.no_encontrados], [5, ['Inexistente']]);
  const otra = await camposDePdf(r.data!.pdf);
  const por = new Map(otra.data!.map((c) => [c.nombre, c.valor]));
  assert.deepEqual(
    [
      por.get('NIF'),
      por.get('Importe'),
      por.get('Acepta_condiciones'),
      por.get('Tipo_empresa'),
      por.get('Lote'),
      por.get('Lugar'),
    ],
    ['B12345678', '1.234,50 €', true, 'Pyme', '2', null],
  );
  assert.equal(
    (await PDFDocument.load(r.data!.pdf)).getForm().getFields().length,
    7,
    'sigue siendo un formulario: los campos no se aplanan',
  );
  assert.notDeepEqual(modelo, r.data!.pdf);
});

test('should_refuse_to_fill_signature_fields_and_read_only_fields', async () => {
  const modelo = await pdfConFormulario({ soloLectura: true });
  const firma = await rellenarPdf(modelo, [
    { nombre: 'NIF', valor: 'B12345678' },
    { nombre: 'Firma', valor: 'Paco Ejemplo' },
  ]);
  assert.equal(firma.error?.code, 'invalid_input');
  assert.match(firma.error?.message ?? '', /«Firma» es una firma: la pone una persona con su certificado/);
  assert.match(
    (await rellenarPdf(modelo, [{ nombre: 'Expediente', valor: '99' }])).error?.message ?? '',
    /«Expediente» es de solo lectura/,
  );
});

test('should_reject_values_that_do_not_fit_the_type_of_the_field', async () => {
  const modelo = await pdfConFormulario();
  const msg =
    (
      await rellenarPdf(modelo, [
        { nombre: 'Acepta_condiciones', valor: 'sí' },
        { nombre: 'NIF', valor: true },
        { nombre: 'Lote', valor: '9' },
        { nombre: 'Tipo_empresa', valor: 'Micro' },
      ])
    ).error?.message ?? '';
  assert.match(msg, /«Acepta_condiciones» es una casilla: su valor es verdadero o falso/);
  assert.match(msg, /«NIF» no es una casilla: su valor es un texto/);
  assert.match(msg, /«Lote» no tiene la opción «9»: las opciones son «1», «2», «3»/);
  assert.match(msg, /«Tipo_empresa» no tiene la opción «Micro»/);
  assert.match(
    (await rellenarPdf(modelo, [{ nombre: 'NIF', valor: 'Σ ≥ 5' }])).error?.message ?? '',
    /caracteres que la fuente del formulario no admite/,
  );
});

test('should_return_no_fields_for_a_pdf_without_form_and_an_error_for_a_broken_one', async () => {
  const r = await camposDePdf(await pdfConFormulario({ sinCampos: true }));
  assert.deepEqual([r.error, r.data], [null, []]);
  const roto = await camposDePdf(Buffer.from('esto no es un pdf'));
  assert.equal(roto.error?.code, 'invalid_input');
  assert.match(roto.error?.message ?? '', /^No se puede leer el PDF/);
});

test('should_say_that_an_xfa_form_cannot_be_filled', async () => {
  const doc = await PDFDocument.load(await pdfConFormulario());
  // Sin pasar por getForm(): pdf-lib borra el XFA al crear el formulario.
  doc.catalog.lookup(PDFName.of('AcroForm'), PDFDict).set(PDFName.of('XFA'), doc.context.obj([]));
  const xfa = Buffer.from(await doc.save({ updateFieldAppearances: false }));
  for (const r of [await camposDePdf(xfa), await rellenarPdf(xfa, [{ nombre: 'NIF', valor: 'B12345678' }])]) {
    assert.match(r.error?.message ?? '', /formulario XFA \(dinámico\): no se puede rellenar/);
  }
});

test('should_reject_a_field_tree_with_repeated_nodes_instead_of_hanging', async () => {
  // Cada no terminal lista al siguiente dos veces: pdf-lib lo recorre 2^n veces (n = 23 tarda unos 19 s).
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const ctx = doc.context;
  const hoja = ctx.register(ctx.obj({ FT: 'Tx', T: 'hoja' }));
  let siguiente: PDFRef = hoja;
  for (let i = 0; i < 30; i += 1) siguiente = ctx.register(ctx.obj({ T: `n${i}`, Kids: [siguiente, siguiente] }));
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: [siguiente] }));
  const bytes = Buffer.from(await doc.save({ updateFieldAppearances: false }));
  const antes = Date.now();
  for (const r of [await camposDePdf(bytes), await rellenarPdf(bytes, [{ nombre: 'hoja', valor: 'x' }])]) {
    assert.match(r.error?.message ?? '', /estructura no válida \(campos repetidos\)/);
  }
  assert.ok(Date.now() - antes < 2000, 'se rechaza sin recorrerlo entero');
});

test('should_reject_a_form_with_too_many_field_nodes', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  const ctx = doc.context;
  const campos = Array.from({ length: 5_001 }, (_, i) => ctx.register(ctx.obj({ FT: 'Tx', T: `c${i}` })));
  doc.catalog.set(PDFName.of('AcroForm'), ctx.obj({ Fields: campos }));
  const r = await camposDePdf(Buffer.from(await doc.save({ updateFieldAppearances: false })));
  assert.match(r.error?.message ?? '', /demasiados campos/);
});

test('should_fill_a_field_even_when_an_untouched_read_only_field_has_a_value_the_font_cannot_draw', async () => {
  // «Łódź» no cabe en la fuente del formulario: solo importa si se escribe en ese campo.
  const doc = await PDFDocument.load(await pdfConFormulario());
  const fijo = doc.getForm().createTextField('Organo');
  fijo.addToPage(doc.getPage(1), { x: 200, y: 600, width: 200, height: 20 });
  fijo.setText('Łódź');
  fijo.enableReadOnly();
  const bytes = Buffer.from(await doc.save({ updateFieldAppearances: false }));
  const r = await rellenarPdf(bytes, [{ nombre: 'NIF', valor: 'B12345678' }]);
  assert.equal(r.error, null, r.error?.message);
  const por = new Map((await camposDePdf(r.data!.pdf)).data!.map((c) => [c.nombre, c.valor]));
  assert.deepEqual([por.get('NIF'), por.get('Organo')], ['B12345678', 'Łódź']);
  assert.match(
    (await rellenarPdf(bytes, [{ nombre: 'Lugar', valor: 'Łódź' }])).error?.message ?? '',
    /caracteres que la fuente del formulario no admite/,
    'en un campo que se rellena, sí se dice',
  );
});

test('should_count_the_pages_and_turn_the_filled_values_into_text', async () => {
  const f = await formularioDePdf(await pdfConFormulario());
  assert.equal(f.data!.paginas, 2);
  const r = await rellenarPdf(await pdfConFormulario(), [
    { nombre: 'NIF', valor: 'B12345678' },
    { nombre: 'Acepta_condiciones', valor: true },
    { nombre: 'Lote', valor: '2' },
  ]);
  const texto = textoDeCampos((await camposDePdf(r.data!.pdf)).data!);
  assert.deepEqual(texto.split('\n').sort(), ['Acepta_condiciones: sí', 'Lote: 2', 'NIF: B12345678']);
});
