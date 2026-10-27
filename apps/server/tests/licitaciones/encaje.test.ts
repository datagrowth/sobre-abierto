// Encaje 0-100: cada componente con un caso pequeño calculado a mano, el cierre de
// la elegibilidad, los componentes sin datos que no cuentan y el contexto que sale de la base.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'encaje-'));
process.env.PLATAFORMA_DATA_DIR = tmp;
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const enc = await import('../../src/dominios/licitaciones/encaje.js');
type Ctx = import('../../src/dominios/licitaciones/encaje.js').ContextoEncaje;
type Entrada = import('../../src/dominios/licitaciones/encaje.js').EntradaEncaje;
type Evaluacion = import('../../src/dominios/licitaciones/evaluador.js').Evaluacion;

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-23T10:00:00Z');
const req = (resultado: Evaluacion['resultado']): Evaluacion => ({
  origen: 'ficha',
  clase: 'experiencia',
  etiqueta: 'Experiencia',
  descripcion: 'x',
  lote: null,
  exigido: null,
  resultado,
  excluyente: false,
  motivo: '',
});
const ctx = (x: Partial<Ctx> = {}): Ctx => ({
  perfilCpvs: ['80500000'],
  nuestras: [],
  ganadas: [],
  enPreparacion: [],
  nifPropio: 'B00000000',
  ofertasEsperadas: () => null,
  concentracion: () => null,
  ahoraMs: AHORA,
  ...x,
});
const entrada = (x: Partial<Entrada> = {}): Entrada => ({
  id: 'p-1',
  cpvs: ['80500000'],
  organo_nif: 'S0000000A',
  importe: 50_000,
  plazo: '2026-11-10T14:00:00',
  opinion: 'interesa',
  semaforo: { color: 'verde', motivo: '', bloqueos: [] },
  requisitos: [],
  ...x,
});
const valorDe = (e: ReturnType<typeof enc.encajeDe>, clave: string) =>
  e.componentes.find((c) => c.clave === clave)!.valor;

test('should_match_cpvs_by_8_4_and_2_digits_and_short_profile_prefixes_up_to_their_digits', () => {
  assert.equal(enc.coincidenciaCpv(['72267000'], ['72267000']), 1);
  assert.equal(enc.coincidenciaCpv(['72267000'], ['72268000']), 0.6);
  assert.equal(enc.coincidenciaCpv(['72267000'], ['72400000']), 0.2);
  assert.equal(
    enc.coincidenciaCpv(['72267000'], ['72']),
    0.2,
    'un prefijo de 2 cifras del perfil solo dice la división',
  );
  assert.equal(enc.coincidenciaCpv(['72267000'], ['79311']), 0);
});

test('should_mix_hermes_opinion_and_cpv_in_the_topic_and_mark_it_as_hermes', () => {
  // 0,6 × 1 (interesa) + 0,4 × 1 (mismo CPV) = 100; revisar: 0,6 × 0,5 + 0,4 × 0,2 = 38.
  const e = enc.encajeDe(ctx(), entrada());
  assert.equal(valorDe(e, 'tematica'), 100);
  assert.equal(e.componentes.find((c) => c.clave === 'tematica')!.de_hermes, true);
  assert.equal(valorDe(enc.encajeDe(ctx(), entrada({ opinion: 'revisar', cpvs: ['80100000'] })), 'tematica'), 38);
  assert.equal(enc.encajeDe(ctx(), entrada({ opinion: null })).componentes[0]!.de_hermes, false);
});

test('should_average_requirements_green_1_amber_half_red_0', () => {
  const e = enc.encajeDe(
    ctx(),
    entrada({ requisitos: [req('cumple'), req('desconocido'), req('no_cumple'), req('no_aplica')] }),
  );
  assert.equal(valorDe(e, 'solvencia'), 50, '(1 + 0,5 + 0) / 3; lo que no aplica no cuenta');
});

test('should_score_competition_by_expected_offers_minus_a_concentrated_organ', () => {
  const tres = ctx({ ofertasEsperadas: () => ({ mediana: 3, n: 41, nivel: 4 }) });
  assert.equal(valorDe(enc.encajeDe(tres, entrada()), 'competencia'), 70);
  const concentrado = ctx({
    ofertasEsperadas: () => ({ mediana: 3, n: 41, nivel: 4 }),
    concentracion: () => ({ cuota: 0.8, nombre: 'Otra SL', nif: 'B11111111', n: 6 }),
  });
  assert.equal(valorDe(enc.encajeDe(concentrado, entrada()), 'competencia'), 40);
  const nosotros = ctx({
    ofertasEsperadas: () => ({ mediana: 3, n: 41, nivel: 4 }),
    concentracion: () => ({ cuota: 0.8, nombre: 'Nosotros', nif: 'B00000000', n: 6 }),
  });
  assert.equal(
    valorDe(enc.encajeDe(nosotros, entrada()), 'competencia'),
    70,
    'si el que gana somos nosotros no castiga',
  );
});

