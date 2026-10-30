// Memoria técnica, paso 6: rondas de reescritura dentro de la misma versión. Llega al umbral y se
// ensambla; si no, se rehacen solo los apartados flojos (por debajo del tramo máximo, con cosas
// que faltan o con hallazgos de coherencia) con lo que señala el crítico y nunca su nota; un
// apartado rehecho que baja un tramo vuelve a su mejor versión; las rondas paran al agotarse,
// sin plazo o sin mejora; al final, la última crítica queda como evaluación (la de «Mejorar»).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  arrancar,
  cerrar,
  db,
  ID,
  memoriaPorId,
  nucleo,
  salidas,
  sinMemorias,
  trabajosDe,
  trasLaEstrategia,
} from '../helpers/memoriaEntorno.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { APARTADOS, apartadoCasoA, GUION_CASO_A } from './fixtures/casoA.js';
import { apartadosPares, type Par } from './fixtures/criticaPares.js';
import type { Efectivo } from '../../src/dominios/licitaciones/oferta/rondasMemoria.js';

const { ApartadoEntrada, pedirMemoria, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria, estadoAvance, siguientePaso } =
  await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { marcarApartadosFallidos } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { obligaARehacer } = await import('../../src/dominios/licitaciones/oferta/hechos.js');
