// Oportunidades: sin lo del Pipeline, por fecha de cierre, lo que descartó Hermes
// apagado en «Por revisar», lo de una persona en «Descartadas» y los filtros del prefiltro a la vista.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import { FiltroRevision, listaRevision } from '../../src/dominios/licitaciones/revision.js';
import { licitacion, type Sintetica } from '../helpers/sinteticas.js';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-revision-'));
const abiertas: Db[] = [];
after(() => {
  abiertas.forEach((d) => d.close());
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-22T08:00:00Z');
type Caso = Sintetica & { estado: string; veredicto?: string; aMano?: boolean; automatico?: boolean; motivo?: string };

function conOportunidades(casos: Caso[]): { db: Db; ids: string[] } {
  const dir = path.join(tmp, String(abiertas.length + 1));
  abrirNucleo(dir).close();
  const db = abrirLicitaciones(dir);
  abiertas.push(db);
  const ids = casos.map((c) => {
    const l = licitacion({ limite: '2026-11-10T14:00:00', ...c });
    guardarLicitacion(db, l);
    db.prepare(
      `INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, veredicto_ia, motivo_ia, cambiada_a_mano, descarte_automatico, motivo_descarte, creada_en, actualizada_en)
      VALUES (?, ?, 'CPV 72', ?, ?, ?, ?, ?, '2026-10-01T10:00:00Z', 'x')`,
    ).run(
      l.id,
      c.estado,
      c.veredicto ?? null,
      c.motivo ?? null,
      c.aMano ? 1 : 0,
      c.automatico ? 1 : 0,
      c.estado === 'descartada' ? (c.motivo ?? 'x') : null,
    );
    return l.id;
  });
  return { db, ids };
}

const filtro = (q: Record<string, string> = {}) => FiltroRevision.parse(q);

test('should_list_only_what_is_not_in_the_pipeline_by_closing_date', () => {
  // Arrange
  const { db, ids } = conOportunidades([
    {
      titulo: 'Analítica tardía',
      publicada: '2026-10-01',
      limite: '2026-11-20T14:00:00',
      estado: 'nueva',
      veredicto: 'interesa',
    },
    {
      titulo: 'Analítica temprana',
      publicada: '2026-10-01',
      limite: '2026-10-28T14:00:00',
      estado: 'nueva',
      veredicto: 'revisar',
    },
    { titulo: 'Analítica en preparación', publicada: '2026-10-01', estado: 'en_preparacion' },
    { titulo: 'Analítica presentada', publicada: '2026-10-01', estado: 'presentada' },
    { titulo: 'Analítica que ya cerró', publicada: '2026-10-01', limite: '2026-10-01T14:00:00', estado: 'nueva' },
  ]);

  // Act
  const r = listaRevision(db, filtro(), AHORA);

  // Assert
  assert.deepEqual(
    r.items.map((i) => i.id),
    [ids[1], ids[0]],
    'la más cercana primero, sin las del Pipeline ni las cerradas',
  );
  assert.equal(r.cuentas.por_revisar, 2);
});

test('should_send_what_hermes_discarded_to_descartadas_dimmed_with_its_reason', () => {
  // Arrange
  const { db, ids } = conOportunidades([
    {
      titulo: 'Analítica de Hermes',
      publicada: '2026-10-01',
      limite: '2026-10-27T14:00:00',
      estado: 'descartada',
      veredicto: 'descartar',
      motivo: 'No es nuestro sector',
    },
    {
      titulo: 'Analítica no go',
      publicada: '2026-10-01',
      limite: '2026-10-29T14:00:00',
      estado: 'descartada',
      automatico: true,
      motivo: 'Hermes: no go — exige ENS',
    },
    {
      titulo: 'Analítica de Paco',
      publicada: '2026-10-01',
      limite: '2026-10-31T14:00:00',
      estado: 'descartada',
      veredicto: 'interesa',
      aMano: true,
      motivo: 'Sin equipo',
    },
    {
      titulo: 'Analítica nueva',
      publicada: '2026-10-01',
      limite: '2026-10-30T14:00:00',
      estado: 'nueva',
      veredicto: 'interesa',
    },
    { titulo: 'Analítica sin cribar', publicada: '2026-10-01', estado: 'candidata' },
  ]);

  // Act
  const porRevisar = listaRevision(db, filtro(), AHORA);
  const descartadas = listaRevision(db, filtro({ pestana: 'descartadas' }), AHORA);

  // Assert
  assert.deepEqual(
    porRevisar.items.map((i) => i.id),
    [ids[3]],
    'solo lo que espera a una persona',
  );
  assert.deepEqual(
    descartadas.items.map((i) => [i.id, i.apagada]),
    [
      [ids[0], true],
      [ids[1], true],
      [ids[2], false],
    ],
    'las de Hermes, apagadas; la de una persona, no',
  );
  assert.equal(descartadas.items[0]!.motivo, 'No es nuestro sector');
  assert.deepEqual(porRevisar.cuentas, { por_revisar: 1, sin_cribar: 1, errores: 0, descartadas: 3 });
});

test('should_filter_by_several_regions_at_once', () => {
  // Arrange
  const { db, ids } = conOportunidades([
    {
      titulo: 'Analítica Canarias',
      publicada: '2026-10-01',
      limite: '2026-10-27T14:00:00',
      estado: 'nueva',
      nuts: 'ES705',
    },
    {
      titulo: 'Analítica Madrid',
      publicada: '2026-10-01',
      limite: '2026-10-28T14:00:00',
      estado: 'nueva',
      nuts: 'ES300',
    },
    {
      titulo: 'Analítica Galicia',
      publicada: '2026-10-01',
      limite: '2026-10-29T14:00:00',
      estado: 'nueva',
      nuts: 'ES111',
    },
  ]);

  // Act
  const r = listaRevision(db, FiltroRevision.parse({ comunidad: 'ES70,ES30' }), AHORA);

  // Assert
  assert.deepEqual(
    r.items.map((i) => i.id),
    [ids[0], ids[1]],
  );
  assert.equal(FiltroRevision.safeParse({ comunidad: 'ES70,Madrid' }).success, false, 'un código raro no pasa');
});

test('should_refine_with_the_prefilter_rules_without_touching_the_ingestion', () => {
  // Arrange
  const { db, ids } = conOportunidades([
    { titulo: 'Formación en datos', publicada: '2026-10-01', cpv: '80500000', estado: 'nueva', presupuesto: 40_000 },
    {
      titulo: 'Obra de un aula de datos',
      publicada: '2026-10-01',
      cpv: '45000000',
      estado: 'nueva',
      presupuesto: 40_000,
    },
    {
      titulo: 'Analítica grande',
      publicada: '2026-10-01',
      cpv: '72000000',
      estado: 'nueva',
      presupuesto: 900_000,
      lotes: [
        { id: '1', nombre: 'Lote pequeño', importe: 50_000 },
        { id: '2', nombre: 'Lote grande', importe: 850_000 },
      ],
    },
    { titulo: 'Suministro de licencias', publicada: '2026-10-01', cpv: '48000000', estado: 'nueva', tipo: '1' },
  ]);

  // Act
  const porCpv = listaRevision(db, filtro({ cpv: '72' }), AHORA).items.map((i) => i.id);
  const sinObras = listaRevision(db, filtro({ excluir: 'obra' }), AHORA).items.map((i) => i.id);
  const porImporte = listaRevision(db, filtro({ importe_max: '60000' }), AHORA).items.map((i) => i.id);
  const servicios = listaRevision(db, filtro({ tipos: '2' }), AHORA).items.map((i) => i.id);
  const porPalabra = listaRevision(db, filtro({ palabras: 'formacion' }), AHORA).items.map((i) => i.id);

  // Assert
  assert.deepEqual(porCpv, [ids[2]]);
  assert.ok(!sinObras.includes(ids[1]!) && sinObras.includes(ids[0]!));
  assert.ok(porImporte.includes(ids[2]!), 'un lote de 50.000 € entra aunque el total sea de 900.000 €');
  assert.ok(!servicios.includes(ids[3]!), 'el suministro sale con «solo servicios»');
  assert.deepEqual(porPalabra, [ids[0]], 'sin tildes ni mayúsculas, como el prefiltro');
});

test('should_reject_a_malformed_query', () => {
  assert.equal(FiltroRevision.safeParse({ pestana: 'todas' }).success, false);
  assert.equal(FiltroRevision.safeParse({ cpv: '72,abc' }).success, false);
  assert.equal(FiltroRevision.safeParse({ importe_min: '-5' }).success, false);
  assert.deepEqual(FiltroRevision.parse({ opinion: 'interesa, revisar' }).opinion, ['interesa', 'revisar']);
});
