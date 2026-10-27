// Rendimiento de los antecedentes con 200.000 licitaciones sintéticas de filas anchas (con
// su JSON, como las reales): un órgano enorme (20.000 licitaciones, como un servicio de
// salud con el histórico entero), órganos sin NIF y títulos que se repiten por años. Las
// candidatas se leen por los índices del órgano y la criba de un lote de 40 no se nota.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { abrirLicitaciones, type Db } from '../../src/dominios/licitaciones/store.js';
import { antecedentesDe } from '../../src/dominios/licitaciones/antecedentes/index.js';
import { candidatasDelLote, crearLotes } from '../../src/dominios/licitaciones/criba.js';
import { comparables } from '../../src/dominios/licitaciones/precios/comparables.js';
import { medirMediana as medir } from '../helpers/medirTiempo.js';

function medirUna<T>(fn: () => T): { ms: number; valor: T } {
  const inicio = performance.now();
  const valor = fn();
  return { ms: Math.round(performance.now() - inicio), valor };
}

const N = 200_000;
const GRANDE = 'Q2800000G';
const EN_GRANDE = 20_000;
// Holgado para no fallar en una máquina lenta; lo medido en local va en el diagnóstico.
const MAX_MS = 2_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antecedentes-rend-'));
let db: Db;

function aleatorio(semilla: number): () => number {
  let s = semilla;
  return () => {
    s = (s * 16_807) % 2_147_483_647;
    return s / 2_147_483_647;
  };
}

const OBJETOS = [
  'mantenimiento de la aplicación de gestión tributaria',
  'limpieza de los colegios públicos',
  'vigilancia y seguridad de las dependencias',
  'suministro de material de oficina',
  'soporte de la sede electrónica',
  'transporte adaptado de personas mayores',
  'conservación de zonas verdes',
  'auditoría de cuentas anuales',
  'licencias de software de diseño',
  'servicio de prevención ajeno',
  'mantenimiento de ascensores',
  'seguro de responsabilidad civil',
];
const SITIOS = [
  'del edificio principal',
  'de los centros de salud',
  'del polideportivo',
  'de la biblioteca municipal',
  'del archivo',
  'de las oficinas centrales',
];

type Insertar = { lic: Database.Statement; adj: Database.Statement };

function una(st: Insertar, r: () => number, i: number, organo: { nif: string | null; norm: string | null }): void {
  const anio = 2016 + Math.floor(r() * 10);
  const fecha = `${anio}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-10`;
  const titulo = `${OBJETOS[Math.floor(r() * OBJETOS.length)]} ${SITIOS[Math.floor(r() * SITIOS.length)]} ${anio}-${anio + 1}`;
  const cpv = `,${['72267000', '90911200', '79710000', '30192000', '50750000'][Math.floor(r() * 5)]},`;
  st.lic.run(
    `p-${i}`,
    `a-${i}`,
    `E-${i}/${anio}`,
    titulo,
    `${fecha}T10:00:00Z`,
    `Órgano ${organo.nif ?? organo.norm}`,
    organo.nif,
    organo.norm,
    100_000,
    cpv,
    JSON.stringify({ relleno: 'x'.repeat(1500), duracion: { valor: 2, unidad: 'ANN' } }),
    fecha,
    fecha,
  );
  if (r() < 0.6)
    st.adj.run(
      `p-${i}`,
      fecha,
      1 + Math.floor(r() * 6),
      `B${String(Math.floor(r() * 30_000)).padStart(8, '0')}`,
      'Empresa',
      95_000,
      100_000,
      0.05,
      organo.nif,
      cpv,
      fecha,
    );
}

function organoDe(r: () => number, i: number): { nif: string | null; norm: string | null } {
  if (i < EN_GRANDE) return { nif: GRANDE, norm: 'organo grande' };
  if (r() < 0.25) return { nif: null, norm: `ayuntamiento ${Math.floor(r() * 2000)}` };
  return { nif: `Q${String(Math.floor(r() * 3000)).padStart(8, '0')}`, norm: null };
}

function poblar(): void {
  const r = aleatorio(11);
  const st: Insertar = {
    lic: db.prepare(`INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, estado, actualizada_en, organo_nombre, organo_nif, organo_norm,
      tipo_contrato, procedimiento, presupuesto_sin_iva, cpvs, datos, vista_en, publicada_en) VALUES (?, ?, 'perfiles', ?, ?, 'RES', ?, ?, ?, ?, '2', '1', ?, ?, ?, ?, ?)`),
    adj: db.prepare(`INSERT INTO adjudicaciones (licitacion_id, lote, resultado, fecha, ofertas, adjudicatario_nif, adjudicatario_nombre,
      importe_sin_iva, presupuesto_sin_iva, baja, ord, organo_nif, cpvs, fecha_ref) VALUES (?, '', '9', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`),
  };
  db.transaction(() => {
    for (let i = 0; i < N; i += 1) una(st, r, i, organoDe(r, i));
  })();
}