test('should_score_the_amount_against_what_we_won', () => {
  const c = ctx({ ganadas: [20_000, 40_000, 60_000, 80_000, 100_000] });
  assert.equal(
    valorDe(enc.encajeDe(c, entrada({ importe: 50_000 })), 'economia'),
    100,
    'dentro de P25-P75 (40.000-80.000)',
  );
  assert.equal(valorDe(enc.encajeDe(c, entrada({ importe: 20_000 })), 'economia'), 50, '20.000 / 40.000');
  assert.equal(valorDe(enc.encajeDe(c, entrada({ importe: 160_000 })), 'economia'), 50, '80.000 / 160.000');
  assert.equal(
    valorDe(enc.encajeDe(ctx({ ganadas: [1, 2] }), entrada()), 'economia'),
    null,
    'con menos de 3 ganadas no se compara',
  );
});

test('should_lower_capacity_with_offers_in_preparation_closing_the_same_week', () => {
  const plazo = Date.parse('2026-11-10T13:00:00Z');
  const c = ctx({
    enPreparacion: [
      { id: 'p-2', plazoMs: plazo - 3 * 86_400_000 },
      { id: 'p-3', plazoMs: plazo + 20 * 86_400_000 },
      { id: 'p-1', plazoMs: plazo },
    ],
  });
  assert.equal(
    valorDe(enc.encajeDe(c, entrada()), 'capacidad'),
    67,
    '1 − 1/3: la de dentro de 20 días y ella misma no cuentan',
  );
});

test('should_shrink_the_win_rate_with_an_organ_towards_the_global_one', () => {
  // Global 2 de 4 = 0,5; con el órgano 1 de 1: (1 + 3 × 0,5) / (1 + 3) = 0,625.
  const nuestras = [
    { licitacion_id: 'a', resultado: 'ganada', organo_nif: 'S0000000A', cpvs: '', presupuesto: 1 },
    { licitacion_id: 'b', resultado: 'ganada', organo_nif: 'X', cpvs: '', presupuesto: 1 },
    { licitacion_id: 'c', resultado: 'perdida', organo_nif: 'X', cpvs: '', presupuesto: 1 },
    { licitacion_id: 'd', resultado: 'excluida', organo_nif: 'Y', cpvs: '', presupuesto: 1 },
    { licitacion_id: 'e', resultado: 'pendiente', organo_nif: 'S0000000A', cpvs: '', presupuesto: 1 },
  ];
  assert.equal(valorDe(enc.encajeDe(ctx({ nuestras }), entrada()), 'historial'), 63);
});

test('should_weigh_only_the_components_with_data_and_cap_at_20_when_not_eligible', () => {
  // Sin plazo (capacidad sin datos), temática 100 y solvencia 50 con pesos 0,30 y 0,20: (30 + 10) / 0,5 = 80.
  const e = enc.encajeDe(ctx(), entrada({ plazo: null, requisitos: [req('cumple'), req('no_cumple')] }));
  assert.deepEqual([e.valor, e.elegible, e.etiqueta], [80, true, null]);
  const rojo = enc.encajeDe(
    ctx(),
    entrada({
      plazo: null,
      requisitos: [req('cumple'), req('no_cumple')],
      semaforo: { color: 'rojo', motivo: 'ENS', bloqueos: ['ENS'] },
    }),
  );
  assert.deepEqual([rojo.valor, rojo.elegible, rojo.etiqueta], [20, false, 'no elegible']);
  assert.equal(
    enc.encajeDe(ctx({ perfilCpvs: [] }), entrada({ opinion: null, plazo: null, importe: null })).valor,
    null,
    'sin ningún dato, sin número',
  );
});

test('should_take_the_opinion_that_rules_like_the_list', () => {
  assert.equal(enc.opinionQueManda({ de_hermes: true, decision_ficha: 'go', veredicto_ia: 'interesa' }), 'descartar');
  assert.equal(enc.opinionQueManda({ de_hermes: false, decision_ficha: 'go', veredicto_ia: 'descartar' }), 'interesa');
  assert.equal(enc.opinionQueManda({ de_hermes: false, decision_ficha: null, veredicto_ia: 'interesa' }), 'interesa');
  assert.equal(enc.opinionQueManda({ de_hermes: false, decision_ficha: null, veredicto_ia: null }), 'revisar');
});

