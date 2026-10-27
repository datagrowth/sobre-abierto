// La forma de un PDF para el paquete: páginas y si lleva firma incrustada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { firmaIncrustada, formaDePdf } from '../../src/nucleo/documentos/formaPdf.js';

async function pdf(paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) doc.addPage();
  return doc.save();
}

test('should_count_the_pages_of_an_unsigned_pdf', async () => {
  const r = await formaDePdf(await pdf(3));
  assert.deepEqual(r.data, { paginas: 3, firmado: false });
});

test('should_detect_an_embedded_pades_signature', () => {
  const firmado = Buffer.from(
    '%PDF-1.7\n1 0 obj <</Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 100 200 50] /Contents <00>>> endobj',
  );
  assert.equal(firmaIncrustada(firmado), true);
  assert.equal(firmaIncrustada(Buffer.from('%PDF-1.7\n/ByteRange [0 1 2 3]')), false, 'sin SubFilter de firma');
  assert.equal(firmaIncrustada(Buffer.from('%PDF-1.7\n/SubFilter /adbe.pkcs7.detached')), false, 'sin ByteRange');
  assert.equal(
    firmaIncrustada(Buffer.from('%PDF-1.7\n<</Type /Sig /SubFilter /ETSI.CAdES.detached /ByteRange [0 0 0 0]>>')),
    false,
    'firma reservada y vacía',
  );
  assert.equal(
    firmaIncrustada(Buffer.from('%PDF-1.7\n<</SubFilter /adbe.pkcs7.detached /ByteRange [0 840 17224 1503]>>')),
    true,
    'PKCS#7 de AutoFirma',
  );
});

test('should_fail_on_something_that_is_not_a_pdf', async () => {
  const r = await formaDePdf(Buffer.from('no soy un pdf'));
  assert.equal(r.error?.code, 'invalid_input');
});
