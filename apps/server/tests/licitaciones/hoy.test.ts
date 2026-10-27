// Lo que aporta Licitaciones a «Hoy», con entradas reales recortadas de la PLACSP.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUION_CASO_A } from './fixtures/casoA.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hoy-lic-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { procesarPagina } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const { seguirLicitacion, detalle, listarOportunidades, Filtro, solicitudDeHitos, solicitudesDeFichas } =
  await import('../../src/dominios/licitaciones/oportunidades.js');
const { marcarBorrada } = await import('../../src/dominios/licitaciones/store.js');
const { faltaDePreparacion } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { pendientesDeRevisar } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { hoyLicitaciones } = await import('../../src/dominios/licitaciones/hoy.js');

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
iniciarNucleo();
procesarPagina(dbLicitaciones(), FUENTES.perfiles, fs.readFileSync(path.join(FIX, 'perfiles-pagina1.atom'), 'utf8'));

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('should_list_upcoming_deadlines_and_new_opportunities_without_asking_to_approve_fichas', () => {
  const db = dbLicitaciones();
  seguirLicitacion(db, 'p-20571214');
  db.prepare(
    `INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES ('p-20571214', 'aprobada', '{}', 'hermes', ?, ?)`,
  ).run('2026-10-10T08:00:00Z', '2026-10-10T08:00:00Z');
  // El plazo del fixture acaba el 16/10/2026: a 6 días del 10/10.
  const h = hoyLicitaciones(db, '2000-01-01T00:00:00Z', Date.parse('2026-10-10T09:00:00Z'));
  assert.deepEqual(
    h.vence.map((v) => v.enlace.id),
    ['p-20571214'],
  );
  assert.deepEqual(h.por_aprobar, [], 'las fichas se aplican al llegar');
  assert.equal(h.novedades_total, 1);
  assert.equal(
    hoyLicitaciones(db, '2999-01-01T00:00:00Z', Date.parse('2026-10-10T09:00:00Z')).novedades_total,
    0,
    'nada es nuevo desde el futuro',
  );
  assert.equal(
    hoyLicitaciones(db, '2000-01-01T00:00:00Z', Date.parse('2026-09-01T09:00:00Z')).vence.length,
    0,
    'a más de 7 días no vence pronto',
  );
});

test('should_describe_the_triage_verdict_of_new_opportunities_as_the_web_says_it', () => {
  const db = dbLicitaciones();
  const detalle = (veredicto: string) => {
    db.prepare("UPDATE oportunidades SET veredicto_ia = ? WHERE licitacion_id = 'p-20571214'").run(veredicto);
    return hoyLicitaciones(db, '2000-01-01T00:00:00Z').novedades[0]?.detalle ?? '';
  };
  assert.match(detalle('interesa'), /Hermes: Encaja$/);
  assert.match(detalle('revisar'), /Hermes: Encaja con dudas$/);
  assert.match(detalle('descartar'), /Hermes: No encaja$/);
});

test('should_warn_about_a_followed_tender_cancelled_in_placsp_and_drop_its_deadline', () => {
  const db = dbLicitaciones();
  const { atom_id } = db.prepare("SELECT atom_id FROM licitaciones WHERE id = 'p-20571214'").get() as {
    atom_id: string;
  };
  db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = 'p-20571214'").run();
  marcarBorrada(db, atom_id, '2026-10-05T14:58:56.605+02:00', 'ANULADA');
  const h = hoyLicitaciones(db, '2000-01-01T00:00:00Z', Date.parse('2026-10-10T09:00:00Z'));
  assert.deepEqual(h.vence, [], 'una anulada ya no vence');
  assert.deepEqual(
    h.por_aprobar.map((p) => [p.tipo, p.enlace.id, p.detalle]),
    [['retirada', 'p-20571214', 'Anulada en la PLACSP: ya no se puede presentar: busca si la vuelven a publicar']],
  );
  const d = detalle(db, 'p-20571214').data!;
  assert.deepEqual(d.retirada, { en: '2026-10-05T14:58:56', motivo: 'ANULADA', etiqueta: 'Anulada' });
  assert.equal(d.estado_placsp, 'Anulada');
  assert.equal(
    hoyLicitaciones(db, '2000-01-01T00:00:00Z', Date.parse('2026-12-10T09:00:00Z')).por_aprobar.length,
    0,
    'pasado un mes deja de avisar',
  );
});

