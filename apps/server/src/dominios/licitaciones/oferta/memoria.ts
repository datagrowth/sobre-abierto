// Memoria técnica: una persona la pide y la plataforma la lleva por sus fases (avanceMemoria.ts).
import { apuntarAlRecibir } from './leccionesAplicadas.js';
import fs from 'node:fs';
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { documentoEnDisco, raicesActuales } from '../../../nucleo/salidas.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { trabajoEnCurso, type EnCurso } from '../../../nucleo/colaConsultas.js';
import { fichasDe } from '../ficha.js';
import {
  apartadosMejorables,
  evaluacionDeMemoria,
  evaluacionEnCurso,
  resumenEvaluacionMemoria,
  type ResumenEvaluacionMemoria,
} from '../propuestas/evaluacion.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import {
  decisionesDe,
  decisionesVigentes,
  lotesDecididos,
  presupuestosDeLotes,
  type DecisionesData,
} from './decisiones.js';
import { leerPerfilEmpresa, municipioDe, zonaEmpresa } from '../../../nucleo/empresa.js';
import {
  apartadosDe,
  AVISO_SIN_PERFIL,
  filaMemoria,
  PREFIJO_AVISO_FIRMA,
  type FilaApartado,
  type FilaMemoria,
} from './ensamblado.js';
import { anonimatoDeMemoria, type AnonimatoMemoria } from './anonimato.js';
import { coherenciaDeApartado, textoParaCoherencia } from './coherenciaMemoria.js';
import {
  DependenciasApartado,
  dependenciasDeApartado,
  huellaApartadoGuion,
  type ContextoDependencias,
} from './dependencias.js';
import { progresoDe, type ProgresoMemoria } from './progresoMemoria.js';
import { contextoDeFugas } from './fugas.js';
import {
  fugasDeMemoria,
  nombresDelEquipo,
  nombresPropiosDe,
  type AnulacionFugas,
  type FugaEnMemoria,
} from './fugasMemoria.js';
import { cambiosEntre, guionDeOtrosLotes, guionPorId, guionVigente, TIPO_GUION, type GuionGuardado } from './guion.js';
import { apartadosCompatibles } from './guionDiff.js';
import { maximosPorLote, type MaximoLote } from './guionLotes.js';
import { memoriaValorable } from './guionRevision.js';
import { decisionesDelLote, lotesDeMemoria } from './memoriaLote.js';
import { leccionesDe, TIPO_LECCIONES, type Leccion } from './lecciones.js';
import { objetivoDeApartado } from './estrategia.js';
import {
  ApartadoDatos,
  type ApartadoDatosData,
  caracteresDe,
  cuotaDeApartado,
  cuotaDeObjetivo,
  cuotaIgual,
  erroresDeFiguras,
  figurasMaximas,
  paginasEstimadasDe,
  reservaDeGuia,
  revisarApartado,
  type ContextoApartado,
} from './memoriaRevision.js';
import { exigirRevision } from '../rechazos.js';
import { DURACION_MIN, guardaPlazo, plazoDe, textoPlazo } from './plazo.js';
import { cierreDe, ofertaCerrada } from './memoriaPresentada.js';

export { nombresPropiosDe } from './fugasMemoria.js';

// Se pide con guion y decisiones. Hermes envía los apartados con licitaciones_memoria_apartado, el código los
// revisa (memoriaRevision.ts) y la ensambla (ensamblado.ts). Una memoria es una versión: si hay que rehacerla,
// se pide la siguiente, o se actualiza (actualizarMemoria.ts): la siguiente rehace solo los apartados que lo
// piden.
const Numero = z.number().int().positive();
export const ApartadoEntrada = ApartadoDatos.extend({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  memoria_id: Numero.describe('Los números que te dio la tarea'),
  guion_id: Numero,
  version: Numero,
  apartado: Numero.describe('Número del apartado (1 = el primero del guion)'),
});
export type ApartadoEntradaData = z.infer<typeof ApartadoEntrada>;

// Con la ronda: una ronda no hereda los rechazos de la anterior.
export const recursoApartado = (a: { id: string; version: number; apartado: number }, ronda = 0) =>
  `${a.id}#v${a.version}#a${a.apartado}${ronda ? `#r${ronda}` : ''}`;

/** La ronda de reescritura en que está una memoria (0 si no existe). */
export const rondaDeMemoria = (db: Db, memoriaId: number): number => filaMemoria(db, memoriaId)?.ronda ?? 0;

/**
 * La rúbrica, la cuota y lo que se vigila (fugas.ts) del apartado `n` (1-based) de un guion. Con
 * las decisiones se vigila también lo que la empresa ha ofrecido en los criterios automáticos.
 */
export function contextoDeApartado(
  g: GuionGuardado,
  n: number,
  nombres: { propios?: string[]; equipo?: string[] } = {},
  decisiones: Pick<DecisionesData, 'automaticos' | 'herramientas'> | null = null,
  reservadas = 0,
  objetivo: number | null = null,
): ContextoApartado | null {
  const mem = g.datos.memoria;
  const a = mem?.apartados[n - 1];
  if (!mem || !a) return null;
  const total = mem.apartados.reduce((s, x) => s + x.puntos, 0);
  // Sin límite de páginas, lo pone su estrategia (objetivo); con límite, manda el pliego.
  const deEstrategia = mem.limite_paginas === null && objetivo !== null ? cuotaDeObjetivo(objetivo) : null;
  const cuota =
    deEstrategia ??
    (memoriaValorable(mem)
      ? cuotaDeApartado(mem.limite_paginas, a.puntos, total, reservadas)
      : cuotaIgual(mem.limite_paginas, mem.apartados.length, reservadas));
  const vigilado = contextoDeFugas({
    guion: g.datos,
    decididos: decisiones?.automaticos,
    herramientas: decisiones?.herramientas,
    nombresPropios: nombres.propios ?? [],
    equipo: nombres.equipo,
  });
  return { ...vigilado, apartado: a, cuota };
}

// Lo pide una persona: con poco margen hasta el plazo, solo si lo confirma. duracionMin: lo que
// tarda si no es lo típico (una mejora de pocos apartados); ensayo: con el plazo ya vencido a
// propósito (comprobarEnsayo), así que no se mira.
// aMano: false para lo que pide la cadena sola: sin el aviso «plazo_justo», que solo puede confirmar una persona.
export type PedidoMemoria = {
  tipo?: 'memoria' | 'mejora';
  confirmado?: boolean | undefined;
  duracionMin?: number | undefined;
  ensayo?: boolean;
  aMano?: boolean;
  ahoraMs?: number | undefined;
};

