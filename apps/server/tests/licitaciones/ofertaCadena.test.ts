// La cadena de la oferta que no se atasca y la guardia de plazo, con los casos de la
// prueba del 14/10/2026: el caso B (p-91000740, plazo 18/10/2027 14:00 peninsular) tenía guion pero
// ninguna propuesta de decisiones porque el trabajo automático falló y su clave única impedía
// repetirlo; CASO_E Canarias (p-91000080, plazo 15/10 08:00 peninsular, 07:00 en Canarias) da la
// cuenta atrás de «Hoy» y la guardia con el servidor en hora de Canarias.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { FICHA_CASO_A, GUION_CASO_A } from './fixtures/casoA.js';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-cadena-'));
const salidas = path.join(tmp, 'salidas');
fs.mkdirSync(salidas, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = salidas;
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';
process.env.HOME = tmp;

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { leerConfig } = await import('../../src/nucleo/config.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { encolar, trabajoHecho } = await import('../../src/nucleo/trabajos.js');
const { RELANZADO_SOLO } = await import('../../src/nucleo/colaRelanzado.js');
const { registrarTipoTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { elegirLotesInteres } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { GuionEntrada, encolarGuionesAuto, guionVigente, pedirGuion, pliegosSinLeer, proponerGuion } =
  await import('../../src/dominios/licitaciones/oferta/guion.js');
const { pedirMemoria } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { actualizarMemoria } = await import('../../src/dominios/licitaciones/oferta/actualizarMemoria.js');
const { pedirAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosPedir.js');
const { cambiarDocumento, documentosDe } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { pedirPropuestaDecisiones, proponerAlLlegarGuion } =
  await import('../../src/dominios/licitaciones/oferta/propuestaDecisiones.js');
const { decisionesDe } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { duracionMejoraMin, duracionTexto, guardaPlazo } =
  await import('../../src/dominios/licitaciones/oferta/plazo.js');
const { claveDeRonda, rondaQueToca } = await import('../../src/dominios/licitaciones/oferta/rondas.js');
const { esperaFicha, fichaPorRehacer, relanzarColgados, ultimoLatido, vueltaCadena } =
  await import('../../src/dominios/licitaciones/oferta/cadena.js');
const { hoyLicitaciones } = await import('../../src/dominios/licitaciones/hoy.js');

iniciarNucleo();
const db = dbLicitaciones();
const CASO_B = 'p-91000740';
const CASO_E = 'p-91000080';
const MIN = 60_000;
const HORA = 60 * MIN;
// 14/10/2026 a las 11:00 en Madrid (10:00 en Canarias).
const AHORA = Date.parse('2026-10-14T09:00:00Z');
const listo = () => 'listo' as const;

function enPreparacion(id: string, fechaLimite: string | null, estado = 'en_preparacion'): void {
  const l = licitacion({
    titulo: `Licitación ${id}`,
    publicada: '2026-09-20',
    presupuesto: 24_000,
    limite: fechaLimite,
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}` });
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, ?, 'CPV 80', ?, ?)
    ON CONFLICT(licitacion_id) DO UPDATE SET estado = excluded.estado`,
  ).run(id, estado, ts, ts);
}

async function conFichaYGuion(id: string): Promise<number> {
  assert.equal((await proponerFicha(db, FichaEntrada.parse({ ...FICHA_CASO_A, id }), 'licitaciones')).error, null);
  const g = await proponerGuion(db, GuionEntrada.parse({ id, ...GUION_CASO_A }), 'licitaciones');
  assert.equal(g.error, null);
  return g.data!.guion;
}

const trabajo = (clave: string) =>
  nucleo().db.prepare('SELECT * FROM trabajos_ia WHERE clave = ?').get(clave) as
    | { id: number; estado: string; error: string | null; intentos: number; proximo_intento_en: string | null }
    | undefined;
const fallar = (clave: string, haceMs: number) =>
  nucleo()
    .db.prepare(
      "UPDATE trabajos_ia SET estado = 'fallido', error = 'El run terminó sin dejar el resultado esperado.', actualizado_en = ? WHERE clave = ?",
    )
    .run(new Date(AHORA - haceMs).toISOString(), clave);
const trabajosDe = (id: string) =>
  (
    nucleo().db.prepare("SELECT COUNT(*) AS n FROM trabajos_ia WHERE json_extract(payload, '$.id') = ?").get(id) as {
      n: number;
    }
  ).n;
// Las de plazo relativo al reloj real salen de la preparación al acabar su test: las demás
// cuentan con un «ahora» fijo y no deben verlas, se pasen los tests el día que se pasen.
const descartar = (id: string) =>
  db.prepare("UPDATE oportunidades SET estado = 'descartada' WHERE licitacion_id = ?").run(id);

function conTz<T>(tz: string, fn: () => T): T {
  const previa = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (previa === undefined) delete process.env.TZ;
    else process.env.TZ = previa;
  }
}

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── Guardia de plazo ──

test('should_measure_the_deadline_in_peninsular_time_even_when_the_server_runs_in_canarias', () => {
  enPreparacion(CASO_E, '2026-10-15T08:00:00');
  conTz('Atlantic/Canary', () => {
    // 05:30 peninsular (04:30 en Canarias): quedan 2 h 30 min, y el guion pide 45 min más 2 h de margen.
    const justo = guardaPlazo(db, CASO_E, 'guion', { ahoraMs: Date.parse('2026-10-15T03:30:00Z') });
    assert.equal(justo.error?.code, 'plazo_insuficiente');
    assert.equal(
      justo.error?.message,
      'Quedan 2 h 30 min para el plazo (el 15/10/2026 a las 08:00 hora peninsular) y el guion tarda unos 45 min, más 2 h de margen para firmar y presentar: no da tiempo a que lo prepare Hermes. Hazlo a mano.',
    );
    assert.deepEqual(
      guardaPlazo(db, CASO_E, 'guion', { ahoraMs: Date.parse('2026-10-15T02:00:00Z') }).data,
      { restante_ms: 4 * HORA },
      '04:00 peninsular: quedan 4 h',
    );
    const cerrado = guardaPlazo(db, CASO_E, 'guion', { ahoraMs: Date.parse('2026-10-15T06:00:00Z') });
    assert.equal(
      cerrado.error?.code,
      'plazo_vencido',
      'a las 08:00 peninsular (06:00 UTC) ya cerró, aunque en Canarias sean las 07:00',
    );
    assert.match(
      cerrado.error?.message ?? '',
      /^El plazo de presentación acabó el 15\/10\/2026 a las 08:00 hora peninsular: ya no se pide el guion\.$/,
    );
  });
});

test('should_add_the_expected_duration_of_each_job_type_to_the_signing_margin', () => {
  const tresHorasAntes = Date.parse('2026-10-15T03:00:00Z');
  assert.equal(guardaPlazo(db, CASO_E, 'guion', { ahoraMs: tresHorasAntes }).error, null, '45 min + 2 h caben en 3 h');
  assert.equal(guardaPlazo(db, CASO_E, 'anexo', { ahoraMs: tresHorasAntes }).error, null);
  assert.equal(guardaPlazo(db, CASO_E, 'decisiones', { ahoraMs: tresHorasAntes }).error, null);
  assert.equal(
    guardaPlazo(db, CASO_E, 'memoria', { ahoraMs: tresHorasAntes }).error?.code,
    'plazo_insuficiente',
    '2 h de memoria + 2 h no caben',
  );
  assert.equal(guardaPlazo(db, CASO_E, 'mejora', { ahoraMs: tresHorasAntes }).error?.code, 'plazo_insuficiente');
});

test('should_use_a_two_hour_signing_margin_by_default_and_let_it_be_configured', () => {
  const dosHorasDiezAntes = Date.parse('2026-10-15T03:50:00Z');
  assert.equal(
    guardaPlazo(db, CASO_E, 'anexo', { ahoraMs: dosHorasDiezAntes }).error?.code,
    'plazo_insuficiente',
    '20 min + 2 h no caben en 2 h 10 min',
  );
  assert.equal(guardaPlazo(db, CASO_E, 'anexo', { ahoraMs: dosHorasDiezAntes, margenMs: 0 }).error, null);
  assert.match(
    guardaPlazo(db, CASO_E, 'anexo', { ahoraMs: Date.parse('2026-10-15T05:50:00Z'), margenMs: 0 }).error?.message ?? '',
    /tarda unos 20 min: no da tiempo/,
    'sin margen no lo menciona',
  );
  assert.equal(leerConfig({}).licitaciones.margenFirmaHoras, 2);
  assert.equal(leerConfig({ LICITACIONES_MARGEN_FIRMA_HORAS: '0.5' }).licitaciones.margenFirmaHoras, 0.5);
  assert.throws(() => leerConfig({ LICITACIONES_MARGEN_FIRMA_HORAS: '-1' }));
});

test('should_not_guard_a_tender_without_deadline', () => {
  enPreparacion('p-sin-plazo', null);
  assert.deepEqual(guardaPlazo(db, 'p-sin-plazo', 'memoria', { ahoraMs: AHORA }).data, { restante_ms: null });
});

test('should_write_durations_in_days_hours_and_minutes', () => {
  assert.deepEqual(
    [duracionTexto(45 * MIN), duracionTexto(2 * HORA), duracionTexto(2 * HORA + 30 * MIN), duracionTexto(53 * HORA)],
    ['45 min', '2 h', '2 h 30 min', '2 d 5 h'],
  );
  assert.equal(duracionTexto(48 * HORA), '2 d');
});

test('should_refuse_every_offer_job_once_the_deadline_passed_without_queueing_anything', async () => {
  const ID = 'p-vencida';
  enPreparacion(ID, horaLocalEspana(Date.now() - 24 * HORA));
  await conFichaYGuion(ID);
  const antes = trabajosDe(ID);
  const codigos = [
    pedirGuion(nucleo().db, db, ID).error?.code,
    pedirPropuestaDecisiones(nucleo().db, db, ID, true).error?.code,
    pedirMemoria(nucleo().db, db, salidas, ID).error?.code,
    (await actualizarMemoria(nucleo().db, db, salidas, { id: ID, version: 1 })).error?.code,
    (await pedirAnexo({ db, dbNucleo: nucleo().db, raices: { salidas, conocimiento: null } }, ID, 'a1-d3')).error?.code,
  ];
  assert.deepEqual(codigos, ['plazo_vencido', 'plazo_vencido', 'plazo_vencido', 'plazo_vencido', 'plazo_vencido']);
  assert.equal(trabajosDe(ID), antes, 'no se encola nada');
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/guion`, { method: 'POST' });
  assert.equal(r.status, 409);
  assert.equal(((await r.json()) as { error: string }).error, 'plazo_vencido');
  descartar(ID);
});

test('should_refuse_automatic_jobs_and_warn_people_when_a_job_would_end_inside_the_signing_margin', async () => {
  const ID = 'p-justa';
  enPreparacion(ID, horaLocalEspana(Date.now() + HORA));
  await conFichaYGuion(ID);
  const automatica = pedirPropuestaDecisiones(nucleo().db, db, ID, false).error;
  assert.equal(automatica?.code, 'plazo_insuficiente', 'lo automático no se pide');
  assert.ok(automatica?.message.endsWith('Hazlo a mano.'));
  const aMano = [
    pedirGuion(nucleo().db, db, ID).error,
    pedirPropuestaDecisiones(nucleo().db, db, ID, true).error,
    pedirMemoria(nucleo().db, db, salidas, ID).error,
    (await actualizarMemoria(nucleo().db, db, salidas, { id: ID, version: 1 })).error,
    (await pedirAnexo({ db, dbNucleo: nucleo().db, raices: { salidas, conocimiento: null } }, ID, 'a1-d3')).error,
  ];
  assert.deepEqual(
    aMano.map((e) => e?.code),
    Array(5).fill('plazo_justo'),
    'lo que pide una persona se avisa',
  );
  assert.ok(aMano.every((e) => e?.message.endsWith('Si lo pides igualmente, confírmalo; si no, hazlo a mano.')));
  assert.match(aMano[2]?.message ?? '', /la memoria técnica .* tarda unos 3 h/);
  assert.match(
    aMano[3]?.message ?? '',
    /la nueva versión de la memoria tarda unos 30 min/,
    'una mejora se mide por los apartados que rehace',
  );
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/guion`, { method: 'POST' });
  assert.deepEqual([r.status, ((await r.json()) as { error: string }).error], [409, 'plazo_justo']);
  const confirmada = await fetch(`${base}/api/licitaciones/licitaciones/${ID}/oferta/guion?confirmar=1`, {
    method: 'POST',
  });
  const tras = (await confirmada.json()) as { error?: string; message?: string };
  assert.notEqual(tras.error, 'plazo_justo', 'confirmado, pasa la guardia de plazo');
  assert.match(tras.message ?? '', /Aún no hay pliegos descargados/, 'y sigue con lo demás que exige el guion');
  descartar(ID);
});

test('should_estimate_an_improvement_by_the_sections_it_redoes', () => {
  // Villaejemplo a las 20:30 (plazo 23:59): rehacer un apartado cabe; la memoria entera, no.
  assert.equal(duracionMejoraMin(1), 30);
  assert.equal(duracionMejoraMin(4), 50);
  assert.equal(duracionMejoraMin(20), 90, 'nunca más que una memoria rehecha');
  const casoC = Date.parse('2026-10-15T03:20:00Z');
  assert.equal(guardaPlazo(db, CASO_E, 'mejora', { ahoraMs: casoC, duracionMin: duracionMejoraMin(1) }).error, null);
  assert.equal(
    guardaPlazo(db, CASO_E, 'mejora', { ahoraMs: casoC, aMano: true, confirmado: true }).error,
    null,
    'confirmado, pasa',
  );
  assert.equal(
    guardaPlazo(db, CASO_E, 'mejora', { ahoraMs: Date.parse('2026-10-15T07:00:00Z'), aMano: true, confirmado: true })
      .error?.code,
    'plazo_vencido',
    'vencido no se confirma',
  );
});

// ── Rondas ──

test('should_ask_the_first_round_then_retry_a_failed_one_after_a_while_up_to_three_rounds', () => {
  const b = 'decisiones-auto-p-rondas-g5';
  const nueva = (clave: string) =>
    encolar(nucleo().db, {
      tipo: 'licitaciones.decisiones',
      dominio: 'licitaciones',
      clave,
      payload: { id: 'p-rondas' },
    });
  assert.equal(rondaQueToca(nucleo().db, b, AHORA), 0, 'nunca se pidió');
  nueva(claveDeRonda(b, 0));
  assert.equal(rondaQueToca(nucleo().db, b, AHORA), null, 'en cola');
  fallar(b, 10 * MIN);
  assert.equal(rondaQueToca(nucleo().db, b, AHORA), null, 'falló hace poco: espera');
  fallar(b, 31 * MIN);
  assert.equal(rondaQueToca(nucleo().db, b, AHORA), 1);
  nueva(claveDeRonda(b, 1));
  fallar(`${b}-r1`, HORA);
  assert.equal(rondaQueToca(nucleo().db, b, AHORA), 2);
  nueva(claveDeRonda(b, 2));
  fallar(`${b}-r2`, HORA);
  assert.equal(rondaQueToca(nucleo().db, b, AHORA), null, 'tres rondas como mucho');
  assert.equal(
    rondaQueToca(nucleo().db, 'decisiones-auto-p-rondas-g50', AHORA),
    0,
    'otra base que empieza igual no cuenta',
  );
});

test('should_not_retry_a_round_that_succeeded_or_that_someone_cancelled', () => {
  for (const [estado, b] of [
    ['completado', 'guion-auto-p-ok-f1'],
    ['cancelado', 'guion-auto-p-cancelada-f1'],
  ] as const) {
    encolar(nucleo().db, { tipo: 'licitaciones.guion', dominio: 'licitaciones', clave: b, payload: { id: 'p-x' } });
    nucleo()
      .db.prepare("UPDATE trabajos_ia SET estado = ?, actualizado_en = '2026-10-01T00:00:00Z' WHERE clave = ?")
      .run(estado, b);
    assert.equal(rondaQueToca(nucleo().db, b, AHORA), null, estado);
  }
});

// ── La cadena ──

test('should_ask_again_for_the_decisions_proposal_of_casoB_after_the_automatic_one_failed', async () => {
  enPreparacion(CASO_B, '2027-10-18T14:00:00');
  const guion = await conFichaYGuion(CASO_B);
  const b = `decisiones-auto-${CASO_B}-g${guion}`;
  const propuestas = () =>
    (
      nucleo()
        .db.prepare(
          "SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = 'licitaciones.decisiones' AND json_extract(payload, '$.id') = ?",
        )
        .get(CASO_B) as { n: number }
    ).n;
  assert.equal(
    pedirPropuestaDecisiones(nucleo().db, db, CASO_B, false, { ahoraMs: AHORA - 2 * HORA }).error,
    null,
    'la automática, al llegar el guion',
  );
  fallar(b, HORA);
  vueltaCadena(nucleo().db, db, AHORA);
  assert.equal(trabajo(`${b}-r1`)?.estado, 'pendiente', 'segunda ronda, con clave nueva');
  vueltaCadena(nucleo().db, db, AHORA);
  assert.equal(propuestas(), 2, 'en cola: no se duplica');
  fallar(`${b}-r1`, HORA);
  vueltaCadena(nucleo().db, db, AHORA);
  assert.equal(trabajo(`${b}-r2`)?.estado, 'pendiente');
  fallar(`${b}-r2`, HORA);
  vueltaCadena(nucleo().db, db, AHORA);
  assert.equal(propuestas(), 3, 'tres rondas: ya no se gasta más el modelo');
  const item = hoyLicitaciones(db, '2000-01-01T00:00:00Z', AHORA).en_preparacion?.find(
    (i) => i.enlace.id === `${CASO_B}/preparacion`,
  );
  assert.ok(item?.falta.includes('Decisiones: Decisiones sin fijar'), 'Hoy pide fijarlas a mano');
});

test('should_ask_for_a_proposal_that_was_never_asked_for_the_current_outline', async () => {
  const ID = 'p-sin-propuesta';
  enPreparacion(ID, '2026-10-19T14:00:00');
  const guion = await conFichaYGuion(ID);
  vueltaCadena(nucleo().db, db, AHORA);
  assert.equal(trabajo(`decisiones-auto-${ID}-g${guion}`)?.estado, 'pendiente', 'como si hubiera llegado el guion');
});

test('should_not_ask_for_a_proposal_with_decisions_saved_a_proposal_for_this_outline_or_no_time_left', async () => {
  const [DECIDIDA, PROPUESTA, PRESENTADA, CERCA] = ['p-decidida', 'p-con-propuesta', 'p-presentada', 'p-cerca'];
  enPreparacion(DECIDIDA, '2026-10-19T14:00:00');
  enPreparacion(PROPUESTA, '2026-10-19T14:00:00');
  enPreparacion(PRESENTADA, '2026-10-19T14:00:00', 'presentada');
  enPreparacion(CERCA, horaLocalEspana(AHORA + 2 * HORA));
  const guiones = await Promise.all([DECIDIDA, PROPUESTA, PRESENTADA, CERCA].map((id) => conFichaYGuion(id)));
  db.prepare(
    "INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, '{}', ?)",
  ).run(DECIDIDA, guiones[0], new Date().toISOString());
  db.prepare(
    "INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, agente, creada_en) VALUES (?, ?, '{}', 'oferta-licitaciones', ?)",
  ).run(PROPUESTA, guiones[1], new Date().toISOString());
  vueltaCadena(nucleo().db, db, AHORA);
  for (const [id, g] of [
    [DECIDIDA, guiones[0]],
    [PROPUESTA, guiones[1]],
    [PRESENTADA, guiones[2]],
    [CERCA, guiones[3]],
  ] as const) {
    assert.equal(trabajo(`decisiones-auto-${id}-g${g}`), undefined, id);
  }
});

test('should_ask_the_automatic_outline_again_when_it_failed_and_only_while_there_is_time', async () => {
  const ID = 'p-guion-fallido';
  enPreparacion(ID, '2026-10-19T14:00:00');
  assert.equal((await proponerFicha(db, FichaEntrada.parse({ ...FICHA_CASO_A, id: ID }), 'licitaciones')).error, null);
  const ficha = (
    db.prepare("SELECT id FROM fichas WHERE licitacion_id = ? AND estado = 'aprobada'").get(ID) as { id: number }
  ).id;
  const b = `guion-auto-${ID}-f${ficha}`;
  const pedir = (ahoraMs: number) =>
    encolarGuionesAuto(nucleo().db, db, ahoraMs, { legible: (id) => (id === ID ? 'listo' : 'esperar') });
  assert.equal(pedir(AHORA), 1);
  assert.equal(pedir(AHORA), 0, 'una vez mientras está en cola');
  fallar(b, HORA);
  assert.equal(pedir(AHORA), 1, 'falló del todo: segunda ronda');
  assert.equal(trabajo(`${b}-r1`)?.estado, 'pendiente');
  fallar(`${b}-r1`, HORA);
  assert.equal(pedir(Date.parse('2026-10-19T09:30:00Z')), 0, 'a 2 h 30 min del cierre ya no da tiempo');
  assert.equal(pedir(AHORA), 1, 'con tiempo, la tercera');
});

// ── Pliegos nuevos: ficha, guion y propuesta ──

// Villaejemplo y CASO_E (medición del 14/10/2026): una rectificación llegó después de la ficha y del
// guion, que se relanzó solo; la ficha, la propuesta y las decisiones se quedaron antiguas.
const DECISIONES_DE_LA_MANANA = {
  lotes: [],
  equipo: [],
  automaticos: [],
  herramientas: ['Power BI'],
  enfoque: 'Enfoque de la mañana, antes de la rectificación.',
  precio: { importe: 20_000, pendiente: false },
};

/** Plazo a una semana vista: proponerAlLlegarGuion mira la hora real y con una fecha fija el test caduca. */
const dentroDeUnaSemana = () => new Date(Date.now() + 7 * 24 * HORA).toISOString().slice(0, 19);

/** Ficha y guion de hace dos horas, decisiones guardadas sobre ese guion y una rectificación bajada hace una hora. */
async function conRectificacionTardia(id: string, fechaLimite: string): Promise<{ ficha: number; guion: number }> {
  enPreparacion(id, fechaLimite);
  const guion = await conFichaYGuion(id);
  const haceDos = new Date(Date.now() - 2 * HORA).toISOString();
  db.prepare('UPDATE fichas SET creada_en = ?, actualizada_en = ?, revisada_en = ? WHERE licitacion_id = ?').run(
    haceDos,
    haceDos,
    haceDos,
    id,
  );
  db.prepare('UPDATE guiones SET creado_en = ? WHERE licitacion_id = ?').run(haceDos, id);
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    id,
    guion,
    JSON.stringify(DECISIONES_DE_LA_MANANA),
    haceDos,
  );
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, ?, 'adicional', 'Nota de rectificación del PCAP.pdf', 'descargado', ?)",
  ).run(id, `https://contrataciondelestado.es/doc/rect-${id}`, new Date(Date.now() - HORA).toISOString());
  const ficha = (
    db.prepare("SELECT MAX(id) AS id FROM fichas WHERE licitacion_id = ? AND estado = 'aprobada'").get(id) as {
      id: number;
    }
  ).id;
  return { ficha, guion };
}

