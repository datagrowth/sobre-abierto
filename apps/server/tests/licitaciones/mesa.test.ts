// La Mesa (mesaDe y GET /api/licitaciones/mesa) sobre Villaejemplo tal como estaba el 13/10/2027
// (fixtures/comprobaciones) más ofertas sintéticas: ESMASA, con la
// solicitud de participación al día siguiente y la ficha por revisar, y ofertas en preparación
// sin ficha con plazos distintos para el orden de «Tu mesa».
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-'));
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
delete process.env.LICITACIONES_MARGEN_FIRMA_HORAS;

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { horaLocalEspana } = await import('../../src/nucleo/fechas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { VERSION_PROMPT_FICHA, TIPO_FICHA } = await import('../../src/dominios/licitaciones/ficha.js');
const { TIPO_GUION } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { TIPO_PROPUESTA_DECISIONES } = await import('../../src/dominios/licitaciones/oferta/propuestaDecisiones.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { duracionesFases, limiteParaDecidir, TIPO_DE_FASE } =
  await import('../../src/dominios/licitaciones/oferta/horaCierre.js');
const { DURACION_MIN } = await import('../../src/dominios/licitaciones/oferta/plazo.js');
const { mesaDe } = await import('../../src/dominios/licitaciones/oferta/mesa.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { primerBloqueoAbierto } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
const { licitacion } = await import('../helpers/sinteticas.js');

type Mesa = NonNullable<ReturnType<typeof mesaDe>['data']>;

iniciarNucleo();
const db = dbLicitaciones();
let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
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

// Villaejemplo como en producción, con el perfil sin certificados (como en comprobacionesFixtures.test.ts).
const CASO_C = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, { ...CASO_C, perfil: { ...CASO_C.perfil, certificados: [] } });
// Miércoles 13/10/2027 a las 22:34 peninsular, la hora de la captura.
const AHORA = Date.parse(CASO_C.ahora);
const FICHA_BASE = leerFixtureComprobaciones('casoD').ficha!.datos;

function sembrarOferta(id: string, estado: string, fechas: { limite: string | null; solicitud?: string | null }): void {
  const l = licitacion({ titulo: `Oferta ${id}`, publicada: '2027-09-23', limite: fechas.limite });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}`, fecha_solicitud: fechas.solicitud ?? null });
  db.prepare(
    'INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, estado, 'CPV 80', '[]', CASO_C.ahora, CASO_C.ahora);
}

const requisito = (descripcion: string, cumple: string, excluyente = true) => ({
  tipo: 'otro',
  descripcion,
  excluyente,
  cumple,
  fuente: 'perfil-licitaciones.md',
  justificacion: 'Según el perfil de la empresa.',
  documento: 'PCAP.pdf',
  pagina: 7,
});

function sembrarFicha(id: string, requisitos: unknown[]): void {
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en, version_prompt) VALUES (?, 'aprobada', ?, 'licitaciones', ?, ?, ?, ?)",
  ).run(
    id,
    JSON.stringify({ ...FICHA_BASE, requisitos }),
    CASO_C.ahora,
    CASO_C.ahora,
    CASO_C.ahora,
    VERSION_PROMPT_FICHA,
  );
}

// ESMASA (p-91000040): solicitud de participación jue 14 a las 23:59, oferta mucho después.
sembrarOferta('p-91000040', 'nueva', { limite: '2027-11-19T14:00:00', solicitud: '2027-10-14T23:59:00' });
sembrarFicha('p-91000040', [
  requisito('Solvencia técnica: tres servicios similares en los últimos tres años.', 'dudoso'),
  requisito('Capacidad de obrar.', 'si'),
  requisito('Clasificación solo para UTE.', 'no_aplica'),
  requisito('Seguro de responsabilidad civil.', 'no', false),
]);
// Una ficha por revisar que vence dentro de una semana y otra sin ficha: ninguna decide hoy.
sembrarOferta('p-30000001', 'nueva', { limite: '2027-10-20T14:00:00' });
sembrarFicha('p-30000001', [requisito('Capacidad de obrar.', 'dudoso')]);
sembrarOferta('p-30000002', 'nueva', { limite: '2027-10-14T14:00:00' });
// En preparación, sin ficha todavía: plazos el 30/10, el 22/10 y sin plazo.
sembrarOferta('p-30000010', 'en_preparacion', { limite: '2027-10-29T14:00:00' });
sembrarOferta('p-30000011', 'en_preparacion', { limite: '2027-10-21T14:00:00' });
sembrarOferta('p-30000012', 'en_preparacion', { limite: null });

const mesa = (ahoraMs = AHORA): Mesa => {
  const r = mesaDe(db, nucleo().db, ahoraMs);
  assert.equal(r.error, null);
  return r.data!;
};
const peninsular = (iso: string | null): string => (iso ? horaLocalEspana(Date.parse(iso)) : '');

test('should_put_a_sheet_to_review_whose_participation_request_is_due_tomorrow_in_decide_today', () => {
  const m = mesa();

  const esmasa = m.decide_hoy.find((x) => x.id === 'p-91000040');
  assert.ok(esmasa && esmasa.tipo === 'ficha_por_revisar', JSON.stringify(m.decide_hoy.map((x) => x.id)));
  assert.equal(esmasa.solicitud, true);
  assert.equal(esmasa.plazo, '2027-10-14T23:59:00+02:00');
  assert.deepEqual(esmasa.excluyentes, [
    {
      texto: 'Solvencia técnica: tres servicios similares en los últimos tres años.',
      cumple: 'dudoso',
      lote: null,
      cita: { documento: 'PCAP.pdf', pagina: 7 },
    },
  ]);
  assert.ok(!m.decide_hoy.some((x) => x.id === 'p-30000001' || x.id === 'p-30000002'));
});

test('should_put_an_offer_stopped_by_eligibility_in_decide_today', () => {
  const m = mesa();

  const casoC = m.decide_hoy.find((x) => x.id === CASO_C.id);
  assert.ok(casoC && casoC.tipo === 'frenada');
  assert.equal(casoC.veredicto.tipo, 'no_presentable');
  // El mismo primer bloqueo que las comprobaciones: uno de medios personales del lote 3 (elegibilidad).
  const comprobaciones = comprobacionesDe(db, nucleo().db, CASO_C.id, AHORA).data!;
  assert.equal(casoC.primer_bloqueo?.clave, primerBloqueoAbierto(comprobaciones.bloqueos)?.clave);
  assert.match(casoC.primer_bloqueo?.clave ?? '', /^medios:3:/);
  // Margen de 2 h → cierre interno el jue 14 a las 21:59 y decide hacia las 18:00.
  assert.equal(peninsular(casoC.hora_interna_cierre), '2027-10-14T21:59:00');
  const limite = peninsular(casoC.limite_decidir);
  assert.ok(limite >= '2027-10-14T17:30:00' && limite <= '2027-10-14T18:30:00', limite);
});

test('should_order_my_desk_by_decide_by_time', () => {
  const m = mesa();

  assert.deepEqual(
    m.tu_mesa.map((f) => f.id),
    ['p-30000011', 'p-30000010', 'p-30000012'],
  );
  assert.equal(m.tu_mesa[2]!.limite_decidir, null);
  for (const f of m.tu_mesa)
    assert.ok(f.fases.length > 0 && f.fases.every((x) => typeof x.nombre === 'string' && typeof x.estado === 'string'));
});

test('should_use_the_median_duration_when_there_are_five_samples', () => {
  const cierre = '2026-10-22T10:00:00.000Z';
  const insertar = nucleo().db
    .prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, lanzado_en, actualizado_en)
    VALUES (?, 'licitaciones', ?, '{}', 'completado', ?, ?, ?)`);
  const antes = mesa().tu_mesa.find((f) => f.id === 'p-30000011')!;
  const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
  for (let i = 0; i < 5; i++) insertar.run(TIPO_GUION, `mediana-${i}`, hace(200), hace(70), hace(60));

  const despues = mesa().tu_mesa.find((f) => f.id === 'p-30000011')!;

  assert.equal(limiteParaDecidir(cierre, ['guion'], duracionesFases({ [TIPO_GUION]: 10 })), '2026-10-22T09:50:00.000Z');
  // Sin guion, a la oferta le queda el guion de Hermes: 10 min reales en vez de los 45 presupuestados.
  assert.equal(
    Date.parse(despues.limite_decidir!) - Date.parse(antes.limite_decidir!),
    (DURACION_MIN.guion - 10) * 60_000,
  );
  nucleo().db.prepare("DELETE FROM trabajos_ia WHERE clave LIKE 'mediana-%'").run();
});