/**
 * Lo que tiene que estar antes de redactar, en este orden (cada fallo dice qué hacer): también
 * que dé tiempo antes del plazo a una memoria nueva o a la mejora de una. Devuelve el guion vigente.
 */
export function comprobarPedido(
  dbNucleo: DbNucleo,
  dbLic: Db,
  salidasDir: string | null,
  id: string,
  pedido: PedidoMemoria = {},
): Result<GuionGuardado> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const plazo = pedido.ensayo
    ? ok(null)
    : guardaPlazo(dbLic, id, pedido.tipo ?? 'memoria', {
        aMano: pedido.aMano ?? true,
        confirmado: pedido.confirmado,
        duracionMin: pedido.duracionMin,
        ahoraMs: pedido.ahoraMs,
      });
  if (plazo.error) return plazo;
  if (!salidasDir) return fail('no_configurado', 'Falta SALIDAS_DIR en el servidor: la memoria se guarda en Salidas.');
  if (!fichasDe(dbLic, id).aprobada)
    return fail(
      'invalid_input',
      'Esta licitación aún no tiene ficha: la memoria se redacta a partir de sus criterios.',
    );
  const guion = guionVigente(dbLic, id);
  if (!guion) return fail('invalid_input', 'Esta licitación aún no tiene guion de la oferta: pídelo primero.');
  if (!guion.datos.memoria)
    return fail('invalid_input', 'El guion de la oferta no trae memoria técnica: este pliego no pide redactarla.');
  if (guionDeOtrosLotes(dbLic, guion))
    return fail(
      'conflicto',
      `El guion se extrajo para los lotes ${(guion.datos.lotes ?? []).join(', ')} y los de interés han cambiado: vuelve a extraerlo del pliego.`,
    );
  const d = decisionesVigentes(dbLic, dbNucleo, id);
  if (!d.decisiones)
    return fail(
      'conflicto',
      'Fija primero las decisiones de la oferta (equipo, criterios automáticos, herramientas, lotes y precio): sin ellas no se redacta.',
    );
  if (d.guion_cambiado) {
    const fijadas = guionPorId(dbLic, d.decisiones.guion_id)?.version ?? '?';
    return fail(
      'conflicto',
      `Las decisiones se fijaron con el guion v${fijadas} y el vigente es el v${guion.version}: revísalas y guárdalas otra vez.`,
    );
  }
  if (d.problemas.length) return fail('conflicto', `Revisa las decisiones de la oferta: ${d.problemas.join(' ')}`);
  return ok(guion);
}

// lote: de qué lote es si el pliego pide una memoria por lote (memoriaLote.ts); null = común.
type MemoriaPedida = {
  memoria: number;
  version: number;
  apartados: number;
  ensayo: boolean;
  lote: string | null;
};
// Las de todos los lotes pedidos; arriba, los campos de la primera (lo que se devolvía antes de las memorias por lote).
export type MemoriasPedidas = MemoriaPedida & { memorias: MemoriaPedida[] };

/** La versión que toca a la próxima memoria de la licitación (la primera es la 1). */
export const siguienteVersion = (dbLic: Db, id: string): number =>
  ((dbLic.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(id) as { v: number | null })
    .v ?? 0) + 1;

// Empieza en la fase del dossier, con los apartados pendientes y sin trabajos: los encola su
// máquina de estados (avanceMemoria.ts) cuando llega la redacción.
function crearMemoria(
  dbLic: Db,
  id: string,
  guion: GuionGuardado,
  c: { ensayo: boolean; lote: string | null; automatica: boolean },
): MemoriaPedida {
  const total = guion.datos.memoria!.apartados.length;
  return dbLic.transaction(() => {
    const version = siguienteVersion(dbLic, id);
    const memoria = Number(
      dbLic
        .prepare(
          `INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, fase, ensayo, lote, por_agente)
      VALUES (?, ?, ?, 'redactando', ?, 'dossier', ?, ?, ?)`,
        )
        .run(id, guion.id, version, new Date().toISOString(), c.ensayo ? 1 : 0, c.lote, c.automatica ? 1 : 0)
        .lastInsertRowid,
    );
    const fila = dbLic.prepare(
      "INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (?, ?, 'pendiente')",
    );
    for (let n = 1; n <= total; n += 1) fila.run(memoria, n);
    return { memoria, version, apartados: total, ensayo: c.ensayo, lote: c.lote };
  })();
}

// ensayo: una memoria para medir el método contra la presentada (comprobarEnsayo). automatica: la
// pide la cadena sola (cadena.ts), sin nadie que confirme un plazo justo.
// lote: solo la memoria de ese lote, si el pliego pide una por lote; sin él, la de cada lote.
export type OpcionesPedido = {
  confirmado?: boolean | undefined;
  ensayo?: boolean | undefined;
  automatica?: boolean | undefined;
  ahoraMs?: number | undefined;
  lote?: string | undefined;
};

/**
 * Una memoria de ensayo sirve para medir el método contra la memoria que se presentó, en
 * una oferta presentada de referencia: solo con el plazo ya vencido (con la oferta viva, la memoria de
 * verdad se pide normal) y confirmándolo, porque no cambia nada de lo presentado.
 */
function comprobarEnsayo(dbLic: Db, id: string, confirmado: boolean, ahoraMs = Date.now()): Result<null> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const p = plazoDe(dbLic, id);
  if (!p || p.vence > ahoraMs) {
    const cuando = p ? `vence ${textoPlazo(p.fecha, zonaEmpresa(dbLic))}` : 'no tiene plazo conocido';
    return fail(
      'ensayo_en_plazo',
      `La memoria de ensayo es solo para ofertas con el plazo vencido y esta ${cuando}: pide la memoria normal.`,
    );
  }
  if (!confirmado)
    return fail(
      'ensayo_sin_confirmar',
      'La memoria de ensayo se redacta para compararla con la presentada: no cambia lo presentado ni la memoria dada por buena, y sus archivos llevan «-ensayo». Confírmalo para pedirla.',
    );
  return ok(null);
}

// Lo que tardan `n` memorias (minutos); undefined con una: la duración típica de su tipo.
const duracionDe = (n: number): number | undefined => (n > 1 ? DURACION_MIN.memoria * n : undefined);

/**
 * Los lotes a los que va cada memoria pedida: con memoria por lote, el pedido o todos los
 * decididos; si no, una sola común (null).
 */
const lotesConMemoriaPropia = (dbLic: Db, g: GuionGuardado): string[] | null =>
  lotesDeMemoria(
    g.datos,
    lotesDecididos(dbLic, g.licitacion_id, decisionesDe(dbLic, g.licitacion_id)?.datos.lotes ?? []),
  );

