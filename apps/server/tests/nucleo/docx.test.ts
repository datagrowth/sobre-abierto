// La memoria técnica como .docx: títulos literales del pliego en el orden del guion, formato
// del pliego, «Página X de Y» solo en el cuerpo, listas y tablas, la misma memoria en
// Markdown y la estimación de páginas. Las páginas reales solo donde hay LibreOffice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';

process.env.NODE_ENV = 'test';

const {
  generarDocx,
  memoriaAMarkdown,
  estimarPaginas,
  MemoriaEntrada,
  CARACTERES_POR_PAGINA,
  EN_BLANCO,
  llevaNumeracion,
  tituloApartado,
  tituloBloque,
} = await import('../../src/nucleo/documentos/docx.js');
const { generarMemoriaCompleta, localizarApartados, paginasDe, pasadasConIndice, MAX_PASADAS } =
  await import('../../src/nucleo/documentos/paginas.js');
const { disponible } = await import('../../src/nucleo/documentos/libreoffice.js');
const { extraerDocumento } = await import('../../src/biblioteca/motor/documentos/extraccion.js');
const { ok, fail } = await import('../../src/nucleo/result.js');
type Memoria = import('../../src/nucleo/documentos/docx.js').Memoria;
type PaginasPdf = import('../../src/nucleo/documentos/paginas.js').PaginasPdf;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));

const MEMORIA: Memoria = {
  portada: {
    titulo: 'Memoria técnica',
    subtitulo: 'Servicio de asesoramiento jurídico',
    expediente: 'EXP-2026-0412',
    organo: 'Sociedad Insular de Inclusión de Ejemplo (SIIE)',
    licitadora: {
      nombre: 'Analítica Ejemplo, S.L.',
      nif: 'B00000000',
      domicilio: 'Calle Ejemplo 1, Puerto de Ejemplo',
    },
    fecha: '5 de octubre de 2026',
    lotes: ['1'],
  },
  apartados: [
    {
      numero: '1',
      titulo: 'Organización y metodología',
      bloques: [
        {
          subtitulo: 'Modelo organizativo',
          parrafos: [
            'La empresa propone un equipo de dos personas con un responsable único.',
            'Las consultas entran por un buzón compartido y se responden en 48 horas.',
          ],
        },
        { parrafos: [], lista: ['Elisa Pérez: responsable del contrato.', 'Juan López: consultor senior.'] },
        {
          subtitulo: 'Coordinación con la Asesoría Jurídica',
          parrafos: ['Reunión quincenal con acta.'],
          tabla: {
            cabecera: ['Hito', 'Fecha'],
            filas: [
              ['Arranque', 'Semana 1'],
              ['Primer informe', 'Mes 1'],
            ],
          },
        },
      ],
    },
    {
      numero: '2',
      titulo: 'Incidencias y control',
      bloques: [{ parrafos: ['Cada incidencia se registra con fecha, responsable y plazo de resolución.'] }],
    },
    {
      numero: '3',
      titulo: 'Mejoras vinculadas al objeto del contrato',
      bloques: [{ parrafos: ['Formación de cuatro horas al personal del órgano, sin coste.'] }],
    },
  ],
  pie: { texto: 'Analítica Ejemplo — Memoria técnica', numeracion: true },
};

function partes(buf: Buffer): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(new Uint8Array(buf))).map(([n, b]) => [n, strFromU8(b)]));
}

async function textoDe(buf: Buffer, nombre: string): Promise<string> {
  const abs = path.join(tmp, nombre);
  fs.writeFileSync(abs, buf);
  const { data, error } = await extraerDocumento(abs);
  assert.equal(error, null);
  return data!.pages[0]!;
}

test('should_validate_the_memoria_strictly', () => {
  assert.equal(MemoriaEntrada.safeParse(MEMORIA).success, true);
  assert.equal(MemoriaEntrada.safeParse({ ...MEMORIA, extra: 1 }).success, false, 'sin claves de más');
  const vacio = { ...MEMORIA, apartados: [{ numero: '1', titulo: 'x', bloques: [{ parrafos: [] }] }] };
  assert.equal(MemoriaEntrada.safeParse(vacio).success, false, 'un bloque necesita párrafos, lista o tabla');
  assert.equal(MemoriaEntrada.safeParse({ ...MEMORIA, formato: { tamano: 6 } }).success, false);
});

