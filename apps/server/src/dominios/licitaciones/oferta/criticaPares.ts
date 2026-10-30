// Crítica por pares de las rondas ≥ 1 de la memoria (docs/como-esta-hecho/memoria-tecnica.md, paso 5).
import { z } from 'zod';
import { nombreEmpresa } from '../../../nucleo/empresa.js';
import { emitir } from '../../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { exigirRevision } from '../rechazos.js';
import type { Db } from '../store.js';
import { textoDeChequeos } from './chequeosDocumento.js';
import { chequeosConCoste } from './compromisosMemoriaCoste.js';
import { contextoCoherencia, textoParaCoherencia } from './coherenciaMemoria.js';
import {
  cobertura,
  criteriosDeTramo,
  destinoDeLaCritica,
  guardarCritica,
  instruccionesCritica,
  LEER_HASTA_EL_CIERRE,
  marcasDe,
  paqueteCiego,
  PARTES_PAQUETE,
  problemaDeResumen,
  problemasDeAplazamiento,
  problemasDeCitas,
  problemasDeHueco,
  problemasDeTramo,
  recursoCritica,
  TOOL_PARES,
  totalesDe,
  tramoInferior,
  trozoDelPaquete,
  type CriticaApartado,
  type CriticaRecibida,
  type FilaDeCritica,
  type PayloadCriticaData,
} from './critica.js';
import { apartadosDe, documentoEnMarkdown, filaMemoria, type FilaMemoria } from './ensamblado.js';
import { textoDeDatos, tramoMaximo } from './evaluacionMemoria.js';
import { guionPorId, type GuionGuardado } from './guion.js';
import { datosDeFila } from './fugasMemoria.js';
import { memoriaValorable, puntosTexto } from './guionRevision.js';
import { hallazgosDeCoherencia, obligaARehacer } from './hechos.js';
import { caracteresDe } from './memoriaRevision.js';
import {
  cuotaDeCaracteres,
  filasDeRondas,
  guardaRegresiones,
  obsoletasDe,
  type ResultadoPar,
} from './rondasMemoria.js';

// Con una nota absoluta por ronda, el crítico dio exactamente los mismos tramos (18,75/25) a dos versiones que
// ocho jueces ciegos separaban por 7 puntos: las rondas gastaban cuota sin mover nada. Juzgar por pares sí
// distingue: el crítico recibe la versión conservada y la nueva como «documento_1» y «documento_2», en un orden
// que alterna con la ronda y sin decir cuál es cuál; por apartado dice cuál prefiere y evalúa las dos. La
// plataforma conserva por apartado la preferida (la guarda de regresiones la devuelve al texto) y para cuando la
// nueva no gana en ninguno.
type MemoriaDelGuion = NonNullable<GuionGuardado['datos']['memoria']>;
type ApartadoGuion = MemoriaDelGuion['apartados'][number];
type Doc = 1 | 2;

const EPSILON = 0.01;
const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const Motivo = z.strictObject({ cita: Texto(5, 1500), motivo: Texto(5, 1000), arreglo: Texto(5, 1000) });
const Evaluacion = z.strictObject({
  tramo: z
    .number()
    .min(0)
    .max(1000)
    .describe(
      'Los puntos de uno de los tramos de la escala del apartado para este documento (no valorable: 1 si cumple, 0 si no)',
    ),
  cita: Texto(10, 1500).describe(
    'Frase literal de este documento que justifica su tramo (con «…» entre trozos si la recortas)',
  ),
  motivos_para_bajar: z
    .array(Motivo)
    .max(10)
    .describe('Lo que separa a este documento del tramo siguiente: cita literal suya, motivo y arreglo concreto'),
  falta: z.array(Texto(3, 500)).max(20).describe('Cada «se valorará» que este documento no trata o no concreta'),
});
const CriticaParesDatos = z.strictObject({
  apartados: z
    .array(
      z.strictObject({
        apartado: z.number().int().min(1).max(20),
        preferido: z
          .enum(['1', '2', 'empate'])
          .describe(
            'El documento que puntuaría más la mesa en este apartado; «empate» solo si les daría exactamente lo mismo (siempre, si son idénticos)',
          ),
        documento_1: Evaluacion,
        documento_2: Evaluacion.optional().describe(
          'Obligatorio si los documentos difieren en este apartado; si son idénticos, omítelo',
        ),
        diferencia: Texto(10, 1500)
          .optional()
          .describe('Sin empate: qué hace mejor al preferido y qué tendría que cambiar el otro para ganar'),
      }),
    )
    .min(1)
    .max(20),
  resumen: Texto(10, 3000),
});
export type CriticaParesDatosData = z.infer<typeof CriticaParesDatos>;
type ParApartado = CriticaParesDatosData['apartados'][number];
type EvaluacionDoc = ParApartado['documento_1'];

