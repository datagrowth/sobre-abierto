// CPV y lotes en tablas: el vocabulario oficial con su jerarquía, las filas
// de licitacion_cpv y lotes que deja cada licitación guardada y el relleno de lo que ya había.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clasificacion-'));
process.env.PLATAFORMA_DATA_DIR = tmp;
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const c = await import('../../src/dominios/licitaciones/clasificacion.js');
const { CPV_2008 } = await import('../../src/dominios/licitaciones/cpv.js');

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type FilaCpv = { lote: string; cpv: string; principal: number };
const cpvsDe = (id: string) =>
  db
    .prepare(
      'SELECT lote, cpv, principal FROM licitacion_cpv WHERE licitacion_id = ? ORDER BY lote, principal DESC, cpv',
    )
    .all(id) as FilaCpv[];
const lotesDe = (id: string) =>
  db
    .prepare(
      'SELECT numero, titulo, presupuesto_sin_iva, valor_estimado, cpvs FROM lotes WHERE licitacion_id = ? ORDER BY numero',
    )
    .all(id);

// Dos lotes: el 1 con CPV propios y el 2 sin ellos (hereda los del contrato).
function conLotes(id: string) {
  const l = licitacion({
    titulo: 'Formación en IA y en datos',
    publicada: '2026-10-01',
    lotes: [
      { id: '1', nombre: 'IA generativa', importe: 32_000 },
      { id: '2', nombre: 'Power BI', importe: 16_000 },
    ],
  });
  return {
    ...l,
    id,
    atom_id: `atom-${id}`,
    cpvs: ['80500000', '72267000'],
    lotes: [{ ...l.lotes[0]!, cpvs: ['80530000'], valor_estimado: 38_000 }, l.lotes[1]!],
  };
}

test('should_give_the_level_by_significant_digits_from_division_to_8', () => {
  assert.equal(c.nivelCpv('72000000'), 2);
  assert.equal(c.nivelCpv('03000000'), 2, 'la división 03 no pierde el cero de delante');
  assert.equal(c.nivelCpv('72410000'), 4);
  assert.equal(c.nivelCpv('72267000'), 5);
  assert.equal(c.nivelCpv('03111100'), 6);
  assert.equal(c.nivelCpv('45233141'), 8);
});

test('should_climb_to_the_nearest_existing_parent_when_a_level_is_missing', () => {
  const existen = new Set(['72000000', '72400000']);
  assert.equal(
    c.padreCpv('72410000', (x) => existen.has(x)),
    '72400000',
  );
  assert.equal(
    c.padreCpv('72411000', (x) => existen.has(x)),
    '72400000',
    'sin 72410000 sube un nivel más',
  );
  assert.equal(
    c.padreCpv('72000000', (x) => existen.has(x)),
    null,
    'la división no tiene padre',
  );
});

test('should_load_the_official_vocabulary_once_with_its_hierarchy_in_spanish', () => {
  // Act
  const primera = c.cargarVocabularioCpv(db);
  const segunda = c.cargarVocabularioCpv(db);
  // Assert
  assert.equal(primera, CPV_2008.length);
  assert.equal(segunda, 0, 'con la tabla entera no se vuelve a escribir');
  const f = db.prepare('SELECT descripcion, nivel, padre FROM cpv WHERE codigo = ?').get('72410000') as {
    descripcion: string;
    nivel: number;
    padre: string;
  };
  assert.deepEqual([f.nivel, f.padre], [4, '72400000']);
  assert.match(f.descripcion, /proveedor/i);
  const sinPadre = db.prepare('SELECT COUNT(*) AS n FROM cpv WHERE nivel > 2 AND padre IS NULL').get() as { n: number };
  assert.equal(sinPadre.n, 0, 'todo código por debajo de la división cuelga de otro');
});

test('should_describe_the_prefilter_prefixes_with_the_official_text', () => {
  c.cargarVocabularioCpv(db);
  const [it, formacion, raro] = c.describirCpvs(db, ['72', '80', '99']);
  assert.deepEqual([it!.codigo, it!.nivel], ['72000000', 2]);
  assert.match(it!.descripcion ?? '', /^Servicios TI/);
  assert.match(formacion!.descripcion ?? '', /enseñanza|formación/i);
  assert.equal(raro!.descripcion, null, 'un prefijo que no está en el vocabulario sale sin texto');
});

