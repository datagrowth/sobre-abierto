// Modelo de bajas con datos sintéticos: percentiles, retroceso de segmento hasta la
// muestra mínima, exclusión de bajas imposibles, regla de oferta anormalmente baja del
// art. 85 RGLCAP por número de ofertas, escenarios y comparables.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirLicitaciones, type Db } from '../../src/dominios/licitaciones/store.js';
import { percentiles } from '../../src/nucleo/estadistica.js';
import { proporcionHasta, resumir, tramoDeOfertas } from '../../src/dominios/licitaciones/precios/estadistica.js';
import {
  elegirSegmento,
  niveles,
  prefijosCpv,
  type Consulta,
} from '../../src/dominios/licitaciones/precios/segmento.js';
import { esAnormal, escenarios, umbralAnormal } from '../../src/dominios/licitaciones/precios/escenarios.js';
import { comparables } from '../../src/dominios/licitaciones/precios/comparables.js';
import {
  calcularPrecios,
  comparablesDeLicitacion,
  OpcionesPrecios,
  preciosDeLicitacion,
} from '../../src/dominios/licitaciones/precios/index.js';
import { guardarLicitacion } from '../../src/dominios/licitaciones/store.js';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'precios-'));
let db: Db;
let dir = 0;
let n = 0;

beforeEach(() => {
  db?.close();
  dir += 1;
  db = abrirLicitaciones(path.join(tmp, String(dir)));
});