function lotesDelPedido(
  dbLic: Db,
  g: GuionGuardado,
  op: Pick<OpcionesPedido, 'lote' | 'automatica'>,
): Result<(string | null)[]> {
  const { lote } = op;
  const lotes = lotesConMemoriaPropia(dbLic, g);
  // La cadena pide solo los lotes que aún no tienen la suya: la de otro lote no los cubre.
  if (lote === undefined && op.automatica && lotes) {
    const faltan = lotesSinCubrir(dbLic, g);
    return faltan.length ? ok(faltan) : fail('conflicto', 'Cada lote ya tiene su memoria.');
  }
  if (lote === undefined) return ok(lotes ?? [null]);
  if (!lotes)
    return fail(
      'invalid_input',
      `El pliego pide una sola memoria para toda la oferta: pídela sin lote (no la del lote «${lote}»).`,
    );
  if (!lotes.includes(lote))
    return fail(
      'invalid_input',
      `El lote «${lote}» no es de esta oferta: las memorias son de los lotes ${lotes.join(', ')}.`,
    );
  return ok([lote]);
}

// automatica: la pide la cadena sola; queda marcada (por_agente) para que ninguna de sus fases
// levante el freno de su tipo, no solo el primer pedido.
type PedidoDeLote = {
  dbLic: Db;
  guion: GuionGuardado;
  ensayo: boolean;
  automatica: boolean;
};

const enCursoDe = (dbLic: Db, id: string, ensayo: boolean, lote: string | null) =>
  dbLic
    .prepare(
      "SELECT id, version FROM memorias WHERE licitacion_id = ? AND estado = 'redactando' AND ensayo = ? AND lote IS ? ORDER BY version DESC LIMIT 1",
    )
    .get(id, ensayo ? 1 : 0, lote) as { id: number; version: number } | undefined;

// Cuántas memorias empieza el pedido (las que ya se redactan se devuelven, no se rehacen): con
// memoria por lote, la guarda de plazo mide todas. Con algo que no cuadra, 1: el error sale después.
function memoriasNuevas(dbLic: Db, id: string, op: OpcionesPedido): number {
  const g = guionVigente(dbLic, id);
  if (!g?.datos.memoria) return 1;
  const lotes = lotesDelPedido(dbLic, g, op);
  if (lotes.error) return 1;
  return Math.max(1, lotes.data.filter((lote) => !enCursoDe(dbLic, id, op.ensayo === true, lote)).length);
}

// La que ya se redacta de ese lote (y del mismo tipo, de ensayo o no) o una versión nueva.
function pedirDeLote(p: PedidoDeLote, lote: string | null): MemoriaPedida {
  const id = p.guion.licitacion_id;
  const enCurso = enCursoDe(p.dbLic, id, p.ensayo, lote);
  if (enCurso)
    return {
      memoria: enCurso.id,
      version: enCurso.version,
      apartados: apartadosDe(p.dbLic, enCurso.id).length,
      ensayo: p.ensayo,
      lote,
    };
  const r = crearMemoria(p.dbLic, id, p.guion, { ensayo: p.ensayo, lote, automatica: p.automatica });
  const extra = { ...(p.ensayo ? { ensayo: true } : {}), ...(lote !== null ? { lote } : {}) };
  emitir(p.dbLic, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: id,
    datos: { accion: 'pedida', version: r.version, apartados: r.apartados, memoria: r.memoria, ...extra },
  });
  return r;
}

/**
 * Pide la memoria (versión nueva) o, si ya hay una redactándose del mismo tipo (de ensayo o no) y
 * lote, devuelve esa. Si el pliego pide una memoria por lote, una por cada lote decidido (o solo
 * la de `op.lote`).
 */
export function pedirMemoria(
  dbNucleo: DbNucleo,
  dbLic: Db,
  salidasDir: string | null,
  id: string,
  op: OpcionesPedido = {},
): Result<MemoriasPedidas> {
  const ensayo = op.ensayo === true;
  if (ensayo) {
    const e = comprobarEnsayo(dbLic, id, op.confirmado === true);
    if (e.error) return e;
  }
  const nuevas = memoriasNuevas(dbLic, id, op);
  const guion = comprobarPedido(dbNucleo, dbLic, salidasDir, id, {
    tipo: 'memoria',
    confirmado: op.confirmado,
    ensayo,
    aMano: op.automatica !== true,
    ahoraMs: op.ahoraMs,
    duracionMin: duracionDe(nuevas),
  });
  if (guion.error) return guion;
  const lotes = lotesDelPedido(dbLic, guion.data, op);
  if (lotes.error) return lotes;
  const memorias = lotes.data.map((lote) =>
    pedirDeLote({ dbLic, guion: guion.data, ensayo, automatica: op.automatica === true }, lote),
  );
  return ok({ ...memorias[0]!, memorias });
}

/** Licitaciones con una memoria de ensayo redactándose: la cadena relanza sus trabajos colgados aunque su plazo haya vencido. */
export function licitacionesConEnsayo(db: Db): string[] {
  return (
    db
      .prepare("SELECT DISTINCT licitacion_id AS id FROM memorias WHERE ensayo = 1 AND estado = 'redactando'")
      .all() as { id: string }[]
  ).map((f) => f.id);
}

// Una memoria que ya cubre el guion vigente (las de ensayo no cuentan: no son la memoria de la
// oferta): una de ese guion en cualquier estado (una que falló no se vuelve a pedir sola, gastaría
// cuota en bucle; la rehace una persona), una que se está redactando o ensamblando, de cualquier
// guion (al terminar pasa al vigente si sus cambios no la tocan, rebase.ts), o una ensamblada de un
// guion anterior con los apartados compatibles: una versión nueva (actualizarMemoria.ts) rehace
// solo los que cambiaron en vez de una memoria entera de hasta 3 h.
type FilaCobertura = { guion_id: number; estado: string; lote: string | null };

function cubre(dbLic: Db, m: FilaCobertura, guionId: number): boolean {
  if (m.guion_id === guionId || m.estado === 'redactando' || m.estado === 'ensamblando') return true;
  if (m.estado !== 'ensamblada') return false;
  const c = cambiosEntre(dbLic, m.guion_id, guionId);
  return c !== null && apartadosCompatibles(c);
}

