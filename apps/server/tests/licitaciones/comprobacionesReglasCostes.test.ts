// Regla de las comprobaciones «compromiso caro no exigido»: una fila de riesgo con su coste y
// «Suavizar» por cada añadido que pasa el umbral del perfil de costes, la fila del total frente al
// presupuesto y hasta cuándo da tiempo a una ronda de memoria (limite_suavizar). Puro: las
// entradas se montan a mano y la memoria de Villaejemplo es la de fixtures/costes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { perfilCostesPorDefecto, type PerfilCostesData } from '../../src/nucleo/perfilCostes.js';
import {
  componerComprobaciones,
  duracionRondaMin,
  limiteSuavizar,
  type BloqueoConCoste,
} from '../../src/dominios/licitaciones/oferta/comprobaciones.js';
import type {
  EntradasComprobaciones,
  EstadoGuardado,
} from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';
import { reglaCompromisosCaros } from '../../src/dominios/licitaciones/oferta/comprobacionesReglasCostes.js';
import { MINUTOS_POR_ACCION } from '../../src/dominios/licitaciones/oferta/comprobacionesTipos.js';
import type { CompromisoDeFicha, GuionData } from '../../src/dominios/licitaciones/oferta/costesCompromisos.js';
import { duracionesFases } from '../../src/dominios/licitaciones/oferta/horaCierre.js';
import type { EstadoMemoria } from '../../src/dominios/licitaciones/oferta/memoria.js';
import { duracionMejoraMin } from '../../src/dominios/licitaciones/oferta/plazo.js';
import type { Pasaje } from '../../src/dominios/licitaciones/pasajes.js';

const DIR = path.join(import.meta.dirname, 'fixtures', 'costes');
const leer = <T>(n: string): T => JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')) as T;
// Como los leen las comprobaciones (textoParaCostes): cada apartado abre con «## n. Título».
const casoC = {
  textos: leer<{ apartados: { n: number; titulo: string; texto: string }[] }>('casoC-memoria.json').apartados.map(
    (a) => `## ${a.n}. ${a.titulo}

${a.texto}`,
  ),
  guion: leer<{ guion_id: number; datos: GuionData }>('casoC-guion.json'),
  pliego: leer<Pasaje[]>('casoC-pliego.json'),
};
const PRESUPUESTO_CASO_C = 18557;
const IMPORTE = /\d[\d.,]*\s*(?:€|euros?)|€/i;

type Opciones = {
  textos: string[];
  guion?: GuionData;
  pliego?: Pasaje[] | null;
  perfil?: PerfilCostesData;
  presupuesto?: number | null;
  presentada?: boolean;
  guardados?: Map<string, EstadoGuardado>;
  fecha_limite?: string | null;
  ficha?: CompromisoDeFicha[];
  memoria?: { id: number; version: number };
  pliegoLegibleSinPasajes?: boolean;
};

const memoria = (presentada: boolean, v = { id: 41, version: 4 }): EstadoMemoria =>
  ({
    id: v.id,
    version: v.version,
    guion_id: 16,
    estado: 'ensamblada',
    lote: null,
    presentada,
    presentada_sustituida: false,
    ensayo: false,
    sin_repartir: false,
    paginas: 12,
    paginas_estimadas: 12,
    limite_paginas: 20,
    avisos: [],
    apartados: [],
    fugas: { hallazgos: [], anulada: null },
    anonimato: null,
    borrador: null,
    guion_cambiado: false,
    error: null,
    valorable: true,
    progreso: null,
  }) as unknown as EstadoMemoria;
const pasaje = (texto: string): Pasaje => ({
  ruta: 'Licitaciones/Radar/2026/sintetico/PPT.pdf',
  clase: 'ppt',
  pagina: 3,
  texto,
});

