// Rendimiento de los agregados de competencia con 150.000 adjudicaciones sintéticas y
// filas de licitaciones anchas (como las reales, con su JSON): los rankings deben leer
// solo adjudicaciones y el índice cubriente de licitaciones, y las fichas ir por índice.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo, type Db as DbNucleo } from '../../src/nucleo/db.js';
import { guardarEscala } from '../../src/dominios/licitaciones/competencia/escala.js';
import { abrirLicitaciones, type Db } from '../../src/dominios/licitaciones/store.js';
import {
  rankingCompetidores,
  fichaCompetidor,
  OpcionesCompetidores,
} from '../../src/dominios/licitaciones/competencia/competidores.js';
import {
  rankingOrganismos,
  fichaOrganismo,
  OpcionesOrganismos,
} from '../../src/dominios/licitaciones/competencia/organismos.js';
import { medirMediana as medir } from '../helpers/medirTiempo.js';

const N = 150_000;
const HOY = new Date('2026-10-02T00:00:00Z');
// Holgado para no fallar en una máquina lenta; lo medido en local va en el diagnóstico.
const MAX_MS = 2_000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'competencia-rend-'));
let nucleo: DbNucleo;
let db: Db;

// Generador determinista: los mismos datos en cada vuelta.
function aleatorio(semilla: number): () => number {
  let s = semilla;
  return () => {
    s = (s * 16_807) % 2_147_483_647;
    return s / 2_147_483_647;
  };
}

