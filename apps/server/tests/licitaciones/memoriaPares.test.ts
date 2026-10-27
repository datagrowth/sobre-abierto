// Memoria técnica: desde la ronda 1 el crítico juzga por pares. Recibe la versión conservada
// y la nueva como documento 1 y 2, en un orden que alterna con la ronda y sin saber cuál es cuál;
// la plataforma conserva por apartado la preferida y para cuando la nueva no gana en ninguno. La
// ronda 0 sigue siendo absoluta, con la escala del propio pliego como vara de calibración.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrancar,
  cerrar,
  conectar,
  db,
  ID,
  memoriaPorId,
  nucleo,
  salidas,
  sinMemorias,
  T_CRITICO,
  texto,
  trabajosDe,
  trasLaEstrategia,
} from '../helpers/memoriaEntorno.js';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { APARTADOS, apartadoCasoA, GUION_CASO_A } from './fixtures/casoA.js';
import { apartadosPares, type Par } from './fixtures/criticaPares.js';
import type { Efectivo } from '../../src/dominios/licitaciones/oferta/rondasMemoria.js';

const { ApartadoEntrada, pedirMemoria, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { EstrategiaEntrada, recibirEstrategia } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const {
  CriticaEntrada,
  DEFECTOS_QUE_BAJAN,
  instruccionesCritica,
  PayloadCritica,
  recibirCritica,
  TIPO_MEMORIA_CRITICA,
} = await import('../../src/dominios/licitaciones/oferta/critica.js');
const { conservar, CriticaParesEntrada, documentoNuevo, instruccionesDeLaCritica, recibirCriticaPares, revisarPares } =
  await import('../../src/dominios/licitaciones/oferta/criticaPares.js');
const { decidirRonda, guardaRegresiones } = await import('../../src/dominios/licitaciones/oferta/rondasMemoria.js');
type FilaRonda = import('../../src/dominios/licitaciones/oferta/rondasMemoria.js').FilaRonda;

before(arrancar);
after(cerrar);
void salidas;

const MEM = GuionBase.parse(GUION_CASO_A).memoria!;
const CITA = 'La empresa propone para este punto un procedimiento con responsable designado, respuesta en 48 horas';
const MOTIVO = {
  cita: 'un indicador con meta mensual que revisará con la entidad',
  motivo: 'El indicador no tiene cifra.',
  arreglo: 'Fijar la meta del 95 % de consultas en plazo.',
};
const maximo = (k: number) => APARTADOS[k - 1]!.escala.at(-1)!;
const evaluar = (k: number, tramo: number) => ({
  tramo,
  cita: CITA,
  motivos_para_bajar: tramo < maximo(k) ? [MOTIVO] : [],
  falta: [] as string[],
});

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

function criticarRonda0(n: Numeros, tramos: number[]): void {
  const c = CriticaEntrada.parse({
    id: ID,
    memoria_id: n.memoria_id,
    ronda: 0,
    resumen: 'Le faltan cifras propias de la entidad.',
    apartados: tramos.map((t, i) => ({ apartado: i + 1, ...evaluar(i + 1, t), puntos: t })),
  });
  assert.equal(recibirCritica(db, c, 'critico-licitaciones', { revisar: true }).error, null);
}

// Lo que añade cada apartado reescrito en la ronda 1: así se ve qué versión queda.
const MARCAS: Record<number, string> = {
  1: 'La coordinación con la entidad se hará en una reunión quincenal con acta y un responsable por acuerdo.',
  2: 'El indicador de consultas resueltas en plazo tendrá una meta del 95 % cada mes, revisada con la entidad.',
  3: 'La formación al personal se dará en dos sesiones al año, en marzo y en octubre, con su material.',
  4: 'La mejora incluye un panel mensual con las consultas atendidas y su plazo medio de respuesta.',
};
const pendientes = (n: Numeros) =>
  (
    db
      .prepare("SELECT apartado FROM memoria_apartados WHERE memoria_id = ? AND estado = 'pendiente' ORDER BY apartado")
      .all(n.memoria_id) as { apartado: number }[]
  ).map((f) => f.apartado);
const textoDe = (n: Numeros, k: number) =>
  (
    db.prepare('SELECT datos FROM memoria_apartados WHERE memoria_id = ? AND apartado = ?').get(n.memoria_id, k) as {
      datos: string;
    }
  ).datos;

// Ronda 0 con estos tramos, y cada apartado que pide la ronda 1, reescrito con su marca.
async function enRonda1(tramos: number[]): Promise<Numeros> {
  const n = await enCritica();
  criticarRonda0(n, tramos);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  for (const k of pendientes(n)) {
    const a = apartadoCasoA(k, n);
    a.bloques[0]!.parrafos.push(MARCAS[k]!);
    const r = recibirApartado(db, ApartadoEntrada.parse(a), 'oferta-licitaciones', { revisar: true });
    assert.equal(r.error, null, r.error?.message);
  }
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.deepEqual([memoriaPorId(n.memoria_id).fase, memoriaPorId(n.memoria_id).ronda], ['critica', 1]);
  return n;
}

const entradaPares = (n: Numeros, tramos: number[], pares: Record<number, Par>) =>
  CriticaParesEntrada.parse({
    id: ID,
    memoria_id: n.memoria_id,
    ronda: 1,
    resumen: 'La versión preferida concreta más los indicadores.',
    apartados: apartadosPares(documentoNuevo(1), tramos, pares, evaluar),
  });

async function leerParte(n: Numeros, parte: string): Promise<{ texto: string; error: boolean }> {
  const c = await conectar(T_CRITICO);
  try {
    let todo = '';
    for (let desde: number | null = 0; desde !== null;) {
      const r = await c.callTool({
        name: 'licitaciones_memoria_critica_paquete',
        arguments: { id: ID, memoria_id: n.memoria_id, parte, desde },
      });
      if (r.isError) return { texto: texto(r), error: true };
      const t = JSON.parse(texto(r)) as { texto: string; siguiente: number | null };
      todo += t.texto;
      desde = t.siguiente;
    }
    return { texto: todo, error: false };
  } finally {
    await c.close();
  }
}

test('should_alternate_document_order_by_round_without_saying_which_is_new', async () => {
  assert.deepEqual([1, 2, 3, 4].map(documentoNuevo), [2, 1, 2, 1], 'la nueva cambia de lado cada ronda');
  const n = await enRonda1([6, 5, 5, 2]);
  const [uno, dos] = [await leerParte(n, 'documento_1'), await leerParte(n, 'documento_2')];
  assert.equal(uno.error || dos.error, false, uno.texto.slice(0, 300));
  assert.ok(
    dos.texto.includes(MARCAS[2]!) && !uno.texto.includes(MARCAS[2]!),
    'en la ronda 1 la nueva es el documento 2',
  );
  assert.match(uno.texto, /Comprobaciones automáticas|comprobaciones/i, 'cada versión, con sus comprobaciones delante');
  assert.match(uno.texto, /Gestión de incidencias y control de calidad/);
  const actual = await leerParte(n, 'documento');
  assert.equal(actual.error, true, 'el texto actual delataría cuál es la nueva');
  assert.match(actual.texto, /En la ronda 1 se comparan dos versiones: lee «documento_1» y «documento_2»\./);
  const inst = instruccionesDeLaCritica(
    db,
    PayloadCritica.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_CRITICA).at(-1)!.payload)),
  );
  assert.match(inst, /comparas dos versiones de la memoria técnica \(versión \d+, ronda 1\)/);
  assert.match(inst, /Los documentos solo difieren en los apartados 1, 2, 3, 4/);
  assert.match(inst, /SOLO puedes usar licitaciones_memoria_critica_paquete y licitaciones_memoria_critica_pares\./);
  assert.match(
    inst,
    /A igual valor para la mesa, prefiere la versión que compromete menos coste/,
    'a igual valor, lo que cuesta menos ejecutar',
  );
  assert.match(inst, /compromete lo caro que el pliego no exige y no puntúa/);
  assert.doesNotMatch(inst, /documento_[12][^.]{0,40}\b(?:nueva|anterior|reescrit)/i, 'no dice cuál es la nueva');
  const cero = await enCritica();
  const r = await leerParte(cero, 'documento_1');
  assert.equal(r.error, true, 'en la ronda 0 no hay par que comparar');
  assert.match(r.texto, /en la ronda 0 lee «documento»/);
});

