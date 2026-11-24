// Citas comprobadas: una cita se busca literal en los pliegos indexados de la
// licitación y queda comprobada con su documento y página, o «no localizada»; sin índice no se
// dice nada. La ficha, las comprobaciones y las propuestas de Hermes sobre un bloqueo usan lo mismo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'citas-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { citasDeRequisitos, comprobadorDe } = await import('../../src/dominios/licitaciones/citasPliego.js');
const { citaLiteral } = await import('../../src/dominios/licitaciones/oferta/comprobacionesCitas.js');
const { comprobarCitas } = await import('../../src/dominios/licitaciones/oferta/bloqueoProponer.js');
const indice = await import('../../src/biblioteca/motor/documentos/almacen.js');
type Raices = import('../../src/nucleo/salidas.js').Raices;
type Requisito = import('../../src/dominios/licitaciones/ficha.js').FichaDatosData['requisitos'][number];

iniciarNucleo();
const db = dbLicitaciones();
const idx = indice.abrirIndice(path.join(tmp, 'indice'));
after(() => {
  idx.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ID = 'p-60000001';
const PCAP = 'Licitaciones/Ofertas/EXP-1 · Formación (p-60000001)/Pliegos/PCAP.pdf';
const PPT = 'Licitaciones/Ofertas/EXP-1 · Formación (p-60000001)/Pliegos/PPT.pdf';
const ts = new Date().toISOString();
guardarLicitacion(db, {
  ...licitacion({ titulo: 'Formación', publicada: '2026-10-01' }),
  id: ID,
  atom_id: 'atom-citas',
});
// La cláusula 8.2 sigue en el trozo siguiente de la misma página 11.
indice.reemplazarArchivo(
  idx,
  {
    path: PCAP,
    kind: 'document',
    title: 'PCAP',
    mtime_ms: 1,
    size: 1,
    pages: 12,
    status: 'ok',
    error: null,
    source: null,
  },
  [
    { page: 3, text: 'Cláusula 1. Objeto del contrato: formación en inteligencia artificial generativa.' },
    {
      page: 11,
      text: '8.2.a) Volumen anual de negocios, referido al año de mayor volumen de los tres últimos concluidos,',
    },
    { page: 11, text: 'que deberá ser al menos de 72.000 euros, IVA excluido.' },
  ],
);
indice.reemplazarArchivo(
  idx,
  {
    path: PPT,
    kind: 'document',
    title: 'PPT',
    mtime_ms: 1,
    size: 1,
    pages: 2,
    status: 'ok',
    error: null,
    source: null,
  },
  [{ page: 2, text: 'El docente acreditará al menos 150 horas de docencia en inteligencia artificial.' }],
);
for (const [ruta, clase] of [
  [PCAP, 'pcap'],
  [PPT, 'ppt'],
] as const) {
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, intentos, actualizado_en) VALUES (?, ?, ?, ?, 'descargado', ?, 0, ?)",
  ).run(ID, ruta, clase, path.posix.basename(ruta), ruta, ts);
}
const comprobar = comprobadorDe(db, idx, ID);

test('should_find_a_literal_quote_ignoring_accents_and_case_with_its_document_and_page', () => {
  assert.deepEqual(comprobar('el docente acreditara al menos 150 HORAS de docencia'), {
    estado: 'comprobada',
    documento: PPT,
    pagina: 2,
  });
});

test('should_find_a_quote_that_spans_two_index_chunks', () => {
  assert.deepEqual(comprobar('de los tres últimos concluidos, que deberá ser al menos de 72.000 euros'), {
    estado: 'comprobada',
    documento: PCAP,
    pagina: 11,
  });
});

test('should_accept_an_ellipsis_to_skip_part_of_the_text', () => {
  assert.equal(comprobar('Volumen anual de negocios … al menos de 72.000 euros').estado, 'comprobada');
});

test('should_say_not_found_when_the_quote_is_paraphrased', () => {
  assert.deepEqual(comprobar('Volumen de negocio mínimo de 72.000 euros en uno de los tres últimos años'), {
    estado: 'no_localizada',
    documento: null,
    pagina: null,
  });
});