export const CriticaParesEntrada = CriticaParesDatos.extend({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  memoria_id: z.number().int().positive().describe('Los números que te dio la tarea'),
  ronda: z
    .number()
    .int()
    .min(1)
    .describe('La ronda de la tarea (la 0 se puntúa sola con licitaciones_memoria_critica)'),
});
export type CriticaParesEntradaData = z.infer<typeof CriticaParesEntrada>;

/** El documento que lleva la versión nueva: alterna con la ronda (2 en las impares, 1 en las pares) contra el sesgo de posición. */
export const documentoNuevo = (ronda: number): Doc => (ronda % 2 === 1 ? 2 : 1);

// ── Las dos versiones ──

// anterior: la conservada tras la ronda anterior (con la ronda de su fila); nueva: la de ahora.
export type VersionesPar = {
  nuevo: Doc;
  anterior: { ronda: number; datos: string }[];
  nueva: string[];
  distintos: number[];
};

/** La versión conservada y la nueva de cada apartado, y en cuáles difieren. */
function versionesDelPar(db: Db, m: FilaMemoria, mem: MemoriaDelGuion): VersionesPar {
  const filas = filasDeRondas(db, m.id);
  const { efectivos } = guardaRegresiones(filas, mem, m.ronda - 1, obsoletasDe(db, m.id));
  const actuales = apartadosDe(db, m.id);
  const anterior = mem.apartados.map((_, i) => {
    const e = efectivos.find((x) => x.apartado === i + 1);
    const f = e ? filas.find((x) => x.apartado === i + 1 && x.ronda === e.ronda) : undefined;
    return { ronda: f?.ronda ?? -1, datos: f?.datos ?? actuales.find((x) => x.apartado === i + 1)?.datos ?? 'null' };
  });
  const nueva = anterior.map((a, i) => actuales.find((x) => x.apartado === i + 1)?.datos ?? a.datos);
  const distintos = nueva.flatMap((d, i) => (textoDeDatos(d) !== textoDeDatos(anterior[i]!.datos) ? [i + 1] : []));
  return { nuevo: documentoNuevo(m.ronda), anterior, nueva, distintos };
}

const datosDelDocumento = (v: VersionesPar, doc: Doc): string[] =>
  doc === v.nuevo ? v.nueva : v.anterior.map((x) => x.datos);

// ── Paquete: las partes de siempre y, desde la ronda 1, las dos versiones ──

export const PARTES_CRITICA = [...PARTES_PAQUETE, 'documento_1', 'documento_2'] as const;
export type ParteCritica = (typeof PARTES_CRITICA)[number];

// Cada versión como la verá la mesa (portada, índice, guía, figuras), con sus comprobaciones delante.
function textoDeVersion(db: Db, m: FilaMemoria, mem: MemoriaDelGuion, datos: string[]): string {
  const md =
    documentoEnMarkdown(db, m.id, new Date(), new Map(datos.map((d, i) => [i + 1, d]))) ??
    mem.apartados
      .map(
        (a, i) =>
          `## ${i + 1}. ${a.titulo}\n\n${
            textoDeDatos(datos[i] ?? null)
              .split('\n')
              .slice(1)
              .join('\n') || '[Apartado sin redactar]'
          }`,
      )
      .join('\n\n');
  return `${textoDeChequeos(chequeosConCoste(md))}\n\n${md}`;
}

