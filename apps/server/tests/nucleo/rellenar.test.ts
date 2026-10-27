// Relleno de modelos de Word: huecos con su etiqueta (también cuando cruzan varios runs),
// extracción de un anexo de un documento con varios, relleno que deja el valor en el primer
// run del tramo con su formato, y el seguro de literalidad que detecta cualquier cambio fuera
// de los huecos planificados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { DISCAPACIDAD, ISO, modelosAnexos, P } from './fixtures/modelosAnexos.js';

const {
  diferenciasFueraDelPlan,
  esHueco,
  extraerParrafos,
  huecosDe,
  literalesDe,
  localizarHuecos,
  markdownDeParrafos,
  rellenarDocx,
} = await import('../../src/nucleo/documentos/rellenar.js');

const MODELOS = await modelosAnexos();
const documentXml = (docx: Uint8Array) => strFromU8(unzipSync(docx)['word/document.xml']!);
const parrafos = (docx: Uint8Array) => localizarHuecos(docx).data!.parrafos;
const texto = (docx: Uint8Array, n: number) => parrafos(docx).find((p) => p.indice === n)?.texto ?? '';
const trozo = (t: string, re: RegExp) => re.exec(t)![0];
// El w:r que contiene un texto (para mirar su formato).
const runCon = (xml: string, t: string) =>
  [...xml.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].map((m) => m[0]).find((r) => r.includes(t)) ?? '';

test('should_find_gaps_with_their_labels_when_runs_are_split', () => {
  const h = localizarHuecos(MODELOS);
  assert.equal(h.error, null);
  const p8 = h.data!.parrafos.find((p) => p.indice === P.nombre7)!;
  assert.match(
    p8.texto,
    /^D\.\/Dña\. …{5,}, con NIF …{4,}, en representación de/,
    'el hueco partido en dos runs se lee seguido',
  );
  assert.deepEqual(
    p8.huecos.map((x) => x.etiqueta),
    ['nombre', 'nif', 'representacion', 'domicilio'],
  );
  assert.deepEqual(
    huecosDe(texto(MODELOS, P.importe7)).map((x) => x.etiqueta),
    ['importe', 'importe'],
  );
  const iso = h.data!.parrafos.find((p) => p.indice === P.iso)!;
  assert.equal(iso.en_tabla, true);
  assert.deepEqual(
    iso.huecos.map((x) => x.tipo),
    ['casilla'],
  );
  assert.deepEqual(
    huecosDe('Teléfono:'),
    [{ tipo: 'etiqueta', texto: '', inicio: 9, etiqueta: 'telefono' }],
    'una etiqueta al final es un hueco',
  );
  assert.deepEqual(huecosDe('ANEXO VII'), []);
  assert.equal(h.data!.total, 14);
});

test('should_number_paragraphs_in_markdown_and_mark_gaps', () => {
  const h = localizarHuecos(MODELOS).data!;
  assert.match(h.markdown, /^\[1\] ANEXO VI$/m);
  assert.match(h.markdown, /^\[10\] \| ☐ Certificado ISO 14001 {2}⟵ 1 hueco$/m);
  assert.match(h.markdown, /^\[8\] D\.\/Dña\..*⟵ 4 huecos \(nombre, nif, representacion, domicilio\)$/m);
  assert.doesNotMatch(
    markdownDeParrafos(h.parrafos, P.anexo7, P.firma7),
    /ANEXO VI$/m,
    'el rango deja fuera el otro anexo',
  );
});

test('should_return_error_when_bytes_are_not_a_docx', () => {
  assert.equal(localizarHuecos(Buffer.from('esto no es un zip')).error?.code, 'docx_invalido');
  const sinDocumento = zipSync({ 'otra.xml': strToU8('<a/>') });
  assert.equal(localizarHuecos(sinDocumento).error?.code, 'docx_invalido');
});

test('should_extract_only_the_range_keeping_styles_and_section', () => {
  const r = extraerParrafos(MODELOS, P.anexo7, P.firma7);
  assert.equal(r.error, null);
  const ps = parrafos(r.data!);
  assert.equal(ps[0]!.texto, 'ANEXO VII');
  assert.equal(ps.length, P.firma7 - P.anexo7 + 1);
  assert.ok(!ps.some((p) => p.texto === 'ANEXO VI' || p.texto.startsWith('DECLARACIÓN')), 'sin el anexo VI');
  const antes = unzipSync(MODELOS);
  const despues = unzipSync(r.data!);
  assert.deepEqual(Object.keys(despues), Object.keys(antes), 'el mismo paquete');
  assert.equal(strFromU8(despues['word/styles.xml']!), strFromU8(antes['word/styles.xml']!));
  assert.match(documentXml(r.data!), /<w:sectPr[\s\S]*<\/w:body>/, 'conserva la sección final');
});

test('should_keep_whole_table_when_range_starts_inside_it', () => {
  const ps = parrafos(extraerParrafos(MODELOS, P.discapacidad, P.telefono).data!);
  assert.deepEqual(
    ps.map((p) => p.texto),
    [ISO, DISCAPACIDAD, 'Teléfono:'],
  );
});

test('should_reject_invalid_ranges', () => {
  assert.equal(extraerParrafos(MODELOS, 5, 4).error?.code, 'invalid_input');
  assert.equal(extraerParrafos(MODELOS, 1, 99).error?.code, 'invalid_input');
  assert.equal(extraerParrafos(MODELOS, 0, 3).error?.code, 'invalid_input');
});