test('should_not_notify_anything_about_a_discarded_tender_and_notify_again_if_it_is_recovered', () => {
  const db = dbLicitaciones();
  db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = 'p-20571214'").run();
  db.prepare("UPDATE licitaciones SET borrada_en = NULL, borrada_motivo = NULL WHERE id = 'p-20571214'").run();
  db.prepare(
    `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado)
    VALUES ('p-20571214', 'Salidas/Licitaciones/x/borrador.md', 'h', 10, 'licitaciones', '2026-10-09T08:00:00Z', 'pendiente')`,
  ).run();
  db.prepare(
    `INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en, estado)
    VALUES ('p-20571214', 'Salidas/Licitaciones/x/borrador.md', '{}', 'licitaciones', '2026-10-09T09:00:00Z', 'pendiente')`,
  ).run();
  const ahora = Date.parse('2026-10-10T09:00:00Z');
  const avisos = () => {
    const h = hoyLicitaciones(db, '2000-01-01T00:00:00Z', ahora);
    return [...h.vence, ...h.por_aprobar, ...h.novedades].map((i) => i.tipo).sort();
  };
  assert.deepEqual(avisos(), ['borrador', 'evaluacion', 'plazo']);
  db.prepare("UPDATE oportunidades SET estado = 'descartada' WHERE licitacion_id = 'p-20571214'").run();
  assert.deepEqual(avisos(), [], 'descartada: ni plazo ni pendientes');
  db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = 'p-20571214'").run();
  assert.deepEqual(avisos(), ['borrador', 'evaluacion', 'plazo'], 'recuperada: vuelve a avisar');
});

test('should_say_what_waits_for_review_and_where_and_open_the_preparation', () => {
  const db = dbLicitaciones();
  db.prepare('DELETE FROM borradores').run();
  db.prepare('DELETE FROM evaluaciones').run();
  db.prepare(
    `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, version)
    VALUES ('p-20571214', 'Salidas/Licitaciones/x/memoria-v5.docx', 'h', 10, 'plataforma', '2026-10-09T08:00:00Z', 'pendiente', 'ensamblado', 5)`,
  ).run();
  const evaluacion = db.prepare(
    `INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en, estado) VALUES ('p-20571214', ?, ?, 'licitaciones', ?, 'pendiente')`,
  );
  evaluacion.run(
    'Salidas/Licitaciones/x/memoria-v5.docx',
    JSON.stringify({ memoria: { version: 5 } }),
    '2026-10-09T09:00:00Z',
  );
  evaluacion.run('Conocimiento/Licitaciones/Presentadas/memoria-villaejemplo.pdf', '{}', '2026-10-09T10:00:00Z');
  const h = hoyLicitaciones(db, '2000-01-01T00:00:00Z', Date.parse('2026-10-10T09:00:00Z'));
  assert.deepEqual(
    h.por_aprobar.map((p) => [p.enlace.id, p.detalle]),
    [
      [
        'p-20571214/preparacion',
        'Evaluación de «memoria-villaejemplo.pdf» por revisar · en Preparación › Memoria › Más opciones',
      ],
      ['p-20571214/preparacion', 'Memoria técnica v5: dala por buena o pide cambios · en Preparación › Memoria'],
    ],
    'la evaluación de una versión de la memoria no se revisa: explica su nota',
  );
  assert.deepEqual(
    h.por_aprobar.map((p) => p.corto),
    ['Evaluación por revisar', 'Memoria v5 por revisar'],
  );
  const fila = listarOportunidades(
    db,
    Filtro.parse({ estados: ['en_preparacion'] }),
    Date.parse('2026-10-10T09:00:00Z'),
  ).items.find((i) => i.id === 'p-20571214');
  assert.equal(
    fila?.pendiente,
    'Evaluación de «memoria-villaejemplo.pdf» por revisar',
    'la lista dice lo último pendiente de cada una',
  );
});

test('should_warn_first_about_the_participation_request_and_then_about_the_offer', () => {
  const db = dbLicitaciones();
  db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = 'p-20571214'").run();
  db.prepare("UPDATE licitaciones SET fecha_solicitud = '2026-10-11T12:00:00' WHERE id = 'p-20571214'").run();
  const vence = (iso: string) =>
    hoyLicitaciones(db, '2000-01-01T00:00:00Z', Date.parse(iso)).vence.map((v) => [v.fecha, v.detalle]);
  assert.deepEqual(vence('2026-10-10T09:00:00Z'), [
    ['2026-10-11T12:00:00', 'Solicitud de participación · Instituto Ejemplo de Cultura'],
  ]);
  assert.deepEqual(
    vence('2026-10-12T09:00:00Z'),
    [['2026-10-16T20:00:00', 'Instituto Ejemplo de Cultura']],
    'pasada la solicitud, la oferta',
  );
  assert.deepEqual(
    vence('2026-10-05T09:00:00Z'),
    [['2026-10-11T12:00:00', 'Solicitud de participación · Instituto Ejemplo de Cultura']],
    'la solicitud avisa aunque la oferta quede a más de 7 días',
  );
  assert.equal(detalle(db, 'p-20571214').data!.fecha_solicitud, '2026-10-11T12:00:00');
  db.prepare("UPDATE licitaciones SET fecha_solicitud = NULL WHERE id = 'p-20571214'").run();
});

