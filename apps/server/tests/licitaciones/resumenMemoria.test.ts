// Resumen de la memoria y «Dar por buena» sobre la memoria v3 de Villaejemplo del
// 13/10/2027 (fixtures/comprobaciones/casoC.json, seudonimizada): hoja de compromisos, párrafos marcados
// con su antes y después, la nota del crítico ciego con su margen, lo comprobado y lo que se
// descarta al aceptar. La memoria con fases y la limpia son copias de esa oferta con otro id: lo que en
// producción traen los runs (estrategia, crítica, rondas) se escribe con SQL directo.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { comoPersona, de } from '../helpers/persona.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resumen-memoria-'));
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

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { memoriasDe } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { tarjetasDe } = await import('../../src/dominios/licitaciones/oferta/revisionHermes.js');
const { MARGEN_CRITICO, MAX_MARCADOS, MOTIVO_OBLIGATORIO, aceptarMemoria, compromisosDeMemoria } =
  await import('../../src/dominios/licitaciones/oferta/resumenMemoria.js');
const { estrategiaCasoA } = await import('./fixtures/estrategiaCasoA.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type FixtureComprobaciones = import('../helpers/comprobacionesFixtures.js').FixtureComprobaciones;
type ResumenMemoria = import('../../src/dominios/licitaciones/oferta/resumenMemoria.js').ResumenMemoria;

iniciarNucleo();
const db = dbLicitaciones();
const casoC = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, casoC);

// Una copia de la oferta con otro id: los ids de ficha, guion, memoria y borrador se desplazan
// para no chocar, y sin personas ni perfil (ya están en el núcleo).
type MemoriaFixture = FixtureComprobaciones['memorias'][number];
function copia(
  id: string,
  desplazar: number,
  memorias: (ms: MemoriaFixture[]) => MemoriaFixture[],
): FixtureComprobaciones {
  const f = leerFixtureComprobaciones('casoC');
  const g = (n: number) => n + desplazar;
  return {
    ...f,
    id,
    perfil: null,
    personas: [],
    ficha: f.ficha && { ...f.ficha, id: g(f.ficha.id) },
    guiones: f.guiones.map((x) => ({ ...x, id: g(x.id), ficha_id: x.ficha_id === null ? null : g(x.ficha_id) })),
    decisiones: f.decisiones && { ...f.decisiones, guion_id: g(f.decisiones.guion_id) },
    propuesta: f.propuesta && { ...f.propuesta, guion_id: g(f.propuesta.guion_id) },
    memorias: memorias(f.memorias).map((m) => ({
      ...m,
      id: g(m.id),
      guion_id: g(m.guion_id),
      borrador_id: m.borrador_id === null ? null : g(m.borrador_id),
    })),
  };
}

// ── Con fases: estrategia con la hoja de hechos, coherencia, dos rondas criticadas ──

const CON_FASES = 'p-vil-fases';
const conFases = copia(CON_FASES, 1000, (ms) => [{ ...ms[0]!, fase: 'fin' }]);
sembrarFixture(db, nucleo().db, conFases);
const memFases = conFases.memorias[0]!.id;
const HORARIO = {
  clave: 'horario_atencion',
  categoria: 'horario' as const,
  sobre: 'atención académica y técnica',
  valor: 'L-V 9:00-17:00 (peninsular)',
  palabras: ['atención'],
};
const { id: _i, memoria_id: _m, version: _v, ...estrategia } = estrategiaCasoA({ memoria_id: memFases, version: 3 });
const CITA_HORARIO = 'La atención académica y técnica funcionará de lunes a viernes de 9:00 a 18:00, hora peninsular.';
const hallazgo = {
  apartado: 1,
  hecho: 'horario_atencion',
  cita: CITA_HORARIO,
  encontrado: '9:00-18:00',
  esperado: 'L-V 9:00-17:00 (peninsular)',
  tipo: 'contradiccion',
};
db.prepare(
  "INSERT INTO memoria_estrategias (memoria_id, datos, agente, creada_en) VALUES (?, ?, 'licitaciones', '2027-10-13T10:00:00Z')",
).run(memFases, JSON.stringify({ ...estrategia, hechos: [HORARIO] }));
db.prepare('UPDATE memorias SET ronda = 1, coherencia = ? WHERE id = ?').run(JSON.stringify([hallazgo]), memFases);

