// Índices de mercado: cada fórmula con un caso pequeño calculado a mano y, sobre una base
// sintética, el retroceso del CPV, la caché por segmento, los licitadores probables con sus
// nombres, la concentración del órgano, los contratos y los vencimientos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirLicitaciones, guardarLicitacion } from '../../src/dominios/licitaciones/store.js';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { guardarOrganizacion } from '../../src/nucleo/organizaciones.js';
import { guardarParticipacion } from '../../src/dominios/licitaciones/participaciones.js';
import * as calc from '../../src/dominios/licitaciones/indices/calculo.js';
import { prefijosRetroceso } from '../../src/dominios/licitaciones/indices/comparables.js';
import {
  indicesDeLicitacion,
  reiniciarNocheIndices,
  resumenIndices,
  vueltaIndices,
} from '../../src/dominios/licitaciones/indices/index.js';
import {
  antelacionDe,
  vencimientos,
  OpcionesVencimientos,
} from '../../src/dominios/licitaciones/indices/vencimientos.js';
import { licitacionSintetica, resultadoSintetico } from '../helpers/licitacion.js';

const AHORA = Date.now();
const DIA = 86_400_000;
const hace = (dias: number) => new Date(AHORA - dias * DIA).toISOString().slice(0, 10);

const comp = (x: Partial<calc.Comparable>): calc.Comparable => ({
  licitacion_id: 'p',
  lote: '',
  ofertas: null,
  baja: null,
  fecha: hace(10),
  organo_nif: null,
  adjudicatario_nif: null,
  peso: 1,
  mismo_organo: false,
  ...x,
});

test('should_halve_the_weight_every_two_years', () => {
  const ref = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(calc.pesoAntiguedad('2026-01-01', ref), 1);
  assert.ok(Math.abs(calc.pesoAntiguedad('2024-01-01', ref) - 0.5) < 0.001);
  assert.ok(Math.abs(calc.pesoAntiguedad('2022-01-01', ref) - 0.25) < 0.001);
  assert.equal(calc.pesoAntiguedad(null, ref), 0);
});

test('should_take_the_first_value_whose_cumulative_weight_reaches_the_percentile', () => {
  const datos = [
    { valor: 1, peso: 1 },
    { valor: 2, peso: 1 },
    { valor: 10, peso: 2 },
  ];
  assert.equal(calc.percentilPonderado(datos, 0.25), 1);
  assert.equal(calc.percentilPonderado(datos, 0.5), 2);
  assert.equal(calc.percentilPonderado(datos, 0.75), 10);
  assert.equal(calc.percentilPonderado([], 0.5), null);
});

test('should_expect_the_weighted_median_of_offers_and_the_share_with_one_bidder', () => {
  const c = calc.competencia([1, 2, 3, 4, 5].map((ofertas) => comp({ ofertas })));
  assert.equal(c.ofertas, 3);
  assert.deepEqual(c.rango, { p25: 2, p50: 3, p75: 4 });
  assert.equal(c.p_un_licitador, 0.2);
  assert.equal(c.ajustado_por_organo, false);
});

test('should_blend_the_organ_median_when_it_has_five_or_more_comparables', () => {
  // med_C = 5 (20 de 5 y 5 de 1), med_o = 1 con n_o = 5: (5·1 + 10·5) / 15 = 3,67.
  const c = calc.competencia([
    ...Array.from({ length: 5 }, () => comp({ ofertas: 1, mismo_organo: true })),
    ...Array.from({ length: 20 }, () => comp({ ofertas: 5 })),
  ]);
  assert.equal(c.ofertas, 3.7);
  assert.equal(c.n_organo, 5);
  assert.equal(c.ajustado_por_organo, true);
});