test('should_fall_back_to_the_budgeted_duration_with_fewer_samples', () => {
  const cierre = '2026-10-22T10:00:00.000Z';

  const d = duracionesFases({ [TIPO_FICHA]: null, [TIPO_GUION]: 12 });

  assert.equal(d.decidir, DURACION_MIN.ficha);
  assert.equal(d.guion, 12);
  assert.equal(d.memoria, DURACION_MIN.memoria);
  assert.equal(
    limiteParaDecidir(cierre, ['decidir'], d),
    new Date(Date.parse(cierre) - DURACION_MIN.ficha * 60_000).toISOString(),
  );
  // Las fases se miden con los tipos de trabajo que de verdad las hacen.
  assert.deepEqual(TIPO_DE_FASE, {
    decidir: TIPO_FICHA,
    guion: TIPO_GUION,
    decisiones: TIPO_PROPUESTA_DECISIONES,
    documentos: TIPO_ANEXO,
  });
});

test('should_show_each_offer_once', async () => {
  const res = await fetch(`${base}/mesa`);
  const m = (await res.json()) as Mesa;

  assert.equal(res.status, 200);
  const ids = [...m.decide_hoy, ...m.tu_mesa, ...m.listas_para_firmar].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(', '));
  assert.ok(!m.tu_mesa.some((f) => f.id === CASO_C.id));
  // La ruta usa el reloj real y los plazos sembrados ya vencieron: los minutos se miden a la hora de la captura.
  assert.equal(typeof m.minutos_total, 'number');
  assert.ok(mesa().minutos_total > 0);
});

