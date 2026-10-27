// Memoria por lote: el pliego de CASO_E exige «una Memoria Técnica específica para
// cada lote» y la empresa va a los lotes 2 y 4, así que «Redactar» crea dos memorias, una por lote, cada
// una con las decisiones de su lote. Con Villaejemplo (un solo lote) sigue habiendo una sola común.
// Los dos casos son los fixtures de las comprobaciones (captura del 14/10/2026, seudonimizada).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-lote-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { decisionesDelLote, lotesDeMemoria, memoriaPorLote } =
  await import('../../src/dominios/licitaciones/oferta/memoriaLote.js');
const { memoriaAutoQueToca, memoriasDe, pedirMemoria, resumenOferta } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { plazoDe } = await import('../../src/dominios/licitaciones/oferta/plazo.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type GuionBaseData = import('../../src/dominios/licitaciones/oferta/guion.js').GuionBaseData;
type DecisionesData = import('../../src/dominios/licitaciones/oferta/decisiones.js').DecisionesData;

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CASO_E = leerFixtureComprobaciones('casoE');
const CASO_C = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, CASO_E);
sembrarFixture(db, nucleo().db, CASO_C);
// La captura va sin importes ofertados: con los precios pendientes las decisiones no tienen problemas.
for (const id of [CASO_E.id, CASO_C.id]) {
  const fila = db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as { datos: string };
  const d = JSON.parse(fila.datos) as {
    ofertas: { pendiente: boolean; importe: number | null; unitarios: unknown[] }[];
  };
  d.ofertas = d.ofertas.map((o) => ({ ...o, pendiente: true, importe: null, unitarios: [] }));
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(JSON.stringify(d), id);
}

// Pedida unos días antes del plazo: aquí se mide la división por lotes, no la guarda del plazo.
const DIAS = 24 * 3_600_000;
const pedir = (id: string, op: { lote?: string } = {}) =>
  pedirMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, id, {
    ...op,
    confirmado: true,
    ahoraMs: Date.parse(CASO_E.ahora) - 3 * DIAS,
  });
const nuevasDe = (id: string) =>
  db
    .prepare(
      "SELECT version, lote, fase FROM memorias WHERE licitacion_id = ? AND estado = 'redactando' ORDER BY version",
    )
    .all(id);
function sinNuevas(id: string): void {
  db.prepare(
    "DELETE FROM memoria_apartados WHERE memoria_id IN (SELECT id FROM memorias WHERE licitacion_id = ? AND estado = 'redactando')",
  ).run(id);
  db.prepare("DELETE FROM memorias WHERE licitacion_id = ? AND estado = 'redactando'").run(id);
}

// El guion de CASO_E tal cual, sin lo que dice que va por lote: cada prueba añade un literal.
function guionSinPorLote(): GuionBaseData {
  const g = structuredClone(guionVigente(db, CASO_E.id)!.datos);
  g.memoria!.advertencias = ['La Memoria Técnica deberá describir, como mínimo, los siguientes aspectos:'];
  g.archivos = g.archivos.map((a) => ({
    ...a,
    contenido: 'Documentación administrativa y oferta económica.',
    ambito: undefined,
    documentos: a.documentos.map((d) => ({
      ...d,
      nombre: d.tipo === 'memoria' ? 'Memoria Técnica' : d.nombre,
      notas: undefined,
    })),
  }));
  return g;
}

test('should_detect_per_lot_memoria_from_casoE_literal_phrases', () => {
  // Arrange
  const literales = [
    'Los licitadores deberán presentar una Memoria Técnica específica para cada lote al que concurran y que no será objeto de valoración.',
    'SE DEBERÁ PRESENTAR TANTOS ANEXOS COMO LOTES A LOS QUE SE PRESENTEN',
  ];
  const base = guionSinPorLote();

  // Act
  const detectado = literales.map((frase) =>
    memoriaPorLote({ ...base, memoria: { ...base.memoria!, advertencias: [frase] } }),
  );

  // Assert
  assert.deepEqual(detectado, [true, true]);
  assert.equal(memoriaPorLote(base), false, 'sin ningún literal no se divide');
  assert.equal(memoriaPorLote(guionVigente(db, CASO_E.id)!.datos), true, 'el guion capturado de CASO_E lo dice');
});