const clavesDe = (id: string, tipo: string) =>
  (
    nucleo()
      .db.prepare("SELECT clave FROM trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.id') = ? ORDER BY id")
      .all(tipo, id) as { clave: string }[]
  ).map((t) => t.clave);
const completar = (clave: string) =>
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE clave = ?").run(clave);

test('should_chain_a_new_ficha_then_outline_then_proposal_when_a_rectification_arrives_without_touching_the_saved_decisions', async () => {
  const ID = 'p-rectificada';
  const { ficha, guion } = await conRectificacionTardia(ID, '2026-10-19T14:00:00');
  const antes = decisionesDe(db, ID);
  assert.equal(antes?.guion_id, guion);

  const primera = vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.equal(primera.fichas, 1);
  assert.deepEqual(
    clavesDe(ID, 'licitaciones.ficha'),
    [`ficha-auto-${ID}-v${ficha}-p1`],
    'la rectificación cambia los requisitos: ficha otra vez',
  );
  assert.deepEqual(
    clavesDe(ID, 'licitaciones.guion'),
    [],
    'el guion espera a la ficha nueva en vez de salir con la vieja',
  );
  assert.deepEqual(clavesDe(ID, 'licitaciones.decisiones'), [], 'y la propuesta, al guion nuevo');
  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.equal(clavesDe(ID, 'licitaciones.ficha').length, 1, 'en cola: no se duplica');

  // Hermes deja la ficha nueva (simulado).
  assert.equal((await proponerFicha(db, FichaEntrada.parse({ ...FICHA_CASO_A, id: ID }), 'licitaciones')).error, null);
  completar(`ficha-auto-${ID}-v${ficha}-p1`);
  const fichaNueva = (
    db.prepare("SELECT MAX(id) AS id FROM fichas WHERE licitacion_id = ? AND estado = 'aprobada'").get(ID) as {
      id: number;
    }
  ).id;
  assert.equal(fichaPorRehacer(db, ID), null, 'la ficha nueva ya leyó la rectificación');
  assert.equal(vueltaCadena(nucleo().db, db, AHORA, listo).fichas, 0);
  assert.deepEqual(
    clavesDe(ID, 'licitaciones.guion'),
    [`guion-auto-${ID}-f${fichaNueva}-p1-g${guion}`],
    'con la ficha nueva, el guion',
  );

  // Hermes deja el guion nuevo (simulado). La rectificación cambia un criterio automático: un
  // guion idéntico pasaría las decisiones al nuevo (rebase.ts) y no haría falta propuesta.
  const rectificado = structuredClone(GUION_CASO_A);
  rectificado.automaticos[0]!.puntos = 12;
  const g = await proponerGuion(db, GuionEntrada.parse({ id: ID, ...rectificado }), 'licitaciones');
  assert.equal(g.error, null);
  completar(`guion-auto-${ID}-f${fichaNueva}-p1-g${guion}`);
  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.deepEqual(
    clavesDe(ID, 'licitaciones.decisiones'),
    [`decisiones-auto-${ID}-g${g.data!.guion}`],
    'propuesta para el guion nuevo aunque haya decisiones guardadas',
  );
  assert.deepEqual(
    decisionesDe(db, ID),
    antes,
    'las decisiones guardadas no se tocan: la propuesta se carga en el formulario si se quiere',
  );
  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.equal(clavesDe(ID, 'licitaciones.decisiones').length, 1, 'una vez por guion');
});

