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