test('should_weigh_the_median_discount_of_each_offer_band_by_its_probability', () => {
  // P(1) = P(2-3) = 0,5; mediana del tramo 1 = 0; del 2-3 = 0,10: b̂ = 0,05.
  const b = calc.baja(
    [
      comp({ ofertas: 1, baja: 0 }),
      comp({ ofertas: 1, baja: 0.02 }),
      comp({ ofertas: 3, baja: 0.1 }),
      comp({ ofertas: 3, baja: 0.2 }),
    ],
    2,
  );
  assert.equal(b.esperada, 0.05);
  assert.deepEqual(
    b.tramos.filter((t) => t.probabilidad).map((t) => [t.tramo, t.probabilidad, t.mediana]),
    [
      ['1', 0.5, 0],
      ['2-3', 0.5, 0.1],
    ],
  );
  assert.equal(b.rango.p50, 0.02);
  assert.notEqual(b.umbral_anormal, null);
});

test('should_grade_confidence_by_sample_size_and_cpv_depth', () => {
  assert.equal(calc.confianza(35, 4), 'alta');
  assert.equal(calc.confianza(35, 3), 'media');
  assert.equal(calc.confianza(15, 8), 'media');
  assert.equal(calc.confianza(9, 8), 'baja');
  assert.equal(calc.confianza(100, 2), 'baja');
});

test('should_score_likely_bidders_double_for_wins_and_more_in_the_same_organ', () => {
  const comparables = [
    comp({ licitacion_id: 'a', peso: 1, mismo_organo: true, baja: 0.1 }),
    comp({ licitacion_id: 'b', peso: 0.5, baja: 0.2 }),
  ];
  const p = calc.licitadoresProbables(comparables, [
    { licitacion_id: 'a', lote: '', empresa_nif: 'X', rol: 'adjudicataria', fecha: '2026-01-01' },
    { licitacion_id: 'b', lote: '', empresa_nif: 'X', rol: 'licitadora', fecha: '2025-01-01' },
    { licitacion_id: 'b', lote: '', empresa_nif: 'Y', rol: 'adjudicataria', fecha: '2025-01-01' },
    { licitacion_id: 'b', lote: '', empresa_nif: 'Z', rol: 'excluida', fecha: '2025-01-01' },
    { licitacion_id: 'otra', lote: '', empresa_nif: 'W', rol: 'adjudicataria', fecha: '2025-01-01' },
  ]);
  // X: 2·1·1,5 + 1·0,5 = 3,5; Y: 2·0,5 = 1.
  assert.deepEqual(
    p.map((e) => [e.nif, e.puntos, e.ganadas, e.presentadas, e.ganadas_organo, e.baja_media]),
    [
      ['X', 3.5, 1, 2, 1, 0.1],
      ['Y', 1, 1, 1, 0, 0.2],
    ],
  );
});

test('should_measure_the_organ_concentration_with_the_top_share_and_hhi', () => {
  const c = calc.concentracion([
    { adjudicatario_nif: 'X', importe: 400, fecha: '2026-01-01' },
    { adjudicatario_nif: 'X', importe: 200, fecha: '2025-06-01' },
    { adjudicatario_nif: 'Y', importe: 300, fecha: '2025-01-01' },
    { adjudicatario_nif: 'Z', importe: 100, fecha: '2024-01-01' },
  ]);
  assert.deepEqual(c.primero, { nif: 'X', cuota: 0.6 });
  assert.equal(c.hhi, 4600);
  assert.equal(c.nivel, 'alta');
  assert.deepEqual(c.ultimas, { ganadas_primero: 2, de: 4 });
});

test('should_back_off_the_cpv_from_eight_digits_to_two_without_repeating_zero_padding', () => {
  assert.deepEqual(prefijosRetroceso('72267111'), ['72267111', '722671', '7226', '722', '72']);
  assert.deepEqual(prefijosRetroceso('72267100'), ['722671', '7226', '722', '72']);
  assert.deepEqual(prefijosRetroceso('72000000'), ['72']);
  assert.deepEqual(prefijosRetroceso('72267000'), ['72267', '7226', '722', '72']);
});