test('should_ask_the_outline_again_for_a_later_key_document_even_when_an_earlier_one_was_already_read_by_a_newer_outline', async () => {
  // La cuenta de documentos clave posteriores al guion vuelve a 0 con cada guion nuevo: sin el id
  // del guion en la clave, el segundo documento tardío repetía «-p1» y el guion no se pedía.
  const ID = 'p-dos-documentos-tardios';
  enPreparacion(ID, '2026-10-19T14:00:00');
  const guion = await conFichaYGuion(ID);
  const haceDos = new Date(Date.now() - 2 * HORA).toISOString();
  db.prepare('UPDATE guiones SET creado_en = ? WHERE licitacion_id = ?').run(haceDos, ID);
  const ficha = (
    db.prepare("SELECT id FROM fichas WHERE licitacion_id = ? AND estado = 'aprobada'").get(ID) as { id: number }
  ).id;
  const bajar = (nombre: string, cuando: Date) =>
    db
      .prepare(
        "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, ?, 'adicional', ?, 'descargado', ?)",
      )
      .run(ID, `https://contrataciondelestado.es/doc/${encodeURIComponent(nombre)}`, nombre, cuando.toISOString());
  const pedir = () => encolarGuionesAuto(nucleo().db, db, AHORA, { legible: () => 'listo' as const });
  bajar('Modelo de proposición económica.docx', new Date(Date.now() - HORA));
  assert.equal(pedir(), 1);
  const primera = `guion-auto-${ID}-f${ficha}-p1-g${guion}`;
  assert.deepEqual(clavesDe(ID, 'licitaciones.guion'), [primera]);
  completar(primera);
  const nuevo = await proponerGuion(db, GuionEntrada.parse({ id: ID, ...GUION_CASO_A }), 'licitaciones');
  assert.equal(nuevo.error, null);
  assert.equal(pedir(), 0, 'el guion nuevo ya leyó el primer documento');
  bajar('Anexo II. Declaración responsable.docx', new Date(Date.now() + 60_000));
  assert.equal(pedir(), 1, 'otro documento clave después del guion nuevo: se pide otra vez');
  assert.deepEqual(clavesDe(ID, 'licitaciones.guion'), [
    primera,
    `guion-auto-${ID}-f${ficha}-p1-g${nuevo.data!.guion}`,
  ]);
});