test('should_look_only_in_the_given_document', () => {
  assert.equal(comprobar('al menos 150 horas de docencia', PCAP).estado, 'no_localizada');
  assert.equal(comprobar('al menos 150 horas de docencia', PPT).estado, 'comprobada');
});

test('should_say_nothing_without_an_index_or_indexed_pliegos', () => {
  assert.equal(comprobadorDe(db, null, ID)('al menos 150 horas de docencia').estado, 'sin_indice');
  assert.equal(comprobadorDe(db, idx, 'p-sin-pliegos')('al menos 150 horas de docencia').estado, 'sin_indice');
});

test('should_check_each_requirement_with_a_literal_quote_in_order', () => {
  const r = citasDeRequisitos(db, idx, ID, [
    { cita: 'al menos 150 horas de docencia en inteligencia artificial' },
    {},
    { cita: 'esto no lo dice el pliego en ningún sitio' },
  ]);
  assert.deepEqual(
    r.map((x) => x?.estado ?? null),
    ['comprobada', null, 'no_localizada'],
  );
});

test('should_give_the_comprobaciones_row_the_literal_quote_with_its_checked_page', () => {
  // Arrange
  const req = {
    tipo: 'medios_personales',
    descripcion: 'Docente con 150 h',
    excluyente: true,
    cumple: 'dudoso',
    justificacion: 'x',
    documento: 'PPT',
    pagina: 1,
    cita: 'al menos 150 horas de docencia',
  } as Requisito;
  const sinCita = { ...req, cita: undefined } as Requisito;
  const citas = new Map([[req, comprobar(req.cita!)]]);
  // Act / Assert
  assert.deepEqual(citaLiteral({ citas_requisitos: citas }, req), {
    documento: PPT,
    pagina: 2,
    texto: 'al menos 150 horas de docencia',
    comprobada: true,
  });
  assert.equal(
    citaLiteral({ citas_requisitos: citas }, sinCita),
    null,
    'sin cita literal, la regla cita la descripción',
  );
  assert.equal(citaLiteral({}, req)?.comprobada, false, 'sin comprobar no se da por comprobada');
});

test('should_reject_a_bloqueo_quote_on_the_wrong_page_saying_where_it_is', async () => {
  const raices = {} as Raices;
  const bien = await comprobarCitas(
    db,
    raices,
    ID,
    [{ documento: 'PPT.pdf', pagina: 2, texto: 'El docente acreditará al menos 150 horas de docencia' }],
    idx,
  );
  const pagina = await comprobarCitas(
    db,
    raices,
    ID,
    [{ documento: 'PPT.pdf', pagina: 1, texto: 'El docente acreditará al menos 150 horas de docencia' }],
    idx,
  );
  const inventada = await comprobarCitas(
    db,
    raices,
    ID,
    [{ documento: 'PCAP.pdf', pagina: 11, texto: 'Se exige la certificación ISO 9001 vigente a la fecha' }],
    idx,
  );
  assert.deepEqual(bien, []);
  assert.match(pagina[0] ?? '', /está en la página 2 .*no en la 1/);
  assert.match(inventada[0] ?? '', /no está en «PCAP\.pdf»: copia la frase literal/);
});

test('should_show_each_ficha_requirement_with_its_quote_checked_in_the_tender_detail', async () => {
  // Arrange: una ficha aprobada con un requisito citado literal y otro con la cita resumida.
  const { detalle } = await import('../../src/dominios/licitaciones/oportunidades.js');
  const requisito = (descripcion: string, cita: string) => ({
    tipo: 'medios_personales',
    descripcion,
    excluyente: true,
    cumple: 'dudoso',
    justificacion: 'Falta el CV.',
    documento: 'PPT.pdf',
    pagina: 1,
    cita,
  });
  const datos = {
    resumen: 'Formación en inteligencia artificial para personal técnico.',
    criterios: [],
    documentacion: [],
    hitos: [],
    garantias: [],
    penalizaciones: [],
    riesgos: [],
    recomendacion: { decision: 'revisar', motivo: 'Comprobar el docente.' },
    requisitos: [
      requisito('Docente con 150 h de IA', 'El docente acreditará al menos 150 horas de docencia'),
      requisito('Docente con titulación', 'El docente será licenciado en informática'),
    ],
  };
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en, version_prompt) VALUES (?, 'aprobada', ?, 'licitaciones', ?, ?, ?, 1)",
  ).run(ID, JSON.stringify(datos), ts, ts, ts);
  // Act
  const d = detalle(db, ID, new Date(), idx);
  // Assert
  assert.equal(d.error, null);
  assert.deepEqual(
    d.data!.citas_requisitos.map((c) => [c?.estado, c?.pagina ?? null]),
    [
      ['comprobada', 2],
      ['no_localizada', null],
    ],
  );
});