test('should_validate_pairwise_input_schema', () => {
  const valida = {
    id: ID,
    memoria_id: 1,
    ronda: 1,
    resumen: 'La versión preferida concreta más.',
    apartados: apartadosPares(2, [8, 5, 5, 4], { 2: { gana: 'nueva', nueva: 7, anterior: 5 } }, evaluar),
  };
  assert.equal(CriticaParesEntrada.safeParse(valida).success, true);
  assert.equal(CriticaParesEntrada.safeParse({ ...valida, ronda: 0 }).success, false, 'la ronda 0 es absoluta');
  assert.equal(
    CriticaParesEntrada.safeParse({ ...valida, apartados: valida.apartados.map((a) => ({ ...a, preferido: 'nueva' })) })
      .success,
    false,
    'el crítico no sabe cuál es la nueva',
  );
  assert.equal(
    CriticaParesEntrada.safeParse({ ...valida, apartados: valida.apartados.map((a) => ({ ...a, nota: 7 })) }).success,
    false,
    'sin campos de más',
  );
  assert.equal(
    CriticaParesEntrada.safeParse({ ...valida, apartados: valida.apartados.map(({ documento_1: _d, ...a }) => a) })
      .success,
    false,
    'documento_1 siempre',
  );

  const base = APARTADOS.map((_, i) => `${i + 1}. Apartado\n${CITA}. Hay ${MOTIVO.cita}.`);
  const ctx = {
    mem: MEM,
    textos: [base, base.map((t, i) => (i === 1 ? `${t}\nOtra frase de la versión distinta del apartado dos.` : t))] as [
      string[],
      string[],
    ],
    distintos: [2],
  };
  const datos = (pares: Record<number, Par>) => ({
    resumen: valida.resumen,
    apartados: apartadosPares(2, [8, 5, 5, 4], pares, evaluar),
  });
  assert.deepEqual(revisarPares(datos({ 2: { gana: 'nueva', nueva: 7, anterior: 5 } }), ctx), {
    duros: [],
    blandos: [],
    rebajas: new Map(),
  });
  const conPar = (cambio: (a: ReturnType<typeof apartadosPares>[number]) => object) =>
    ({
      ...datos({ 2: { gana: 'nueva', nueva: 7, anterior: 5 } }),
      apartados: datos({ 2: { gana: 'nueva', nueva: 7, anterior: 5 } }).apartados.map((a) =>
        a.apartado === 2 ? { ...a, ...cambio(a) } : a,
      ),
    }) as Parameters<typeof revisarPares>[0];
  const duros = (c: Parameters<typeof revisarPares>[0]) => revisarPares(c, ctx).duros.join(' ');
  assert.match(
    duros(datos({ 1: { gana: 'nueva', nueva: 8, anterior: 6 }, 2: { gana: 'nueva', nueva: 7, anterior: 5 } })),
    /Los dos documentos son idénticos en el apartado 1: «empate»/,
  );
  assert.match(
    duros(conPar(() => ({ documento_2: undefined }))),
    /Los documentos difieren en el apartado 2: evalúa también «documento_2»/,
  );
  assert.match(
    duros(conPar(() => ({ preferido: '1' }))),
    /En el apartado 2 prefieres el documento 1 y le das un tramo más bajo que al otro/,
  );
  assert.match(
    duros(conPar(() => ({ diferencia: undefined }))),
    /En el apartado 2 prefieres el documento 2: di en «diferencia»/,
  );
  assert.match(
    duros(conPar((a) => ({ documento_1: { ...a.documento_1, tramo: 4 } }))),
    /El tramo 4 no está en la escala del apartado 2 del documento 1/,
  );
  const sinCita = revisarPares(
    conPar((a) => ({
      documento_2: { ...a.documento_2!, cita: 'Una frase que no está en ninguno de los dos documentos' },
    })),
    ctx,
  );
  assert.match(sinCita.blandos.join(' '), /La cita del apartado 2 del documento 2 no está tal cual/);
  assert.equal(sinCita.rebajas.get('2-2'), 5, 'al tercer envío, un tramo por debajo');
});

