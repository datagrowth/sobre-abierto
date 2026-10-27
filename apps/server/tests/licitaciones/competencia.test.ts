// Competidores y organismos con datos sintéticos: columnas copiadas en adjudicaciones (y
// su relleno al migrar), ranking por sector y periodo, coincidencias con lo que sigue la empresa,
// fichas, seguimiento a mano, resumen para Hermes y API web.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'competencia-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion, abrirLicitaciones, marcarBorrada, ARREGLOS_TOTALES } =
  await import('../../src/dominios/licitaciones/store.js');
const { guardarOrganizaciones } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { seguirLicitacion } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { rankingCompetidores, fichaCompetidor, OpcionesCompetidores } =
  await import('../../src/dominios/licitaciones/competencia/competidores.js');
const { rankingOrganismos, fichaOrganismo, OpcionesOrganismos } =
  await import('../../src/dominios/licitaciones/competencia/organismos.js');
const { seguir, dejarDeSeguir, listarSeguidos } =
  await import('../../src/dominios/licitaciones/competencia/seguidos.js');
const { interes } = await import('../../src/dominios/licitaciones/competencia/interes.js');
const { desdeMeses, bandaPropia, nombreEmpresa, nombreOrgano } =
  await import('../../src/dominios/licitaciones/competencia/ambito.js');
const { pedirResumenCompetidor, resumenRecibido, instruccionesResumen } =
  await import('../../src/dominios/licitaciones/competencia/resumen.js');