test('should_write_literal_titles_in_order_readable_by_the_library', async () => {
  const texto = await textoDe(await generarDocx(MEMORIA), 'memoria.docx');
  const lineas = texto.split('\n').map((l) => l.trim());
  const titulos = lineas.filter((l) => /^\d+\. /.test(l));
  const esperados = [
    '1. Organización y metodología',
    '2. Incidencias y control',
    '3. Mejoras vinculadas al objeto del contrato',
  ];
  assert.deepEqual(
    titulos,
    [...esperados, ...esperados],
    'una vez en el índice y otra en el cuerpo, sin numeración automática',
  );
  assert.deepEqual(
    lineas.filter((l) => /^\d+\.\d+ /.test(l)),
    ['1.1 Modelo organizativo', '1.2 Coordinación con la Asesoría Jurídica'],
    'solo los bloques con subtítulo numeran',
  );
  assert.ok(lineas.indexOf('Índice') < lineas.indexOf('1. Organización y metodología'));
  assert.ok(texto.includes('Presentada por Analítica Ejemplo, S.L. (NIF B00000000)'));
  assert.ok(texto.includes('Expediente EXP-2026-0412') && lineas.includes('Lote 1'));
});

// La portada decía «Lote: Lote 3: Lote 3: …»: el nombre de la PLACSP ya traía el «Lote 3».
test('should_name_each_lot_once_on_the_cover_whether_it_comes_labelled_or_bare', async () => {
  const m: Memoria = {
    ...MEMORIA,
    portada: { ...MEMORIA.portada, lotes: ['Lote 3: Acciones formativas en teleformación', '4'] },
  };
  const lineas = (await textoDe(await generarDocx(m), 'lotes.docx')).split('\n').map((l) => l.trim());
  assert.ok(lineas.includes('Lote 3: Acciones formativas en teleformación'), 'la etiqueta tal cual, en su línea');
  assert.ok(lineas.includes('Lote 4'), 'un número suelto lleva «Lote» delante');
  assert.equal(lineas.filter((l) => /lote/i.test(l)).length, 2, 'ni «Lote:» ni «Lotes:» delante');
  const md = memoriaAMarkdown(m);
  assert.ok(md.includes(' · Lote 3: Acciones formativas en teleformación; Lote 4 · '));
  assert.equal(md.match(/Lote 3/g)?.length, 1);
});

const FIRMA = {
  fecha: '14 de octubre de 2026',
  empresa: 'Analítica Ejemplo SL',
  lugar: 'Puerto de Ejemplo',
  firmante: 'Paco Ejemplo Gómez',
  cargo: 'Administrador solidario',
};