// Las palabras del título se rellenan como en la migración de una base anterior.
let rellenoMs = 0;

before(() => {
  db = abrirLicitaciones(path.join(tmp, 'datos'));
  poblar();
  const inicio = performance.now();
  db.exec('UPDATE licitaciones SET titulo_palabras = palabras_objeto(titulo)');
  rellenoMs = Math.round(performance.now() - inicio);
  db.pragma('wal_checkpoint(TRUNCATE)');
});

after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('should_read_the_candidates_of_a_body_by_its_index', (t) => {
  t.diagnostic(`relleno de titulo_palabras en ${N} filas: ${rellenoMs} ms`);
  const plan = (sql: string, ...args: string[]) =>
    (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as { detail: string }[]).map((p) => p.detail).join(' | ');
  assert.match(
    plan('SELECT id FROM licitaciones l WHERE l.organo_nif = ? ORDER BY l.actualizada_en DESC', GRANDE),
    /licitaciones_organo_fecha/,
  );
  assert.match(
    plan(
      'SELECT id FROM licitaciones l WHERE (l.organo_dir3 = ? OR l.organo_norm = ?) ORDER BY l.actualizada_en DESC',
      'x',
      'y',
    ),
    /licitaciones_organo_norm/,
  );
});

test('should_build_the_antecedentes_of_a_huge_body_in_well_under_two_seconds', (t) => {
  const grande = medir(() => antecedentesDe(db, 'p-19999', { limite: 12 }));
  const sinNif = (db.prepare('SELECT id FROM licitaciones WHERE organo_nif IS NULL LIMIT 1').get() as { id: string })
    .id;
  const pequeno = medir(() => antecedentesDe(db, sinNif, { limite: 12 }));
  t.diagnostic(
    `órgano de ${EN_GRANDE} licitaciones ${grande.ms} ms (${grande.valor.data?.ediciones.length} ediciones) · órgano sin NIF ${pequeno.ms} ms`,
  );
  assert.equal(grande.valor.error, null);
  assert.ok((grande.valor.data?.ediciones.length ?? 0) > 0);
  assert.ok(grande.ms < MAX_MS, `órgano grande: ${grande.ms} ms`);
  assert.ok(pequeno.ms < MAX_MS / 10, `órgano sin NIF: ${pequeno.ms} ms`);
});

test('should_add_the_signal_level_to_a_screening_batch_of_40_quickly', (t) => {
  const ids = (db.prepare('SELECT id FROM licitaciones WHERE rowid % 4999 = 0 LIMIT 40').all() as { id: string }[]).map(
    (f) => f.id,
  );
  const ts = new Date().toISOString();
  for (const id of ids)
    db.prepare(
      "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, 'candidata', ?, ?)",
    ).run(id, ts, ts);
  const lote = crearLotes(db, 40)[0] ?? 0;
  const criba = medir(() => candidatasDelLote(db, lote));
  t.diagnostic(`lote de criba de ${ids.length} candidatas (4 del órgano grande) ${criba.ms} ms`);
  assert.equal(criba.valor.data?.candidatas.length, 40);
  assert.ok(criba.valor.data?.candidatas.every((c) => c['antecedentes'] !== null));
  assert.ok(criba.ms < MAX_MS, `lote de criba: ${criba.ms} ms`);
});

test('should_read_the_comparables_of_the_same_body_by_its_index', (t) => {
  const consulta = {
    cpv: '72267000',
    presupuesto: 100_000,
    tipo: '2',
    procedimiento: '1',
    organo: GRANDE,
    mismo_organo: false,
    ofertas: null,
    excluir: 'p-1',
    titulo: 'Mantenimiento de la aplicación de gestión tributaria',
  };
  const delOrgano = medir(() => comparables(db, { ...consulta, mismo_organo: true }, 15));
  // El segmento entero (CPV de 2 cifras sin índice) ya costaba esto antes; lo nuevo es el órgano aparte.
  const todo = medirUna(() => comparables(db, consulta, 15));
  t.diagnostic(`comparables solo del órgano ${delOrgano.ms} ms · con el segmento ${todo.ms} ms`);
  assert.ok(delOrgano.valor.every((c) => c.mismo_organo));
  assert.ok(todo.valor[0]?.mismo_organo && todo.valor[0]?.objeto_parecido);
  assert.ok(delOrgano.ms < MAX_MS / 4, `comparables del órgano: ${delOrgano.ms} ms`);
  // Barrido del segmento sin índice: una sola vuelta (repetirlo tardaría medio minuto) y tope
  // amplio; lo que protege del índice perdido es la medida del órgano, que va por mediana.
  assert.ok(todo.ms < MAX_MS * 8, `comparables: ${todo.ms} ms`);
});