const { contextoDeApartado } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { guionPorId } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { caracteresDe, paginasDeGuia, revisarApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');
const { filaMemoria, paginasDeCuerpo, SIN_REDACTAR } =
  await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { EstrategiaEntrada, recibirEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { CriticaEntrada, recibirCritica, TIPO_MEMORIA_CRITICA } =
  await import('../../src/dominios/licitaciones/oferta/critica.js');
const { CriticaParesEntrada, documentoNuevo, recibirCriticaPares } =
  await import('../../src/dominios/licitaciones/oferta/criticaPares.js');
const {
  apartadosARehacer,
  decidirRonda,
  extensionDe,
  finalizarMemoria,
  guardaRegresiones,
  hallazgosRepetidos,
  motivosMarcados,
  recuperarApartadosConTexto,
} = await import('../../src/dominios/licitaciones/oferta/rondasMemoria.js');
const { marcarMotivos } = await import('../../src/dominios/licitaciones/oferta/motivosRonda.js');
const { progresoDe } = await import('../../src/dominios/licitaciones/oferta/progresoMemoria.js');
const { instruccionesRedaccion, PayloadRedaccion, TIPO_MEMORIA_REDACCION } =
  await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { apartadosMejorables, evaluacionDeMemoria, resumenEvaluacionMemoria } =
  await import('../../src/dominios/licitaciones/propuestas/evaluacion.js');
type Hallazgo = import('../../src/dominios/licitaciones/oferta/hechos.js').Hallazgo;
type EntradaDecision = import('../../src/dominios/licitaciones/oferta/rondasMemoria.js').EntradaDecision;
type FilaRonda = import('../../src/dominios/licitaciones/oferta/rondasMemoria.js').FilaRonda;

before(arrancar);
after(cerrar);

const MEM = GuionBase.parse(GUION_CASO_A).memoria!;
// Por debajo del máximo, con un motivo para bajar (la crítica sin él se rechaza).
const MOTIVO_EF = { cita: 'x', motivo: 'Sin cifra.', arreglo: 'Fijar el 95 %.' };
const maximoDe = (apartado: number) => Math.max(...MEM.apartados[apartado - 1]!.escala.map((t) => t.puntos));
const ef = (apartado: number, tramo: number, extra: Partial<Efectivo> = {}): Efectivo => ({
  apartado,
  ronda: 0,
  puntos: tramo,
  tramo,
  cita: 'x',
  motivos_para_bajar: tramo < maximoDe(apartado) ? [MOTIVO_EF] : [],
  falta: [],
  ...extra,
});
const MAXIMOS = [ef(1, 8), ef(2, 7), ef(3, 6), ef(4, 4)];
const entrada = (cambios: Partial<EntradaDecision> = {}): EntradaDecision => ({
  mem: MEM,
  efectivos: MAXIMOS,
  bloqueados: [],
  hallazgos: [],
  totales: [25],
  ronda: 0,
  umbral: 0.9,
  maxRondas: 3,
  plazo: true,
  ...cambios,
});

test('should_assemble_when_total_reaches_threshold', () => {
  assert.deepEqual(decidirRonda(entrada()), {
    tipo: 'ensamblar',
    motivo: 'La crítica de la ronda 0 llega al umbral (90 % de los puntos).',
    aviso: false,
  });
  const casi = [ef(1, 8), ef(2, 7), ef(3, 5), ef(4, 4)];
  assert.equal(
    decidirRonda(entrada({ efectivos: casi })).tipo,
    'ensamblar',
    '24 de 25 y el 3 a un tramo del máximo: llega',
  );
  const lejos = [ef(1, 8), ef(2, 7), ef(3, 6), ef(4, 0)];
  assert.deepEqual(
    decidirRonda(entrada({ efectivos: lejos })),
    { tipo: 'ronda', apartados: [4] },
    '21 de 25 y el 4 a dos tramos: no llega',
  );
});

test('should_redo_only_apartados_below_max_tier_or_with_findings', () => {
  const efectivos = [ef(1, 8), ef(2, 3), ef(3, 6, { falta: ['Formación al personal sin calendario'] }), ef(4, 4)];
  const hallazgos = [
    {
      apartado: 4,
      hecho: 'horario',
      cita: 'c',
      encontrado: '9:00-18:00',
      esperado: '9:00-17:00',
      tipo: 'contradiccion' as const,
    },
  ];
  assert.deepEqual(decidirRonda(entrada({ efectivos, hallazgos })), { tipo: 'ronda', apartados: [2, 3, 4] });
  assert.deepEqual(
    decidirRonda(entrada({ efectivos, hallazgos, bloqueados: [2] })),
    { tipo: 'ronda', apartados: [3, 4] },
    'un apartado restaurado no se vuelve a pedir',
  );
});

test('should_not_send_apartado_below_max_without_reasons_to_the_rewriter', () => {
  const efectivos = [ef(1, 8), ef(2, 3, { motivos_para_bajar: [] }), ef(3, 5), ef(4, 4)];
  assert.deepEqual(
    apartadosARehacer({ mem: MEM, efectivos, bloqueados: [], hallazgos: [] }),
    [3],
    'el 2 no tiene qué arreglar: es un hueco de la crítica',
  );
});

test('should_stop_after_max_rounds', () => {
  const flojos = [ef(1, 4), ef(2, 3), ef(3, 3), ef(4, 2)];
  assert.equal(decidirRonda(entrada({ efectivos: flojos, ronda: 2, totales: [10, 11, 12] })).tipo, 'ronda');
  assert.deepEqual(decidirRonda(entrada({ efectivos: flojos, ronda: 3, totales: [10, 11, 12, 12.5] })), {
    tipo: 'ensamblar',
    motivo: 'Se hicieron 3 rondas de reescritura sin llegar al umbral: se ensambla con lo mejor de cada apartado.',
    aviso: true,
  });
  assert.equal(
    decidirRonda(entrada({ efectivos: flojos, maxRondas: 0 })).tipo,
    'ensamblar',
    'LICITACIONES_MEMORIA_RONDAS=0: sin rondas',
  );
});

test('should_stop_after_two_rounds_without_improvement', () => {
  const flojos = [ef(1, 4), ef(2, 3), ef(3, 3), ef(4, 2)];
  assert.equal(
    decidirRonda(entrada({ efectivos: flojos, ronda: 1, totales: [18, 17] })).tipo,
    'ronda',
    'una ronda sin mejora aún se intenta otra',
  );
  assert.deepEqual(decidirRonda(entrada({ efectivos: flojos, ronda: 2, totales: [18, 17, 18] })), {
    tipo: 'ensamblar',
    motivo: 'Dos rondas seguidas sin subir la nota: se ensambla con lo mejor de cada apartado.',
    aviso: true,
  });
});

test('should_stop_rounds_when_deadline_guard_fails', () => {
  const flojos = [ef(1, 4), ef(2, 3), ef(3, 3), ef(4, 2)];
  assert.deepEqual(decidirRonda(entrada({ efectivos: flojos, plazo: false })), {
    tipo: 'ensamblar',
    motivo: 'No da tiempo a otra ronda antes del plazo: se ensambla con lo mejor de cada apartado.',
    aviso: true,
  });
});

test('should_restore_best_version_when_apartado_regresses_one_tier', () => {
  const fila = (apartado: number, ronda: number, tramo: number, datos: string): FilaRonda => ({
    apartado,
    ronda,
    datos,
    puntos: tramo,
    tramo,
    motivos: '{}',
  });
  const filas = [
    fila(1, 0, 8, 'A1'),
    fila(2, 0, 5, 'A2'),
    fila(3, 0, 5, 'A3'),
    fila(4, 0, 4, 'A4'),
    fila(1, 1, 6, 'A1'),
    fila(2, 1, 7, 'B2'),
    fila(3, 1, 3, 'B3'),
    fila(4, 1, 4, 'A4'),
  ];
  const r = guardaRegresiones(filas, MEM, 1);
  assert.deepEqual(r.restaurar, [{ apartado: 3, ronda: 0, datos: 'A3' }]);
  assert.deepEqual(r.bloqueados, [3]);
  assert.deepEqual(r.avisos, ['3. Asesoramiento y acompañamiento: la ronda 1 bajó de 5 a 3; se conserva la ronda 0.']);
  assert.deepEqual(
    r.efectivos.map((x) => [x.apartado, x.tramo, x.ronda]),
    [
      [1, 6, 1],
      [2, 7, 1],
      [3, 5, 0],
      [4, 4, 1],
    ],
    'el 1 no se reescribió: su bajada es ruido del crítico y no se restaura',
  );
});

test('should_measure_round_commitments_on_the_version_the_regression_guard_keeps', async () => {
  const { versionesVigentes } = await import('../../src/dominios/licitaciones/oferta/coherenciaMemoria.js');
  const fila = (apartado: number, ronda: number, tramo: number, datos: string): FilaRonda => ({
    apartado,
    ronda,
    datos,
    puntos: tramo,
    tramo,
    motivos: '{}',
  });
  // Ronda 1: el apartado 3 añade la cifra del compromiso pero baja un tramo y vuelve a la ronda 0.
  const filas = [
    fila(1, 0, 8, 'A1'),
    fila(2, 0, 5, 'A2'),
    fila(3, 0, 5, 'A3 sin cifra'),
    fila(4, 0, 4, 'A4'),
    fila(3, 1, 3, 'B3 con 24 horas de formación'),
  ];
  const vigentes = versionesVigentes(filas, 4, 1, guardaRegresiones(filas, MEM, 1).restaurar);
  assert.deepEqual(
    vigentes.map((f) => f?.datos),
    ['A1', 'A2', 'A3 sin cifra', 'A4'],
    'el texto descartado no cuenta como declarado',
  );
  assert.equal(
    versionesVigentes(filas, 4, 1)[2]?.datos,
    'B3 con 24 horas de formación',
    'sin restauraciones, lo último',
  );
});

// ── De punta a punta con el caso A ──

type Numeros = { memoria_id: number; guion_id: number; version: number };

async function enCritica(): Promise<Numeros> {
  sinMemorias();
  const p = pedirMemoria(nucleo().db, db, salidas, ID).data!;
  await avanzarMemoria(nucleo().db, db, p.memoria);
  assert.equal(
    recibirEstrategia(
      db,
      nucleo().db,
      EstrategiaEntrada.parse(estrategiaCasoA({ memoria_id: p.memoria, version: p.version })),
      'oferta-licitaciones',
    ).error,
    null,
  );
  await trasLaEstrategia(p.memoria);
  const m = memoriaPorId(p.memoria);
  const n = { memoria_id: m.id, guion_id: m.guion_id, version: m.version };
  for (const k of [1, 2, 3, 4])
    assert.equal(recibirApartado(db, ApartadoEntrada.parse(apartadoCasoA(k, n)), 'oferta-licitaciones').error, null);
  await trasLaEstrategia(p.memoria);
  return n;
}

const CITA = 'La empresa propone para este punto un procedimiento con responsable designado, respuesta en 48 horas';
const MOTIVO = {
  cita: 'un indicador con meta mensual que revisará con la entidad',
  motivo: 'El indicador no tiene cifra.',
  arreglo: 'Fijar la meta del 95 % de consultas en plazo.',
};
// tramos[i]: el del apartado i+1; los que no están en el máximo llevan un motivo para bajar.
function criticar(n: Numeros, ronda: number, tramos: number[], falta: string[][] = []) {
  const c = CriticaEntrada.parse({
    id: ID,
    memoria_id: n.memoria_id,
    ronda,
    resumen: 'Le faltan cifras propias de la entidad en la calidad y el acompañamiento.',
    apartados: APARTADOS.map((a, i) => ({
      apartado: i + 1,
      tramo: tramos[i]!,
      puntos: tramos[i]!,
      cita: CITA,
      motivos_para_bajar: tramos[i]! < a.escala.at(-1)! ? [MOTIVO] : [],
      falta: falta[i] ?? [],
    })),
  });
  const r = recibirCritica(db, c, 'critico-licitaciones', { revisar: true });
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
}

// Desde la ronda 1, por pares: `pares`, los apartados reescritos; los demás, empate con `tramos`.
function criticarPares(n: Numeros, ronda: number, tramos: number[], pares: Record<number, Par>) {
  const evaluar = (k: number, tramo: number) => ({
    tramo,
    cita: CITA,
    motivos_para_bajar: tramo < APARTADOS[k - 1]!.escala.at(-1)! ? [MOTIVO] : [],
    falta: [],
  });
  const c = CriticaParesEntrada.parse({
    id: ID,
    memoria_id: n.memoria_id,
    ronda,
    resumen: 'Le faltan cifras propias de la entidad en la calidad.',
    apartados: apartadosPares(documentoNuevo(ronda), tramos, pares, evaluar),
  });
  const r = recibirCriticaPares(db, c, 'critico-licitaciones', { revisar: true });
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
}

test('should_not_send_score_to_writer_only_reasons', async () => {
  const n = await enCritica();
  criticar(n, 0, [8, 5, 5, 4], [[], [], ['Calendario de la formación al personal'], []]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual([m.fase, m.ronda], ['redaccion', 1], '22 de 25 no llega al 90 %: ronda 1');
  const filas = db
    .prepare('SELECT apartado, estado, ronda FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado')
    .all(n.memoria_id);
  assert.deepEqual(filas, [
    { apartado: 1, estado: 'recibido', ronda: 0 },
    { apartado: 2, estado: 'pendiente', ronda: 1 },
    { apartado: 3, estado: 'pendiente', ronda: 1 },
    { apartado: 4, estado: 'recibido', ronda: 0 },
  ]);
  const t = trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!;
  assert.equal(t.clave, `memoria-${ID}-v${n.version}-r1`);
  const inst = instruccionesRedaccion(db, nucleo().db, PayloadRedaccion.parse(JSON.parse(t.payload)));
  assert.match(inst, /redacta la memoria técnica entera \(versión \d+, ronda 1 de reescritura, 4 apartados\)/);
  assert.match(inst, /YA ESTÁN RECIBIDOS los apartados 1, 4: no los reenvíes\./);
  assert.match(
    inst,
    /=== Apartado 2 ===[\s\S]*TEXTO ACTUAL \(reescríbelo entero: conserva lo que funciona y arregla lo que se señala\):\n2\. Gestión de incidencias y control de calidad/,
  );
  assert.match(
    inst,
    /LO QUE SEÑALA EL CRÍTICO:\n- «un indicador con meta mensual que revisará con la entidad»: El indicador no tiene cifra\. Arreglo: Fijar la meta del 95 % de consultas en plazo\./,
  );
  assert.match(
    inst,
    /- Falta: Calendario de la formación al personal\nSi lo que señala el crítico pide más frecuencia, horas, sesiones, material o presencia que no está en la lista de compromisos, la solución ni la hoja de hechos, no lo añadas como compromiso fijo.*Excepción: si lo que falta es lo que el criterio valora expresamente/,
    'lo que pide el crítico no se convierte en un compromiso caro, salvo lo que el criterio valora',
  );
  assert.match(
    inst,
    /\n3c\. COMPROMISOS: compromete solo lo que está en la lista de compromisos, en la solución y en la hoja de hechos/,
  );
  assert.doesNotMatch(inst, /Le faltan cifras propias de la entidad/, 'ni el resumen del crítico');
  assert.doesNotMatch(inst, /21 de 25|\b5 de 7\b|tramo 5|nota del crítico/i, 'ni su nota');
});

test('should_store_final_critique_as_evaluation_compatible_with_mejorar', async () => {
  const n = await enCritica();
  criticar(n, 0, [8, 5, 5, 4]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.deepEqual([memoriaPorId(n.memoria_id).fase, memoriaPorId(n.memoria_id).ronda], ['redaccion', 1]);
  const conCambio = (k: number, extra: string) => {
    const a = apartadoCasoA(k, n);
    a.bloques[0]!.parrafos.push(extra);
    return ApartadoEntrada.parse(a);
  };
  assert.equal(
    recibirApartado(
      db,
      conCambio(
        2,
        'El indicador de consultas resueltas en plazo tendrá una meta del 95 % cada mes, revisada con la entidad.',
      ),
      'oferta-licitaciones',
      { revisar: true },
    ).error,
    null,
  );
  assert.equal(
    recibirApartado(
      db,
      conCambio(3, 'La formación al personal se dará en dos sesiones al año, en marzo y en octubre, con su material.'),
      'oferta-licitaciones',
      { revisar: true },
    ).error,
    null,
  );
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.deepEqual(
    [memoriaPorId(n.memoria_id).fase, trabajosDe(TIPO_MEMORIA_CRITICA).at(-1)!.clave],
    ['critica', `memoria-${ID}-v${n.version}-critica-r1`],
  );
  criticarPares(n, 1, [8, 5, 5, 4], {
    2: { gana: 'nueva', nueva: 7, anterior: 5 },
    3: { gana: 'anterior', nueva: 3, anterior: 5 },
  });
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual(
    [m.fase, m.estado],
    ['fin', 'ensamblada'],
    '8 + 7 + 5 (restaurado) + 4 = 24 de 25: llega y se ensambla',
  );
  const avisos = JSON.parse(
    (db.prepare('SELECT avisos FROM memorias WHERE id = ?').get(n.memoria_id) as { avisos: string }).avisos,
  ) as string[];
  assert.ok(
    avisos.includes(
      '3. Asesoramiento y acompañamiento: en la ronda 1 el crítico prefirió la versión anterior (ronda 0); se conserva esa.',
    ),
    avisos.join(' | '),
  );
  const tres = JSON.parse(
    (
      db.prepare('SELECT datos FROM memoria_apartados WHERE memoria_id = ? AND apartado = 3').get(n.memoria_id) as {
        datos: string;
      }
    ).datos,
  ) as { bloques: { parrafos: string[] }[] };
  assert.ok(
    !tres.bloques[0]!.parrafos.join(' ').includes('marzo y en octubre'),
    'el apartado 3 vuelve a su texto de la ronda 0',
  );
  const dependencias = (k: number) =>
    (
      db
        .prepare('SELECT dependencias FROM memoria_apartados WHERE memoria_id = ? AND apartado = ?')
        .get(n.memoria_id, k) as { dependencias: string }
    ).dependencias;
  assert.equal(
    dependencias(3),
    '{}',
    'las dependencias eran del texto descartado: quien las lea mira el texto restaurado',
  );
  assert.notEqual(dependencias(2), '{}', 'el apartado que no se restaura conserva las suyas');
  const ev = evaluacionDeMemoria(db, ID, n.version)!;
  assert.ok(ev, 'la crítica final queda como evaluación');
  assert.equal(ev.agente, 'critico-licitaciones');
  assert.deepEqual(
    resumenEvaluacionMemoria(ev).por_apartado.map((a) => [a.apartado, a.tramo]),
    [
      [1, 8],
      [2, 7],
      [3, 5],
      [4, 4],
    ],
  );
  assert.equal(resumenEvaluacionMemoria(ev).puntuacion_total, 24);
  const guion = db.prepare('SELECT guion_id FROM memorias WHERE id = ?').get(n.memoria_id) as { guion_id: number };
  const { guionPorId } = await import('../../src/dominios/licitaciones/oferta/guion.js');
  assert.deepEqual(
    apartadosMejorables(ev, guionPorId(db, guion.guion_id)!),
    [3],
    '«Mejorar» propone el que quedó por debajo de su máximo',
  );
  assert.equal(
    (
      nucleo().db.prepare("SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = 'licitaciones.evaluar'").get() as {
        n: number;
      }
    ).n,
    0,
    'la memoria no se autoevalúa',
  );
  const md = (
    db
      .prepare('SELECT b.ruta_md FROM memorias m JOIN borradores b ON b.id = m.borrador_id WHERE m.id = ?')
      .get(n.memoria_id) as { ruta_md: string }
  ).ruta_md;
  const texto = fs.readFileSync(path.join(salidas, md.slice('Salidas/'.length)), 'utf8');
  assert.match(
    texto,
    /## Cómo se responde a cada criterio\n\n\| Lo que se valora \| Dónde se trata \| Con qué evidencia \|\n\| --- \| --- \| --- \|\n\| Modelo organizativo propuesto \| 1\.1 Modelo organizativo propuesto \| Procedimiento y responsable de modelo organizativo propuesto, revisado cada 30 días\. \|/,
    'la tabla guía sale del mapa de la estrategia, con el número real del bloque',
  );
  assert.match(texto, /\n### 1\.1 Modelo organizativo propuesto\n/, 'el mismo número que en el cuerpo');
});

test('should_redo_only_for_findings_against_the_fact_sheet_not_between_apartados', () => {
  const h = (tipo: Hallazgo['tipo']): Hallazgo => ({
    apartado: 1,
    hecho: 'respuesta',
    cita: 'c',
    encontrado: '24 h',
    esperado: '4 h',
    tipo,
  });
  assert.deepEqual(
    (['contradiccion', 'nombre', 'herramienta', 'entre_apartados'] as const).map((t) => obligaARehacer(h(t))),
    [true, true, false, false],
  );
  const rehacer = (tipo: Hallazgo['tipo']) =>
    apartadosARehacer({ mem: MEM, efectivos: MAXIMOS, bloqueados: [], hallazgos: [h(tipo)] });
  assert.deepEqual(rehacer('entre_apartados'), [], 'en el tramo máximo, un «entre apartados» solo avisa a la persona');
  assert.deepEqual(rehacer('contradiccion'), [1]);
  assert.deepEqual(rehacer('nombre'), [1]);
  assert.deepEqual(rehacer('herramienta'), []);
});

test('should_leave_between_apartados_findings_out_of_round_instructions', async () => {
  const n = await enCritica();
  criticar(n, 0, [8, 5, 5, 4]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const entre: Hallazgo = {
    apartado: 2,
    hecho: 'respuesta',
    cita: 'La tutora dará respuesta a cada consulta en 24 horas.',
    encontrado: '24 h',
    esperado: '4 h',
    tipo: 'entre_apartados',
  };
  const contradiccion: Hallazgo = {
    apartado: 2,
    hecho: 'horario_atencion',
    cita: 'de lunes a viernes, de 9:00 a 18:00',
    encontrado: '9:00-18:00',
    esperado: 'L-V 9:00-17:00',
    tipo: 'contradiccion',
  };
  db.prepare('UPDATE memorias SET coherencia = ? WHERE id = ?').run(
    JSON.stringify([entre, contradiccion]),
    n.memoria_id,
  );
  const t = trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!;
  const inst = instruccionesRedaccion(db, nucleo().db, PayloadRedaccion.parse(JSON.parse(t.payload)));
  assert.match(
    inst,
    /LO QUE NO CASA CON LA HOJA DE HECHOS:\n- La hoja de hechos dice «L-V 9:00-17:00»/,
    'la contradicción con la hoja sí',
  );
  assert.doesNotMatch(
    inst,
    /comprueba si es el mismo servicio|otro dice 4 h/,
    'lo de entre apartados no obliga a reescribir',
  );
});

// ── Una ronda de reescritura que no devuelve lo pedido ──

const haceMin = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

// Agota las tres rondas del trabajo de redacción de la ronda en curso y marca sus apartados como fallidos.
function agotarRedaccion(n: Numeros): void {
  const base = `memoria-${ID}-v${n.version}-r${memoriaPorId(n.memoria_id).ronda}`;
  nucleo()
    .db.prepare("UPDATE trabajos_ia SET estado = 'fallido', actualizado_en = ? WHERE clave = ?")
    .run(haceMin(40), base);
  const insertar = nucleo().db.prepare(
    "INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en) VALUES (?, 'licitaciones', ?, '{}', 'fallido', ?, ?)",
  );
  for (const r of [1, 2]) insertar.run(TIPO_MEMORIA_REDACCION, `${base}-r${r}`, haceMin(40), haceMin(40));
  assert.equal(marcarApartadosFallidos(db) > 0, true, 'los apartados del trabajo agotado quedan fallidos');
}
const estadosDe = (n: Numeros) =>
  (
    db.prepare('SELECT estado FROM memoria_apartados WHERE memoria_id = ? ORDER BY apartado').all(n.memoria_id) as {
      estado: string;
    }[]
  ).map((f) => f.estado);
const avisosDe = (n: Numeros) =>
  JSON.parse(
    (db.prepare('SELECT avisos FROM memorias WHERE id = ?').get(n.memoria_id) as { avisos: string }).avisos,
  ) as string[];
const AVISO_2_3 = 'La ronda 1 no devolvió los apartados 2, 3: se conserva su texto anterior.';

test('should_recover_text_of_round_0_when_rewriting_job_is_exhausted', async () => {
  const n = await enCritica();
  criticar(n, 0, [8, 5, 5, 4]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const textos = () =>
    db
      .prepare(
        'SELECT apartado, datos FROM memoria_apartados WHERE memoria_id = ? AND apartado IN (2, 3) ORDER BY apartado',
      )
      .all(n.memoria_id);
  const antes = textos();
  agotarRedaccion(n);
  assert.deepEqual(estadosDe(n), ['recibido', 'fallido', 'fallido', 'recibido']);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual(
    [m.fase, m.ronda, m.estado],
    ['critica', 1, 'redactando'],
    'con lo que hay, sigue a la crítica sin reintentar',
  );
  assert.deepEqual(
    estadosDe(n),
    ['recibido', 'recibido', 'recibido', 'recibido'],
    'los no devueltos vuelven a «recibido»',
  );
  assert.deepEqual(textos(), antes, 'con su texto de la ronda 0');
  assert.ok(avisosDe(n).includes(AVISO_2_3), avisosDe(n).join(' | '));
});

test('should_not_leave_sin_redactar_in_the_word_of_a_recovered_apartado', async () => {
  const n = await enCritica();
  criticar(n, 0, [8, 5, 5, 4]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  agotarRedaccion(n);
  db.exec('DELETE FROM evaluaciones; DELETE FROM borradores;'); // el borrador de otro test ocupa la misma ruta (la primera versión)
  await finalizarMemoria(db, filaMemoria(db, n.memoria_id)!, null);
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual([m.fase, m.estado, m.error], ['fin', 'ensamblada', null]);
  const md = (
    db
      .prepare('SELECT b.ruta_md FROM memorias m JOIN borradores b ON b.id = m.borrador_id WHERE m.id = ?')
      .get(n.memoria_id) as { ruta_md: string }
  ).ruta_md;
  const texto = fs.readFileSync(path.join(salidas, md.slice('Salidas/'.length)), 'utf8');
  assert.ok(!texto.includes(SIN_REDACTAR), 'ni el 2 ni el 3 llevan la marca de sin redactar');
  assert.match(texto, /Gestión de incidencias y control de calidad/);
  assert.ok(avisosDe(n).includes(AVISO_2_3), avisosDe(n).join(' | '));
});

// Lo no acreditado ya no para la redacción: al cerrar, la persona lo ve en los avisos de la memoria.
test('should_leave_what_the_strategy_left_unaccredited_as_a_memoria_warning_on_close', async () => {
  const n = await enCritica();
  const f = db.prepare('SELECT datos FROM memoria_estrategias WHERE memoria_id = ?').get(n.memoria_id) as {
    datos: string;
  };
  const e = JSON.parse(f.datos) as { frontera: { no_decir: string; motivo: string }[] };
  e.frontera.push({
    no_decir: 'Años de experiencia del JP en IA',
    motivo: 'Sin acreditar: el dossier da cifras distintas.',
  });
  db.prepare('UPDATE memoria_estrategias SET datos = ? WHERE memoria_id = ?').run(JSON.stringify(e), n.memoria_id);
  criticar(n, 0, [8, 5, 5, 4]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  agotarRedaccion(n);
  db.exec('DELETE FROM evaluaciones; DELETE FROM borradores;'); // el borrador de otro test ocupa la misma ruta (la primera versión)
  await finalizarMemoria(db, filaMemoria(db, n.memoria_id)!, null);
  const avisos = avisosDe(n);
  assert.ok(
    avisos.includes(
      'Sin acreditar: la memoria no afirma «Años de experiencia del JP en IA» (Sin acreditar: el dossier da cifras distintas.): consigue la acreditación y añádela, o renuncia a esos puntos.',
    ),
    avisos.join(' | '),
  );
  assert.ok(
    !avisos.some((a) => a.includes('Certificaciones ambientales')),
    'lo que va en otro archivo no es falta de acreditación',
  );
});

test('should_close_redaccion_instead_of_failing_when_every_apartado_of_the_round_fails', async () => {
  const n = await enCritica();
  criticar(n, 0, [4, 3, 3, 2]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.equal(memoriaPorId(n.memoria_id).ronda, 1);
  agotarRedaccion(n);
  assert.deepEqual(estadosDe(n), ['fallido', 'fallido', 'fallido', 'fallido']);
  const e = estadoAvance(nucleo().db, db, filaMemoria(db, n.memoria_id)!);
  assert.deepEqual(
    [e.pendientes, e.recibidos],
    [0, 4],
    '«recibidos» cuenta los que tienen texto, aunque estén fallidos',
  );
  assert.deepEqual(siguientePaso(e), { tipo: 'cerrar_redaccion' }, 'no «fallar»: el texto de la ronda 0 sigue ahí');
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual([m.fase, m.estado], ['critica', 'redactando']);
  assert.deepEqual(estadosDe(n), ['recibido', 'recibido', 'recibido', 'recibido']);
});

test('should_not_recover_anything_in_round_0', async () => {
  const n = await enCritica();
  db.prepare("UPDATE memoria_apartados SET estado = 'fallido' WHERE memoria_id = ? AND apartado = 2").run(n.memoria_id);
  assert.deepEqual(
    recuperarApartadosConTexto(db, filaMemoria(db, n.memoria_id)!),
    [],
    'en la ronda 0 no hay texto anterior que rescatar',
  );
  assert.deepEqual(estadosDe(n), ['recibido', 'fallido', 'recibido', 'recibido']);
  assert.deepEqual(avisosDe(n), []);
});

// ── Parada por bloqueantes y control de extensión ──

const hallazgo = (apartado: number, encontrado = '9:00-18:00'): Hallazgo => ({
  apartado,
  hecho: 'horario',
  cita: 'c',
  encontrado,
  esperado: '9:00-17:00',
  tipo: 'contradiccion',
});
const FLOJOS = [ef(1, 4), ef(2, 3), ef(3, 3), ef(4, 2)];

test('should_stop_when_blocking_findings_do_not_drop_in_two_rounds_even_if_score_rises', () => {
  const hallazgos = Array.from({ length: 6 }, (_, i) => hallazgo(2, `${i}:00`));
  const d = decidirRonda(
    entrada({ efectivos: FLOJOS, hallazgos, ronda: 2, totales: [27.5, 29.9, 31.2], bloqueantes: [6, 6, 6] }),
  );
  assert.deepEqual(d, {
    tipo: 'ensamblar',
    motivo:
      'Dos rondas sin subir la nota ni bajar los 6 bloqueantes de coherencia: revisión humana. Quedan 6 hallazgos de coherencia sin resolver: revisión humana.',
    aviso: true,
  });
  assert.equal(
    decidirRonda(
      entrada({ efectivos: FLOJOS, hallazgos, ronda: 2, totales: [27.5, 29.9, 31.2], bloqueantes: [6, 6, 4] }),
    ).tipo,
    'ronda',
    'si bajan, se sigue',
  );
});

test('should_not_reach_threshold_while_fact_sheet_findings_remain', () => {
  const d = decidirRonda(entrada({ hallazgos: [hallazgo(3)] }));
  assert.deepEqual(
    d,
    { tipo: 'ronda', apartados: [3] },
    'nota máxima, pero queda una contradicción: otra ronda solo con ese apartado',
  );
  const sin = decidirRonda(entrada({ hallazgos: [hallazgo(3)], ronda: 3, maxRondas: 3 }));
  assert.equal(sin.tipo, 'ensamblar');
  assert.match(sin.tipo === 'ensamblar' ? sin.motivo : '', /Quedan 1 hallazgos de coherencia sin resolver/);
});

test('should_block_apartado_with_same_finding_two_rounds', () => {
  assert.deepEqual(hallazgosRepetidos([[hallazgo(2)], [hallazgo(2), hallazgo(3)]]), [hallazgo(2)]);
  assert.deepEqual(hallazgosRepetidos([[hallazgo(2)], [hallazgo(2, '8:00-9:00')]]), [], 'otro valor es otro hallazgo');
  assert.deepEqual(hallazgosRepetidos([[hallazgo(2)]]), [], 'con una sola ronda no hay repetición');
});

test('should_redo_apartado_over_its_quota_even_at_max_tier', () => {
  const extension = { limite: 25, paginas: 20, excesos: [2] };
  assert.deepEqual(apartadosARehacer({ mem: MEM, efectivos: MAXIMOS, bloqueados: [], hallazgos: [], extension }), [2]);
  assert.deepEqual(apartadosARehacer({ mem: MEM, efectivos: MAXIMOS, bloqueados: [], hallazgos: [] }), []);
});

test('should_force_round_when_estimated_pages_exceed_limit', () => {
  const d = decidirRonda(entrada({ extension: { limite: 25, paginas: 27.4, excesos: [3, 1] } }));
  assert.deepEqual(d, { tipo: 'ronda', apartados: [1, 3] }, 'llega al umbral, pero no cabe: solo los que se pasan');
  assert.equal(
    decidirRonda(entrada({ extension: { limite: 25, paginas: 24, excesos: [3] } })).tipo,
    'ensamblar',
    'si cabe, un apartado pasado no fuerza ronda',
  );
});

test('should_measure_length_like_the_assembly_with_the_guide_pages_counted', async () => {
  const n = await enCritica();
  const m = filaMemoria(db, n.memoria_id)!;
  const g = guionPorId(db, n.guion_id)!;
  const real = extensionDe(db, m, g);
  // El cuerpo con el estimador del ensamblado, más las páginas enteras de la guía (empieza en página nueva).
  assert.equal(real.paginas, paginasDeCuerpo(db, m, g) + paginasDeGuia(g.datos.memoria!));
  assert.ok(
    real.paginas < 26,
    `sin el margen de 2 páginas de antes, el borrador al 85 % de cuota ronda el límite: dio ${real.paginas}`,
  );
  const largo = 'Texto del apartado. '.repeat(140);
  const fila = db
    .prepare('SELECT datos FROM memoria_apartados WHERE memoria_id = ? AND apartado = 1')
    .get(n.memoria_id) as { datos: string };
  const d = JSON.parse(fila.datos) as { bloques: { parrafos: string[] }[] };
  for (let i = 0; i < 25; i += 1) d.bloques[0]!.parrafos.push(largo);
  db.prepare('UPDATE memoria_apartados SET datos = ? WHERE memoria_id = ? AND apartado = 1').run(
    JSON.stringify(d),
    n.memoria_id,
  );
  assert.ok(extensionDe(db, m, g).paginas > real.limite!, 'uno claramente largo sí se pasa');
});

test('should_assemble_with_length_warning_when_no_rounds_left', () => {
  const d = decidirRonda(entrada({ ronda: 3, extension: { limite: 25, paginas: 27.4, excesos: [3] } }));
  assert.equal(d.tipo, 'ensamblar');
  assert.match(d.tipo === 'ensamblar' ? d.motivo : '', /La memoria ocupa unas 28 páginas y el límite es 25\./);
});

test('should_reject_hard_when_apartado_exceeds_quota_by_more_than_30_percent', async () => {
  const n = await enCritica();
  const g = guionPorId(db, n.guion_id)!;
  const c = contextoDeApartado(g, 1)!;
  const a = ApartadoEntrada.parse(apartadoCasoA(1, n));
  const con = (factor: number) => {
    const x = structuredClone(a);
    x.bloques[0]!.parrafos.push(
      'x'.repeat(Math.max(0, Math.ceil(c.cuota!.caracteres * factor) - caracteresDe(a.bloques))),
    );
    return revisarApartado(x, c, true);
  };
  assert.equal(
    con(1.5).duros.some((p) => /recorta/.test(p)),
    true,
  );
  const poco = con(1.1);
  assert.equal(
    poco.duros.some((p) => /recorta/.test(p)),
    false,
    'un exceso pequeño sigue siendo blando',
  );
  assert.equal(
    poco.blandos.some((p) => /recorta/.test(p)),
    true,
  );
  assert.equal(
    revisarApartado(ApartadoEntrada.parse(apartadoCasoA(1, n)), { ...c, cuota: { ...c.cuota!, caracteres: 100 } }).duros
      .length,
    0,
    'sin activar el exceso duro, un exceso grande sigue siendo blando',
  );
});

test('should_cap_round_growth_at_ten_percent_of_the_section', async () => {
  const n = await enCritica();
  criticar(n, 0, [8, 5, 5, 4]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const t = trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!;
  const inst = instruccionesRedaccion(db, nucleo().db, PayloadRedaccion.parse(JSON.parse(t.payload)));
  const m =
    /EXTENSIÓN EN LA RONDA: cada añadido sustituye texto \(quita lo secundario; no comprimas la sintaxis ni quites artículos y conectores\); el apartado no crece más de un 10 % \(hoy (\d+) caracteres: como mucho (\d+) y nunca más de \d+\)\./.exec(
      inst,
    );
  assert.ok(m, inst.slice(0, 2000));
  assert.equal(Number(m[2]), Math.round(Number(m[1]) * 1.1));
});

test('should_ask_to_reach_the_quota_floor_instead_of_capping_growth_when_the_section_is_short', async () => {
  const n = await enCritica();
  criticar(n, 0, [8, 5, 5, 4]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const fila = db
    .prepare('SELECT datos FROM memoria_apartado_rondas WHERE memoria_id = ? AND apartado = 2 AND ronda = 0')
    .get(n.memoria_id) as { datos: string };
  const corto = JSON.parse(fila.datos) as { bloques: { parrafos: string[] }[] };
  corto.bloques = [
    { ...corto.bloques[0]!, parrafos: ['Un procedimiento con responsable designado y respuesta en 48 horas.'] },
  ];
  db.prepare('UPDATE memoria_apartado_rondas SET datos = ? WHERE memoria_id = ? AND apartado = 2 AND ronda = 0').run(
    JSON.stringify(corto),
    n.memoria_id,
  );
  const t = trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!;
  const inst = instruccionesRedaccion(db, nucleo().db, PayloadRedaccion.parse(JSON.parse(t.payload)));
  const apartado2 = inst.slice(inst.indexOf('=== Apartado 2 ==='), inst.indexOf('=== Apartado 3 ==='));
  const m =
    /EXTENSIÓN EN LA RONDA: se queda corto \(hoy (\d+) caracteres, por debajo del mínimo de (\d+)\): crece hasta al menos \2 y nunca más de (\d+)/.exec(
      apartado2,
    );
  assert.ok(m, apartado2.slice(-600));
  assert.ok(Number(m[1]) < Number(m[2]) && Number(m[2]) < Number(m[3]));
  assert.doesNotMatch(
    apartado2,
    /no crece más de un 10 %/,
    'el tope del 10 % no se pide a un apartado por debajo del suelo',
  );
});

// ── Rondas que no repiten ──

test('should_mark_repeated_reason_from_previous_round', () => {
  const antes = [
    {
      cita: 'un indicador con meta mensual que revisará con la entidad',
      motivo: 'El indicador de consultas no tiene cifra objetivo.',
      arreglo: 'Fijar 95 %.',
    },
  ];
  const marcados = marcarMotivos(
    [
      {
        cita: 'otra frase distinta del apartado reescrito',
        motivo: 'El indicador de consultas sigue sin cifra objetivo mensual.',
        arreglo: 'Fijar 95 %.',
      },
      {
        cita: 'un indicador con meta mensual que revisará con la entidad',
        motivo: 'Meta sin responsable.',
        arreglo: 'Nombrar el rol.',
      },
      {
        cita: 'la formación se dará en dos sesiones anuales',
        motivo: 'Faltan destinatarios y materiales de la formación.',
        arreglo: 'Listar destinatarios.',
      },
    ],
    antes,
  );
  assert.deepEqual(
    marcados.map((m) => m.repetido),
    [true, true, false],
    'el mismo reproche o la misma cita; uno nuevo, no',
  );
  const fila = (ronda: number, datos: string, motivo: string): FilaRonda => ({
    apartado: 2,
    ronda,
    datos,
    puntos: 5,
    tramo: 5,
    motivos: JSON.stringify({ cita: 'x', motivos_para_bajar: [{ cita: 'c', motivo, arreglo: 'a' }], falta: [] }),
  });
  const sinReescribir = [
    fila(0, 'A', 'El indicador no tiene cifra objetivo.'),
    fila(1, 'A', 'El indicador no tiene cifra objetivo.'),
  ];
  assert.equal(
    motivosMarcados(sinReescribir, sinReescribir[1]!).motivos[0]!.repetido,
    false,
    'sin reescritura el crítico ve el mismo texto: no es «no resuelto»',
  );
  const reescrito = [
    fila(0, 'A', 'El indicador no tiene cifra objetivo.'),
    fila(1, 'B', 'El indicador no tiene cifra objetivo.'),
  ];
  assert.equal(motivosMarcados(reescrito, reescrito[1]!).motivos[0]!.repetido, true);
});

test('should_give_mockup_apartado_one_more_try_after_a_regression', () => {
  const conMaqueta = {
    ...MEM,
    apartados: MEM.apartados.map((a, i) => (i === 2 ? { ...a, titulo: 'Maqueta de las pantallas de consulta' } : a)),
  };
  const fila = (ronda: number, tramo: number, datos: string): FilaRonda => ({
    apartado: 3,
    ronda,
    datos,
    puntos: tramo,
    tramo,
    motivos: '{}',
  });
  const una = guardaRegresiones([fila(0, 5, 'A'), fila(1, 3, 'B')], conMaqueta, 1);
  assert.deepEqual(
    [una.bloqueados, una.reintentos, una.restaurar.map((r) => r.ronda)],
    [[], [3], [0]],
    'vuelve a su mejor versión y se puede pedir otra vez',
  );
  assert.deepEqual(
    apartadosARehacer({ mem: conMaqueta, efectivos: [ef(3, 5)], bloqueados: una.bloqueados, hallazgos: [] }),
    [3],
  );
  const dos = guardaRegresiones([fila(0, 5, 'A'), fila(1, 3, 'B'), fila(2, 3, 'C')], conMaqueta, 2);
  assert.deepEqual([dos.bloqueados, dos.reintentos], [[3], []], 'a la segunda bajada, bloqueado');
  assert.deepEqual(
    guardaRegresiones([fila(0, 5, 'A'), fila(1, 3, 'B')], MEM, 1).bloqueados,
    [3],
    'sin pantallas, a la primera',
  );
});

test('should_tell_the_rewriter_a_repeated_reason_is_unresolved_and_expose_reasons_per_round', async () => {
  const n = await enCritica();
  criticar(n, 0, [8, 5, 5, 4]);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const conCambio = (k: number, extra: string) => {
    const a = apartadoCasoA(k, n);
    a.bloques[0]!.parrafos.push(extra);
    return ApartadoEntrada.parse(a);
  };
  assert.equal(
    recibirApartado(
      db,
      conCambio(
        2,
        'El indicador de consultas resueltas en plazo se revisará cada mes con la entidad y su responsable.',
      ),
      'oferta-licitaciones',
      { revisar: true },
    ).error,
    null,
  );
  assert.equal(
    recibirApartado(
      db,
      conCambio(3, 'El acompañamiento incluye una reunión mensual de seguimiento con acta y acuerdos.'),
      'oferta-licitaciones',
      { revisar: true },
    ).error,
    null,
  );
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  criticarPares(n, 1, [8, 5, 5, 4], {
    2: { gana: 'nueva', nueva: 5, anterior: 5 },
    3: { gana: 'empate', nueva: 5, anterior: 5 },
  });
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.deepEqual([memoriaPorId(n.memoria_id).fase, memoriaPorId(n.memoria_id).ronda], ['redaccion', 2]);
  const t = trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!;
  const inst = instruccionesRedaccion(db, nucleo().db, PayloadRedaccion.parse(JSON.parse(t.payload)));
  assert.match(
    inst,
    /=== Apartado 2 ===[\s\S]*LO QUE SEÑALA EL CRÍTICO:\n- NO RESUELTO \(ya lo señaló la crítica anterior sobre el texto reescrito y el arreglo no bastó: cambia el enfoque, no repitas lo mismo con otras palabras\): «un indicador con meta mensual/,
  );
  const progreso = progresoDe(db, filaMemoria(db, n.memoria_id)!);
  const dos = (r: number) => progreso.criticas.find((c) => c.ronda === r)!.apartados.find((a) => a.apartado === 2)!;
  assert.deepEqual(
    [dos(0).motivos.map((m) => m.repetido), dos(1).motivos.map((m) => m.repetido)],
    [[false], [true]],
    'los motivos por ronda, marcados',
  );
  assert.equal(dos(1).motivos[0]!.arreglo, MOTIVO.arreglo);
});