test('should_ask_for_the_proposal_on_a_new_outline_even_with_decisions_saved_on_the_previous_one', async () => {
  const ID = 'p-guion-nuevo';
  const { guion } = await conRectificacionTardia(ID, dentroDeUnaSemana());
  proponerAlLlegarGuion(nucleo().db, db, ID);
  assert.deepEqual(
    clavesDe(ID, 'licitaciones.decisiones'),
    [],
    'decisiones guardadas sobre este guion: nada que proponer',
  );
  // Con otro criterio automático: un guion idéntico pasaría las decisiones al nuevo (rebase.ts).
  const otro = structuredClone(GUION_CASO_A);
  otro.automaticos[0]!.puntos = 12;
  const nuevo = await proponerGuion(db, GuionEntrada.parse({ id: ID, ...otro }), 'licitaciones');
  assert.notEqual(nuevo.data!.guion, guion);
  proponerAlLlegarGuion(nucleo().db, db, ID);
  assert.deepEqual(clavesDe(ID, 'licitaciones.decisiones'), [`decisiones-auto-${ID}-g${nuevo.data!.guion}`]);
  assert.equal(decisionesDe(db, ID)?.guion_id, guion, 'siguen las de la mañana');
});

test('should_skip_the_new_ficha_and_ask_the_outline_straight_away_when_there_is_no_time_for_both', async () => {
  // A 3 h del cierre: la ficha y el guion (85 min) más las 2 h de firma no caben; el guion solo (45 min), sí.
  const ID = 'p-rectificada-cerca';
  const { ficha, guion } = await conRectificacionTardia(ID, horaLocalEspana(AHORA + 3 * HORA));
  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.deepEqual(clavesDe(ID, 'licitaciones.ficha'), []);
  assert.deepEqual(
    clavesDe(ID, 'licitaciones.guion'),
    [`guion-auto-${ID}-f${ficha}-p1-g${guion}`],
    'el guion lee la rectificación con la ficha que hay',
  );
});