test('should_take_the_participation_deadline_from_the_sheet_milestones_when_the_feed_lacks_it', () => {
  const hitos = [
    { hito: 'Inicio previsto', fecha: '2026-11-15' },
    { hito: 'Confirmar participación', fecha: '2026-10-07T12:00:00' },
  ];
  assert.equal(solicitudDeHitos(hitos, '2026-10-13T09:00:00'), '2026-10-07T12:00:00');
  assert.equal(
    solicitudDeHitos([{ hito: 'Confirmar participación', fecha: '2026-10-20T12:00:00' }], '2026-10-13T09:00:00'),
    null,
    'después de la oferta no es una solicitud',
  );
  assert.equal(solicitudDeHitos([{ hito: 'Fin de presentación', fecha: '2026-10-07' }], null), null);
});

test('should_copy_the_participation_deadline_from_the_sheet_so_the_list_and_today_see_it', () => {
  const db = dbLicitaciones();
  db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = 'p-20571214'").run();
  db.prepare("UPDATE licitaciones SET fecha_solicitud = NULL WHERE id = 'p-20571214'").run();
  db.prepare(
    `INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES ('p-20571214', 'aprobada', ?, 'hermes', ?, ?)`,
  ).run(
    JSON.stringify({ hitos: [{ hito: 'Confirmar participación', fecha: '2026-10-11T12:00:00' }] }),
    '2026-10-10T08:00:00Z',
    '2026-10-10T08:00:00Z',
  );
  assert.equal(solicitudesDeFichas(db), 1);
  assert.equal(solicitudesDeFichas(db), 0, 'una sola vez');
  const fila = db.prepare("SELECT fecha_solicitud FROM licitaciones WHERE id = 'p-20571214'").get() as {
    fecha_solicitud: string;
  };
  assert.equal(fila.fecha_solicitud, '2026-10-11T12:00:00');
  db.prepare("UPDATE licitaciones SET fecha_solicitud = NULL WHERE id = 'p-20571214'").run();
});

// ── Memoria de otro guion y precio vacío de la versión 1 (CASO_E, 14/10/2026) ──
const LIC = 'p-20571214';
const TS = '2026-10-14T08:00:00Z';

function limpiarOferta(): void {
  const db = dbLicitaciones();
  for (const t of ['borradores', 'memorias', 'decisiones_oferta', 'guiones'])
    db.prepare(`DELETE FROM ${t} WHERE licitacion_id = ?`).run(LIC);
}

function sembrarGuion(version: number, datos: unknown = GUION_CASO_A): number {
  return Number(
    dbLicitaciones()
      .prepare(
        "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, ?, ?, 'test', 1, ?)",
      )
      .run(LIC, version, JSON.stringify(datos), TS).lastInsertRowid,
  );
}

// El mismo guion con otro límite de páginas: pide otra memoria.
const conOtroLimite = {
  ...GUION_CASO_A,
  memoria: { ...GUION_CASO_A.memoria, limite_paginas: (GUION_CASO_A.memoria.limite_paginas ?? 20) + 5 },
};