/** Una parte del paquete ciego del crítico, por trozos; «documento_1» y «documento_2», solo en las rondas por pares. */
export function paqueteCritica(
  db: Db,
  a: { id: string; memoria_id: number; parte: ParteCritica; desde?: number | undefined },
): Result<unknown> {
  const m = filaMemoria(db, a.memoria_id);
  // En una ronda por pares, el texto actual delataría cuál de los dos documentos es el nuevo.
  if ((a.parte === 'documento' || a.parte === 'memoria') && m?.fase === 'critica' && m.ronda > 0)
    return fail(
      'invalid_input',
      `En la ronda ${m.ronda} se comparan dos versiones: lee «documento_1» y «documento_2».`,
    );
  if (a.parte !== 'documento_1' && a.parte !== 'documento_2') return paqueteCiego(db, { ...a, parte: a.parte });
  const mem = m && m.licitacion_id === a.id ? guionPorId(db, m.guion_id)?.datos.memoria : null;
  if (!m || !mem) return fail('not_found', `No hay ninguna memoria con id ${a.memoria_id} en la licitación «${a.id}».`);
  if (m.ronda < 1)
    return fail(
      'invalid_input',
      '«documento_1» y «documento_2» son las dos versiones que se comparan desde la ronda 1; en la ronda 0 lee «documento».',
    );
  const datos = datosDelDocumento(versionesDelPar(db, m, mem), a.parte === 'documento_1' ? 1 : 2);
  return ok({ parte: a.parte, ...trozoDelPaquete(textoDeVersion(db, m, mem, datos), a.desde) });
}

// ── Revisión (pura) ──

export type ContextoPares = { mem: MemoriaDelGuion; textos: [string[], string[]]; distintos: number[] };
// rebajas: «apartado-documento» → tramo con el que se guarda si se acepta sin la cita del tramo.
export type RevisionPares = { duros: string[]; blandos: string[]; rebajas: Map<string, number> };

const claveRebaja = (apartado: number, doc: Doc) => `${apartado}-${doc}`;
const comoApartado = (n: number, e: EvaluacionDoc): CriticaApartado => ({
  apartado: n,
  tramo: e.tramo,
  puntos: e.tramo,
  cita: e.cita,
  motivos_para_bajar: e.motivos_para_bajar,
  falta: e.falta,
});
const evaluaciones = (x: ParApartado): [Doc, EvaluacionDoc][] => [
  [1, x.documento_1],
  ...(x.documento_2 ? [[2, x.documento_2] as [Doc, EvaluacionDoc]] : []),
];
const evaluacionDe = (x: ParApartado, doc: Doc): EvaluacionDoc =>
  doc === 2 && x.documento_2 ? x.documento_2 : x.documento_1;

// Lo propio del par: idénticos en empate, distintos con las dos evaluaciones, y el preferido con su porqué y sin menos tramo.
function problemasDelPar(x: ParApartado, distinto: boolean): string[] {
  const n = x.apartado;
  if (!distinto) {
    const mismo =
      x.preferido === 'empate' && (!x.documento_2 || Math.abs(x.documento_2.tramo - x.documento_1.tramo) < EPSILON);
    return mismo
      ? []
      : [
          `Los dos documentos son idénticos en el apartado ${n}: «empate» y, si evalúas el documento 2, el mismo tramo que el 1.`,
        ];
  }
  if (!x.documento_2)
    return [
      `Los documentos difieren en el apartado ${n}: evalúa también «documento_2» (tramo, cita, motivos y falta).`,
    ];
  if (x.preferido === 'empate') return [];
  const [pref, otro] = x.preferido === '1' ? [x.documento_1, x.documento_2] : [x.documento_2, x.documento_1];
  return [
    ...(pref.tramo < otro.tramo - EPSILON
      ? [
          `En el apartado ${n} prefieres el documento ${x.preferido} y le das un tramo más bajo que al otro: el preferido no puede quedar por debajo.`,
        ]
      : []),
    ...(x.diferencia
      ? []
      : [
          `En el apartado ${n} prefieres el documento ${x.preferido}: di en «diferencia» qué lo hace mejor y qué tendría que cambiar el otro.`,
        ]),
  ];
}

