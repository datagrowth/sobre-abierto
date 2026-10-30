// Pliegos que la ficha no puede leer: lo descargado se reconoce por sus primeros bytes (no
// por el nombre ni el Content-Type) y el índice de la Biblioteca dice si se lee. Sin un
// PCAP (o PPT) legible no se pide la ficha: el run acabaría sin resultado.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { conExtension, tipoDeDocumento } from '../../src/dominios/licitaciones/pliegos.js';
import {
  estadoEnIndice,
  listoParaFicha,
  motivoIlegible,
  type Legibilidad,
} from '../../src/dominios/licitaciones/pliegosIndice.js';
import * as indice from '../../src/biblioteca/motor/documentos/almacen.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pliegos-legibles-'));
const idx = indice.abrirIndice(tmp);
after(() => {
  idx.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

test('should_recognise_a_pdf_by_its_header_whatever_its_name', () => {
  assert.equal(tipoDeDocumento(bytes('%PDF-1.7\n...'), 'pliego.docx').data, '.pdf');
});

test('should_reject_an_html_page_served_as_a_pdf', () => {
  const r = tipoDeDocumento(bytes('<!DOCTYPE html><html><body>Sesión caducada</body></html>'), 'PCAP.pdf');
  assert.equal(r.error?.code, 'no_es_documento');
});

test('should_recognise_a_word_document_named_pdf', () => {
  const docx = zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document/>') });
  assert.equal(tipoDeDocumento(docx, 'PCAP.pdf').data, '.docx');
});

test('should_recognise_an_opendocument_by_its_mimetype_entry', () => {
  const odt = zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': strToU8('<office/>'),
  });
  assert.equal(tipoDeDocumento(odt, 'anexo').data, '.odt');
});

test('should_recognise_a_zip_with_other_documents_inside_as_a_zip_to_unpack', () => {
  const zip = zipSync({ 'PCAP.pdf': strToU8('%PDF-1.4'), 'PPT.pdf': strToU8('%PDF-1.4') });
  assert.equal(tipoDeDocumento(zip, 'pliegos.pdf').data, '.zip');
});

test('should_keep_old_office_extensions_and_default_to_doc', () => {
  assert.equal(tipoDeDocumento(OLE, 'presupuesto.xls').data, '.xls');
  assert.equal(tipoDeDocumento(OLE, 'anexo').data, '.doc');
});

test('should_fix_the_extension_to_what_the_file_really_is', () => {
  assert.equal(conExtension('PCAP.pdf', '.docx'), 'PCAP.docx');
  assert.equal(conExtension('Anexo I', '.pdf'), 'Anexo I.pdf');
  assert.equal(conExtension('PPT.pdf', '.pdf'), 'PPT.pdf');
  assert.equal(conExtension('v1.2 informe', '.pdf'), 'v1.2 informe.pdf', 'un punto en el nombre no es una extensión');
});

function indexar(ruta: string, status: indice.EstadoArchivo, error: string | null = null): void {
  const fila = {
    path: ruta,
    kind: 'document' as const,
    title: path.basename(ruta),
    mtime_ms: 1,
    size: 1,
    pages: 3,
    status,
    error,
    source: null,
  };
  indice.reemplazarArchivo(idx, fila, [{ page: 1, text: 'texto' }]);
}

test('should_read_the_state_of_each_document_in_the_library_index', () => {
  indexar('L/PCAP.pdf', 'ok');
  indexar('L/escaneado.pdf', 'scanned');
  indexar('L/roto.pdf', 'error', 'PDF dañado (Invalid PDF structure)');
  assert.equal(estadoEnIndice(idx, 'L/PCAP.pdf').estado_indice, 'ok');
  assert.equal(estadoEnIndice(idx, 'L/PCAP.pdf').paginas, 3);
  assert.match(estadoEnIndice(idx, 'L/escaneado.pdf').error_indice ?? '', /escaneado/);
  assert.equal(estadoEnIndice(idx, 'L/roto.pdf').estado_indice, 'error');
  assert.equal(estadoEnIndice(idx, 'L/nuevo.pdf').estado_indice, 'sin_indexar');
  assert.equal(estadoEnIndice(idx, 'L/oferta.xls').estado_indice, 'formato_no_legible', 'la Biblioteca no lee .xls');
  // Los anexos de la PLACSP llegan en .doc: se indexan (LibreOffice los convierte), así que
  // esperan a su turno y no cuentan como formato no legible.
  assert.equal(estadoEnIndice(idx, 'L/Anexos al PCAP.doc').estado_indice, 'sin_indexar');
  indexar(
    'L/Anexos.doc',
    'error',
    'Documento de Word antiguo (.doc): hace falta LibreOffice en el servidor para leerlo (ver docs/operar/biblioteca.md → Documentos: LibreOffice) o súbelo como .docx/.pdf.',
  );
  assert.match(
    estadoEnIndice(idx, 'L/Anexos.doc').error_indice ?? '',
    /LibreOffice/,
    'sin conversor, el motivo sale en «pliegos ilegibles»',
  );
});

const leg = (clase: string, estado: Legibilidad['estado_indice']): Legibilidad => ({
  ruta: `L/${clase}-${estado}.pdf`,
  clase,
  estado_indice: estado,
  paginas: null,
  error_indice: estado === 'ok' ? null : 'no se lee',
});

test('should_be_ready_for_a_ficha_only_with_a_readable_pcap', () => {
  assert.equal(listoParaFicha([leg('pcap', 'ok'), leg('ppt', 'error')]), 'listo');
  assert.equal(
    listoParaFicha([leg('pcap', 'error'), leg('ppt', 'ok')]),
    'ilegible',
    'sin PCAP legible no hay solvencia ni criterios',
  );
  assert.equal(listoParaFicha([leg('pcap', 'sin_indexar'), leg('ppt', 'ok')]), 'esperar');
  assert.equal(listoParaFicha([leg('ppt', 'ok'), leg('adicional', 'error')]), 'listo', 'sin PCAP basta el PPT');
  assert.equal(listoParaFicha([leg('adicional', 'escaneado')]), 'ilegible');
  assert.equal(listoParaFicha(null), 'listo', 'sin Biblioteca decide Hermes');
});

test('should_explain_which_documents_cannot_be_read', () => {
  assert.match(motivoIlegible([leg('pcap', 'error'), leg('ppt', 'ok')]), /pcap-error\.pdf: no se lee/);
});
