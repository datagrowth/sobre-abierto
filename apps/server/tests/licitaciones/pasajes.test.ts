// Pasajes por tema de los pliegos de una licitación: con un pliego de texto realista
// indexado como lo hace la Biblioteca (sin PDF ni modelo de embeddings), cada tema encuentra
// su cláusula con documento y página, y las filas del cuadro de características siguen
// siendo líneas.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import * as indice from '../../src/biblioteca/motor/documentos/almacen.js';
import { trocearPaginas } from '../../src/biblioteca/motor/documentos/trozos.js';
import {
  largoDePasaje,
  pasajesDeLicitacion,
  type OpcionesPasajes,
  type Semantica,
} from '../../src/dominios/licitaciones/pasajes.js';
import { TEMAS_CHECKLIST, TEMAS_FICHA, TEMAS_MEMORIA, type Tema } from '../../src/dominios/licitaciones/temas.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const PLIEGO = JSON.parse(fs.readFileSync(path.join(FIX, 'pliego-texto.json'), 'utf8')) as Record<string, string[]>;
const CARPETA = 'Licitaciones/Radar/2026/2026-034730 (p-1)';
const CLASE: Record<string, string> = { 'PCAP.pdf': 'pcap', 'PPT.pdf': 'ppt', 'Anexo I cuadro.pdf': 'adicional' };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pasajes-'));
const idx = indice.abrirIndice(tmp);
const lic = new Database(':memory:');
after(() => {
  idx.close();
  lic.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

lic.exec(`CREATE TABLE licitaciones (id TEXT PRIMARY KEY);
  CREATE TABLE pliegos (licitacion_id TEXT, ruta TEXT, clase TEXT, estado TEXT)`);
lic.prepare("INSERT INTO licitaciones (id) VALUES ('p-1'), ('p-sin'), ('p-rota'), ('p-largo')").run();
for (const [nombre, paginas] of Object.entries(PLIEGO)) {
  const ruta = `${CARPETA}/${nombre}`;
  indice.reemplazarArchivo(
    idx,
    {
      path: ruta,
      kind: 'document',
      title: nombre,
      mtime_ms: 1,
      size: 1,
      pages: paginas.length,
      status: 'ok',
      error: null,
      source: null,
    },
    trocearPaginas(paginas, true),
  );
  lic.prepare("INSERT INTO pliegos VALUES ('p-1', ?, ?, 'descargado')").run(ruta, CLASE[nombre]);
}
indice.reemplazarArchivo(
  idx,
  {
    path: `${CARPETA}/roto.pdf`,
    kind: 'document',
    title: 'roto',
    mtime_ms: 1,
    size: 1,
    pages: null,
    status: 'error',
    error: 'PDF dañado',
    source: null,
  },
  [],
);
lic
  .prepare("INSERT INTO pliegos VALUES ('p-1', ?, 'adicional', 'descargado'), ('p-rota', ?, 'pcap', 'descargado')")
  .run(`${CARPETA}/roto.pdf`, `${CARPETA}/roto.pdf`);

const sinSemantica: Semantica = async () => [];
const buscar = (temas: OpcionesPasajes['temas'], semantica = sinSemantica) =>
  pasajesDeLicitacion(lic, 'p-1', { temas, semantica }, idx);
const tema = async (t: Tema) => (await buscar([t])).data!.temas[0]!;

test('should_find_the_economic_solvency_clause_with_its_page_and_the_table_row', async () => {
  const t = await tema('solvencia_economica');
  assert.equal(t.encontrado, true);
  assert.ok(t.pasajes.some((p) => p.ruta.endsWith('PCAP.pdf') && p.pagina === 8 && /363\.454,00/.test(p.texto)));
  assert.ok(
    t.pasajes.some((p) => p.ruta.endsWith('Anexo I cuadro.pdf')),
    'también la fila del cuadro de características',
  );
});

test('should_keep_each_row_of_the_characteristics_table_on_its_own_line', async () => {
  const fila = (await tema('subcontratacion')).pasajes.find((p) => p.ruta.endsWith('Anexo I cuadro.pdf'));
  assert.ok(fila);
  assert.ok(fila.texto.split('\n').includes('Subcontratación No se admite'), 'la fila no se mezcla con las demás');
});

test('should_find_the_team_in_the_technical_specifications', async () => {
  const t = await tema('medios_personales');
  assert.equal(t.pasajes[0]?.ruta.endsWith('PPT.pdf'), true);
  assert.equal(t.pasajes[0]?.pagina, 3);
});

test('should_find_the_new_company_exception_and_the_place_of_work', async () => {
  assert.equal((await tema('nueva_creacion')).pasajes[0]?.pagina, 9);
  assert.match((await tema('lugar_ejecucion')).pasajes[0]?.texto ?? '', /en remoto/);
});

test('should_say_when_no_document_talks_about_a_topic', async () => {
  const r = (await buscar(['ute', 'habilitacion'])).data!;
  assert.deepEqual(r.sin_pasajes, ['ute', 'habilitacion']);
  assert.ok(r.temas.every((t) => !t.encontrado && t.pasajes.length === 0));
});

test('should_include_a_passage_found_only_by_meaning', async () => {
  const objeto = indice.trozosDeRutas(idx, [`${CARPETA}/PCAP.pdf`]).find((c) => c.page === 3)!;
  const semantica: Semantica = async (_t, _k, ids) => (ids.includes(objeto.id) ? [{ id: objeto.id, score: 0.9 }] : []);
  const t = (await buscar(['ute'], semantica)).data!.temas[0]!;
  assert.equal(t.pasajes[0]?.pagina, 3, 'sin marcas, entra si sale arriba en una búsqueda');
});

test('should_list_unreadable_documents_and_skip_them', async () => {
  const r = (await buscar(['garantias'])).data!;
  assert.equal(r.documentos.find((d) => d.ruta.endsWith('roto.pdf'))?.estado_indice, 'error');
  assert.match(r.aviso ?? '', /roto\.pdf \(PDF dañado\)/);
  assert.ok(r.temas[0]!.pasajes.every((p) => !p.ruta.endsWith('roto.pdf')));
});

// Un PPT con una página de tres párrafos (tres trozos del índice) y otra página detrás.
const PARRAFO = (n: number) =>
  `Párrafo ${n}. ${'El adjudicatario realizará la atención a las personas usuarias, el registro de cada consulta y su seguimiento hasta el cierre. '.repeat(7)}`.slice(
    0,
    900,
  );
const PPT_LARGO = 'Licitaciones/Radar/2026/2026-1 (p-largo)/PPT.pdf';
indice.reemplazarArchivo(
  idx,
  {
    path: PPT_LARGO,
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
    [`Prestaciones del servicio. ${PARRAFO(1)}\n\n${PARRAFO(2)}\n\n${PARRAFO(3)}`, `Página siguiente. ${PARRAFO(4)}`],
    true,
  ),
);
lic.prepare("INSERT INTO pliegos VALUES ('p-largo', ?, 'ppt', 'descargado')").run(PPT_LARGO);

test('should_extend_a_passage_with_what_follows_on_the_same_page_up_to_its_length', async () => {
  const pasaje = async (maxCaracteres?: number) =>
    (
      await pasajesDeLicitacion(
        lic,
        'p-largo',
        { temas: ['prestaciones'], semantica: sinSemantica, ...(maxCaracteres ? { maxCaracteres } : {}) },
        idx,
      )
    ).data!.temas[0]!.pasajes[0]!;
  const largo = await pasaje();
  assert.equal(largo.pagina, 1);
  assert.match(
    largo.texto,
    /^Prestaciones del servicio\. Párrafo 1\.[\s\S]*Párrafo 2\.[\s\S]*Párrafo 3\./,
    'los tres párrafos de la página, enteros y en orden',
  );
  assert.ok(largo.texto.length <= 3000);
  assert.doesNotMatch(
    largo.texto,
    /Página siguiente/,
    'no pasa de página: la página del pasaje vale para todo su texto',
  );
  const corto = await pasaje(1000);
  assert.doesNotMatch(corto.texto, /Párrafo 2\./, 'con un largo menor, solo el trozo que casa');
});

test('should_shorten_passages_when_many_topics_are_asked_so_the_answer_fits', () => {
  assert.equal(largoDePasaje(3000, 11, 2), 3000, 'los temas del redactor caben enteros');
  assert.equal(
    largoDePasaje(4000, TEMAS_FICHA.length, 4),
    Math.floor(120_000 / (TEMAS_FICHA.length * 4)),
    'la ficha, todos sus temas: se acortan',
  );
  assert.equal(largoDePasaje(3000, 100, 10), 1200, 'nunca menos de un trozo del índice');
  assert.equal(largoDePasaje(500, 1, 1), 500);
});

test('should_read_only_the_sheet_topics_when_none_are_asked_and_keep_the_checklist', async () => {
  const r = (await pasajesDeLicitacion(lic, 'p-1', { semantica: sinSemantica }, idx)).data!;
  assert.deepEqual(
    r.temas.map((t) => t.tema),
    TEMAS_FICHA,
  );
  assert.ok(
    TEMAS_MEMORIA.every((t) => !TEMAS_FICHA.includes(t) && !TEMAS_CHECKLIST.includes(t)),
    'los de la memoria no cambian la cobertura de la ficha',
  );
  assert.equal(TEMAS_CHECKLIST.length, 12);
});

test('should_find_the_scope_service_levels_and_training_for_the_memoria', async () => {
  const r = (await buscar(['objeto_alcance', 'niveles_servicio', 'formacion_transferencia'])).data!;
  const paginas = (t: Tema, doc: string) =>
    r.temas
      .find((x) => x.tema === t)!
      .pasajes.filter((p) => p.ruta.endsWith(doc))
      .map((p) => p.pagina);
  assert.ok(paginas('objeto_alcance', 'PCAP.pdf').includes(3), 'la cláusula del objeto');
  assert.ok(paginas('objeto_alcance', 'PPT.pdf').includes(2), 'el alcance técnico');
  assert.ok(paginas('niveles_servicio', 'PCAP.pdf').includes(13), 'los acuerdos de nivel de servicio');
  assert.ok(paginas('formacion_transferencia', 'PPT.pdf').includes(4), 'manuales y formación');
});

test('should_explain_why_there_are_no_passages', async () => {
  assert.equal((await pasajesDeLicitacion(lic, 'p-sin', {}, idx)).error?.code, 'sin_pliegos');
  assert.equal((await pasajesDeLicitacion(lic, 'p-rota', {}, idx)).error?.code, 'ilegible');
  assert.equal((await pasajesDeLicitacion(lic, 'p-1', {}, null)).error?.code, 'no_indexado');
  assert.equal((await pasajesDeLicitacion(lic, 'p-nada', {}, idx)).error?.code, 'not_found');
});