type ProblemasDeEvaluacion = { duros: string[]; blandos: string[]; rebaja: number | null };

// Las mismas reglas que la crítica absoluta, sobre el texto de cada documento.
function problemasDeEvaluacion(
  n: number,
  e: EvaluacionDoc,
  doc: Doc,
  a: ApartadoGuion,
  ctx: ContextoPares,
): ProblemasDeEvaluacion {
  const valorable = memoriaValorable(ctx.mem);
  const x = comoApartado(n, e);
  const maximo = valorable ? tramoMaximo(a) : 1;
  const citas = problemasDeCitas(x, ctx.textos[doc - 1]?.[n - 1] ?? '', maximo);
  const enDoc = (t: string) => t.replace(new RegExp(`apartado ${n}\\b`), `apartado ${n} del documento ${doc}`);
  return {
    duros: [...problemasDeTramo(x, a, valorable), ...problemasDeHueco(x, maximo, valorable)].map(enDoc),
    blandos: [...citas.blandos, ...problemasDeAplazamiento(x)].map(enDoc),
    rebaja: citas.sinCita && valorable ? tramoInferior(a, e.tramo) : null,
  };
}

/** Lo que impide aceptar una crítica por pares: duros siempre; blandos (citas, aplazamientos, resumen), hasta el tercer envío. */
export function revisarPares(c: CriticaParesDatosData, ctx: ContextoPares): RevisionPares {
  const r: RevisionPares = {
    duros: cobertura(
      c.apartados.map((x) => x.apartado),
      ctx.mem.apartados.length,
    ),
    blandos: [],
    rebajas: new Map(),
  };
  const maximos = new Map<number, number>();
  for (const x of c.apartados) {
    const a = ctx.mem.apartados[x.apartado - 1];
    if (!a) continue;
    maximos.set(x.apartado, memoriaValorable(ctx.mem) ? tramoMaximo(a) : 1);
    r.duros.push(...problemasDelPar(x, ctx.distintos.includes(x.apartado)));
    for (const [doc, e] of evaluaciones(x)) {
      const p = problemasDeEvaluacion(x.apartado, e, doc, a, ctx);
      r.duros.push(...p.duros);
      r.blandos.push(...p.blandos);
      if (p.rebaja !== null) r.rebajas.set(claveRebaja(x.apartado, doc), p.rebaja);
    }
  }
  const preferidas = c.apartados.map((x) => comoApartado(x.apartado, evaluacionDe(x, x.preferido === '2' ? 2 : 1)));
  r.blandos.push(...problemaDeResumen({ apartados: preferidas, resumen: c.resumen }, maximos));
  return r;
}

// Aceptada con lo que falte: sin la cita de su tramo, ese documento se guarda un tramo por debajo.
function conRebajas(c: CriticaParesDatosData, r: RevisionPares): { datos: CriticaParesDatosData; avisos: string[] } {
  const avisos: string[] = [];
  const rebajar = (n: number, doc: Doc, e: EvaluacionDoc): EvaluacionDoc => {
    const tramo = r.rebajas.get(claveRebaja(n, doc));
    if (tramo === undefined) return e;
    avisos.push(
      `Apartado ${n}, documento ${doc}: sin cita literal que lo sostenga, se guarda en el tramo ${puntosTexto(tramo)} en vez de ${puntosTexto(e.tramo)}.`,
    );
    return { ...e, tramo };
  };
  const apartados = c.apartados.map((x) => ({
    ...x,
    documento_1: rebajar(x.apartado, 1, x.documento_1),
    ...(x.documento_2 ? { documento_2: rebajar(x.apartado, 2, x.documento_2) } : {}),
  }));
  return { datos: { ...c, apartados }, avisos };
}

// ── Lo que se conserva ──

