// Búsqueda de texto: FTS5 sobre título, órgano, expediente y lotes, sin acentos y
// por principio de palabra; los pliegos descargados en el índice de la Biblioteca; GET /buscar con
// sus agregados; y la lista de Oportunidades que busca igual.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'buscador-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { cargarVocabularioCpv } = await import('../../src/dominios/licitaciones/clasificacion.js');
const b = await import('../../src/dominios/licitaciones/buscador.js');
const { FiltroRevision, listaRevision } = await import('../../src/dominios/licitaciones/revision.js');
const indice = await import('../../src/biblioteca/motor/documentos/almacen.js');
const { trocearPaginas } = await import('../../src/biblioteca/motor/documentos/trozos.js');

iniciarNucleo();
const db = dbLicitaciones();
cargarVocabularioCpv(db);
const idx = indice.abrirIndice(path.join(tmp, 'indice'));
after(() => {
  idx.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-23T10:00:00Z');
const ts = new Date(AHORA).toISOString();
function guardar(id: string, s: Parameters<typeof licitacion>[0], extra: { cpvs?: string[]; estado?: string } = {}) {
  const l = licitacion(s);
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}`, expediente: `EXP-${id}`, cpvs: extra.cpvs ?? l.cpvs });
  if (extra.estado)
    db.prepare(
      "INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, creada_en, actualizada_en) VALUES (?, ?, 'interesa', ?, ?)",
    ).run(id, extra.estado, ts, ts);
}
guardar(
  'p-1',
  {
    titulo: 'Formación en inteligencia artificial generativa',
    publicada: '2026-10-01',
    limite: '2026-11-10T14:00:00',
    presupuesto: 48_000,
    nuts: 'ES705',
    lotes: [{ id: '1', nombre: 'Power BI para técnicos', importe: 16_000 }],
  },
  { cpvs: ['80500000'], estado: 'nueva' },
);
guardar(
  'p-2',
  {
    titulo: 'Cuadros de mando de movilidad',
    publicada: '2026-10-02',
    limite: '2026-11-12T14:00:00',
    presupuesto: 120_000,
    nuts: 'ES300',
  },
  { cpvs: ['72000000'], estado: 'nueva' },
);
guardar(
  'p-3',
  {
    titulo: 'Mantenimiento de climatización',
    publicada: '2026-10-03',
    limite: '2026-11-15T14:00:00',
    presupuesto: 41_000,
    nuts: 'ES705',
  },
  { cpvs: ['50700000'], estado: 'nueva' },
);
guardar(
  'p-4',
  { titulo: 'Formación en ofimática', publicada: '2020-01-01', limite: '2020-02-01T14:00:00', presupuesto: 10_000 },
  { cpvs: ['80500000'] },
);
// El pliego de p-3 menciona la inteligencia artificial: solo se encuentra buscando en los pliegos.
const RUTA = 'Licitaciones/Radar/2026/p-3/PPT.pdf';
indice.reemplazarArchivo(
  idx,
  {
    path: RUTA,
    kind: 'document',
    title: 'PPT',
    mtime_ms: 1,
    size: 1,
    pages: 2,
    status: 'ok',
    error: null,
    source: null,
  },
  trocearPaginas(
    ['Objeto: mantenimiento de equipos.', 'Se valorará el uso de inteligencia artificial para predecir averías.'],
    true,
  ),
);
db.prepare(
  "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, intentos, actualizado_en) VALUES ('p-3', 'u', 'ppt', 'PPT', 'descargado', ?, 0, ?)",
).run(RUTA, ts);

const consulta = (q: Record<string, string>) => b.Busqueda.parse(q);

test('should_build_an_fts_query_with_every_word_as_a_prefix_and_nothing_else', () => {
  assert.equal(b.consultaFts('Formación en IA'), '"formación"* AND "en"* AND "ia"*');
  assert.equal(b.consultaFts('EXP-2026-0417'), '"exp"* AND "2026"* AND "0417"*');
  assert.equal(b.consultaFts('" OR 1=1 --'), '"or"* AND "1"*', 'comillas y operadores no llegan a FTS5');
  assert.equal(b.consultaFts('—'), null);
});

test('should_find_by_title_lot_or_file_number_without_accents_and_by_the_start_of_words', () => {
  const ids = (q: string) =>
    (
      db.prepare('SELECT id FROM licitaciones WHERE rowid IN (' + b.rowidsPorTexto(db, q).join(',') + ')').all() as {
        id: string;
      }[]
    )
      .map((f) => f.id)
      .sort();
  assert.deepEqual(ids('formacion'), ['p-1', 'p-4']);
  assert.deepEqual(ids('intelig artif'), ['p-1']);
  assert.deepEqual(ids('power bi'), ['p-1'], 'el título de un lote');
  assert.deepEqual(ids('EXP-p-2'), ['p-2']);
});

test('should_backfill_the_index_with_what_was_saved_before', () => {
  db.exec('DELETE FROM busca_texto');
  assert.deepEqual(b.rowidsPorTexto(db, 'movilidad'), []);
  b.rellenarBuscador(db);
  assert.equal(b.rowidsPorTexto(db, 'movilidad').length, 1);
});

test('should_give_a_prefix_as_a_text_range', () => {
  assert.deepEqual(b.rangoPrefijo('72'), ['72', '73']);
  assert.deepEqual(b.rangoPrefijo('79'), ['79', '7:'], 'después del 9 va «:», que ordena tras todas las cifras');
});

test('should_search_only_opportunities_by_default_and_everything_on_request_with_aggregates', () => {
  // Act
  const ops = b.buscar(db, consulta({ q: 'formación' }), null, AHORA);
  const todas = b.buscar(db, consulta({ q: 'formación', ambito: 'todas' }), null, AHORA);
  // Assert
  assert.deepEqual(
    ops.items.map((x) => x.id),
    ['p-1'],
  );
  assert.deepEqual(todas.items.map((x) => x.id).sort(), ['p-1', 'p-4']);
  assert.equal(todas.agregados.abiertas, 1);
  assert.deepEqual(todas.agregados.por_estado, [
    { clave: 'nueva', n: 1 },
    { clave: 'sin_oportunidad', n: 1 },
  ]);
  assert.deepEqual(
    todas.agregados.por_division.map((d) => [d.clave, d.n]),
    [['80', 2]],
  );
  assert.match(todas.agregados.por_division[0]!.descripcion ?? '', /enseñanza/i);
  assert.equal(todas.agregados.importe.n, 2);
});

test('should_filter_by_cpv_prefix_community_and_amount', () => {
  const r = (q: Record<string, string>) =>
    b
      .buscar(db, consulta({ q: 'formación', ambito: 'todas', ...q }), null, AHORA)
      .items.map((x) => x.id)
      .sort();
  assert.deepEqual(r({ cpv: '805' }), ['p-1', 'p-4']);
  assert.deepEqual(r({ cpv: '72' }), []);
  assert.deepEqual(r({ comunidad: 'ES70' }), ['p-1']);
  assert.deepEqual(r({ importe_min: '20000' }), ['p-1']);
  assert.deepEqual(r({ abiertas: '1' }), ['p-1']);
});

test('should_find_in_the_downloaded_pliegos_with_document_page_and_fragment', () => {
  // Act
  const sinPliegos = b.buscar(db, consulta({ q: 'inteligencia artificial' }), idx, AHORA);
  const conPliegos = b.buscar(db, consulta({ q: 'inteligencia artificial', pliegos: '1' }), idx, AHORA);
  // Assert
  assert.deepEqual(
    sinPliegos.items.map((x) => x.id),
    ['p-1'],
  );
  assert.deepEqual(
    conPliegos.items.map((x) => x.id),
    ['p-1', 'p-3'],
    'primero lo que casa en el título',
  );
  const p3 = conPliegos.items[1]!;
  assert.equal(p3.en_titulo, false);
  assert.deepEqual([p3.en_pliego?.documento, p3.en_pliego?.pagina, p3.en_pliego?.clase], [RUTA, 2, 'ppt']);
  assert.match(p3.en_pliego?.texto ?? '', /inteligencia artificial/);
  assert.equal(conPliegos.pliegos_buscados, true);
});

test('should_search_the_opportunities_list_the_same_way_and_in_pliegos_on_request', () => {
  const lista = (q: Record<string, string>) =>
    listaRevision(db, FiltroRevision.parse({ pestana: 'por_revisar', ...q }), AHORA, idx);
  assert.deepEqual(
    lista({ texto: 'formacion' }).items.map((x) => x.id),
    ['p-1'],
    'sin acento también',
  );
  assert.deepEqual(
    lista({ texto: 'inteligencia artificial' }).items.map((x) => x.id),
    ['p-1'],
  );
  const conPliegos = lista({ texto: 'inteligencia artificial', pliegos: '1' });
  assert.deepEqual(
    conPliegos.items.map((x) => x.id),
    ['p-1', 'p-3'],
  );
  assert.equal(
    conPliegos.items.find((x) => x.id === 'p-1')!.en_pliego,
    null,
    'si casa en el título no se repite el pliego',
  );
  assert.equal(conPliegos.items.find((x) => x.id === 'p-3')!.en_pliego?.pagina, 2);
  assert.equal(lista({ texto: '—' }).total, 3, 'un texto sin palabras no filtra');
});