function entradas(o: Opciones): EntradasComprobaciones {
  const g = o.guion ?? casoC.guion.datos;
  const guion = {
    id: 16,
    licitacion_id: 'p-1',
    version: 1,
    ficha_id: null,
    datos: g,
    avisos: [],
    agente: 'oferta',
    version_prompt: 1,
    trabajo_id: null,
    cambios: null,
    creado_en: '2026-10-01T00:00:00Z',
  };
  const lotes = [
    {
      id: '3',
      nombre: 'Lote 3',
      presupuesto_sin_iva: o.presupuesto === undefined ? PRESUPUESTO_CASO_C : o.presupuesto,
      cpvs: [],
    },
  ];
  const m = memoria(o.presentada ?? false, o.memoria);
  return {
    id: 'p-1',
    ahoraMs: Date.parse('2026-10-14T10:00:00Z'),
    licitacion: {
      fecha_limite: o.fecha_limite === undefined ? '2026-10-20T14:00:00' : o.fecha_limite,
      fecha_solicitud: null,
      borrada_en: null,
      borrada_motivo: null,
      presupuesto_sin_iva: null,
    },
    oportunidad: { estado: 'en_preparacion', motivo_descarte: null, lotes_interes: '["3"]' },
    lotes: { lotes, presentacion: null, ambito: null },
    ambito: ['3'],
    ficha: null,
    guion,
    decisiones: null,
    decisiones_version: null,
    propuesta: null,
    memoria: m,
    hallazgos: [],
    fugas: null,
    textos_memoria: [],
    documentos: { filas: [], del_guion: [] },
    perfil: null,
    personas: [],
    pliegos: [],
    trabajos: [],
    paquete: null,
    coherencia: [],
    guardados: o.guardados ?? new Map(),
    duraciones: duracionesFases(),
    decisiones_incompletas: [],
    textos_costes: [{ memoria_id: m.id, textos: o.textos, ficha: o.ficha ?? [] }],
    perfil_costes: o.perfil ?? perfilCostesPorDefecto(),
    pliego_costes: o.pliegoLegibleSinPasajes
      ? { pasajes: [], cotejable: true }
      : o.pliego === null
        ? { pasajes: [], cotejable: false }
        : { pasajes: o.pliego ?? casoC.pliego, cotejable: true },
  } as unknown as EntradasComprobaciones;
}

type Curso = { nombre: string; personas: number };
// El guion de Villaejemplo con otro alcance y sin «se valorará»: el título no depende del criterio.
function guionDe(cursos: Curso[]): GuionData {
  const g = casoC.guion.datos;
  const alcance = cursos.map((c) => ({
    nombre: c.nombre,
    personas_minimas: c.personas,
    horas: 40,
    grupos: 1,
    semanas: 5,
    lotes: ['3'],
    documento: 'PPT.pdf',
    pagina: 13,
  }));
  const memoria = g.memoria
    ? { ...g.memoria, apartados: g.memoria.apartados.map((a) => ({ ...a, se_valorara: [] })) }
    : null;
  return { ...g, alcance, memoria } as GuionData;
}
const CIEN = guionDe([{ nombre: 'Topografía y cartografía digital', personas: 100 }]);
const ENTREVISTA = '## 2. Orientación\n\nLa coordinación hace una entrevista individual de 30 minutos con cada alumna.';
const filas = (e: EntradasComprobaciones): BloqueoConCoste[] => reglaCompromisosCaros(e);
const deCompromiso = (bs: BloqueoConCoste[]) => bs.filter((b) => b.clave.startsWith('compromiso_caro:'));