test('should_close_the_body_with_place_date_and_signature_only_when_given', async () => {
  const m: Memoria = { ...MEMORIA, firma: FIRMA };
  assert.equal(MemoriaEntrada.safeParse(m).success, true);
  const lineas = (await textoDe(await generarDocx(m), 'firma.docx'))
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const cierre = [
    'En Puerto de Ejemplo, a 14 de octubre de 2026.',
    'Fdo.: Paco Ejemplo Gómez',
    'Administrador solidario de Analítica Ejemplo SL',
  ];
  assert.deepEqual(lineas.slice(-3), cierre, 'al final del cuerpo, tras el último apartado');
  assert.ok(
    memoriaAMarkdown(m).endsWith(
      `Formación de cuatro horas al personal del órgano, sin coste.\n\n${cierre.join('\n\n')}\n`,
    ),
  );
  const sinDatos = (
    await textoDe(
      await generarDocx({ ...MEMORIA, firma: { fecha: FIRMA.fecha, empresa: FIRMA.empresa } }),
      'firma-blanco.docx',
    )
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  assert.deepEqual(
    sinDatos.slice(-3),
    [`En ${EN_BLANCO}, a 14 de octubre de 2026.`, `Fdo.: ${EN_BLANCO}`, 'Analítica Ejemplo SL'],
    'lo que no se sabe, en blanco para escribirlo',
  );
  assert.doesNotMatch(await textoDe(await generarDocx(MEMORIA), 'sin-firma.docx'), /Fdo\.:/, 'sin firma, sin cierre');
});

test('should_apply_font_size_spacing_and_margins_from_the_format', async () => {
  const docx = partes(
    await generarDocx({
      ...MEMORIA,
      formato: { fuente: 'Calibri', tamano: 12, interlineado: 1.5, margenes: { superior: 3 } },
    }),
  );
  assert.match(docx['word/styles.xml']!, /w:ascii="Calibri"/);
  assert.match(docx['word/styles.xml']!, /<w:sz w:val="24"\/>/, '12 pt en medios puntos');
  assert.match(docx['word/styles.xml']!, /w:line="360"/, 'interlineado 1,5');
  assert.match(docx['word/document.xml']!, /w:top="1700"/, '3 cm en twips (la librería trunca)');
  assert.match(docx['word/document.xml']!, /w:left="1417"/, 'el resto, 2,5 cm');
  const porDefecto = partes(await generarDocx(MEMORIA));
  assert.match(porDefecto['word/styles.xml']!, /w:ascii="Arial"/);
  assert.match(porDefecto['word/styles.xml']!, /<w:sz w:val="22"\/>/);
});

test('should_put_page_numbers_only_in_the_body_footer', async () => {
  const docx = partes(await generarDocx(MEMORIA));
  const pies = Object.keys(docx)
    .filter((n) => /^word\/footer\d+\.xml$/.test(n))
    .map((n) => docx[n]!);
  assert.equal(pies.length, 2, 'índice y cuerpo; la portada no lleva pie');
  const numerado = pies.filter((p) => p.includes('PAGE'));
  assert.equal(numerado.length, 1);
  assert.match(numerado[0]!, /Analítica Ejemplo — Memoria técnica — Página /);
  const sinNumerar = pies.find((p) => !p.includes('PAGE'))!;
  assert.match(sinNumerar, /Analítica Ejemplo — Memoria técnica/);
  const doc = docx['word/document.xml']!;
  assert.equal((doc.match(/<w:sectPr/g) ?? []).length, 3);
  assert.equal((doc.match(/<w:footerReference/g) ?? []).length, 2);
  assert.match(doc, /<w:pgNumType w:start="1"\/>/);
});

const pieNumerado = (docx: Record<string, string>) =>
  Object.keys(docx)
    .filter((n) => /^word\/footer\d+\.xml$/.test(n))
    .map((n) => docx[n]!)
    .find((p) => p.includes('PAGE'))!;

test('should_print_page_of_total_with_literal_body_total', async () => {
  const docx = partes(await generarDocx({ ...MEMORIA, indice: { total_cuerpo: 12 } }));
  const pie = pieNumerado(docx);
  assert.match(pie, /> de 12</);
  assert.ok(!pie.includes('SECTIONPAGES'), 'el total no es un campo que LibreOffice deje vacío');
});

test('should_print_page_without_dangling_of_when_total_is_unknown', async () => {
  const docx = partes(await generarDocx(MEMORIA));
  const pie = pieNumerado(docx);
  assert.ok(!/ de[ <]/.test(pie.replace(/<[^>]+>/g, '<')), 'sin « de » colgando');
});

test('should_render_lists_and_tables', async () => {
  const doc = partes(await generarDocx(MEMORIA))['word/document.xml']!;
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /<w:tblHeader\/>/);
  assert.ok(doc.includes('Arranque') && doc.includes('Primer informe'));
  assert.match(doc, /<w:numPr>/, 'viñetas');
  assert.ok(doc.includes('Juan López: consultor senior.'));
});

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"><rect x="10" y="10" width="300" height="100" fill="#1F6FB2"/><text x="20" y="60" font-size="16">Ficha</text></svg>';
const CON_FIGURAS: Memoria = {
  ...MEMORIA,
  apartados: [
    {
      numero: '1',
      titulo: 'Arquitectura',
      bloques: [
        {
          parrafos: ['La figura siguiente resume la arquitectura.'],
          figura: { titulo: 'Arquitectura de la solución', svg: SVG },
        },
      ],
    },
    {
      numero: '2',
      titulo: 'Pantallas',
      bloques: [{ parrafos: [], figura: { titulo: 'Ficha de entrada', svg: SVG.replace('Ficha', 'Entrada') } }],
    },
  ],
};

test('should_embed_figures_as_numbered_images_with_their_caption', async () => {
  assert.equal(MemoriaEntrada.safeParse(CON_FIGURAS).success, true, 'un bloque puede ser solo una figura');
  const docx = partes(await generarDocx(CON_FIGURAS));
  assert.equal(Object.keys(docx).filter((n) => /^word\/media\/.+\.png$/.test(n)).length, 2);
  const doc = docx['word/document.xml']!;
  assert.ok(
    doc.includes('Figura 1. Arquitectura de la solución') && doc.includes('Figura 2. Ficha de entrada'),
    'numeradas en orden por todo el documento',
  );
  assert.match(doc, /<wp:extent cx="5715000" cy="2857500"\/>/, '600 × 300 px: todo el ancho útil, sin deformar');
  const md = memoriaAMarkdown(CON_FIGURAS);
  assert.ok(
    md.includes('*Figura 2. Ficha de entrada*\n\nContenido: Entrada\n'),
    'en el .md, el pie y los rótulos del dibujo',
  );
  const sin = estimarPaginas({
    ...CON_FIGURAS,
    apartados: CON_FIGURAS.apartados.map((a) => ({
      ...a,
      bloques: a.bloques.map(({ figura: _f, ...b }) => ({ ...b, parrafos: b.parrafos.length ? b.parrafos : ['x'] })),
    })),
  });
  assert.ok(estimarPaginas(CON_FIGURAS).paginas - sin.paginas >= 0.6, 'dos figuras de media página ocupan');
});

