// Lo que promete la memoria frente al equipo, el pliego, los automáticos, lo que
// Hermes dijo no prometer y los anexos. La función es pura; la fila de las comprobaciones se mide con las 5
// ofertas de ejemplo (fixtures/comprobaciones/, seudonimizadas): riesgo en Villaejemplo (calendario) y en
// CASO_E (24/7, avisos), nada en CASO_B ni en CASO_D (sin memoria) y nunca «impide».
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coherencia-compromisos-'));
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
const { comprobacionesDe, componerComprobaciones } =
  await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { leerEntradasComprobaciones } = await import('../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js');
const { coherenciaCompromisos, noPrometerDe } =
  await import('../../src/dominios/licitaciones/oferta/coherenciaCompromisos.js');
const { OFERTAS_COMPROBACIONES, leerEsperadoComprobaciones, leerFixtureComprobaciones, sembrarFixture } =
  await import('../helpers/comprobacionesFixtures.js');

type Entrada = Parameters<typeof coherenciaCompromisos>[0];
type Comprobaciones = ReturnType<typeof componerComprobaciones>;
type EntradasComprobaciones = Parameters<typeof componerComprobaciones>[0];
type Oferta = (typeof OFERTAS_COMPROBACIONES)[number];
type J = Record<string, any>;

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const GUION_VACIO: Entrada['guion'] = { automaticos: [], memoria: null };
const entrada = (x: Partial<Entrada>): Entrada => ({
  compromisos: [],
  textos: [],
  decisiones: null,
  personas: [],
  nombresEquipo: [],
  guion: GUION_VACIO,
  plazos: [],
  noPrometer: [],
  anexos: [],
  ...x,
});

// La memoria de la oferta de un fixture (la última), como la leen las comprobaciones: un texto por apartado.
function desdeFixture(oferta: Oferta): Entrada {
  const f = leerFixtureComprobaciones(oferta) as unknown as J;
  const m = f.memorias[0];
  return entrada({
    textos: m.apartados.map((a: J) => a.texto ?? ''),
    compromisos: m.apartados.flatMap((a: J) => a.compromisos.map((c: J) => ({ apartado: a.apartado, ...c }))),
    decisiones: f.decisiones.datos,
    guion: f.guiones[0].datos,
    plazos: f.ficha.datos.hitos.map((h: J) => ({
      texto: [h.hito, h.detalle].filter(Boolean).join(': '),
      pagina: h.pagina ?? null,
    })),
    noPrometer: noPrometerDe([f.propuesta.datos.enfoque, f.propuesta.datos.resumen, ...f.propuesta.avisos]),
  });
}

const MEMORIA_LOTE: Entrada['guion']['memoria'] = {
  archivo: 'Sobre B',
  titulo_documento: 'Memoria técnica',
  limite_paginas: null,
  formato: null,
  advertencias: [],
  documento: 'PCAP',
  pagina: 3,
  apartados: [
    {
      titulo: 'Metodología',
      puntos: 20,
      se_valorara: ['La metodología'],
      puntos_se_valorara: [],
      escala: [],
      documento: 'PCAP',
      pagina: 3,
    },
  ],
} as unknown as Entrada['guion']['memoria'];

test('should_flag_casoC_calendar_starting_in_week_6_against_15_days_from_formalization', () => {
  const e = desdeFixture('casoC');

  const choques = coherenciaCompromisos(e).filter((c) => c.tipo === 'plazo_guion');

  assert.ok(
    choques.some((c) => c.encontrado === 'semana 6' && c.apartado === 1),
    JSON.stringify(choques),
  );
  assert.match(choques[0]!.esperado, /15 días naturales después de la formalización/);
  assert.match(choques[0]!.esperado, /pág\. 51/);
  assert.ok(!choques.some((c) => c.encontrado === 'semana 1'));
});

test('should_flag_casoE_memory_promising_alerts_and_24_7_that_hermes_said_not_to_promise', () => {
  const e = desdeFixture('casoE');

  const choques = coherenciaCompromisos(e).filter((c) => c.tipo === 'no_prometer');

  const prometido = choques.map((c) => c.encontrado);
  assert.ok(e.noPrometer.includes('avisos') && e.noPrometer.includes('asistente 24/7'), JSON.stringify(e.noPrometer));
  assert.ok(prometido.includes('avisos'), JSON.stringify(prometido));
  assert.ok(prometido.includes('asistente 24/7'), JSON.stringify(prometido));
  assert.match(
    choques.find((c) => c.encontrado === 'asistente 24/7')!.cita,
    /asistente de IA propio, disponible de forma continuada/,
  );
  assert.ok(!prometido.includes('experiencia docente no documentada'));
});