const { registrarUso } = await import('../../src/nucleo/agentes/auditoria.js');
const { guardarEscala } = await import('../../src/dominios/licitaciones/competencia/escala.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
type LicitacionData = import('../../src/dominios/licitaciones/placsp/mapper.js').LicitacionData;

const HOY = new Date('2026-10-02T00:00:00Z');
let n = 0;

type Adj = {
  nif: string;
  nombre: string;
  importe: number;
  presupuesto: number;
  fecha: string;
  ofertas?: number;
  pyme?: boolean;
};
type Sintetica = { organo: string; cpv: string; nuts?: string; estado?: string; adj?: Adj; id?: string };

const ORGANOS: Record<string, string> = { Q2800001A: 'Ayuntamiento Uno', Q2800002B: 'Diputación Dos' };

function licitacion(s: Sintetica): LicitacionData {
  n += 1;
  const fecha = s.adj?.fecha ?? '2026-09-01';
  return {
    id: s.id ?? `p-${n}`,
    atom_id: `atom-${n}`,
    fuente: 'perfiles',
    expediente: `EXP-${n}`,
    titulo: `Contrato ${n}`,
    url: `https://contrataciondelestado.es/${n}`,
    estado: s.estado ?? 'RES',
    actualizada_en: `${fecha}T10:00:00Z`,
    organo: { nombre: ORGANOS[s.organo] ?? s.organo, nif: s.organo, dir3: null, ciudad: null },
    tipo_contrato: '2',
    procedimiento: '1',
    presupuesto_sin_iva: s.adj?.presupuesto ?? 100_000,
    presupuesto_con_iva: null,
    valor_estimado: null,
    cpvs: [s.cpv],
    nuts: s.nuts ?? 'ES300',
    lugar: null,
    duracion: null,
    periodo: null,
    publicada_en: null,
    fecha_limite: s.estado === 'PUB' ? '2026-10-30T10:00:00' : null,
    fecha_solicitud: null,
    criterios: [],
    requisitos: [],
    garantias: [],
    documentos: [],
    lotes: [],
    presentacion: { codigo: null, maximo_lotes: null, maximo_adjudicables: null, combinacion: null },
    resultados: s.adj
      ? [
          {
            lote: null,
            codigo: '9',
            fecha: s.adj.fecha,
            ofertas: s.adj.ofertas ?? null,
            oferta_min: null,
            oferta_max: null,
            adjudicatario_nif: s.adj.nif,
            adjudicatario_nombre: s.adj.nombre,
            importe_sin_iva: s.adj.importe,
            importe_con_iva: null,
            pyme: s.adj.pyme ?? null,
            inicio: null,
          },
        ]
      : [],
  };
}

function guardar(s: Sintetica): string {
  const l = licitacion(s);
  guardarLicitacion(dbLicitaciones(), l);
  guardarOrganizaciones(dbLicitaciones(), l);
  return l.id;
}

const datos =
  (nif: string, nombre: string) =>
  (importe: number, fecha: string, extra: Partial<Adj> = {}): Adj => ({
    nif,
    nombre,
    importe,
    presupuesto: 100_000,
    fecha,
    ...extra,
  });
const b1 = datos('B00000001', 'Datos SL');

iniciarNucleo();
// B1 gana tres veces en el órgano 1 (CPV 7221, del sector); B2, una vez en el 2 con una baja
// imposible; B3, en obras (fuera del sector); B4, en el sector pero hace seis años.
guardar({ organo: 'Q2800001A', cpv: '72212000', adj: b1(90_000, '2025-03-01', { ofertas: 2, pyme: true }) });
guardar({ organo: 'Q2800001A', cpv: '72212000', adj: b1(80_000, '2025-06-01', { ofertas: 3, pyme: true }) });
guardar({ organo: 'Q2800001A', cpv: '72212000', adj: b1(70_000, '2025-09-01', { ofertas: 5, pyme: true }) });
guardar({
  organo: 'Q2800002B',
  cpv: '72000000',
  nuts: 'ES511',
  adj: {
    nif: 'b-0000000.2',
    nombre: 'Grande SA',
    importe: 900_000,
    presupuesto: 6_000_000,
    fecha: '2026-02-01',
    ofertas: 1,
    pyme: false,
  },
});
guardar({ organo: 'Q2800001A', cpv: '45000000', adj: datos('B00000003', 'Obras SL')(50_000, '2025-05-01') });
guardar({ organo: 'Q2800001A', cpv: '45000000', adj: datos('B00000003', 'Obras SL')(60_000, '2025-07-01') });
guardar({ organo: 'Q2800001A', cpv: '72212000', adj: datos('B00000004', 'Antigua SL')(95_000, '2020-05-01') });
// La oportunidad que sigue la empresa: abierta, en el órgano 2 y de la clase CPV 7221.
const seguida = guardar({ organo: 'Q2800002B', cpv: '72212100', estado: 'PUB' });
seguirLicitacion(dbLicitaciones(), seguida);

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/licitaciones`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Los tests de antes de la banda y la región miran todo el país y todos los importes.
const opcionesC = (o: Record<string, unknown> = {}) =>
  OpcionesCompetidores.parse({ todos_importes: true, toda_espana: true, ...o });
const opcionesO = (o: Record<string, unknown> = {}) =>
  OpcionesOrganismos.parse({ todos_importes: true, toda_espana: true, ...o });

test('should_copy_tender_fields_into_awards_and_normalize_the_winner_nif', () => {
  const fila = dbLicitaciones()
    .prepare("SELECT * FROM adjudicaciones WHERE adjudicatario_nombre = 'Grande SA'")
    .get() as Record<string, unknown>;

  assert.equal(fila['adjudicatario_nif'], 'B00000002');
  assert.equal(fila['organo_nif'], 'Q2800002B');
  assert.equal(fila['cpvs'], ',72000000,');
  assert.equal(fila['nuts'], 'ES511');
  assert.equal(fila['fecha_ref'], '2026-02-01');
  assert.equal(fila['nif_valido'], 0);
});

test('should_backfill_copied_columns_when_opening_a_database_from_before_this_version', () => {
  const dir = path.join(tmp, 'antigua');
  fs.mkdirSync(dir);
  const vieja = new Database(path.join(dir, 'licitaciones.db'));
  vieja.exec(`CREATE TABLE licitaciones (id TEXT PRIMARY KEY, atom_id TEXT NOT NULL UNIQUE, fuente TEXT NOT NULL, expediente TEXT NOT NULL,
    titulo TEXT NOT NULL, url TEXT, estado TEXT NOT NULL, actualizada_en TEXT NOT NULL, organo_nombre TEXT NOT NULL, organo_nif TEXT,
    tipo_contrato TEXT, procedimiento TEXT, presupuesto_sin_iva REAL, valor_estimado REAL, cpvs TEXT NOT NULL, nuts TEXT, lugar TEXT,
    fecha_limite TEXT, datos TEXT NOT NULL, borrada_en TEXT, borrada_motivo TEXT, vista_en TEXT NOT NULL);
  CREATE TABLE adjudicaciones (licitacion_id TEXT NOT NULL, lote TEXT NOT NULL, resultado TEXT, fecha TEXT, ofertas REAL,
    oferta_min REAL, oferta_max REAL, adjudicatario_nif TEXT, adjudicatario_nombre TEXT, importe_sin_iva REAL, presupuesto_sin_iva REAL,
    baja REAL, pyme INTEGER, ord INTEGER NOT NULL, PRIMARY KEY (licitacion_id, ord));
  INSERT INTO licitaciones VALUES ('p-1', 'a-1', 'perfiles', 'E', 'T', NULL, 'RES', '2024-05-06T08:00:00Z', 'Órgano', 'Q9', '2', '1', 100, NULL,
    ',72000000,', 'ES300', NULL, NULL, '{}', NULL, NULL, '2024-05-06');
  INSERT INTO adjudicaciones VALUES ('p-1', '', '9', NULL, 3, NULL, NULL, 'b-123.456 78', 'X', 90, 100, 0.1, 1, 0),
    ('p-1', '', '9', NULL, 3, NULL, NULL, 'ESB12345674', 'Y', 90, 100, 0.1, 1, 1);`);
  vieja.close();

  const db = abrirLicitaciones(dir);
  const filas = db
    .prepare('SELECT adjudicatario_nif, organo_nif, cpvs, nuts, fecha_ref, nif_valido FROM adjudicaciones ORDER BY ord')
    .all();
  db.close();

  assert.deepEqual(
    { ...(filas[0] as object) },
    {
      adjudicatario_nif: 'B12345678',
      organo_nif: 'Q9',
      cpvs: ',72000000,',
      nuts: 'ES300',
      fecha_ref: '2024-05-06',
      nif_valido: 0,
    },
  );
  assert.deepEqual(
    { ...(filas[1] as object) },
    {
      adjudicatario_nif: 'B12345674',
      organo_nif: 'Q9',
      cpvs: ',72000000,',
      nuts: 'ES300',
      fecha_ref: '2024-05-06',
      nif_valido: 1,
    },
  );
});

test('should_rank_competitors_in_our_sector_and_period_by_amount', () => {
  const r = rankingCompetidores(dbLicitaciones(), opcionesC(), HOY);

  assert.deepEqual(
    r.items.map((c) => c.nif),
    ['B00000002', 'B00000001'],
  );
  assert.equal(r.total, 2);
  assert.equal(r.ambito.desde, '2024-10-02');
  assert.match(r.nota, /ganadores/);
  const b1Fila = r.items[1];
  assert.equal(b1Fila?.contratos, 3);
  assert.equal(b1Fila?.importe, 240_000);
  assert.equal(b1Fila?.baja_media, 0.2);
  assert.equal(b1Fila?.pyme, 1);
  assert.equal(r.items[0]?.baja_media, null, 'una baja del 85 % no es creíble y no cuenta');
});

test('should_order_by_contracts_or_by_matches_with_the_opportunities_we_follow', () => {
  const porContratos = rankingCompetidores(dbLicitaciones(), opcionesC({ orden: 'contratos' }), HOY);
  const porCoincidencias = rankingCompetidores(dbLicitaciones(), opcionesC({ orden: 'coincidencias' }), HOY);

  assert.equal(porContratos.items[0]?.nif, 'B00000001');
  assert.deepEqual(
    porCoincidencias.items.map((c) => [c.nif, c.coincidencias]),
    [
      ['B00000001', { total: 3, mismo_organo: 0, mismo_cpv: 3 }],
      ['B00000002', { total: 1, mismo_organo: 1, mismo_cpv: 0 }],
    ],
  );
});

test('should_filter_the_ranking_by_text_cpv_and_whole_history', () => {
  const db = dbLicitaciones();

  assert.deepEqual(
    rankingCompetidores(db, opcionesC({ texto: 'grande' }), HOY).items.map((c) => c.nif),
    ['B00000002'],
  );
  assert.deepEqual(
    rankingCompetidores(db, opcionesC({ cpv: ['45'] }), HOY).items.map((c) => c.nif),
    ['B00000003'],
  );
  assert.ok(rankingCompetidores(db, opcionesC({ meses: 0 }), HOY).items.some((c) => c.nif === 'B00000004'));
  assert.deepEqual(rankingCompetidores(db, opcionesC({ texto: 'zz_%' }), HOY).items, []);
  assert.equal(desdeMeses(0, HOY), '');
  assert.equal(desdeMeses(12, HOY), '2025-10-02');
});

test('should_clamp_the_day_when_the_target_month_is_shorter', () => {
  assert.equal(desdeMeses(3, new Date('2026-05-31T12:00:00Z')), '2026-02-28');
  assert.equal(desdeMeses(1, new Date('2024-03-31T12:00:00Z')), '2024-02-29');
  assert.equal(desdeMeses(1, new Date('2026-01-31T12:00:00Z')), '2025-12-31');
});

test('should_build_the_competitor_record_with_organs_cpvs_territories_years_and_offers', () => {
  const r = fichaCompetidor(dbLicitaciones(), 'B00000001', { solo_sector: false }, HOY);

  assert.equal(r.error, null);
  const f = r.data;
  assert.equal(f?.nombre, 'Datos SL');
  assert.equal(f?.tipo, 'empresa');
  assert.equal(f?.pyme, 1);
  assert.deepEqual(f?.resumen, {
    contratos: 3,
    licitaciones: 3,
    importe: 240_000,
    importe_medio: 80_000,
    organos: 1,
    primero: '2025-03-01',
    ultimo: '2025-09-01',
  });
  assert.deepEqual(
    f?.organos.map((o) => [o.clave, o.nombre, o.contratos]),
    [['Q2800001A', 'Ayuntamiento Uno', 3]],
  );
  assert.deepEqual(f?.cpvs, [{ cpv: '72212000', contratos: 3 }]);
  assert.deepEqual(
    f?.territorios.map((t) => [t.clave, t.nombre]),
    [['ES30', 'Comunidad de Madrid']],
  );
  assert.deepEqual(
    f?.por_anio.map((a) => [a.clave, a.contratos, a.baja_mediana]),
    [['2025', 3, 0.2]],
  );
  assert.deepEqual(f?.ofertas, {
    n: 3,
    media: 3.33,
    mediana: 3,
    por_tramo: [
      { clave: '2-3', n: 2 },
      { clave: '4-5', n: 1 },
    ],
  });
  assert.equal(f?.bajas.percentiles.p50, 0.2);
  assert.equal(f?.ultimos[0]?.fecha, '2025-09-01');
  assert.match(f?.ultimos[0]?.url ?? '', /contrataciondelestado/);
  assert.deepEqual(
    f?.coincidencias.map((c) => [c.id, c.mismo_organo, c.mismo_cpv]),
    [[seguida, false, true]],
  );
});

test('should_answer_not_found_for_an_unknown_competitor_and_limit_to_the_sector_on_request', () => {
  const db = dbLicitaciones();

  assert.equal(fichaCompetidor(db, 'B99999999', { solo_sector: false }).error?.code, 'not_found');
  assert.equal(fichaCompetidor(db, 'B00000003', { solo_sector: true }).data?.resumen.contratos, 0);
  assert.equal(fichaCompetidor(db, 'B00000003', { solo_sector: false }).data?.resumen.contratos, 2);
});

test('should_rank_organs_with_tendered_and_awarded_figures_and_our_opportunities', () => {
  const r = rankingOrganismos(dbLicitaciones(), opcionesO({ orden: 'licitaciones' }), HOY);

  const q1 = r.items.find((o) => o.nif === 'Q2800001A');
  const q2 = r.items.find((o) => o.nif === 'Q2800002B');
  assert.equal(r.items[0]?.nif, 'Q2800001A');
  assert.equal(q1?.nombre, 'Ayuntamiento Uno');
  assert.deepEqual(
    [q1?.licitaciones, q1?.adjudicaciones, q1?.baja_media, q1?.meses_activos, q1?.oportunidades],
    [3, 3, 0.2, 3, 0],
  );
  assert.deepEqual([q2?.licitaciones, q2?.adjudicaciones, q2?.baja_media, q2?.oportunidades], [2, 1, null, 1]);
  assert.equal(q2?.interes.baja, 0.5, 'sin bajas creíbles, neutral');
  assert.deepEqual(
    rankingOrganismos(dbLicitaciones(), opcionesO({ texto: 'diputación' }), HOY).items.map((o) => o.nif),
    ['Q2800002B'],
  );
});

test('should_build_the_organ_record_with_who_wins_and_concentration', () => {
  const r = fichaOrganismo(dbLicitaciones(), 'Q2800001A', { solo_sector: false });

  const f = r.data;
  assert.equal(f?.nombre, 'Ayuntamiento Uno');
  assert.deepEqual([f?.licitaciones.total, f?.licitaciones.del_sector, f?.licitaciones.abiertas], [6, 4, 0]);
  assert.deepEqual(
    f?.adjudicatarios.map((g) => [g.clave, g.nombre, g.contratos]),
    [
      ['B00000001', 'Datos SL', 3],
      ['B00000003', 'Obras SL', 2],
      ['B00000004', 'Antigua SL', 1],
    ],
  );
  assert.equal(f?.adjudicaciones.concentracion, 0.5);
  assert.equal(
    fichaOrganismo(dbLicitaciones(), 'Q2800002B', { solo_sector: false }, HOY).data?.oportunidades[0]?.id,
    seguida,
  );
  assert.equal(fichaOrganismo(dbLicitaciones(), 'S0000000', { solo_sector: false }).error?.code, 'not_found');
});

test('should_score_interest_from_volume_recurrence_and_moderate_discount', () => {
  const alto = interes({ importe_licitado: 1_000_000, meses_activos: 8, baja_media: 0 }, 1_000_000, 24);
  const bajo = interes({ importe_licitado: 0, meses_activos: 0, baja_media: 0.45 }, 1_000_000, 24);
  const sinMax = interes({ importe_licitado: 0, meses_activos: 1, baja_media: null }, 0, 0);

  assert.deepEqual(alto, { puntos: 100, volumen: 1, recurrencia: 1, baja: 1 });
  assert.deepEqual(bajo, { puntos: 0, volumen: 0, recurrencia: 0, baja: 0 });
  assert.deepEqual(sinMax, { puntos: 13, volumen: 0, recurrencia: 0.08, baja: 0.5 });
});

test('should_follow_and_unfollow_competitors_with_notes_only_when_they_exist', () => {
  const db = dbLicitaciones();

  assert.equal(seguir(db, 'competidor', 'B77777777', { notas: '' }).error?.code, 'not_found');
  assert.equal(seguir(db, 'competidor', 'B00000001', { notas: 'Rival en Madrid' }).error, null);
  seguir(db, 'competidor', 'B00000001', { notas: 'Rival directo en Madrid' });
  const lista = listarSeguidos(db, 'competidor');
  assert.deepEqual(
    lista.map((s) => [s.nif, s.nombre, s.notas, s.contratos]),
    [['B00000001', 'Datos SL', 'Rival directo en Madrid', 3]],
  );
  assert.equal(rankingCompetidores(db, opcionesC(), HOY).items.find((c) => c.nif === 'B00000001')?.seguido, true);
  assert.equal(
    fichaCompetidor(db, 'B00000001', { solo_sector: false }).data?.seguido?.notas,
    'Rival directo en Madrid',
  );
  assert.equal(dejarDeSeguir(db, 'competidor', 'B00000001').data?.borrado, true);
  assert.equal(dejarDeSeguir(db, 'competidor', 'B00000001').error?.code, 'not_found');
  assert.equal(seguir(db, 'organismo', 'Q2800002B', { notas: '' }).error, null);
  assert.equal(listarSeguidos(db, 'organismo')[0]?.contratos, 1);
});

test('should_keep_the_competitor_nif_out_of_the_events_and_the_organ_nif_in', () => {
  const db = dbLicitaciones();

  seguir(db, 'competidor', 'B00000003', { notas: '' });
  dejarDeSeguir(db, 'competidor', 'B00000003');
  const recursos = nucleo()
    .db.prepare("SELECT recurso FROM eventos WHERE tipo = 'licitaciones.seguido' ORDER BY id")
    .all() as { recurso: string }[];

  assert.ok(recursos.length >= 4);
  assert.ok(recursos.every((r) => r.recurso === 'competidor' || r.recurso.startsWith('organismo:')));
  assert.ok(!recursos.some((r) => r.recurso.includes('B0000000')), 'el NIF de un adjudicatario puede ser un DNI');
  assert.ok(recursos.some((r) => r.recurso === 'organismo:Q2800002B'));
});

test('should_queue_one_competitor_summary_and_detect_the_proposed_note', () => {
  const { db } = nucleo();
  const antes = new Date(Date.now() - 1000).toISOString();

  assert.equal(pedirResumenCompetidor(db, dbLicitaciones(), 'B99999999').error?.code, 'not_found');
  const primero = pedirResumenCompetidor(db, dbLicitaciones(), 'B00000001');
  const segundo = pedirResumenCompetidor(db, dbLicitaciones(), 'B00000001');
  assert.equal(primero.data?.trabajo, segundo.data?.trabajo, 'un segundo clic no duplica');
  assert.equal(resumenRecibido(db, antes), false);
  registrarUso(db, {
    agente: 'licitaciones',
    herramienta: 'biblioteca_proponer',
    dominio: 'biblioteca',
    recurso: 'Competidores',
    resultado: 'ok',
  });
  assert.equal(resumenRecibido(db, antes), true);
  assert.match(instruccionesResumen('B00000001', 'Analítica Ejemplo'), /competidores_ver \(nif=B00000001\)/);
});

test('should_serve_rankings_records_and_following_over_http_with_validation', async () => {
  const ranking = await fetch(`${base}/competidores?meses=24&orden=contratos&limite=5&toda_espana=1&todos_importes=1`);
  const ficha = await fetch(`${base}/organismos/Q2800001A?solo_sector=1`);
  const seguir1 = await fetch(`${base}/seguidos/competidor/b-00000002`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notas: 'Grande' }),
  });

  assert.equal(ranking.status, 200);
  assert.ok(((await ranking.json()) as { items: unknown[] }).items.length > 0);
  assert.equal(ficha.status, 200);
  assert.equal(((await ficha.json()) as { solo_sector: boolean }).solo_sector, true);
  assert.equal(seguir1.status, 200);
  assert.equal(
    ((await (await fetch(`${base}/seguidos?tipo=competidor`)).json()) as { nif: string }[])[0]?.nif,
    'B00000002',
  );
  assert.equal((await fetch(`${base}/competidores?orden=inventado`)).status, 400);
  assert.equal((await fetch(`${base}/competidores?limite=1000`)).status, 400);
  assert.equal((await fetch(`${base}/competidores/..%2Fx`)).status, 400);
  assert.equal((await fetch(`${base}/seguidos/rival/B00000002`, { method: 'DELETE' })).status, 400);
  assert.equal((await fetch(`${base}/competidores/B99999999/resumen`, { method: 'POST' })).status, 404);
});

// Lo que sigue añade datos propios al final, para no mover las cifras de los tests de arriba.

test('should_match_followed_opportunities_in_the_ranking_and_the_record_beyond_200_organs', () => {
  const db = dbLicitaciones();
  // 250 oportunidades abiertas en 250 órganos, con plazos cada vez más lejanos.
  for (let i = 0; i < 250; i += 1) {
    const id = guardar({ organo: `Q91${String(i).padStart(5, '0')}A`, cpv: '90000000', estado: 'PUB' });
    seguirLicitacion(db, id);
    db.prepare('UPDATE licitaciones SET fecha_limite = ? WHERE id = ?').run(
      new Date(HOY.getTime() + (i + 1) * 86_400_000).toISOString().slice(0, 19),
      id,
    );
  }
  const ultima = 'Q9100249A';
  guardar({ organo: ultima, cpv: '79000000', adj: datos('B00000095', 'Lejana SL')(40_000, '2026-09-15') });

  const ranking = rankingCompetidores(db, opcionesC({ cpv: ['79'] }), HOY).items.find((c) => c.nif === 'B00000095');
  const ficha = fichaCompetidor(db, 'B00000095', { solo_sector: false }, HOY).data;

  assert.deepEqual(ranking?.coincidencias, { total: 1, mismo_organo: 1, mismo_cpv: 0 });
  assert.equal(ficha?.coincidencias.length, 1);
  assert.equal(ficha?.coincidencias[0]?.organo_nif, ultima);
});

test('should_ignore_new_opportunities_whose_deadline_already_passed', () => {
  const db = dbLicitaciones();
  const vencida = guardar({ organo: 'Q9300000C', cpv: '90000000', estado: 'PUB' });
  seguirLicitacion(db, vencida);
  db.prepare("UPDATE licitaciones SET fecha_limite = '2026-09-01T10:00:00' WHERE id = ?").run(vencida);
  guardar({ organo: 'Q9300000C', cpv: '79000000', adj: datos('B00000096', 'Vencida SL')(40_000, '2026-09-15') });

  const ranking = rankingCompetidores(db, opcionesC({ cpv: ['79'] }), HOY).items.find((c) => c.nif === 'B00000096');
  const ficha = fichaCompetidor(db, 'B00000096', { solo_sector: false }, HOY).data;

  assert.deepEqual(ranking?.coincidencias, { total: 0, mismo_organo: 0, mismo_cpv: 0 });
  assert.deepEqual(ficha?.coincidencias, []);
  assert.deepEqual(fichaOrganismo(db, 'Q9300000C', { solo_sector: false }, HOY).data?.oportunidades, []);
});

test('should_normalize_the_organ_nif_so_its_record_and_following_find_it', () => {
  const db = dbLicitaciones();
  guardar({ organo: 'p-0000003-d', cpv: '72212000', adj: datos('B00000097', 'Normal SL')(50_000, '2026-08-01') });

  const lic = db.prepare("SELECT organo_nif FROM licitaciones WHERE organo_nombre = 'p-0000003-d'").get() as {
    organo_nif: string;
  };
  const adj = db.prepare("SELECT organo_nif FROM adjudicaciones WHERE adjudicatario_nif = 'B00000097'").get() as {
    organo_nif: string;
  };
  const ficha = fichaOrganismo(db, 'P0000003D', { solo_sector: false }, HOY).data;
  seguir(db, 'organismo', 'P0000003D', { notas: '' });

  assert.deepEqual([lic.organo_nif, adj.organo_nif], ['P0000003D', 'P0000003D']);
  assert.deepEqual([ficha?.licitaciones.total, ficha?.adjudicaciones.contratos, ficha?.nombre], [1, 1, 'P-0000003-D']);
  assert.equal(listarSeguidos(db, 'organismo').find((s) => s.nif === 'P0000003D')?.contratos, 1);
  const fila = rankingOrganismos(db, opcionesO({ meses: 0, texto: 'P0000003D' }), HOY).items[0];
  assert.deepEqual([fila?.nif, fila?.nombre, fila?.seguido], ['P0000003D', 'P-0000003-D', true]);
});

test('should_normalize_organ_nifs_saved_before_this_version_once', () => {
  const dir = path.join(tmp, 'organos');
  abrirLicitaciones(dir).close();
  const vieja = new Database(path.join(dir, 'licitaciones.db'));
  vieja.exec(`INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, estado, actualizada_en, organo_nombre, organo_nif, cpvs, datos, vista_en)
      VALUES ('p-1', 'a-1', 'perfiles', 'E', 'T', 'RES', '2024-05-06T08:00:00Z', 'Órgano', 'q-28.001 a', ',72000000,', '{}', '2024-05-06');
    INSERT INTO adjudicaciones (licitacion_id, lote, resultado, ord, organo_nif) VALUES ('p-1', '', '9', 0, 'q-28.001 a');
    PRAGMA user_version = 0;`);
  vieja.close();

  const db = abrirLicitaciones(dir);
  const nifs = db
    .prepare('SELECT (SELECT organo_nif FROM licitaciones) AS lic, (SELECT organo_nif FROM adjudicaciones) AS adj')
    .get();
  const version = db.pragma('user_version', { simple: true });
  db.close();

  assert.deepEqual({ ...(nifs as object) }, { lic: 'Q28001A', adj: 'Q28001A' });
  assert.equal(version, ARREGLOS_TOTALES, 'todos los arreglos aplicados');
});

test('should_count_as_open_only_published_tenders_still_in_the_feed_and_on_time', () => {
  const db = dbLicitaciones();
  guardar({ organo: 'Q9400000D', cpv: '72212000', estado: 'PUB' });
  const vencida = guardar({ organo: 'Q9400000D', cpv: '72212000', estado: 'PUB' });
  db.prepare("UPDATE licitaciones SET fecha_limite = '2026-09-01T10:00:00' WHERE id = ?").run(vencida);
  const borrada = licitacion({ organo: 'Q9400000D', cpv: '72212000', estado: 'PUB' });
  guardarLicitacion(db, borrada);
  marcarBorrada(db, borrada.atom_id, '2026-09-20T00:00:00Z', 'anulada');

  const f = fichaOrganismo(db, 'Q9400000D', { solo_sector: false }, HOY).data;

  assert.deepEqual([f?.licitaciones.del_sector, f?.licitaciones.abiertas], [3, 1]);
});

// A la escala de la empresa: banda de importe y territorio de la escala por defecto, nombres y «Ver más».
// Datos propios con NIF B000002xx y órganos Q95…, para no mover las cifras de arriba.
const canaria = (nif: string, nombre: string, presupuesto: number, extra: Partial<Sintetica> = {}) =>
  guardar({
    organo: 'Q9500001E',
    cpv: '72212000',
    nuts: 'ES705',
    ...extra,
    adj: { nif, nombre, importe: presupuesto * 0.9, presupuesto, fecha: '2026-06-01' },
  });

test('should_default_to_the_amount_band_and_region_of_the_ranking_scale', () => {
  const db = dbLicitaciones();
  canaria('B00000201', 'Canaria SL', 50_000);
  canaria('B00000202', 'SISTEMAS EJEMPLO SA', 2_000_000);
  guardar({ organo: 'Q2800001A', cpv: '72212000', adj: datos('B00000203', 'Madrileña SL')(45_000, '2026-06-01') });
  const sinEscala = rankingCompetidores(db, OpcionesCompetidores.parse({}), HOY);
  assert.equal(guardarEscala(db, { region_nuts: 'ES7', banda_min: 7_000, banda_max: 130_000 }).error, null);

  const porDefecto = rankingCompetidores(db, OpcionesCompetidores.parse({}), HOY);
  const todo = rankingCompetidores(db, OpcionesCompetidores.parse({ toda_espana: true, todos_importes: true }), HOY);
  const organos = rankingOrganismos(db, OpcionesOrganismos.parse({}), HOY);

  assert.deepEqual(
    porDefecto.items.map((c) => c.nif),
    ['B00000201'],
  );
  assert.deepEqual(
    [sinEscala.ambito.banda, sinEscala.ambito.nuts],
    [null, null],
    'sin escala, todos los importes y toda España',
  );
  assert.ok(sinEscala.items.some((c) => c.nif === 'B00000202'));
  assert.deepEqual(porDefecto.ambito.banda, { min: 7_000, max: 130_000, origen: 'ajuste' });
  assert.deepEqual([porDefecto.ambito.nuts, porDefecto.ambito.territorio], ['ES7', 'Canarias']);
  assert.ok(['B00000202', 'B00000203', 'B00000002'].every((nif) => todo.items.some((c) => c.nif === nif)));
  assert.deepEqual(
    organos.items.map((o) => o.nif),
    ['Q9500001E'],
  );
  assert.equal(organos.items[0]?.licitaciones, 1, 'la de 2 M€ de Canarias se queda fuera de la banda');
  assert.deepEqual(
    rankingCompetidores(db, OpcionesCompetidores.parse({ importe_min: 1_000_000 }), HOY).items.map((c) => c.nif),
    ['B00000202'],
  );
  assert.ok(
    rankingCompetidores(db, OpcionesCompetidores.parse({ nuts: 'es3', todos_importes: true }), HOY).items.some(
      (c) => c.nif === 'B00000203',
    ),
  );
});

test('should_fall_back_to_the_scale_band_with_fewer_than_5_submissions', () => {
  const db = dbLicitaciones();
  const presentar = db.prepare(
    "INSERT INTO propuestas (licitacion_id, presentada_en, presupuesto, importe_ofertado, creada_en, actualizada_en) VALUES (?, '2026-05-01', ?, ?, '2026-05-01', '2026-05-01')",
  );
  [
    [20_000, null],
    [40_000, null],
    [null, 60_000],
    [80_000, null],
  ].forEach(([p, o], i) => presentar.run(`banda-${i}`, p, o));

  const cuatro = bandaPropia(db);
  presentar.run('banda-4', 100_000, null);
  const cinco = bandaPropia(db);
  const ranking = rankingCompetidores(db, OpcionesCompetidores.parse({}), HOY);
  db.prepare("DELETE FROM propuestas WHERE licitacion_id LIKE 'banda-%'").run();

  assert.deepEqual(
    cuatro,
    { min: 7_000, max: 130_000, origen: 'ajuste' },
    'la de la escala que guardó el test anterior',
  );
  assert.deepEqual(cinco, { min: 28_000, max: 92_000, origen: 'propia' });
  assert.deepEqual(ranking.ambito.banda, cinco);
  assert.deepEqual(
    ranking.items.map((c) => c.nif),
    ['B00000201'],
    'la de 50.000 € entra en 28-92 mil',
  );
});

test('should_merge_unnormalized_company_names_with_same_nif', () => {
  const db = dbLicitaciones();
  canaria('b-0000020.4', 'EMPRESA EJEMPLO SA', 30_000);
  canaria('B00000204', 'Soluciones Ejemplo de Informática, S.A.', 40_000);

  const filas = rankingCompetidores(db, OpcionesCompetidores.parse({}), HOY).items.filter((c) => c.nif === 'B00000204');

  assert.equal(filas.length, 1);
  assert.equal(filas[0]?.contratos, 2);
  assert.equal(filas[0]?.nombre, 'Soluciones Ejemplo de Informática');
  assert.equal(nombreEmpresa('SISTEMAS EJEMPLO SA'), 'Sistemas Ejemplo');
  assert.equal(nombreEmpresa('empresa ejemplo s.l.u.'), 'Empresa Ejemplo');
  assert.equal(nombreEmpresa('  '), null);
  assert.equal(nombreOrgano('Ayuntamiento de Villaeste - Junta de Gobierno Local'), 'Ayuntamiento de Villaeste');
  assert.equal(nombreOrgano('CABILDO INSULAR DE ISLA EJEMPLO'), 'Cabildo Insular de Isla Ejemplo');
  assert.equal(
    nombreOrgano('Gerencia de Servicios Sanitarios - Área de Salud'),
    'Gerencia de Servicios Sanitarios - Área de Salud',
  );
});

test('should_page_with_next_offset', async () => {
  const db = dbLicitaciones();
  const pagina = (desde: number) => rankingCompetidores(db, OpcionesCompetidores.parse({ limite: 1, desde }), HOY);
  const organos = (desde: number) =>
    rankingOrganismos(db, OpcionesOrganismos.parse({ limite: 1, desde, toda_espana: true }), HOY);

  const primera = pagina(0);
  const segunda = pagina(primera.siguiente ?? 0);
  const ultima = pagina(primera.total - 1);
  const http1 = await fetch(`${base}/competidores?limite=1&desde=1`);
  const malNuts = await fetch(`${base}/competidores?nuts=es%25`);

  assert.equal(primera.total, 2);
  assert.deepEqual([primera.desde, primera.siguiente, segunda.siguiente, ultima.siguiente], [0, 1, null, null]);
  assert.notEqual(primera.items[0]?.nif, segunda.items[0]?.nif);
  assert.equal(organos(0).siguiente, 1);
  assert.notEqual(organos(0).items[0]?.nif, organos(1).items[0]?.nif);
  assert.equal(http1.status, 200);
  assert.deepEqual(((await http1.json()) as { desde: number; siguiente: number | null }).desde, 1);
  assert.equal(malNuts.status, 400);
});

test('should_count_a_framework_agreement_lot_as_a_contract_but_not_add_its_ceiling_to_the_amount', async () => {
  const { licitacionSintetica, resultadoSintetico } = await import('../helpers/licitacion.js');
  // Un CPV que no usa ningún otro dato del fichero aísla este caso en la base compartida.
  const db = dbLicitaciones();
  const organo = { nombre: 'Agencia Ejemplo', nif: 'Q2800009J', dir3: null, ciudad: null };
  const ganadora = (nif: string, importe: number) =>
    resultadoSintetico({
      lote: '1',
      fecha: '2026-09-01',
      adjudicatario_nif: nif,
      importe_sin_iva: importe,
      ofertas: 12,
    });
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-am',
      cpvs: ['72267100'],
      presupuesto_sin_iva: null,
      organo,
      actualizada_en: '2026-09-01T10:00:00Z',
      resultados: [ganadora('B00000091', 5_000_000), ganadora('B00000092', 5_000_000)],
    }),
  );
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-normal',
      cpvs: ['72267100'],
      organo,
      actualizada_en: '2026-09-01T10:00:00Z',
      resultados: [
        resultadoSintetico({ fecha: '2026-09-01', adjudicatario_nif: 'B00000091', importe_sin_iva: 80_000 }),
      ],
    }),
  );

  const competidores = rankingCompetidores(db, opcionesC({ cpv: ['72267100'] }), HOY);
  const organismos = rankingOrganismos(db, opcionesO({ cpv: ['72267100'] }), HOY);
  const ficha = fichaCompetidor(db, 'B00000091', { solo_sector: true });

  assert.deepEqual(
    competidores.items.map((c) => [c.nif, c.contratos, c.importe]),
    [
      ['B00000091', 2, 80_000],
      ['B00000092', 1, 0],
    ],
  );
  assert.deepEqual(
    organismos.items.map((o) => [o.nif, o.adjudicaciones, o.importe_adjudicado]),
    [['Q2800009J', 3, 80_000]],
  );
  assert.equal(ficha.data?.resumen.importe, 80_000);
  assert.equal(
    ficha.data?.ultimos.find((c) => c.licitacion_id === 'p-am')?.importe,
    5_000_000,
    'la fila del contrato enseña lo publicado',
  );
});
