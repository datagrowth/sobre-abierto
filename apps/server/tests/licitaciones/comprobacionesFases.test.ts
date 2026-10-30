// Carril de fases, Hermes en vivo y hora interna de cierre de las comprobaciones: funciones
// puras sobre las entradas de las ofertas sintéticas (fixtures/comprobaciones) y casos sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  EntradasComprobaciones,
  TrabajoEnCurso,
} from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import { componerComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobaciones.js';
import { fasesDe, hermesEnVivo } from '../../src/dominios/licitaciones/oferta/comprobacionesFases.js';
import type { Bloqueo, Fase, NombreFase } from '../../src/dominios/licitaciones/oferta/comprobacionesTipos.js';
import { documentosDelGuion } from '../../src/dominios/licitaciones/oferta/documentos.js';
import type { GuionBaseData } from '../../src/dominios/licitaciones/oferta/guion.js';
import {
  duracionesFases,
  fasesPendientesDeHermes,
  horaInternaCierre,
  limiteParaDecidir,
} from '../../src/dominios/licitaciones/oferta/horaCierre.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'comprobaciones');
type Fixture = {
  id: string;
  ahora: string;
  licitacion: { fecha_limite: string | null };
  oportunidad: EntradasComprobaciones['oportunidad'] & { lotes_interes: string[] | null };
  guiones: { id: number; version: number; ficha_id: number | null; datos: GuionBaseData; creado_en: string }[];
  decisiones: EntradasComprobaciones['decisiones'];
  propuesta: EntradasComprobaciones['propuesta'];
  documentos: EntradasComprobaciones['documentos']['filas'];
  pliegos: EntradasComprobaciones['pliegos'];
  ficha: { id: number; creada_en: string; version_prompt: number } | null;
};

const leerFixture = (nombre: string): Fixture =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, `${nombre}.json`), 'utf8')) as Fixture;

// Solo lo que mira el carril; lo demás vacío. Las memorias no entran: ninguna de estas pruebas las necesita.
function entradasDe(f: Fixture, extra: Partial<EntradasComprobaciones> = {}): EntradasComprobaciones {
  const g = f.guiones.at(-1)!;
  const guion = {
    ...g,
    licitacion_id: f.id,
    avisos: [],
    agente: 'oferta',
    version_prompt: 1,
    trabajo_id: null,
    cambios: null,
  };
  const ambito = f.oportunidad?.lotes_interes ?? [];
  return {
    id: f.id,
    ahoraMs: Date.parse(f.ahora),
    licitacion: {
      fecha_limite: f.licitacion.fecha_limite,
      fecha_solicitud: null,
      borrada_en: null,
      borrada_motivo: null,
    },
    oportunidad: f.oportunidad ? { ...f.oportunidad, lotes_interes: JSON.stringify(ambito) } : null,
    lotes: { lotes: [], presentacion: null, ambito: null } as unknown as EntradasComprobaciones['lotes'],
    ambito,
    ficha: f.ficha as unknown as EntradasComprobaciones['ficha'],
    guion,
    decisiones: f.decisiones,
    decisiones_version: 1,
    propuesta: f.propuesta,
    memoria: null,
    hallazgos: [],
    fugas: null,
    textos_memoria: [],
    documentos: { filas: f.documentos, del_guion: documentosDelGuion(guion.datos, ambito) },
    perfil: null,
    personas: [],
    pliegos: f.pliegos,
    trabajos: [],
    paquete: null,
    coherencia: [],
    guardados: new Map(),
    duraciones: duracionesFases(),
    decisiones_incompletas: [],
    ...extra,
  };
}

function bloqueo(b: Partial<Bloqueo> & Pick<Bloqueo, 'categoria' | 'gravedad'>): Bloqueo {
  return {
    clave: `prueba:${b.categoria}`,
    lote: null,
    titulo: 'Prueba',
    cita: null,
    actor: 'tu',
    accion: { tipo: 'vamos' },
    propuesta: null,
    minutos: 1,
    estado: 'abierto',
    huella: 'h',
    ...b,
  };
}

const trabajo = (t: Partial<TrabajoEnCurso> & Pick<TrabajoEnCurso, 'tipo'>): TrabajoEnCurso => ({
  id: 1,
  estado: 'lanzado',
  creado_en: '2026-10-14T18:00:00.000Z',
  actualizado_en: '2026-10-14T18:10:00.000Z',
  lanzado_en: '2026-10-14T18:01:00.000Z',
  ...t,
});

const fase = (fases: Fase[], nombre: NombreFase): Fase => fases.find((f) => f.nombre === nombre)!;