test('should_keep_preferred_version_per_apartado', async () => {
  const n = await enRonda1([6, 5, 5, 2]);
  const absoluta = CriticaEntrada.parse({
    id: ID,
    memoria_id: n.memoria_id,
    ronda: 1,
    resumen: 'Nota absoluta de la ronda 1.',
    apartados: [6, 5, 5, 2].map((t, i) => ({ apartado: i + 1, ...evaluar(i + 1, t), puntos: t })),
  });
  assert.match(
    recibirCritica(db, absoluta, 'critico-licitaciones', { revisar: true }).error?.message ?? '',
    /Desde la ronda 1 la crítica es por pares: .*licitaciones_memoria_critica_pares/,
  );
  const pares = {
    1: { gana: 'empate', nueva: 6, anterior: 6 },
    2: { gana: 'nueva', nueva: 7, anterior: 5 },
    3: { gana: 'anterior', nueva: 3, anterior: 5 },
    4: { gana: 'nueva', nueva: 4, anterior: 2 },
  } satisfies Record<number, Par>;
  const r = recibirCriticaPares(db, entradaPares(n, [6, 5, 5, 2], pares), 'critico-licitaciones', { revisar: true });
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    [r.data!.ganadas, r.data!.restaurados, r.data!.total],
    [2, [3], 6 + 7 + 5 + 4],
    'el total, con la versión conservada de cada apartado',
  );
  const fila3 = db
    .prepare('SELECT tramo, motivos FROM memoria_apartado_rondas WHERE memoria_id = ? AND apartado = 3 AND ronda = 1')
    .get(n.memoria_id) as { tramo: number; motivos: string };
  assert.equal(fila3.tramo, 5);
  assert.deepEqual((JSON.parse(fila3.motivos) as { par: unknown }).par, {
    contra: 0,
    gana: 'anterior',
    restaurada: true,
    diferencia: 'La otra versión no fija la meta mensual del indicador ni quién la revisa.',
  });
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual([m.fase, m.ronda], ['redaccion', 2], '22 de 25 no llega al 90 %');
  assert.ok(
    textoDe(n, 2).includes(MARCAS[2]!) && textoDe(n, 4).includes(MARCAS[4]!) && textoDe(n, 1).includes(MARCAS[1]!),
    'las nuevas que ganan o empatan se quedan',
  );
  assert.ok(!textoDe(n, 3).includes(MARCAS[3]!), 'el 3 vuelve a la versión que prefirió el crítico');
  assert.deepEqual(pendientes(n), [1], 'el 3 perdió y no se vuelve a pedir; el 2 y el 4 están en su máximo');
  const avisos = JSON.parse(
    (db.prepare('SELECT avisos FROM memorias WHERE id = ?').get(n.memoria_id) as { avisos: string }).avisos,
  ) as string[];
  assert.ok(
    avisos.includes(
      '3. Asesoramiento y acompañamiento: en la ronda 1 el crítico prefirió la versión anterior (ronda 0); se conserva esa.',
    ),
    avisos.join(' | '),
  );
});