test('should_build_the_context_from_the_base_with_expected_offers_and_organ_concentration', () => {
  // Arrange: 12 adjudicaciones de CPV 8050 del mismo órgano, 10 de ellas a la misma empresa.
  for (let i = 0; i < 12; i++) {
    const l = licitacion({
      titulo: `Formación ${i}`,
      publicada: '2025-03-01',
      cpv: '80500000',
      ganadores: [
        {
          nif: i < 10 ? 'B22222222' : `B3333333${i}`,
          nombre: i < 10 ? 'Formadora SL' : 'Otra',
          importe: 10_000,
          ofertas: (i % 3) + 1,
        },
      ],
    });
    guardarLicitacion(db, { ...l, id: `p-7000${i}`, atom_id: `atom-encaje-${i}` });
  }
  // Act
  const c = enc.contextoEncaje(db, { cpv_experiencia: ['80'], nif: 'B00000000' }, AHORA);
  // Assert: ofertas 1, 2, 3 repetidas: mediana 2.
  assert.deepEqual(c.ofertasEsperadas('80500000'), { mediana: 2, n: 12, nivel: 4 });
  assert.equal(c.ofertasEsperadas('45000000'), null, 'sin comparables, nada');
  const org = c.concentracion('P0000004B');
  assert.equal(org?.nif, 'B22222222');
  assert.ok(Math.abs((org?.cuota ?? 0) - 10 / 12) < 1e-9);
});

test('should_give_the_encaje_to_the_opportunities_list_and_the_detail_but_not_to_hermes', async () => {
  // Arrange
  const { FiltroRevision, listaRevision } = await import('../../src/dominios/licitaciones/revision.js');
  const { detalle, detalleParaAgente } = await import('../../src/dominios/licitaciones/oportunidades.js');
  const l = licitacion({
    titulo: 'Formación en IA',
    publicada: '2026-10-01',
    cpv: '80500000',
    limite: '2026-11-20T14:00:00',
    presupuesto: 40_000,
  });
  guardarLicitacion(db, { ...l, id: 'p-71000', atom_id: 'atom-encaje-lista' });
  const ts = new Date(AHORA).toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, creada_en, actualizada_en) VALUES ('p-71000', 'nueva', 'interesa', ?, ?)",
  ).run(ts, ts);
  // Act
  const fila = listaRevision(db, FiltroRevision.parse({ pestana: 'por_revisar' }), AHORA).items.find(
    (x) => x.id === 'p-71000',
  );
  const d = detalle(db, 'p-71000', new Date(AHORA), null);
  // Assert
  assert.ok(fila?.encaje && fila.encaje.valor !== null, 'la fila trae su encaje');
  assert.equal(fila.encaje.componentes.find((c) => c.clave === 'tematica')?.de_hermes, true);
  assert.deepEqual(
    d.data!.encaje.componentes.map((c) => c.clave),
    ['tematica', 'solvencia', 'competencia', 'economia', 'capacidad', 'historial'],
  );
  assert.equal(d.data!.encaje.valor, fila.encaje.valor, 'la ficha y la lista dicen lo mismo');
  assert.equal('encaje' in detalleParaAgente(d.data!, null, 'Europe/Madrid'), false);
});

test('should_order_the_list_by_closing_date_unless_the_calibration_opens_the_gate', async () => {
  // Arrange: una «revisar» que cierra antes y la «interesa» de la lista, que encaja más.
  const { FiltroRevision, listaRevision } = await import('../../src/dominios/licitaciones/revision.js');
  const { encajeOrdena } = await import('../../src/dominios/licitaciones/encajeCalibracion.js');
  const l = licitacion({
    titulo: 'Formación en ofimática',
    publicada: '2026-10-01',
    cpv: '80500000',
    limite: '2026-11-05T14:00:00',
    presupuesto: 40_000,
  });
  guardarLicitacion(db, { ...l, id: 'p-71002', atom_id: 'atom-encaje-orden' });
  const ts = new Date(AHORA).toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, creada_en, actualizada_en) VALUES ('p-71002', 'nueva', 'revisar', ?, ?)",
  ).run(ts, ts);
  const filtro = FiltroRevision.parse({ pestana: 'por_revisar' });
  // Act
  const porDefecto = listaRevision(db, filtro, AHORA);
  const abierta = listaRevision(db, filtro, AHORA, null, true);
  // Assert
  assert.equal(encajeOrdena(db, AHORA), false, 'sin muestra, la puerta está cerrada');
  assert.equal(porDefecto.orden, 'plazo');
  assert.deepEqual(
    porDefecto.items.map((x) => x.id).filter((id) => ['p-71000', 'p-71002'].includes(id)),
    ['p-71002', 'p-71000'],
  );
  assert.equal(abierta.orden, 'encaje');
  assert.deepEqual(
    abierta.items.map((x) => x.id).filter((id) => ['p-71000', 'p-71002'].includes(id)),
    ['p-71000', 'p-71002'],
  );
  db.prepare("DELETE FROM oportunidades WHERE licitacion_id = 'p-71002'").run();
});