// Los párrafos del apartado 1 tal como los guarda el sembrador (memoria_apartados.datos).
const parrafosV3 = casoC.memorias[0]!.apartados[0]!.texto!.split(/\n{2,}/)
  .map((p) => p.trim())
  .filter((p) => p.length >= 20 && !p.startsWith('#'));
const ANTES =
  'Los cursos se ofrecerán en bloques: cuatro cursos tras la semana 5 y la jardinería al final, según disponibilidad de la docente.';
const datosRonda = (ps: string[]) =>
  JSON.stringify({ titulo: 'Cronograma', bloques: [{ parrafos: ps.slice(0, 30) }], cubre: [], compromisos: [] });
db.prepare(
  'INSERT INTO memoria_apartado_rondas (memoria_id, apartado, ronda, datos, puntos, tramo) VALUES (?, 1, 0, ?, 6, 6), (?, 1, 1, ?, 8, 8)',
).run(memFases, datosRonda([parrafosV3[0]!, ANTES, ...parrafosV3.slice(2)]), memFases, datosRonda(parrafosV3));

const motivo = (cita: string, n: number) => ({
  cita,
  motivo: `Motivo ${n} para bajar el tramo.`,
  arreglo: `Arreglo ${n} concreto.`,
});
function critica(ronda: number, total: number, ciega: number): void {
  const motivos = [parrafosV3[1]!.slice(0, 120), ...parrafosV3.slice(2, 7).map((p) => p.slice(0, 80))].map(motivo);
  const datos = {
    apartados: [
      { apartado: 1, tramo: 8, puntos: 8, cita: parrafosV3[0]!.slice(0, 60), motivos_para_bajar: motivos, falta: [] },
    ],
    resumen: 'Crítica de la ronda.',
  };
  db.prepare(
    "INSERT INTO memoria_criticas (memoria_id, ronda, datos, total, maximo, independiente, ciega, agente, creada_en) VALUES (?, ?, ?, ?, 40, 1, ?, 'critico', '2027-10-13T11:00:00Z')",
  ).run(memFases, ronda, JSON.stringify(datos), total, ciega);
}
critica(0, 20, 1);
critica(1, 24.5, 1);

// ── Una memoria limpia (sin compromisos ni nada marcado) con otra versión pendiente detrás ──

const LIMPIA = 'p-vil-limpia';
const BLANDO =
  'La empresa impartirá los cursos con una metodología práctica, con guías de estudio y prácticas corregidas para cada participante.';
const limpia = copia(LIMPIA, 2000, (ms) =>
  [ms[0]!, { ...ms[1]!, revision: 'pendiente' }].map((m) => ({
    ...m,
    apartados: m.apartados.map((a) => ({ ...a, compromisos: [], avisos: [], texto: BLANDO })),
  })),
);
sembrarFixture(db, nucleo().db, limpia);

// ── Memorias limpias con compromisos que cuestan: un kit y una entrevista con cada participante ──