test('should_stop_rounds_when_new_version_wins_nowhere', async () => {
  const ef = (apartado: number, tramo: number): Efectivo => ({
    apartado,
    ronda: 1,
    puntos: tramo,
    tramo,
    cita: 'x',
    motivos_para_bajar: tramo < maximo(apartado) ? [MOTIVO] : [],
    falta: [],
  });
  const entrada = {
    mem: MEM,
    efectivos: [ef(1, 6), ef(2, 5), ef(3, 5), ef(4, 2)],
    bloqueados: [],
    hallazgos: [],
    totales: [17, 18],
    ronda: 1,
    umbral: 0.9,
    maxRondas: 3,
    plazo: true,
  };
  assert.deepEqual(decidirRonda({ ...entrada, ganadas: 0 }), {
    tipo: 'ensamblar',
    motivo:
      'En la ronda 1 el crítico no prefirió la versión nueva en ningún apartado frente a la anterior: se ensambla con lo mejor de cada apartado.',
    aviso: true,
  });
  assert.equal(decidirRonda({ ...entrada, ganadas: 1 }).tipo, 'ronda', 'gana en uno: otra ronda');
  assert.equal(decidirRonda({ ...entrada, ganadas: null }).tipo, 'ronda', 'una crítica absoluta no para por esto');
  assert.equal(
    decidirRonda({ ...entrada, ganadas: 0, bloqueantes: [3, 1] }).tipo,
    'ronda',
    'si bajan los bloqueantes de coherencia, sigue',
  );

  const n = await enRonda1([6, 5, 5, 2]);
  const pares = {
    1: { gana: 'empate', nueva: 6, anterior: 6 },
    2: { gana: 'anterior', nueva: 3, anterior: 5 },
    3: { gana: 'empate', nueva: 5, anterior: 5 },
    4: { gana: 'anterior', nueva: 2, anterior: 2 },
  } satisfies Record<number, Par>;
  const r = recibirCriticaPares(db, entradaPares(n, [6, 5, 5, 2], pares), 'critico-licitaciones', { revisar: true });
  assert.equal(r.error, null, r.error?.message);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const m = memoriaPorId(n.memoria_id);
  assert.deepEqual([m.fase, m.ronda], ['fin', 1], 'no se gasta otra ronda');
  assert.ok(
    !textoDe(n, 2).includes(MARCAS[2]!) && textoDe(n, 3).includes(MARCAS[3]!),
    'se ensambla con la preferida de cada apartado (empate: la nueva)',
  );
});

