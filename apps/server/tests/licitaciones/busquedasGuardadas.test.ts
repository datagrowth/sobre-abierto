// Búsquedas guardadas: se guardan con la forma de la lista de Oportunidades,
// son de cada persona y sus «nuevas» son las que entraron en Por revisar desde entonces y la cumplen.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'busquedas-'));
process.env.PLATAFORMA_DATA_DIR = tmp;
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const b = await import('../../src/dominios/licitaciones/busquedasGuardadas.js');

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-23T10:00:00Z');
function llega(id: string, titulo: string, cuando: string, nuts = 'ES705') {
  const l = licitacion({ titulo, publicada: '2026-10-01', limite: '2026-12-01T14:00:00', nuts, presupuesto: 50_000 });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}` });
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, creada_en, actualizada_en) VALUES (?, 'nueva', 'interesa', ?, ?)",
  ).run(id, cuando, cuando);
}
llega('p-80001', 'Formación en inteligencia artificial', '2026-10-10T08:00:00.000Z');
llega('p-80002', 'Formación en Power BI', '2026-10-21T08:00:00.000Z');
llega('p-80003', 'Formación en ofimática', '2026-10-22T08:00:00.000Z', 'ES300');
llega('p-80004', 'Mantenimiento de ascensores', '2026-10-22T09:00:00.000Z');

const ELISA = 2,
  PACO = 1;

test('should_save_a_search_with_the_list_filters_and_reject_filters_that_do_not_exist', () => {
  const r = b.guardarBusqueda(db, ELISA, {
    nombre: 'Formación en Canarias',
    consulta: { texto: 'formación', comunidad: 'ES70' },
    frecuencia: 'diaria',
  });
  assert.equal(r.error, null);
  assert.deepEqual(
    [r.data!.frecuencia, r.data!.activa, r.data!.consulta],
    ['diaria', true, { texto: 'formación', comunidad: 'ES70' }],
  );
  assert.equal(
    b.guardarBusqueda(db, ELISA, { nombre: 'Mal', consulta: { comunidad: 'Canarias' } }).error?.code,
    'invalid_input',
  );
  assert.equal(
    b.guardarBusqueda(db, ELISA, { nombre: 'Mal', consulta: { pestana: 'descartadas' } }).error?.code,
    'invalid_input',
    'la pestaña no se guarda',
  );
  assert.equal(
    b.guardarBusqueda(db, ELISA, { nombre: 'x', consulta: {} }).error?.code,
    'invalid_input',
    'nombre de dos letras al menos',
  );
});

test('should_keep_each_persons_searches_to_themselves', () => {
  const r = b.guardarBusqueda(db, ELISA, { nombre: 'Solo mía', consulta: { texto: 'power' } });
  assert.ok(!b.busquedasDe(db, PACO).some((x) => x.id === r.data!.id));
  assert.equal(b.cambiarBusqueda(db, PACO, r.data!.id, { nombre: 'De otro' }).error?.code, 'not_found');
  assert.equal(b.borrarBusqueda(db, PACO, r.data!.id).error?.code, 'not_found');
  assert.equal(b.cambiarBusqueda(db, ELISA, r.data!.id, { frecuencia: 'diaria', activa: false }).data?.activa, false);
  assert.deepEqual(b.borrarBusqueda(db, ELISA, r.data!.id).data, { id: r.data!.id });
});

test('should_bring_only_what_arrived_since_then_and_matches_the_search', () => {
  // Act
  const r = b.nuevasDeBusqueda(
    db,
    { consulta: { texto: 'formación', comunidad: 'ES70' } },
    '2026-10-20T00:00:00.000Z',
    AHORA,
  );
  // Assert: p-80001 llegó antes, p-80003 es de otra comunidad y p-80004 no es formación.
  assert.deepEqual(
    r.items.map((x) => x.id),
    ['p-80002'],
  );
  assert.equal(r.total, 1);
});

test('should_count_the_new_ones_of_each_search_in_the_last_days', () => {
  const r = b.guardarBusqueda(db, PACO, {
    nombre: 'Formación',
    consulta: { texto: 'formación' },
    frecuencia: 'semanal',
  });
  const lista = b.busquedasConNuevas(db, PACO, 7, AHORA);
  assert.equal(lista.find((x) => x.id === r.data!.id)?.nuevas, 2, 'p-80002 y p-80003, de esta semana');
});
