// Compara la memoria final de Hermes con la que se presentó (fuente «edición»), apartado a apartado.
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Db } from '../store.js';
import { guardarEvidencias, leccionesDonde, type EvidenciaData } from './libroLecciones.js';
import { textoComparable } from '../temas.js';

const log = logger('licitaciones');

// Al subir la presentada, el código saca los cambios (añadidos, quitados, modificados y movidos) y etiqueta los
// que se ven por sí solos (un dato corregido, un párrafo movido, un recorte); Hermes etiqueta el resto en la
// tarea de lecciones y propone el porqué de los que no se explican solos. De esos, a la persona solo se le
// preguntan los 3 más grandes: subir la memoria no puede convertirse en un formulario.
const TIPOS_CAMBIO = [
  'correccion_dato',
  'especificidad',
  'estructura',
  'recorte',
  'compromiso',
  'cumplimiento',
  'estilo',
] as const;
export type TipoCambio = (typeof TIPOS_CAMBIO)[number];
export const ACCIONES_CAMBIO = ['anadido', 'quitado', 'modificado', 'movido'] as const;
const MAX_PREGUNTAS = 3;

export type Cambio = {
  n: number;
  apartado: number | null;
  apartado_titulo: string | null;
  accion: (typeof ACCIONES_CAMBIO)[number];
  antes: string | null;
  despues: string | null;
  a_apartado: number | null;
  tamano: number;
  tipo: TipoCambio | null;
  por: 'codigo' | 'hermes' | null;
};
export type PreguntaPorque = {
  n: number;
  pregunta: string;
  opciones: string[];
  respuesta: string | null;
  respondida_en: string | null;
};
export type ResumenComparacion = { total: number; por_tipo: Partial<Record<TipoCambio | 'sin_clasificar', number>> };
export type Comparacion = {
  id: number;
  licitacion_id: string;
  lote: string | null;
  memoria_hermes_id: number;
  version_hermes: number;
  memoria_presentada_id: number;
  version_presentada: number;
  por_apartado: boolean;
  cambios: Cambio[];
  resumen: ResumenComparacion;
  preguntas: PreguntaPorque[];
  creada_en: string;
  clasificada_en: string | null;
};

// ── El diff, puro ──

const clave = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();
const palabras = (t: string) =>
  new Set(
    textoComparable(t)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((p) => p.length >= 3),
  );
const sinNumeros = (t: string) => clave(t).replace(/\d[\d.,:/%-]*/g, '#');

function parecido(a: string, b: string): number {
  const x = palabras(a);
  const y = palabras(b);
  const comunes = [...x].filter((p) => y.has(p)).length;
  return comunes / Math.max(1, x.size + y.size - comunes);
}

const COMPROMISO =
  /\b(nos comprometemos|se compromete|comprometid|garantiza|garantizamos|sin coste|incluido en el precio)\b/;

/** Lo que el código ve por sí solo; null si hace falta Hermes. */
export function tipoPorCodigo(c: Pick<Cambio, 'accion' | 'antes' | 'despues'>): TipoCambio | null {
  if (c.accion === 'movido') return 'estructura';
  const texto = textoComparable(`${c.antes ?? ''} ${c.despues ?? ''}`);
  if (c.accion === 'anadido' && c.despues?.includes(' | ')) return 'estructura';
  if (c.accion !== 'modificado') return COMPROMISO.test(texto) ? 'compromiso' : null;
  const [a, d] = [c.antes ?? '', c.despues ?? ''];
  if (clave(a) !== clave(d) && sinNumeros(a) === sinNumeros(d)) return 'correccion_dato';
  if (d.length < a.length * 0.7 && [...palabras(d)].every((p) => palabras(a).has(p))) return 'recorte';
  if (parecido(a, d) >= 0.85) return 'estilo';
  return null;
}

type Bruto = Omit<Cambio, 'n' | 'tipo' | 'por'>;

// Un párrafo quitado de un apartado y añadido igual en otro se ha movido, no cambiado.
function movidos(
  quitados: Map<number, string[]>,
  anadidos: Map<number, string[]>,
  titulo: (a: number) => string | null,
): Bruto[] {
  const out: Bruto[] = [];
  for (const [de, qs] of quitados) {
    for (const q of [...qs]) {
      const destino = [...anadidos].find(([a, xs]) => a !== de && xs.some((x) => clave(x) === clave(q)));
      if (!destino) continue;
      const [a, xs] = destino;
      xs.splice(
        xs.findIndex((x) => clave(x) === clave(q)),
        1,
      );
      qs.splice(qs.indexOf(q), 1);
      out.push({
        apartado: de,
        apartado_titulo: titulo(de),
        accion: 'movido',
        antes: q,
        despues: null,
        a_apartado: a,
        tamano: Math.ceil(q.length / 2),
      });
    }
  }
  return out;
}