export type Conservado = { critica: CriticaApartado; fila: FilaDeCritica & { par: ResultadoPar } };
// porExtension: la nueva se reescribió para caber (la anterior pasaba de su cuota y la nueva es
// más corta). El crítico no ve las páginas y prefiere la más completa: restaurarla deshacía el
// recorte y la memoria se entregaba pasada del límite. Solo vuelve si la nueva baja de tramo.
export type OpcionesConservar = { porExtension?: boolean };

/**
 * La versión que se queda en el apartado: la anterior solo si el crítico la prefirió y es
 * restaurable (un parche de hechos no la dejó atrás ni trae contradicciones que la nueva
 * resolvió); reescrita por extensión, solo si la nueva baja de tramo; con empate, la nueva. Pura.
 */
export function conservar(
  x: ParApartado,
  v: VersionesPar,
  anteriorObsoleta = false,
  op: OpcionesConservar = {},
): Conservado {
  const n = x.apartado;
  const gana: ResultadoPar['gana'] =
    x.preferido === 'empate' ? 'empate' : Number(x.preferido) === v.nuevo ? 'nueva' : 'anterior';
  const viejo: Doc = v.nuevo === 1 ? 2 : 1;
  const bajaDeTramo = evaluacionDe(x, viejo).tramo > evaluacionDe(x, v.nuevo).tramo + EPSILON;
  const restaurada = gana === 'anterior' && !anteriorObsoleta && (!op.porExtension || bajaDeTramo);
  const doc: Doc = restaurada ? viejo : v.nuevo;
  const par: ResultadoPar = {
    contra: v.anterior[n - 1]!.ronda,
    gana,
    restaurada,
    ...(x.diferencia ? { diferencia: x.diferencia } : {}),
  };
  return {
    critica: comoApartado(n, evaluacionDe(x, doc)),
    fila: { datos: restaurada ? v.anterior[n - 1]!.datos : v.nueva[n - 1]!, par },
  };
}

// ── Recepción ──

export type CriticaParesRecibida = CriticaRecibida & { ganadas: number; restaurados: number[] };

function anteriorObsoleta(db: Db, m: FilaMemoria, v: VersionesPar): (n: number) => boolean {
  const obsoleta = obsoletasDe(db, m.id);
  return (n) => {
    const a = v.anterior[n - 1]!;
    return obsoleta({ apartado: n, ronda: a.ronda, datos: a.datos, puntos: null, tramo: null, motivos: '{}' }, m.ronda);
  };
}

// El crítico no ve la hoja de hechos: una versión anterior con más contradicciones que obligan a
// rehacer que la nueva las reintroduciría (y, bloqueado el apartado, nadie las corregiría).
function anteriorConMasBloqueantes(db: Db, m: FilaMemoria, v: VersionesPar): (n: number) => boolean {
  const c = contextoCoherencia(db, m);
  if (!c) return () => false;
  const bloqueantes = (n: number, datos: string) => {
    const d = datosDeFila({ estado: 'recibido', datos });
    const textos = Array.from({ length: n }, (_, i) => (i === n - 1 && d ? textoParaCoherencia(d) : ''));
    return hallazgosDeCoherencia(textos, c.hechos, c.op).filter(obligaARehacer).length;
  };
  return (n) => bloqueantes(n, v.anterior[n - 1]!.datos) > bloqueantes(n, v.nueva[n - 1]!);
}

const caracteresDeDatos = (datos: string): number => {
  const d = datosDeFila({ estado: 'recibido', datos });
  return d ? caracteresDe(d.bloques) : 0;
};

// La anterior pasaba de su cuota y la nueva es más corta: se reescribió para caber.
function reescritaPorExtension(db: Db, m: FilaMemoria, v: VersionesPar): (n: number) => boolean {
  const g = guionPorId(db, m.guion_id);
  if (!g?.datos.memoria) return () => false;
  const cuota = cuotaDeCaracteres(db, m, g);
  return (n) => {
    const antes = caracteresDeDatos(v.anterior[n - 1]!.datos);
    return antes > cuota(n) && caracteresDeDatos(v.nueva[n - 1]!) < antes;
  };
}