test('should_not_ask_for_endless_fichas_when_the_sheet_has_no_own_requirements_for_one_of_the_lots_we_go_to', async () => {
  // CASO_E: la ficha trae requisitos comunes y del lote 2 pero no del 4 (la empresa va a 2 y 4). Rehacerla no
  // cambia nada y cada ficha nueva tiene id nuevo, así que la cadena no puede pedirla por eso.
  const ID = 'p-lote-sin-solvencia';
  const l = licitacion({
    titulo: 'Formación en lotes',
    publicada: '2026-09-20',
    presupuesto: 24_000,
    limite: '2026-10-19T14:00:00',
    lotes: [
      { id: '2', nombre: 'Hojas de cálculo', importe: 6_000 },
      { id: '4', nombre: 'Atención', importe: 800 },
    ],
  });
  enPreparacion(ID, '2026-10-19T14:00:00');
  guardarLicitacion(db, { ...l, id: ID, atom_id: `atom-${ID}` });
  assert.equal(elegirLotesInteres(db, ID, { lotes: ['2', '4'] }).error, null);
  const requisito = {
    tipo: 'medios_personales',
    descripcion: 'Docente con titulación relacionada',
    excluyente: true,
    cumple: 'dudoso',
    justificacion: 'Falta el certificado.',
    documento: 'Bases.pdf',
    pagina: 6,
  };
  const entrada = FichaEntrada.parse({ ...FICHA_CASO_A, id: ID, requisitos: [requisito, { ...requisito, lote: '2' }] });
  for (let i = 0; i < 4; i++) {
    assert.equal((await proponerFicha(db, entrada, 'licitaciones')).error, null);
    vueltaCadena(nucleo().db, db, AHORA, listo);
    for (const clave of clavesDe(ID, 'licitaciones.ficha')) completar(clave);
  }
  assert.ok(
    clavesDe(ID, 'licitaciones.ficha').length <= 1,
    `fichas pedidas: ${clavesDe(ID, 'licitaciones.ficha').join(', ')}`,
  );
  assert.equal(fichaPorRehacer(db, ID), null);
});

test('should_stop_waiting_for_the_ficha_once_its_rounds_are_spent', async () => {
  const ID = 'p-ficha-fallida';
  const { ficha, guion } = await conRectificacionTardia(ID, '2026-10-19T14:00:00');
  const b = `ficha-auto-${ID}-v${ficha}-p1`;
  vueltaCadena(nucleo().db, db, AHORA, listo);
  fallar(b, 10 * MIN);
  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.deepEqual(clavesDe(ID, 'licitaciones.guion'), [], 'falló hace poco: aún se reintentará y el guion la espera');
  fallar(b, HORA);
  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.equal(trabajo(`${b}-r1`)?.estado, 'pendiente', 'segunda ronda');
  fallar(`${b}-r1`, HORA);
  vueltaCadena(nucleo().db, db, AHORA, listo);
  fallar(`${b}-r2`, HORA);
  vueltaCadena(nucleo().db, db, AHORA, listo);
  assert.equal(clavesDe(ID, 'licitaciones.ficha').length, 3, 'tres rondas y no más');
  assert.deepEqual(
    clavesDe(ID, 'licitaciones.guion'),
    [`guion-auto-${ID}-f${ficha}-p1-g${guion}`],
    'sin ficha nueva, el guion sale con la que hay',
  );
});

test('should_relaunch_once_an_offer_job_running_longer_than_expected_without_cutting_a_healthy_one', () => {
  const lanzado = (clave: string, tipo: string, id: string, haceMs: number) => {
    encolar(nucleo().db, { tipo, dominio: 'licitaciones', clave, payload: { id } });
    nucleo()
      .db.prepare(
        "UPDATE trabajos_ia SET estado = 'lanzado', run_id = NULL, error = NULL, lanzado_en = ? WHERE clave = ?",
      )
      .run(new Date(AHORA - haceMs).toISOString(), clave);
  };
  lanzado('colgado-guion', 'licitaciones.guion', CASO_B, 40 * MIN);
  lanzado('reciente-guion', 'licitaciones.guion', CASO_E, 5 * MIN);
  lanzado('critica-colgada', 'licitaciones.memoria_critica', CASO_B, 40 * MIN);
  lanzado('critica-sana', 'licitaciones.memoria_critica', CASO_B, 5 * MIN);
  lanzado('otra-colgada', 'licitaciones.guion', 'p-no-se-prepara', 40 * MIN);
  assert.equal(relanzarColgados(nucleo().db, db, [CASO_B, CASO_E], AHORA), 1, 'solo el guion de CASO_B');
  const relanzado = trabajo('colgado-guion')!;
  assert.equal(relanzado.estado, 'pendiente');
  assert.ok(relanzado.error?.startsWith(RELANZADO_SOLO));
  assert.equal(relanzado.intentos, 0, 'los primeros relanzamientos automáticos no gastan intento');
  assert.deepEqual(
    ['reciente-guion', 'critica-colgada', 'critica-sana', 'otra-colgada'].map((c) => trabajo(c)?.estado),
    ['lanzado', 'lanzado', 'lanzado', 'lanzado'],
    'ni el reciente, ni una crítica mientras otra va bien, ni lo que no está en preparación',
  );
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'lanzado', lanzado_en = ? WHERE clave = 'colgado-guion'")
    .run(new Date(AHORA - HORA).toISOString());
  assert.equal(
    relanzarColgados(nucleo().db, db, [CASO_B], AHORA),
    1,
    'si se vuelve a colgar se relanza otra vez: el tope vive en la cola (relanzamientos)',
  );
  nucleo()
    .db.prepare(
      "UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave IN ('colgado-guion', 'reciente-guion', 'critica-colgada', 'critica-sana', 'otra-colgada')",
    )
    .run();
});

test('should_not_relaunch_a_memory_redaction_that_keeps_running_past_the_expected_time', () => {
  // La redacción envía apartados durante hasta 90 min: la cola la corta por inactividad.
  const db = nucleo().db;
  encolar(db, {
    tipo: 'licitaciones.memoria_redaccion',
    dominio: 'licitaciones',
    clave: 'redaccion-larga',
    payload: { id: CASO_B },
  });
  db.prepare(
    "UPDATE trabajos_ia SET estado = 'lanzado', run_id = NULL, error = NULL, lanzado_en = ? WHERE clave = 'redaccion-larga'",
  ).run(new Date(AHORA - 80 * MIN).toISOString());
  assert.equal(relanzarColgados(db, dbLicitaciones(), [CASO_B], AHORA), 0);
  assert.equal(trabajo('redaccion-larga')?.estado, 'lanzado');
  db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave = 'redaccion-larga'").run();
});