// Con memoria por lote, cada lote solo lo cubre una memoria de ese lote (ni la común ni la de
// otro lote); si no, cualquiera. Devuelve lo que falta: los lotes sin la suya, [null] sin memoria
// común. Un lote cerrado (su presentada, o la oferta presentada) nunca falta: lo entregado no se
// vuelve a redactar aunque la presentada sea de otro guion o se subiera sin guion (guion_id 0).
function lotesSinCubrir(dbLic: Db, g: GuionGuardado): (string | null)[] {
  const filas = dbLic
    .prepare('SELECT guion_id, estado, lote FROM memorias WHERE licitacion_id = ? AND ensayo = 0')
    .all(g.licitacion_id) as FilaCobertura[];
  const lotes = lotesConMemoriaPropia(dbLic, g);
  const cerrado = cierreDe(dbLic, g.licitacion_id);
  if (!lotes) return cerrado(null) || filas.some((m) => cubre(dbLic, m, g.id)) ? [] : [null];
  return lotes.filter((lote) => !cerrado(lote) && !filas.some((m) => m.lote === lote && cubre(dbLic, m, g.id)));
}

/**
 * ¿Toca que la cadena pida sola la memoria? Con guion vigente que trae memoria, la
 * oportunidad en preparación y las decisiones sobre ese guion y sin problemas, si ninguna memoria
 * lo cubre ya. Una de otro guion con apartados distintos o que no se sabe qué cambió no lo cubre.
 */
export function memoriaAutoQueToca(dbLic: Db, dbNucleo: DbNucleo, id: string): boolean {
  const guion = guionVigente(dbLic, id);
  if (!guion?.datos.memoria) return false;
  const op = dbLic.prepare('SELECT estado FROM oportunidades WHERE licitacion_id = ?').get(id) as
    { estado: string } | undefined;
  if (op?.estado !== 'en_preparacion' || !lotesSinCubrir(dbLic, guion).length) return false;
  const d = decisionesVigentes(dbLic, dbNucleo, id);
  return d.decisiones !== null && !d.guion_cambiado && d.problemas.length === 0;
}

type Destino = { memoria: FilaMemoria; contexto: ContextoApartado };

// Solo se acepta lo que la tarea pide («pendiente»): reenviar uno ya recibido, o el
// que la guarda de regresiones restauró, pisaría su mejor versión.
function esperado(db: Db, memoriaId: number, apartado: number): boolean {
  const a = db
    .prepare('SELECT estado FROM memoria_apartados WHERE memoria_id = ? AND apartado = ?')
    .get(memoriaId, apartado) as { estado: string } | undefined;
  return a?.estado === 'pendiente';
}

// El apartado debe ir a la memoria y la versión que dio la tarea, y esa memoria seguir abierta.
function destinoDelApartado(db: Db, e: ApartadoEntradaData): Result<Destino> {
  const m = filaMemoria(db, e.memoria_id);
  if (!m || m.licitacion_id !== e.id)
    return fail('not_found', `No hay ninguna memoria con id ${e.memoria_id} en la licitación «${e.id}».`);
  if (m.guion_id !== e.guion_id || m.version !== e.version)
    return fail(
      'invalid_input',
      `Esa memoria es la v${m.version} con el guion ${m.guion_id}; envía los números que te dio la tarea.`,
    );
  if (m.estado !== 'redactando')
    return fail(
      'invalid_input',
      `Esa memoria ya está ensamblada (v${m.version}): si hay que rehacer un apartado, el equipo pedirá la v${m.version + 1}.`,
    );
  if (m.fase !== 'redaccion')
    return fail(
      'invalid_input',
      `Esa memoria está en la fase «${m.fase ?? '?'}», no en la de redacción: envía los apartados solo cuando la tarea te lo pida.`,
    );
  const guion = guionPorId(db, m.guion_id);
  const total = guion?.datos.memoria?.apartados.length ?? 0;
  if (e.apartado > total)
    return fail('invalid_input', `La memoria tiene ${total} apartados: «apartado» va de 1 a ${total}.`);
  if (!esperado(db, m.id, e.apartado))
    return fail('invalid_input', `El apartado ${e.apartado} no se reescribe en esta ronda: no lo reenvíes.`);
  // La memoria de un lote solo vigila lo decidido para su lote (memoriaLote.ts).
  const d = decisionesDe(db, e.id)?.datos;
  const decisiones = d ? decisionesDelLote(d, m.lote ?? null) : null;
  const contexto = guion
    ? contextoDeApartado(
        guion,
        e.apartado,
        { propios: nombresPropiosDe(db, e.id), equipo: nombresDelEquipo(db, e.id) },
        decisiones,
        reservaDeGuia(guion.datos.memoria),
        objetivoDeApartado(db, m, e.apartado),
      )
    : null;
  if (!contexto) return fail('invalid_input', `La memoria tiene ${total} apartados: «apartado» va de 1 a ${total}.`);
  return ok({ memoria: m, contexto });
}

function rechazar(db: Db, e: ApartadoEntradaData, problemas: string[]): Result<never> {
  const mensaje = `${problemas.join(' ')} Corrige y vuelve a enviar el apartado entero.`;
  db.prepare(
    'UPDATE memoria_apartados SET rechazos = rechazos + 1, error = ? WHERE memoria_id = ? AND apartado = ?',
  ).run(mensaje, e.memoria_id, e.apartado);
  return fail('invalid_input', mensaje);
}

// Una imagen solo puede ser una de las guardadas al subir una versión de esta licitación (su
// carpeta de Salidas) y tiene que seguir ahí: no se inventa ni se trae de otra oferta.
function erroresDeImagenes(db: Db, e: ApartadoEntradaData): string | null {
  const imgs = e.bloques.flatMap((b, i) => (b.imagen ? [{ bloque: i + 1, ruta: b.imagen.ruta }] : []));
  if (!imgs.length) return null;
  const l = db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(e.id) as
    { id: string; expediente: string } | undefined;
  const carpeta = l ? `${carpetaSalidas(l)}/` : null;
  const raices = raicesActuales();
  const existe = (ruta: string) => {
    const a = documentoEnDisco(raices, ruta);
    return !a.error && fs.existsSync(a.data);
  };
  const malas = imgs.filter((x) => !carpeta || !x.ruta.startsWith(carpeta) || !existe(x.ruta));
  if (!malas.length) return null;
  return `Estas imágenes no son de una versión subida a mano de esta licitación o ya no están: ${malas.map((x) => `«${x.ruta}» (bloque ${x.bloque})`).join(', ')}. Usa la ruta que trae el texto anterior, tal cual, o quita la imagen.`;
}

export type ApartadoRecibido = {
  memoria: number;
  version: number;
  apartado: number;
  estado: 'recibido';
  recibidos: number;
  total: number;
  caracteres: number;
  paginas_estimadas: number;
  avisos: string[];
};