for (const nombre of ['casoD', 'casoB']) {
  test(`should_mark_the_memory_phase_not_applicable_when_the_outline_has_no_memory (${nombre})`, () => {
    // Arrange
    const e = entradasDe(leerFixture(nombre));
    // Act
    const memoria = fase(fasesDe(e, []), 'memoria');
    // Assert
    assert.equal(e.guion?.datos.memoria, null);
    assert.deepEqual(memoria, { nombre: 'memoria', estado: 'no_aplica', actor: 'hermes', eta: null });
  });
}

test('should_not_mark_decisions_done_while_a_lot_price_is_pending', () => {
  // Arrange: Villaejemplo, decisiones del guion vigente con el precio del lote 3 sin decidir.
  const f = leerFixture('casoC');
  const vigente = f.guiones.at(-1)!.id;
  const e = entradasDe(f, { decisiones: { ...f.decisiones!, guion_id: vigente }, propuesta: null });
  // Act
  const decisiones = fase(fasesDe(e, []), 'decisiones');
  // Assert
  assert.deepEqual(
    e.decisiones?.datos.ofertas.map((o) => o.pendiente),
    [true],
  );
  assert.equal(decisiones.estado, 'te_toca');
});

test('should_mark_decisions_done_when_every_lot_price_is_decided_on_the_current_outline', () => {
  // Arrange
  const f = leerFixture('casoC');
  const d = f.decisiones!;
  const conPrecio = {
    ...d,
    guion_id: f.guiones.at(-1)!.id,
    datos: { ...d.datos, ofertas: [{ lote: '3', pendiente: false, importe: 1, unitarios: [] }] },
  };
  // Act
  const decisiones = fase(fasesDe(entradasDe(f, { decisiones: conPrecio, propuesta: null }), []), 'decisiones');
  // Assert
  assert.equal(decisiones.estado, 'hecho');
});

test('should_block_a_phase_after_an_open_eligibility_blocker', () => {
  // Arrange: CASO_E con el ENS BÁSICA exigido y sin acreditar (impide abierto de elegibilidad), aún sin pliegos bajados.
  const e = entradasDe(leerFixture('casoE'), { pliegos: [] });
  const ens = bloqueo({ categoria: 'elegibilidad', gravedad: 'impide', clave: 'excluyente_vs_perfil:-:ens' });
  // Act
  const fases = fasesDe(e, [ens]);
  // Assert
  assert.equal(fase(fases, 'decidir').estado, 'te_toca');
  assert.equal(fase(fases, 'pliegos').estado, 'bloqueado');
});

test('should_not_block_the_next_phase_once_the_blocker_is_accepted', () => {
  // Arrange
  const e = entradasDe(leerFixture('casoE'));
  const aceptado = bloqueo({ categoria: 'elegibilidad', gravedad: 'impide', estado: 'vamos' });
  // Act
  const fases = fasesDe(e, [aceptado]);
  // Assert
  assert.equal(fase(fases, 'decidir').estado, 'hecho');
  assert.notEqual(fase(fases, 'pliegos').estado, 'bloqueado');
});

test('should_give_an_eta_from_the_running_job', () => {
  // Arrange: CASO_E sin guion y con su extracción en marcha.
  const e = entradasDe(leerFixture('casoE'), { guion: null, trabajos: [trabajo({ tipo: 'licitaciones.guion' })] });
  // Act
  const guion = fase(fasesDe(e, []), 'guion');
  // Assert: desde su último paso más los 45 min del guion.
  assert.equal(guion.estado, 'en_curso');
  assert.deepEqual(guion.eta, { desde: '2026-10-14T18:10:00.000Z', hasta: '2026-10-14T18:55:00.000Z' });
});

test('should_report_the_oldest_running_job_as_hermes_live', () => {
  // Arrange
  const nuevo = trabajo({
    id: 9,
    tipo: 'licitaciones.anexo',
    estado: 'pendiente',
    creado_en: '2026-10-14T19:00:00.000Z',
    lanzado_en: null,
  });
  const viejo = trabajo({ id: 4, tipo: 'licitaciones.guion' });
  // Act
  const vivo = hermesEnVivo({ trabajos: [nuevo, viejo] });
  // Assert
  assert.deepEqual(vivo, { tipo: 'licitaciones.guion', estado: 'generando', desde: '2026-10-14T18:01:00.000Z' });
  assert.equal(hermesEnVivo({ trabajos: [] }), null);
});

test('should_put_the_internal_close_two_hours_before_the_deadline_in_peninsular_time', () => {
  // Arrange: Villaejemplo cierra el jue 14 a las 23:59 peninsular (CEST, UTC+2).
  const { licitacion } = leerFixture('casoC');
  // Act
  const cierre = horaInternaCierre(licitacion.fecha_limite, 2);
  // Assert: 21:59 peninsular (19:59 UTC), 20:59 en Canarias.
  assert.equal(licitacion.fecha_limite, '2027-10-14T23:59:00');
  assert.equal(cierre, '2027-10-14T19:59:00.000Z');
  const partes = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Atlantic/Canary',
    weekday: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(cierre!));
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value;
  assert.deepEqual([parte('weekday'), parte('day'), parte('hour'), parte('minute')], ['jue', '14', '20', '59']);
});