// Una estrategia real: ~30 min, entregó y, antes de que la cola la diera
// por completada, se relanzó y gastó otro run entero en paralelo con la redacción.
const ESTRATEGIA = 'licitaciones.memoria_estrategia';
const estrategiaLanzada = (clave: string, haceMs: number, entregada: boolean) => {
  encolar(nucleo().db, { tipo: ESTRATEGIA, dominio: 'licitaciones', clave, payload: { id: CASO_B, entregada } });
  nucleo()
    .db.prepare(
      "UPDATE trabajos_ia SET estado = 'lanzado', run_id = NULL, error = NULL, lanzado_en = ? WHERE clave = ?",
    )
    .run(new Date(AHORA - haceMs).toISOString(), clave);
};
const conEstrategiaFalsa = () =>
  registrarTipoTrabajo(ESTRATEGIA, {
    destino: () => null,
    instrucciones: () => 'nada',
    hecho: (p) => (p as { entregada: boolean }).entregada,
  });

test('should_not_relaunch_an_overdue_job_that_already_delivered_its_result', () => {
  conEstrategiaFalsa();
  estrategiaLanzada('estrategia-entregada', 55 * MIN, true);
  assert.equal(trabajoHecho(nucleo().db, trabajo('estrategia-entregada')!.id), true);
  assert.equal(relanzarColgados(nucleo().db, db, [CASO_B], AHORA), 0);
  assert.equal(trabajo('estrategia-entregada')?.estado, 'lanzado', 'la vuelta de la cola la completa');
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave = 'estrategia-entregada'").run();
});

test('should_relaunch_an_overdue_job_that_has_not_delivered_its_result', () => {
  conEstrategiaFalsa();
  estrategiaLanzada('estrategia-colgada', 55 * MIN, false);
  assert.equal(relanzarColgados(nucleo().db, db, [CASO_B], AHORA), 1);
  const t = trabajo('estrategia-colgada')!;
  assert.deepEqual([t.estado, t.error?.startsWith(RELANZADO_SOLO)], ['pendiente', true]);
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave = 'estrategia-colgada'").run();
});

test('should_not_consider_hung_a_strategy_running_for_35_minutes', () => {
  conEstrategiaFalsa();
  estrategiaLanzada('estrategia-35', 35 * MIN, false);
  assert.equal(relanzarColgados(nucleo().db, db, [CASO_B], AHORA), 0, 'en producción tardan 27-30 min');
  assert.equal(trabajo('estrategia-35')?.estado, 'lanzado');
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave = 'estrategia-35'").run();
});

test('should_treat_as_not_done_a_job_whose_type_is_unknown_or_whose_check_fails', () => {
  registrarTipoTrabajo('licitaciones.hecho_que_falla', {
    destino: () => null,
    instrucciones: () => 'nada',
    hecho: () => {
      throw new Error('payload raro');
    },
  });
  const falla = encolar(nucleo().db, {
    tipo: 'licitaciones.hecho_que_falla',
    dominio: 'licitaciones',
    clave: 'hecho-que-falla',
    payload: { id: CASO_B },
  });
  const sinTipo = encolar(nucleo().db, {
    tipo: 'licitaciones.sin_registrar',
    dominio: 'licitaciones',
    clave: 'sin-registrar',
    payload: { id: CASO_B },
  });
  assert.deepEqual(
    [trabajoHecho(nucleo().db, falla), trabajoHecho(nucleo().db, sinTipo), trabajoHecho(nucleo().db, 999_999)],
    [false, false, false],
  );
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave IN ('hecho-que-falla', 'sin-registrar')")
    .run();
});

test('should_not_relaunch_endlessly_nor_lift_the_brake_nor_touch_waiting_jobs', () => {
  // Una crítica que se cuelga en cada intento: la cola lo corta (fallar sobrescribe el error) y
  // antes se relanzaba otra vez sin gastar intento, hasta 6 runs y levantando el freno del tipo;
  // ahora el relanzamiento sin gastar intento tiene tope (MAX_RELANZAMIENTOS).
  const db = nucleo().db;
  encolar(db, {
    tipo: 'licitaciones.memoria_critica',
    dominio: 'licitaciones',
    clave: 'siempre-colgado',
    payload: { id: CASO_B },
  });
  encolar(db, {
    tipo: 'licitaciones.memoria_critica',
    dominio: 'licitaciones',
    clave: 'espera-herramienta',
    payload: { id: CASO_B },
  });
  const futuro = new Date(AHORA + HORA).toISOString();
  db.prepare(
    "UPDATE trabajos_ia SET error = 'Falta una herramienta en Hermes (x)', proximo_intento_en = ? WHERE clave = 'espera-herramienta'",
  ).run(futuro);
  db.prepare("UPDATE trabajos_ia SET intentos = 1 WHERE clave = 'siempre-colgado'").run();
  const colgar = () =>
    db
      .prepare(
        "UPDATE trabajos_ia SET estado = 'lanzado', error = 'consulta_fallida: cortado', lanzado_en = ? WHERE clave = 'siempre-colgado'",
      )
      .run(new Date(AHORA - 40 * MIN).toISOString());
  // Dos relanzamientos sin gastar intento; a partir del tercero lo gastan y acaba fallido.
  const tras = [
    ['pendiente', 1],
    ['pendiente', 1],
    ['pendiente', 2],
    ['fallido', 3],
  ];
  for (const esperado of tras) {
    colgar();
    assert.equal(relanzarColgados(db, dbLicitaciones(), [CASO_B], AHORA), 1);
    assert.deepEqual([trabajo('siempre-colgado')?.estado, trabajo('siempre-colgado')?.intentos], esperado);
  }
  const espera = trabajo('espera-herramienta')!;
  assert.deepEqual(
    [espera.estado, espera.proximo_intento_en],
    ['pendiente', futuro],
    'lo que espera una herramienta sigue esperando',
  );
  db.prepare(
    "UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave IN ('siempre-colgado', 'espera-herramienta')",
  ).run();
});

// ── Hoy ──

// Lo que las comprobaciones piden de la empresa para el DEUC y los anexos (datos ficticios).
const PERFIL_COMPLETO = {
  nif: 'B12345674',
  nombre: 'Empresa de prueba SL',
  domicilio: 'Calle Mayor 1, 38001 Puerto de Ejemplo',
  representante: { nombre: 'Persona R', nif: '12345678Z', cargo: 'Administrador' },
  contacto: { email: 'empresa@example.com', telefono: '922000000' },
};

