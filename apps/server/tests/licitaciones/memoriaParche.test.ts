// Parche de hechos desde las rondas. Si un motivo del crítico cita literalmente el
// valor de un hecho, entre la crítica y la reescritura una fase acotada corrige solo esos hechos
// (respetando la ficha aprobada salvo que el motivo la contradiga, y marcándolo para revisión) y
// después se rehacen los apartados que los usan. Guiones sintéticos (caso A).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
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

const { ApartadoEntrada, pedirMemoria, recibirApartado } =
  await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { avanzarMemoria, siguientePaso } = await import('../../src/dominios/licitaciones/oferta/avanceMemoria.js');
const { EstrategiaEntrada, estrategiaDe, recibirEstrategia } =
  await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { CriticaEntrada, recibirCritica } = await import('../../src/dominios/licitaciones/oferta/critica.js');
const {
  apartadosQueUsan,
  campoDeFicha,
  HechosEntrada,
  hechosCitados,
  hechosRecibidos,
  instruccionesHechos,
  parcheDe,
  PayloadHechos,
  recibirHechos,
  TIPO_MEMORIA_HECHOS,
} = await import('../../src/dominios/licitaciones/oferta/parcheHechos.js');
const { instruccionesRedaccion, PayloadRedaccion, TIPO_MEMORIA_REDACCION } =
  await import('../../src/dominios/licitaciones/oferta/redaccion.js');