function guardarApartado(
  db: Db,
  e: ApartadoEntradaData,
  r: { avisos: string[]; agente: string },
): { caracteres: number; paginas: number; recibidos: number; total: number } {
  const { id: _id, memoria_id, guion_id: _g, version: _v, apartado, ...datos } = e;
  const caracteres = caracteresDe(datos.bloques);
  const paginas = paginasEstimadasDe(caracteres);
  db.prepare(
    `UPDATE memoria_apartados SET estado = 'recibido', datos = ?, caracteres = ?, paginas_estimadas = ?, avisos = ?, agente = ?, recibido_en = ?, error = NULL
    WHERE memoria_id = ? AND apartado = ?`,
  ).run(
    JSON.stringify(datos),
    caracteres,
    paginas,
    JSON.stringify(r.avisos),
    r.agente,
    new Date().toISOString(),
    memoria_id,
    apartado,
  );
  const filas = apartadosDe(db, memoria_id);
  const recibidos = filas.filter((a) => a.estado === 'recibido').length;
  return {
    caracteres,
    paginas,
    recibidos,
    total: filas.length,
  };
}

export type OpcionesApartado = { revisar?: boolean; hoy?: Date };

// La revisión del apartado y su coherencia con la hoja de hechos: un nombre del equipo cuando va
// por roles es duro; una contradicción, blanda; una herramienta ajena, aviso.
function revision(
  db: Db,
  e: ApartadoEntradaData,
  d: Destino,
): { duros: string[]; blandos: string[]; avisos: string[] } {
  const { duros, blandos } = revisarApartado(e, d.contexto, true);
  const c = coherenciaDeApartado(db, d.memoria, e.apartado, e);
  return {
    duros: [...duros, ...c.duros],
    blandos: [...blandos, ...c.blandos],
    avisos: c.avisos,
  };
}

/**
 * Revisa y guarda un apartado. Con `revisar` (la tool) rechaza con frases concretas hasta el
 * tercer envío, que entra con lo que falte como aviso. Una fuga al archivo de los automáticos o
 * de la oferta económica excluiría la oferta: se rechaza siempre (un eco, que es una sospecha,
 * entra como aviso; un nombre del equipo cuando va por roles también se rechaza siempre).
 */
export function recibirApartado(
  db: Db,
  e: ApartadoEntradaData,
  agente: string,
  op: OpcionesApartado = {},
): Result<ApartadoRecibido> {
  const d = destinoDelApartado(db, e);
  if (d.error) return d;
  const figuras = erroresDeFiguras(e.bloques, figurasMaximas(d.data.contexto.apartado)) ?? erroresDeImagenes(db, e);
  if (figuras) return rechazar(db, e, [figuras]);
  const { duros, blandos, avisos: siempre } = revision(db, e, d.data);
  const exigir =
    op.revisar === true &&
    exigirRevision(db, 'licitaciones_memoria_apartado', recursoApartado(e, d.data.memoria.ronda), op.hoy);
  if (duros.length || (exigir && blandos.length)) return rechazar(db, e, [...duros, ...blandos]);
  const avisos = [...(exigir ? [] : blandos), ...siempre];
  const g = guardarApartado(db, e, { avisos, agente });
  anotarDependencias(db, d.data.memoria, e.apartado, e);
  apuntarAlRecibir(db, e.memoria_id, e.apartado);
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: e.id,
    datos: {
      accion: 'apartado',
      version: e.version,
      apartado: e.apartado,
      recibidos: g.recibidos,
      total: g.total,
      memoria: e.memoria_id,
    },
  });
  // No se ensambla al llegar el último: antes pasa por la coherencia y el crítico (avanceMemoria.ts).
  return ok({
    memoria: e.memoria_id,
    version: e.version,
    apartado: e.apartado,
    estado: 'recibido',
    recibidos: g.recibidos,
    total: g.total,
    caracteres: g.caracteres,
    paginas_estimadas: g.paginas,
    avisos,
  });
}

/** Apartados cuyo trabajo falló del todo (o se canceló): quedan «fallido» y la fase de redacción decide si reintenta. */
export function marcarApartadosFallidos(db: Db): number {
  return db
    .prepare(
      `UPDATE memoria_apartados SET estado = 'fallido',
      error = COALESCE(error, 'El trabajo de IA no dejó el apartado: ' || COALESCE((SELECT substr(t.error, 1, 300) FROM nucleo.trabajos_ia t WHERE t.id = memoria_apartados.trabajo_id), 'falló.'))
    WHERE estado = 'pendiente'
      AND trabajo_id IN (SELECT id FROM nucleo.trabajos_ia WHERE estado IN ('fallido', 'cancelado'))
      AND memoria_id IN (SELECT id FROM memorias WHERE estado = 'redactando')`,
    )
    .run().changes;
}

// ── Estado para la web y las tools ──

type BorradorMemoria = {
  id: number;
  ruta: string;
  ruta_pdf: string | null;
  ruta_md: string | null;
  estado: string;
  paginas: number | null;
  paginas_estimadas: number | null;
};
type ApartadoEstado = {
  apartado: number;
  titulo: string;
  puntos: number;
  estado: FilaApartado['estado'];
  trabajo: EnCurso | null;
  rechazos: number;
  error: string | null;
  caracteres: number | null;
  paginas_estimadas: number | null;
  avisos: string[];
  compromisos: { que: string; quien: string; cuando_o_medida: string }[];
};
export type EstadoMemoria = {
  id: number;
  version: number;
  guion_id: number;
  estado: FilaMemoria['estado'];
  pedida_en: string;
  ensamblada_en: string | null;
  borrador: BorradorMemoria | null;
  apartados: ApartadoEstado[];
  paginas: number | null;
  paginas_estimadas: number | null;
  limite_paginas: number | null;
  avisos: string[];
  guion_cambiado: boolean;
  error: string | null;
  // false si el pliego la exige sin puntuarla: no tiene nota ni se evalúa.
  valorable: boolean;
  // Lo que delata el archivo de los automáticos o de la oferta económica, con lo decidido ahora;
  // anulada: quien la dio por buena igualmente y por qué.
  fugas: { hallazgos: FugaEnMemoria[]; anulada: AnulacionFugas | null };
  // Si el pliego (guion vigente) pide el equipo sin nombres, qué apartados nombran a cuántas
  // personas; sin los nombres, porque también lo lee licitaciones_oferta. Null si no está ensamblada.
  anonimato: AnonimatoMemoria | null;
  // Dossier, estrategia, redacción entera, crítico y rondas; null en una versión subida a mano.
  progreso: ProgresoMemoria | null;
  // De ensayo: pedida con el plazo vencido para medirla contra la presentada; no es la de la oferta.
  ensayo: boolean;
  // De qué lote es si el pliego pide una memoria por lote; null = común.
  lote: string | null;
  // La que se entregó, subida tal cual (memoriaPresentada.ts): LA memoria de la oferta; sustituida, si otra presentada la reemplazó.
  presentada: boolean;
  presentada_sustituida: boolean;
  // Subida a mano sin los títulos del guion (subidaFlexible.ts): entera, sin «Pedir cambios».
  sin_repartir: boolean;
} & EvaluacionDeEstado;
// La autoevaluación con la escala del guion y la mejora de la que sale (si sale de otra).
type EvaluacionDeEstado = {
  evaluacion: ResumenEvaluacionMemoria | null;
  evaluacion_en_curso: EnCurso | null;
  mejorable: number[];
  // subida: nombre del Word si la subió una persona (version_base: la que había antes, si había).
  origen: {
    version_base: number | null;
    apartados_rehechos: number[];
    indicaciones: string | null;
    subida: string | null;
  } | null;
  // De una versión subida a mano: lo que dijo la persona y lo que Hermes aprende de sus cambios.
  notas_subida: string | null;
  lecciones: Leccion[];
  lecciones_en_curso: EnCurso | null;
};