test('should_write_the_summary_line_the_header_shows', () => {
  const c = calc.competencia([1, 2, 3, 4, 5, 3, 3, 4].map((ofertas) => comp({ ofertas })));
  assert.equal(
    resumenIndices(c, 4, 41, 'media'),
    '3 ofertas esperadas (2-4) · 1 de cada 8 con un solo licitador · n = 41, CPV 4 dígitos, confianza media',
  );
});

test('should_estimate_when_a_contract_will_be_tendered_again_from_the_organ_history', () => {
  assert.deepEqual(antelacionDe([]), { meses: 4, ediciones: 0, confianza: 'baja' });
  assert.deepEqual(antelacionDe([3]), { meses: 3, ediciones: 1, confianza: 'media' });
  assert.deepEqual(antelacionDe([2, 6, 5]), { meses: 5, ediciones: 3, confianza: 'alta' });
});

// ─── Sobre la base ───────────────────────────────────────────────────────────

const ORGANO = 'Q0000001H';
function base() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'indices-'));
  const dbNucleo = abrirNucleo(dir);
  return { db: abrirLicitaciones(dir), dbNucleo };
}

function adjudicada(
  db: ReturnType<typeof abrirLicitaciones>,
  i: number,
  cpv: string,
  x: { organo?: string; ofertas?: number; nif?: string; nombre?: string; dias?: number; importe?: number } = {},
) {
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: `p-c${i}`,
      cpvs: [cpv],
      actualizada_en: `${hace(x.dias ?? 100 + i)}T10:00:00Z`,
      organo: {
        nombre: x.organo === ORGANO ? 'Cabildo' : 'Otro órgano',
        nif: x.organo ?? 'Q2800001A',
        dir3: null,
        ciudad: null,
      },
      resultados: [
        resultadoSintetico({
          fecha: hace(x.dias ?? 100 + i),
          ofertas: x.ofertas ?? 3,
          importe_sin_iva: x.importe ?? 90_000,
          adjudicatario_nif: x.nif ?? 'B12345674',
          adjudicatario_nombre: x.nombre ?? 'SISTEMAS EJEMPLO SA',
        }),
      ],
      duracion: { valor: 1, unidad: 'ANN' },
    }),
  );
}

test('should_compute_indices_with_cpv_backoff_names_concentration_and_cache', () => {
  const { db, dbNucleo } = base();
  guardarOrganizacion(dbNucleo, { nif: 'B12345674', nombre: 'SISTEMAS EJEMPLO SA', tipo: 'empresa' });
  for (let i = 0; i < 12; i++) adjudicada(db, i, '72267000', { ofertas: 2 + (i % 3) });
  for (let i = 12; i < 27; i++)
    adjudicada(db, i, '72261000', {
      ofertas: 4,
      organo: i < 18 ? ORGANO : undefined,
      nif: i < 16 ? 'A00000075' : 'B12345674',
      nombre: 'Analítica Ejemplo SL',
    });
  adjudicada(db, 99, '45000000');
  guardarParticipacion(db, {
    licitacion_id: 'p-c1',
    lote: '',
    empresa_nif: '12345678Z',
    empresa_nombre: 'Juana',
    rol: 'licitadora',
    importe_ofertado: 95_000,
    puntos_tecnicos: null,
    puntos_economicos: null,
    fuente: 'acta',
    confianza: 0.6,
  });
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-abierta',
      estado: 'PUB',
      cpvs: ['72267000'],
      organo: { nombre: 'Cabildo', nif: ORGANO, dir3: null, ciudad: null },
      resultados: [],
    }),
  );

  const r = indicesDeLicitacion(db, 'p-abierta', {}, AHORA);

  assert.equal(r.error, null);
  const i = r.data!;
  assert.equal(i.muestra.cpv, '7226');
  assert.equal(i.muestra.n, 27);
  assert.equal(i.muestra.n_organo, 6);
  assert.equal(i.confianza, 'media');
  assert.equal(i.competencia.ajustado_por_organo, true);
  assert.match(i.resumen, /ofertas esperadas .* n = 27, CPV 4 dígitos, confianza media$/);
  assert.equal(i.licitadores[0]?.nombre, 'Sistemas Ejemplo');
  const persona = i.licitadores.find((l) => l.nif === '12345678Z');
  assert.deepEqual([persona?.nombre, persona?.persona_fisica], [null, true]);
  assert.match(i.licitadores[0]?.evidencia ?? '', /^ganó \d+ parecidas/);
  assert.equal(i.concentracion?.primero?.nif, 'A00000075');
  assert.match(i.concentracion?.texto ?? '', /^Órgano concentrado: .* ganó 4 de las últimas 6$/);
  assert.equal(i.de_cache, false);
  assert.equal(indicesDeLicitacion(db, 'p-abierta', {}, AHORA).data?.de_cache, true);
  assert.equal(indicesDeLicitacion(db, 'p-no-existe').error?.code, 'not_found');

  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES ('p-abierta', 'nueva', 'x', 'x')",
  ).run();
  reiniciarNocheIndices();
  const noche = Date.parse(`${new Date(AHORA).toISOString().slice(0, 10)}T03:00:00Z`);
  assert.equal(vueltaIndices(db, noche), 1);
  assert.equal(vueltaIndices(db, noche + 60_000), 0, 'una vez por noche');
});