test('should_fill_gap_crossing_runs_in_first_run_with_its_format', () => {
  const t8 = texto(MODELOS, P.nombre7);
  const nombre = trozo(t8, /D\.\/Dña\. …+/);
  const nif = trozo(t8, /con NIF …+/);
  const subs = [
    { parrafo: P.nombre7, original: nombre, nuevo: 'D./Dña. Ana García Pérez' },
    { parrafo: P.nombre7, original: nif, nuevo: 'con NIF 12345678Z' },
    { parrafo: P.iso, original: '☐', nuevo: '☒' },
  ];
  const r = rellenarDocx(MODELOS, subs);
  assert.equal(r.error, null);
  assert.equal(r.data!.aplicadas.length, 3);
  assert.deepEqual(r.data!.noEncontradas, []);
  assert.match(
    texto(r.data!.docx, P.nombre7),
    /^D\.\/Dña\. Ana García Pérez, con NIF 12345678Z, en representación de …+/,
  );
  assert.equal(texto(r.data!.docx, P.iso), '☒ Certificado ISO 14001');
  const xml = documentXml(r.data!.docx);
  assert.doesNotMatch(runCon(xml, 'Ana García Pérez'), /<w:b\/>/, 'el valor va en el primer run (sin negrita)');
  assert.doesNotMatch(runCon(xml, '12345678Z'), /<w:i\/>/, 'el NIF va en el run sin cursiva');
  assert.match(xml, /<w:b\/>[\s\S]*?<w:t xml:space="preserve"><\/w:t>/, 'el run en negrita queda vacío, sin borrarse');
  assert.deepEqual(diferenciasFueraDelPlan(MODELOS, r.data!.docx, r.data!.aplicadas), []);
});

test('should_fill_the_first_remaining_gap_when_original_repeats', () => {
  const r = rellenarDocx(MODELOS, [{ parrafo: P.lugar7, original: '……………', nuevo: 'Santa Cruz de Tenerife' }]).data!;
  assert.equal(texto(r.docx, P.lugar7), 'En Santa Cruz de Tenerife, a …… de ………… de 2026');
  assert.equal(texto(r.docx, P.lugar6), texto(MODELOS, P.lugar6), 'el otro anexo no se toca');
});

test('should_report_substitutions_not_found', () => {
  const r = rellenarDocx(MODELOS, [
    { parrafo: P.nombre7, original: 'con CIF ……', nuevo: 'con CIF B1' },
    { parrafo: 99, original: '……', nuevo: 'x' },
  ]).data!;
  assert.equal(r.aplicadas.length, 0);
  assert.equal(r.noEncontradas.length, 2);
  assert.deepEqual(diferenciasFueraDelPlan(MODELOS, r.docx, r.aplicadas), [], 'sin cambios');
});

test('should_detect_literal_changes_in_planned_substitutions', () => {
  const representacion = trozo(texto(MODELOS, P.nombre7), /en representación de …+/);
  const subs = [{ parrafo: P.nombre7, original: representacion, nuevo: 'actuando para Analítica Ejemplo SL' }];
  const r = rellenarDocx(MODELOS, subs).data!;
  const d = diferenciasFueraDelPlan(MODELOS, r.docx, r.aplicadas);
  assert.deepEqual(d, [
    `Párrafo ${P.nombre7}: «actuando para Analítica Ejemplo SL» cambia el texto del modelo «en representación de»: solo se rellenan los huecos y el texto del modelo se conserva literal.`,
  ]);
});

test('should_reject_substitutions_that_are_not_gaps', () => {
  const subs = [{ parrafo: P.proposicion, original: 'PROPOSICIÓN ECONÓMICA', nuevo: 'PROPOSICIÓN ECONÓMICA MEJORADA' }];
  const r = rellenarDocx(MODELOS, subs).data!;
  assert.match(diferenciasFueraDelPlan(MODELOS, r.docx, r.aplicadas)[0]!, /no es un hueco del modelo/);
  assert.equal(esHueco('con NIF ……'), true);
  assert.equal(esHueco('Teléfono:'), true);
  assert.equal(esHueco('declara que'), false);
  assert.deepEqual(literalesDe('D./Dña. …… con NIF ……'), ['D./Dña.', 'con NIF']);
});

test('should_detect_changes_outside_the_plan', () => {
  const nombre = trozo(texto(MODELOS, P.nombre7), /D\.\/Dña\. …+/);
  const r = rellenarDocx(MODELOS, [{ parrafo: P.nombre7, original: nombre, nuevo: 'D./Dña. Ana García Pérez' }]).data!;
  assert.deepEqual(
    diferenciasFueraDelPlan(MODELOS, r.docx, []),
    [`El párrafo ${P.nombre7} cambió fuera de los huecos planificados.`],
    'un cambio que no estaba en el plan',
  );
  const archivos = unzipSync(MODELOS);
  const sinNegrita = zipSync({
    ...archivos,
    'word/document.xml': strToU8(strFromU8(archivos['word/document.xml']!).replace('<w:b/>', '')),
  });
  assert.deepEqual(diferenciasFueraDelPlan(MODELOS, sinNegrita, []), [
    'El documento cambió fuera del texto de los huecos (formato o estructura).',
  ]);
  const menos = extraerParrafos(MODELOS, P.anexo7, P.firma7).data!;
  assert.match(diferenciasFueraDelPlan(MODELOS, menos, []).join(' '), /no se añaden ni se quitan párrafos/);
});
