// Documentos en la Biblioteca: extracción de texto (PDF, Word, Excel, PowerPoint),
// índice, búsqueda, lectura por partes, propuestas y la API con token de Hermes.
// Los archivos se generan aquí; el modelo de embeddings no se usa (sin el hilo
// del indexador la búsqueda por significado queda vacía y el resto funciona).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { zipSync, strToU8 } from 'fflate';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-docs-'));
const vault = path.join(tmp, 'conocimiento');
fs.mkdirSync(vault);
process.env.VAULT_PATH = vault;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.BIBLIOTECA_TOKEN = 'token-de-prueba-suficientemente-largo';
// Un agente que no puede leer colaboradores (los CV de Colaboradores/ no son para él).
process.env.AGENTE_TOKEN_CURIOSO = 'curioso-token-suficientemente-largo';
process.env.AGENTE_TOKEN_LICITACIONES = 'licitaciones-token-suficientemente-largo';
fs.mkdirSync(path.join(tmp, 'agentes'));
fs.writeFileSync(path.join(tmp, 'agentes', 'permisos.json'), JSON.stringify({ curioso: { colaboradores: 'ninguno' } }));
process.env.NODE_ENV = 'test';

const { extraerDocumento, codificacionXml, esDocumento, textoIlegible, CONVERTIBLES, TEXTO_ILEGIBLE } =
  await import('../../src/biblioteca/motor/documentos/extraccion.js');
const { disponible } = await import('../../src/nucleo/documentos/libreoffice.js');
const { docxConvertido, limpiarConversiones } = await import('../../src/nucleo/documentos/conversiones.js');
const { trocearTexto } = await import('../../src/biblioteca/motor/documentos/trozos.js');
const { escanearBiblioteca, compararIndice, indexarHallazgos } =
  await import('../../src/biblioteca/motor/documentos/indexador.js');
const store = await import('../../src/biblioteca/motor/documentos/almacen.js');
const { buscarEnBiblioteca, bajoPrefijo, enCarpetas } =
  await import('../../src/biblioteca/motor/documentos/busquedaHibrida.js');
const { leerTexto, leerPaginasDocumento, listarDocumentos, quitarMembretes } =
  await import('../../src/biblioteca/motor/documentos/lector.js');
const { carpetaAprobacion, nombreArchivoPropuesta, crearPropuesta, aprobar, rechazar } =
  await import('../../src/biblioteca/motor/bandeja.js');
const { obtenerContextoPara } = await import('../../src/biblioteca/motor/contexto.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');

