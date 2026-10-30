// Preguntar al pliego: una caja en la ficha («¿Piden ENS?») cuya respuesta Hermes cita del pliego.
import { z } from 'zod';
import type { Db as DbNucleo } from '../../nucleo/db.js';
import { nombreEmpresa } from '../../nucleo/empresa.js';
import { emitir } from '../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../nucleo/result.js';
import { encolarUnico } from '../../nucleo/trabajos.js';
import { abrirIndiceLectura } from '../../biblioteca/motor/documentos/servicioIndice.js';
import type * as indice from '../../biblioteca/motor/documentos/almacen.js';
import { comprobadorDe } from './citasPliego.js';
import { pliegosSinLeer } from './oferta/guion.js';
import type { Db } from './store.js';

// Ejemplos: «¿Piden ENS?», «¿Se puede subcontratar la formación?». La pregunta va a la cola de Hermes con
// prioridad alta (hay una persona esperando) y Hermes responde con licitaciones_pliego_responder: una respuesta
// corta con la cita literal, o «el pliego no lo dice». La cita se busca literal en los pliegos (citasPliego.ts):
// sin encontrarla, la respuesta se enseña «no comprobada». Una persona puede pasar la respuesta a una fila de
// las comprobaciones (riesgo; con «no lo dice», para preparar la consulta al órgano).
export const TIPO_PREGUNTA_PLIEGO = 'licitaciones.preguntar_pliego';
export const PayloadPregunta = z.object({ id: z.string().min(3), pregunta: z.number().int().positive() });
export type PayloadPreguntaData = z.infer<typeof PayloadPregunta>;

const PreguntaWeb = z.strictObject({
  pregunta: z.string().trim().min(5, 'Escribe la pregunta (5 caracteres como mínimo).').max(500),
});
const ComprobacionesWeb = z.strictObject({ en_comprobaciones: z.boolean() });

type EstadoPregunta = 'pendiente' | 'respondida' | 'fallida';
export type PreguntaPliego = {
  id: number;
  pregunta: string;
  quien: string;
  estado: EstadoPregunta;
  dice: boolean | null;
  respuesta: string | null;
  cita: { texto: string; documento: string | null; pagina: number | null; comprobada: boolean } | null;
  en_comprobaciones: boolean;
  creada_en: string;
  respondida_en: string | null;
};
type Fila = {
  id: number;
  licitacion_id: string;
  pregunta: string;
  quien: string;
  estado: EstadoPregunta;
  dice: number | null;
  respuesta: string | null;
  cita: string | null;
  documento: string | null;
  pagina: number | null;
  comprobada: number;
  en_comprobaciones: number;
  creada_en: string;
  respondida_en: string | null;
};

const aPregunta = (f: Fila): PreguntaPliego => ({
  id: f.id,
  pregunta: f.pregunta,
  quien: f.quien,
  estado: f.estado,
  dice: f.dice === null ? null : f.dice === 1,
  respuesta: f.respuesta,
  cita: f.cita ? { texto: f.cita, documento: f.documento, pagina: f.pagina, comprobada: f.comprobada === 1 } : null,
  en_comprobaciones: f.en_comprobaciones === 1,
  creada_en: f.creada_en,
  respondida_en: f.respondida_en,
});

const filaDe = (db: Db, id: string, n: number): Fila | undefined =>
  db.prepare('SELECT * FROM preguntas_pliego WHERE licitacion_id = ? AND id = ?').get(id, n) as Fila | undefined;

const base = (id: string, n: number) => `pregunta-pliego-${id}-${n}`;
const avisar = (db: Db, id: string, accion: string, n: number) =>
  emitir(db, { tipo: 'licitacion.pregunta', dominio: 'licitaciones', recurso: id, datos: { accion, pregunta: n } });