test('should_count_a_lost_pair_as_a_regression_and_keep_new_version_when_a_fact_patch_left_the_old_one_behind', () => {
  const fila = (ronda: number, datos: string, par?: object): FilaRonda => ({
    apartado: 3,
    ronda,
    datos,
    puntos: 5,
    tramo: 5,
    motivos: JSON.stringify({ cita: 'x', motivos_para_bajar: [], falta: [], ...(par ? { par } : {}) }),
  });
  const conMaqueta = {
    ...MEM,
    apartados: MEM.apartados.map((a, i) => (i === 2 ? { ...a, titulo: 'Maqueta de las pantallas de consulta' } : a)),
  };
  const perdida = [fila(0, 'A'), fila(1, 'A', { contra: 0, gana: 'anterior', restaurada: true })];
  const r = guardaRegresiones(perdida, conMaqueta, 1);
  assert.deepEqual(
    [r.restaurar, r.reintentos, r.bloqueados],
    [[{ apartado: 3, ronda: 1, datos: 'A' }], [3], []],
    'uno de pantallas tiene otro intento',
  );
  assert.deepEqual(guardaRegresiones(perdida, MEM, 1).bloqueados, [3], 'los demás, a la primera');
  assert.deepEqual(
    guardaRegresiones([fila(0, 'A'), fila(1, 'B', { contra: 0, gana: 'empate', restaurada: false })], MEM, 1).restaurar,
    [],
    'un empate conserva la nueva',
  );

  const v = {
    nuevo: 2 as const,
    anterior: [1, 2, 3].map((k) => ({ ronda: 0, datos: `vieja ${k}` })),
    nueva: [1, 2, 3].map((k) => `nueva ${k}`),
    distintos: [3],
  };
  const x = apartadosPares(2, [8, 5, 5], { 3: { gana: 'anterior', nueva: 3, anterior: 5 } }, evaluar)[2]!;
  assert.deepEqual([conservar(x, v).fila.datos, conservar(x, v).critica.tramo], ['vieja 3', 5]);
  const tras = conservar(x, v, true);
  assert.deepEqual(
    [tras.fila.datos, tras.critica.tramo, tras.fila.par.restaurada],
    ['nueva 3', 3, false],
    'volver a la anterior traería el valor viejo del hecho',
  );
});