test('should_write_the_figure_texts_in_the_markdown', () => {
  const pantalla =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300"><rect width="600" height="300" fill="#fff"/><text x="10" y="30" font-size="16">Bandeja</text><text x="10" y="60" font-size="16">Filtros &amp; búsqueda</text></svg>';
  const md = memoriaAMarkdown({
    ...MEMORIA,
    apartados: [
      {
        numero: '1',
        titulo: 'Pantallas',
        bloques: [
          {
            parrafos: ['La figura siguiente muestra la bandeja.'],
            figura: { titulo: 'Bandeja de expedientes', svg: pantalla },
          },
        ],
      },
    ],
  });
  assert.ok(md.includes('*Figura 1. Bandeja de expedientes*\n\nContenido: Bandeja · Filtros & búsqueda\n'), md);
  const largo = pantalla.replace('Bandeja</text>', `${'Rótulo largo '.repeat(80)}</text>`);
  const contenido = memoriaAMarkdown({
    ...MEMORIA,
    apartados: [
      { numero: '1', titulo: 'Pantallas', bloques: [{ parrafos: [], figura: { titulo: 'Larga', svg: largo } }] },
    ],
  })
    .split('Contenido: ')[1]!
    .split('\n')[0]!;
  assert.ok(contenido.length <= 600 && contenido.endsWith('…'), `con tope: ${contenido.length}`);
});

