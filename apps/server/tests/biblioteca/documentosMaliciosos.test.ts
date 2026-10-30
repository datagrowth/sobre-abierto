// Documentos y notas hechos para tumbar el indexador o el servidor: cualquier editor de
// la carpeta Conocimiento de Drive puede subirlos. Tienen que terminar rápido y con un
// error controlado, sin quedarse sin memoria ni horas de CPU.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-maliciosos-'));
const vault = path.join(tmp, 'conocimiento');
fs.mkdirSync(vault);
process.env.VAULT_PATH = vault;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.NODE_ENV = 'test';

const { extraerDocumento, extraerTextoXml, hojaATexto } =
  await import('../../src/biblioteca/motor/documentos/extraccion.js');
const { leerNota } = await import('../../src/biblioteca/motor/notas.js');
const { reescribirEnlaces } = await import('../../src/biblioteca/motor/enlaces.js');
const { enlacesCrudos, wikilinkTargets } = await import('../../src/biblioteca/motor/wikilinks.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function ms(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

async function msAsync(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

function write(rel: string, content: string | Buffer): string {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// ZIP cuyas entradas declaran `declarado` bytes descomprimidos (en la cabecera local y en
// el directorio central, que es el que lee fflate) aunque ocupen muy poco.
function zipDeclarando(files: Record<string, string>, declarado: number): Buffer {
  const buf = Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  for (let i = 0; i + 4 <= buf.length; i++) {
    const firma = buf.readUInt32LE(i);
    if (firma === 0x04034b50) buf.writeUInt32LE(declarado, i + 22);
    if (firma === 0x02014b50) buf.writeUInt32LE(declarado, i + 24);
  }
  return buf;
}

test('should_reject_a_docx_whose_entry_declares_a_huge_size', async () => {
  const abs = write(
    'bomba.docx',
    zipDeclarando({ 'word/document.xml': '<w:document><w:p><w:t>Hola</w:t></w:p></w:document>' }, 60 * 1024 * 1024),
  );
  const { data, error } = await extraerDocumento(abs);
  assert.equal(data, null);
  assert.match(error ?? '', /demasiado grande/);
});

test('should_still_read_a_normal_docx', async () => {
  const abs = write(
    'normal.docx',
    Buffer.from(
      zipSync({
        'word/document.xml': strToU8(
          '<w:document><w:p><w:t>Hola</w:t></w:p><w:p><w:r><w:instrText>PAGE</w:instrText></w:r><w:t>mundo</w:t></w:p></w:document>',
        ),
      }),
    ),
  );
  const { data, error } = await extraerDocumento(abs);
  assert.equal(error, null);
  assert.deepEqual(data?.pages, ['Hola\nmundo']);
});

test('should_extract_pathological_docx_xml_quickly', async () => {
  // Aperturas sin cierre y «<» sin «>»: con las regex de antes, minutos de CPU.
  const xml =
    '<w:document><w:p><w:t>Inicio</w:t></w:p>' +
    '<w:instrText>'.repeat(40_000) +
    '<'.repeat(100_000) +
    '<w:tab '.repeat(40_000);
  const abs = write('lento.docx', Buffer.from(zipSync({ 'word/document.xml': strToU8(xml) })));
  let texto = '';
  const t = await msAsync(async () => {
    texto = (await extraerDocumento(abs)).data?.pages[0] ?? '';
  });
  assert.ok(t < 1000, `tardó ${Math.round(t)} ms`);
  assert.match(texto, /^Inicio/);
  assert.ok(ms(() => extraerTextoXml(' '.repeat(200_000) + 'x')) < 200);
});

test('should_extract_pathological_xml_quickly', async () => {
  const deuc =
    '<ESPDRequest>' + '<cac:TenderingCriterion>'.repeat(40_000) + '<'.repeat(100_000) + '<cbc:Name>'.repeat(40_000);
  const otro = '<raiz>' + '<a'.repeat(100_000) + '</b>'.repeat(40_000);
  const t = await msAsync(async () => {
    assert.equal((await extraerDocumento(write('lento-deuc.xml', deuc))).error, null);
    assert.equal((await extraerDocumento(write('lento.xml', otro))).error, null);
  });
  assert.ok(t < 1000, `tardó ${Math.round(t)} ms`);
});

test('should_extract_pathological_xlsx_xml_quickly', () => {
  const filas = '<row>'.repeat(60_000);
  const celdas = '<row r="1">' + '<c r="A1">'.repeat(60_000) + '</row>';
  const t = ms(() => {
    hojaATexto(filas, []);
    hojaATexto(celdas, []);
    hojaATexto('<row><c t="inlineStr"><is>' + '<'.repeat(100_000) + '</is></c></row>', []);
  });
  assert.ok(t < 500, `tardó ${Math.round(t)} ms`);
  assert.equal(
    hojaATexto('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>7</v></c><c r="C1" t="s"/></row><row r="2"/>', [
      'Total',
    ]),
    'Total\t7',
  );
});

test('should_read_a_note_full_of_unclosed_wikilinks_quickly', async () => {
  write('corchetes.md', '# Nota\n' + '[['.repeat(100_000));
  const t = await msAsync(() => leerNota('corchetes.md'));
  assert.ok(t < 200, `tardó ${Math.round(t)} ms`);
  const texto = '[['.repeat(100_000);
  assert.ok(ms(() => reescribirEnlaces(texto, () => 'x')) < 200);
  assert.ok(ms(() => wikilinkTargets('[[a|'.repeat(50_000))) < 200);
});

test('should_find_the_same_wikilinks_as_before_in_normal_text', () => {
  const texto =
    'Ver [[Nota]], [[carpeta/Otra|alias]], ![[img.png]], [[Doc#Sección|Texto]], [[|x]], [[x|]], [[a\nb]] y [[[[doble]]';
  assert.deepEqual(wikilinkTargets(texto), ['Nota', 'carpeta/Otra', 'img.png', 'Doc#Sección', '[[doble']);
  assert.deepEqual(
    enlacesCrudos('![[Doc#Sec|Alias]] y [[A|b#c]]').map(({ bang, target, heading, alias }) => [
      bang,
      target,
      heading,
      alias,
    ]),
    [
      ['!', 'Doc', '#Sec', '|Alias'],
      ['', 'A', '', '|b#c'],
    ],
  );
});

test('should_extract_a_deuc_with_many_prefixed_openings_and_one_gt_quickly', async () => {
  const deuc =
    '<ESPDRequest>' + '<TenderingCriterionX'.repeat(100_000) + '>' + '<TenderingCriterion '.repeat(100_000) + '>';
  const t = await msAsync(async () => {
    assert.equal((await extraerDocumento(write('prefijos.xml', deuc))).error, null);
  });
  assert.ok(t < 1000, `tardó ${Math.round(t)} ms`);
});

test('should_not_break_on_out_of_range_numeric_entities', () => {
  const texto = extraerTextoXml('<w:p><w:t>a&#x110000;b&#xD800;c&#0;d&#65;</w:t></w:p>');
  assert.equal(texto, 'a&#x110000;b&#xD800;c&#0;dA');
});

test('should_extract_xml_with_comments_and_cdata_quickly', async () => {
  const xml = '<ESPDRequest>' + '<!--'.repeat(100_000) + '<![CDATA['.repeat(1000);
  const t = await msAsync(async () => {
    assert.equal((await extraerDocumento(write('sin-cierre.xml', xml))).error, null);
  });
  assert.ok(t < 1000, `tardó ${Math.round(t)} ms`);
});