test('should_return_no_internal_close_without_a_readable_deadline', () => {
  assert.equal(horaInternaCierre(null, 2), null);
  assert.equal(horaInternaCierre('pronto', 2), null);
});

test('should_subtract_the_remaining_machine_time_to_get_the_decide_by_time', () => {
  // Arrange
  const cierre = '2026-10-15T19:59:00.000Z';
  // Act
  const conPaquete = limiteParaDecidir(cierre, ['guion', 'memoria', 'paquete']);
  const repetida = limiteParaDecidir(cierre, ['guion', 'memoria', 'memoria']);
  // Assert: 45 + 180 + 0 = 3 h 45 min; una fase repetida cuenta una sola vez.
  assert.equal(conPaquete, '2026-10-15T16:14:00.000Z');
  assert.equal(repetida, '2026-10-15T16:14:00.000Z');
  assert.equal(limiteParaDecidir(cierre, []), cierre);
  assert.equal(limiteParaDecidir(null, ['guion']), null);
});

test('should_not_mark_decisions_done_with_an_empty_amount_and_pending_unchecked', () => {
  // Arrange: CASO_E guardó así su precio: «pendiente» desmarcado y sin importe.
  const f = leerFixture('casoC');
  const d = f.decisiones!;
  const vacio = {
    ...d,
    guion_id: f.guiones.at(-1)!.id,
    datos: { ...d.datos, ofertas: [{ lote: '3', pendiente: false, importe: null, unitarios: [] }] },
  };
  // Act
  const decisiones = fase(fasesDe(entradasDe(f, { decisiones: vacio, propuesta: null }), []), 'decisiones');
  // Assert
  assert.equal(decisiones.estado, 'te_toca');
});

test('should_give_the_same_decide_by_time_as_the_desk_with_the_real_durations', () => {
  // Arrange: con medianas reales de la cola (la propuesta tarda 30 min y el anexo 50).
  const duraciones = duracionesFases({ 'licitaciones.decisiones': 30, 'licitaciones.anexo': 50 });
  const e = entradasDe(leerFixture('casoC'), { duraciones });
  // Act
  const c = componerComprobaciones(e, 2);
  // Assert: toda la cadena que falta, no solo las fases que mueve Hermes.
  const esperado = limiteParaDecidir(c.hora_interna_cierre, fasesPendientesDeHermes(c.fases), duraciones);
  assert.ok(fasesPendientesDeHermes(c.fases).includes('decisiones'));
  assert.equal(c.limite_decidir, esperado);
});

test('should_report_the_certificates_we_have_as_checked', () => {
  // Arrange: el pliego de CASO_E exige ENS BÁSICA y el perfil tiene ENS media vigente.
  const perfil = {
    perfil: { certificados: [{ nombre: 'ENS', nivel: 'media', caduca: '2028-03-29' }] },
    actualizado_en: '2027-10-13T00:00:00.000Z',
  };
  const e = entradasDe(leerFixture('casoE'), { perfil: perfil as unknown as EntradasComprobaciones['perfil'] });
  // Act
  const c = componerComprobaciones(e, 2);
  // Assert
  assert.ok(
    c.comprobado.some((x) => x.texto === 'ENS BÁSICA: la tenemos, vigente hasta 29/03/2028'),
    JSON.stringify(c.comprobado),
  );
});

test('should_not_say_outline_and_decisions_match_while_the_decisions_are_from_another_outline', () => {
  // Arrange: decisiones del guion anterior (CASO_D: «Tus decisiones son del guion v15, vigente v17»).
  const f = leerFixture('casoC');
  const vigente = f.guiones.at(-1)!.id;
  const alDia = componerComprobaciones(
    entradasDe(f, { decisiones: { ...f.decisiones!, guion_id: vigente }, propuesta: null }),
    2,
  );
  const deOtro = componerComprobaciones(
    entradasDe(f, { decisiones: { ...f.decisiones!, guion_id: vigente - 1 }, propuesta: null }),
    2,
  );
  // Act
  const claves = (c: typeof alDia) => c.comprobado.map((x) => x.clave);
  // Assert
  assert.ok(deOtro.bloqueos.some((b) => b.clave.startsWith('decisiones_obsoletas:')));
  assert.ok(claves(alDia).includes('coherencia'));
  assert.ok(!claves(deOtro).includes('coherencia'));
});