/** Encola una pregunta de una persona. Sin pliegos legibles no hay a qué preguntar. */
export function preguntarAlPliego(
  dbLic: Db,
  dbNucleo: DbNucleo,
  id: string,
  entrada: unknown,
  quien: string,
): Result<PreguntaPliego> {
  const e = PreguntaWeb.safeParse(entrada);
  if (!e.success) return fail('invalid_input', e.error.issues[0]?.message ?? 'Pregunta no válida.');
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const sinLeer = pliegosSinLeer(dbLic, id);
  if (sinLeer) return fail('invalid_input', sinLeer);
  const n = Number(
    dbLic
      .prepare(
        "INSERT INTO preguntas_pliego (licitacion_id, pregunta, quien, estado, creada_en) VALUES (?, ?, ?, 'pendiente', ?)",
      )
      .run(id, e.data.pregunta, quien, new Date().toISOString()).lastInsertRowid,
  );
  encolarUnico(dbNucleo, {
    tipo: TIPO_PREGUNTA_PLIEGO,
    dominio: 'licitaciones',
    base: base(id, n),
    payload: { id, pregunta: n },
    aMano: true,
  });
  avisar(dbLic, id, 'pedida', n);
  return ok(aPregunta(filaDe(dbLic, id, n)!));
}

/** ¿Llegó la respuesta (o se dio por fallida)? Es la comprobación «hecho» del trabajo. */
export function preguntaRespondida(db: Db, p: PayloadPreguntaData): boolean {
  return filaDe(db, p.id, p.pregunta)?.estado !== 'pendiente';
}

// Una pregunta cuyo trabajo falló o se canceló se da por fallida: si no, quedaría «preguntando» siempre.
function cerrarFallidas(db: Db, id: string): void {
  const pendientes = db
    .prepare("SELECT id FROM preguntas_pliego WHERE licitacion_id = ? AND estado = 'pendiente'")
    .all(id) as { id: number }[];
  for (const { id: n } of pendientes) {
    const t = db
      .prepare(
        `SELECT estado FROM nucleo.trabajos_ia WHERE clave >= ? || '#' AND clave < ? || '$' ORDER BY id DESC LIMIT 1`,
      )
      .get(base(id, n), base(id, n)) as { estado: string } | undefined;
    if (t?.estado === 'fallido' || t?.estado === 'cancelado')
      db.prepare("UPDATE preguntas_pliego SET estado = 'fallida' WHERE id = ?").run(n);
  }
}

/** Las preguntas de una licitación, la última primero. */
export function preguntasDe(db: Db, id: string): PreguntaPliego[] {
  cerrarFallidas(db, id);
  return (db.prepare('SELECT * FROM preguntas_pliego WHERE licitacion_id = ? ORDER BY id DESC').all(id) as Fila[]).map(
    aPregunta,
  );
}

/** Las respondidas que una persona pasó a las comprobaciones (comprobacionesReglasPreguntas.ts). */
export function preguntasEnComprobaciones(db: Db, id: string): PreguntaPliego[] {
  return (
    db
      .prepare(
        "SELECT * FROM preguntas_pliego WHERE licitacion_id = ? AND en_comprobaciones = 1 AND estado = 'respondida' ORDER BY id",
      )
      .all(id) as Fila[]
  ).map(aPregunta);
}

/** Pasa una respuesta a las comprobaciones, o la quita. Solo una respondida. */
export function pasarAComprobaciones(db: Db, id: string, n: number, entrada: unknown): Result<PreguntaPliego> {
  const e = ComprobacionesWeb.safeParse(entrada);
  if (!e.success) return fail('invalid_input', 'en_comprobaciones: true o false.');
  const f = filaDe(db, id, n);
  if (!f) return fail('not_found', `No hay ninguna pregunta ${n} en la licitación «${id}».`);
  if (f.estado !== 'respondida')
    return fail('conflicto', 'Solo se pasa a las comprobaciones una pregunta ya respondida.');
  db.prepare('UPDATE preguntas_pliego SET en_comprobaciones = ? WHERE id = ?').run(e.data.en_comprobaciones ? 1 : 0, n);
  avisar(db, id, e.data.en_comprobaciones ? 'a_comprobaciones' : 'fuera_comprobaciones', n);
  return ok(aPregunta(filaDe(db, id, n)!));
}

