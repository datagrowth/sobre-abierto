// Aprender de una versión de la memoria que una persona retocó a mano: Hermes propone lecciones.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { nombreEmpresa } from '../../../nucleo/empresa.js';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { encolar } from '../../../nucleo/trabajos.js';
import type { EstadoRevision, RevisionData } from '../propuestas/revision.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { apartadosDe, filaMemoria, type FilaMemoria } from './ensamblado.js';
import { guionPorId } from './guion.js';
import {
  ALCANCES,
  insertarLecciones,
  leccionesDonde,
  personasEn,
  revisarDelLibro,
  soltarPendientes,
  type AlcanceLeccion,
  type Leccion,
} from './libroLecciones.js';
import { ApartadoDatos } from './memoriaRevision.js';
import { TEMAS_APARTADO, temaDeApartado } from './temasApartado.js';
import { cambiosEnTextoEntero, parrafosDeVersionEntera } from './textoEntero.js';
import {
  ClasificacionCambio,
  clasificarCambios,
  comparacionDeMemoria,
  lineasComparacion,
} from './comparacionMemoria.js';

const log = logger('licitaciones');
// Al subirla se escribe qué ha mejorado; Hermes recibe esa nota y los párrafos que cambiaron en cada apartado
// (su versión anterior frente a la editada) y propone lecciones concretas, generales o solo de esta licitación,
// con su evidencia. Entran pendientes: una persona las acepta o las descarta, y las aceptadas llegan a la
// redacción de las próximas memorias (leccionesAplicadas.ts).
export const TIPO_LECCIONES = 'licitaciones.lecciones';
export const PayloadLecciones = z.object({
  id: z.string().min(3),
  memoria_id: z.number().int().positive(),
  base_id: z.number().int().positive().nullable(),
  pedida_en: z.string().min(10),
});
export type PayloadLeccionesData = z.infer<typeof PayloadLecciones>;

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
export const LeccionesEntrada = z.strictObject({
  id: Texto(3, 40).describe('Id de la licitación'),
  memoria_id: z.number().int().positive().describe('La versión subida a mano que dio la tarea'),
  lecciones: z
    .array(
      z.strictObject({
        texto: Texto(15, 400).describe(
          'Qué hacer la próxima vez, en imperativo y concreto («Pon el calendario en una tabla con semana, hito, responsable y entregable»)',
        ),
        alcance: z
          .enum(ALCANCES)
          .describe(
            'general: vale para cualquier memoria; licitacion: solo para esta (cifras o condiciones de este pliego); organo, tipo_contrato o cpv: solo para las del mismo órgano, tipo de contrato o CPV que esta (el valor lo pone la plataforma)',
          ),
        tema: z
          .enum(TEMAS_APARTADO)
          .nullable()
          .optional()
          .describe(
            'Tema de apartado al que se aplica, si no es el del apartado donde se vio (o null si es de toda la memoria)',
          ),
        apartado: z
          .number()
          .int()
          .min(1)
          .max(20)
          .nullable()
          .describe('Apartado donde se vio el cambio; null si es de toda la memoria'),
        evidencia: z
          .string()
          .trim()
          .max(400)
          .describe('Trozo corto y literal del cambio que la apoya, sin nombres de personas'),
        cambio: z
          .number()
          .int()
          .positive()
          .nullable()
          .optional()
          .describe('Con la lista numerada de cambios de una presentada: el número del cambio de donde sale'),
      }),
    )
    .min(1)
    .max(12),
  cambios: z
    .array(ClasificacionCambio)
    .max(60)
    .optional()
    .describe(
      'Solo si la tarea trae la lista numerada de cambios: el tipo de cada uno que no lo lleva y, si no se explica solo, el porqué con tres opciones',
    ),
});
export type LeccionesEntradaData = z.infer<typeof LeccionesEntrada>;

export type { Leccion } from './libroLecciones.js';

const ahora = () => new Date().toISOString();

const TOPE_LECCIONES_DIA = 2;
const DIA_MS = 86_400_000;

// Las lecciones salen solas de cada Word subido: un bucle de subidas no puede llenar la cola.
function leccionesAutoHoy(dbNucleo: DbNucleo, id: string): number {
  return (
    dbNucleo
      .prepare(
        "SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ? AND a_mano = 0 AND json_extract(payload, '$.id') = ? AND creado_en >= ?",
      )
      .get(TIPO_LECCIONES, id, new Date(Date.now() - DIA_MS).toISOString()) as { n: number }
  ).n;
}