// En un mismo apartado, un quitado y un añadido que se parecen son el mismo párrafo retocado.
function delApartado(apartado: number | null, titulo: string | null, qs: string[], as: string[]): Bruto[] {
  const libres = [...as];
  const out: Bruto[] = [];
  for (const q of qs) {
    const mejor = libres.map((a, i) => ({ i, p: parecido(q, a) })).sort((x, y) => y.p - x.p)[0];
    if (mejor && mejor.p >= 0.5) {
      const [a] = libres.splice(mejor.i, 1);
      out.push({
        apartado,
        apartado_titulo: titulo,
        accion: 'modificado',
        antes: q,
        despues: a!,
        a_apartado: null,
        tamano: Math.abs(a!.length - q.length) + Math.round((1 - mejor.p) * Math.max(a!.length, q.length)),
      });
    } else
      out.push({
        apartado,
        apartado_titulo: titulo,
        accion: 'quitado',
        antes: q,
        despues: null,
        a_apartado: null,
        tamano: q.length,
      });
  }
  return [
    ...out,
    ...libres.map((a) => ({
      apartado,
      apartado_titulo: titulo,
      accion: 'anadido' as const,
      antes: null,
      despues: a,
      a_apartado: null,
      tamano: a.length,
    })),
  ];
}

function diferencia(antes: string[], despues: string[]): { quitados: string[]; anadidos: string[] } {
  const a = new Set(antes.map(clave));
  const d = new Set(despues.map(clave));
  return { quitados: antes.filter((x) => !d.has(clave(x))), anadidos: despues.filter((x) => !a.has(clave(x))) };
}

/**
 * Los cambios de Hermes a la presentada. Con `titulos`, por apartado (la clave 0 es lo que no cae
 * en ninguno); sin ellos, todo en un bloque (apartado null). Numerados y con el tipo del código.
 */
export function compararParrafos(
  antes: Map<number, string[]>,
  despues: Map<number, string[]>,
  titulos: string[] | null,
): Cambio[] {
  const titulo = (a: number) => (titulos && a > 0 ? (titulos[a - 1] ?? null) : null);
  const claves = [...new Set([...antes.keys(), ...despues.keys()])].sort((x, y) => x - y);
  const quitados = new Map<number, string[]>();
  const anadidos = new Map<number, string[]>();
  for (const k of claves) {
    const d = diferencia(antes.get(k) ?? [], despues.get(k) ?? []);
    quitados.set(k, d.quitados);
    anadidos.set(k, d.anadidos);
  }
  const brutos = [
    ...(titulos ? movidos(quitados, anadidos, titulo) : []),
    ...claves.flatMap((k) => delApartado(titulos && k > 0 ? k : null, titulo(k), quitados.get(k)!, anadidos.get(k)!)),
  ];
  brutos.sort((x, y) => (x.apartado ?? 0) - (y.apartado ?? 0));
  return numerar(brutos);
}

function numerar(brutos: Bruto[]): Cambio[] {
  return brutos.map((b, i) => {
    const tipo = tipoPorCodigo(b);
    return { ...b, n: i + 1, tipo, por: tipo ? 'codigo' : null };
  });
}

/** Sin los títulos del guion: lo quitado y lo añadido del texto entero (textoEntero.ts), emparejado. */
export function compararEntero(d: { quitados: string[]; anadidos: string[] }): Cambio[] {
  return numerar(delApartado(null, null, d.quitados, d.anadidos));
}

export function resumenDe(cambios: readonly Cambio[]): ResumenComparacion {
  const por_tipo: ResumenComparacion['por_tipo'] = {};
  for (const c of cambios) por_tipo[c.tipo ?? 'sin_clasificar'] = (por_tipo[c.tipo ?? 'sin_clasificar'] ?? 0) + 1;
  return { total: cambios.length, por_tipo };
}

// ── Guardar y leer ──

type Fila = Omit<Comparacion, 'cambios' | 'resumen' | 'preguntas' | 'por_apartado'> & {
  cambios: string;
  resumen: string;
  preguntas: string;
  por_apartado: number;
};

function aComparacion(f: Fila): Comparacion {
  return {
    ...f,
    por_apartado: f.por_apartado === 1,
    cambios: JSON.parse(f.cambios) as Cambio[],
    resumen: JSON.parse(f.resumen) as ResumenComparacion,
    preguntas: JSON.parse(f.preguntas) as PreguntaPorque[],
  };
}

export type NuevaComparacion = {
  licitacion_id: string;
  lote: string | null;
  hermes: { id: number; version: number };
  presentada: { id: number; version: number };
  cambios: Cambio[];
  por_apartado: boolean;
};