test('should_calibrate_round_0_with_the_pliego_scale_and_flag_environment_incoherences', async () => {
  const n = await enCritica();
  const inst = instruccionesCritica(
    db,
    PayloadCritica.parse(JSON.parse(trabajosDe(TIPO_MEMORIA_CRITICA).at(-1)!.payload)),
  );
  assert.match(
    inst,
    /El tramo Excelente \(el más alto\) exige concreción verificable[^\n]*Bueno \(el siguiente\) si lo principal está concreto pero hay aspectos secundarios poco desarrollados/,
  );
  assert.match(
    inst,
    /Con la escala de este pliego, en «Organización y metodología del servicio»: «Propuesta con un desarrollo que merece 8 puntos\.» \(8\) frente a «Propuesta con un desarrollo que merece 6 puntos\.» \(6\)/,
  );
  assert.ok(DEFECTOS_QUE_BAJAN.some((d) => /incoherencias entre calendario, entornos y medición/.test(d)));
  assert.match(inst, /incoherencias entre calendario, entornos y medición/);
  assert.match(
    inst,
    /Comprometer lo caro que el pliego no exige ni puntúa no sube ningún tramo: es un defecto/,
    'en la calibración',
  );
  assert.match(
    inst,
    /Cada uno de estos defectos impide el Excelente del apartado donde esté: [^\n]*compromete lo caro que el pliego no exige y no puntúa \(guardias o fines de semana, entrevistas o material físico por persona/,
  );
  assert.equal(
    instruccionesDeLaCritica(
      db,
      PayloadCritica.parse({
        id: ID,
        memoria_id: n.memoria_id,
        version: n.version,
        ronda: 0,
        pedida_en: new Date().toISOString(),
        independiente: true,
      }),
    ),
    instruccionesCritica(
      db,
      PayloadCritica.parse({
        id: ID,
        memoria_id: n.memoria_id,
        version: n.version,
        ronda: 0,
        pedida_en: new Date().toISOString(),
        independiente: true,
      }),
    ),
    'la ronda 0 sigue siendo absoluta',
  );
});

test('should_not_undo_a_length_cut_unless_the_new_version_drops_a_tier', () => {
  const v = {
    nuevo: 2 as const,
    anterior: [1, 2, 3].map((k) => ({ ronda: 0, datos: `larga ${k}` })),
    nueva: [1, 2, 3].map((k) => `recortada ${k}`),
    distintos: [3],
  };
  const mismoTramo = apartadosPares(2, [8, 5, 5], { 3: { gana: 'anterior', nueva: 5, anterior: 5 } }, evaluar)[2]!;
  const recorte = conservar(mismoTramo, v, false, { porExtension: true });
  assert.deepEqual(
    [recorte.fila.datos, recorte.fila.par.restaurada, recorte.fila.par.gana],
    ['recortada 3', false, 'anterior'],
    'el crítico no ve las páginas: el recorte se queda',
  );
  assert.equal(conservar(mismoTramo, v).fila.datos, 'larga 3', 'sin recorte por extensión, gana la preferida');
  const baja = apartadosPares(2, [8, 5, 5], { 3: { gana: 'anterior', nueva: 3, anterior: 5 } }, evaluar)[2]!;
  assert.equal(
    conservar(baja, v, false, { porExtension: true }).fila.datos,
    'larga 3',
    'si el recorte baja un tramo, vuelve la anterior',
  );
});

test('should_warn_when_assembling_over_the_page_limit_with_the_overflowing_apartados_locked', () => {
  const ef = (apartado: number, tramo: number): Efectivo => ({
    apartado,
    ronda: 1,
    puntos: tramo,
    tramo,
    cita: 'x',
    motivos_para_bajar: tramo < maximo(apartado) ? [MOTIVO] : [],
    falta: [],
  });
  const d = decidirRonda({
    mem: MEM,
    efectivos: [ef(1, 8), ef(2, 7), ef(3, 6), ef(4, 4)],
    bloqueados: [3],
    hallazgos: [],
    totales: [22, 25],
    ronda: 1,
    umbral: 0.9,
    maxRondas: 3,
    plazo: true,
    extension: { limite: 25, paginas: 27.4, excesos: [3] },
  });
  assert.equal(d.tipo, 'ensamblar');
  assert.equal(d.tipo === 'ensamblar' && d.aviso, true, 'pasada del límite no se entrega en silencio');
  assert.match(
    d.tipo === 'ensamblar' ? d.motivo : '',
    /llega al umbral .*no se pueden recortar más en esta versión\. La memoria ocupa unas 28 páginas y el límite es 25\./,
  );
});

test('should_count_pairwise_wins_as_progress_instead_of_comparing_totals', () => {
  const ef = (apartado: number, tramo: number): Efectivo => ({
    apartado,
    ronda: 2,
    puntos: tramo,
    tramo,
    cita: 'x',
    motivos_para_bajar: tramo < maximo(apartado) ? [MOTIVO] : [],
    falta: [],
  });
  const entrada = {
    mem: MEM,
    efectivos: [ef(1, 6), ef(2, 5), ef(3, 5), ef(4, 2)],
    bloqueados: [],
    hallazgos: [],
    totales: [18, 18, 18],
    ronda: 2,
    umbral: 0.9,
    maxRondas: 3,
    plazo: true,
    ganadas: 2,
  };
  assert.match(
    JSON.stringify(decidirRonda(entrada)),
    /Dos rondas seguidas sin subir la nota/,
    'sin la serie de victorias, el total manda',
  );
  assert.equal(
    decidirRonda({ ...entrada, ganadasPorRonda: [null, 3, 2] }).tipo,
    'ronda',
    'la nueva ganó en las dos rondas por pares: sigue',
  );
  assert.equal(
    decidirRonda({ ...entrada, totales: [20, 17, 17], ganadasPorRonda: [null, 3, 2] }).tipo,
    'ronda',
    'una reevaluación por pares más baja que la nota absoluta de la ronda 0 no es «sin mejora»',
  );
});

test('should_not_restore_a_previous_version_that_contradicts_the_fact_sheet_and_recompute_coherence_after_restoring', async () => {
  const n = await enRonda1([6, 5, 5, 2]);
  const fila = db
    .prepare('SELECT datos FROM memoria_apartado_rondas WHERE memoria_id = ? AND apartado = 2 AND ronda = 0')
    .get(n.memoria_id) as { datos: string };
  const d = JSON.parse(fila.datos) as { bloques: { parrafos: string[] }[] };
  d.bloques[0]!.parrafos.push(
    'La atención de consultas se presta de lunes a viernes de 9:00 a 18:00 (hora de Canarias).',
  );
  db.prepare('UPDATE memoria_apartado_rondas SET datos = ? WHERE memoria_id = ? AND apartado = 2 AND ronda = 0').run(
    JSON.stringify(d),
    n.memoria_id,
  );
  const pares = {
    1: { gana: 'empate', nueva: 6, anterior: 6 },
    2: { gana: 'anterior', nueva: 5, anterior: 7 },
    3: { gana: 'anterior', nueva: 3, anterior: 5 },
    4: { gana: 'nueva', nueva: 4, anterior: 2 },
  } satisfies Record<number, Par>;
  const r = recibirCriticaPares(db, entradaPares(n, [6, 5, 5, 2], pares), 'critico-licitaciones', { revisar: true });
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    r.data!.restaurados,
    [3],
    'la anterior del 2 contradice la hoja de hechos y la nueva no: se queda la nueva',
  );
  const par2 = JSON.parse(
    (
      db
        .prepare('SELECT motivos FROM memoria_apartado_rondas WHERE memoria_id = ? AND apartado = 2 AND ronda = 1')
        .get(n.memoria_id) as { motivos: string }
    ).motivos,
  ) as { par: { gana: string; restaurada: boolean } };
  assert.deepEqual([par2.par.gana, par2.par.restaurada], ['anterior', false]);
  // La coherencia guardada es la del texto nuevo: restaurado el 3, se recalcula.
  const vieja = [
    {
      apartado: 3,
      hecho: 'horario_atencion',
      cita: 'x',
      encontrado: '9:00-18:00',
      esperado: 'L-V 9:00-17:00',
      tipo: 'contradiccion',
    },
  ];
  db.prepare('UPDATE memorias SET coherencia = ? WHERE id = ?').run(JSON.stringify(vieja), n.memoria_id);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  const coherencia = (
    db.prepare('SELECT coherencia FROM memorias WHERE id = ?').get(n.memoria_id) as { coherencia: string }
  ).coherencia;
  assert.doesNotMatch(coherencia, /"cita":"x"/, 'los hallazgos se recalculan sobre el texto restaurado');
  assert.ok(!textoDe(n, 2).includes('9:00 a 18:00'));
});

// El gancho de coste llega al crítico por el camino real: un proveedor registrado entra en las
// comprobaciones de la ronda 0 y de cada versión del par, sin tocar las firmas del crítico.
test('should_reach_the_blind_critic_with_a_registered_cost_provider', async () => {
  const { registrarProveedorCoste } = await import('../../src/dominios/licitaciones/oferta/compromisosMemoriaCoste.js');
  const proveedor = () => [
    {
      texto: 'Material físico sintético por persona',
      cita: 'no está en el texto',
      clase: 'anadido' as const,
      criterio: null,
      horas: 120,
      euros: 3_000,
      supuesto: '30 personas × 4 h',
    },
  ];
  const n = await enRonda1([6, 5, 5, 2]);
  registrarProveedorCoste(proveedor);
  try {
    for (const parte of ['documento_1', 'documento_2'])
      assert.match(
        (await leerParte(n, parte)).texto,
        /Compromete «Material físico sintético por persona» \(120 h, coste alto\)/,
        parte,
      );
    const cero = await enCritica();
    assert.match(
      (await leerParte(cero, 'documento')).texto,
      /Compromete «Material físico sintético por persona»/,
      'ronda 0',
    );
  } finally {
    registrarProveedorCoste();
  }
});