test('should_flag_a_person_named_in_the_memory_who_is_not_in_the_team', () => {
  const e = entrada({
    textos: ['La coordinación recaerá en Ana García Pérez. Luis Martín Sanz impartirá el módulo de topografía.'],
    personas: ['Ana García Pérez', 'Luis Martín Sanz'],
    nombresEquipo: ['Ana García Pérez'],
  });

  const choques = coherenciaCompromisos(e);

  assert.deepEqual(
    choques.map((c) => [c.tipo, c.apartado, c.encontrado]),
    [['persona_fuera', 1, 'Luis Martín Sanz']],
  );
  assert.equal(choques[0]!.cita, 'Luis Martín Sanz impartirá el módulo de topografía.');
});

test('should_not_flag_a_person_who_is_in_the_team', () => {
  const e = entrada({
    textos: ['La coordinación recaerá en Ana García Pérez.\n\nFdo.: Luis Martín Sanz'],
    personas: ['Ana García Pérez', 'Luis Martín Sanz'],
    nombresEquipo: ['Ana García Pérez'],
  });

  assert.deepEqual(coherenciaCompromisos(e), []);
});

test('should_flag_an_automatic_criterion_mark_when_we_do_not_apply', () => {
  const guion = {
    memoria: MEMORIA_LOTE,
    automaticos: [
      {
        criterio: 'Certificación ambiental',
        puntos: 5,
        como_se_acredita: 'Certificado',
        casilla_en: 'Anexo VI',
        archivo: 'Sobre B',
        marcas: ['ISO 14001'],
        documento: 'PCAP',
        pagina: 9,
      },
    ],
  } as unknown as Entrada['guion'];
  const decisiones = {
    automaticos: [{ criterio: 'Certificación ambiental', nos_acogemos: false }],
  } as unknown as Entrada['decisiones'];
  const e = entrada({
    guion,
    decisiones,
    textos: ['Trabajaremos con un sistema de gestión ambiental conforme a la ISO 14001.'],
  });

  const choques = coherenciaCompromisos(e);

  assert.deepEqual(
    choques.map((c) => [c.tipo, c.encontrado]),
    [['automatico_no_acogido', 'ISO 14001']],
  );
  assert.equal(
    coherenciaCompromisos({
      ...e,
      decisiones: {
        automaticos: [{ criterio: 'Certificación ambiental', nos_acogemos: true }],
      } as unknown as Entrada['decisiones'],
    }).length,
    0,
  );
});

test('should_not_flag_an_automatic_criterion_we_apply_to_in_another_lot', () => {
  const guion = {
    memoria: MEMORIA_LOTE,
    automaticos: [
      {
        criterio: 'Bolsa de horas',
        puntos: 5,
        como_se_acredita: 'Anexo',
        casilla_en: 'Anexo V',
        archivo: 'Sobre C',
        marcas: ['bolsa de horas'],
        documento: 'PCAP',
        pagina: 9,
      },
    ],
  } as unknown as Entrada['guion'];
  const decidir = (lote2: boolean, lotes: string[]) =>
    ({
      lotes,
      automaticos: [
        { criterio: 'Bolsa de horas', lote: '1', nos_acogemos: false },
        { criterio: 'Bolsa de horas', lote: '2', nos_acogemos: lote2 },
      ],
    }) as unknown as Entrada['decisiones'];
  const textos = ['En el lote 2 se ofrece una bolsa de horas de soporte adicional.'];

  const acogidoEnOtro = coherenciaCompromisos(entrada({ guion, textos, decisiones: decidir(true, ['1', '2']) }));
  const enNinguno = coherenciaCompromisos(entrada({ guion, textos, decisiones: decidir(false, ['1', '2']) }));
  const otroFuera = coherenciaCompromisos(entrada({ guion, textos, decisiones: decidir(true, ['1']) }));

  assert.deepEqual(acogidoEnOtro, []);
  assert.deepEqual(
    enNinguno.map((c) => c.tipo),
    ['automatico_no_acogido'],
  );
  assert.deepEqual(
    otroFuera.map((c) => c.tipo),
    ['automatico_no_acogido'],
  );
});

test('should_flag_a_memory_schedule_that_clashes_with_the_annex', () => {
  const e = entrada({
    textos: ['El horario de atención será de 9:00 a 14:00.'],
    anexos: [{ clave: 'anexo_vi', dato: 'Horario de atención', valor: 'de 8:00 a 15:00' }],
  });

  const choques = coherenciaCompromisos(e);

  assert.deepEqual(
    choques.map((c) => [c.tipo, c.encontrado]),
    [['anexo_distinto', '9:00-14:00']],
  );
});

test('should_return_nothing_for_an_offer_without_memory', () => {
  const e = entrada({
    personas: ['Ana García Pérez'],
    noPrometer: ['alertas'],
    plazos: [{ texto: 'Inicio en 15 días desde la formalización', pagina: 3 }],
  });

  assert.deepEqual(coherenciaCompromisos(e), []);
});

// ── La fila de las comprobaciones, con las 5 ofertas de ejemplo ──

