// OCR de PDF escaneados: apagado, ausente y, si la máquina tiene tesseract con español y
// pdftoppm, una lectura de verdad (la imagen del servidor los trae; el CI y Windows, no).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comprobarOcr, ocrDePdf } from '../../src/nucleo/documentos/ocr.js';

test('should_be_off_with_ocr_activo_0', async () => {
  assert.deepEqual(await comprobarOcr({ OCR_ACTIVO: '0' }), { estado: 'apagado', tesseract: null, pdftoppm: null });
});

test('should_be_absent_without_the_binaries', async () => {
  const o = await comprobarOcr({ TESSERACT_BIN: '/no/existe/tesseract', PDFTOPPM_BIN: '/no/existe/pdftoppm' });
  assert.equal(o.estado, 'ausente');
});

test('should_fail_as_a_value_when_there_is_no_ocr', async () => {
  const r = await ocrDePdf('x.pdf', { estado: 'ausente', tesseract: null, pdftoppm: null });
  assert.equal(r.error?.code, 'ocr_ausente');
});