test('should_write_the_same_memoria_as_markdown', () => {
  const md = memoriaAMarkdown({ ...MEMORIA, indice: { paginas: { '1': 1, '2': 3 } } });
  assert.match(md, /^# Memoria técnica\nServicio de asesoramiento jurídico\n/);
  assert.ok(md.includes('- 1. Organización y metodología (pág. 1)'));
  assert.ok(md.includes('- 3. Mejoras vinculadas al objeto del contrato\n'), 'sin página conocida, sin paréntesis');
  assert.ok(md.includes('\n## 1. Organización y metodología\n'));
  assert.ok(md.includes('\n### 1.1 Modelo organizativo\n'));
  assert.ok(md.includes('\n- Elisa Pérez: responsable del contrato.\n'));
  assert.ok(md.includes('| Hito | Fecha |\n| --- | --- |\n| Arranque | Semana 1 |'));
  assert.ok(md.includes('**Expediente:** EXP-2026-0412') && md.includes(' · Lote 1 · '));
});

test('should_not_duplicate_numbering_when_subtitle_already_numbered', async () => {
  assert.equal(tituloBloque('1', 1, '1.1 Modelo organizativo'), '1.1 Modelo organizativo');
  assert.equal(tituloBloque('2', 3, '2.3. Plan de formación'), '2.3 Plan de formación');
  assert.equal(
    tituloBloque('2', 1, '4.2.1 Riesgos'),
    '2.1 Riesgos',
    'el número lo pone el documento, aunque el subtítulo traiga otro',
  );
  const numerada: Memoria = {
    ...MEMORIA,
    apartados: [
      {
        numero: '1',
        titulo: 'Organización',
        bloques: [{ subtitulo: '1.1 Modelo organizativo', parrafos: ['Un responsable único.'] }],
      },
    ],
  };
  assert.ok(memoriaAMarkdown(numerada).includes('\n### 1.1 Modelo organizativo\n'));
  assert.doesNotMatch(partes(await generarDocx(numerada))['word/document.xml']!, /1\.1 1\.1/);
});

test('should_keep_a_subtitle_that_starts_with_a_plain_number', () => {
  assert.equal(tituloBloque('3', 2, '2026 en cifras'), '3.2 2026 en cifras');
  assert.equal(tituloBloque('3', 1, '24 horas de soporte'), '3.1 24 horas de soporte');
});

test('should_estimate_pages_from_characters_and_format', () => {
  const parrafo = 'x'.repeat(850);
  const m: Memoria = {
    ...MEMORIA,
    apartados: [{ numero: '1', titulo: 'Único', bloques: [{ parrafos: Array.from({ length: 20 }, () => parrafo) }] }],
  };
  const e = estimarPaginas(m);
  assert.equal(e.base_por_pagina, CARACTERES_POR_PAGINA);
  assert.equal(e.caracteres, 3 * 85 + 20 * 850, 'título de 3 líneas + 20 párrafos de 10 líneas');
  assert.equal(e.paginas, 6.2);
  const grande = estimarPaginas({ ...m, formato: { tamano: 12, interlineado: 1.5 } });
  assert.equal(grande.base_por_pagina, 1569);
  assert.equal(grande.paginas, 11);
  const corto = estimarPaginas({
    ...m,
    apartados: [{ numero: '1', titulo: 'Único', bloques: [{ parrafos: ['Hola.'] }] }],
  });
  assert.equal(corto.caracteres, 3 * 85 + 85, 'un párrafo corto ocupa una línea entera');
  const conLista = estimarPaginas({
    ...m,
    apartados: [{ numero: '1', titulo: 'Único', bloques: [{ subtitulo: 'S', parrafos: [], lista: ['a', 'b'] }] }],
  });
  assert.equal(
    conLista.caracteres,
    3 * 85 + 2 * 85 + 2 * 85,
    'subtítulo 2 líneas; cada ítem al menos 60 caracteres, redondeado a línea',
  );
});

test('should_locate_sections_in_the_pdf_text_after_the_index', () => {
  const porPagina = [
    'Memoria técnica · Expediente EXP-2026-0412',
    'Índice\n1. Organización y metodología .... 1\n2. Incidencias y control .... 3\n3. Mejoras vinculadas al objeto del contrato .... 4',
    '1. Organización y metodología\nLa empresa propone…',
    'sigue el apartado 1',
    '2. Incidencias y\ncontrol\nCada incidencia…',
    '3. MEJORAS VINCULADAS AL OBJETO DEL CONTRATO\nFormación…',
  ];
  const loc = localizarApartados(MEMORIA.apartados, porPagina);
  assert.deepEqual(loc, { previas: 2, paginas: { '1': 1, '2': 3, '3': 4 }, faltan: [] });
  const sinTercero = localizarApartados(MEMORIA.apartados, porPagina.slice(0, 5));
  assert.deepEqual(sinTercero.faltan, ['3']);
  assert.deepEqual(localizarApartados(MEMORIA.apartados, ['nada']).faltan, ['1', '2', '3']);
});

test('should_locate_sections_in_the_body_when_a_guide_page_sits_between_index_and_body', () => {
  const porPagina = [
    'Memoria técnica · Expediente EXP-2026-0412',
    'Índice\n1. Organización y metodología .... 1\n2. Incidencias y control .... 3\n3. Mejoras vinculadas al objeto del contrato .... 4',
    'Cómo se responde a cada criterio\nLo que se valora | Apartado | Dónde se trata\nModelo organizativo | Apdo. 1: Organización y metodología | Modelo\nIndicadores | Apdo. 2: Incidencias y control | Indicadores\nMejoras | Apdo. 3: Mejoras vinculadas al objeto del contrato | Mejoras',
    '1. Organización y metodología\nLa empresa propone…',
    'sigue el apartado 1',
    '2. Incidencias y\ncontrol\nCada incidencia…',
    '3. MEJORAS VINCULADAS AL OBJETO DEL CONTRATO\nFormación…',
  ];
  const loc = localizarApartados(MEMORIA.apartados, porPagina);
  assert.deepEqual(
    loc,
    { previas: 3, paginas: { '1': 1, '2': 3, '3': 4 }, faltan: [] },
    'cada apartado en su página real del cuerpo; portada, índice y guía son previas',
  );
  const sinCuerpo = localizarApartados(MEMORIA.apartados, porPagina.slice(0, 3));
  assert.deepEqual(sinCuerpo.faltan, ['1', '2', '3'], 'la guía no se toma por el principio del cuerpo');
});

// El texto del PDF de MEMORIA con cada apartado empezando en la página del cuerpo dada.
function pdfCon(inicios: number[]): PaginasPdf {
  const cuerpo = Array.from(
    { length: Math.max(...inicios) },
    (_, i) =>
      MEMORIA.apartados
        .filter((_, k) => inicios[k] === i + 1)
        .map(tituloApartado)
        .join('\n') || 'sigue el apartado anterior',
  );
  return {
    paginas: 2 + cuerpo.length,
    pdf: Buffer.from('%PDF-1.7'),
    porPagina: ['Memoria técnica', `Índice\n${MEMORIA.apartados.map(tituloApartado).join('\n')}`, ...cuerpo],
  };
}

// LibreOffice es la frontera: un conversor que devuelve, en orden, las páginas dadas.
function medidor(mediciones: number[][]) {
  const llamadas: Buffer[] = [];
  const medir = async (docx: Buffer) => {
    llamadas.push(docx);
    return ok(pdfCon(mediciones[Math.min(llamadas.length, mediciones.length) - 1]!));
  };
  return { medir, llamadas };
}

const paginasDelIndice = async (docx: Buffer, nombre: string) =>
  (await textoDe(docx, nombre))
    .split('\n')
    .map((l) => /^\d+\. .+\t(\d+)$/.exec(l.trim())?.[1])
    .filter((p) => p !== undefined)
    .map(Number);

// Como en producción, la primera localización trae también el total de páginas del cuerpo.
const sinPaginas = (inicios: number[]) => {
  const pdf = pdfCon(inicios);
  const loc = localizarApartados(MEMORIA.apartados, pdf.porPagina);
  return { ...loc, total: pdf.paginas - loc.previas };
};

test('should_write_in_the_index_the_pages_measured_with_the_index_in_place', async () => {
  const { medir, llamadas } = medidor([
    [1, 3, 4],
    [1, 3, 4],
  ]);
  const r = await pasadasConIndice(MEMORIA, sinPaginas([1, 2, 3]), 1, medir);
  assert.equal(llamadas.length, 2, 'con las páginas puestas cambió una vez y luego ya no');
  assert.deepEqual(r.indice, { '1': 1, '2': 3, '3': 4 }, 'la última medida, no la de la pasada sin páginas');
  assert.deepEqual(await paginasDelIndice(r.docx, 'pasadas.docx'), [1, 3, 4], 'y es la que lleva el Word');
  assert.deepEqual([r.aviso, r.paginas], [null, 4]);
});

test('should_stop_after_the_maximum_passes_and_warn_when_the_pages_keep_changing', async () => {
  const { medir, llamadas } = medidor([
    [1, 3, 4],
    [1, 2, 3],
    [1, 3, 4],
  ]);
  const r = await pasadasConIndice(MEMORIA, sinPaginas([1, 2, 3]), 1, medir);
  assert.equal(llamadas.length, MAX_PASADAS);
  assert.deepEqual(r.indice, { '1': 1, '2': 2, '3': 3 }, 'el índice que lleva el Word entregado');
  assert.deepEqual(await paginasDelIndice(r.docx, 'oscila.docx'), [1, 2, 3]);
  assert.match(
    r.aviso ?? '',
    /La paginación siguió cambiando tras 3 pasadas con el índice: puede desviarse una página\./,
  );
});

test('should_stop_at_the_first_pass_when_nothing_moves_and_keep_the_docx_when_the_pdf_fails', async () => {
  const estable = medidor([[1, 1, 2]]);
  const r = await pasadasConIndice(MEMORIA, sinPaginas([1, 1, 2]), 1, estable.medir);
  assert.deepEqual([estable.llamadas.length, r.indice, r.aviso], [1, { '1': 1, '2': 1, '3': 2 }, null]);
  const roto = await pasadasConIndice(MEMORIA, sinPaginas([1, 1, 2]), 1, async () =>
    fail('conversion', 'soffice se cerró'),
  );
  assert.deepEqual(
    [roto.docx.length > 0, roto.pdf, roto.paginas, roto.indice],
    [true, null, null, { '1': 1, '2': 1, '3': 2 }],
  );
  assert.match(roto.aviso ?? '', /No se pudo generar el PDF definitivo: soffice se cerró/);
});

test('should_fall_back_to_an_estimate_without_libreoffice', async (t) => {
  if ((await disponible()).estado === 'ok') return t.skip('hay LibreOffice: este caso no se puede provocar');
  const r = await generarMemoriaCompleta(MEMORIA);
  assert.ok(r.docx.length > 0 && r.pdf === null && r.paginas === null && r.indice === null);
  assert.equal(r.paginas_estimadas, estimarPaginas(MEMORIA).paginas);
  assert.match(r.aviso ?? '', /LibreOffice/);
});

// LibreOffice convertía el alfa de las figuras en una máscara vacía: el PDF las dejaba invisibles.
test('should_keep_figures_visible_in_the_pdf_made_by_libreoffice', async (t) => {
  if ((await disponible()).estado !== 'ok') return t.skip('sin LibreOffice (soffice) en esta máquina');
  const pdf = await paginasDe(await generarDocx(CON_FIGURAS));
  assert.equal(pdf.error, null);
  const s = pdf.data!.pdf.toString('latin1');
  assert.ok((s.match(/\/Subtype\s*\/Image/g) ?? []).length >= 2, 'las figuras están en el PDF');
  assert.doesNotMatch(s, /\/SMask/, 'sin máscara de transparencia');
});

test('should_count_real_pages_and_fill_the_index_with_libreoffice', async (t) => {
  if ((await disponible()).estado !== 'ok') return t.skip('sin LibreOffice (soffice) en esta máquina');
  const r = await generarMemoriaCompleta(MEMORIA);
  assert.equal(r.aviso, null);
  assert.ok(r.pdf && r.pdf.subarray(0, 4).toString('latin1') === '%PDF');
  assert.deepEqual(r.indice, { '1': 1, '2': 1, '3': 1 }, 'una memoria corta cabe en una página de cuerpo');
  assert.equal(r.paginas, 1);
  const pdf = await paginasDe(r.docx);
  assert.equal(pdf.data?.paginas, 3, 'portada + índice + cuerpo');
  const texto = await textoDe(r.docx, 'memoria-final.docx');
  assert.match(texto, /1\. Organización y metodología\t1/, 'el índice lleva la página');
});

test('should_give_each_table_column_its_width_for_google_docs_and_read_tables_lists_and_images_back', async () => {
  const { contenidoDocx, dimensionesImagen } = await import('../../src/nucleo/documentos/leerDocx.js');
  const { svgAPng } = await import('../../src/nucleo/documentos/figuras.js');
  const png = svgAPng(SVG).data!.png;
  const t = {
    cabecera: ['ID', 'Comprobación', 'Severidad'],
    filas: [
      [
        'R01',
        'El coste aproximado del informe coincide con el presupuesto y con la reserva de crédito del expediente.',
        'Alta',
      ],
    ],
  };
  const m: Memoria = {
    ...MEMORIA,
    apartados: [
      {
        numero: '1',
        titulo: 'Reglas',
        bloques: [
          {
            parrafos: ['Estas son las reglas que se comprueban en cada expediente antes de elevarlo.'],
            lista: ['Una regla por fila'],
            tabla: t,
          },
          { parrafos: [], imagen: { ruta: 'Salidas/x/imagen-1.png', ancho: 1600, alto: 800, datos: png, tipo: 'png' } },
          { parrafos: [], imagen: { ruta: 'Salidas/x/no-esta.png', ancho: 100, alto: 50, pie: 'Pantalla perdida' } },
        ],
      },
    ],
  };
  const docx = await generarDocx(m);
  const doc = partes(docx)['word/document.xml']!;
  const anchos = [...doc.matchAll(/<w:tcW w:type="dxa" w:w="(\d+)"\/>/g)].slice(0, 3).map((x) => Number(x[1]));
  assert.equal(anchos.length, 3, 'cada celda con su ancho');
  assert.ok(anchos[1]! > anchos[0]! && anchos[1]! > anchos[2]!, 'la columna con más texto, más ancha');
  assert.ok(Math.abs(anchos.reduce((a, b) => a + b, 0) - 9071) < 5, 'entre todas, el ancho útil (16 cm)');
  assert.match(doc, /<w:tblLayout w:type="fixed"\/>/);
  assert.match(doc, /\[Imagen no disponible: Pantalla perdida\]/, 'sin los bytes, una marca visible');
  const c = contenidoDocx(docx).data!;
  const tablaLeida = c.elementos.find((e) => e.tipo === 'tabla');
  assert.deepEqual(tablaLeida, { tipo: 'tabla', filas: [t.cabecera, ...t.filas] });
  assert.ok(
    c.elementos.some((e) => e.tipo === 'parrafo' && e.lista && e.texto === 'Una regla por fila'),
    'la viñeta se lee como lista',
  );
  const conImagen = c.elementos.find((e) => e.tipo === 'parrafo' && e.imagenes.length);
  assert.ok(conImagen && c.imagenes.has((conImagen as { imagenes: string[] }).imagenes[0]!));
  assert.deepEqual(dimensionesImagen([...c.imagenes.values()][0]!), { ancho: 1600, alto: 800 });
});

const RICA: Memoria = {
  ...MEMORIA,
  apartados: [
    {
      numero: '1',
      titulo: 'Planificación',
      bloques: [
        {
          parrafos: ['El plan fija **cuatro hitos** con *fechas cerradas* y un responsable por hito.'],
          lista_numerada: ['Arranque y acta de inicio', 'Primer informe'],
        },
        {
          parrafos: ['Riesgos del proyecto, con su medida.'],
          tabla: {
            cabecera: ['Riesgo', 'Probabilidad', 'Impacto', 'Medida', 'Responsable', 'Indicador'],
            filas: [
              [
                'Retraso de datos',
                'Media',
                'Alto',
                'Plan B con datos de prueba',
                'Jefa de proyecto',
                'Días de retraso',
              ],
            ],
          },
        },
        { parrafos: [], lista_numerada: ['Otra lista que empieza en uno', 'Su segundo paso'] },
      ],
    },
    { numero: '2', titulo: 'Equipo', bloques: [{ parrafos: ['Un equipo de dos personas con dedicación fija.'] }] },
  ],
  guia: {
    titulo: 'Cómo se responde a cada criterio',
    tabla: {
      cabecera: ['Lo que se valora', 'Apartado', 'Dónde se trata'],
      filas: [['Planificación con fechas', '1. Planificación', 'Hitos']],
    },
  },
};

test('should_render_bold_italics_numbered_lists_a_landscape_table_and_the_guide_table', async () => {
  const docx = partes(await generarDocx(RICA));
  const doc = docx['word/document.xml']!;
  assert.match(
    doc,
    /<w:r><w:rPr><w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">cuatro hitos<\/w:t><\/w:r>/,
    'negrita en el XML, sin los asteriscos',
  );
  assert.match(doc, /<w:i\/><w:iCs\/><\/w:rPr><w:t xml:space="preserve">fechas cerradas<\/w:t>/);
  assert.doesNotMatch(doc, /\*\*/);
  const numeradas = [...doc.matchAll(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="(\d+)"\/><\/w:numPr>/g)].map(
    (m) => m[1],
  );
  assert.equal(numeradas.length, 4);
  assert.equal(numeradas[0], numeradas[1]);
  assert.notEqual(numeradas[1], numeradas[2], 'cada lista numerada empieza en 1: su propia instancia');
  assert.match(docx['word/numbering.xml']!, /<w:numFmt w:val="decimal"\/>/);
  assert.equal(
    (doc.match(/<w:sectPr/g) ?? []).length,
    5,
    'portada, índice, cuerpo, tabla apaisada y vuelta a vertical',
  );
  assert.equal((doc.match(/w:orient="landscape"/g) ?? []).length, 1);
  assert.equal((doc.match(/<w:footerReference/g) ?? []).length, 4, 'el pie sigue en cada sección del cuerpo');
  assert.equal(
    (doc.match(/<w:pgNumType w:start="1"\/>/g) ?? []).length,
    1,
    'la numeración sigue: solo empieza en 1 una vez',
  );
  assert.ok(
    doc.indexOf('Cómo se responde a cada criterio') <
      doc.indexOf('1. Planificación</w:t>', doc.indexOf('Cómo se responde')),
    'la tabla guía va tras el índice',
  );
  const md = memoriaAMarkdown(RICA);
  assert.match(md, /## Cómo se responde a cada criterio\n\n\| Lo que se valora \| Apartado \| Dónde se trata \|/);
  assert.match(md, /\n1\. Arranque y acta de inicio\n2\. Primer informe\n/);
});

test('should_not_count_the_bold_and_italic_marks_as_pages', () => {
  const con = estimarPaginas({
    ...MEMORIA,
    apartados: [
      { numero: '1', titulo: 'A', bloques: [{ parrafos: ['**Hito** uno con *fecha* cerrada. '.repeat(40)] }] },
    ],
  });
  const sin = estimarPaginas({
    ...MEMORIA,
    apartados: [{ numero: '1', titulo: 'A', bloques: [{ parrafos: ['Hito uno con fecha cerrada. '.repeat(40)] }] }],
  });
  assert.equal(con.caracteres, sin.caracteres);
});

test('should_read_back_bold_italics_and_numbered_lists_from_the_word', async () => {
  const { contenidoDocx } = await import('../../src/nucleo/documentos/leerDocx.js');
  const c = contenidoDocx(await generarDocx(RICA)).data!;
  const parrafos = c.elementos.filter((e) => e.tipo === 'parrafo');
  assert.ok(
    parrafos.some(
      (e) => e.marcado === 'El plan fija **cuatro hitos** con *fechas cerradas* y un responsable por hito.',
    ),
  );
  assert.deepEqual(
    parrafos.filter((e) => e.numerada).map((e) => e.texto),
    ['Arranque y acta de inicio', 'Primer informe', 'Otra lista que empieza en uno', 'Su segundo paso'],
  );
  assert.ok(
    contenidoDocx(await generarDocx(MEMORIA)).data!.elementos.some(
      (e) => e.tipo === 'parrafo' && e.lista && !e.numerada,
    ),
    'las viñetas no son numeradas',
  );
});

test('should_keep_figures_with_thousands_separator_and_strip_single_level_or_roman_numbering', () => {
  assert.equal(
    tituloBloque('2', 3, '1.500 usuarios formados en el primer año'),
    '2.3 1.500 usuarios formados en el primer año',
  );
  assert.equal(tituloBloque('2', 3, '10.000 Expedientes al año'), '2.3 10.000 Expedientes al año');
  assert.equal(tituloBloque('2', 3, '24.7 horas de cobertura'), '2.3 24.7 horas de cobertura');
  assert.equal(tituloBloque('2', 1, '1. Diagnóstico'), '2.1 Diagnóstico');
  assert.equal(tituloBloque('2', 2, '2) Plan'), '2.2 Plan');
  assert.equal(tituloBloque('2', 1, 'II.1 Metodología'), '2.1 Metodología');
  assert.equal(tituloBloque('1', 1, 'I. Introducción'), '1.1 Introducción');
  assert.equal(llevaNumeracion('1.500 usuarios formados'), false);
  assert.equal(llevaNumeracion('II.1 Metodología'), true);
});