test('should_detect_per_lot_memoria_from_archivo_ambito_por_lote', () => {
  // Arrange
  const g = guionSinPorLote();
  const conAmbito = { ...g, archivos: g.archivos.map((a) => ({ ...a, ambito: 'por_lote' as const })) };
  const marcadoFalse = { ...conAmbito, memoria: { ...conAmbito.memoria!, por_lote: false } };

  // Act / Assert
  assert.equal(memoriaPorLote(conAmbito), true);
  assert.equal(memoriaPorLote(marcadoFalse), false, 'lo que diga el guion en «por_lote» manda');
});

test('should_not_split_with_a_single_lote', () => {
  // Arrange
  const g = guionVigente(db, CASO_E.id)!.datos;

  // Act / Assert
  assert.equal(lotesDeMemoria(g, ['2']), null);
  assert.equal(lotesDeMemoria(g, []), null);
  assert.deepEqual(lotesDeMemoria(g, ['2', '4', '2']), ['2', '4']);
  assert.equal(lotesDeMemoria(guionSinPorLote(), ['2', '4']), null, 'con varios lotes pero una memoria común');
});

test('should_filter_team_criteria_and_prices_by_lote', () => {
  // Arrange
  const d: DecisionesData = {
    lotes: ['2', '4'],
    herramientas: ['Aula Abierta'],
    enfoque: '',
    equipo: [
      { persona_id: 1, rol_en_la_oferta: 'Tutora de los dos lotes', lotes: [] },
      { persona_id: 2, rol_en_la_oferta: 'Docente del lote 2', lotes: ['2'] },
      { persona_id: 3, rol_en_la_oferta: 'Suplente del lote 4', lotes: ['4'] },
    ],
    automaticos: [
      { criterio: 'Tiempo de respuesta', lote: null, nos_acogemos: true, tramo: null },
      { criterio: 'Horas adicionales', lote: '2', nos_acogemos: true, tramo: null },
      { criterio: 'Horas adicionales', lote: '4', nos_acogemos: false, tramo: null },
    ],
    ofertas: [
      { lote: '2', pendiente: true, importe: null, unitarios: [] },
      { lote: '4', pendiente: true, importe: null, unitarios: [] },
    ],
  };

  // Act
  const lote2 = decisionesDelLote(d, '2');
  const comun = decisionesDelLote(d, null);

  // Assert
  assert.deepEqual(lote2.lotes, ['2']);
  assert.deepEqual(
    lote2.equipo.map((m) => m.persona_id),
    [1, 2],
  );
  assert.deepEqual(
    lote2.automaticos.map((a) => [a.criterio, a.lote]),
    [
      ['Tiempo de respuesta', null],
      ['Horas adicionales', '2'],
    ],
  );
  assert.deepEqual(
    lote2.ofertas.map((o) => o.lote),
    ['2'],
  );
  assert.deepEqual(lote2.herramientas, ['Aula Abierta']);
  assert.equal(comun, d, 'la memoria común usa todas las decisiones');
});

test('should_create_one_memoria_per_lote', () => {
  // Arrange
  sinNuevas(CASO_E.id);

  // Act
  const r = pedir(CASO_E.id);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    r.data!.memorias.map((m) => [m.version, m.lote]),
    [
      [2, '2'],
      [3, '4'],
    ],
  );
  assert.equal(r.data!.lote, '2', 'arriba, la primera');
  assert.deepEqual(nuevasDe(CASO_E.id), [
    { version: 2, lote: '2', fase: 'dossier' },
    { version: 3, lote: '4', fase: 'dossier' },
  ]);
  assert.deepEqual(
    memoriasDe(db, CASO_E.id)
      .filter((m) => m.estado === 'redactando')
      .map((m) => m.lote),
    ['4', '2'],
  );
  const resumen = resumenOferta(db, CASO_E.id).memorias_por_lote;
  assert.deepEqual(resumen, [
    { lote: '2', version: 2, estado: 'redactando', por_revisar: false, presentada: false },
    { lote: '4', version: 3, estado: 'redactando', por_revisar: false, presentada: false },
  ]);
});

test('should_reuse_memoria_in_progress_of_the_same_lote', () => {
  // Arrange
  sinNuevas(CASO_E.id);
  const solo4 = pedir(CASO_E.id, { lote: '4' });

  // Act
  const todas = pedir(CASO_E.id);
  const otraVez4 = pedir(CASO_E.id, { lote: '4' });

  // Assert
  assert.deepEqual(
    solo4.data!.memorias.map((m) => [m.version, m.lote]),
    [[2, '4']],
  );
  assert.deepEqual(
    todas.data!.memorias.map((m) => [m.version, m.lote]),
    [
      [3, '2'],
      [2, '4'],
    ],
    'la del lote 4 ya se redactaba: solo se crea la del 2',
  );
  assert.equal(otraVez4.data!.memoria, solo4.data!.memoria);
  assert.equal(nuevasDe(CASO_E.id).length, 2);
});