function trabajoDe(db: Db, trabajoId: number | null): EnCurso | null {
  if (trabajoId === null) return null;
  const t = db.prepare('SELECT estado, actualizado_en FROM nucleo.trabajos_ia WHERE id = ?').get(trabajoId) as
    { estado: string; actualizado_en: string } | undefined;
  if (!t || (t.estado !== 'pendiente' && t.estado !== 'lanzado')) return null;
  return { estado: t.estado === 'lanzado' ? 'generando' : 'en_cola', desde: t.actualizado_en };
}

function compromisosDe(f: FilaApartado): ApartadoEstado['compromisos'] {
  if (f.estado !== 'recibido' || !f.datos) return [];
  const d = ApartadoDatos.safeParse(JSON.parse(f.datos));
  return d.success ? d.data.compromisos : [];
}

function apartadosEstado(db: Db, m: FilaMemoria, guion: GuionGuardado | null): ApartadoEstado[] {
  const delGuion = guion?.datos.memoria?.apartados ?? [];
  return apartadosDe(db, m.id).map((f) => ({
    apartado: f.apartado,
    titulo: delGuion[f.apartado - 1]?.titulo ?? `Apartado ${f.apartado}`,
    puntos: delGuion[f.apartado - 1]?.puntos ?? 0,
    estado: f.estado,
    trabajo: trabajoDe(db, f.trabajo_id),
    rechazos: f.rechazos,
    error: f.error,
    caracteres: f.caracteres,
    paginas_estimadas: f.paginas_estimadas,
    avisos: JSON.parse(f.avisos) as string[],
    compromisos: compromisosDe(f),
  }));
}

function borradorDe(db: Db, borradorId: number | null): BorradorMemoria | null {
  if (borradorId === null) return null;
  return (
    (db
      .prepare('SELECT id, ruta, ruta_pdf, ruta_md, estado, paginas, paginas_estimadas FROM borradores WHERE id = ?')
      .get(borradorId) as BorradorMemoria | undefined) ?? null
  );
}

function evaluacionDeEstado(
  db: Db,
  m: FilaMemoria,
  guion: GuionGuardado | null,
  b: BorradorMemoria | null,
): EvaluacionDeEstado {
  const ev = m.estado === 'ensamblada' ? evaluacionDeMemoria(db, m.licitacion_id, m.version) : null;
  const rutas = b ? [b.ruta, b.ruta_pdf, b.ruta_md].filter((r): r is string => r !== null) : [];
  const origen =
    m.version_base === null && !m.subida
      ? null
      : {
          version_base: m.version_base,
          apartados_rehechos: JSON.parse(m.apartados_rehechos ?? '[]') as number[],
          indicaciones: m.indicaciones ?? null,
          subida: m.subida ?? null,
        };
  return {
    evaluacion: ev ? resumenEvaluacionMemoria(ev) : null,
    evaluacion_en_curso: evaluacionEnCurso(db, m.licitacion_id, rutas),
    mejorable: ev && guion ? apartadosMejorables(ev, guion) : [],
    origen,
    notas_subida: m.notas_subida ?? null,
    lecciones: m.subida ? leccionesDe(db, m.id) : [],
    lecciones_en_curso: m.subida ? trabajoEnCurso(db, TIPO_LECCIONES, m.licitacion_id) : null,
  };
}

// Lo que el perfil de empresa trae ahora: los avisos de la portada y la firma se dijeron con el
// de cuando se montó, y se completa después. Se lee una vez por petición.
type PerfilAhora = { con_nif: boolean; firma_completa: boolean };

function perfilAhora(db: Db): PerfilAhora {
  const p = leerPerfilEmpresa(db)?.perfil;
  return { con_nif: Boolean(p?.nif), firma_completa: Boolean(municipioDe(p?.domicilio) && p?.representante) };
}

// Al leer, sin tocar lo guardado: con el perfil ya completo, los avisos de la portada y de la
// firma dicen cómo poner al día el Word, que sigue como se montó hasta volver a montarlo.
function avisosAlLeer(m: Pick<FilaMemoria, 'avisos' | 'version' | 'subida'>, p: PerfilAhora): string[] {
  const arreglo = m.subida ? 'corrígela en tu Word' : '«Volver a montar sin IA» la pone al día';
  return (JSON.parse(m.avisos) as string[]).map((a) => {
    if (a === AVISO_SIN_PERFIL && p.con_nif)
      return `La portada de la v${m.version} se montó sin el perfil de la empresa; ya está completo: ${arreglo}.`;
    if (a.startsWith(PREFIJO_AVISO_FIRMA) && p.firma_completa)
      return `La firma de la v${m.version} se montó sin lugar o sin firmante; ya están en el perfil: ${arreglo}.`;
    return a;
  });
}

// Lo que hace que una memoria valga para un guion: sus apartados con sus puntos, el límite de
// páginas y si se puntúa. Volver a extraer el guion (otra ficha, otra versión del análisis) da
// otro id con lo mismo; la redacción literal de la rúbrica puede variar sin que cambie la memoria.
function huellaDeMemoria(g: GuionGuardado | null): string | null {
  const mem = g?.datos.memoria;
  if (!mem) return null;
  const apartados = mem.apartados.map((a) => [textoComparable(a.titulo).replace(/\s+/g, ' ').trim(), a.puntos]);
  return JSON.stringify([apartados, mem.limite_paginas, memoriaValorable(mem)]);
}