test('should_offer_the_codes_starting_with_the_digits_general_ones_first', () => {
  c.cargarVocabularioCpv(db);
  // Act
  const r = c.buscarCpv(db, '72');
  // Assert
  assert.equal(r.length, 20);
  assert.deepEqual([r[0]!.codigo, r[0]!.prefijo], ['72000000', '72']);
  assert.ok(r.every((x) => x.codigo.startsWith('72')));
  assert.equal(r[1]!.nivel, 3, 'tras la división, sus grupos');
  assert.equal(c.buscarCpv(db, '7226')[0]!.prefijo, '7226');
});

test('should_find_codes_by_words_of_the_description_and_take_wildcards_literally', () => {
  c.cargarVocabularioCpv(db);
  const r = c.buscarCpv(db, 'estadístic');
  assert.ok(
    r.some((x) => x.codigo === '79330000'),
    'servicios estadísticos',
  );
  assert.ok(
    c.buscarCpv(db, '%').every((x) => (x.descripcion ?? '').includes('%')),
    '«%» no es un comodín',
  );
  assert.deepEqual(c.buscarCpv(db, '_'), []);
  assert.deepEqual(c.buscarCpv(db, '99'), []);
});

test('should_write_contract_and_lot_cpvs_and_the_lots_when_a_tender_is_saved', () => {
  // Act
  guardarLicitacion(db, conLotes('p-50000001'));
  // Assert
  assert.deepEqual(cpvsDe('p-50000001'), [
    { lote: '', cpv: '80500000', principal: 1 },
    { lote: '', cpv: '72267000', principal: 0 },
    { lote: '1', cpv: '80530000', principal: 1 },
  ]);
  assert.deepEqual(lotesDe('p-50000001'), [
    { numero: '1', titulo: 'IA generativa', presupuesto_sin_iva: 32_000, valor_estimado: 38_000, cpvs: ',80530000,' },
    { numero: '2', titulo: 'Power BI', presupuesto_sin_iva: 16_000, valor_estimado: null, cpvs: '' },
  ]);
});

test('should_replace_the_rows_when_a_new_version_drops_a_lot', () => {
  const l = conLotes('p-50000002');
  guardarLicitacion(db, l);
  guardarLicitacion(db, { ...l, actualizada_en: '2026-10-05T10:00:00Z', cpvs: ['80500000'], lotes: [l.lotes[1]!] });
  assert.deepEqual(cpvsDe('p-50000002'), [{ lote: '', cpv: '80500000', principal: 1 }]);
  assert.deepEqual(
    (lotesDe('p-50000002') as { numero: string }[]).map((x) => x.numero),
    ['2'],
  );
});

test('should_backfill_what_was_saved_before_the_tables_and_skip_broken_json', () => {
  // Arrange: como estaban las filas de antes, sin sus tablas.
  guardarLicitacion(db, conLotes('p-50000003'));
  const esperadas = { cpvs: cpvsDe('p-50000003'), lotes: lotesDe('p-50000003') };
  db.prepare("DELETE FROM licitacion_cpv WHERE licitacion_id IN ('p-50000003', 'p-50000004')").run();
  db.prepare("DELETE FROM lotes WHERE licitacion_id IN ('p-50000003', 'p-50000004')").run();
  guardarLicitacion(db, { ...conLotes('p-50000004') });
  db.prepare("UPDATE licitaciones SET datos = '{roto' WHERE id = 'p-50000004'").run();
  db.prepare("DELETE FROM licitacion_cpv WHERE licitacion_id = 'p-50000004'").run();
  db.prepare("DELETE FROM lotes WHERE licitacion_id = 'p-50000004'").run();
  // Act
  c.rellenarClasificacion(db);
  // Assert
  assert.deepEqual(cpvsDe('p-50000003'), esperadas.cpvs);
  assert.deepEqual(lotesDe('p-50000003'), esperadas.lotes);
  assert.deepEqual(
    cpvsDe('p-50000004').map((x) => x.cpv),
    ['80500000', '72267000'],
    'los del contrato salen de la columna aunque el JSON esté roto',
  );
  assert.deepEqual(lotesDe('p-50000004'), []);
});