test('should_show_the_countdown_of_each_offer_in_preparation_in_peninsular_time_also_from_canarias', () => {
  // Cerró a las 23:30 peninsular del 14/10 (21:30 UTC), aunque en UTC y en Canarias aún no sean las 23:30.
  enPreparacion('p-cerrada', '2026-10-14T23:30:00');
  // 14/10 a las 22:00 UTC: medianoche en Madrid, las 23:00 en Canarias; el plazo de CASO_E (08:00 peninsular) es a las 06:00 UTC.
  const h = conTz('Atlantic/Canary', () =>
    hoyLicitaciones(db, '2000-01-01T00:00:00Z', Date.parse('2026-10-14T22:00:00Z')),
  );
  const casoE = h.en_preparacion?.find((i) => i.enlace.id === `${CASO_E}/preparacion`);
  assert.deepEqual(
    [casoE?.fecha, casoE?.vence_en, casoE?.restante_ms],
    ['2026-10-15T08:00:00', '2026-10-15T06:00:00.000Z', 8 * HORA],
  );
  // Aplicada a 8 h del cierre: ya vencieron los cuatro hitos, y se avisa con una sola fila.
  const hitos =
    'Hitos del plazo: Vencido el hito «Paquete y firma»: tocaba el 14/10 a las 06:00 hora peninsular, un día antes del cierre interno (y 3 anteriores sin hacer)';
  assert.deepEqual(casoE?.falta, [
    'Elegibilidad: Falta la ficha: pídela',
    hitos,
    'Guion: pídelo con «Extraer del pliego»',
  ]);
  assert.equal(
    casoE?.detalle,
    `Elegibilidad: Falta la ficha: pídela · ${hitos} · Guion: pídelo con «Extraer del pliego»`,
  );
  const ids = h.en_preparacion?.map((i) => (i.enlace.id ?? '').replace('/preparacion', '')) ?? [];
  assert.equal(ids[0], CASO_E, 'la que vence antes, primero');
  assert.ok(!ids.includes('p-cerrada') && !ids.includes('p-presentada'), 'ni vencidas ni presentadas');
  assert.equal(ids.at(-1), 'p-sin-plazo', 'sin plazo, al final');
});

test('should_list_what_is_missing_step_by_step_until_the_offer_is_ready', async () => {
  const ID = 'p-pasos';
  enPreparacion(ID, '2026-10-19T14:00:00');
  const guion = await conFichaYGuion(ID);
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE json_extract(payload, '$.id') = ?").run(ID);
  const falta = () =>
    hoyLicitaciones(db, '2000-01-01T00:00:00Z', AHORA).en_preparacion?.find((i) => i.enlace.id === `${ID}/preparacion`);
  // Las filas de las comprobaciones en su orden (precio, decisiones, documentos, empresa) y después lo que aún no se ha hecho.
  assert.deepEqual(falta()?.falta, [
    'Precio: Precio sin decidir',
    'Decisiones: Decisiones sin fijar',
    'Decisiones: Decide el impuesto de la oferta (IVA, IGIC o exento) y su tipo',
    'Documentos: Archivo electrónico nº 1: 4 documentos sin preparar',
    'Documentos: Archivo electrónico nº 2: 1 documento sin preparar',
    'Empresa: Falta el perfil de la empresa (sus datos van en el DEUC y en los anexos)',
    'Hitos del plazo: Vencido el hito «Decisiones y precio»: tocaba el 12/10 a las 12:00 hora peninsular, 7 días antes del cierre interno',
    'Memoria técnica: sin redactar',
  ]);
  const perfilAntes = nucleo().db.prepare('SELECT datos, actualizado_en FROM perfil_empresa WHERE id = 1').get() as
    { datos: string; actualizado_en: string } | undefined;
  assert.equal(guardarPerfilEmpresa(nucleo().db, PERFIL_COMPLETO).error, null);
  db.prepare(
    "INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, '{}', ?)",
  ).run(ID, guion, new Date().toISOString());
  assert.equal(falta()?.falta[0], 'Precio: Precio sin decidir');
  // Decididas del todo: el precio, cada automático del guion (sin acogernos) y el impuesto que pide la oferta, como las deja un PUT.
  const automaticos = guionVigente(db, ID)!.datos.automaticos.map((a) => ({
    criterio: a.criterio,
    lote: null,
    nos_acogemos: false,
  }));
  const datosAnexo = { subcontratacion_servidores: null, orden_lotes: null, impuesto: { tipo: 'IVA', porcentaje: 21 } };
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(
    JSON.stringify({ precio: { importe: 20_400, pendiente: false }, automaticos, datos_anexo: datosAnexo }),
    ID,
  );
  // Medida dentro del límite: una ensamblada sin medir sale en las comprobaciones como riesgo de páginas.
  const borrador = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, version, paginas)
    VALUES (?, 'Salidas/Licitaciones/p-pasos/memoria-v1.docx', 'h', 10, 'plataforma', ?, 'pendiente', 'ensamblado', 1, 20)`,
      )
      .run(ID, new Date().toISOString()).lastInsertRowid,
  );
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, borrador_id) VALUES (?, ?, 1, 'ensamblada', ?, ?)",
  ).run(ID, guion, new Date().toISOString(), borrador);
  assert.deepEqual(
    falta()?.falta.filter((f) => !f.startsWith('Documentos')),
    ['Memoria técnica: revisa la v1 y dala por buena'],
  );
  db.prepare("UPDATE borradores SET estado = 'aceptada' WHERE id = ?").run(borrador);
  const docs = documentosDe(db, ID).documentos.filter((d) => d.tipo !== 'memoria');
  for (const d of docs.slice(1)) assert.equal(cambiarDocumento(db, ID, d.clave, { estado: 'preparado' }).error, null);
  assert.equal(falta()?.falta.length, 1);
  assert.match(falta()?.falta[0] ?? '', /^Documentos: .*1 documento sin preparar$/);
  assert.equal(
    cambiarDocumento(db, ID, docs[0]!.clave, { estado: 'no_aplica', nota: 'No vamos en UTE con nadie.' }).error,
    null,
  );
  assert.deepEqual(
    [falta()?.falta, falta()?.detalle],
    [['Paquete: prepara el paquete de presentación (paso 4)'], 'Paquete: prepara el paquete de presentación (paso 4)'],
    'lo último: el paquete',
  );
  assert.equal(guionVigente(db, ID)?.id, guion);
  nucleo().db.prepare('DELETE FROM perfil_empresa').run();
  if (perfilAntes)
    nucleo()
      .db.prepare('INSERT INTO perfil_empresa (id, datos, actualizado_en) VALUES (1, ?, ?)')
      .run(perfilAntes.datos, perfilAntes.actualizado_en);
});

test('should_stop_waiting_for_a_ficha_in_progress_when_there_is_no_time_left_for_it_and_the_outline', () => {
  // A 3 h del cierre no caben ficha y guion (85 min) más las 2 h de firma: esperar a la ficha en curso solo atrasaría el guion.
  const lejos = 'p-ficha-en-curso-lejos';
  const cerca = 'p-ficha-en-curso-cerca';
  enPreparacion(lejos, '2026-10-19T14:00:00');
  enPreparacion(cerca, horaLocalEspana(AHORA + 3 * HORA));
  for (const id of [lejos, cerca])
    encolar(nucleo().db, {
      tipo: 'licitaciones.ficha',
      dominio: 'licitaciones',
      clave: `ficha-${id}`,
      payload: { id, pedida_en: new Date(AHORA).toISOString() },
    });
  assert.equal(esperaFicha(nucleo().db, db, lejos, { ahoraMs: AHORA, legible: listo }), true);
  assert.equal(esperaFicha(nucleo().db, db, cerca, { ahoraMs: AHORA, legible: listo }), false);
  nucleo()
    .db.prepare(
      "UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave IN ('ficha-p-ficha-en-curso-lejos', 'ficha-p-ficha-en-curso-cerca')",
    )
    .run();
  descartar(lejos);
  descartar(cerca);
});

test('should_relaunch_a_ficha_that_has_been_running_far_longer_than_a_ficha_takes', () => {
  const id = 'p-ficha-colgada';
  const lanzado = (clave: string, haceMs: number) => {
    encolar(nucleo().db, { tipo: 'licitaciones.ficha', dominio: 'licitaciones', clave, payload: { id } });
    nucleo()
      .db.prepare(
        "UPDATE trabajos_ia SET estado = 'lanzado', run_id = NULL, error = NULL, lanzado_en = ? WHERE clave = ?",
      )
      .run(new Date(AHORA - haceMs).toISOString(), clave);
  };
  lanzado('ficha-colgada', 40 * MIN);
  assert.equal(relanzarColgados(nucleo().db, db, [id], AHORA), 1);
  assert.equal(trabajo('ficha-colgada')?.estado, 'pendiente');
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave = 'ficha-colgada'").run();
  lanzado('ficha-sana', 5 * MIN);
  assert.equal(relanzarColgados(nucleo().db, db, [id], AHORA), 0, 'una ficha que lleva poco no se corta');
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE clave = 'ficha-sana'").run();
});

test('should_count_a_document_downloaded_while_the_run_was_working_against_when_the_ficha_was_asked_for', async () => {
  // La ficha se pidió a las T0, el documento llegó a T0+20 min y la ficha se guardó a T0+30: no lo leyó.
  const ID = 'p-pliego-durante-el-run';
  enPreparacion(ID, '2026-10-19T14:00:00');
  await conFichaYGuion(ID);
  const ts = (min: number) => new Date(Date.now() - min * MIN).toISOString();
  db.prepare('UPDATE fichas SET creada_en = ?, actualizada_en = ?, revisada_en = ? WHERE licitacion_id = ?').run(
    ts(10),
    ts(10),
    ts(10),
    ID,
  );
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, ?, 'adicional', 'Aclaración del PCAP.pdf', 'descargado', ?)",
  ).run(ID, `https://contrataciondelestado.es/doc/aclara-${ID}`, ts(20));
  assert.equal(fichaPorRehacer(db, ID), null, 'sin saber cuándo se pidió, se mide contra cuando se guardó');
  const trabajoFicha = encolar(nucleo().db, {
    tipo: 'licitaciones.ficha',
    dominio: 'licitaciones',
    clave: `ficha-pedida-${ID}`,
    payload: { id: ID, pedida_en: ts(30) },
  });
  db.prepare('UPDATE fichas SET trabajo_id = ? WHERE licitacion_id = ?').run(trabajoFicha, ID);
  assert.match(fichaPorRehacer(db, ID) ?? '', /-p1$/, 'se pidió antes de que llegara el documento');
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE json_extract(payload, '$.id') = ?").run(ID);
  descartar(ID);
});