function poblar(): void {
  const r = aleatorio(7);
  const cpvs = Array.from({ length: 300 }, (_, i) => String(30_000_000 + i * 170_000).slice(0, 8));
  const relleno = JSON.stringify({ relleno: 'x'.repeat(1500) });
  const lic =
    db.prepare(`INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, estado, actualizada_en, organo_nombre, organo_nif,
    presupuesto_sin_iva, cpvs, nuts, datos, vista_en) VALUES (?, ?, 'perfiles', ?, ?, 'RES', ?, ?, ?, ?, ?, ?, ?, ?)`);
  const adj =
    db.prepare(`INSERT INTO adjudicaciones (licitacion_id, lote, resultado, fecha, ofertas, adjudicatario_nif, adjudicatario_nombre,
    importe_sin_iva, presupuesto_sin_iva, baja, pyme, ord, organo_nif, cpvs, nuts, fecha_ref) VALUES (?, '', '9', ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (let i = 0; i < N; i += 1) {
      const cpv = `,${cpvs[Math.floor(r() * 300)]},${cpvs[Math.floor(r() * 300)]},`;
      const organo = `Q${String(Math.floor(r() * 3000)).padStart(8, '0')}`;
      const fecha = `${2019 + Math.floor(r() * 8)}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-15`;
      const baja = r() * 0.5;
      // Un tercio en Canarias y presupuestos de 20.000 a 500.000 €: los filtros por defecto dejan pasar una parte.
      const nuts = i % 3 === 0 ? 'ES705' : 'ES300';
      const presupuesto = 20_000 + Math.floor(r() * 480_000);
      lic.run(
        `p-${i}`,
        `a-${i}`,
        `E-${i}`,
        `Contrato ${i}`,
        `${fecha}T10:00:00Z`,
        `Órgano ${organo}`,
        organo,
        presupuesto,
        cpv,
        nuts,
        relleno,
        fecha,
      );
      adj.run(
        `p-${i}`,
        fecha,
        Math.ceil(r() * 8),
        `B${String(Math.floor(r() * 40_000)).padStart(8, '0')}`,
        'Empresa',
        presupuesto * (1 - baja),
        presupuesto,
        baja,
        organo,
        cpv,
        nuts,
        fecha,
      );
    }
  })();
}

before(() => {
  const dir = path.join(tmp, 'datos');
  nucleo = abrirNucleo(dir);
  db = abrirLicitaciones(dir);
  poblar();
  // «A nuestra escala»: el territorio y la banda de la escala de los rankings.
  guardarEscala(db, { region_nuts: 'ES7', banda_min: 7_000, banda_max: 130_000 });
});

after(() => {
  db.close();
  nucleo.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('should_rank_competitors_and_organs_quickly_with_150k_awards', (t) => {
  const competidores = medir(() => rankingCompetidores(db, OpcionesCompetidores.parse({}), HOY));
  const porCoincidencias = medir(() =>
    rankingCompetidores(db, OpcionesCompetidores.parse({ orden: 'coincidencias', meses: 0 }), HOY),
  );
  const organismos = medir(() => rankingOrganismos(db, OpcionesOrganismos.parse({}), HOY));

  t.diagnostic(
    `competidores ${competidores.ms} ms · todo el histórico ${porCoincidencias.ms} ms · organismos ${organismos.ms} ms`,
  );
  assert.ok(competidores.valor.items.length > 0);
  assert.ok(organismos.valor.items.length > 0);
  assert.ok(competidores.ms < MAX_MS, `ranking de competidores: ${competidores.ms} ms`);
  assert.ok(porCoincidencias.ms < MAX_MS, `ranking por coincidencias: ${porCoincidencias.ms} ms`);
  assert.ok(organismos.ms < MAX_MS, `ranking de organismos: ${organismos.ms} ms`);
});

test('should_keep_competenciaRendimiento_under_its_time_budget', (t) => {
  const escala = { competidores: OpcionesCompetidores.parse({}), organismos: OpcionesOrganismos.parse({}) };
  const todo = { toda_espana: true, todos_importes: true };

  const competidores = medir(() => rankingCompetidores(db, escala.competidores, HOY));
  const organismos = medir(() => rankingOrganismos(db, escala.organismos, HOY));
  const pagina = medir(() =>
    rankingCompetidores(db, OpcionesCompetidores.parse({ ...todo, desde: 50, limite: 50 }), HOY),
  );
  const organismosTodo = medir(() =>
    rankingOrganismos(db, OpcionesOrganismos.parse({ ...todo, desde: 50, limite: 50 }), HOY),
  );

  t.diagnostic(
    `a nuestra escala: competidores ${competidores.ms} ms · organismos ${organismos.ms} ms · «Ver más» en toda España: ${pagina.ms} y ${organismosTodo.ms} ms`,
  );
  assert.ok(competidores.valor.items.length > 0 && organismos.valor.items.length > 0);
  assert.equal(competidores.valor.ambito.nuts, 'ES7');
  assert.equal(pagina.valor.siguiente, 100);
  assert.ok(
    [competidores, organismos, pagina, organismosTodo].every((m) => m.ms < MAX_MS),
    'cada ranking por debajo de su presupuesto',
  );
});

test('should_build_records_by_index_in_milliseconds', (t) => {
  const nif = rankingCompetidores(db, OpcionesCompetidores.parse({ meses: 0, limite: 1 }), HOY).items[0]?.nif ?? '';
  const organo =
    rankingOrganismos(db, OpcionesOrganismos.parse({ meses: 0, limite: 1, orden: 'licitaciones' }), HOY).items[0]
      ?.nif ?? '';

  const competidor = medir(() => fichaCompetidor(db, nif, { solo_sector: false }));
  const organismo = medir(() => fichaOrganismo(db, organo, { solo_sector: false }));

  t.diagnostic(`ficha de competidor ${competidor.ms} ms · ficha de organismo ${organismo.ms} ms`);
  assert.equal(competidor.valor.error, null);
  assert.equal(organismo.valor.error, null);
  assert.ok(competidor.ms < MAX_MS / 4 && organismo.ms < MAX_MS / 4);
});

test('should_read_a_competitor_record_by_the_nif_index', () => {
  const plan = (
    db.prepare('EXPLAIN QUERY PLAN SELECT * FROM adjudicaciones WHERE adjudicatario_nif = ?').all('B00000001') as {
      detail: string;
    }[]
  )
    .map((p) => p.detail)
    .join(' | ');
  assert.match(plan, /adjudicaciones_nif/);
});