// Sintéticas: la memoria de Villaejemplo con costes se mide aparte. El alcance del guion da los
// participantes (100), y sin índice de la Biblioteca no hay pliego con que cotejar.
const KIT = 'La empresa envía a cada participante un kit con cinta métrica y guantes.';
const ENTREVISTA = 'La coordinación invita a cada participante apta a una entrevista individual de 30 minutos.';
const ALCANCE = [
  {
    nombre: 'Topografía y cartografía digital',
    personas_minimas: 100,
    horas: 40,
    grupos: 1,
    semanas: 5,
    documento: 'PPT.pdf',
    pagina: 13,
  },
];
function conCostes(id: string, desplazar: number, frases: string[], lotes?: string[]): FixtureComprobaciones {
  const f = copia(id, desplazar, (ms) =>
    [ms[0]!].map((m) => ({
      ...m,
      apartados: m.apartados.map((a, i) => ({
        ...a,
        compromisos: [],
        avisos: [],
        texto: frases[i] ? `${BLANDO}\n\n${frases[i]}` : BLANDO,
      })),
    })),
  );
  return {
    ...f,
    guiones: f.guiones.map((g) => ({ ...g, datos: { ...g.datos, alcance: ALCANCE, ...(lotes ? { lotes } : {}) } })),
  };
}
const COSTES = 'p-vil-costes';
const costes = conCostes(COSTES, 4000, [KIT, ENTREVISTA]);
sembrarFixture(db, nucleo().db, costes);
const POR_LOTES = 'p-vil-costes-lotes';
sembrarFixture(
  db,
  nucleo().db,
  conCostes(POR_LOTES, 5000, [`En el lote 1, ${KIT}`, `En el lote 3, ${ENTREVISTA.replace(/^La/, 'la')}`], ['1', '3']),
);

// ── Una memoria con una fuga contra el Sobre C (participantes adicionales) y el calendario marcado ──

const FUGA = 'p-vil-fuga';
const FRASE_FUGA =
  'Además, la empresa ofrece dos participantes adicionales en cada curso sin coste para la Diputación.';
const conFuga = copia(FUGA, 3000, (ms) =>
  [ms[0]!].map((m) => ({
    ...m,
    apartados: m.apartados.map((a, i) =>
      i === 0
        ? {
            ...a,
            texto: `${a.texto}

${FRASE_FUGA}`,
          }
        : a,
    ),
  })),
);
sembrarFixture(db, nucleo().db, conFuga);

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use(comoPersona);
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

const url = (id: string, version: number, que: string) =>
  `${base}/api/licitaciones/licitaciones/${id}/oferta/memoria/${version}/${que}`;

async function resumen(id: string, version = 3, lote?: string): Promise<ResumenMemoria> {
  const r = await fetch(`${url(id, version, 'resumen')}${lote ? `?lote=${lote}` : ''}`);
  assert.equal(r.status, 200);
  return (await r.json()) as ResumenMemoria;
}