// Perfil y personas son del núcleo, uno para todas: las comprobaciones de cada oferta se calculan antes de sembrar la siguiente.
// leerEntradasComprobaciones ya trae el texto de la memoria: es lo mismo que componen Hoy, el MCP y las comprobaciones.
const COMPROBACIONES = new Map<Oferta, Comprobaciones>();
const DE_COMPROBACIONES_DE = new Map<Oferta, Comprobaciones>();
const ENTRADAS = new Map<Oferta, EntradasComprobaciones>();
for (const o of OFERTAS_COMPROBACIONES) {
  // El perfil, como en comprobacionesFixtures.test.ts: sin certificados (ni ENS), con la verdad de hoy.
  const capturado = leerFixtureComprobaciones(o);
  const f = { ...capturado, perfil: { ...capturado.perfil, certificados: [] } };
  nucleo().db.prepare('DELETE FROM personas').run();
  sembrarFixture(db, nucleo().db, f);
  const r = leerEntradasComprobaciones(db, nucleo().db, f.id, Date.parse(f.ahora));
  assert.equal(r.error, null, `${o}: ${r.error?.message ?? ''}`);
  ENTRADAS.set(o, r.data!);
  COMPROBACIONES.set(o, componerComprobaciones(r.data!, nucleo().config.licitaciones.margenFirmaHoras));
  DE_COMPROBACIONES_DE.set(o, comprobacionesDe(db, nucleo().db, f.id, Date.parse(f.ahora)).data!);
}
const promete = (o: Oferta) => COMPROBACIONES.get(o)!.bloqueos.filter((b) => b.clave.startsWith('memoria_promete:'));

test('should_add_a_risk_row_to_the_comprobaciones_with_its_quote', () => {
  const casoC = promete('casoC');
  const casoE = promete('casoE');

  const calendario = casoC.find((b) => b.clave === 'memoria_promete:1:plazo_guion');
  assert.ok(calendario, JSON.stringify(casoC.map((b) => b.clave)));
  assert.equal(calendario.gravedad, 'riesgo');
  assert.equal(calendario.categoria, 'coherencia');
  assert.match(calendario.titulo, /«semana 6»/);
  assert.match(calendario.cita!.documento, /^Memoria v3, apartado 1$/);
  assert.match(calendario.cita!.texto, /administración electrónica, 6 a 10/);
  assert.match(
    calendario.titulo,
    /el pliego dice «Inicio del servicio: Los cursos arrancan como máximo 15 días naturales después de la formalización \(pliego, pág\. 51\)»/,
  );
  assert.deepEqual(calendario.accion, { tipo: 'revisar_memoria', destino: 'memoria.apartado.1' });
  const noPrometer = casoE.find((b) => b.clave === 'memoria_promete:2:no_prometer');
  assert.ok(noPrometer, JSON.stringify(casoE.map((b) => b.clave)));
  assert.match(noPrometer.titulo, /«avisos»/);
  assert.match(noPrometer.titulo, /«asistente 24\/7»/);
});

test('should_not_review_what_the_presentada_promises', () => {
  // Arrange
  const e = ENTRADAS.get('casoC')!;
  const presentada = { ...e, memoria: { ...e.memoria!, presentada: true } };

  // Act
  const filas = componerComprobaciones(presentada, nucleo().config.licitaciones.margenFirmaHoras).bloqueos.filter((b) =>
    b.clave.startsWith('memoria_promete:'),
  );

  // Assert
  assert.ok(promete('casoC').length > 0, 'sin presentar sí hay filas');
  assert.deepEqual(filas, [], 'lo entregado ya no se revisa');
});

// Hoy, la Mesa y el MCP componen con comprobacionesDe; sin el texto en las entradas no verían la fila.
test('should_show_the_same_memory_promise_rows_through_comprobacionesDe_as_hoy_and_mcp_do', () => {
  for (const o of OFERTAS_COMPROBACIONES) {
    const viaComprobacionesDe = DE_COMPROBACIONES_DE.get(o)!
      .bloqueos.filter((b) => b.clave.startsWith('memoria_promete:'))
      .map((b) => b.clave);
    assert.deepEqual(
      viaComprobacionesDe,
      promete(o).map((b) => b.clave),
      o,
    );
  }
  assert.ok(DE_COMPROBACIONES_DE.get('casoC')!.bloqueos.some((b) => b.clave === 'memoria_promete:1:plazo_guion'));
});

test('should_add_nothing_to_offers_without_memory_and_never_block', () => {
  const todas = OFERTAS_COMPROBACIONES.flatMap((o) => promete(o));

  assert.deepEqual(promete('casoB'), []);
  assert.deepEqual(promete('casoD'), []);
  assert.deepEqual(
    todas.filter((b) => b.gravedad !== 'riesgo'),
    [],
  );
  for (const o of OFERTAS_COMPROBACIONES) {
    const c = COMPROBACIONES.get(o)!;
    const impiden = c.bloqueos
      .filter((b) => b.gravedad === 'impide')
      .map((b) => b.clave)
      .sort();
    assert.equal(c.veredicto.tipo, leerEsperadoComprobaciones(o).veredicto, o);
    assert.deepEqual(impiden, [...leerEsperadoComprobaciones(o).impide].sort(), o);
  }
});