/**
 * ¿Hay que rehacer la memoria por el guion? Solo si es de otro guion y, una ya dada por buena,
 * si además pide otra memoria (otros apartados, puntos o límite): un guion vuelto a extraer
 * igual no la tumba con días de plazo. Una sin revisar de otro guion no se da por buena.
 */
export function memoriaDeOtroGuion(
  db: Db,
  m: { guion_id: number; aceptada: boolean },
  vigente: GuionGuardado,
): boolean {
  if (m.guion_id === vigente.id) return false;
  if (!m.aceptada) return true;
  const suya = huellaDeMemoria(guionPorId(db, m.guion_id));
  return suya === null || suya !== huellaDeMemoria(vigente);
}

// cerrada: lo de ese lote (o la oferta) ya se presentó; que el guion cambiara después ya no pide nada.
// paraPersona: con los euros de los compromisos en la ficha (solo la web).
type LecturaMemoria = { perfil: PerfilAhora; cerrada: (lote: string | null) => boolean; paraPersona: boolean };

function estadoDe(db: Db, m: FilaMemoria, vigente: GuionGuardado | null, l: LecturaMemoria): EstadoMemoria {
  const guion = vigente?.id === m.guion_id ? vigente : guionPorId(db, m.guion_id);
  const apartados = apartadosEstado(db, m, guion);
  const borrador = borradorDe(db, m.borrador_id);
  const recibidos = apartados.filter((a) => a.paginas_estimadas !== null);
  const sumadas = recibidos.length
    ? Math.round(recibidos.reduce((s, a) => s + a.paginas_estimadas!, 0) * 10) / 10
    : null;
  return {
    id: m.id,
    version: m.version,
    guion_id: m.guion_id,
    estado: m.estado,
    pedida_en: m.pedida_en,
    ensamblada_en: m.ensamblada_en,
    borrador,
    apartados,
    paginas: borrador?.paginas ?? null,
    paginas_estimadas: borrador?.paginas_estimadas ?? sumadas,
    limite_paginas: guion?.datos.memoria?.limite_paginas ?? null,
    avisos: avisosAlLeer(m, l.perfil),
    guion_cambiado:
      !l.cerrada(m.lote ?? null) &&
      vigente !== null &&
      memoriaDeOtroGuion(db, { guion_id: m.guion_id, aceptada: borrador?.estado === 'aceptada' }, vigente),
    error: m.error,
    valorable: !guion?.datos.memoria || memoriaValorable(guion.datos.memoria),
    ...evaluacionDeEstado(db, m, guion, borrador),
    fugas: {
      hallazgos: fugasDeMemoria(db, m.id),
      anulada: m.anulacion_fugas ? (JSON.parse(m.anulacion_fugas) as AnulacionFugas) : null,
    },
    anonimato: anonimatoDeMemoria(db, m.id),
    progreso: m.fase !== null ? progresoDe(db, m, l.paraPersona) : null,
    ensayo: m.ensayo === 1,
    lote: m.lote ?? null,
    presentada: m.presentada === 1,
    presentada_sustituida: m.presentada === 2,
    sin_repartir: m.sin_repartir === 1,
  };
}

/**
 * Las memorias de una licitación, la más reciente primero. `paraPersona`: con los euros de los
 * compromisos en la ficha (solo para la web; lo que leen los agentes nunca los lleva).
 */
export function memoriasDe(db: Db, id: string, paraPersona = false): EstadoMemoria[] {
  const vigente = guionVigente(db, id);
  const filas = db
    .prepare('SELECT * FROM memorias WHERE licitacion_id = ? ORDER BY version DESC')
    .all(id) as FilaMemoria[];
  const lectura = { perfil: perfilAhora(db), cerrada: cierreDe(db, id), paraPersona };
  return filas.map((m) => estadoDe(db, m, vigente, lectura));
}

export type ResumenOferta = {
  guion: { version: number; apartados: number; limite_paginas: number | null } | null;
  guion_en_curso: EnCurso | null;
  decisiones_fijadas: boolean;
  guion_cambiado: boolean;
  // por_revisar: la versión está ensamblada y nadie la ha dado por buena ni descartado.
  memoria: {
    version: number;
    estado: string;
    recibidos: number;
    total: number;
    paginas: number | null;
    limite_paginas: number | null;
    por_revisar: boolean;
  } | null;
  // tope: lo que se teclea en el tramo más alto (o su literal), para que la ficha diga hasta dónde puntúa.
  automaticos: AutomaticoResumen[];
  // precios_maximos: el máximo por lote que fija el guion; null si aún no hay guion.
  precios_maximos: MaximoLote[] | null;
  // Si el pliego pide una memoria por lote: la de cada lote decidido, la presentada o la última (version null: sin pedir); null = una común.
  memorias_por_lote: MemoriaDeLote[] | null;
};

// presentada: la de ese lote es la que se entregó (subida tal cual); ya no se revisa ni se rehace.
export type MemoriaDeLote = {
  lote: string;
  version: number | null;
  estado: string | null;
  por_revisar: boolean;
  presentada: boolean;
};

const delLote = (m: EstadoMemoria, lote: string | null): boolean => (m.lote ?? null) === lote;

/** La presentada de ese lote o, sin ella, la común (sin lote), que vale para todos como en cierreDe. */
export function presentadaDelLote(memorias: readonly EstadoMemoria[], lote: string | null): EstadoMemoria | null {
  const propia = memorias.find((m) => m.presentada && delLote(m, lote));
  return propia ?? (lote === null ? null : (memorias.find((m) => m.presentada && delLote(m, null)) ?? null));
}

/**
 * La memoria de la oferta (memorias en orden, la más reciente primero): la presentada o, sin ella,
 * la última que no es de ensayo. Con lote, la de ese lote. Las comprobaciones, el MCP y el resumen eligen así.
 */
export function memoriaDeLaOferta(memorias: readonly EstadoMemoria[], lote?: string | null): EstadoMemoria | null {
  if (lote === undefined) return memorias.find((m) => m.presentada) ?? memorias.find((m) => !m.ensayo) ?? null;
  return presentadaDelLote(memorias, lote) ?? memorias.find((m) => !m.ensayo && delLote(m, lote)) ?? null;
}

/** Con memoria por lote, la de cada lote decidido (version null: sin pedir); null = una común. */
export function memoriasPorLote(lotes: string[] | null, memorias: readonly EstadoMemoria[]): MemoriaDeLote[] | null {
  if (!lotes) return null;
  return lotes.map((lote) => {
    const m = memoriaDeLaOferta(memorias, lote);
    return {
      lote,
      version: m?.version ?? null,
      estado: m?.estado ?? null,
      por_revisar: m?.borrador?.estado === 'pendiente',
      presentada: m?.presentada ?? false,
    };
  });
}