after(() => {
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// PDF mínimo: una línea de texto (ASCII) por página.
// letra: tamaño en puntos; con una muy pequeña cabe en una página mucho texto (lo que se sale por abajo no se extrae).
function makePdf(pages: string[], letra = 12): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((text, i) => {
    const stream = text
      ? `BT /F1 ${letra} Tf 72 720 Td ${(letra * 7) / 6} TL ${text
          .split('\n')
          .map((l) => `(${l}) Tj T*`)
          .join(' ')} ET`
      : '';
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

function makeZip(files: Record<string, string>): Buffer {
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
}

const docx = (paras: string[]) =>
  makeZip({
    'word/document.xml': `<w:document><w:body>${paras.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
  });

function write(rel: string, content: string | Buffer): string {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

async function reindex(): Promise<{ removed: string[]; changed: string[] }> {
  const db = store.abrirIndice(process.env.BIBLIOTECA_INDEX_DIR!);
  try {
    const { removed, changed } = compararIndice(await escanearBiblioteca(vault), store.estadosArchivos(db));
    removed.forEach((p) => store.quitarArchivo(db, p));
    for (const f of changed) await indexarHallazgos(db, f);
    return { removed, changed: changed.map((f) => f.rel) };
  } finally {
    db.close();
  }
}

test('should_extract_pdf_text_page_by_page', async () => {
  const abs = write('tmp/dos.pdf', makePdf(['Primera pagina del pliego', 'Solvencia economica y financiera']));
  const { data, error } = await extraerDocumento(abs);
  assert.equal(error, null);
  assert.equal(data?.paged, true);
  assert.deepEqual(
    data?.pages.map((p) => p.trim()),
    ['Primera pagina del pliego', 'Solvencia economica y financiera'],
  );
  assert.equal(data?.scanned, false);
  fs.rmSync(path.dirname(abs), { recursive: true });
});

test('should_flag_a_pdf_without_text_as_scanned', async () => {
  const abs = write('tmp/escaneado.pdf', makePdf(['', '']));
  const { data } = await extraerDocumento(abs);
  assert.equal(data?.scanned, true);
  fs.rmSync(path.dirname(abs), { recursive: true });
});

// Con OCR, el escaneado se lee; sin él, falla o da poco texto, sigue escaneado.
const PAGINA_OCR =
  'El licitador acreditará la solvencia técnica mediante una relación de los principales servicios realizados.';

test('should_read_a_scanned_pdf_with_ocr_when_there_is_one', async () => {
  const abs = write('tmp/escaneado-ocr.pdf', makePdf(['', '']));
  const vistos: string[] = [];
  const { data } = await extraerDocumento(abs, async (ruta) => {
    vistos.push(ruta);
    return { data: [PAGINA_OCR, PAGINA_OCR], error: null };
  });
  assert.deepEqual(vistos, [abs]);
  assert.deepEqual([data?.scanned, data?.ocr, data?.paged, data?.pages.length], [false, true, true, 2]);
  fs.rmSync(path.dirname(abs), { recursive: true });
});

test('should_keep_a_pdf_scanned_when_ocr_fails_or_reads_nothing', async () => {
  const abs = write('tmp/escaneado-sin.pdf', makePdf(['', '']));
  const falla = await extraerDocumento(abs, async () => ({ data: null, error: { code: 'ocr_fallido', message: 'x' } }));
  const vacio = await extraerDocumento(abs, async () => ({ data: ['', ''], error: null }));
  assert.deepEqual([falla.data?.scanned, vacio.data?.scanned], [true, true]);
  fs.rmSync(path.dirname(abs), { recursive: true });
});

test('should_not_call_ocr_for_a_pdf_with_text', async () => {
  const abs = write(
    'tmp/con-texto.pdf',
    makePdf(['Primera pagina del pliego con texto suficiente para no ser un escaneado']),
  );
  let llamado = false;
  await extraerDocumento(abs, async () => {
    llamado = true;
    return { data: [], error: null };
  });
  assert.equal(llamado, false);
  fs.rmSync(path.dirname(abs), { recursive: true });
});

// Texto real del PCAP de a-20430425, indexado como «ok»: fuentes sin tabla de caracteres.
const CODIFICADO =
  '\u0001\u0002\u0003\u0001\u0004\u0001\u0003\u0004\u0003\u0005\u0006\u0007\b \u000e\u0005 \u000f\u0004\u0010\u0006\u0007\b\u0011\u0012\u0002\u0012\u0013 (487*02)48+3.:2+.;4./+.8+,*8.+6.+).0-67847-./+.3+89*0*-3./+<.3+89*0*-.(484.)4.*5()46740*=6>.5467+6*5*+67-.?.3-(-87+./+.26.3*37+54./+.*6@-8540*=6';
const SIMBOLOS =
  '(487*02)48+3.:2+.;4./+.8+,*8.+6.+).0-67847-./+.3+89*0*-3./+<.3+89*0*-.(484.)4.*5()46740*=6>.5467+6*5*+67-.?.3-(-87+./+.26.3*37+54./+.*6@-8540*=6.(484.)-3.)4A-847-8*-3./+.461)*3*3.0)B6*0-3';
const NORMAL =
  'El licitador deberá acreditar un volumen anual de negocios, referido al año de mayor volumen de negocio de los tres últimos concluidos, por importe igual o superior al valor estimado del contrato. ';
const TABLA =
  'Lote 1 800.000,00 € 968.000,00 € Lote 2 600.000,00 € 726.000,00 € Lote 3 3.400.000,00 € 4.114.000,00 € Lote 4 1.000.000,00 € 1.210.000,00 € Lote 5 1.600.000,00 € 1.936.000,00 € Lote 6 160.000,00 € 193.600,00 €';

test('should_tell_encoded_pdf_text_from_normal_text_and_tables', () => {
  assert.equal(textoIlegible([CODIFICADO, CODIFICADO]), true, 'caracteres de control');
  assert.equal(textoIlegible([SIMBOLOS, SIMBOLOS]), true, 'símbolos desplazados sin control');
  assert.equal(textoIlegible([NORMAL, NORMAL]), false);
  assert.equal(textoIlegible([TABLA, TABLA]), false, 'una tabla de importes se lee');
  assert.equal(textoIlegible(['(4*)']), false, 'con tan poco no se juzga');
});

test('should_mark_already_indexed_encoded_pdfs_as_unreadable_without_rereading_them', () => {
  const db = store.abrirIndice(fs.mkdtempSync(path.join(tmp, 'indice-')));
  try {
    const fila = (ruta: string) => ({
      path: ruta,
      kind: 'document' as const,
      title: ruta,
      mtime_ms: 1,
      size: 1,
      pages: 2,
      status: 'ok' as const,
      error: null,
      source: null,
    });
    store.reemplazarArchivo(db, fila('Radar/pcap.pdf'), [
      { page: 1, text: CODIFICADO },
      { page: 2, text: SIMBOLOS },
    ]);
    store.reemplazarArchivo(db, fila('Radar/ppt.pdf'), [
      { page: 1, text: NORMAL },
      { page: 2, text: NORMAL },
    ]);
    assert.equal(store.marcarIlegibles(db, textoIlegible, TEXTO_ILEGIBLE), 1);
    assert.deepEqual(
      [store.obtenerArchivo(db, 'Radar/pcap.pdf')?.status, store.obtenerArchivo(db, 'Radar/pcap.pdf')?.chunks],
      ['error', 0],
    );
    assert.equal(store.obtenerArchivo(db, 'Radar/pcap.pdf')?.error, TEXTO_ILEGIBLE);
    assert.equal(store.obtenerArchivo(db, 'Radar/ppt.pdf')?.status, 'ok');
    assert.equal(store.estadosArchivos(db).get('Radar/pcap.pdf')?.mtime_ms, 1, 'no se relee hasta que cambie');
  } finally {
    db.close();
  }
});

test('should_extract_word_excel_and_powerpoint_text', async () => {
  const w = await extraerDocumento(write('tmp/a.docx', docx(['Memoria tecnica', 'Plazo &amp; garantia'])));
  assert.equal(w.data?.pages[0], 'Memoria tecnica\nPlazo & garantia');
  const x = await extraerDocumento(
    write(
      'tmp/b.xlsx',
      makeZip({
        'xl/sharedStrings.xml': '<sst><si><t>Lote</t></si><si><t>Importe</t></si></sst>',
        'xl/worksheets/sheet1.xml':
          '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>125000</v></c></row></sheetData></worksheet>',
      }),
    ),
  );
  assert.equal(x.data?.pages[0], 'Lote\tImporte\n1\t125000');
  const slide = (t: string) => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`;
  const p = await extraerDocumento(
    write('tmp/c.pptx', makeZip({ 'ppt/slides/slide10.xml': slide('diez'), 'ppt/slides/slide2.xml': slide('dos') })),
  );
  assert.deepEqual(p.data?.pages, ['dos', 'diez']);
  fs.rmSync(path.join(vault, 'tmp'), { recursive: true });
});

// El DEUC de la PLACSP llega como ESPDRequest .xml (Villaejemplo, CASO_B): sin leerlo, la
// solvencia que pide el órgano no está en la Biblioteca.
const ESPD_V2 = `<?xml version="1.0" encoding="UTF-8"?>
<espd-req:QualificationApplicationRequest xmlns:cac="urn:cac" xmlns:cbc="urn:cbc"><espd:ESPDRequest>
<cbc:ContractFolderID>2026/0042</cbc:ContractFolderID>
<cac:ContractingParty><cac:Party><cac:PartyName><cbc:Name>Diputación de Villaejemplo</cbc:Name></cac:PartyName></cac:Party></cac:ContractingParty>
<cac:ProcurementProject><cbc:Name>Formación en análisis de datos</cbc:Name><cbc:Description>Cursos para mujeres desempleadas</cbc:Description></cac:ProcurementProject>
<cac:ProcurementProjectLot><cbc:ID>1</cbc:ID></cac:ProcurementProjectLot><cac:ProcurementProjectLot><cbc:ID>2</cbc:ID></cac:ProcurementProjectLot>
<cac:TenderingCriterion><cbc:CriterionTypeCode>CRITERION.EXCLUSION.CONVICTIONS.CORRUPTION</cbc:CriterionTypeCode><cbc:Name>Corrupción</cbc:Name><cbc:Description>¿Ha sido condenado por corrupción?</cbc:Description>
<cac:TenderingCriterionPropertyGroup><cac:TenderingCriterionProperty><cbc:Description>¿Su respuesta?</cbc:Description></cac:TenderingCriterionProperty></cac:TenderingCriterionPropertyGroup></cac:TenderingCriterion>
<cac:TenderingCriterion><cbc:CriterionTypeCode>CRITERION.SELECTION.ECONOMIC_FINANCIAL_STANDING.TURNOVER.GENERAL_YEARLY</cbc:CriterionTypeCode><cbc:Name>Volumen de negocios anual general</cbc:Name><cbc:Description>Volumen anual en los tres últimos ejercicios</cbc:Description>
<cac:Legislation><cbc:Description>Art. 87 LCSP</cbc:Description></cac:Legislation>
<cac:TenderingCriterionPropertyGroup><cac:TenderingCriterionProperty><cbc:Description>Importe mínimo exigido</cbc:Description><cbc:TypeCode>REQUIREMENT</cbc:TypeCode><cbc:ExpectedAmount currencyID="EUR">60000</cbc:ExpectedAmount></cac:TenderingCriterionProperty>
<cac:TenderingCriterionProperty><cbc:Description>Ejercicio</cbc:Description><cbc:TypeCode>QUESTION</cbc:TypeCode></cac:TenderingCriterionProperty></cac:TenderingCriterionPropertyGroup></cac:TenderingCriterion>
</espd:ESPDRequest></espd-req:QualificationApplicationRequest>`;

test('should_read_the_criteria_a_deuc_xml_asks_for', async () => {
  const r = await extraerDocumento(write('tmp/Deuc.xml', ESPD_V2));
  assert.equal(r.error, null);
  const texto = r.data?.pages[0] ?? '';
  assert.match(texto, /^DEUC/);
  assert.match(texto, /Expediente: 2026\/0042/);
  assert.match(texto, /Órgano de contratación: Diputación de Villaejemplo/);
  assert.match(texto, /Contrato: Formación en análisis de datos/);
  assert.match(texto, /Lotes: 1, 2/);
  assert.match(
    texto,
    /Criterios de selección pedidos \(solvencia\) \(1\):\n- Volumen de negocios anual general: Volumen anual en los tres últimos ejercicios\n {2}· Importe mínimo exigido: 60000\n {2}· Ejercicio/,
  );
  assert.match(texto, /Criterios de exclusión \(1\):\n- Corrupción: ¿Ha sido condenado por corrupción\?/);
  assert.doesNotMatch(texto, /Su respuesta|Art\. 87/);
  assert.ok(esDocumento('pliegos/DEUC.XML'));
  fs.rmSync(path.join(vault, 'tmp'), { recursive: true });
});

test('should_read_the_older_espd_criteria_and_any_other_xml_as_lines_of_text', async () => {
  const v1 =
    '<espd:ESPDRequest><ccv:Criterion><cbc:TypeCode>CRITERION.SELECTION.TECHNICAL_PROFESSIONAL_ABILITY.REFERENCES.SERVICES_CONTRACTS</cbc:TypeCode><cbc:Name>Servicios similares</cbc:Name><ccv:RequirementGroup><ccv:Requirement><cbc:Description>Tres servicios de formación en los últimos tres años</cbc:Description></ccv:Requirement></ccv:RequirementGroup></ccv:Criterion></espd:ESPDRequest>';
  const a = await extraerDocumento(write('tmp/v1.xml', v1));
  assert.match(
    a.data?.pages[0] ?? '',
    /- Servicios similares\n {2}· Tres servicios de formación en los últimos tres años/,
  );
  const b = await extraerDocumento(
    write('tmp/otro.xml', '<?xml version="1.0"?><raiz><a> Uno &amp; dos </a><b><c>Tres</c></b></raiz>'),
  );
  assert.deepEqual(b.data?.pages, ['Uno & dos\nTres']);
  fs.rmSync(path.join(vault, 'tmp'), { recursive: true });
});

// Los anexos de la PLACSP llegan en .doc: la Biblioteca los lista y, si no puede
// convertirlos, el error dice qué hace falta (sale en «pliegos ilegibles»).
test('should_list_old_word_documents_and_explain_what_is_needed_to_read_them', async () => {
  assert.equal(esDocumento('Anexos al PCAP.doc'), true);
  assert.equal(esDocumento('modelo.RTF'), true);
  const abs = write('tmp/anexos.doc', 'no es un documento de Word de verdad');
  assert.ok(
    [...(await escanearBiblioteca(vault)).values()].some((f) => f.rel === 'tmp/anexos.doc' && f.kind === 'document'),
  );
  const { data, error } = await extraerDocumento(abs);
  assert.equal(data, null);
  assert.match(error ?? '', /LibreOffice/);
  if ((await disponible()).estado !== 'ok')
    assert.match(error ?? '', /^Documento de Word antiguo \(\.doc\): hace falta LibreOffice .*docs\/operacion\.md/);
  fs.rmSync(path.join(vault, 'tmp'), { recursive: true });
});

test('should_forget_only_unreadable_convertible_files_so_they_are_reread', () => {
  const db = store.abrirIndice(fs.mkdtempSync(path.join(tmp, 'indice-')));
  try {
    const fila = (ruta: string, status: 'ok' | 'error') => ({
      path: ruta,
      kind: 'document' as const,
      title: ruta,
      mtime_ms: 1,
      size: 1,
      pages: null,
      status,
      error: status === 'error' ? 'no se lee' : null,
      source: null,
    });
    store.reemplazarArchivo(db, fila('Radar/Anexos.doc', 'error'), []);
    store.reemplazarArchivo(db, fila('Radar/modelo.RTF', 'error'), []);
    store.reemplazarArchivo(db, fila('Radar/roto.pdf', 'error'), []);
    store.reemplazarArchivo(db, fila('Radar/leido.doc', 'ok'), [{ page: null, text: 'texto' }]);
    assert.equal(store.olvidarArchivos(db, CONVERTIBLES), 2);
    assert.equal(store.obtenerArchivo(db, 'Radar/Anexos.doc'), null, 'en el siguiente recorrido cuenta como nuevo');
    assert.equal(store.obtenerArchivo(db, 'Radar/roto.pdf')?.status, 'error', 'un PDF roto no mejora con LibreOffice');
    assert.equal(store.obtenerArchivo(db, 'Radar/leido.doc')?.status, 'ok');
  } finally {
    db.close();
  }
});

test('should_forget_scanned_and_encoded_pdfs_when_ocr_appears', () => {
  const db = store.abrirIndice(fs.mkdtempSync(path.join(tmp, 'indice-')));
  try {
    const fila = (ruta: string, status: 'ok' | 'error' | 'scanned', error: string | null = null) => ({
      path: ruta,
      kind: 'document' as const,
      title: ruta,
      mtime_ms: 1,
      size: 1,
      pages: 2,
      status,
      error,
      source: null,
    });
    store.reemplazarArchivo(db, fila('Radar/escaneado.pdf', 'scanned'), []);
    store.reemplazarArchivo(db, fila('Radar/codificado.pdf', 'error', TEXTO_ILEGIBLE), []);
    store.reemplazarArchivo(db, fila('Radar/roto.pdf', 'error', 'PDF dañado'), []);
    store.reemplazarArchivo(db, fila('Radar/leido.pdf', 'ok'), [{ page: 1, text: 'texto' }]);
    assert.equal(store.olvidarParaOcr(db, TEXTO_ILEGIBLE), 2);
    assert.equal(store.obtenerArchivo(db, 'Radar/escaneado.pdf'), null);
    assert.equal(store.obtenerArchivo(db, 'Radar/codificado.pdf'), null);
    assert.equal(store.obtenerArchivo(db, 'Radar/roto.pdf')?.status, 'error', 'un PDF roto no mejora con OCR');
    assert.equal(store.obtenerArchivo(db, 'Radar/leido.pdf')?.status, 'ok');
  } finally {
    db.close();
  }
});

test('should_cache_the_conversion_by_path_date_and_size', async (t) => {
  if ((await disponible()).estado !== 'ok') return t.skip('sin LibreOffice (soffice) en esta máquina');
  const cache = path.join(tmp, 'conversiones');
  const abs = write(
    'tmp/modelo.rtf',
    '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\\f0 Anexo VII: modelo de oferta economica.\\par}',
  );
  const primera = await docxConvertido(abs, cache);
  assert.equal(primera.error, null);
  assert.equal((await docxConvertido(abs, cache)).data, primera.data, 'misma ruta, fecha y tamaño: misma conversión');
  assert.equal(fs.readdirSync(cache).length, 1);
  const despues = new Date(Date.now() + 5_000);
  fs.utimesSync(abs, despues, despues);
  assert.notEqual((await docxConvertido(abs, cache)).data, primera.data, 'cambia la fecha: se convierte otra vez');
  assert.equal(fs.readdirSync(cache).length, 2);
  const { data } = await extraerDocumento(abs);
  assert.match(data?.pages[0] ?? '', /Anexo VII: modelo de oferta economica/);
  fs.rmSync(path.join(vault, 'tmp'), { recursive: true });
});

test('should_prune_old_conversions_and_keep_the_cache_under_the_size_cap', async () => {
  const cache = fs.mkdtempSync(path.join(tmp, 'poda-'));
  const dia = 86_400_000;
  const ahora = Date.now();
  for (const [nombre, edadDias] of [
    ['vieja.docx', 100],
    ['media.docx', 10],
    ['reciente.docx', 1],
  ] as const) {
    const abs = path.join(cache, nombre);
    fs.writeFileSync(abs, 'x'.repeat(10));
    fs.utimesSync(abs, new Date(ahora - edadDias * dia), new Date(ahora - edadDias * dia));
  }
  assert.deepEqual(await limpiarConversiones(cache, { dias: 60, maxBytes: 15, ahoraMs: ahora }), { borrados: 2 });
  assert.deepEqual(
    fs.readdirSync(cache),
    ['reciente.docx'],
    'caduca la de 100 días y, por tamaño, la siguiente más vieja',
  );
  assert.deepEqual(await limpiarConversiones(path.join(tmp, 'no-existe'), { dias: 60 }), { borrados: 0 });
});

test('should_return_an_error_instead_of_throwing_on_a_broken_file', async () => {
  const { data, error } = await extraerDocumento(write('tmp/roto.docx', 'no es un zip'));
  assert.equal(data, null);
  assert.ok(error);
  fs.rmSync(path.join(vault, 'tmp'), { recursive: true });
});

test('should_explain_in_words_a_pdf_that_is_not_really_a_pdf', async () => {
  const { data, error } = await extraerDocumento(
    write('tmp/falso.pdf', '<!DOCTYPE html><html><body>Error 500</body></html>'),
  );
  assert.equal(data, null);
  assert.match(error ?? '', /^PDF dañado o que no es un PDF/);
  fs.rmSync(path.join(vault, 'tmp'), { recursive: true });
});

test('should_explain_zip_saved_as_pdf', async () => {
  // Arrange: un ZIP que guarda sin comprimir un PDF (caso Vall d'Hebron), con nombre «.pdf».
  const zip = Buffer.from(zipSync({ 'pliego.pdf': [new Uint8Array(makePdf(['Pliego'])), { level: 0 }] }));
  // Act
  const { data, error } = await extraerDocumento(write('tmp/pliego.pdf', zip));
  // Assert
  assert.equal(data, null);
  assert.equal(error, 'Es un ZIP guardado con extensión .pdf: no se puede leer como PDF.');
  fs.rmSync(path.join(vault, 'tmp'), { recursive: true });
});

test('should_chunk_long_text_without_exceeding_the_size', () => {
  const long = Array.from({ length: 50 }, (_, i) => `Frase número ${i} con algo de contenido para llenar.`).join(' ');
  const chunks = trocearTexto(`Intro corta pero suficiente para contar.\n\n${long}`, 300);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every((c) => c.length <= 300));
  assert.deepEqual(trocearTexto(''), []);
});

test('should_index_notes_and_documents_and_find_them', async () => {
  write(
    'Licitaciones/2026/Pliego limpieza.pdf',
    makePdf(['Ayuntamiento de Getafe', 'Criterios de adjudicacion: oferta economica 60 puntos']),
  );
  write('.gdocs/Licitaciones/Resumen.docx', docx(['Resumen de licitaciones abiertas']));
  write(
    'Clientes/Getafe.md',
    '---\ntitle: Getafe\nfuente: Licitaciones/2026/Pliego limpieza.pdf\n---\nCliente del sector público.\n',
  );
  write('_Propuestas/sin aprobar.md', '---\nestado: pendiente\n---\nadjudicacion secreta\n');
  write('graphify-out/basura.md', 'adjudicacion');
  const first = await reindex();
  assert.deepEqual(first.changed.sort(), [
    '.gdocs/Licitaciones/Resumen.docx',
    'Clientes/Getafe.md',
    'Licitaciones/2026/Pliego limpieza.pdf',
  ]);

  const hits = await buscarEnBiblioteca('criterios de adjudicación');
  assert.equal(hits[0]?.path, 'Licitaciones/2026/Pliego limpieza.pdf');
  assert.equal(hits[0]?.kind, 'document');
  assert.equal(hits[0]?.passages[0]?.page, 2);
  assert.ok(!hits.some((h) => h.path.startsWith('_Propuestas') || h.path.startsWith('graphify-out')));
  assert.equal(
    (await buscarEnBiblioteca('getafe')).some((h) => h.path === 'Clientes/Getafe.md'),
    true,
  );
  assert.equal((await reindex()).changed.length, 0);
});

test('should_include_the_google_docs_copy_of_a_folder_when_searching_inside_it', async () => {
  const hits = await buscarEnBiblioteca('licitaciones abiertas', 20, 'Licitaciones');
  assert.ok(
    hits.some((h) => h.path === '.gdocs/Licitaciones/Resumen.docx'),
    'un Google Doc de la carpeta está en ella',
  );
  assert.ok(
    !(await buscarEnBiblioteca('licitaciones abiertas', 20, 'Clientes')).some((h) => h.path.startsWith('.gdocs/')),
  );
  assert.equal(bajoPrefijo('.gdocs/Licitaciones/Presentadas/x.docx', 'Licitaciones/Presentadas/'), true);
  assert.equal(bajoPrefijo('.gdocs/Otras/Licitaciones/Presentadas/x.docx', 'Licitaciones/Presentadas/'), false);
  assert.equal(
    enCarpetas('.gdocs/Colaboradores/CV.docx', ['Colaboradores']),
    true,
    'la exclusión también cubre los Google Docs',
  );
});

test('should_give_hermes_the_matching_pages_of_a_document_as_context', async () => {
  const ctx = await obtenerContextoPara('oferta economica', { limit: 3 });
  const doc = ctx.items.find((i) => i.kind === 'document');
  assert.ok(doc?.body?.includes('[pág. 2]'));
  assert.match(ctx.context_md, /documento/);
});

test('should_read_a_document_in_parts_with_page_marks', async () => {
  const all = await leerTexto('Licitaciones/2026/Pliego limpieza.pdf');
  assert.equal(all.paginas, 2);
  assert.match(all.texto, /^\[pág\. 1\]\nAyuntamiento de Getafe/);
  const part = await leerTexto(path.join(vault, 'Licitaciones/2026/Pliego limpieza.pdf'), 5, 10);
  assert.equal(part.texto, all.texto.slice(5, 15));
  await assert.rejects(leerTexto('../fuera.pdf'));
});

test('should_read_only_the_requested_pages_of_a_document', async () => {
  const p2 = leerPaginasDocumento('Licitaciones/2026/Pliego limpieza.pdf', { desde: 2, hasta: 2 });
  assert.equal(p2.pagina_desde, 2);
  assert.match(p2.texto, /^\[pág\. 2\]\nCriterios de adjudicacion/);
  assert.doesNotMatch(p2.texto, /Getafe/);
  assert.equal(
    leerPaginasDocumento('Licitaciones/2026/Pliego limpieza.pdf', { desde: 1, hasta: 9 }).pagina_hasta,
    2,
    'no pasa de la última página',
  );
  assert.throws(
    () => leerPaginasDocumento('Licitaciones/2026/Pliego limpieza.pdf', { desde: 3, hasta: 4 }),
    /tiene 2 páginas/,
  );
  assert.throws(
    () => leerPaginasDocumento('.gdocs/Licitaciones/Resumen.docx', { desde: 1, hasta: 1 }),
    /no tiene páginas/,
  );
});

test('should_return_first_15_pages_and_next_range_when_range_exceeds_limit', async () => {
  const rel = 'tmp-largo/veinte.pdf';
  write(rel, makePdf(Array.from({ length: 20 }, (_, i) => `Contenido de la pagina ${i + 1}`)));
  await reindex();
  try {
    const r = leerPaginasDocumento(rel, { desde: 1, hasta: 27 });
    assert.equal(r.pagina_hasta, 15);
    assert.deepEqual(r.siguiente, { pagina_desde: 16, pagina_hasta: 20 });
    assert.match(r.nota ?? '', /pagina_desde=16, pagina_hasta=20/);
    assert.match(r.texto, /\[pág\. 15\]/);
    assert.doesNotMatch(r.texto, /\[pág\. 16\]/);
    assert.equal(
      leerPaginasDocumento(rel, { desde: 1, hasta: 15 }).siguiente,
      undefined,
      'un rango de 15 no lleva siguiente',
    );
    assert.equal(
      leerPaginasDocumento(rel, { desde: 6, hasta: 27 }).siguiente,
      undefined,
      'hasta la última página no lleva siguiente',
    );
  } finally {
    fs.rmSync(path.join(vault, 'tmp-largo'), { recursive: true });
    await reindex();
  }
});

test('should_read_every_page_without_gaps_when_chaining_next_over_a_dense_pdf', async () => {
  const rel = 'tmp-denso/veintisiete.pdf';
  const densa = (n: number) =>
    Array.from({ length: 100 }, (_, k) => `P${n} linea ${k} ${'palabra'.repeat(8)}`).join('\n');
  write(rel, makePdf(Array.from({ length: 27 }, (_, i) => densa(i + 1))));
  await reindex();
  try {
    const leidas: number[] = [];
    let rango: { pagina_desde: number; pagina_hasta: number } | undefined = { pagina_desde: 1, pagina_hasta: 27 };
    for (let vueltas = 0; rango && vueltas < 40; vueltas++) {
      const r = leerPaginasDocumento(rel, { desde: rango.pagina_desde, hasta: rango.pagina_hasta });
      leidas.push(...[...r.texto.matchAll(/\[pág\. (\d+)\]/g)].map((m) => Number(m[1])));
      rango = r.siguiente;
    }
    assert.equal(rango, undefined, 'la cadena termina');
    // Solo se repite la página que quedó a medias en el corte; nunca se salta ninguna.
    assert.deepEqual(
      [...new Set(leidas)],
      Array.from({ length: 27 }, (_, i) => i + 1),
    );
    leidas.forEach((p, i) =>
      assert.ok(i === 0 || p - (leidas[i - 1] ?? 0) <= 1, `salto de la ${leidas[i - 1]} a la ${p}`),
    );
  } finally {
    fs.rmSync(path.join(vault, 'tmp-denso'), { recursive: true });
    await reindex();
  }
});

test('should_report_last_complete_page_when_cut_by_characters', async () => {
  // Arrange
  const rel = 'tmp-cortado/denso.pdf';
  const densa = (n: number) =>
    Array.from({ length: 100 }, (_, k) => `P${n} linea ${k} ${'palabra'.repeat(8)}`).join('\n');
  write(rel, makePdf(Array.from({ length: 20 }, (_, i) => densa(i + 1))));
  await reindex();
  try {
    // Act
    const cortado = leerPaginasDocumento(rel, { desde: 1, hasta: 15 });
    const entero = leerPaginasDocumento(rel, { desde: 3, hasta: 4 });
    // Assert
    assert.equal(cortado.recortado, true);
    const ultimaMarca = Number([...cortado.texto.matchAll(/\[pág\. (\d+)\]/g)].at(-1)?.[1]);
    assert.equal(cortado.ultima_pagina_completa, ultimaMarca - 1, 'la que asoma al final está a medias');
    assert.equal(entero.recortado, false);
    assert.equal(entero.ultima_pagina_completa, 4, 'sin recorte, la última leída');
  } finally {
    fs.rmSync(path.join(vault, 'tmp-cortado'), { recursive: true });
    await reindex();
  }
});

test('should_read_a_huge_page_in_the_middle_by_characters_without_losing_text_or_looping', async () => {
  const rel = 'tmp-enorme/veinte.pdf';
  // La página 10 pasa de 100.000 caracteres, más del doble del tope de una lectura.
  const lineas = (n: number) =>
    Array.from({ length: n === 10 ? 1500 : 5 }, (_, j) => `P${n} linea ${j} ${'dato'.repeat(14)}`).join('\n');
  write(
    rel,
    makePdf(
      Array.from({ length: 20 }, (_, i) => lineas(i + 1)),
      0.4,
    ),
  );
  await reindex();
  try {
    // Lo leído encadenando «siguiente», puesto en orden: tras un corte por caracteres se sigue en
    // el carácter siguiente; tras un bloque de 15 páginas, en la página siguiente (el «\n\n» que
    // las separa no lo devuelve ninguna lectura).
    let leido = '';
    let cortado = false;
    let rango: { pagina_desde: number; pagina_hasta: number; desde_caracter?: number } | undefined = {
      pagina_desde: 1,
      pagina_hasta: 20,
    };
    let vueltas = 0;
    let dentroDeLaEnorme = 0;
    for (; rango && vueltas < 30; vueltas++) {
      const r = leerPaginasDocumento(rel, {
        desde: rango.pagina_desde,
        hasta: rango.pagina_hasta,
        desdeCaracter: rango.desde_caracter,
      });
      leido += (leido && !cortado ? '\n\n' : '') + r.texto;
      cortado = Boolean(r.recortado);
      if (r.siguiente?.desde_caracter !== undefined) {
        dentroDeLaEnorme += 1;
        assert.match(r.nota ?? '', new RegExp(`desde_caracter=${r.siguiente.desde_caracter}`));
      }
      rango = r.siguiente;
    }
    assert.equal(rango, undefined, `la cadena termina (${vueltas} lecturas)`);
    assert.ok(dentroDeLaEnorme > 0, 'se siguió dentro de la página enorme');
    let completo = '';
    for (let desde = 0, total = 1; desde < total;) {
      const r = await leerTexto(rel, desde);
      completo += r.texto;
      total = r.total;
      desde = r.hasta;
    }
    assert.ok(completo.length > 100_000);
    assert.equal(leido.length, completo.length, 'ni se pierde ni se repite ningún carácter');
    assert.ok(leido === completo, 'lo leído por páginas es el texto entero, en orden');
  } finally {
    fs.rmSync(path.join(vault, 'tmp-enorme'), { recursive: true });
    await reindex();
  }
});

const CABECERA = 'Diputacion Provincial - Pliego de clausulas administrativas';
const PIE = 'Expediente 2026/0042 - Servicio de formacion';
const pagina = (n: number, cuerpo: string) => ({
  page: n,
  text: `${CABECERA}\n${cuerpo}\nTexto propio de la pagina ${n}\n${PIE}`,
});

test('should_strip_header_and_footer_lines_repeated_on_most_pages', async () => {
  // Arrange
  const trozos = [1, 2, 3, 4].map((n) => pagina(n, `Clausula ${n}. Objeto del contrato`));
  const rel = 'tmp-membretes/pcap.pdf';
  write(
    rel,
    makePdf([1, 2, 3, 4].map((n) => `${CABECERA}\nClausula ${n}. Objeto\nTexto propio de la pagina ${n}\n${PIE}`)),
  );
  await reindex();
  try {
    // Act
    const limpio = quitarMembretes(trozos);
    const leido = leerPaginasDocumento(rel, { desde: 1, hasta: 4, sinMembretes: true });
    const tal = leerPaginasDocumento(rel, { desde: 1, hasta: 4 });
    const una = leerPaginasDocumento(rel, { desde: 3, hasta: 3, sinMembretes: true });
    // Assert
    assert.equal(limpio.quitadas, 8);
    assert.doesNotMatch(limpio.trozos.map((t) => t.text).join('\n\n'), /Diputacion Provincial|Expediente 2026/);
    assert.deepEqual(limpio.trozos[2], {
      page: 3,
      text: 'Clausula 3. Objeto del contrato\nTexto propio de la pagina 3',
    });
    assert.equal(leido.membretes_quitados, 8);
    assert.doesNotMatch(leido.texto, /Diputacion Provincial/);
    assert.match(leido.texto, /\[pág\. 3\]\nClausula 3\. Objeto\nTexto propio de la pagina 3/);
    assert.match(leido.texto, /Texto propio de la pagina 4/);
    assert.ok(leido.total < tal.total, 'se mide el tope sobre el texto ya limpio');
    assert.equal(tal.membretes_quitados, undefined, 'por defecto no se toca nada');
    assert.equal(una.membretes_quitados, 2, 'se detectan en el documento entero: también al leer una sola página');
    assert.doesNotMatch(una.texto, /Diputacion Provincial|Expediente 2026/);
  } finally {
    fs.rmSync(path.join(vault, 'tmp-membretes'), { recursive: true });
    await reindex();
  }
});

test('should_keep_lines_that_repeat_on_few_pages', () => {
  // Arrange: el título de una cláusula que solo se repite en 2 de 5 páginas, y un texto de solo 2 páginas.
  const repetida = 'Clausula 12. Solvencia tecnica';
  const cinco = [1, 2, 3, 4, 5].map((n) => ({ page: n, text: `${n <= 2 ? repetida : `Apartado ${n}`}\nCuerpo ${n}` }));
  const dos = [1, 2].map((n) => pagina(n, 'Igual en las dos'));
  // Act
  const deCinco = quitarMembretes(cinco);
  const deDos = quitarMembretes(dos);
  // Assert
  assert.deepEqual(deCinco, { trozos: cinco, quitadas: 0 });
  assert.deepEqual(deDos, { trozos: dos, quitadas: 0 }, 'con menos de 3 páginas no se quita nada');
  assert.deepEqual(quitarMembretes([]), { trozos: [], quitadas: 0 });
});

test('should_chain_reads_without_headers_through_a_huge_page_without_repeating_or_skipping_lines', async () => {
  // Arrange: membrete en las 20 páginas y la 10 de más de 100.000 caracteres.
  const rel = 'tmp-enorme-membretes/veinte.pdf';
  const cuantas = (n: number) => (n === 10 ? 1500 : 5);
  const lineas = (n: number) =>
    [CABECERA, ...Array.from({ length: cuantas(n) }, (_, j) => `P${n} linea ${j} ${'dato'.repeat(14)}`), PIE].join(
      '\n',
    );
  write(
    rel,
    makePdf(
      Array.from({ length: 20 }, (_, i) => lineas(i + 1)),
      0.4,
    ),
  );
  await reindex();
  try {
    // Act
    let leido = '';
    let cortado = false;
    let rango: { pagina_desde: number; pagina_hasta: number; desde_caracter?: number } | undefined = {
      pagina_desde: 1,
      pagina_hasta: 20,
    };
    let vueltas = 0;
    for (; rango && vueltas < 30; vueltas++) {
      const r = leerPaginasDocumento(rel, {
        desde: rango.pagina_desde,
        hasta: rango.pagina_hasta,
        desdeCaracter: rango.desde_caracter,
        sinMembretes: true,
      });
      leido += (leido && !cortado ? '\n\n' : '') + r.texto;
      cortado = Boolean(r.recortado);
      rango = r.siguiente;
    }
    // Assert
    assert.equal(rango, undefined, `la cadena termina (${vueltas} lecturas)`);
    assert.doesNotMatch(leido, /Diputacion Provincial|Expediente 2026/);
    const esperadas = Array.from({ length: 20 }, (_, i) =>
      Array.from({ length: cuantas(i + 1) }, (_, j) => `P${i + 1} linea ${j} `),
    ).flat();
    assert.deepEqual(
      [...leido.matchAll(/P\d+ linea \d+ /g)].map((m) => m[0]),
      esperadas,
      'ni se repite ni se salta ninguna línea',
    );
  } finally {
    fs.rmSync(path.join(vault, 'tmp-enorme-membretes'), { recursive: true });
    await reindex();
  }
});

test('should_keep_line_breaks_inside_a_paragraph_when_chunking', () => {
  const tabla = 'Apartado   Contenido\nClasificación  No se exige\nSubcontratación\tNo se admite';
  assert.deepEqual(trocearTexto(tabla), [
    'Apartado Contenido\nClasificación No se exige\nSubcontratación No se admite',
  ]);
  const larga = Array.from({ length: 40 }, (_, i) => `Fila ${i} del cuadro de características`).join('\n');
  const trozos = trocearTexto(larga, 300);
  assert.ok(trozos.length > 1 && trozos.every((t) => t.length <= 300));
  assert.ok(
    trozos.every((t) => t.split('\n').every((l) => /^Fila \d+ del cuadro de características$/.test(l))),
    'una fila nunca se parte ni se junta con otra',
  );
});

test('should_list_documents_without_a_note_or_pending_proposal', async () => {
  const all = await listarDocumentos(false, 50);
  assert.equal(all.total, 2);
  assert.equal(all.documentos.find((d) => d.ruta.endsWith('Pliego limpieza.pdf'))?.con_nota, true);
  const pendientes = await listarDocumentos(true, 50);
  assert.deepEqual(
    pendientes.documentos.map((d) => d.ruta),
    ['.gdocs/Licitaciones/Resumen.docx'],
  );
  await crearPropuesta({ title: 'Resumen', body: 'x', source: '.gdocs/Licitaciones/Resumen.docx' });
  assert.equal((await listarDocumentos(true, 50)).total, 0);
});

test('should_drop_deleted_files_from_the_index', async () => {
  fs.rmSync(path.join(vault, 'Clientes/Getafe.md'));
  assert.deepEqual((await reindex()).removed, ['Clientes/Getafe.md']);
});

test('should_file_an_approved_proposal_next_to_its_source', async () => {
  assert.equal(carpetaAprobacion({ fuente: 'Licitaciones/2026/Pliego.pdf' }), 'Licitaciones/2026');
  assert.equal(carpetaAprobacion({ fuente: '.gdocs/Licitaciones/Resumen.docx' }), 'Licitaciones');
  assert.equal(carpetaAprobacion({ carpeta: 'Clientes', fuente: 'Licitaciones/x.pdf' }), 'Clientes');
  assert.equal(carpetaAprobacion({ carpeta: '../fuera' }), '');
  assert.equal(carpetaAprobacion({}), '');
  assert.equal(nombreArchivoPropuesta('Licitación: limpieza / Getafe?'), 'Licitación limpieza Getafe.md');
  assert.equal(nombreArchivoPropuesta('...'), 'Propuesta.md');

  const body = '---\ntipo: licitacion\nestado: aprobada\n---\n# Resumen\n';
  const created = await crearPropuesta({
    title: 'Pliego limpieza Getafe',
    body,
    source: 'Licitaciones/2026/Pliego limpieza.pdf',
  });
  const raw = fs.readFileSync(path.join(vault, created.path), 'utf8');
  assert.match(raw, /estado: pendiente/);
  assert.match(raw, /tipo: licitacion/);
  assert.equal(raw.match(/^---$/gm)?.length, 2);
  const { moved_to } = await aprobar(path.basename(created.path));
  assert.equal(moved_to, 'Licitaciones/2026/Pliego limpieza Getafe.md');

  // Un título acabado en «S.A.» da «… S.A..md»: no es una ruta que salga de _Propuestas.
  const sa = await crearPropuesta({
    title: 'Licitación 1/2026 – Sociedad Ejemplo, S.A.',
    body: 'x',
    source: 'Licitaciones/2026/PCAP.pdf',
  });
  assert.match(path.basename(sa.path), /S\.A\.\.md$/);
  await rechazar(path.basename(sa.path));
  await assert.rejects(rechazar('../fuera.md'));
  await assert.rejects(rechazar('..'));
});

async function withAgentServer(fn: (base: string) => Promise<void>): Promise<void> {
  const express = (await import('express')).default;
  const { autenticarAgente, requiere } = await import('../../src/nucleo/agentes/autenticacionAgentes.js');
  const { crearRutasAgente } = await import('../../src/biblioteca/rutas/agente.js');
  const app = express();
  // Sin tokens por agente en el directorio: el token antiguo (BIBLIOTECA_TOKEN) es «hermes».
  const agentesDir = () => path.join(tmp, 'agentes');
  app.use('/hermes-vault/agent', autenticarAgente(agentesDir), requiere('biblioteca', 'leer'), crearRutasAgente());
  const server = escucharLocal(http.createServer(app));
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hermes-vault/agent`);
  } finally {
    server.close();
  }
}

test('should_serve_the_agent_api_only_with_the_token', async () => {
  await withAgentServer(async (base) => {
    const auth = { authorization: `Bearer ${process.env.BIBLIOTECA_TOKEN}`, 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/documentos`)).status, 401);
    assert.equal(
      (await fetch(`${base}/documentos`, { headers: { authorization: 'Bearer otro-token-que-no-vale-para-nada' } }))
        .status,
      401,
    );

    const found = await fetch(`${base}/buscar`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ consulta: 'oferta economica' }),
    });
    assert.equal(found.status, 200);
    assert.equal(
      ((await found.json()) as { resultados: { ruta: string }[] }).resultados[0]?.ruta,
      'Licitaciones/2026/Pliego limpieza.pdf',
    );

    const bad = await fetch(`${base}/propuestas`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ titulo: 'x', contenido: 'y', fuente: '../../etc/passwd' }),
    });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/propuestas`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ titulo: 'Nota de prueba', contenido: 'Hola' }),
    });
    assert.equal(ok.status, 201);
    assert.equal(((await ok.json()) as { ruta: string }).ruta, '_Propuestas/Nota de prueba.md');

    const read = await fetch(
      `${base}/leer?ruta=${encodeURIComponent('Licitaciones/2026/Pliego limpieza.pdf')}&max=20`,
      { headers: auth },
    );
    assert.equal(((await read.json()) as { texto: string }).texto.length, 20);
  });
});

test('should_keep_collaborator_cvs_out_of_notes_and_away_from_agents_without_permission', async () => {
  write('Colaboradores/CV Ana Garcia.pdf', makePdf(['Ana Garcia, consultora de oferta economica']));
  await reindex();
  assert.ok((await listarDocumentos(true, 50)).documentos.some((d) => d.ruta === 'Colaboradores/CV Ana Garcia.pdf'));
  assert.ok(
    !(await listarDocumentos(true, 50, ['colaboradores'])).documentos.some((d) => d.ruta.startsWith('Colaboradores/')),
  );
  assert.ok(
    !(await buscarEnBiblioteca('Ana Garcia', 20, undefined, ['Colaboradores'])).some((h) =>
      h.path.startsWith('Colaboradores/'),
    ),
  );
  await withAgentServer(async (base) => {
    const hermes = { authorization: `Bearer ${process.env.BIBLIOTECA_TOKEN}`, 'content-type': 'application/json' };
    const curioso = { authorization: `Bearer ${process.env.AGENTE_TOKEN_CURIOSO}`, 'content-type': 'application/json' };
    const sinNota = (await (await fetch(`${base}/documentos?sin_nota=1`, { headers: hermes })).json()) as {
      documentos: { ruta: string }[];
    };
    assert.ok(
      !sinNota.documentos.some((d) => d.ruta.startsWith('Colaboradores/')),
      'los CV nunca se proponen como notas',
    );
    const conCv = {
      authorization: `Bearer ${process.env.AGENTE_TOKEN_LICITACIONES}`,
      'content-type': 'application/json',
    };
    const nota = await fetch(`${base}/propuestas`, {
      method: 'POST',
      headers: hermes,
      body: JSON.stringify({ titulo: 'Ana', contenido: 'x', fuente: 'Colaboradores/CV Ana Garcia.pdf' }),
    });
    assert.equal(nota.status, 400);
    // En minúsculas: en Windows y Drive es la misma carpeta, también se protege.
    const cv = encodeURIComponent('colaboradores/CV Ana Garcia.pdf');
    assert.equal((await fetch(`${base}/leer?ruta=${cv}`, { headers: curioso })).status, 403);
    const busca = (await (
      await fetch(`${base}/buscar`, {
        method: 'POST',
        headers: curioso,
        body: JSON.stringify({ consulta: 'Ana Garcia oferta economica' }),
      })
    ).json()) as { resultados: { ruta: string }[] };
    assert.ok(!busca.resultados.some((r) => r.ruta.startsWith('Colaboradores/')));
    const todos = (await (await fetch(`${base}/documentos`, { headers: curioso })).json()) as {
      documentos: { ruta: string }[];
    };
    assert.ok(!todos.documentos.some((d) => d.ruta.startsWith('Colaboradores/')));
    const suyo = encodeURIComponent('Colaboradores/CV Ana Garcia.pdf');
    assert.equal(
      (await fetch(`${base}/leer?ruta=${suyo}`, { headers: conCv })).status,
      200,
      'quien lee colaboradores, sí',
    );
  });
});

test('should_keep_documents_analysed_with_a_ficha_out_of_notes_in_the_agent_api', async () => {
  const { registrarCarpetaConFicha } = await import('../../src/nucleo/documentos.js');
  registrarCarpetaConFicha('Licitaciones/Radar', 'Licitaciones');
  const pliego = 'Licitaciones/Radar/2026/p-1/PCAP.pdf';
  write(pliego, makePdf(['Pliego de clausulas administrativas particulares']));
  await reindex();
  assert.ok(
    (await listarDocumentos(true, 50)).documentos.some((d) => d.ruta === pliego),
    'sin el filtro saldría',
  );
  await withAgentServer(async (base) => {
    const hermes = { authorization: `Bearer ${process.env.BIBLIOTECA_TOKEN}`, 'content-type': 'application/json' };
    const sinNota = (await (await fetch(`${base}/documentos?sin_nota=1`, { headers: hermes })).json()) as {
      documentos: { ruta: string }[];
    };
    assert.ok(
      !sinNota.documentos.some((d) => d.ruta.startsWith('Licitaciones/Radar/')),
      'como biblioteca_documentos_sin_nota',
    );
    const nota = await fetch(`${base}/propuestas`, {
      method: 'POST',
      headers: hermes,
      body: JSON.stringify({ titulo: 'Pliego', contenido: 'x', fuente: pliego }),
    });
    assert.equal(nota.status, 400);
    assert.match(((await nota.json()) as { message: string }).message, /Licitaciones con su ficha/);
  });
});

test('should_decode_xml_with_the_encoding_of_its_prolog_or_bom', async () => {
  const cuerpo = '<raiz><a>Cifra de negocio año</a></raiz>';
  const latin1 = Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?>', 'latin1'),
    Buffer.from(cuerpo, 'latin1'),
  ]);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(cuerpo, 'utf16le')]);
  const raro = Buffer.from('<?xml version="1.0" encoding="no-existe"?><raiz><a>año</a></raiz>', 'utf8');
  assert.match((await extraerDocumento(write('tmp/l1.xml', latin1))).data?.pages[0] ?? '', /año/);
  assert.match((await extraerDocumento(write('tmp/u16.xml', utf16))).data?.pages[0] ?? '', /año/);
  assert.match((await extraerDocumento(write('tmp/raro.xml', raro))).data?.pages[0] ?? '', /año/);
});

test('should_read_an_ascii_xml_that_declares_utf16_without_bom_as_utf8', async () => {
  const xml = Buffer.from('<?xml version="1.0" encoding="UTF-16"?><raiz><a>Cifra de negocio</a></raiz>', 'utf8');
  assert.equal(codificacionXml(xml), 'utf-8');
  assert.match((await extraerDocumento(write('tmp/u16sinbom.xml', xml))).data?.pages[0] ?? '', /Cifra de negocio/);
  assert.equal(codificacionXml(Buffer.from([0xff, 0xfe, 0x3c, 0x00])), 'utf-16le');
});

test('should_keep_cdata_as_text_and_ignore_comments_in_a_deuc', async () => {
  const xml =
    '<espd:ESPDRequest><!-- <cac:TenderingCriterion><cbc:Name>Falso</cbc:Name></cac:TenderingCriterion> -->' +
    '<cac:TenderingCriterion><cbc:CriterionTypeCode>CRITERION.SELECTION.ECONOMIC</cbc:CriterionTypeCode><cbc:Name>Solvencia</cbc:Name>' +
    '<cbc:Description><![CDATA[Cifra de negocio >= 300.000 € & más]]></cbc:Description></cac:TenderingCriterion></espd:ESPDRequest>';
  const t = (await extraerDocumento(write('tmp/cdata.xml', xml))).data?.pages[0] ?? '';
  assert.match(t, /Solvencia: Cifra de negocio >= 300\.000 € & más/);
  assert.doesNotMatch(t, /Falso/);
  const suelto =
    (await extraerDocumento(write('tmp/cdata2.xml', '<r><a><![CDATA[x < y]]></a><!-- <b>no</b> --></r>'))).data
      ?.pages[0] ?? '';
  assert.equal(suelto.includes('x < y'), true);
  assert.equal(suelto.includes('no'), false);
});