test('should_raise_risk_with_suavizar_action_for_costly_added_commitment', () => {
  // Arrange
  const e = entradas({ textos: casoC.textos });
  // Act
  const bs = deCompromiso(filas(e));
  // Assert
  const kits = bs.find((b) => b.clave === 'compromiso_caro:-:material_fisico_material');
  assert.ok(kits, bs.map((b) => b.clave).join(', '));
  assert.equal(kits.gravedad, 'riesgo');
  assert.equal(kits.categoria, 'coherencia');
  assert.equal(kits.actor, 'tu');
  assert.equal(kits.accion.tipo, 'suavizar');
  assert.match(kits.accion.destino ?? '', /^memoria\.apartado\.\d+$/);
  assert.equal(kits.minutos, MINUTOS_POR_ACCION.suavizar);
  assert.ok(kits.coste && kits.coste.euros! >= 4000 && kits.coste.euros! <= 6000, `kits: ${kits.coste?.euros}`);
  assert.equal(kits.coste.memoria_version, 4);
  assert.match(
    kits.coste.instruccion,
    /sustituye «.+» por: .+no añadas compromisos con coste que el pliego no pide\.$/,
  );
  assert.equal(kits.cita?.comprobada, true, 'la cita es literal de la memoria');
  assert.match(kits.cita?.documento ?? '', /^Memoria v4, apartado \d+(?:\.\d+)*$/, 'como la numera la memoria («1.2»)');
  assert.match(kits.accion.destino ?? '', /^memoria\.apartado\.[23]$/, 'pero se rehace el apartado del guion');
  const entrevistas = bs.find((b) => b.clave.startsWith('compromiso_caro:-:sesion_individual_entrevista'));
  assert.match(
    entrevistas?.titulo ?? '',
    /^La memoria promete entrevista individual de \d+ min con cada alumna apta \(~\d+ h\)/,
  );
});

test('should_not_raise_row_for_exigido_or_below_threshold', () => {
  // Arrange
  const exigido = entradas({
    textos: [ENTREVISTA],
    guion: CIEN,
    pliego: [pasaje('La adjudicataria realizará una entrevista individual de 30 minutos con cada alumna.')],
  });
  const barato = entradas({
    textos: [ENTREVISTA],
    guion: guionDe([{ nombre: 'Topografía y cartografía digital', personas: 10 }]),
    pliego: [pasaje('Objeto del contrato.')],
  });
  const caro = entradas({ textos: [ENTREVISTA], guion: CIEN, pliego: [pasaje('Objeto del contrato.')] });
  // Act
  const [deExigido, deBarato, deCaro] = [exigido, barato, caro].map(filas);
  // Assert
  assert.deepEqual(deExigido, []);
  assert.deepEqual(deBarato, [], '10 alumnas × 40 min = 7 h y 170 €: por debajo de 15 h y de 385 €');
  assert.deepEqual(
    deCaro!.map((b) => [b.clave, b.coste?.horas]),
    [['compromiso_caro:-:sesion_individual_entrevista', 67]],
    '100 alumnas × (30 + 10) min',
  );
  assert.match(deCaro![0]!.titulo, /y el pliego no lo pide$/);
});

test('should_raise_no_comprobado_when_pliego_not_cotejable', () => {
  // Arrange
  const e = entradas({ textos: [ENTREVISTA], guion: CIEN, pliego: null });
  // Act
  const [b] = filas(e);
  // Assert
  assert.equal(b?.gravedad, 'no_comprobado');
  assert.equal(b?.accion.tipo, 'suavizar');
  assert.match(b?.titulo ?? '', /no se pudo cotejar con el pliego$/);
  assert.match(b?.coste?.supuesto ?? '', /Sin cotejar con el pliego/);
});

test('should_not_raise_rows_for_presented_memoria', () => {
  // Arrange
  const e = entradas({ textos: casoC.textos, presentada: true });
  // Act
  const bs = filas(e);
  // Assert
  assert.deepEqual(bs, []);
});