// Una memoria (versión 1) ensamblada sobre `guion` con su borrador en `revision`.
function sembrarMemoria(guion: number, revision: 'pendiente' | 'aceptada'): void {
  const db = dbLicitaciones();
  const b = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, guion_id, version)
    VALUES (?, 'Salidas/Licitaciones/x/memoria-v1.docx', 'h', 10, 'plataforma', ?, ?, 'ensamblado', ?, 1)`,
      )
      .run(LIC, TS, revision, guion).lastInsertRowid,
  );
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, borrador_id) VALUES (?, ?, 1, 'ensamblada', ?, ?, ?)",
      )
      .run(LIC, guion, TS, TS, b).lastInsertRowid,
  );
  db.prepare('UPDATE borradores SET memoria_id = ? WHERE id = ?').run(m, b);
}

const faltaMemoriaTexto = () =>
  faltaDePreparacion(dbLicitaciones(), LIC).filter((f) => f.startsWith('Memoria técnica'));
// La memoria de otro guion la dice su fila de las comprobaciones (memoria_obsoleta), en Decisiones.
const memoriaObsoleta = () =>
  faltaDePreparacion(dbLicitaciones(), LIC).filter((f) =>
    /^Decisiones: La (memoria )?v\d+ es de un guion anterior/.test(f),
  );

// CASO_E tenía la memoria del guion 13 sin revisar con el 19 vigente, y Hoy decía «dala por buena».
test('should_not_tell_casoE_to_accept_an_outdated_memory', () => {
  limpiarOferta();
  const g13 = sembrarGuion(1);
  sembrarGuion(2);
  sembrarMemoria(g13, 'pendiente');

  const falta = faltaDePreparacion(dbLicitaciones(), LIC);

  assert.deepEqual(memoriaObsoleta(), ['Decisiones: La v1 es de un guion anterior: no la des por buena']);
  assert.deepEqual(faltaMemoriaTexto(), [], 'la fila de las comprobaciones no se repite con otras palabras');
  assert.ok(!falta.some((f) => /dala por buena/.test(f)), falta.join(' | '));
  limpiarOferta();
});

test('should_say_accepted_memoria_is_from_a_previous_outline_when_the_outline_asks_for_another_memoria', () => {
  limpiarOferta();
  const g1 = sembrarGuion(1);
  sembrarGuion(2, conOtroLimite);
  sembrarMemoria(g1, 'aceptada');
  assert.equal(memoriaObsoleta().length, 1, faltaDePreparacion(dbLicitaciones(), LIC).join(' | '));
  assert.deepEqual(faltaMemoriaTexto(), []);
  limpiarOferta();
});

test('should_keep_accepted_memoria_valid_when_the_outline_is_extracted_again_unchanged', () => {
  // Una ficha nueva (otra versión del análisis) vuelve a sacar el guion igual: otro id, la misma memoria.
  limpiarOferta();
  const g1 = sembrarGuion(1);
  sembrarGuion(2);
  sembrarMemoria(g1, 'aceptada');
  assert.deepEqual(faltaMemoriaTexto(), []);
  limpiarOferta();
});

test('should_keep_asking_to_accept_when_memoria_matches_the_current_outline', () => {
  limpiarOferta();
  sembrarMemoria(sembrarGuion(1), 'pendiente');
  assert.deepEqual(faltaMemoriaTexto(), ['Memoria técnica: revisa la v1 y dala por buena']);
  limpiarOferta();
});

function decidirV1(guion: number, datos: unknown): string[] {
  const db = dbLicitaciones();
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    LIC,
    guion,
    JSON.stringify(datos),
    TS,
  );
  return faltaDePreparacion(db, LIC).filter((f) => f.startsWith('Precio'));
}

test('should_count_missing_price_when_v1_price_has_no_amount_and_is_not_pending', () => {
  limpiarOferta();
  const faltas = decidirV1(sembrarGuion(1), {
    lotes: [],
    equipo: [],
    automaticos: [],
    precio: { importe: null, pendiente: false },
  });
  assert.ok(faltas.includes('Precio: Precio sin decidir'), faltas.join(' | '));
  limpiarOferta();
});

test('should_not_count_missing_price_when_every_lot_has_unit_prices', () => {
  limpiarOferta();
  const ofertas = [{ lote: null, pendiente: false, importe: null, unitarios: [{ concepto: 'Informe', precio: 120 }] }];
  const faltas = decidirV1(sembrarGuion(1), { lotes: [], equipo: [], automaticos: [], ofertas });
  assert.deepEqual(faltas, []);
  limpiarOferta();
});

test('should_mark_outdated_memoria_in_pending_reviews_instead_of_asking_to_accept', () => {
  limpiarOferta();
  const g1 = sembrarGuion(1);
  sembrarGuion(2);
  sembrarMemoria(g1, 'pendiente');
  const p = pendientesDeRevisar(dbLicitaciones(), 10, LIC)[0]!;
  assert.equal(p.texto, 'Memoria técnica v1: es de un guion anterior; pide una nueva con el guion vigente');
  assert.equal(p.corto, 'Memoria v1 desfasada');
  assert.doesNotMatch(p.texto, /dala por buena/);
  limpiarOferta();
});

// ── La cuenta del menú: las licitaciones que te esperan en la Mesa ──
const idsDeAvisos = (h: ReturnType<typeof hoyLicitaciones>) =>
  h.por_aprobar
    .filter((i) => i.tipo === 'retirada' || i.tipo === 'pliegos')
    .map((i) => (i.enlace.id ?? '').split('/')[0]);

test('should_count_tenders_with_open_user_blockers_once_and_explain_the_decisions', async () => {
  // Arrange: Villaejemplo como el 14/10/2026 (la única oferta en preparación) y sus comprobaciones esperadas.
  const { nucleo } = await import('../../src/nucleo/contexto.js');
  const { leerFixtureComprobaciones, leerEsperadoComprobaciones, sembrarFixture } =
    await import('../helpers/comprobacionesFixtures.js');
  const db = dbLicitaciones();
  db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE licitacion_id = ?").run(LIC);
  const casoC = leerFixtureComprobaciones('casoC');
  sembrarFixture(db, nucleo().db, { ...casoC, perfil: { ...casoC.perfil, certificados: [] } });

  // Act
  const h = hoyLicitaciones(db, '2000-01-01T00:00:00Z', Date.parse(casoC.ahora));

  // Assert: las filas «tu» abiertas de sus comprobaciones (entre ellas las que el fixture espera), no lo que espera revisión.
  const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
  const tuyas = comprobacionesDe(db, nucleo().db, casoC.id, Date.parse(casoC.ahora)).data!.bloqueos.filter(
    (b) => b.actor === 'tu' && b.gravedad !== 'ok' && (b.estado === 'abierto' || b.estado === 'propuesta'),
  );
  const { mesaDe } = await import('../../src/dominios/licitaciones/oferta/mesa.js');
  const decideHoy = mesaDe(db, nucleo().db, Date.parse(casoC.ahora)).data!.decide_hoy;
  const frenadas = decideHoy.filter((d) => d.tipo === 'frenada').map((d) => d.id);
  const esperadas = new Set([...(tuyas.length ? [casoC.id] : []), ...frenadas, ...idsDeAvisos(h)]);
  assert.equal(
    h.tareas,
    esperadas.size,
    'una por licitación: la de las comprobaciones, las frenadas y los avisos de la PLACSP (las fichas por decidir, en Oportunidades)',
  );
  const decisiones = tuyas.length + decideHoy.filter((d) => d.tipo === 'frenada').length;
  assert.match(
    h.resumen ?? '',
    new RegExp(`^${decisiones} decisiones tuyas en 1 oferta( ·|$)`),
    'el texto dice las decisiones que hay detrás',
  );
  const { mesaParaAgente } = await import('../../src/dominios/licitaciones/oferta/toolsMesa.js');
  const mcp = mesaParaAgente(db, nucleo().db, { desde: 0, limite: 20 }, Date.parse(casoC.ahora)).data!;
  assert.equal(
    mcp.ofertas.reduce((s, o) => s + o.tareas_tuyas, 0),
    tuyas.length,
    'licitaciones_mesa cuenta las mismas tareas tuyas',
  );
  assert.deepEqual(
    leerEsperadoComprobaciones('casoC').tu.filter((k) => !tuyas.some((b) => b.clave === k)),
    [],
  );
});

test('should_count_a_braked_offer_once_in_the_menu_like_decide_hoy', async () => {
  // Arrange: CASO_E sin ENS en el perfil: su único freno es un «impide» de negocio (no tuyo).
  const { nucleo } = await import('../../src/nucleo/contexto.js');
  const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
  const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
  const { mesaDe, tareaTuya } = await import('../../src/dominios/licitaciones/oferta/mesa.js');
  const db = dbLicitaciones();
  db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE estado = 'en_preparacion'").run();
  const casoE = leerFixtureComprobaciones('casoE');
  sembrarFixture(db, nucleo().db, { ...casoE, perfil: { ...casoE.perfil, certificados: [] } });
  const ahora = Date.parse(casoE.ahora);

  // Act
  const h = hoyLicitaciones(db, '2000-01-01T00:00:00Z', ahora);

  // Assert
  const mesa = mesaDe(db, nucleo().db, ahora).data!;
  assert.ok(
    mesa.decide_hoy.some((d) => d.tipo === 'frenada' && d.id === casoE.id),
    'la Mesa la pone en «Decide hoy»',
  );
  const enMesa = [
    ...mesa.decide_hoy.filter((d) => d.tipo === 'frenada'),
    ...mesa.tu_mesa,
    ...mesa.listas_para_firmar,
  ].map((f) => f.id);
  const conTuyas = enMesa.filter((id) => comprobacionesDe(db, nucleo().db, id, ahora).data!.bloqueos.some(tareaTuya));
  const esperadas = new Set([
    ...conTuyas,
    ...mesa.decide_hoy.filter((d) => d.tipo === 'frenada').map((d) => d.id),
    ...idsDeAvisos(h),
  ]);
  assert.equal(h.tareas, esperadas.size, 'la frenada cuenta como una licitación, aunque no tenga tareas tuyas');
  assert.ok(esperadas.has(casoE.id));
});

test('should_fall_back_to_pending_reviews_for_other_domains', async () => {
  // Arrange: un dominio que cuenta tareas y otro que no las conoce.
  const { registrarHoy, resumenHoy } = await import('../../src/nucleo/hoy.js');
  const item = {
    tipo: 'nota',
    titulo: 'Nota',
    detalle: null,
    fecha: null,
    importe: null,
    enlace: { seccion: 'prueba-otro' },
  };
  registrarHoy('prueba-tareas', () => ({
    seccion: 'prueba-tareas',
    vence: [],
    por_aprobar: [item, item],
    novedades: [],
    novedades_total: 0,
    tareas: 7,
    otras_cuentas: { 'prueba-hermana': 4 },
  }));
  registrarHoy('prueba-otro', () => ({
    seccion: 'prueba-otro',
    vence: [],
    por_aprobar: [item, item, item],
    novedades: [],
    novedades_total: 0,
  }));

  // Act
  const { cuentas } = await resumenHoy('2000-01-01T00:00:00Z');

  // Assert
  assert.equal(cuentas['prueba-tareas'], 7, 'con tareas manda la cuenta de tareas');
  assert.equal(cuentas['prueba-otro'], 3, 'sin tareas, lo que espera revisión');
  assert.equal(cuentas['prueba-hermana'], 4, 'otra entrada del menú que cuenta el mismo dominio');
});

test('should_count_a_ficha_to_decide_in_opportunities_not_in_the_pipeline', () => {
  // Arrange: una ficha aprobada sin decidir cuya solicitud de participación vence mañana.
  const db = dbLicitaciones();
  const ahora = Date.parse('2026-10-01T09:00:00Z');
  db.prepare("UPDATE oportunidades SET estado = 'nueva' WHERE licitacion_id = 'p-20571214'").run();
  db.prepare("UPDATE licitaciones SET fecha_solicitud = NULL, borrada_en = NULL WHERE id = 'p-20571214'").run();
  const antes = hoyLicitaciones(db, '2000-01-01T00:00:00Z', ahora);
  db.prepare("UPDATE licitaciones SET fecha_solicitud = '2026-10-02T12:00:00' WHERE id = 'p-20571214'").run();

  // Act
  const h = hoyLicitaciones(db, '2000-01-01T00:00:00Z', ahora);

  // Assert: es una oportunidad por revisar, no una oferta: no suma en el Pipeline, sí en Oportunidades.
  assert.equal(h.tareas, antes.tareas);
  assert.ok((h.otras_cuentas?.oportunidades ?? 0) >= 1);
  assert.equal(h.otras_cuentas?.oportunidades, antes.otras_cuentas?.oportunidades);
  db.prepare("UPDATE licitaciones SET fecha_solicitud = NULL WHERE id = 'p-20571214'").run();
});

test('should_count_a_withdrawn_tender_we_follow_in_the_menu', () => {
  // Arrange
  const db = dbLicitaciones();
  const ahora = Date.parse('2026-10-10T09:00:00Z');
  db.prepare("UPDATE licitaciones SET borrada_en = NULL, borrada_motivo = NULL WHERE id = 'p-20571214'").run();
  const antes = hoyLicitaciones(db, '2000-01-01T00:00:00Z', ahora).tareas ?? 0;
  db.prepare(
    "UPDATE licitaciones SET borrada_en = '2026-10-09T10:00:00', borrada_motivo = 'ANULADA' WHERE id = 'p-20571214'",
  ).run();

  // Act
  const h = hoyLicitaciones(db, '2000-01-01T00:00:00Z', ahora);

  // Assert
  assert.ok(h.por_aprobar.some((i) => i.tipo === 'retirada' && i.enlace.id === 'p-20571214'));
  assert.equal(h.tareas, antes + 1);
  db.prepare("UPDATE licitaciones SET borrada_en = NULL, borrada_motivo = NULL WHERE id = 'p-20571214'").run();
});