test('should_say_in_each_row_what_hermes_does_now_for_the_offer', () => {
  // Arrange: el guion de una oferta en cola.
  nucleo()
    .db.prepare(
      `INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en)
    VALUES (?, 'licitaciones', 'mesa-hermes', '{"id":"p-30000011"}', 'pendiente', ?, ?)`,
    )
    .run(TIPO_GUION, CASO_C.ahora, CASO_C.ahora);

  // Act
  const m = mesa();

  // Assert
  const fila = m.tu_mesa.find((f) => f.id === 'p-30000011')!;
  assert.deepEqual(
    { ...fila.hermes, eta: undefined },
    { nombre: 'Guion de la oferta', estado: 'en_cola', eta: undefined, mas: 0 },
  );
  assert.equal(m.tu_mesa.find((f) => f.id === 'p-30000010')!.hermes, null, 'sin trabajos, nada');
  nucleo().db.prepare("DELETE FROM trabajos_ia WHERE clave = 'mesa-hermes'").run();
});

// ── Compromisos caros: el aviso con antelación, con las horas y sin euros ──

const casoCEnMesa = () => {
  const x = mesa().decide_hoy.find((f) => f.id === CASO_C.id);
  assert.ok(x && x.tipo === 'frenada');
  return x;
};

test('should_add_costly_commitments_notice_with_deadline', () => {
  // Arrange: las comprobaciones de Villaejemplo a la hora de la captura (memoria v3 con kits, dedicación y boletines).
  const comprobaciones = comprobacionesDe(db, nucleo().db, CASO_C.id, AHORA).data!;
  const abiertas = comprobaciones.bloqueos.filter(
    (b) => b.clave.startsWith('compromiso_caro:') && (b.estado === 'abierto' || b.estado === 'propuesta'),
  );

  // Act
  const casoC = casoCEnMesa();

  // Assert
  const c = casoC.compromisos_caros;
  assert.ok(c, 'Villaejemplo tiene compromisos caros abiertos');
  assert.equal(c.n, abiertas.length, JSON.stringify(c));
  assert.ok(c.horas > 0, `${c.horas}`);
  assert.equal(c.antes_de, comprobaciones.limite_suavizar);
  assert.ok(
    c.antes_de && Date.parse(c.antes_de) < Date.parse(casoC.hora_interna_cierre!),
    `${c.antes_de} < ${casoC.hora_interna_cierre}`,
  );
  // Las ofertas sin memoria no tienen aviso.
  assert.equal(mesa().tu_mesa.find((f) => f.id === 'p-30000011')!.compromisos_caros, null);
});