export function instruccionesPregunta(db: Db, p: PayloadPreguntaData): string {
  const f = filaDe(db, p.id, p.pregunta);
  const empresa = nombreEmpresa(db);
  if (!f || f.estado !== 'pendiente')
    return `Tarea automática de la plataforma de ${empresa}: la pregunta ${p.pregunta} de la licitación ${p.id} ya no está pendiente. No hagas nada.`;
  return [
    `Tarea automática de la plataforma de ${empresa}: una persona pregunta algo concreto a los pliegos de una licitación. Respóndelo solo con lo que dicen los pliegos; no opines ni completes con lo habitual.`,
    `Licitación ${p.id}. Pregunta: «${f.pregunta}»`,
    `1. licitaciones_pliegos (id=${p.id}) con los temas que toque, o biblioteca_buscar con las palabras de la pregunta en las rutas de sus pliegos (licitaciones_ver los dice). Lee lo que encuentres con biblioteca_leer, por páginas.`,
    `2. licitaciones_pliego_responder (id=${p.id}, pregunta=${p.pregunta}): si los pliegos lo dicen, dice=true, «respuesta» en una o dos frases y «cita» con la frase literal que lo dice (con «…» si saltas un trozo) y «documento» con la ruta del pliego; si no lo dicen, dice=false y «respuesta» con lo que sí dicen al respecto, si algo, o «El pliego no lo dice».`,
    'La plataforma busca la cita literal en los pliegos: si no la encuentra, la respuesta sale como «no comprobada». No hagas nada más.',
  ].join('\n');
}

export const RespuestaPliego = z.strictObject({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  pregunta: z.number().int().positive().describe('El número de la pregunta (lo dice la tarea)'),
  dice: z.boolean().describe('true si los pliegos lo dicen; false si no'),
  respuesta: z.string().trim().min(3).max(800).describe('Una o dos frases'),
  cita: z
    .string()
    .trim()
    .min(10)
    .max(1500)
    .optional()
    .describe('Con dice=true: la frase literal del pliego que lo dice'),
  documento: z.string().trim().min(3).max(500).optional().describe('Ruta del pliego de la cita'),
});
export type RespuestaPliegoData = z.infer<typeof RespuestaPliego>;

/** Guarda la respuesta de Hermes con su cita comprobada (o no) en los pliegos. */
export function responderPregunta(
  db: Db,
  e: RespuestaPliegoData,
  agente: string,
  idx: indice.BaseDatos | null = abrirIndiceLectura(),
): Result<PreguntaPliego> {
  const f = filaDe(db, e.id, e.pregunta);
  if (!f) return fail('not_found', `No hay ninguna pregunta ${e.pregunta} en la licitación «${e.id}».`);
  if (f.estado !== 'pendiente') return fail('conflicto', 'Esa pregunta ya está respondida.');
  if (e.dice && !e.cita) return fail('invalid_input', 'Con dice=true manda la «cita» literal del pliego que lo dice.');
  const c = e.cita ? comprobadorDe(db, idx, e.id)(e.cita, e.documento ?? null) : null;
  // Con el documento que dio Hermes mal, se busca en todos los pliegos antes de darla por no localizada.
  const comprobacion = c?.estado === 'no_localizada' && e.documento ? comprobadorDe(db, idx, e.id)(e.cita!) : c;
  const comprobada = comprobacion?.estado === 'comprobada';
  db.prepare(
    `UPDATE preguntas_pliego SET estado = 'respondida', dice = ?, respuesta = ?, cita = ?, documento = ?, pagina = ?, comprobada = ?, agente = ?, respondida_en = ?
    WHERE id = ?`,
  ).run(
    e.dice ? 1 : 0,
    e.respuesta,
    e.cita ?? null,
    comprobada ? comprobacion!.documento : (e.documento ?? null),
    comprobada ? comprobacion!.pagina : null,
    comprobada ? 1 : 0,
    agente,
    new Date().toISOString(),
    f.id,
  );
  avisar(db, e.id, 'respondida', f.id);
  return ok(aPregunta(filaDe(db, e.id, f.id)!));
}