/** Pide a Hermes las lecciones de una versión subida (con su versión anterior si la hay). Null, sin encolar, si la oferta ya llegó a su tope de pedidas automáticas del día. */
export function pedirLecciones(
  dbNucleo: DbNucleo,
  m: Pick<FilaMemoria, 'id' | 'licitacion_id' | 'version'>,
  baseId: number | null,
): number | null {
  if (leccionesAutoHoy(dbNucleo, m.licitacion_id) >= TOPE_LECCIONES_DIA) {
    log.info('lecciones sin encolar: tope diario', {
      licitacion: m.licitacion_id,
      version: m.version,
      tope: TOPE_LECCIONES_DIA,
    });
    return null;
  }
  const payload: PayloadLeccionesData = { id: m.licitacion_id, memoria_id: m.id, base_id: baseId, pedida_en: ahora() };
  return encolar(dbNucleo, {
    tipo: TIPO_LECCIONES,
    dominio: 'licitaciones',
    clave: `lecciones-${m.licitacion_id}-v${m.version}`,
    payload,
    aMano: false,
  });
}

type Apartados = { titulo: string; se_valorara: string[] }[];
type Tapar = (t: string) => string;

type ContextoEdicion = {
  m: FilaMemoria;
  apartados: Apartados;
  tapar: Tapar | null;
  valores: Record<AlcanceLeccion, string | null>;
};

// El valor de cada alcance sale de la licitación de la memoria: Hermes solo dice cuál.
function valoresDeAlcance(db: Db, id: string): Record<AlcanceLeccion, string | null> {
  const l = db.prepare('SELECT organo_nombre, cpvs, tipo_contrato FROM licitaciones WHERE id = ?').get(id) as
    { organo_nombre: string; cpvs: string; tipo_contrato: string | null } | undefined;
  return {
    general: null,
    licitacion: id,
    organo: l?.organo_nombre ?? null,
    cpv: l?.cpvs.split(',').find(Boolean)?.slice(0, 4) ?? null,
    tipo_contrato: l?.tipo_contrato ?? null,
  };
}

function filaEdicion({ m, apartados, tapar, valores }: ContextoEdicion, l: LeccionesEntradaData['lecciones'][number]) {
  const a = l.apartado ? apartados[l.apartado - 1]! : null;
  const donde = a ? `apartado ${l.apartado} · ${a.titulo}` : 'toda la memoria';
  const ubicacion = l.cambio ? `cambio ${l.cambio} · ${donde}` : donde;
  const evidencias = [
    {
      licitacion_id: m.licitacion_id,
      memoria_id: m.id,
      documento: m.subida ?? null,
      ubicacion,
      texto: tapar ? tapar(l.evidencia) : l.evidencia,
    },
  ];
  const tema =
    l.tema !== undefined
      ? l.tema
      : (temaDeApartado(a ? [a.titulo, ...a.se_valorara].join(' ') : null) ?? temaDeApartado(l.texto));
  // Sin el valor (un órgano o un CPV que la licitación no tiene) la lección queda general.
  const alcance = l.alcance !== 'general' && valores[l.alcance] === null ? 'general' : l.alcance;
  return {
    licitacion_id: m.licitacion_id,
    memoria_id: m.id,
    apartado: l.apartado,
    apartado_titulo: a?.titulo ?? null,
    alcance,
    alcance_valor: valores[alcance],
    tema,
    texto: l.texto,
    evidencias,
  };
}

/**
 * Reenviar sustituye las pendientes de esa versión: lo ya revisado por una persona no se toca.
 * Con `tapar` (los nombres de Colaboradores), una lección que nombra a alguien se rechaza y su
 * evidencia se guarda con los nombres tapados: el libro no guarda datos personales.
 */
export function proponerLecciones(
  db: Db,
  e: LeccionesEntradaData,
  agente: string,
  tapar: Tapar | null = null,
): Result<{ guardadas: number }> {
  const m = filaMemoria(db, e.memoria_id);
  if (!m || m.licitacion_id !== e.id)
    return fail('not_found', `La licitación ${e.id} no tiene ninguna memoria con id ${e.memoria_id}.`);
  if (!m.subida)
    return fail(
      'conflicto',
      `La v${m.version} no se subió a mano: las lecciones salen de una versión editada por una persona.`,
    );
  const apartados = guionPorId(db, m.guion_id)?.datos.memoria?.apartados ?? [];
  const fuera = e.lecciones.filter((l) => l.apartado !== null && !apartados[l.apartado - 1]).map((l) => l.apartado);
  if (fuera.length)
    return fail(
      'invalid_input',
      `La memoria tiene ${apartados.length} apartados: «apartado» ${fuera.join(', ')} no existe (usa null si la lección es de toda la memoria).`,
    );
  const conNombre = e.lecciones.findIndex((l) => personasEn(l.texto, tapar));
  if (conNombre >= 0)
    return fail(
      'invalid_input',
      `La lección ${conNombre + 1} nombra a una persona del equipo: las lecciones no guardan nombres. Escribe el rol («la persona responsable del proyecto») y vuelve a enviarlas todas.`,
    );
  if (e.cambios?.length) {
    const c = clasificarCambios(db, m.id, e.cambios);
    if (c.error) return c;
  }
  db.transaction(() => {
    soltarPendientes(db, 'memoria_id = ?', m.id, (x) => x.memoria_id === m.id);
    const c = { m, apartados, tapar, valores: valoresDeAlcance(db, m.licitacion_id) };
    insertarLecciones(
      db,
      e.lecciones.map((l) => ({ ...filaEdicion(c, l), origen: 'edicion' as const, agente })),
    );
  })();
  emitir(db, {
    tipo: 'licitacion.lecciones',
    dominio: 'licitaciones',
    recurso: e.id,
    datos: { version: m.version, lecciones: e.lecciones.length },
  });
  return ok({ guardadas: e.lecciones.length });
}