// Una licitación sintética con sus pliegos descargados e indexados (en orden de ruta, como se leen).
function licitacionConPliegos(
  id: string,
  archivos: { ruta: string; trozos: { page: number | null; text: string }[] }[],
) {
  guardarLicitacion(db, {
    ...licitacion({ titulo: 'Plataforma', publicada: '2026-10-01' }),
    id,
    atom_id: `atom-${id}`,
  });
  for (const a of archivos) {
    indice.reemplazarArchivo(
      idx,
      {
        path: a.ruta,
        kind: 'document',
        title: path.posix.basename(a.ruta),
        mtime_ms: 1,
        size: 1,
        pages: a.trozos.length,
        status: 'ok',
        error: null,
        source: null,
      },
      a.trozos,
    );
    db.prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, intentos, actualizado_en) VALUES (?, ?, 'ppt', ?, 'descargado', ?, 0, ?)",
    ).run(id, a.ruta, path.posix.basename(a.ruta), a.ruta, ts);
  }
}

const carpeta = (id: string) => `Licitaciones/Ofertas/EXP-${id} (${id})/Pliegos`;

test('should_find_a_quote_even_when_more_than_30_chunks_match_its_words_better', () => {
  // Arrange: 40 trozos densos en las palabras largas de la cita y la cita literal una sola vez en el 41.
  const ID_RUIDO = 'p-60000002';
  // Todas las palabras de la cita, repetidas y desordenadas: casan mejor por bm25 pero no literal.
  const ruido =
    'norma UNE cumplirá la de accesible teleformación plataforma UNE norma cumplirá accesible plataforma teleformación';
  licitacionConPliegos(ID_RUIDO, [
    {
      ruta: `${carpeta(ID_RUIDO)}/PPT.pdf`,
      trozos: [
        ...Array.from({ length: 40 }, (_, i) => ({ page: i + 1, text: `${ruido} ${i}` })),
        {
          page: 41,
          text: 'Requisitos técnicos del servicio. La plataforma de teleformación accesible cumplirá la norma UNE 139803 durante todo el contrato y en cada una de sus prórrogas.',
        },
      ],
    },
  ]);
  // Act
  const r = comprobadorDe(db, idx, ID_RUIDO)('la plataforma de teleformación accesible cumplirá la norma UNE');
  // Assert
  assert.deepEqual(r, { estado: 'comprobada', documento: `${carpeta(ID_RUIDO)}/PPT.pdf`, pagina: 41 });
});

test('should_give_the_first_appearance_in_reading_order_for_a_repeated_quote', () => {
  // Arrange: la frase en A (página 2, trozo largo) y en B (página 9, trozo corto que bm25 pone primero).
  const ID_REP = 'p-60000003';
  const frase = 'el adjudicatario designará un coordinador técnico del contrato';
  licitacionConPliegos(ID_REP, [
    {
      ruta: `${carpeta(ID_REP)}/A-PCAP.pdf`,
      trozos: [
        { page: 1, text: 'Cláusula 1. Objeto.' },
        {
          page: 2,
          text: `Cláusula 14. Organización del servicio, medios materiales y personales: ${frase}, que será el interlocutor con la administración durante la ejecución y responderá de la calidad de los trabajos entregados.`,
        },
      ],
    },
    { ruta: `${carpeta(ID_REP)}/B-PPT.pdf`, trozos: [{ page: 9, text: frase }] },
  ]);
  // Act
  const r = comprobadorDe(db, idx, ID_REP)(frase);
  // Assert
  assert.deepEqual(r, { estado: 'comprobada', documento: `${carpeta(ID_REP)}/A-PCAP.pdf`, pagina: 2 });
});