test('should_compute_the_auc_as_the_share_of_pairs_where_the_positive_wins', async () => {
  const { auc } = await import('../../src/dominios/licitaciones/encajeCalibracion.js');
  assert.equal(auc([80, 90], [10, 20]), 1);
  assert.equal(auc([50], [50]), 0.5, 'un empate vale medio');
  assert.equal(auc([30, 90], [60]), 0.5);
  assert.equal(auc([], [1]), null);
});

test('should_give_no_auc_and_not_order_with_too_few_decisions', async () => {
  // Una preparada (la de la lista, «interesa») frente a una descartada a mano: no es muestra.
  const { calibrarEncaje, MIN_POR_CLASE } = await import('../../src/dominios/licitaciones/encajeCalibracion.js');
  const l = licitacion({
    titulo: 'Suministro de mobiliario',
    publicada: '2026-10-01',
    cpv: '39100000',
    limite: '2026-11-20T14:00:00',
  });
  guardarLicitacion(db, { ...l, id: 'p-72000', atom_id: 'atom-encaje-desc' });
  const ts = new Date(AHORA).toISOString();
  db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = 'p-71000'").run();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, cambiada_a_mano, creada_en, actualizada_en) VALUES ('p-72000', 'descartada', 'revisar', 1, ?, ?)",
  ).run(ts, ts);
  db.prepare(
    "INSERT INTO descartes_historial (licitacion_id, accion, categoria, motivo, automatico, quien, en) VALUES ('p-72000', 'descartada', 'sector', 'No es lo nuestro', 0, 'Elisa', ?)",
  ).run(ts);
  const c = calibrarEncaje(db, AHORA);
  assert.deepEqual(
    [c.positivas, c.negativas, c.suficiente, c.auc, c.ordena, c.minimo],
    [1, 1, false, null, false, MIN_POR_CLASE],
  );
  assert.ok(c.componentes.every((x) => x.auc === null));
});

test('should_score_each_decision_without_its_own_proposal_so_no_signal_gives_half', async () => {
  // Arrange: 20 presentadas (con su propuesta, ganada) y 20 descartadas a mano, la misma opinión de
  // Hermes, cada una con su órgano y un CPV que no se parece a ningún otro. Sin señal de verdad: si
  // cada presentada se comparase con su propia propuesta (su CPV, su órgano), saldría AUC 1.
  const { calibrarEncaje } = await import('../../src/dominios/licitaciones/encajeCalibracion.js');
  db.exec('DELETE FROM descartes_historial; DELETE FROM propuestas; DELETE FROM oportunidades;');
  const ts = new Date(AHORA).toISOString();
  for (let i = 0; i < 40; i++) {
    const cpv = `${10 + i}000000`;
    const l = licitacion({
      titulo: `Servicio ${i}`,
      publicada: '2025-06-01',
      cpv,
      organo: { nombre: `Órgano ${i}`, nif: `S${String(1000000 + i)}A` },
    });
    const id = `p-73${String(i).padStart(3, '0')}`;
    guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}`, fecha_limite: null });
    const positiva = i < 20;
    db.prepare(
      "INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, cambiada_a_mano, creada_en, actualizada_en) VALUES (?, ?, 'revisar', 1, ?, ?)",
    ).run(id, positiva ? 'presentada' : 'descartada', ts, ts);
    if (positiva)
      db.prepare(
        "INSERT INTO propuestas (licitacion_id, lote, presentada_en, importe_ofertado, resultado, creada_en, actualizada_en) VALUES (?, '', '2025-07-01', 1000, 'ganada', ?, ?)",
      ).run(id, ts, ts);
    else
      db.prepare(
        "INSERT INTO descartes_historial (licitacion_id, accion, categoria, motivo, automatico, quien, en) VALUES (?, 'descartada', 'sector', 'No', 0, 'Elisa', ?)",
      ).run(id, ts);
  }
  // Act
  const c = calibrarEncaje(db, AHORA);
  // Assert
  assert.deepEqual([c.positivas, c.negativas, c.suficiente], [20, 20, true]);
  assert.equal(c.auc, 0.5);
  assert.equal(c.ordena, false);
  assert.equal(
    c.componentes.find((x) => x.clave === 'tematica')?.auc,
    0.5,
    'la temática no se compara con su propio CPV',
  );
});
