// Contexto del precio: el órgano de CASO_D (1 oferta, 0 % de baja en 2022), el
// escenario de un solo licitador con la fórmula del pliego y la fila de margen negativo, que no
// enseña ni el coste ni el importe.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import {
  contextoPrecio,
  escenarioUnLicitador,
  margenDe,
  reglaMargenPrecio,
} from '../../src/dominios/licitaciones/oferta/contextoPrecio.js';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import type { DecisionesData } from '../../src/dominios/licitaciones/oferta/decisiones.js';
import type { GuionBaseData } from '../../src/dominios/licitaciones/oferta/guion.js';
import { licitacion } from '../helpers/sinteticas.js';
import { leerFixtureComprobaciones } from '../helpers/comprobacionesFixtures.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contexto-precio-'));
let db: Db;
let n = 0;

beforeEach(() => {
  db?.close();
  n += 1;
  db = abrirLicitaciones(path.join(tmp, String(n)));
});

after(() => {
  db?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CASO_D = leerFixtureComprobaciones('casoD');
const ORGANO = { nombre: 'Consorcio Insular de Archivos y Patrimonio de Isla Muestra, S.A.', nif: 'A00279976' };
const GUION = CASO_D.guiones.at(-1)!.datos as unknown as GuionBaseData;
const LOTES = [
  { id: '1', nombre: 'Jornadas presenciales y logística', importe: 39_252 },
  { id: '2', nombre: 'Campus virtual Chamilo', importe: 7_383 },
];

// La oferta de ahora (con su guion) y una adjudicación anterior del mismo órgano.
function sembrarCasoD(): string {
  const anterior = licitacion({
    titulo: 'Formación de personal técnico 2022',
    publicada: '2022-05-10',
    organo: ORGANO,
    presupuesto: 9_000,
    ganadores: [{ nif: 'B00000001', nombre: 'Archivera Insular SL', importe: 9_000, ofertas: 1 }],
  });
  guardarLicitacion(db, anterior, 'historico');
  const actual = licitacion({
    titulo: 'Programa de Capacitación Documental de la Isla',
    publicada: '2027-09-23',
    organo: ORGANO,
    lotes: LOTES,
    limite: '2027-10-25T23:59',
  });
  guardarLicitacion(db, actual);
  db.prepare(
    "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, 'oferta-licitaciones', 1, ?)",
  ).run(actual.id, JSON.stringify(GUION), '2027-10-13T09:00:00Z');
  return actual.id;
}

test('should_say_one_offer_and_zero_discount_for_casoD_organ', () => {
  const id = sembrarCasoD();

  const r = contextoPrecio(db, id, '2');

  assert.equal(r.error, null);
  assert.deepEqual(r.data!.organo, {
    ofertas_media: 1,
    baja_media: 0,
    ultima: { anio: 2022, ganador: 'Archivera Insular SL', baja: 0, ofertas: 1 },
    n: 1,
  });
  assert.equal(r.data!.un_licitador?.baja_recomendada, 0, 'no recomienda el 24 % de baja');
  assert.ok(r.data!.indicios === null || ['bajo', 'medio', 'alto'].includes(r.data!.indicios));
});

test('should_reject_a_lot_the_tender_does_not_have', () => {
  const id = sembrarCasoD();

  const r = contextoPrecio(db, id, '9');

  assert.equal(r.error?.code, 'invalid_input');
});

test('should_return_empty_organ_context_when_the_organ_has_no_awards', () => {
  const actual = licitacion({ titulo: 'Programa de Capacitación', publicada: '2027-09-23', organo: ORGANO });
  guardarLicitacion(db, actual);

  const r = contextoPrecio(db, actual.id, null);

  assert.deepEqual(r.data!.organo, { ofertas_media: null, baja_media: null, ultima: null, n: 0 });
  assert.equal(r.data!.un_licitador, null, 'sin guion no hay fórmula');
});

test('should_say_any_discount_gives_max_points_with_one_bidder', () => {
  const casoD = escenarioUnLicitador('P = 55 × (BO – B) ÷ (BO – BMAX)');
  const proporcional = escenarioUnLicitador('Puntuación = 30 x (Oferta más baja / Oferta del licitador)');

  assert.deepEqual(casoD, {
    texto: 'Con un solo licitador cualquier baja da los 55 puntos: no hace falta bajar',
    baja_recomendada: 0,
  });
  assert.equal(proporcional?.texto, 'Con un solo licitador cualquier baja da los 30 puntos: no hace falta bajar');
});

test('should_return_null_scenario_when_formula_is_unknown', () => {
  assert.equal(
    escenarioUnLicitador('P = 40 × (Baja ofertada / 30 %)'),
    null,
    'contra una baja fija, no contra la mejor',
  );
  assert.equal(
    escenarioUnLicitador('Se aplicará la fórmula del anexo III con umbral de saciedad en la oferta más baja'),
    null,
  );
  assert.equal(escenarioUnLicitador(null), null);
  assert.equal(escenarioUnLicitador(''), null);
});

test('should_compute_margin_only_with_price_and_cost', () => {
  assert.deepEqual(margenDe(5_000, 6_200), { margen: -1_200, negativo: true });
  assert.deepEqual(margenDe(5_000, 5_000), { margen: 0, negativo: false });
  assert.equal(margenDe(null, 6_200), null);
  assert.equal(margenDe(5_000, null), null);
});

const entradas = (ofertas: DecisionesData['ofertas']) =>
  ({
    guion: { id: 1, datos: GUION },
    decisiones: {
      guion_id: 1,
      version: 3,
      actualizada_en: '2027-10-13T10:00:00Z',
      datos: { lotes: ['2'], equipo: [], automaticos: [], herramientas: [], enfoque: '', ofertas },
    },
  }) as unknown as Pick<EntradasComprobaciones, 'guion' | 'decisiones'>;

test('should_flag_negative_margin_as_risk', () => {
  const e = entradas([{ lote: '2', pendiente: false, importe: 5_604, coste_estimado: 6_100, unitarios: [] }]);

  const filas = reglaMargenPrecio(e);

  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.clave, 'precio_margen:2:-');
  assert.equal(filas[0]!.gravedad, 'riesgo');
  assert.equal(filas[0]!.categoria, 'precio');
  assert.equal(filas[0]!.titulo, 'El precio del lote 2 queda por debajo del coste estimado');
});

test('should_not_flag_margin_without_cost_or_with_pending_price', () => {
  const sinCoste = entradas([{ lote: '2', pendiente: false, importe: 5_604, coste_estimado: null, unitarios: [] }]);
  const pendiente = entradas([{ lote: '2', pendiente: true, importe: null, coste_estimado: 6_100, unitarios: [] }]);
  const conMargen = entradas([{ lote: '2', pendiente: false, importe: 7_000, coste_estimado: 6_100, unitarios: [] }]);

  assert.deepEqual(
    [reglaMargenPrecio(sinCoste), reglaMargenPrecio(pendiente), reglaMargenPrecio(conMargen)],
    [[], [], []],
  );
});

test('should_never_expose_cost_through_mcp', () => {
  const e = entradas([{ lote: '2', pendiente: false, importe: 5_604, coste_estimado: 6_123, unitarios: [] }]);
  const id = sembrarCasoD();

  const fila = JSON.stringify(reglaMargenPrecio(e));
  const contexto = JSON.stringify(contextoPrecio(db, id, '2').data);

  for (const visto of [fila, contexto]) {
    assert.ok(
      !visto.includes('6123') && !visto.includes('6.123') && !visto.includes('5604'),
      'ni el coste ni el importe',
    );
    assert.ok(!visto.includes('coste_estimado'));
  }
});

test('should_flag_negative_margin_when_the_unit_concept_differs_only_in_case_or_accents', () => {
  // Arrange: el guion dice «Hora de formación» y la decisión «hora de formacion» (precios de prueba, no los ofertados).
  const linea = { concepto: 'Hora de formación', unidad: 'hora', maximo: 40, cantidad: 100 };
  const oferta = {
    lotes: ['2'],
    formula: 'P = 55 × (BO – B) ÷ (BO – BMAX)',
    presupuesto_base: 4_000,
    impuesto_aparte: 'IGIC',
    precios_unitarios: [linea],
    umbral_anormalidad: null,
    umbral_baja: null,
  };
  const e = {
    guion: { id: 1, datos: { ...GUION, ofertas_economicas: [oferta] } },
    decisiones: {
      guion_id: 1,
      version: 3,
      actualizada_en: '2027-10-13T10:00:00Z',
      datos: {
        lotes: ['2'],
        equipo: [],
        automaticos: [],
        herramientas: [],
        enfoque: '',
        ofertas: [
          {
            lote: '2',
            pendiente: false,
            importe: null,
            coste_estimado: 3_500,
            unitarios: [{ concepto: 'hora de formacion', precio: 30 }],
          },
        ],
      },
    },
  } as unknown as Pick<EntradasComprobaciones, 'guion' | 'decisiones'>;

  // Act
  const filas = reglaMargenPrecio(e);

  // Assert: 30 × 100 = 3.000, por debajo de 3.500.
  assert.deepEqual(
    filas.map((f) => f.clave),
    ['precio_margen:2:-'],
  );
});