test('should_list_our_market_contracts_ending_soon_with_the_expected_new_tender', () => {
  const { db } = base();
  // Contrato de un año adjudicado hace 200 días: acaba en unos 165 días.
  adjudicada(db, 1, '72267000', { organo: ORGANO, dias: 200 });
  adjudicada(db, 2, '45000000', { organo: ORGANO, dias: 200 });
  // Una edición anterior del órgano: acabó hace 400 días y la siguiente salió 3 meses antes.
  adjudicada(db, 3, '72267000', { organo: ORGANO, dias: 765 });
  const fin = db.prepare("SELECT fin_estimado FROM contratos WHERE licitacion_id = 'p-c3'").get() as {
    fin_estimado: string;
  };
  const salida = new Date(Date.parse(fin.fin_estimado) - 91 * DIA).toISOString();
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-siguiente',
      cpvs: ['72267000'],
      publicada_en: salida,
      organo: { nombre: 'Cabildo', nif: ORGANO, dir3: null, ciudad: null },
    }),
  );

  const v = vencimientos(db, OpcionesVencimientos.parse({}), AHORA);

  assert.equal(v.total, 1);
  const c = v.items[0]!;
  assert.equal(c.licitacion_id, 'p-c1');
  assert.equal(c.adjudicatario, 'Sistemas Ejemplo');
  assert.equal(c.ediciones, 1);
  assert.equal(c.confianza, 'media');
  assert.ok(Math.abs(c.antelacion_meses - 3) <= 0.1, String(c.antelacion_meses));
  assert.ok(c.salida_esperada < c.fin_estimado);
});

test('should_leave_awards_with_quality_incidents_out_of_the_organ_concentration', () => {
  const { db } = base();
  const adj = (id: string, nif: string, importe: number) =>
    guardarLicitacion(
      db,
      licitacionSintetica({
        id,
        cpvs: ['72267000'],
        presupuesto_sin_iva: 100_000,
        actualizada_en: `${hace(40)}T10:00:00Z`,
        organo: { nombre: 'Cabildo', nif: ORGANO, dir3: null, ciudad: null },
        resultados: [resultadoSintetico({ fecha: hace(40), adjudicatario_nif: nif, importe_sin_iva: importe })],
      }),
    );
  adj('p-roto', 'A00000075', 900_000);
  adj('p-bien', 'B12345674', 80_000);
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-abierta',
      estado: 'PUB',
      cpvs: ['72267000'],
      organo: { nombre: 'Cabildo', nif: ORGANO, dir3: null, ciudad: null },
      resultados: [],
    }),
  );

  const c = indicesDeLicitacion(db, 'p-abierta', {}, AHORA).data?.concentracion;

  assert.equal(c?.contratos, 1);
  assert.deepEqual(c?.primero, { nif: 'B12345674', cuota: 1 });
});