async function aceptar(
  id: string,
  body: Record<string, unknown>,
  version = 3,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(url(id, version, 'aceptar'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

const estadoBorrador = (id: number) =>
  (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(id) as { estado: string }).estado;

test('should_build_commitments_from_the_facts_sheet_and_from_apartado_commitments_of_an_uploaded_memoria', async () => {
  // Arrange: la v3 de Villaejemplo es una subida (compromisos por apartado); su copia con fases trae la hoja de hechos.
  const deApartados = casoC.memorias[0]!.apartados.reduce((n, a) => n + a.compromisos.length, 0);

  // Act
  const [r1, r2] = [await resumen(casoC.id), await resumen(CON_FASES)];

  // Assert
  assert.equal(r1.compromisos.length, deApartados);
  const consultas = r1.compromisos.find((c) => c.que === 'Responder consultas académicas');
  assert.deepEqual(
    [consultas?.apartado, consultas?.quien, consultas?.valor.startsWith('De lunes a viernes, 9:00–18:00')],
    [1, 'Tutora docente de cada curso', true],
  );
  assert.deepEqual(
    r2.compromisos.map((c) => [c.apartado, c.clave, c.categoria, c.que, c.valor]),
    [[null, 'horario_atencion', 'horario', 'atención académica y técnica', 'L-V 9:00-17:00 (peninsular)']],
  );
  assert.match(r2.compromisos[0]!.choca ?? '', /9:00-18:00/);
});

test('should_bring_the_commitment_sheet_the_schedule_and_the_calendar_contradiction_for_casoC_v3', async () => {
  // Act
  const r = await resumen(casoC.id);

  // Assert: el horario de atención en la hoja, y el calendario («semana 6» frente a los 15 días del pliego) marcado.
  assert.ok(r.compromisos.some((c) => /horario|9:00/i.test(c.valor) && /consultas/i.test(c.que)));
  const calendario = r.marcados.find((p) => p.origen === 'compromisos' && /semana 6/.test(p.motivo));
  assert.ok(calendario, JSON.stringify(r.marcados));
  assert.equal(calendario.apartado, 1);
  assert.match(calendario.motivo, /15 días naturales después de la formalización/);
  assert.ok(calendario.ahora?.includes(calendario.cita.replace(/…$/, '').slice(0, 60)));
  assert.ok(r.comprobado.includes('0 fugas contra los 3 criterios del Sobre “C”'), JSON.stringify(r.comprobado));
  assert.ok(r.comprobado.includes('Lugar de firma rellenado'));
});

test('should_show_only_the_blind_critic_score_with_its_margin', async () => {
  // Act
  const r = await resumen(CON_FASES);

  // Assert: la de la última ronda (24,5 y no 20), con su margen.
  assert.deepEqual(r.nota, { total: 24.5, maximo: 40, margen: MARGEN_CRITICO, fuente: 'critico_ciego' });

  // Arrange: una última ronda que no fue ciega (el crítico miró las decisiones).
  db.prepare('UPDATE memoria_criticas SET ciega = 0 WHERE memoria_id = ? AND ronda = 1').run(memFases);
  try {
    // Act / Assert: no hay nota que enseñar, ni se cae a la de una ronda anterior.
    assert.equal((await resumen(CON_FASES)).nota, null);
  } finally {
    db.prepare('UPDATE memoria_criticas SET ciega = 1 WHERE memoria_id = ? AND ronda = 1').run(memFases);
  }
});

test('should_never_show_self_evaluation_as_score', async () => {
  // Arrange: la autoevaluación de la v3 de Villaejemplo (27 / 40: infla 6-8 puntos).
  const guion = casoC.memorias[0]!.guion_id;
  const criterios = [10, 20, 10].map((peso, i) => ({
    criterio: `Apartado ${i + 1}`,
    peso,
    tipo: 'juicio_valor',
    puntuacion: [7, 13, 7][i],
    justificacion: 'Bien tratado.',
    apartado: i + 1,
  }));
  const datos = {
    resumen: 'Autoevaluación de la memoria v3.',
    puntuacion_total: 27,
    puntuacion_maxima: 40,
    criterios,
    eliminar: [],
    modificar: [],
    reforzar: [],
    comparables: [],
    riesgos: [],
    memoria: { version: 3, guion_id: guion },
  };
  db.prepare(
    "INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en, estado) VALUES (?, 'Salidas/memoria-v3.docx', ?, 'licitaciones', '2027-10-13T12:00:00Z', 'pendiente')",
  ).run(casoC.id, JSON.stringify(datos));
  assert.equal(memoriasDe(db, casoC.id).find((m) => m.version === 3)?.evaluacion?.puntuacion_total, 27);

  // Act
  const r = await resumen(casoC.id);

  // Assert
  assert.equal(r.nota, null);
  assert.ok(!JSON.stringify(r).includes('27 / 40'));
});

test('should_list_at_most_five_marked_paragraphs_with_before_and_after', async () => {
  // Act: la crítica de la última ronda trae 6 motivos para bajar, y la coherencia, el horario.
  const r = await resumen(CON_FASES);

  // Assert
  assert.equal(r.marcados.length, MAX_MARCADOS);
  const [primero] = r.marcados;
  assert.equal(primero?.origen, 'critico');
  assert.deepEqual(primero?.rondas, [
    { ronda: 0, texto: ANTES },
    { ronda: 1, texto: parrafosV3[1] },
  ]);
  assert.equal(primero?.ahora, parrafosV3[1]);
  assert.equal(primero?.arreglo, 'Arreglo 0 concreto.');
});

test('should_reject_a_summary_for_a_version_that_does_not_exist_or_a_lot_outside_the_script', async () => {
  // Act
  const [sinVersion, otroLote, malVersion] = [
    await fetch(url(casoC.id, 9, 'resumen')),
    await fetch(`${url(casoC.id, 3, 'resumen')}?lote=7`),
    await fetch(url(casoC.id, 0, 'resumen')),
  ];

  // Assert
  assert.deepEqual([sinVersion.status, otroLote.status, malVersion.status], [404, 404, 400]);
  assert.equal((await resumen(casoC.id, 3, '3')).version, 3);
});

test('should_list_versions_that_will_be_discarded_on_accept', async () => {
  // Arrange: en la limpia la versión 2 sigue pendiente; en Villaejemplo las anteriores ya se descartaron.
  const [l, a] = [await resumen(LIMPIA), await resumen(casoC.id)];

  // Assert
  assert.deepEqual(l.antes_de_aceptar.se_descartan, [2]);
  assert.deepEqual(a.antes_de_aceptar.se_descartan, []);
  assert.deepEqual([a.antes_de_aceptar.paginas, a.antes_de_aceptar.sin_redactar], [13, []]);
});

test('should_accept_without_reason_when_nothing_is_marked', async () => {
  // Arrange
  const r0 = await resumen(LIMPIA);
  assert.deepEqual([r0.marcados, r0.antes_de_aceptar.avisos, r0.antes_de_aceptar.sin_redactar], [[], [], []]);

  // Act
  const r = await aceptar(LIMPIA, {});

  // Assert: aceptada por la revisión de siempre, la versión 2 descartada y su tarjeta cerrada.
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { version: 3, estado: 'aceptada', descartadas: [2] });
  assert.equal(estadoBorrador(limpia.memorias[0]!.borrador_id!), 'aceptada');
  assert.equal(estadoBorrador(limpia.memorias[1]!.borrador_id!), 'descartada');
  assert.equal((await aceptar(LIMPIA, {})).status, 409);
});

test('should_require_a_reason_to_accept_with_marked_paragraphs', async () => {
  // Arrange: la v3 de Villaejemplo tiene el calendario marcado y su tarjeta pendiente en la bandeja.
  const borrador = casoC.memorias[0]!.borrador_id!;
  assert.equal(tarjetasDe(db, casoC.id, 'web').find((t) => t.clave === 'memoria:v3')?.estado, 'pendiente');

  // Act
  const sin = await aceptar(casoC.id, {});
  const corto = await aceptar(casoC.id, { motivo: 'ok' });

  // Assert
  assert.deepEqual([sin.status, sin.json['message']], [400, MOTIVO_OBLIGATORIO]);
  assert.equal(MOTIVO_OBLIGATORIO, 'Queda algo marcado: di por qué la das por buena');
  assert.equal(corto.status, 400);
  assert.equal(estadoBorrador(borrador), 'pendiente');

  // Act: con motivo.
  const con = await aceptar(
    casoC.id,
    { motivo: 'El calendario arranca en la semana 1, dentro de los 15 días.' },
    3,
    de('Persona A'),
  );

  // Assert
  assert.equal(con.status, 200, JSON.stringify(con.json));
  assert.equal(estadoBorrador(borrador), 'aceptada');
  const cierre = db
    .prepare("SELECT estado, quien, motivo FROM revision_tarjetas WHERE licitacion_id = ? AND clave = 'memoria:v3'")
    .get(casoC.id);
  assert.deepEqual(
    { ...(cierre as object) },
    { estado: 'aceptada', quien: 'Persona A', motivo: 'El calendario arranca en la semana 1, dentro de los 15 días.' },
  );
});

test('should_not_accept_a_memory_with_leaks_with_only_the_marked_reason', async () => {
  // Arrange
  const borrador = conFuga.memorias[0]!.borrador_id!;
  const anulacion = () =>
    (
      db.prepare('SELECT anulacion_fugas FROM memorias WHERE id = ?').get(conFuga.memorias[0]!.id) as {
        anulacion_fugas: string | null;
      }
    ).anulacion_fugas;

  // Act
  const soloMotivo = await aceptar(FUGA, { motivo: 'vale ya' });
  const anulacionCorta = await aceptar(FUGA, { motivo: 'vale ya', anular_fugas: 'no es fuga' });

  // Assert
  assert.equal(soloMotivo.status, 409, JSON.stringify(soloMotivo.json));
  assert.match(String(soloMotivo.json['message']), /causa de exclusión/);
  assert.equal(anulacionCorta.status, 400);
  assert.equal(estadoBorrador(borrador), 'pendiente');
  assert.equal(anulacion(), null);

  // Act: con su propia explicación de por qué no es una fuga.
  const POR_QUE = 'Los participantes adicionales se citan del pliego técnico, no de nuestra oferta.';
  const con = await aceptar(FUGA, { motivo: 'Revisado con el equipo.', anular_fugas: POR_QUE });

  // Assert
  assert.equal(con.status, 200, JSON.stringify(con.json));
  assert.equal(estadoBorrador(borrador), 'aceptada');
  assert.equal(JSON.parse(anulacion()!).motivo, POR_QUE);
});

test('should_not_accept_a_memory_that_is_not_assembled_through_the_function', () => {
  // Arrange: una versión que aún se redacta.
  db.prepare("UPDATE memorias SET estado = 'redactando' WHERE id = ?").run(memFases);

  // Act
  const r = aceptarMemoria(db, CON_FASES, 3, { motivo: 'Lo revisé entero.', quien: 'web' });

  // Assert
  assert.equal(r.error?.code, 'conflicto');
});

test('should_bring_the_discard_reason_and_who_of_previous_versions', async () => {
  // Arrange: la versión 2 de Villaejemplo se descartó desde su tarjeta con su motivo.
  db.prepare(
    `INSERT OR REPLACE INTO revision_tarjetas (licitacion_id, clave, tipo, huella, estado, quien, motivo, creada_en, cerrada_en)
    VALUES (?, 'memoria:v2', 'memoria', 'h', 'descartada', 'Persona A', 'Contradice el calendario del Anexo V', '2027-10-12T09:00:00Z', '2027-10-12T10:00:00Z')`,
  ).run(casoC.id);

  // Act
  const r = await resumen(casoC.id);

  // Assert
  assert.deepEqual(r.descartes, [
    { version: 2, motivo: 'Contradice el calendario del Anexo V', quien: 'Persona A', en: '2027-10-12T10:00:00Z' },
  ]);
});

test('should_list_added_commitments_with_total_cost', async () => {
  // Act
  const r = await resumen(COSTES);

  // Assert: 100 participantes × (18 + 7) € el kit; 100 × 0,75 aptas × (30 + 10) min la entrevista.
  const kit = r.costes.compromisos.find((c) => c.cita === KIT);
  const entrevista = r.costes.compromisos.find((c) => c.cita === ENTREVISTA);
  assert.ok(kit && entrevista, JSON.stringify(r.costes.compromisos));
  assert.deepEqual([kit.apartados, kit.clase, kit.euros, kit.caro], [[1], 'anadido', 2500, true]);
  assert.deepEqual([entrevista.apartados, entrevista.horas, entrevista.euros, entrevista.caro], [[2], 50, 1250, true]);
  assert.match(entrevista.barata, /a petición/i);
  assert.match(entrevista.instruccion, /^En el apartado 2, sustituye «La coordinación invita/);
  const anadidos = r.costes.compromisos.filter((c) => c.clase === 'anadido');
  assert.deepEqual(r.costes.total_anadidos, {
    horas: anadidos.reduce((a, c) => a + (c.horas ?? 0), 0),
    euros: anadidos.reduce((a, c) => a + (c.euros ?? 0), 0),
  });
  assert.equal(r.costes.caros, 2);
  // Presupuesto base del lote 3 de Villaejemplo: 18.557 €.
  assert.equal(r.costes.presupuesto_pct, Math.round((r.costes.total_anadidos.euros / 18557) * 100));
  const directo = compromisosDeMemoria(db, nucleo().db, COSTES, 3, null);
  assert.deepEqual(directo.data, r.costes);
});

test('should_say_not_cotejado_without_pliego', async () => {
  // Arrange: sin índice de la Biblioteca no hay pasajes del PPT ni del PCAP.

  // Act
  const r = await resumen(COSTES);

  // Assert
  assert.equal(r.costes.cotejado, false);
  assert.ok(r.costes.compromisos.length > 0);
  assert.ok(
    r.costes.compromisos.every((c) => c.clase === 'anadido' && c.supuesto.includes('Sin cotejar con el pliego')),
    JSON.stringify(r.costes.compromisos),
  );
});

test('should_filter_commitments_by_lot', async () => {
  // Act
  const [todos, lote1, lote3] = [
    await resumen(POR_LOTES),
    await resumen(POR_LOTES, 3, '1'),
    await resumen(POR_LOTES, 3, '3'),
  ];

  // Assert
  const tipos = (r: ResumenMemoria) =>
    r.costes.compromisos
      .map((c) => (/kit/.test(c.cita ?? '') ? 'kit' : /entrevista/.test(c.cita ?? '') ? 'entrevista' : c.texto))
      .sort();
  assert.deepEqual(tipos(todos), ['entrevista', 'kit']);
  assert.deepEqual(tipos(lote1), ['kit']);
  assert.deepEqual(tipos(lote3), ['entrevista']);
  assert.equal(lote3.costes.total_anadidos.horas, 50);
  assert.equal(compromisosDeMemoria(db, nucleo().db, POR_LOTES, 3, '7').error?.code, 'not_found');
});

test('should_require_motive_to_accept_when_costly_added_commitments_remain', async () => {
  // Arrange: nada marcado; solo los dos añadidos caros.
  const r = await resumen(COSTES);
  assert.deepEqual([r.marcados, r.antes_de_aceptar.sin_redactar], [[], []]);
  const horas = r.costes.compromisos.filter((c) => c.caro).reduce((a, c) => a + (c.horas ?? 0), 0);
  assert.deepEqual(r.antes_de_aceptar.avisos, [
    `2 compromisos añadidos caros (~${horas} h): suavízalos o di por qué los mantienes`,
  ]);

  // Act
  const sin = await aceptar(COSTES, {});
  const con = await aceptar(
    COSTES,
    { motivo: 'El kit y la entrevista puntúan en el criterio de atención.' },
    3,
    de('Persona A'),
  );

  // Assert
  assert.deepEqual([sin.status, sin.json['message']], [400, MOTIVO_OBLIGATORIO]);
  assert.equal(con.status, 200, JSON.stringify(con.json));
  assert.equal(estadoBorrador(costes.memorias[0]!.borrador_id!), 'aceptada');
});

test('should_mark_as_justified_what_the_solution_sheet_brings_with_compensa_or_quitado_counting_it_once', () => {
  // Arrange: la ficha de solución dice por qué compensa la entrevista y quitó el kit.
  const id = 'p-vil-costes-ficha';
  const f = conCostes(id, 8000, [KIT, ENTREVISTA]);
  sembrarFixture(db, nucleo().db, { ...f, memorias: f.memorias.map((m) => ({ ...m, fase: 'fin' })) });
  const {
    id: _id,
    memoria_id: _mid,
    version: _ver,
    ...e
  } = estrategiaCasoA({ memoria_id: f.memorias[0]!.id, version: 3 });
  const compromiso = (texto: string, compensa: string, quitado: boolean) => ({
    texto,
    clase: 'anadido',
    cita: '',
    criterio: 'Atención personalizada',
    compensa,
    horas: 50,
    nivel: null,
    supuesto: '100 participantes × 40 min',
    quitado,
  });
  const solucion = {
    ...e.solucion,
    compromisos: [
      compromiso('Entrevista individual de 30 min con cada participante apta', 'Da 6 puntos en seguimiento', false),
      compromiso('Kit con cinta métrica y guantes para cada participante', '', true),
    ],
  };
  db.prepare(
    "INSERT INTO memoria_estrategias (memoria_id, datos, agente, creada_en) VALUES (?, ?, 'licitaciones', '2027-10-13T10:00:00Z')",
  ).run(f.memorias[0]!.id, JSON.stringify({ ...e, solucion }));

  // Act
  const r = compromisosDeMemoria(db, nucleo().db, id, 3, null);

  // Assert
  assert.equal(r.error, null);
  const entrevista = r.data!.compromisos.find((c) => c.cita === ENTREVISTA)!;
  const kit = r.data!.compromisos.find((c) => c.cita === KIT)!;
  assert.deepEqual(
    [entrevista.justificado, entrevista.caro, entrevista.ficha],
    [true, false, 'En la ficha de solución compensa: Da 6 puntos en seguimiento'],
  );
  assert.deepEqual(
    [kit.justificado, kit.caro, kit.ficha],
    [true, false, 'Se quitó en la ficha de solución: no debería estar en la memoria'],
  );
  assert.equal(r.data!.caros, 0, 'lo justificado no cuenta además como caro');
  const anadidos = r.data!.compromisos.filter((c) => c.clase === 'anadido');
  assert.equal(
    r.data!.total_anadidos.horas,
    anadidos.reduce((a, c) => a + (c.horas ?? 0), 0),
    'su coste sigue en el total, una sola vez',
  );
});

test('should_not_mark_as_justified_without_a_solution_sheet', () => {
  // Arrange: la misma memoria subida a mano, sin ficha de solución.
  const id = 'p-vil-costes-sin-ficha';
  sembrarFixture(db, nucleo().db, conCostes(id, 8500, [KIT, ENTREVISTA]));

  // Act
  const r = compromisosDeMemoria(db, nucleo().db, id, 3, null);

  // Assert
  assert.equal(r.error, null);
  assert.deepEqual(
    r.data!.compromisos.map((c) => c.justificado),
    r.data!.compromisos.map(() => false),
  );
  assert.equal(r.data!.caros, 2);
});

test('should_flag_total_risk_with_profile_threshold_when_no_row_is_costly', async () => {
  // Arrange: umbrales por fila tan altos que nada es caro; el total (20 % de 18.557 €) frente a un umbral del 5 % y del 30 %.
  const { guardarPerfilCostes, perfilCostesPorDefecto } = await import('../../src/nucleo/perfilCostes.js');
  const id = 'p-vil-costes-total';
  sembrarFixture(db, nucleo().db, conCostes(id, 9000, [KIT, ENTREVISTA]));
  const alto = { ...perfilCostesPorDefecto(), umbral_horas: 1000, umbral_euros: 100_000, umbral_pct_presupuesto: 1 };
  try {
    assert.equal(guardarPerfilCostes(nucleo().db, { ...alto, umbral_total_pct: 0.05 }).error, null);
    // Act
    const bajo = await resumen(id);
    const sin = await aceptar(id, {});
    assert.equal(guardarPerfilCostes(nucleo().db, { ...alto, umbral_total_pct: 0.3 }).error, null);
    const exigente = await resumen(id);

    // Assert
    assert.deepEqual([bajo.costes.caros, bajo.costes.total_riesgo, bajo.costes.umbral_total_pct], [0, true, 5]);
    assert.match(
      bajo.antes_de_aceptar.avisos.join(' '),
      /^Los 2 compromisos añadidos suman ~\d+ h y juntos pasan del 5 % del presupuesto: suavízalos o di por qué los mantienes$/,
    );
    assert.deepEqual([sin.status, sin.json['message']], [400, MOTIVO_OBLIGATORIO]);
    assert.deepEqual(
      [exigente.costes.total_riesgo, exigente.costes.umbral_total_pct, exigente.antes_de_aceptar.avisos],
      [false, 30, []],
    );
  } finally {
    guardarPerfilCostes(nucleo().db, perfilCostesPorDefecto());
  }
});