/** Comprobación «hecho» del trabajo: llegaron lecciones de esa versión (o ya no existe). */
export function leccionesRecibidas(db: Db, memoriaId: number): boolean {
  return (
    !filaMemoria(db, memoriaId) || Boolean(db.prepare('SELECT 1 FROM lecciones WHERE memoria_id = ?').get(memoriaId))
  );
}

export function leccionesDe(db: Db, memoriaId: number): Leccion[] {
  return leccionesDonde(
    db,
    "memoria_id = ? AND estado NOT IN ('descartada', 'retirada') ORDER BY apartado IS NULL, apartado, id",
    memoriaId,
  );
}

export function revisarLeccion(
  db: Db,
  licitacionId: string,
  leccionId: number,
  r: RevisionData,
  quien = 'web',
): Result<{ id: number; estado: EstadoRevision }> {
  if (!db.prepare('SELECT 1 FROM lecciones WHERE id = ? AND licitacion_id = ?').get(leccionId, licitacionId))
    return fail('not_found', `No hay ninguna lección ${leccionId} de esta licitación.`);
  return revisarDelLibro(db, leccionId, r, quien);
}

// La selección para redactar y su trazabilidad están en leccionesAplicadas.ts.

// ── Instrucciones del run: la nota de la persona y los párrafos que cambiaron ──

const MAX_LADO = 3000;
// Entera, todo va en un solo bloque: más margen que por apartado, por debajo de los trozos de 15.000.
const MAX_LADO_ENTERA = 6000;
/** Los párrafos de cada apartado recibido de una versión (subtítulos y listas incluidos). */
export const parrafosDe = (db: Db, memoriaId: number): Map<number, string[]> =>
  new Map(
    apartadosDe(db, memoriaId).map((f) => {
      const d = f.estado === 'recibido' && f.datos ? ApartadoDatos.safeParse(JSON.parse(f.datos)) : null;
      const ps = d?.success
        ? d.data.bloques.flatMap((b) => [...(b.subtitulo ? [b.subtitulo] : []), ...b.parrafos, ...(b.lista ?? [])])
        : [];
      return [f.apartado, ps];
    }),
  );

function recortar(xs: string[], signo: string, max = MAX_LADO): string[] {
  const out: string[] = [];
  let n = 0;
  for (const x of xs) {
    if (n + x.length > max) {
      out.push(`${signo} […y ${xs.length - out.length} párrafos más]`);
      break;
    }
    out.push(`${signo} ${x}`);
    n += x.length;
  }
  return out;
}

/** Por apartado, los párrafos quitados (–) y añadidos (+) entre la versión base y la editada. */
export function cambiosPorApartado(antes: string[], despues: string[]): { quitados: string[]; anadidos: string[] } {
  const clave = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();
  const a = new Set(antes.map(clave));
  const d = new Set(despues.map(clave));
  return { quitados: antes.filter((x) => !d.has(clave(x))), anadidos: despues.filter((x) => !a.has(clave(x))) };
}

// Subida entera (sin los títulos del guion): el texto de Hermes, todo junto, frente al subido.
function lineasCambiosEnteros(db: Db, baseId: number, m: FilaMemoria): string[] {
  const base = filaMemoria(db, baseId);
  const subidos = parrafosDeVersionEntera(db, m.id);
  // Sin texto (escaneado, cifrado o .json ilegible) todo saldría «quitado»: no hay con qué comparar.
  if (!subidos.length)
    return [
      `No se pudo sacar el texto de la v${m.version} subida, así que no se compara con la v${base?.version ?? '?'} de Hermes: aprende solo de lo que dice la persona.`,
    ];
  const c = cambiosEnTextoEntero([...parrafosDe(db, baseId).values()].flat(), subidos);
  const cuerpo =
    c.quitados.length || c.anadidos.length
      ? [...recortar(c.quitados, '–', MAX_LADO_ENTERA), ...recortar(c.anadidos, '+', MAX_LADO_ENTERA)]
      : ['(sin cambios)'];
  return [
    `CAMBIOS EN EL TEXTO ENTERO (v${base?.version ?? '?'} de Hermes → v${m.version} subida a mano sin los títulos del guion, así que no se compara por apartado; solo lo que cambió):`,
    ...cuerpo,
  ];
}