test('should_not_join_chunks_of_different_documents', () => {
  // Arrange
  const ID_CRUCE = 'p-60000004';
  licitacionConPliegos(ID_CRUCE, [
    { ruta: `${carpeta(ID_CRUCE)}/A.pdf`, trozos: [{ page: 1, text: 'Texto de cierre: final del documento primero' }] },
    { ruta: `${carpeta(ID_CRUCE)}/B.pdf`, trozos: [{ page: 1, text: 'principio del documento segundo y sigue' }] },
  ]);
  // Act / Assert
  assert.equal(
    comprobadorDe(db, idx, ID_CRUCE)('final del documento primero principio del documento segundo').estado,
    'no_localizada',
  );
});

test('should_check_a_quote_in_a_chunk_without_page_with_page_null', () => {
  // Arrange: un .docx no tiene páginas en el índice.
  const ID_DOCX = 'p-60000005';
  licitacionConPliegos(ID_DOCX, [
    {
      ruta: `${carpeta(ID_DOCX)}/Anexo.docx`,
      trozos: [{ page: null, text: 'El licitador aportará una declaración responsable firmada.' }],
    },
  ]);
  // Act / Assert
  assert.deepEqual(comprobadorDe(db, idx, ID_DOCX)('aportará una declaración responsable firmada'), {
    estado: 'comprobada',
    documento: `${carpeta(ID_DOCX)}/Anexo.docx`,
    pagina: null,
  });
});

test('should_say_not_found_for_an_empty_quote_or_only_an_ellipsis', () => {
  assert.equal(comprobar('').estado, 'no_localizada');
  assert.equal(comprobar('…').estado, 'no_localizada');
});

test('should_read_the_pliegos_once_per_checker_and_not_search_per_quote', () => {
  // Arrange: contar las sentencias que pide el comprobador al índice.
  const original = idx.prepare.bind(idx);
  const sql: string[] = [];
  idx.prepare = ((s: string) => {
    sql.push(s);
    return original(s);
  }) as typeof idx.prepare;
  try {
    // Act
    const c = comprobadorDe(db, idx, ID);
    for (let i = 0; i < 20; i++) c(`al menos 150 horas de docencia ${i % 2 ? '' : 'en inteligencia artificial'}`);
  } finally {
    idx.prepare = original;
  }
  // Assert
  assert.equal(sql.filter((s) => s.includes('MATCH')).length, 0, 'ninguna búsqueda FTS por cita');
  assert.equal(sql.filter((s) => /FROM chunks c JOIN files/.test(s)).length, 1, 'una sola lectura de los trozos');
});

test('should_accept_a_bloqueo_quote_on_a_later_page_when_the_pliego_repeats_it', async () => {
  // Arrange: el PCAP repite la frase en las páginas 2 y 9; Hermes cita la 9, que también es correcta.
  const ID_PAG = 'p-60000006';
  const frase = 'la garantía definitiva será del cinco por ciento del precio de adjudicación';
  licitacionConPliegos(ID_PAG, [
    {
      ruta: `${carpeta(ID_PAG)}/PCAP.pdf`,
      trozos: [
        { page: 2, text: `Resumen de condiciones: ${frase}.` },
        { page: 9, text: `Cláusula 21. Garantías: ${frase}, excluido el IVA.` },
      ],
    },
  ]);
  // Act
  const nueve = await comprobarCitas(
    db,
    {} as Raices,
    ID_PAG,
    [{ documento: 'PCAP.pdf', pagina: 9, texto: frase }],
    idx,
  );
  const cinco = await comprobarCitas(
    db,
    {} as Raices,
    ID_PAG,
    [{ documento: 'PCAP.pdf', pagina: 5, texto: frase }],
    idx,
  );
  // Assert
  assert.deepEqual(nueve, []);
  assert.match(cinco[0] ?? '', /está en la página 2 .*no en la 5/);
});