test('should_keep_key_and_change_huella_when_cost_changes', () => {
  // Arrange
  const antes = entradas({ textos: [ENTREVISTA], guion: CIEN, pliego: [pasaje('Objeto del contrato.')] });
  const despues = entradas({
    textos: [ENTREVISTA],
    guion: guionDe([{ nombre: 'Topografía y cartografía digital', personas: 140 }]),
    pliego: [pasaje('Objeto del contrato.')],
  });
  const [a] = filas(antes);
  const aceptado: EstadoGuardado = {
    clave: a!.clave,
    huella: a!.huella,
    estado: 'riesgo_aceptado',
    propuesta: null,
    quien: 'Persona K',
    motivo: 'Compensa',
    en: '2026-10-14T09:00:00Z',
    citas: [],
  };
  const guardados = new Map([[a!.clave, aceptado]]);
  // Act
  const [d] = filas(despues);
  const igual = componerComprobaciones({ ...antes, guardados }, 2).bloqueos.find((b) => b.clave === a!.clave);
  const cambiado = componerComprobaciones({ ...despues, guardados }, 2).bloqueos.find((b) => b.clave === a!.clave);
  // Assert
  assert.equal(d!.clave, a!.clave, 'la clave no lleva cifras');
  assert.notEqual(d!.huella, a!.huella);
  assert.equal(igual?.estado, 'riesgo_aceptado', 'aceptado no reaparece mientras su huella no cambie');
  assert.equal(cambiado?.estado, 'abierto', 'con otro coste vuelve a abrirse');
});

test('should_never_put_euros_in_title', () => {
  // Arrange
  const e = entradas({ textos: casoC.textos });
  // Act
  const bs = filas(e);
  // Assert
  assert.ok(bs.length >= 3, `${bs.length} filas`);
  assert.deepEqual(
    bs.filter((b) => IMPORTE.test(b.titulo)).map((b) => b.titulo),
    [],
  );
  assert.ok(
    bs.some((b) => (b.coste?.euros ?? 0) > 0),
    'los euros siguen en coste, para la web',
  );
});

test('should_raise_total_row_when_added_cost_exceeds_budget_share', () => {
  // Arrange
  const conPresupuesto = entradas({ textos: casoC.textos });
  const presupuestoAlto = entradas({ textos: casoC.textos, presupuesto: 10_000_000 });
  // Act
  const total = filas(conPresupuesto).find((b) => b.clave === 'compromisos_caros:-:total');
  const sinTotal = filas(presupuestoAlto).find((b) => b.clave === 'compromisos_caros:-:total');
  // Assert
  assert.ok(total, 'Villaejemplo: unas 1.500 h, cerca del 270 % de 18.557 €');
  assert.equal(total.gravedad, 'riesgo', 'riesgo, no impide (decisión por defecto)');
  assert.equal(total.accion.tipo, 'suavizar');
  assert.match(
    total.titulo,
    /^Los \d+ compromisos añadidos de la memoria suman ~[\d.]+ h: coste alto frente al presupuesto base$/,
  );
  assert.ok(total.coste!.euros! >= 0.5 * PRESUPUESTO_CASO_C);
  const pct = total.coste!.resumen.presupuesto_pct!;
  assert.equal(
    pct,
    Math.round((total.coste!.euros! / PRESUPUESTO_CASO_C) * 100),
    'el % real va solo en coste.resumen (web)',
  );
  assert.ok(
    !`${total.titulo} ${total.coste!.supuesto}`.includes(`${pct} %`),
    'ni el título ni el supuesto llevan el % real',
  );
  assert.deepEqual(
    [total.coste!.n, total.coste!.pct_presupuesto],
    [total.coste!.resumen.anadidos, pct],
    'n y pct_presupuesto, numéricos, en la fila del total',
  );
  assert.ok(total.titulo.startsWith(`Los ${total.coste!.n} compromisos`), 'el mismo n que el título');
  assert.equal(sinTotal, undefined);
});

test('should_put_closing_clause_once_in_total_row_instruction', () => {
  // Arrange
  const e = entradas({ textos: casoC.textos });
  // Act
  const total = filas(e).find((b) => b.clave === 'compromisos_caros:-:total');
  // Assert
  const veces = total!.coste!.instruccion.match(/no añadas compromisos con coste que el pliego no pide/g) ?? [];
  assert.equal(veces.length, 1, total!.coste!.instruccion);
  assert.match(total!.coste!.instruccion, /; no añadas compromisos con coste que el pliego no pide\.$/);
  assert.doesNotMatch(total!.coste!.instruccion, /\. En el apartado/);
});