test('should_reject_unknown_lote', () => {
  // Arrange
  sinNuevas(CASO_E.id);

  // Act
  const r = pedir(CASO_E.id, { lote: '7' });
  const comun = pedir(CASO_C.id, { lote: '3' });

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(r.error?.message, 'El lote «7» no es de esta oferta: las memorias son de los lotes 2, 4.');
  assert.match(comun.error?.message ?? '', /una sola memoria para toda la oferta/);
  assert.equal(nuevasDe(CASO_E.id).length + nuevasDe(CASO_C.id).length, 0);
});

test('should_keep_one_common_memoria_when_not_per_lote', () => {
  // Arrange
  sinNuevas(CASO_C.id);

  // Act
  const r = pedir(CASO_C.id);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    r.data!.memorias.map((m) => [m.version, m.lote]),
    [[4, null]],
  );
  assert.equal(r.data!.lote, null);
  assert.equal(resumenOferta(db, CASO_C.id).memorias_por_lote, null);
  assert.equal(memoriasDe(db, CASO_C.id)[0]!.lote, null);
});

test('should_ask_only_the_lote_memorias_still_missing_in_the_automatic_chain', () => {
  // Arrange: la memoria común de la captura y la del lote 2 pedida a mano; falta la del lote 4.
  sinNuevas(CASO_E.id);
  const solo2 = pedir(CASO_E.id, { lote: '2' });
  assert.equal(solo2.error, null, solo2.error?.message);

  // Act
  const toca = memoriaAutoQueToca(db, nucleo().db, CASO_E.id);
  const auto = pedirMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, CASO_E.id, {
    automatica: true,
    ahoraMs: Date.parse(CASO_E.ahora) - 3 * DIAS,
  });
  const despues = memoriaAutoQueToca(db, nucleo().db, CASO_E.id);

  // Assert
  assert.equal(toca, true, 'la común y la del lote 2 no cubren el lote 4');
  assert.equal(auto.error, null, auto.error?.message);
  assert.deepEqual(
    auto.data!.memorias.map((m) => m.lote),
    ['4'],
    'solo la que falta',
  );
  assert.equal(despues, false);
});

test('should_not_ask_again_alone_for_a_lot_already_submitted_without_outline', () => {
  // Arrange: la del lote 2 pedida a mano y la presentada del lote 4, subida sin guion (guion_id 0).
  sinNuevas(CASO_E.id);
  assert.equal(pedir(CASO_E.id, { lote: '2' }).error, null);
  const v =
    (db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(CASO_E.id) as { v: number }).v +
    1;
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, lote, presentada) VALUES (?, 0, ?, 'ensamblada', ?, '4', 1)",
  ).run(CASO_E.id, v, new Date().toISOString());

  // Act
  const toca = memoriaAutoQueToca(db, nucleo().db, CASO_E.id);

  // Assert
  db.prepare('DELETE FROM memorias WHERE licitacion_id = ? AND version = ?').run(CASO_E.id, v);
  assert.equal(toca, false, 'el lote 4 ya se entregó: no se redacta otra');
});

test('should_check_the_deadline_with_every_new_lote_memoria', () => {
  // Arrange: cabe una memoria antes del cierre (más el margen de firma), pero no dos.
  sinNuevas(CASO_E.id);
  const margenMs = nucleo().config.licitaciones.margenFirmaHoras * 3_600_000;
  const ahoraMs = plazoDe(db, CASO_E.id)!.vence - margenMs - 200 * 60_000;
  const pedirSola = (op: { lote?: string }) =>
    pedirMemoria(nucleo().db, db, process.env.SALIDAS_DIR!, CASO_E.id, { ahoraMs, ...op });

  // Act
  const dos = pedirSola({});
  const una = pedirSola({ lote: '2' });

  // Assert
  assert.equal(dos.error?.code, 'plazo_justo', dos.error?.message);
  assert.match(dos.error?.message ?? '', /tarda unos 6 h/);
  assert.equal(una.error, null, una.error?.message);
});