test('should_not_include_euros_in_licitaciones_mesa', async () => {
  // Arrange
  const { mesaParaAgente } = await import('../../src/dominios/licitaciones/oferta/toolsMesa.js');
  const web = casoCEnMesa();

  // Act
  const r = mesaParaAgente(db, nucleo().db, { desde: 0, limite: 20 }, AHORA);

  // Assert: dice lo mismo que la Mesa web (cuántos, horas, hasta cuándo) y nada en euros.
  assert.equal(r.error, null);
  const casoC = r.data!.ofertas.find((o) => o.id === CASO_C.id)!;
  assert.deepEqual(casoC.compromisos_caros, web.compromisos_caros);
  assert.deepEqual(Object.keys(casoC.compromisos_caros ?? {}).sort(), ['antes_de', 'horas', 'n']);
  const json = JSON.stringify(r.data);
  assert.doesNotMatch(json, /"euros"|€|\d\s*euros?\b/i);
});

test('should_count_total_row_when_no_single_commitment_is_costly', async () => {
  // Arrange: tres añadidos que no pasan el umbral por fila pero sí, juntos, el del presupuesto.
  const { compromisosCarosDe } = await import('../../src/dominios/licitaciones/oferta/mesa.js');
  const resumen = { anadidos: 3, caros: 0, horas: 30, euros: 5400, presupuesto_pct: 5 };
  const coste = {
    horas: 30,
    euros: 5400,
    supuesto: '',
    clase: 'anadido' as const,
    criterio: null,
    barata: '',
    instruccion: 'x',
    memoria_version: 3,
    apariciones: [],
    nivel: 'alto' as const,
    resumen,
  };
  const fila = (clave: string, horas: number, estado: 'abierto' | 'riesgo_aceptado' = 'abierto') => ({
    clave,
    categoria: 'coherencia' as const,
    lote: null,
    gravedad: 'riesgo' as const,
    titulo: 't',
    cita: null,
    actor: 'tu' as const,
    accion: { tipo: 'suavizar' as const },
    propuesta: null,
    minutos: 1,
    estado,
    huella: 'h',
    coste: { ...coste, horas },
  });
  const comprobaciones = (bloqueos: ReturnType<typeof fila>[]) =>
    ({ limite_suavizar: '2026-10-20T08:00:00.000Z', bloqueos }) as unknown as Parameters<typeof compromisosCarosDe>[0];
  // Act
  const soloTotal = compromisosCarosDe(comprobaciones([fila('compromisos_caros:-:total', 30)]));
  const conSuelta = compromisosCarosDe(
    comprobaciones([fila('compromisos_caros:-:total', 30), fila('compromiso_caro:-:informe', 12)]),
  );
  const aceptado = compromisosCarosDe(comprobaciones([fila('compromisos_caros:-:total', 30, 'riesgo_aceptado')]));
  // Assert
  assert.deepEqual(soloTotal, { n: 3, horas: 30, antes_de: '2026-10-20T08:00:00.000Z', total: true });
  assert.deepEqual(conSuelta, { n: 1, horas: 12, antes_de: '2026-10-20T08:00:00.000Z' });
  assert.equal(aceptado, null);
});