test('should_not_open_row_when_ficha_marks_exigido_or_compensa', () => {
  // Arrange: la entrevista está en la ficha de solución, justificada de dos formas.
  const compensa: CompromisoDeFicha = {
    texto: 'Entrevista individual de 30 min con cada alumna',
    clase: 'anadido',
    compensa: 'da 6 puntos en seguimiento',
    quitado: false,
  };
  const exigido: CompromisoDeFicha = { ...compensa, clase: 'exigido', compensa: '' };
  const sinMotivo: CompromisoDeFicha = { ...compensa, compensa: '' };
  const base = { textos: [ENTREVISTA], guion: CIEN, pliego: [pasaje('Objeto del contrato.')] };
  // Act
  const [conCompensa, conExigido, conSinMotivo] = [compensa, exigido, sinMotivo].map((f) =>
    deCompromiso(filas(entradas({ ...base, ficha: [f] }))),
  );
  // Assert
  assert.deepEqual(conCompensa, [], 'la ficha ya dice por qué compensa');
  assert.deepEqual(conExigido, [], 'la ficha lo da por exigido');
  assert.equal(conSinMotivo?.length, 1, 'sin «compensa» sigue siendo una fila por suavizar');
});

test('should_say_in_title_when_ficha_removed_the_commitment', () => {
  // Arrange
  const quitado: CompromisoDeFicha = {
    texto: 'Entrevista individual de 30 min con cada alumna',
    clase: 'anadido',
    compensa: 'da puntos',
    quitado: true,
  };
  // Act
  const [b] = deCompromiso(
    filas(entradas({ textos: [ENTREVISTA], guion: CIEN, pliego: [pasaje('Objeto del contrato.')], ficha: [quitado] })),
  );
  // Assert
  assert.match(b?.titulo ?? '', /^La memoria promete entrevista individual .*, que se quitó en la ficha de solución$/);
  assert.equal(b?.estado, 'abierto');
});

test('should_keep_accepted_risk_in_next_memoria_version', () => {
  // Arrange: el riesgo se acepta en la v4 y la v5 promete lo mismo con el mismo coste.
  const base = { textos: [ENTREVISTA], guion: CIEN, pliego: [pasaje('Objeto del contrato.')] };
  const v4 = entradas(base);
  const [a] = filas(v4);
  const aceptado: EstadoGuardado = {
    clave: a!.clave,
    huella: a!.huella,
    estado: 'riesgo_aceptado',
    propuesta: null,
    quien: 'Persona K',
    motivo: 'Compensa',
    en: '2026-10-14T09:00:00Z',
    citas: [],
  };
  const v5 = entradas({ ...base, memoria: { id: 42, version: 5 }, guardados: new Map([[a!.clave, aceptado]]) });
  // Act
  const fila = componerComprobaciones(v5, 2).bloqueos.find((b) => b.clave === a!.clave);
  // Assert
  assert.equal(fila?.estado, 'riesgo_aceptado');
  assert.equal((fila as BloqueoConCoste | undefined)?.coste?.memoria_version, 5);
});

test('should_say_pliego_does_not_ask_when_readable_pliego_has_no_obligations', () => {
  // Arrange: PPT legible e indexado, pero ningún trozo pasa el filtro de obligaciones.
  const e = entradas({ textos: [ENTREVISTA], guion: CIEN, pliegoLegibleSinPasajes: true });
  // Act
  const [b] = filas(e);
  // Assert
  assert.equal(b?.gravedad, 'riesgo');
  assert.match(b?.titulo ?? '', /y el pliego no lo pide$/);
  assert.match(b?.coste?.supuesto ?? '', /El pliego no lo pide\.$/);
  assert.doesNotMatch(b?.coste?.supuesto ?? '', /Sin cotejar/);
});