function lineasCambios(db: Db, p: PayloadLeccionesData, m: FilaMemoria): string[] {
  if (p.base_id === null)
    return ['No hay una versión anterior de Hermes con la que comparar: aprende solo de lo que dice la persona.'];
  const comparacion = comparacionDeMemoria(db, m.id);
  if (comparacion) return lineasComparacion(comparacion);
  if (m.sin_repartir) return lineasCambiosEnteros(db, p.base_id, m);
  const base = filaMemoria(db, p.base_id);
  const titulos = guionPorId(db, m.guion_id)?.datos.memoria?.apartados.map((a) => a.titulo) ?? [];
  const antes = parrafosDe(db, p.base_id);
  const despues = parrafosDe(db, m.id);
  return [
    `CAMBIOS POR APARTADO (v${base?.version ?? '?'} de Hermes → v${m.version} editada a mano; solo lo que cambió):`,
    ...titulos.flatMap((t, i) => {
      const c = cambiosPorApartado(antes.get(i + 1) ?? [], despues.get(i + 1) ?? []);
      const cuerpo =
        c.quitados.length || c.anadidos.length
          ? [...recortar(c.quitados, '–'), ...recortar(c.anadidos, '+')]
          : ['(sin cambios)'];
      return [`## ${i + 1}. ${t}`, ...cuerpo];
    }),
  ];
}

export function instruccionesLecciones(db: Db, p: PayloadLeccionesData): string {
  const m = filaMemoria(db, p.memoria_id);
  if (!m)
    return `Tarea de la plataforma de ${nombreEmpresa(db)}: la memoria ${p.memoria_id} de la licitación ${p.id} ya no existe. No hagas nada.`;
  const l = db.prepare('SELECT titulo FROM licitaciones WHERE id = ?').get(p.id) as { titulo: string } | undefined;
  const comparada = p.base_id !== null && comparacionDeMemoria(db, m.id) !== null;
  const que = m.presentada ? 'que se presentó' : 'que una persona del equipo retocó a mano y subió';
  return [
    `Tarea de la plataforma de ${nombreEmpresa(db)}: aprende de la memoria técnica v${m.version} de la licitación ${p.id} (${l?.titulo ?? ''}), ${que} («${m.subida}»). Sigue la skill «licitaciones» (sección «Aprender de una versión editada a mano»).`,
    '',
    m.notas_subida
      ? `LO QUE DICE QUIEN LA EDITÓ (manda: es lo que quiere que aprendas):\n${m.notas_subida}`
      : 'Quien la editó no escribió nada: deduce las lecciones de los cambios.',
    '',
    ...lineasCambios(db, p, m),
    '',
    'CÓMO RESPONDER:',
    '1. Saca lecciones concretas y reutilizables: qué hizo la persona y por qué la memoria mejora (más concreta, sin condicionales, tabla en vez de prosa, cifras, quién y cuándo…). Cada lección dice qué hacer, en imperativo; nada de «mejorar la redacción».',
    '2. alcance «general» si sirve para cualquier memoria; «licitacion» si solo vale para esta (cifras o condiciones de este pliego); «organo», «tipo_contrato» o «cpv» si vale para las de este órgano, este tipo de contrato o este CPV. Mira con licitaciones_libro_lecciones si ya hay una lección parecida: no la repitas.',
    '3. apartado: el número del apartado donde se ve el cambio, o null si es de toda la memoria. evidencia: un trozo corto y literal del cambio que la apoya.',
    ...(comparada
      ? [
          '4. cambios: por cada cambio de la lista sin tipo, su tipo (correccion_dato, especificidad, estructura, recorte, compromiso, cumplimiento o estilo). Si un cambio no se explica solo, porque = { pregunta, opciones: tres porqués posibles }; si se entiende, porque = null. En cada lección, cambio = el número de donde sale.',
        ]
      : []),
    `${comparada ? 5 : 4}. Envía licitaciones_lecciones (id=${p.id}, memoria_id=${m.id}${comparada ? ', con «cambios»' : ''}) con entre 1 y 12 lecciones, primero las más útiles. Sin nombres de personas: escribe el rol. No inventes: lo que la persona no cambió no es una lección.`,
    'No hagas nada más: no escribas en Salidas ni en la Biblioteca y no respondas en ningún canal.',
  ].join('\n');
}