type AutomaticoResumen = { criterio: string; puntos: number; tope: string | null; lotes: string[] };

/** Los criterios automáticos del guion con su tope, sin importes. */
function automaticosResumen(g: ReturnType<typeof guionVigente>): AutomaticoResumen[] {
  if (!g) return [];
  return g.datos.automaticos.map((a) => {
    const ultimo = a.tramos?.at(-1);
    return {
      criterio: a.criterio,
      puntos: a.puntos,
      tope: ultimo?.valor ?? ultimo?.descripcion ?? null,
      lotes: a.lotes ?? [],
    };
  });
}

/** La oferta de un vistazo, sin datos personales (va en el detalle y en licitaciones_ver); la memoria, la presentada o, sin ella, la última que no es de ensayo. */
export function resumenOferta(db: Db, id: string): ResumenOferta {
  const g = guionVigente(db, id);
  const d = decisionesDe(db, id);
  const todas = memoriasDe(db, id);
  const m = memoriaDeLaOferta(todas);
  const lotes = g ? lotesDeMemoria(g.datos, lotesDecididos(db, id, d?.datos.lotes ?? [])) : null;
  return {
    guion: g
      ? {
          version: g.version,
          apartados: g.datos.memoria?.apartados.length ?? 0,
          limite_paginas: g.datos.memoria?.limite_paginas ?? null,
        }
      : null,
    guion_en_curso: trabajoEnCurso(db, TIPO_GUION, id),
    decisiones_fijadas: d !== null,
    guion_cambiado: Boolean(d && g && d.guion_id !== g.id) && !ofertaCerrada(db, id),
    memoria: m
      ? {
          version: m.version,
          estado: m.estado,
          recibidos: m.apartados.filter((a) => a.estado === 'recibido').length,
          total: m.apartados.length,
          paginas: m.paginas ?? m.paginas_estimadas,
          limite_paginas: m.limite_paginas,
          por_revisar: m.borrador?.estado === 'pendiente',
        }
      : null,
    automaticos: automaticosResumen(g),
    precios_maximos: g ? maximosPorLote(g.datos, lotesDecididos(db, id, []), presupuestosDeLotes(db, id)) : null,
    memorias_por_lote: memoriasPorLote(lotes, todas),
  };
}

// ── Dependencias de cada apartado ──

const log = logger('licitaciones.memoria');

/** Lo que comparten los apartados de una memoria de este guion: ámbito, equipo con su rol, herramientas y automáticos vigilados, con las decisiones de ahora. */
export function baseDependencias(db: Db, g: GuionGuardado): Omit<ContextoDependencias, 'n' | 'guionApartado'> {
  const id = g.licitacion_id;
  const d = decisionesDe(db, id)?.datos ?? null;
  const ids = (d?.equipo ?? []).map((m) => m.persona_id);
  const nombres = new Map(
    (
      db
        .prepare('SELECT id, nombre FROM nucleo.personas WHERE id IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(ids)) as { id: number; nombre: string }[]
    ).map((p) => [p.id, p.nombre]),
  );
  const lotes = lotesDecididos(db, id, d?.lotes ?? []);
  const vigilado = contextoDeFugas({ guion: g.datos, decididos: d?.automaticos, herramientas: d?.herramientas });
  return {
    lotesAmbito: lotes.length ? lotes : (g.datos.lotes ?? []),
    // Sin nombre conocido aún se la reconoce por su rol.
    equipo: (d?.equipo ?? []).map((m) => ({
      persona_id: m.persona_id,
      nombre: nombres.get(m.persona_id) ?? '',
      rol: m.rol_en_la_oferta,
    })),
    herramientas: d?.herramientas ?? [],
    automaticosVigilados: vigilado.automaticos.map((a) => a.criterio),
  };
}

/** Las dependencias del texto del apartado `n` de una memoria de este guion (null si el guion no tiene ese apartado). */
export function dependenciasDeTexto(
  base: Omit<ContextoDependencias, 'n' | 'guionApartado'>,
  g: GuionGuardado,
  n: number,
  d: Pick<ApartadoDatosData, 'titulo' | 'bloques'>,
): DependenciasApartado | null {
  const a = g.datos.memoria?.apartados[n - 1];
  return a
    ? dependenciasDeApartado(textoParaCoherencia(d), { ...base, n, guionApartado: huellaApartadoGuion(a) })
    : null;
}

const guardarDependencias = (db: Db, memoriaId: number, n: number, dep: DependenciasApartado) =>
  db
    .prepare('UPDATE memoria_apartados SET dependencias = ? WHERE memoria_id = ? AND apartado = ?')
    .run(JSON.stringify(dep), memoriaId, n);

// El apartado ya está guardado: si sus dependencias fallan, quedan en '{}' y quien las lea mira
// el texto. Nunca tumba la recepción.
function anotarDependencias(db: Db, m: FilaMemoria, n: number, d: Pick<ApartadoDatosData, 'titulo' | 'bloques'>): void {
  try {
    const g = guionPorId(db, m.guion_id);
    const dep = g ? dependenciasDeTexto(baseDependencias(db, g), g, n, d) : null;
    if (dep) guardarDependencias(db, m.id, n, dep);
  } catch (err) {
    log.warn('dependencias del apartado sin guardar', {
      memoria: m.id,
      apartado: n,
      error: errorMessage(err).slice(0, 200),
    });
  }
}

/** Las dependencias de una fila de memoria_apartados; null si son de antes de la columna ('{}') o ilegibles. */
export function leerDependencias(crudo: string | null): DependenciasApartado | null {
  try {
    const d = DependenciasApartado.safeParse(JSON.parse(crudo ?? '{}'));
    return d.success ? d.data : null;
  } catch {
    return null;
  }
}

/**
 * Las dependencias guardadas del apartado `n` de una memoria. No escribe. Null si no hay
 * apartado o si son de antes de la columna ('{}'): calcularlas ahora con las decisiones de ahora
 * dejaría fuera a quien sale o al lote quitado y el apartado se daría por mantenido. Con null,
 * quien las use mira el texto («ante la duda se revisa»).
 */
export function dependenciasDe(db: Db, memoriaId: number, n: number): DependenciasApartado | null {
  const f = db
    .prepare('SELECT dependencias FROM memoria_apartados WHERE memoria_id = ? AND apartado = ?')
    .get(memoriaId, n) as { dependencias: string | null } | undefined;
  return f ? leerDependencias(f.dependencias) : null;
}