test('should_compute_limite_suavizar_before_internal_close', () => {
  // Arrange
  const e = entradas({ textos: [ENTREVISTA], guion: CIEN, pliego: [pasaje('Objeto del contrato.')] });
  const sinFilas = entradas({ textos: ['Sin compromisos con cifras.'], guion: CIEN });
  // Act
  const c = componerComprobaciones(e, 2);
  const medida = limiteSuavizar(c.hora_interna_cierre, c.bloqueos, 25);
  // Assert
  const cierre = Date.parse(c.hora_interna_cierre);
  assert.equal(
    c.limite_suavizar,
    new Date(cierre - (duracionMejoraMin(1) + 30) * 60_000).toISOString(),
    'una mejora de 1 apartado y 30 min de revisión',
  );
  assert.equal(
    medida,
    new Date(cierre - (10 + 25 + 30) * 60_000).toISOString(),
    'la mediana de un apartado más el ensamblado',
  );
  assert.equal(componerComprobaciones(sinFilas, 2).limite_suavizar, null);
  assert.equal(limiteSuavizar(null, c.bloqueos), null);
});

test('should_use_the_measured_redaccion_median_for_a_round_whatever_the_number_of_apartados', () => {
  // Arrange: 4 apartados con compromisos caros y 12 min medidos en un run de redacción.
  const textos = [2, 3, 4, 5].map(
    (n) =>
      `## ${n}. Apartado ${n}\n\nLa coordinación hace una entrevista individual de ${20 + n} minutos con cada alumna.`,
  );
  const e = entradas({ textos, guion: CIEN, pliego: [pasaje('Objeto del contrato.')] });
  const c = componerComprobaciones(e, 2);
  const apartados = new Set(
    c.bloqueos.flatMap((b) => (b as BloqueoConCoste).coste?.apariciones.map((a) => a.apartado) ?? []),
  );
  // Act
  const medida = limiteSuavizar(c.hora_interna_cierre, c.bloqueos, 12);
  // Assert
  assert.ok(apartados.size >= 4, [...apartados].join(','));
  assert.equal(duracionRondaMin(4, 12), 10 + 12);
  assert.equal(
    duracionRondaMin(12, 12),
    10 + 12,
    'una ronda es un solo run de redacción: no depende de cuántos apartados rehace',
  );
  assert.equal(duracionRondaMin(6, 200), 90, 'con el tope de una mejora');
  assert.equal(duracionRondaMin(6, null), duracionMejoraMin(6), 'sin medida, lo presupuestado');
  assert.equal(
    medida,
    new Date(Date.parse(c.hora_interna_cierre) - (duracionRondaMin(apartados.size, 12) + 30) * 60_000).toISOString(),
  );
});

test('should_give_agents_level_and_hours_but_no_budget_share', async () => {
  // Arrange: Villaejemplo tiene la fila del total (unas 1.500 h frente a 18.557 €).
  const { bloqueosParaAgente } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
  const total = filas(entradas({ textos: casoC.textos })).find((b) => b.clave === 'compromisos_caros:-:total')!;
  const pct = total.coste!.resumen.presupuesto_pct!;
  // Act
  const [paraAgente] = bloqueosParaAgente([total], null);
  // Assert
  assert.ok(pct > 100, `Villaejemplo: ${pct} %`);
  assert.equal(paraAgente!.coste!.nivel, 'alto');
  assert.deepEqual(Object.keys(paraAgente!.coste!.resumen).sort(), ['anadidos', 'caros', 'horas']);
  assert.equal(paraAgente!.coste!.n, total.coste!.n, 'cuántos sí');
  assert.equal('pct_presupuesto' in paraAgente!.coste!, false, 'el % del presupuesto no');
  assert.ok(!JSON.stringify(paraAgente).includes(`${pct} %`), JSON.stringify(paraAgente));
  assert.doesNotMatch(JSON.stringify(paraAgente), /€|\beuros?\b/i);
});