test('should_ask_the_outline_again_for_a_document_downloaded_while_its_run_was_working', async () => {
  const ID = 'p-pliego-durante-el-guion';
  enPreparacion(ID, '2026-10-19T14:00:00');
  await conFichaYGuion(ID);
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE json_extract(payload, '$.id') = ?").run(ID);
  const ts = (min: number) => new Date(Date.now() - min * MIN).toISOString();
  db.prepare('UPDATE guiones SET creado_en = ? WHERE licitacion_id = ?').run(ts(10), ID);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES (?, ?, 'adicional', 'Modelo de proposición.docx', 'descargado', ?)",
  ).run(ID, `https://contrataciondelestado.es/doc/modelo-${ID}`, ts(20));
  const pedir = () => encolarGuionesAuto(nucleo().db, db, AHORA, { legible: listo });
  pedir();
  assert.deepEqual(
    clavesDe(ID, 'licitaciones.guion'),
    [],
    'sin trabajo enlazado se mide contra cuando se guardó el guion',
  );
  const trabajoGuion = encolar(nucleo().db, {
    tipo: 'licitaciones.guion',
    dominio: 'licitaciones',
    clave: `guion-pedido-${ID}`,
    payload: { id: ID, pedida_en: ts(30) },
  });
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE id = ?").run(trabajoGuion);
  db.prepare('UPDATE guiones SET trabajo_id = ? WHERE licitacion_id = ?').run(trabajoGuion, ID);
  pedir();
  assert.equal(
    clavesDe(ID, 'licitaciones.guion').filter((c) => c.startsWith('guion-auto-')).length,
    1,
    'se pidió antes de que llegara el modelo',
  );
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE json_extract(payload, '$.id') = ?").run(ID);
  descartar(ID);
});

test('should_not_queue_a_second_proposal_for_the_same_outline_and_cancel_the_one_for_an_older_outline', async () => {
  const ID = 'p-dos-propuestas';
  enPreparacion(ID, dentroDeUnaSemana());
  const guion1 = await conFichaYGuion(ID);
  const pendientes = () =>
    (
      nucleo()
        .db.prepare(
          "SELECT payload FROM trabajos_ia WHERE tipo = 'licitaciones.decisiones' AND estado IN ('pendiente', 'lanzado') AND json_extract(payload, '$.id') = ?",
        )
        .all(ID) as { payload: string }[]
    ).map((t) => (JSON.parse(t.payload) as { guion_id: number }).guion_id);
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE json_extract(payload, '$.id') = ?").run(ID);
  assert.equal(pedirPropuestaDecisiones(nucleo().db, db, ID, true).error, null, 'la pidió una persona');
  proponerAlLlegarGuion(nucleo().db, db, ID);
  assert.deepEqual(pendientes(), [guion1], 'ya hay una para este guion: no se encola otra');
  const guion2 = (await proponerGuion(db, GuionEntrada.parse({ id: ID, ...GUION_CASO_A }), 'licitaciones')).data!.guion;
  proponerAlLlegarGuion(nucleo().db, db, ID);
  assert.deepEqual(pendientes(), [guion2], 'la del guion anterior fallaría por guion_id obsoleto: se cancela');
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'cancelado' WHERE json_extract(payload, '$.id') = ?").run(ID);
  descartar(ID);
});

test('should_not_ask_for_the_outline_when_the_only_downloaded_document_is_the_deuc', () => {
  const ID = 'p-solo-deuc';
  enPreparacion(ID, '2026-10-19T14:00:00');
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, tipo, actualizado_en) VALUES (?, ?, 'adicional', 'DEUC.xml', 'descargado', 'deuc', ?)",
  ).run(ID, `https://contrataciondelestado.es/doc/deuc-${ID}`, new Date().toISOString());
  assert.match(pliegosSinLeer(db, ID) ?? '', /Aún no hay pliegos descargados/);
  descartar(ID);
});

test('should_not_take_a_call_about_another_tender_whose_file_number_starts_the_same_as_a_heartbeat', () => {
  // Arrange: el agente lee pliegos del expediente 2026/10; el run colgado es del 2026/1.
  const desde = new Date(AHORA - HORA).toISOString();
  const en = new Date(AHORA - 5 * MIN).toISOString();
  const ins = nucleo().db
    .prepare(`INSERT INTO auditoria_agentes (agente, herramienta, dominio, recurso, resultado, creado_en)
    VALUES ('latido-prueba', 'biblioteca_leer', 'biblioteca', ?, 'ok', ?)`);
  ins.run('Licitaciones/2026/10/pliego-tecnico.pdf', en);
  ins.run('Licitaciones/2026/7', en);
  // Act
  const deA = ultimoLatido(db, 'latido-prueba', { id: 'p-latido-a', expediente: '2026/1' }, desde);
  const deB = ultimoLatido(db, 'latido-prueba', { id: 'p-latido-b', expediente: '2026/10' }, desde);
  const deC = ultimoLatido(db, 'latido-prueba', { id: 'p-latido-c', expediente: '2026/7' }, desde);
  // Assert
  assert.equal(deA, null, 'las lecturas del 2026/10 no son latidos del 2026/1');
  assert.equal(deB, Date.parse(en));
  assert.equal(deC, Date.parse(en), 'también la carpeta del expediente, al final de la ruta');
});