function guardarPares(
  db: Db,
  d: { m: FilaMemoria; mem: MemoriaDelGuion },
  c: { datos: CriticaParesDatosData; avisos: string[]; agente: string },
  v: VersionesPar,
): CriticaParesRecibida {
  const obsoleta = anteriorObsoleta(db, d.m, v);
  const contradice = anteriorConMasBloqueantes(db, d.m, v);
  const porExtension = reescritaPorExtension(db, d.m, v);
  const conservados = c.datos.apartados.map((x) =>
    conservar(x, v, obsoleta(x.apartado) || contradice(x.apartado), { porExtension: porExtension(x.apartado) }),
  );
  const datos = { apartados: conservados.map((x) => x.critica), resumen: c.datos.resumen, pares: c.datos.apartados };
  const marcas = marcasDe(db, d.m, c.agente);
  const totales = totalesDe(datos, d.mem);
  guardarCritica(
    db,
    d.m,
    { datos, avisos: c.avisos, agente: c.agente, marcas, totales },
    new Map(conservados.map((x) => [x.critica.apartado, x.fila])),
  );
  const ganadas = conservados.filter((x) => x.fila.par.gana === 'nueva').length;
  const restaurados = conservados.filter((x) => x.fila.par.restaurada).map((x) => x.critica.apartado);
  return {
    memoria: d.m.id,
    ronda: d.m.ronda,
    ...totales,
    independiente: marcas.independiente,
    ciega: marcas.ciega,
    avisos: c.avisos,
    ganadas,
    restaurados,
  };
}

/**
 * Revisa y guarda la crítica por pares de una ronda ≥ 1. Como la absoluta: lo duro se rechaza
 * siempre y lo blando hasta el tercer envío (al tercero, sin cita, un tramo por debajo).
 */
export function recibirCriticaPares(
  db: Db,
  e: CriticaParesEntradaData,
  agente: string,
  op: { revisar?: boolean; hoy?: Date } = {},
): Result<CriticaParesRecibida> {
  const d = destinoDeLaCritica(db, e);
  if (d.error) return d;
  const { id: _id, memoria_id: _m, ronda: _r, ...datos } = e;
  const v = versionesDelPar(db, d.data.m, d.data.mem);
  const textos = ([1, 2] as const).map((doc) => datosDelDocumento(v, doc).map(textoDeDatos)) as [string[], string[]];
  const r = revisarPares(datos, { mem: d.data.mem, textos, distintos: v.distintos });
  const exigir = op.revisar === true && exigirRevision(db, TOOL_PARES, recursoCritica(e), op.hoy);
  if (r.duros.length || (exigir && r.blandos.length))
    return fail(
      'invalid_input',
      `${[...r.duros, ...r.blandos].join(' ')} Corrige y vuelve a enviar la crítica entera.`,
    );
  const aceptada = exigir ? { datos, avisos: [] } : conRebajas(datos, r);
  const avisos = [
    ...(exigir ? [] : r.blandos.filter((b) => !/^La cita del apartado \d+ del documento/.test(b))),
    ...aceptada.avisos,
  ];
  const recibida = guardarPares(db, d.data, { datos: aceptada.datos, avisos, agente }, v);
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: e.id,
    datos: { accion: 'critica', version: d.data.m.version, ronda: e.ronda, memoria: e.memoria_id },
  });
  return ok(recibida);
}

// ── Instrucciones ──

// Las rondas convertían «más seguimiento» en sesiones fijas con cada persona: a igual valor, gana lo que cuesta menos ejecutar.
const MENOS_COSTE =
  'A igual valor para la mesa, prefiere la versión que compromete menos coste (menos horas fijas, frecuencias, material físico o presencia que el pliego no exige ni puntúa).';