after(() => {
  db?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

type Sintetica = {
  cpv: string;
  baja: number;
  presupuesto?: number;
  tipo?: string;
  proc?: string;
  organo?: string;
  ofertas?: number;
  anio?: number;
  adjudicatario?: string;
};

function adjudicada(s: Sintetica): string {
  n += 1;
  const id = `p-${n}`;
  const presupuesto = s.presupuesto ?? 100_000;
  const fecha = `${s.anio ?? 2025}-06-01`;
  db.prepare(
    `INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, url, estado, actualizada_en, organo_nombre, organo_nif,
      tipo_contrato, procedimiento, presupuesto_sin_iva, cpvs, datos, vista_en)
    VALUES (?, ?, 'perfiles', ?, ?, ?, 'RES', ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
  ).run(
    id,
    `atom-${n}`,
    `EXP-${n}`,
    `Contrato ${n}`,
    `https://contrataciondelestado.es/${n}`,
    `${fecha}T10:00:00Z`,
    `Órgano ${s.organo ?? 'X'}`,
    s.organo ?? 'Q0000000X',
    s.tipo ?? '2',
    s.proc ?? '1',
    presupuesto,
    `,${s.cpv},`,
    fecha,
  );
  db.prepare(
    `INSERT INTO adjudicaciones (licitacion_id, lote, resultado, fecha, ofertas, adjudicatario_nif, adjudicatario_nombre,
      importe_sin_iva, presupuesto_sin_iva, baja, ord) VALUES (?, '', '9', ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    id,
    fecha,
    s.ofertas ?? null,
    'B00000000',
    s.adjudicatario ?? 'Empresa SL',
    presupuesto * (1 - s.baja),
    presupuesto,
    s.baja,
  );
  return id;
}

function varias(
  cuantas: number,
  s: Omit<Sintetica, 'baja'>,
  baja: (i: number) => number = (i) => 0.1 + (i % 10) / 100,
): void {
  for (let i = 0; i < cuantas; i += 1) adjudicada({ ...s, baja: baja(i) });
}

const consulta = (c: Partial<Consulta> = {}): Consulta => ({
  cpv: '72212100',
  presupuesto: 100_000,
  tipo: '2',
  procedimiento: '1',
  organo: null,
  mismo_organo: false,
  ofertas: null,
  excluir: null,
  ...c,
});

test('should_count_the_empirical_share_up_to_a_discount', () => {
  const ordenados = [0.1, 0.2, 0.3, 0.4, 0.5];
  assert.equal(proporcionHasta(ordenados, 0.3), 0.6);
  assert.equal(proporcionHasta(ordenados, 0.05), 0);
});

test('should_summarise_an_empty_or_single_sample_without_failing', () => {
  const vacia = resumir([]);
  assert.equal(vacia.n, 0);
  assert.equal(vacia.media, null);
  assert.equal(vacia.desviacion, null);
  const una = resumir([{ baja: 0.12, anio: 2024, ofertas: 3 }]);
  assert.equal(una.percentiles.p50, 0.12);
  assert.equal(una.desviacion, null, 'con una sola observación no hay dispersión');
  assert.deepEqual(una.por_ofertas, [{ clave: '2-3', n: 1, mediana: 0.12, media: 0.12 }]);
});

test('should_report_yearly_trend_and_offers_relation', () => {
  const obs = [2021, 2022, 2023, 2024].flatMap((anio, i) => [
    { baja: 0.1 + i * 0.02, anio, ofertas: 2 },
    { baja: 0.2 + i * 0.02, anio, ofertas: 8 },
  ]);
  const r = resumir(obs);
  assert.deepEqual(
    r.por_anio.map((g) => g.clave),
    ['2021', '2022', '2023', '2024'],
  );
  assert.equal(r.tendencia_anual, 0.02);
  assert.deepEqual(
    r.por_ofertas.map((g) => [g.clave, g.n]),
    [
      ['2-3', 4],
      ['6-10', 4],
    ],
  );
  assert.equal(tramoDeOfertas(0), null);
  assert.equal(tramoDeOfertas(14), '11+');
});

test('should_list_cpv_prefixes_without_repeating_trailing_zeros', () => {
  assert.deepEqual(prefijosCpv('72212100'), ['72212100', '72212', '7221', '722', '72']);
  assert.deepEqual(prefijosCpv('72212000'), ['72212', '7221', '722', '72']);
  assert.deepEqual(prefijosCpv('72000000'), ['72']);
  assert.deepEqual(prefijosCpv('30000000'), ['30']);
});

test('should_merge_levels_when_the_query_lacks_a_field', () => {
  const sinProc = niveles(consulta({ procedimiento: null, presupuesto: null, cpv: '72000000' }));
  assert.deepEqual(sinProc, [
    { cpv: '72', tipo: true, proc: false, banda: false },
    { cpv: null, tipo: true, proc: false, banda: false },
    { cpv: null, tipo: false, proc: false, banda: false },
  ]);
});

test('should_fall_back_from_the_finest_segment_until_reaching_the_minimum_sample', () => {
  varias(5, { cpv: '72212100' });
  varias(10, { cpv: '72212200', proc: '9' });
  varias(10, { cpv: '72212300', presupuesto: 1_000_000 });
  varias(30, { cpv: '45000000', tipo: '3' });

  const { segmento, observaciones } = elegirSegmento(db, consulta(), 20);

  assert.equal(segmento.n, 25);
  assert.equal(observaciones.length, 25);
  assert.equal(segmento.suficiente, true);
  assert.equal(segmento.descripcion, 'CPV 72212… · Servicios');
  assert.deepEqual(
    segmento.probados.map((p) => p.n),
    [5, 5, 5, 5, 15, 25],
  );
});

test('should_stop_at_the_finest_segment_when_it_already_has_enough_data', () => {
  varias(20, { cpv: '72212100' });
  varias(50, { cpv: '72000000', presupuesto: 5_000_000 });
  const { segmento } = elegirSegmento(db, consulta(), 20);
  assert.equal(segmento.probados.length, 1);
  assert.equal(segmento.descripcion, 'CPV 72212100 · Servicios · Abierto · 33.333–300.000 €');
  assert.equal(segmento.importe_min, 100_000 / 3);
});

test('should_use_the_most_general_segment_and_say_it_is_not_enough_when_data_is_scarce', () => {
  varias(3, { cpv: '72212100' });
  varias(2, { cpv: '45000000', tipo: '3' });
  const { segmento } = elegirSegmento(db, consulta(), 20);
  assert.equal(segmento.suficiente, false);
  assert.equal(segmento.n, 5);
  assert.equal(segmento.descripcion, 'todos los CPV');
});

test('should_exclude_impossible_discounts_and_count_them', () => {
  varias(20, { cpv: '72212100' });
  adjudicada({ cpv: '72212100', baja: -0.12 });
  adjudicada({ cpv: '72212100', baja: 0.85 });
  adjudicada({ cpv: '72212100', baja: 0, ofertas: 4 });
  adjudicada({ cpv: '72212100', baja: 0, ofertas: 1 });
  const { segmento, observaciones } = elegirSegmento(db, consulta(), 20);
  assert.equal(segmento.n, 21, 'una baja 0 con un solo licitador sí cuenta');
  assert.equal(segmento.excluidas, 3, 'negativa, más del 70 % y 0 con cuatro ofertas (presupuesto máximo, no oferta)');
  assert.ok(observaciones.every((o) => o.baja >= 0 && o.baja <= 0.7));
});

test('should_never_count_the_tender_being_studied_and_can_restrict_to_the_same_body', () => {
  const propia = adjudicada({ cpv: '72212100', baja: 0.5, organo: 'A' });
  varias(4, { cpv: '72212100', organo: 'A' });
  varias(20, { cpv: '72212100', organo: 'B' });
  const mismo = elegirSegmento(db, consulta({ organo: 'A', mismo_organo: true, excluir: propia }), 3);
  assert.equal(mismo.segmento.n, 4);
  assert.match(mismo.segmento.descripcion, /mismo órgano/);
  assert.ok(mismo.observaciones.every((o) => o.baja < 0.5));
});

test('should_filter_by_offers_bracket_only_when_asked', () => {
  varias(20, { cpv: '72212100', ofertas: 2 });
  varias(20, { cpv: '72212100', ofertas: 9 });
  assert.equal(elegirSegmento(db, consulta(), 20).segmento.n, 40);
  const tramo = elegirSegmento(db, consulta({ ofertas: 7 }), 20);
  assert.equal(tramo.segmento.n, 20);
  assert.match(tramo.segmento.descripcion, /6-10 ofertas/);
});

test('should_flag_abnormally_low_offers_with_the_rule_for_each_number_of_bidders', () => {
  // 1 licitador: más de 25 puntos por debajo del presupuesto.
  assert.equal(esAnormal([74], 0, 100), true);
  assert.equal(esAnormal([76], 0, 100), false);
  // 2: más de 20 puntos por debajo de la otra.
  assert.equal(esAnormal([79, 100], 0, 100), true);
  assert.equal(esAnormal([81, 100], 0, 100), false);
  // 3: más de 10 puntos por debajo de la media, sin la más alta si se dispara; y siempre más de 25.
  assert.equal(esAnormal([80, 95, 100], 0, 120), true);
  assert.equal(esAnormal([85, 90, 130], 0, 100), false, 'la de 130 no cuenta para la media');
  assert.equal(esAnormal([70, 72, 74], 0, 100), true, 'baja de más de 25 puntos');
  // 4 o más: media corregida sin las que superan la media en más de 10 puntos.
  assert.equal(esAnormal([70, 90, 92, 95], 0, 100), true);
  assert.equal(esAnormal([80, 90, 92, 150], 0, 150), false);
  assert.equal(esAnormal([80, 85, 200, 210], 0, 210), true, 'si quedan menos de tres, media de las tres más baratas');
});

test('should_compute_the_discount_from_which_an_offer_becomes_abnormal', () => {
  assert.equal(umbralAnormal(1, 0), 0.251);
  // Con 2 ofertas y la otra a la baja mediana del 10 %: 20 puntos bajo 90 = 72 → baja del 28 %.
  assert.equal(umbralAnormal(2, 0.1), 0.281);
  // Con 5 y el resto al 10 %, la oferta de la empresa arrastra la media hacia abajo: 0,82·p < 0,648 → baja del 21 %.
  assert.equal(umbralAnormal(5, 0.1), 0.21);
});

test('should_build_offer_scenarios_with_amount_empirical_probability_and_warning', () => {
  const ordenadas = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4];
  const e = escenarios({
    presupuesto: 200_000,
    percentiles: percentiles(ordenadas),
    bajas: [0.3],
    ordenadas,
    ofertas: 1,
  });
  const propuesta = e.filas.find((f) => f.etiqueta === 'propuesta');
  assert.deepEqual(propuesta, {
    etiqueta: 'propuesta',
    baja: 0.3,
    importe: 140_000,
    importe_unidad: null,
    ganadas_con_menos: 0.75,
    anormal: true,
  });
  assert.deepEqual(
    e.filas.map((f) => f.etiqueta),
    ['p10', 'p25', 'p50', 'propuesta', 'p75', 'p90'],
  );
  assert.equal(e.umbral_anormal, 0.251);
  assert.equal(e.filas[0]?.anormal, false);
  assert.equal(e.regla, 'art85', 'sin umbral del pliego, la regla supletoria');
});

test('should_return_statistics_and_scenarios_for_a_segment_query', () => {
  varias(30, { cpv: '72212100', ofertas: 4 });
  const opciones = OpcionesPrecios.parse({ bajas: [0.12] });
  const p = calcularPrecios(db, consulta(), opciones, 20);
  assert.equal(p.estadistica.n, 30);
  assert.equal(p.escenarios?.ofertas_esperadas, 4, 'por defecto, la mediana de ofertas del segmento');
  assert.equal(p.escenarios?.filas.length, 6);
  assert.match(p.nota, /manda lo que diga el pliego/);
  const sinPresupuesto = calcularPrecios(db, consulta({ presupuesto: null }), opciones, 20);
  assert.equal(sinPresupuesto.escenarios, null, 'sin presupuesto no hay importes que calcular');
});

test('should_list_comparables_with_the_same_body_first_then_closest_cpv', () => {
  adjudicada({ cpv: '72212100', baja: 0.1, organo: 'B', anio: 2025, adjudicatario: 'Exacta SL' });
  adjudicada({ cpv: '72600000', baja: 0.2, organo: 'A', anio: 2020, adjudicatario: 'Mismo órgano SA' });
  adjudicada({ cpv: '72212100', baja: 0.9, organo: 'A', adjudicatario: 'Imposible SL' });
  adjudicada({ cpv: '72212100', baja: 0, ofertas: 5, organo: 'A', adjudicatario: 'Precios unitarios SL' });
  adjudicada({ cpv: '72212100', baja: 0.1, presupuesto: 2_000_000, adjudicatario: 'Grande SA' });
  adjudicada({ cpv: '72212100', baja: 0.1, tipo: '1', adjudicatario: 'Suministros SA' });
  const lista = comparables(db, consulta({ organo: 'A' }), 10);
  assert.deepEqual(
    lista.map((c) => c.adjudicatario_nombre),
    ['Mismo órgano SA', 'Exacta SL'],
  );
  assert.equal(lista[0]?.mismo_organo, true);
  assert.equal(lista[1]?.cpv_comun, '72212100');
  assert.match(lista[0]?.url ?? '', /^https:/);
});

test('should_list_only_the_same_body_when_asked', () => {
  adjudicada({ cpv: '72212100', baja: 0.1, organo: 'B', adjudicatario: 'Otro órgano SL' });
  adjudicada({ cpv: '72600000', baja: 0.2, organo: 'A', adjudicatario: 'Mismo órgano SA' });

  const lista = comparables(db, consulta({ organo: 'A', mismo_organo: true }), 10);

  assert.deepEqual(
    lista.map((c) => c.adjudicatario_nombre),
    ['Mismo órgano SA'],
  );
});

// Una adjudicación de un órgano sin NIF (plataformas agregadas): se reconoce por su nombre normalizado.
function sinNif(id: string, nombre: string, titulo: string): void {
  db.prepare('UPDATE licitaciones SET organo_nif = NULL, organo_norm = ?, titulo = ? WHERE id = ?').run(
    nombre,
    titulo,
    id,
  );
}

test('should_rank_comparables_by_body_name_without_nif_and_then_by_similar_object', () => {
  sinNif(
    adjudicada({ cpv: '72212100', baja: 0.1, anio: 2021, adjudicatario: 'Mismo ayuntamiento SL' }),
    'ayuntamiento de villaejemplo',
    'Limpieza viaria',
  );
  const web = adjudicada({ cpv: '72212100', baja: 0.12, anio: 2022, organo: 'B', adjudicatario: 'Web SL' });
  db.prepare('UPDATE licitaciones SET titulo = ? WHERE id = ?').run(
    'Servicio de mantenimiento de la web municipal 2022',
    web,
  );
  adjudicada({ cpv: '72212100', baja: 0.2, anio: 2025, organo: 'C', adjudicatario: 'Papel SA' });

  const lista = comparables(
    db,
    consulta({
      organo: null,
      organo_norm: 'ayuntamiento de villaejemplo',
      titulo: 'Mantenimiento de la web municipal',
    }),
    10,
  );

  assert.deepEqual(
    lista.map((c) => c.adjudicatario_nombre),
    ['Mismo ayuntamiento SL', 'Web SL', 'Papel SA'],
  );
  assert.deepEqual(
    lista.map((c) => [c.mismo_organo, c.objeto_parecido]),
    [
      [true, false],
      [false, true],
      [false, false],
    ],
  );
  assert.equal(lista[1]?.parecido, 1);
  const solo = comparables(
    db,
    consulta({ organo: null, organo_norm: 'ayuntamiento de villaejemplo', mismo_organo: true }),
    10,
  );
  assert.deepEqual(
    solo.map((c) => c.adjudicatario_nombre),
    ['Mismo ayuntamiento SL'],
  );
  assert.equal(solo[0]?.parecido, null, 'sin título que comparar no hay parecido');
  assert.equal(
    elegirSegmento(db, consulta({ organo: null, organo_norm: 'ayuntamiento de villaejemplo', mismo_organo: true }), 1)
      .segmento.n,
    1,
  );
});

// CASO_E Canarias, lote 2 (p-91000080): 110,25 € por alumno como máximo y anormales las ofertas
// «inferiores en un 15 % al presupuesto base», es decir, por debajo de 93,71 € por alumno.
const UMBRAL_CASO_E =
  'Se considerarán anormalmente bajas las ofertas inferiores en un 15 % al presupuesto base de licitación, IGIC excluido (apartado J).';
const ORDENADAS = [0.02, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];

function guionCasoE(id: string, umbral: string | null): void {
  const datos = {
    archivos: [
      {
        nombre: 'Archivo electrónico único',
        contenido: 'Anexos y oferta económica.',
        documentos: [{ tipo: 'declaracion', nombre: 'Anexo I', obligatorio: true, produce: 'persona' }],
        documento: 'Bases.pdf',
        pagina: 25,
      },
    ],
    memoria: null,
    automaticos: [],
    oferta_economica: {
      formula: 'P = 40 × (Om / O)',
      presupuesto_base: 6_063.75,
      impuesto_aparte: 'IGIC',
      precio_unitario: { unidad: 'alumno', maximo: 110.25 },
      umbral_anormalidad: umbral,
      modelo: 'Anexo VI',
      archivo: 'Archivo electrónico único',
      documento: 'Bases.pdf',
      pagina: 53,
    },
    plazo: { fecha_limite: '2026-10-15T08:00', canal: 'PLACSP' },
    lotes: ['2', '4'],
  };
  db.prepare(
    "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, 'oferta-licitaciones', 1, ?)",
  ).run(id, JSON.stringify(datos), new Date().toISOString());
}

function casoE(umbral: string | null): string {
  const l = licitacion({
    titulo: 'Formación subvencionada FFI (6 lotes)',
    publicada: '2026-09-24',
    presupuesto: 30_000,
    cpv: '80500000',
    lotes: [
      { id: '2', nombre: 'Análisis de datos con hojas de cálculo', importe: 6_063.75 },
      { id: '4', nombre: 'Redes sociales', importe: 756 },
    ],
  });
  // atom_id propio: el de sinteticas («atom-N») choca con el de adjudicada() al pasar un test suelto.
  guardarLicitacion(db, { ...l, atom_id: `atom-casoE-${l.id}` }, 'historico');
  guionCasoE(l.id, umbral);
  varias(8, { cpv: '80500000', presupuesto: 6_000, ofertas: 3 }, (i) => ORDENADAS[i]!);
  return l.id;
}

test('should_use_the_tender_threshold_instead_of_art_85_when_the_outline_has_it', () => {
  const e = escenarios({
    presupuesto: 100_000,
    percentiles: percentiles(ORDENADAS),
    bajas: [0.15, 0.16],
    ordenadas: ORDENADAS,
    ofertas: 1,
    umbralPliego: { baja: 0.15, literal: UMBRAL_CASO_E, cita: 'Bases.pdf, pág. 53' },
  });

  assert.equal(e.regla, 'pliego');
  assert.equal(e.umbral_anormal, 0.15);
  assert.equal(e.cita, 'Bases.pdf, pág. 53');
  assert.deepEqual(
    e.filas.filter((f) => f.etiqueta === 'propuesta').map((f) => [f.baja, f.anormal]),
    [
      [0.15, false],
      [0.16, true],
    ],
    'igualar el 15 % no es anormal; pasarlo, sí',
  );
  assert.equal(
    e.filas.find((f) => f.etiqueta === 'p90')?.anormal,
    true,
    'con el art. 85 y una oferta, un 30 % no pasaría del 25 %; con el pliego, sí',
  );
});

test('should_show_the_literal_threshold_when_there_is_no_number', () => {
  const literal = 'Se aplicará lo previsto en el apartado 22 del cuadro resumen sobre la media de las ofertas.';
  const e = escenarios({
    presupuesto: 100_000,
    percentiles: percentiles(ORDENADAS),
    bajas: [],
    ordenadas: ORDENADAS,
    ofertas: 1,
    umbralPliego: { baja: null, literal },
  });

  assert.equal(e.regla, 'literal');
  assert.equal(e.umbral_literal, literal);
  assert.equal(e.umbral_anormal, umbralAnormal(1, e.baja_resto), 'sin baja que leer, se estima con el art. 85');
  const sinNada = escenarios({
    presupuesto: 100_000,
    percentiles: percentiles(ORDENADAS),
    bajas: [],
    ordenadas: ORDENADAS,
    ofertas: 1,
    umbralPliego: { baja: null, literal: null },
  });
  assert.deepEqual([sinNada.regla, sinNada.umbral_literal], ['art85', null]);
});

test('should_give_scenarios_per_student_when_prices_are_unit_prices', () => {
  const id = casoE(UMBRAL_CASO_E);

  const p = preciosDeLicitacion(db, id, OpcionesPrecios.parse({ lote: '2', bajas: [0.2] }), 5);

  assert.equal(p.error, null);
  const e = p.data!.escenarios!;
  assert.deepEqual([e.regla, e.umbral_anormal, e.unidad], ['pliego', 0.15, { nombre: 'alumno', base: 110.25 }]);
  assert.equal(e.umbral_unidad, 93.7125, 'CASO_E lote 2: 93,71 € por alumno, el umbral del pliego');
  assert.equal(e.cita, 'Bases.pdf, pág. 53');
  const propuesta = e.filas.find((f) => f.etiqueta === 'propuesta')!;
  assert.deepEqual([propuesta.importe, propuesta.importe_unidad, propuesta.anormal], [4_851, 88.2, true]);
});

test('should_keep_art_85_and_total_amounts_without_an_outline', () => {
  const id = casoE(null);
  db.prepare('DELETE FROM guiones WHERE licitacion_id = ?').run(id);

  const e = preciosDeLicitacion(db, id, OpcionesPrecios.parse({ lote: '2' }), 5).data!.escenarios!;

  assert.deepEqual([e.regla, e.unidad, e.umbral_unidad], ['art85', null, null]);
  assert.ok(e.filas.every((f) => f.importe_unidad === null));
});

test('should_fold_same_organ_awards_with_another_subject', () => {
  const id = casoE(null);
  const organo = (db.prepare('SELECT organo_nif FROM licitaciones WHERE id = ?').get(id) as { organo_nif: string })
    .organo_nif;
  const parecida = adjudicada({
    cpv: '80500000',
    presupuesto: 6_000,
    baja: 0.1,
    organo,
    adjudicatario: 'Formación Parecida SL',
  });
  db.prepare('UPDATE licitaciones SET titulo = ? WHERE id = ?').run(
    'Formación en Análisis de datos con hojas de cálculo 2025',
    parecida,
  );
  adjudicada({ cpv: '80500000', presupuesto: 6_000, baja: 0.1, organo, adjudicatario: 'Otra Cosa SA' });

  const lista = comparablesDeLicitacion(db, id, { lote: '2', mismo_organo: true }, 10).data!;

  assert.deepEqual(lista.map((c) => [c.adjudicatario_nombre, c.mismo_organo, c.otro_objeto]).sort(), [
    ['Formación Parecida SL', true, false],
    ['Otra Cosa SA', true, true],
  ]);
});