const { progresoDe } = await import('../../src/dominios/licitaciones/oferta/progresoMemoria.js');
const { filaMemoria } = await import('../../src/dominios/licitaciones/oferta/ensamblado.js');
const { fichaDe } = await import('../../src/dominios/licitaciones/oferta/fichaSolucion.js');
const { guardaRegresiones, obsoletasPorParches } =
  await import('../../src/dominios/licitaciones/oferta/rondasMemoria.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
type HechoData = import('../../src/dominios/licitaciones/oferta/estrategia.js').HechoData;
type EstadoAvance = import('../../src/dominios/licitaciones/oferta/avanceMemoria.js').EstadoAvance;

before(arrancar);
after(cerrar);

// ── Puro ──

const hecho = (clave: string, valor: string, extra: Partial<HechoData> = {}): HechoData => ({
  clave,
  categoria: 'calendario',
  sobre: clave,
  valor,
  palabras: [clave],
  ...extra,
});
const motivo = (cita: string, texto = 'Calendario relativo, sin fechas.') => ({
  cita,
  motivo: texto,
  arreglo: 'Fechar desde el 16/11/2026.',
});

test('should_trigger_facts_patch_when_a_reason_quotes_a_fact_value', () => {
  const hechos = [
    hecho('t0', 'T0 = firma del acta de inicio'),
    hecho('rol_jp', 'Jefatura de proyecto', { categoria: 'rol' }),
    hecho('sla', '4 h'),
    hecho('muestra', 'muestra de aceptación a definir con el órgano', { apartados: [3] }),
  ];
  const pedidos = hechosCitados(hechos, [
    {
      apartado: 1,
      motivos_para_bajar: [
        motivo('El plan arranca en T0 = firma del acta de inicio y sigue por semanas.'),
        motivo('La Jefatura de proyecto lo revisa en 4 h.', 'Rol sin dedicación.'),
      ],
    },
    {
      apartado: 2,
      motivos_para_bajar: [
        motivo('Sin cifras.', 'La muestra de aceptación a definir con el órgano aplaza el banco de pruebas.'),
        motivo('El calendario vuelve a T0 = firma del acta de inicio.'),
      ],
    },
  ]);
  assert.deepEqual(
    pedidos.map((p) => [p.clave, p.motivos.map((m) => m.apartado)]),
    [
      ['t0', [1, 2]],
      ['muestra', [2]],
    ],
    'ni los roles ni los valores cortos; el más citado primero',
  );
  assert.deepEqual(
    hechosCitados(hechos, [{ apartado: 1, motivos_para_bajar: [motivo('Sin relación con ningún hecho.')] }]),
    [],
  );
  const textos = [
    'Arranque en T0 = firma del acta de inicio.',
    'Nada de eso.',
    'Otro texto.',
    'Desde T0 = firma del acta de inicio.',
  ];
  assert.deepEqual(
    apartadosQueUsan(pedidos, hechos, textos),
    [1, 3, 4],
    'los de la estrategia y los que llevan el valor',
  );
});

test('should_not_patch_a_fact_when_the_reason_is_about_something_else_in_the_quoted_sentence', () => {
  const inicio = hecho('inicio', '2026-11-02', { palabras: ['inicio', 'arranque'] });
  const cita = 'El proyecto empieza el 2026-11-02 con la reunión de lanzamiento';
  assert.deepEqual(
    hechosCitados(
      [inicio],
      [{ apartado: 1, motivos_para_bajar: [motivo(cita, 'Falta el orden del día de la reunión.')] }],
    ),
    [],
    'la cita lleva la fecha, pero el motivo trata de otra cosa',
  );
  assert.equal(
    hechosCitados(
      [inicio],
      [{ apartado: 1, motivos_para_bajar: [motivo(cita, 'El arranque no dice quién lo convoca.')] }],
    ).length,
    1,
    'el motivo habla del arranque',
  );
});

test('should_not_restore_a_version_with_the_value_a_round_patch_replaced', () => {
  const mem = GuionBase.parse(GUION_CASO_A).memoria!;
  const [bajo, maximo] = APARTADOS[0]!.escala.slice(-2) as [number, number];
  const fila = (ronda: number, tramo: number, horario: string) => ({
    apartado: 1,
    ronda,
    datos: JSON.stringify({ texto: `Soporte de ${horario}.` }),
    puntos: tramo,
    tramo,
    motivos: '{}',
  });
  const filas = [fila(0, maximo, '8:00-18:00'), fila(1, bajo, '8:00-20:00')];
  assert.deepEqual(
    guardaRegresiones(filas, mem, 1).restaurar.map((r) => r.ronda),
    [0],
    'sin parche, bajar restaura la mejor versión',
  );
  const obsoleta = obsoletasPorParches([
    {
      ronda: 1,
      estado: 'recibido',
      cambios: [
        { clave: 'horario', sobre: 'horario', antes: '8:00-18:00', despues: '8:00-20:00', motivo: 'm', ficha: null },
      ],
    },
  ]);
  const r = guardaRegresiones(filas, mem, 1, obsoleta);
  assert.deepEqual(
    [r.restaurar, r.bloqueados, r.efectivos[0]!.ronda],
    [[], [], 1],
    'la de la ronda 0 dice el horario de antes: no se restaura ni bloquea el apartado',
  );
});

test('should_detect_value_approved_in_the_solution_sheet', () => {
  const ficha = {
    estado: 'aprobada' as const,
    campos: [
      {
        clave: 'soporte-respuesta',
        grupo: 'Soporte',
        etiqueta: 'Tiempos de respuesta',
        propuesto: 'x',
        valor: 'Respuesta en 48 horas',
      },
    ],
  };
  const f = {
    memoria_id: 1,
    creada_en: '',
    vence_en: '',
    revisada_en: null,
    revisada_por: null,
    editados: [],
    no_revisados: [],
    ...ficha,
  };
  assert.equal(
    campoDeFicha(f, { clave: 'respuesta', valor: '48 horas' }),
    'Tiempos de respuesta: Respuesta en 48 horas',
    'una ficha de antes, sin hechos atados, se compara por texto',
  );
  assert.equal(
    campoDeFicha({ ...f, estado: 'vencida' }, { clave: 'respuesta', valor: '48 horas' }),
    null,
    'sin revisar, no hay nada aprobado que respetar',
  );
  assert.equal(campoDeFicha(f, { clave: 'horario', valor: 'L-V 9:00-17:00' }), null);
});

test('should_skip_patch_and_rewrite_when_the_facts_job_is_exhausted_or_out_of_time', () => {
  const base: EstadoAvance = {
    fase: 'hechos',
    dossier: true,
    estrategia: true,
    critica: false,
    pendientes: 2,
    recibidos: 4,
    trabajo: { estado: 'ninguno', reintento: null, agotado: false },
    plazo: true,
    ficha: 'aprobada',
    ensayo: false,
    parche: 'pendiente',
  };
  assert.deepEqual(siguientePaso(base), { tipo: 'encolar', reintento: 0 });
  assert.deepEqual(siguientePaso({ ...base, parche: 'recibido' }), { tipo: 'pasar', fase: 'redaccion' });
  assert.equal(
    siguientePaso({ ...base, trabajo: { estado: 'fallido', reintento: null, agotado: true } }).tipo,
    'saltar_parche',
  );
  assert.equal(
    siguientePaso({ ...base, plazo: false, trabajo: { estado: 'fallido', reintento: 1, agotado: false } }).tipo,
    'saltar_parche',
  );
});

// ── De punta a punta ──

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
const SOBRE_48H = {
  cita: CITA,
  motivo: 'Un único plazo de 48 horas para todo no distingue prioridades.',
  arreglo: 'Fijar 4 horas para las urgentes y 24 horas para el resto.',
};

function criticarCitandoUnHecho(n: Numeros): void {
  const c = CriticaEntrada.parse({
    id: ID,
    memoria_id: n.memoria_id,
    ronda: 0,
    resumen: 'Plazos sin prioridades y cifras genéricas.',
    apartados: APARTADOS.map((a, i) => {
      const tramo = i === 0 ? a.escala.at(-1)! : a.escala.at(-2)!;
      return {
        apartado: i + 1,
        tramo,
        puntos: tramo,
        cita: CITA,
        motivos_para_bajar: i === 0 ? [] : i === 1 ? [SOBRE_48H] : [MOTIVO],
        falta: [],
      };
    }),
  });
  const r = recibirCritica(db, c, 'critico-licitaciones', { revisar: true });
  assert.equal(r.error, null, r.error?.message);
}

const pendientes = (n: Numeros) =>
  (
    db
      .prepare("SELECT apartado FROM memoria_apartados WHERE memoria_id = ? AND estado = 'pendiente' ORDER BY apartado")
      .all(n.memoria_id) as { apartado: number }[]
  ).map((f) => f.apartado);
const entrada = (n: Numeros, hechos: { clave: string; valor: string; motivo: string }[]) =>
  HechosEntrada.parse({ id: ID, memoria_id: n.memoria_id, ronda: 1, hechos });

test('should_patch_quoted_fact_then_rewrite_the_apartados_that_use_it', async () => {
  const n = await enCritica();
  criticarCitandoUnHecho(n);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.deepEqual(
    [memoriaPorId(n.memoria_id).fase, memoriaPorId(n.memoria_id).ronda],
    ['hechos', 1],
    'antes de reescribir, la hoja',
  );
  const parche = parcheDe(db, n.memoria_id, 1)!;
  assert.deepEqual(
    parche.pedidos.map((p) => [p.clave, p.valor, p.ficha]),
    [['respuesta_consultas', '48 horas', 'Tiempos de respuesta: Respuesta a consultas en 48 horas']],
  );
  assert.deepEqual(pendientes(n), [2, 3, 4], 'el 1 está en el máximo: solo se rehará si el hecho cambia');
  const t = trabajosDe(TIPO_MEMORIA_HECHOS).at(-1)!;
  assert.equal(t.clave, `memoria-${ID}-v${n.version}-hechos-r1`);
  const payload = PayloadHechos.parse(JSON.parse(t.payload));
  const inst = instruccionesHechos(db, payload);
  assert.match(inst, /- «respuesta_consultas» \(respuesta a consultas\): hoy «48 horas»\./);
  assert.match(
    inst,
    /Apartado 2, sobre «La empresa propone[^»]*»: Un único plazo de 48 horas para todo no distingue prioridades\. Arreglo que propone: Fijar 4 horas/,
  );
  assert.match(
    inst,
    /lo APROBÓ UNA PERSONA en la ficha de solución \(«Tiempos de respuesta: Respuesta a consultas en 48 horas»\): mantenlo salvo que el motivo lo contradiga/,
  );
  assert.equal(
    trabajosDe(TIPO_MEMORIA_REDACCION).filter((x) => x.clave.endsWith('-r1')).length,
    0,
    'la reescritura espera al parche',
  );
  assert.match(
    inst,
    /REVISIÓN HUMANA: ficha de solución aprobada por Equipo de pruebas el \d{1,2} de \p{L}+ de \d{4}: redacta con estos valores\. Ninguna revisión humana bloquea esta tarea/u,
    'el parche sabe en qué estado está la revisión',
  );
  assert.match(inst, /LO QUE EL DOSSIER NO ACREDITA [^\n]* NO BLOQUEA/);
  assert.match(
    recibirHechos(
      db,
      entrada(n, [{ clave: 'horario_atencion', valor: 'L-V 8:00-18:00', motivo: 'Más horas de atención.' }]),
      'oferta-licitaciones',
      { revisar: true },
    ).error?.message ?? '',
    /Solo se corrigen los hechos que pide la tarea; estos no: horario_atencion\..*Falta la respuesta de: respuesta_consultas/,
  );
  assert.match(
    recibirHechos(
      db,
      entrada(n, [
        { clave: 'respuesta_consultas', valor: 'a acordar con la entidad', motivo: 'Depende de la entidad.' },
      ]),
      'oferta-licitaciones',
      { revisar: true },
    ).error?.message ?? '',
    /aplaza en vez de fijar/,
  );
  const nuevo = '4 horas (urgentes) y 24 horas (resto)';
  const r = recibirHechos(
    db,
    entrada(n, [
      {
        clave: 'respuesta_consultas',
        valor: nuevo,
        motivo: 'El crítico pide prioridades; la ficha fijaba 48 horas para todo.',
      },
    ]),
    'oferta-licitaciones',
    { revisar: true },
  );
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(r.data!.cambiados, ['respuesta_consultas']);
  assert.equal(hechosRecibidos(db, payload), true);
  assert.deepEqual(
    pendientes(n),
    [1, 2, 3, 4],
    'el hecho cambió: el 1 lo usa y se rehace aunque estuviera en el máximo',
  );
  assert.deepEqual(parcheDe(db, n.memoria_id, 1)!.apartados, [1, 2, 3, 4]);
  assert.equal(
    estrategiaDe(db, n.memoria_id)!.datos.hechos.find((h) => h.clave === 'respuesta_consultas')!.valor,
    nuevo,
    'la hoja que copian los apartados',
  );
  const avisos = JSON.parse(
    (db.prepare('SELECT avisos FROM memorias WHERE id = ?').get(n.memoria_id) as { avisos: string }).avisos,
  ) as string[];
  assert.ok(
    avisos.some((a) =>
      /^HECHO CAMBIADO EN LA RONDA 1 \(revísalo antes de presentar\): «respuesta a consultas» pasa de «48 horas» a «4 horas \(urgentes\) y 24 horas \(resto\)»\..*Cambia un valor aprobado en la ficha de solución/.test(
        a,
      ),
    ),
    avisos.join(' | '),
  );

  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.equal(memoriaPorId(n.memoria_id).fase, 'redaccion');
  const red = trabajosDe(TIPO_MEMORIA_REDACCION).at(-1)!;
  assert.equal(red.clave, `memoria-${ID}-v${n.version}-r1`);
  const instRed = instruccionesRedaccion(db, nucleo().db, PayloadRedaccion.parse(JSON.parse(red.payload)));
  assert.match(
    instRed,
    /\nREVISIÓN HUMANA: ficha de solución aprobada por Equipo de pruebas el [^:]+: redacta con estos valores\./,
    'también en la ronda de reescritura',
  );
  assert.match(
    instRed,
    /HECHOS CORREGIDOS EN ESTA RONDA[^\n]*\n- respuesta a consultas: antes «48 horas», ahora «4 horas \(urgentes\) y 24 horas \(resto\)»/,
  );
  const fichaRed = instRed.split('\n').find((l) => l.startsWith('- Soporte · Tiempos de respuesta:'));
  assert.equal(
    fichaRed,
    '- Soporte · Tiempos de respuesta: Respuesta a consultas en 4 horas (urgentes) y 24 horas (resto) (corregido en la ronda 1 por lo que señaló el crítico; antes «Respuesta a consultas en 48 horas»)',
    'la ficha aprobada ya no dice 48 horas mientras la hoja dice otra cosa',
  );
  assert.equal(
    estrategiaDe(db, n.memoria_id)!.datos.solucion!.soporte!.respuesta,
    'Respuesta a consultas en 4 horas (urgentes) y 24 horas (resto)',
    'ni la solución del contrato',
  );
  assert.deepEqual(
    fichaDe(db, n.memoria_id)!.campos.find((c) => c.clave === 'soporte-respuesta')!.ronda,
    { n: 1, antes: 'Respuesta a consultas en 48 horas' },
    'la web lo enseña corregido en la ronda',
  );
  const progreso = progresoDe(db, filaMemoria(db, n.memoria_id)!);
  assert.deepEqual(
    progreso.parches.map((p) => [p.ronda, p.estado, p.cambios.map((c) => c.clave)]),
    [[1, 'recibido', ['respuesta_consultas']]],
  );
});

test('should_not_open_a_patch_when_no_reason_quotes_a_fact', async () => {
  const n = await enCritica();
  const c = CriticaEntrada.parse({
    id: ID,
    memoria_id: n.memoria_id,
    ronda: 0,
    resumen: 'Cifras genéricas.',
    apartados: APARTADOS.map((a, i) => ({
      apartado: i + 1,
      tramo: a.escala.at(-2)!,
      puntos: a.escala.at(-2)!,
      cita: CITA,
      motivos_para_bajar: [MOTIVO],
      falta: [],
    })),
  });
  assert.equal(recibirCritica(db, c, 'critico-licitaciones', { revisar: true }).error, null);
  await avanzarMemoria(nucleo().db, db, n.memoria_id);
  assert.deepEqual([memoriaPorId(n.memoria_id).fase, parcheDe(db, n.memoria_id, 1)], ['redaccion', null]);
});