function pasoDeEvaluacion(valorable: boolean): string {
  const tramo = valorable
    ? '«tramo» (los puntos de uno de los tramos de su escala; el preferido no puede quedar por debajo del otro), «cita» (frase literal de ese documento que justifica el tramo), «motivos_para_bajar» (cada uno con su cita literal de ese documento, el motivo y el arreglo concreto; al menos uno por debajo del tramo máximo y ninguno en el máximo) y «falta» (cada «se valorará» sin tratar o sin concreción)'
    : '«tramo» 1 si cumple el contenido mínimo exigido y 0 si no, «cita» literal de ese documento que lo pruebe y «falta» con lo exigido que no está (obligatoria con tramo 0)';
  return `3. En cada apartado que difiere: «preferido» («1», «2» o «empate» solo si la mesa les daría exactamente lo mismo) y la evaluación de cada documento en «documento_1» y «documento_2»: ${tramo}. Sin empate, «diferencia»: qué hace mejor al preferido y qué tendría que cambiar el otro para ganar. ${MENOS_COSTE}`;
}

function instruccionesPares(db: Db, p: PayloadCriticaData): string {
  const m = filaMemoria(db, p.memoria_id);
  const mem = m ? guionPorId(db, m.guion_id)?.datos.memoria : null;
  const cabecera = `Tarea de la plataforma de ${nombreEmpresa(db)}: eres un vocal técnico de la mesa de contratación, severo, y comparas dos versiones de la memoria técnica (versión ${p.version}, ronda ${p.ronda}) de la licitación ${p.id}. Sigue la skill «licitaciones» (sección «Criticar una memoria (ciego)», comparación por pares).`;
  if (!m || !mem) return [cabecera, '', 'Esta memoria ya no está: no hagas nada y termina.'].join('\n');
  const distintos = m.ronda === p.ronda ? versionesDelPar(db, m, mem).distintos : [];
  return [
    cabecera,
    '',
    `SOLO puedes usar licitaciones_memoria_critica_paquete y ${TOOL_PARES}. Ninguna otra herramienta: ni la oferta, ni el dossier, ni la ficha, ni el equipo, ni evaluaciones anteriores, ni la Biblioteca. La plataforma lo comprueba en la auditoría y una crítica que mire otra cosa no vale.`,
    `1. Lee el paquete entero con licitaciones_memoria_critica_paquete (id=${p.id}, memoria_id=${p.memoria_id}): parte «rubrica», parte «pliego», parte «documento_1» y parte «documento_2» (dos versiones de la misma memoria como las verá la mesa, cada una con sus comprobaciones automáticas delante), cada una por trozos («desde» = «siguiente») hasta «siguiente» = null. ${LEER_HASTA_EL_CIERRE} No se dice cuál de las dos es más reciente ni importa: juzga solo cuál puntuaría más la mesa. Cada comprobación automática es un defecto del documento donde está. Las citas, del texto de los apartados de cada documento.`,
    `2. ${distintos.length ? `Los documentos solo difieren en los apartados ${distintos.join(', ')}: en los demás pon «empate» y evalúa solo «documento_1».` : 'Los dos documentos son idénticos: «empate» en todos los apartados y evalúa solo «documento_1».'} Empieza cada evaluación en el tramo más bajo de la escala y súbela solo con una cita literal que lo pruebe; compara con lo que escribiría el mejor competidor posible.`,
    pasoDeEvaluacion(memoriaValorable(mem)),
    `4. ${criteriosDeTramo(mem)}`,
    `5. Envía ${TOOL_PARES} con id=${p.id}, memoria_id=${p.memoria_id}, ronda=${p.ronda}, los apartados y un resumen (no digas «máximo» si algún apartado no lo es). Si responde con un error, corrige exactamente lo que dice y reenvía la crítica entera.`,
    'No hagas nada más: no reescribas la memoria y no respondas en ningún canal.',
  ].join('\n');
}

/** Instrucciones del run del crítico: absoluta en la ronda 0 y por pares desde la 1. */
export const instruccionesDeLaCritica = (db: Db, p: PayloadCriticaData): string =>
  p.ronda > 0 ? instruccionesPares(db, p) : instruccionesCritica(db, p);