/** Al subir la presentada; volver a subirla (otra presentada) da otra comparación, la suya. */
export function crearComparacion(db: Db, c: NuevaComparacion): number {
  const { cambios } = c;
  const id = Number(
    db
      .prepare(
        `INSERT OR REPLACE INTO comparaciones_memoria (licitacion_id, lote, memoria_hermes_id, version_hermes, memoria_presentada_id, version_presentada,
      por_apartado, cambios, resumen, creada_en) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        c.licitacion_id,
        c.lote,
        c.hermes.id,
        c.hermes.version,
        c.presentada.id,
        c.presentada.version,
        c.por_apartado ? 1 : 0,
        JSON.stringify(cambios),
        JSON.stringify(resumenDe(cambios)),
        new Date().toISOString(),
      ).lastInsertRowid,
  );
  log.info('comparación de la presentada', {
    licitacion: c.licitacion_id,
    version: c.presentada.version,
    cambios: cambios.length,
  });
  return id;
}

export function comparacionDeMemoria(db: Db, memoriaPresentadaId: number): Comparacion | null {
  const f = db
    .prepare('SELECT * FROM comparaciones_memoria WHERE memoria_presentada_id = ?')
    .get(memoriaPresentadaId) as Fila | undefined;
  return f ? aComparacion(f) : null;
}

/** Las de una licitación (null: todas), las últimas primero. */
export function comparacionesDe(db: Db, licitacionId: string | null): Comparacion[] {
  const filas =
    licitacionId === null
      ? (db.prepare('SELECT * FROM comparaciones_memoria ORDER BY creada_en DESC, id DESC').all() as Fila[])
      : (db
          .prepare('SELECT * FROM comparaciones_memoria WHERE licitacion_id = ? ORDER BY creada_en DESC, id DESC')
          .all(licitacionId) as Fila[]);
  return filas.map(aComparacion);
}

// ── La parte de Hermes: etiquetar y proponer el porqué ──

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
export const ClasificacionCambio = z.strictObject({
  n: z.number().int().positive().describe('El número del cambio en la lista de la tarea'),
  tipo: z
    .enum(TIPOS_CAMBIO)
    .describe(
      'correccion_dato, especificidad (cifra, nombre del servicio del cliente, normativa propia), estructura (tabla, orden, títulos), recorte (por extensión), compromiso (quitado o añadido), cumplimiento (añade lo que el pliego pedía) o estilo',
    ),
  porque: z
    .strictObject({
      pregunta: Texto(10, 200).describe('La pregunta a la persona, sobre ese cambio concreto'),
      opciones: z
        .tuple([Texto(3, 120), Texto(3, 120), Texto(3, 120)])
        .describe('Tres porqués posibles, el más probable primero'),
    })
    .nullable()
    .describe('Solo si el cambio no se explica solo; null si se entiende sin preguntar'),
});
export type ClasificacionCambioData = z.infer<typeof ClasificacionCambio>;

/** Aplica lo que etiquetó Hermes (no pisa lo del código) y deja las 3 preguntas de los cambios más grandes. */
export function clasificarCambios(
  db: Db,
  memoriaId: number,
  xs: readonly ClasificacionCambioData[],
): Result<{ clasificados: number; preguntas: number }> {
  const c = comparacionDeMemoria(db, memoriaId);
  if (!c)
    return fail('conflicto', 'Esta memoria no tiene comparación con la de Hermes: envía las lecciones sin «cambios».');
  const fuera = xs.filter((x) => !c.cambios.some((k) => k.n === x.n)).map((x) => x.n);
  if (fuera.length)
    return fail('invalid_input', `La comparación tiene ${c.cambios.length} cambios: ${fuera.join(', ')} no existe.`);
  const porN = new Map(xs.map((x) => [x.n, x]));
  const cambios = c.cambios.map((k) =>
    k.por === 'codigo' || !porN.has(k.n) ? k : { ...k, tipo: porN.get(k.n)!.tipo, por: 'hermes' as const },
  );
  const preguntas: PreguntaPorque[] = cambios
    .filter((k) => porN.get(k.n)?.porque && k.por === 'hermes')
    .sort((a, b) => b.tamano - a.tamano)
    .slice(0, MAX_PREGUNTAS)
    .map((k) => ({ n: k.n, ...porN.get(k.n)!.porque!, respuesta: null, respondida_en: null }));
  db.prepare(
    'UPDATE comparaciones_memoria SET cambios = ?, resumen = ?, preguntas = ?, clasificada_en = ? WHERE id = ?',
  ).run(
    JSON.stringify(cambios),
    JSON.stringify(resumenDe(cambios)),
    JSON.stringify(preguntas),
    new Date().toISOString(),
    c.id,
  );
  return ok({ clasificados: cambios.filter((k) => k.por === 'hermes').length, preguntas: preguntas.length });
}

export const RespuestaPorque = z.strictObject({
  n: z.number().int().positive(),
  respuesta: Texto(2, 600).describe('Una de las tres opciones o lo que escriba la persona'),
});

// La respuesta va a la evidencia de las lecciones que salen de ese cambio («cambio N · …» de esa
// presentada): se lee en la tarjeta y en el libro, y llega a Hermes con licitaciones_libro_lecciones.
function anotarPorque(db: Db, memoriaId: number, n: number, respuesta: string): void {
  const es = (e: EvidenciaData) => e.memoria_id === memoriaId && (e.ubicacion ?? '').startsWith(`cambio ${n} · `);
  for (const l of leccionesDonde(db, 'instr(evidencias, ?) > 0', `"cambio ${n} · `)) {
    if (l.evidencias.some(es))
      guardarEvidencias(
        db,
        l.id,
        l.evidencias.map((e) => (es(e) ? { ...e, porque: respuesta } : e)),
      );
  }
}

/** La persona responde el porqué de un cambio (una opción o su texto); se puede cambiar. */
export function responderPorque(
  db: Db,
  licitacionId: string,
  comparacionId: number,
  r: z.infer<typeof RespuestaPorque>,
): Result<{ pendientes: number }> {
  const f = db
    .prepare('SELECT * FROM comparaciones_memoria WHERE id = ? AND licitacion_id = ?')
    .get(comparacionId, licitacionId) as Fila | undefined;
  if (!f) return fail('not_found', `No hay ninguna comparación ${comparacionId} de esta licitación.`);
  const c = aComparacion(f);
  if (!c.preguntas.some((p) => p.n === r.n)) return fail('not_found', `No hay pregunta sobre el cambio ${r.n}.`);
  const preguntas = c.preguntas.map((p) =>
    p.n === r.n ? { ...p, respuesta: r.respuesta, respondida_en: new Date().toISOString() } : p,
  );
  db.transaction(() => {
    db.prepare('UPDATE comparaciones_memoria SET preguntas = ? WHERE id = ?').run(JSON.stringify(preguntas), c.id);
    anotarPorque(db, c.memoria_presentada_id, r.n, r.respuesta);
  })();
  emitir(db, {
    tipo: 'licitacion.lecciones',
    dominio: 'licitaciones',
    recurso: licitacionId,
    datos: { comparacion: c.id, porque: r.n },
  });
  return ok({ pendientes: preguntas.filter((p) => p.respuesta === null).length });
}

// ── Para la tarea de Hermes ──

const MAX_CAMBIOS_TAREA = 60;
const MAX_LADO_CAMBIO = 400;
const corto = (t: string | null) => (t && t.length > MAX_LADO_CAMBIO ? `${t.slice(0, MAX_LADO_CAMBIO)}…` : (t ?? ''));

function lineaCambio(k: Cambio): string {
  const donde = k.apartado
    ? `apartado ${k.apartado}${k.apartado_titulo ? ` «${k.apartado_titulo}»` : ''}`
    : 'texto entero';
  const tipo = k.tipo ? ` [${k.tipo}, lo vio el código]` : '';
  const cuerpo =
    k.accion === 'movido'
      ? `movido al apartado ${k.a_apartado}: ${corto(k.antes)}`
      : k.accion === 'modificado'
        ? `– ${corto(k.antes)}\n   + ${corto(k.despues)}`
        : k.accion === 'quitado'
          ? `– ${corto(k.antes)}`
          : `+ ${corto(k.despues)}`;
  return `${k.n}. (${donde}, ${k.accion})${tipo} ${cuerpo}`;
}

/** Los cambios numerados para la tarea de lecciones: primero los que esperan tipo, los más grandes. */
export function lineasComparacion(c: Comparacion): string[] {
  const sinTipo = c.cambios
    .filter((k) => k.tipo === null)
    .sort((a, b) => b.tamano - a.tamano)
    .slice(0, MAX_CAMBIOS_TAREA);
  const conTipo = c.cambios.filter((k) => k.tipo !== null).slice(0, Math.max(0, MAX_CAMBIOS_TAREA - sinTipo.length));
  const resto = c.cambios.length - sinTipo.length - conTipo.length;
  const modo = c.por_apartado ? 'por apartado' : 'en el texto entero (la presentada no lleva los títulos del guion)';
  return [
    `CAMBIOS ENTRE TU v${c.version_hermes} Y LA PRESENTADA v${c.version_presentada} (${c.cambios.length}, ${modo}; los que no llevan tipo esperan el tuyo):`,
    ...[...sinTipo, ...conTipo].sort((a, b) => a.n - b.n).map(lineaCambio),
    ...(resto > 0 ? [`(…y ${resto} cambios pequeños más: no hace falta etiquetarlos)`] : []),
  ];
}