test('should_use_the_tender_threshold_over_article_85_when_the_guion_sets_it', async () => {
  const { leerFixtureComprobaciones } = await import('../helpers/comprobacionesFixtures.js');
  const { db } = base();
  guardarLicitacion(db, licitacionSintetica({ id: 'p-con-pliego', estado: 'PUB', cpvs: ['72267000'], resultados: [] }));
  const sinGuion = indicesDeLicitacion(db, 'p-con-pliego', {}, AHORA).data!;
  assert.equal(sinGuion.baja.regla_umbral, 'art85');

  const guion = structuredClone(leerFixtureComprobaciones('casoD').guiones.at(-1)!.datos) as {
    ofertas_economicas: { lotes: string[]; umbral_baja: number | null; umbral_anormalidad: string | null }[];
  };
  guion.ofertas_economicas = [
    {
      lotes: [],
      umbral_baja: 0.15,
      umbral_anormalidad: 'Inferior en más de un 15 % al presupuesto',
      formula: 'P = 45 × Bmin / B',
      presupuesto_base: 100_000,
      impuesto_aparte: null,
      modelo: null,
      archivo: 'PCAP.pdf',
      precios_unitarios: [],
    } as never,
  ];
  db.prepare(
    "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES ('p-con-pliego', 1, ?, 'oferta-licitaciones', 1, ?)",
  ).run(JSON.stringify(guion), new Date().toISOString());

  const b = indicesDeLicitacion(db, 'p-con-pliego', {}, AHORA).data!.baja;

  assert.deepEqual(
    [b.umbral_anormal, b.regla_umbral, b.umbral_literal],
    [0.15, 'pliego', 'Inferior en más de un 15 % al presupuesto'],
  );
});

test('should_not_call_an_organ_concentrated_with_fewer_than_four_contracts', () => {
  const { db } = base();
  adjudicada(db, 1, '72267000', { organo: ORGANO, dias: 40 });
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-abierta',
      estado: 'PUB',
      cpvs: ['72267000'],
      organo: { nombre: 'Cabildo', nif: ORGANO, dir3: null, ciudad: null },
      resultados: [],
    }),
  );
  const c = indicesDeLicitacion(db, 'p-abierta', {}, AHORA).data?.concentracion;
  assert.deepEqual([c?.primero?.cuota, c?.concentrado, c?.texto], [1, false, null]);
});

test('should_not_count_as_previous_edition_a_tender_published_after_the_contract_ended', () => {
  const { db } = base();
  adjudicada(db, 1, '72267000', { organo: ORGANO, dias: 200 });
  // Un contrato del órgano que acabó hace 400 días y otro publicado 30 días después de su fin: no es su edición.
  adjudicada(db, 3, '72267000', { organo: ORGANO, dias: 765 });
  const fin = db.prepare("SELECT fin_estimado FROM contratos WHERE licitacion_id = 'p-c3'").get() as {
    fin_estimado: string;
  };
  guardarLicitacion(
    db,
    licitacionSintetica({
      id: 'p-tarde',
      cpvs: ['72267000'],
      publicada_en: new Date(Date.parse(fin.fin_estimado) + 30 * DIA).toISOString(),
      organo: { nombre: 'Cabildo', nif: ORGANO, dir3: null, ciudad: null },
    }),
  );

  const v = vencimientos(db, OpcionesVencimientos.parse({}), AHORA).items[0]!;

  assert.deepEqual([v.ediciones, v.confianza, v.antelacion_meses], [0, 'baja', 4]);
});
