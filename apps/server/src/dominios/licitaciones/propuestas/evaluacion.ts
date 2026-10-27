// Evaluador: Hermes lee un documento de propuesta, lo puntúa criterio a criterio y envía licitaciones_evaluacion.
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { nombreEmpresa } from '../../../nucleo/empresa.js';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { archivoExistente, RutaDocumento, type Raices } from '../../../nucleo/salidas.js';
import { encolar, encolarUnico } from '../../../nucleo/trabajos.js';
import type { EnCurso } from '../../../nucleo/colaConsultas.js';
import { fichasDe } from '../ficha.js';
import { carpetasLicitaciones } from '../carpetas.js';
import type { Db } from '../store.js';
import { localizarCitas, problemasContraGuion, textosDeApartados, tramoMaximo } from '../oferta/evaluacionMemoria.js';
import { guionPorId, guionVigente, type GuionGuardado } from '../oferta/guion.js';
import { memoriaSePuntua } from '../oferta/ensamblado.js';
import { guardaPlazo } from '../oferta/plazo.js';
import { textoDeVersionSubida } from '../oferta/textoEntero.js';
import { memoriaValorable, puntosTexto } from '../oferta/guionRevision.js';
import type { EstadoRevision } from './revision.js';

// Hermes lee entero el documento (Salidas o Conocimiento), lo compara con propuestas anteriores parecidas y
// envía licitaciones_evaluacion (zod estricto). La vara son los apartados del guion (con el tramo de su escala,
// como la mesa) si el documento es una memoria ensamblada o hay guion con memoria; si no, los criterios de la
// ficha aprobada. Se guarda pendiente y una persona la acepta o la descarta (revision.ts): nunca modifica el
// documento ni el registro.
export const TIPO_EVALUACION = 'licitaciones.evaluar';
export const PayloadEvaluacion = z.object({
  id: z.string().min(3),
  documento: z.string().min(10),
  pedida_en: z.string().min(10),
});
const log = logger('licitaciones');

const Texto = (min: number, max: number) => z.string().trim().min(min).max(max);
const redondear = (n: number) => Math.round(n * 100) / 100;
const Referencia = Texto(1, 200).describe(
  'Sección, apartado o página del documento, p. ej. «3.2 Metodología, pág. 12»',
);
const Sugerencia = z.strictObject({ referencia: Referencia, que: Texto(3, 1000).describe('Qué cambiar y por qué') });

const CriterioEvaluado = z.strictObject({
  criterio: Texto(2, 500).describe('El criterio tal como está en la ficha aprobada'),
  peso: z.number().min(0).max(1000).describe('Puntos máximos del criterio'),
  tipo: z.enum(['formula', 'juicio_valor']),
  puntuacion: z
    .number()
    .min(0)
    .max(1000)
    .describe('Puntos estimados (≤ peso). En los de fórmula, según la oferta económica si se conoce'),
  justificacion: Texto(3, 1500),
  referencia: Referencia.optional(),
  apartado: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Con guion: número del apartado de la memoria (1 = el primero)'),
  tramo: z
    .number()
    .min(0)
    .max(1000)
    .optional()
    .describe('Con guion: los puntos del tramo de la escala del pliego que le daría la mesa'),
});

const Generico = z.strictObject({
  referencia: Referencia,
  texto: Texto(10, 300).describe(
    'El párrafo tal cual está en el documento (si es más largo, sus primeros 300 caracteres o trozos literales unidos con «…»)',
  ),
  por_que: Texto(3, 500).describe(
    'Qué le falta (quién, cuándo o con qué medida) o por qué es declarativo o repite el pliego',
  ),
});

const Comparable = z.strictObject({
  tipo: z
    .enum(['propuesta', 'documento', 'adjudicacion'])
    .describe(
      'propuesta: del registro (licitaciones_propuestas); documento: de la Biblioteca o Salidas; adjudicacion: de licitaciones_comparables',
    ),
  referencia: Texto(1, 500).describe('Id de la propuesta o de la licitación, o ruta del documento'),
  resultado: z.enum(['ganada', 'perdida', 'excluida', 'desierta', 'retirada', 'pendiente', 'desconocido']).optional(),
  parecido: Texto(3, 500).describe('En qué se parece (tipo, área, cliente, presupuesto) y qué se aprende de él'),
});

export const EvaluacionDatos = z
  .strictObject({
    resumen: Texto(10, 3000),
    puntuacion_total: z.number().min(0).max(1000).describe('Suma de las puntuaciones estimadas'),
    puntuacion_maxima: z.number().min(0).max(1000).describe('Suma de los pesos (0 si el pliego no puntúa la memoria)'),
    criterios: z.array(CriterioEvaluado).min(1).max(40),
    eliminar: z.array(Sugerencia).max(30),
    modificar: z.array(Sugerencia).max(30),
    reforzar: z.array(Sugerencia).max(30),
    comparables: z.array(Comparable).max(20),
    riesgos: z
      .array(z.strictObject({ descripcion: Texto(3, 500), gravedad: z.enum(['alta', 'media', 'baja']) }))
      .max(30),
    genericos: z
      .array(Generico)
      .max(40)
      .optional()
      .describe(
        'Párrafos que la mesa no puntuaría: sin quién, cuándo ni medida, meramente declarativos o que repiten el pliego',
      ),
    memoria: z
      .strictObject({ version: z.number().int().positive(), guion_id: z.number().int().positive() })
      .optional()
      .describe('La pone la plataforma cuando el documento es una memoria ensamblada'),
  })
  .superRefine((e, ctx) => {
    e.criterios.forEach((c, i) => {
      if (c.puntuacion > c.peso)
        ctx.addIssue({
          code: 'custom',
          path: ['criterios', i, 'puntuacion'],
          message: `puntuación ${c.puntuacion} mayor que el peso ${c.peso}`,
        });
    });
    const suma = e.criterios.reduce((s, c) => s + c.puntuacion, 0);
    if (Math.abs(suma - e.puntuacion_total) > 0.5)
      ctx.addIssue({
        code: 'custom',
        path: ['puntuacion_total'],
        message: `debe ser la suma de los criterios (${redondear(suma)})`,
      });
    const pesos = e.criterios.reduce((s, c) => s + c.peso, 0);
    if (Math.abs(pesos - e.puntuacion_maxima) > 0.5)
      ctx.addIssue({
        code: 'custom',
        path: ['puntuacion_maxima'],
        message: `debe ser la suma de los pesos (${redondear(pesos)})`,
      });
    if (e.puntuacion_total > e.puntuacion_maxima)
      ctx.addIssue({ code: 'custom', path: ['puntuacion_total'], message: 'mayor que la puntuación máxima' });
  });
export type EvaluacionDatosData = z.infer<typeof EvaluacionDatos>;

// El SDK publica el esquema de entrada como JSON Schema: la tool lleva el objeto sin
// refinamientos y estos se aplican al guardar (con el mismo mensaje de error para Hermes).
export const EvaluacionEntrada = z.strictObject({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  documento: RutaDocumento,
  ...EvaluacionDatos.shape,
});
export type EvaluacionEntradaData = z.infer<typeof EvaluacionEntrada>;

export type Evaluacion = {
  id: number;
  licitacion_id: string;
  documento: string;
  agente: string;
  creada_en: string;
  estado: EstadoRevision;
  revisado_en: string | null;
  datos: EvaluacionDatosData;
};
type Fila = Omit<Evaluacion, 'datos'> & { datos: string };

// La vara de medir son los criterios de la ficha aprobada: una evaluación con otros (o con
// otra puntuación máxima) no se puede comparar con nada y engañaría en la web.
function conCriteriosDeLaFicha(db: Db, id: string, e: EvaluacionDatosData): Result<null> {
  const ficha = fichasDe(db, id).aprobada;
  if (!ficha)
    return fail('invalid_input', 'La licitación no tiene ficha aprobada: la evaluación puntúa con sus criterios.');
  const criterios = ficha.datos.criterios;
  if (!criterios.length) return ok(null);
  const pesos = criterios.reduce((s, c) => s + c.peso, 0);
  if (criterios.length === e.criterios.length && Math.abs(pesos - e.puntuacion_maxima) <= 0.5) return ok(null);
  return fail(
    'invalid_input',
    `Puntúa los ${criterios.length} criterios de la ficha aprobada (go_no_go.ficha.aprobada.datos.criterios) con sus pesos: puntuacion_maxima = ${redondear(pesos)}.`,
  );
}

// sin_repartir: subida a mano entera, sin apartados (oferta/subidaFlexible.ts).
type MemoriaEvaluada = { id: number; version: number; guion_id: number; sin_repartir: number };
export type Vara = { guion: GuionGuardado; memoria: MemoriaEvaluada | null };

/** La memoria ensamblada cuyo documento (docx, pdf o md) es `documento`, si lo es. */
function memoriaDeDocumento(db: Db, id: string, documento: string): MemoriaEvaluada | null {
  return (
    (db
      .prepare(
        `SELECT m.id, m.version, m.guion_id, m.sin_repartir FROM borradores b JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND b.origen = 'ensamblado' AND ? IN (b.ruta, b.ruta_pdf, b.ruta_md)`,
      )
      .get(id, documento) as MemoriaEvaluada | undefined) ?? null
  );
}

/** Con qué se mide un documento: el guion de su memoria, el vigente si trae memoria que puntúa o (null) la ficha. */
export function varaDeEvaluacion(db: Db, id: string, documento: string): Vara | null {
  const memoria = memoriaDeDocumento(db, id, documento);
  const guion = memoria ? guionPorId(db, memoria.guion_id) : guionVigente(db, id);
  return guion?.datos.memoria && memoriaValorable(guion.datos.memoria) ? { guion, memoria } : null;
}

// Lo que Hermes pudo leer de la memoria: sus apartados y, si se subió a mano, su texto entero
// (lo que quedó «sin apartado» o el documento sin repartir). null: no se puede comprobar.
function textosDeMemoria(db: Db, memoriaId: number): string[] | null {
  const m = db.prepare('SELECT subida FROM memorias WHERE id = ?').get(memoriaId) as
    { subida: string | null } | undefined;
  const textos = textosDeApartados(db, memoriaId);
  if (!m?.subida) return textos;
  const entero = textoDeVersionSubida(db, memoriaId);
  return entero === null ? null : [...textos, entero];
}

// Los genéricos de una memoria ensamblada deben estar en ella tal cual: la mejora los busca
// en su apartado para corregirlos. La presentada no se mejora (y puede no estar repartida).
function genericosLiterales(db: Db, memoria: MemoriaEvaluada, e: EvaluacionDatosData): Result<null> {
  if (db.prepare('SELECT 1 FROM memorias WHERE id = ? AND presentada > 0').get(memoria.id)) return ok(null);
  const genericos = e.genericos ?? [];
  const textos = genericos.length ? textosDeMemoria(db, memoria.id) : null;
  if (!textos) return ok(null);
  const donde = localizarCitas(
    textos,
    genericos.map((g) => g.texto),
  );
  const fuera = genericos.filter((_, i) => donde[i] === null).map((g) => `«${g.texto.slice(0, 80)}»`);
  if (!fuera.length) return ok(null);
  return fail(
    'invalid_input',
    `Estos «genericos» no están tal cual en la memoria v${memoria.version}: ${fuera.join(', ')}. Copia el texto del párrafo literalmente (hasta 300 caracteres; si lo recortas, une los trozos literales con «…»).`,
  );
}

// Manda el guion vigente, no el de la versión: si ya no puntúa la memoria, no se evalúa ni se
// guarda (la petición «Evaluar» y licitaciones_evaluacion, que puede llegar de un trabajo
// encolado antes). Sin esto la evaluación caía en los criterios de la ficha y su
// puntuacion_maxima = 0 se rechazaba en bucle.
function exigirQueSePuntue(db: Db, id: string, documento: string): Result<null> {
  const memoria = memoriaDeDocumento(db, id, documento);
  if (!memoria || memoriaSePuntua(db, { licitacion_id: id, guion_id: memoria.guion_id })) return ok(null);
  return fail(
    'invalid_input',
    'El pliego no puntúa esta memoria: no se evalúa. La mesa solo comprueba que está lo exigido.',
  );
}

function conLaVara(db: Db, id: string, documento: string, e: EvaluacionDatosData): Result<EvaluacionDatosData> {
  const { memoria: _deHermes, ...resto } = e;
  const vara = varaDeEvaluacion(db, id, documento);
  if (!vara) {
    const ficha = conCriteriosDeLaFicha(db, id, resto);
    return ficha.error ? ficha : ok(resto);
  }
  const problemas = problemasContraGuion(e.criterios, vara.guion.datos.memoria!.apartados, vara.guion.version);
  if (problemas.length)
    return fail('invalid_input', `${problemas.join(' ')} Corrige y vuelve a enviar la evaluación entera.`);
  if (!vara.memoria) return ok(resto);
  const literales = genericosLiterales(db, vara.memoria, e);
  return literales.error
    ? literales
    : ok({ ...resto, memoria: { version: vara.memoria.version, guion_id: vara.memoria.guion_id } });
}

/** Guarda la evaluación que envía Hermes, pendiente de revisar. Comprueba la licitación, su vara (guion o ficha) y el documento. */
export function guardarEvaluacion(
  db: Db,
  raices: Raices,
  e: EvaluacionEntradaData,
  agente: string,
): Result<{ evaluacion: number }> {
  const { id, documento, ...resto } = e;
  const parseados = EvaluacionDatos.safeParse(resto);
  if (!parseados.success) return fail('invalid_input', z.prettifyError(parseados.error));
  if (!db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const sePuntua = exigirQueSePuntue(db, id, documento);
  if (sePuntua.error) return sePuntua;
  const datos = conLaVara(db, id, documento, parseados.data);
  if (datos.error) return datos;
  const abs = archivoExistente(raices, documento);
  if (abs.error) return abs;
  const evaluacion = Number(
    db
      .prepare('INSERT INTO evaluaciones (licitacion_id, documento, datos, agente, creada_en) VALUES (?, ?, ?, ?, ?)')
      .run(id, documento, JSON.stringify(datos.data), agente, new Date().toISOString()).lastInsertRowid,
  );
  emitir(db, { tipo: 'licitacion.evaluacion', dominio: 'licitaciones', recurso: id, datos: { evaluacion, agente } });
  return ok({ evaluacion });
}

function aEvaluacion(f: Fila): Evaluacion | null {
  const datos = EvaluacionDatos.safeParse(JSON.parse(f.datos));
  if (datos.success) return { ...f, datos: datos.data };
  log.warn('evaluación guardada no válida', {
    evaluacion: f.id,
    campos: datos.error.issues
      .map((i) => i.path.join('.'))
      .slice(0, 10)
      .join(','),
  });
  return null;
}

/** Las últimas evaluaciones de una licitación salvo las descartadas. */
export function evaluacionesDe(db: Db, licitacionId: string, limite = 10): Evaluacion[] {
  const filas = db
    .prepare(
      `SELECT * FROM evaluaciones WHERE licitacion_id = ? AND estado <> 'descartada'
    ORDER BY creada_en DESC, id DESC LIMIT ?`,
    )
    .all(licitacionId, limite) as Fila[];
  return filas.map(aEvaluacion).filter((x): x is Evaluacion => x !== null);
}

export function evaluacionRecibida(db: Db, licitacionId: string, documento: string, desde: string): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM evaluaciones WHERE licitacion_id = ? AND documento = ? AND creada_en >= ?')
      .get(licitacionId, documento, desde),
  );
}

/** Encola la evaluación de un documento; exige ficha aprobada (sus criterios) y que el documento exista. */
export function pedirEvaluacion(
  dbNucleo: DbNucleo,
  dbLic: Db,
  raices: Raices,
  pedido: { id: string; documento: string },
): Result<{ trabajo: number }> {
  const { id, documento } = pedido;
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const sePuntua = exigirQueSePuntue(dbLic, id, documento);
  if (sePuntua.error) return sePuntua;
  const abs = archivoExistente(raices, documento);
  if (abs.error) return abs;
  if (!fichasDe(dbLic, id).aprobada)
    return fail('invalid_input', 'Esta licitación aún no tiene ficha: la evaluación puntúa con sus criterios.');
  const enCurso = dbNucleo
    .prepare(
      `SELECT id FROM trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.id') = ? AND json_extract(payload, '$.documento') = ?`,
    )
    .get(TIPO_EVALUACION, id, documento) as { id: number } | undefined;
  if (enCurso) return ok({ trabajo: enCurso.id });
  const pedida = new Date().toISOString();
  // La clave viaja como Idempotency-Key: el documento va como hash.
  const hash = crypto.createHash('sha256').update(documento).digest('hex').slice(0, 16);
  return ok({
    trabajo: encolarUnico(dbNucleo, {
      tipo: TIPO_EVALUACION,
      dominio: 'licitaciones',
      base: `evaluar-${id}-${hash}`,
      payload: { id, documento, pedida_en: pedida },
      aMano: true,
    }).id,
  });
}

// ── Evaluación de una memoria ensamblada (autoevaluación y «Mejorar») ──

/** La última evaluación (no descartada) de la memoria vN de una licitación. */
export function evaluacionDeMemoria(db: Db, licitacionId: string, version: number): Evaluacion | null {
  const f = db
    .prepare(
      `SELECT * FROM evaluaciones WHERE licitacion_id = ? AND estado <> 'descartada'
    AND json_extract(datos, '$.memoria.version') = ? ORDER BY creada_en DESC, id DESC LIMIT 1`,
    )
    .get(licitacionId, version) as Fila | undefined;
  return f ? aEvaluacion(f) : null;
}

/**
 * Da por desfasada (descartada) la evaluación de esa versión: su texto cambió después de
 * evaluarla y sus notas y citas ya no son de lo que dice. Devuelve cuántas se descartaron.
 */
export function descartarEvaluacionDeVersion(db: Db, licitacionId: string, version: number): number {
  return db
    .prepare(
      `UPDATE evaluaciones SET estado = 'descartada', revisado_en = ? WHERE licitacion_id = ? AND estado <> 'descartada'
    AND json_extract(datos, '$.memoria.version') = ?`,
    )
    .run(new Date().toISOString(), licitacionId, version).changes;
}

export function evaluacionPorId(db: Db, evaluacionId: number): Evaluacion | null {
  const f = db.prepare('SELECT * FROM evaluaciones WHERE id = ?').get(evaluacionId) as Fila | undefined;
  return f ? aEvaluacion(f) : null;
}

export type ResumenEvaluacionMemoria = {
  id: number;
  estado: EstadoRevision;
  puntuacion_total: number;
  puntuacion_maxima: number;
  por_apartado: { apartado: number; puntos: number; maximo: number; tramo: number | null }[];
  genericos: number;
};

export function resumenEvaluacionMemoria(ev: Evaluacion): ResumenEvaluacionMemoria {
  const por_apartado = ev.datos.criterios
    .flatMap((c) =>
      c.apartado === undefined
        ? []
        : [{ apartado: c.apartado, puntos: c.puntuacion, maximo: c.peso, tramo: c.tramo ?? null }],
    )
    .sort((a, b) => a.apartado - b.apartado);
  return {
    id: ev.id,
    estado: ev.estado,
    puntuacion_total: ev.datos.puntuacion_total,
    puntuacion_maxima: ev.datos.puntuacion_maxima,
    por_apartado,
    genericos: ev.datos.genericos?.length ?? 0,
  };
}

/** Apartados por debajo de su tramo máximo según la evaluación: los que «Mejorar» rehace por defecto. */
export function apartadosMejorables(ev: Evaluacion, guion: GuionGuardado): number[] {
  const apartados = guion.datos.memoria?.apartados ?? [];
  return ev.datos.criterios
    .flatMap((c) => {
      const a = c.apartado === undefined ? undefined : apartados[c.apartado - 1];
      return a && (c.tramo ?? c.puntuacion) < tramoMaximo(a) - 0.01 ? [c.apartado!] : [];
    })
    .sort((x, y) => x - y);
}

/** La evaluación de alguno de estos documentos que espera turno o corre en Hermes. */
export function evaluacionEnCurso(db: Db, id: string, documentos: string[]): EnCurso | null {
  if (!documentos.length) return null;
  const t = db
    .prepare(
      `SELECT estado, actualizado_en FROM nucleo.trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.id') = ? AND json_extract(payload, '$.documento') IN (${documentos.map(() => '?').join(', ')})
    ORDER BY id DESC LIMIT 1`,
    )
    .get(TIPO_EVALUACION, id, ...documentos) as { estado: string; actualizado_en: string } | undefined;
  return t ? { estado: t.estado === 'lanzado' ? 'generando' : 'en_cola', desde: t.actualizado_en } : null;
}

const TOPE_AUTOEVALUACIONES_DIA = 3;
const DIA_MS = 86_400_000;

// La clave `evaluacion-memoria-<id>-v<n>` cuenta cada autoevaluación de la oferta; el id puede
// llevar `_` o `%`, que LIKE tomaría por comodines. Las de la memoria de ensayo (su Word va en el
// payload) no cuentan: el ensayo no puede dejar sin nota a la memoria de verdad.
function autoevaluacionesHoy(dbNucleo: DbNucleo, dbLic: Db, id: string, ahoraMs: number): number {
  const patron = `evaluacion-memoria-${id.replace(/[!%_]/g, '!$&')}-%`;
  const ensayos = (
    dbLic
      .prepare(
        `SELECT b.ruta FROM borradores b JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND m.ensayo = 1`,
      )
      .all(id) as { ruta: string }[]
  ).map((b) => b.ruta);
  return (
    dbNucleo
      .prepare(
        `SELECT COUNT(*) AS n FROM trabajos_ia WHERE tipo = ? AND clave LIKE ? ESCAPE '!' AND creado_en >= ?
    AND (json_extract(payload, '$.documento') IS NULL OR json_extract(payload, '$.documento') NOT IN (SELECT value FROM json_each(?)))`,
      )
      .get(TIPO_EVALUACION, patron, new Date(ahoraMs - DIA_MS).toISOString(), JSON.stringify(ensayos)) as { n: number }
  ).n;
}

// Una versión posterior que una persona ya dio por buena deja sin sentido nota a la anterior.
function hayVersionAceptadaPosterior(dbLic: Db, m: { licitacion_id: string; version: number }): boolean {
  return (
    dbLic
      .prepare(
        `SELECT 1 FROM borradores b JOIN memorias mm ON mm.id = b.memoria_id
    WHERE mm.licitacion_id = ? AND mm.version > ? AND mm.ensayo = 0 AND b.origen = 'ensamblado' AND b.estado = 'aceptada' LIMIT 1`,
      )
      .get(m.licitacion_id, m.version) !== undefined
  );
}

type MemoriaAEvaluar = {
  licitacion_id: string;
  version: number;
  guion_id: number;
  ensayo?: number;
  presentada?: number;
};

function motivoDeOmision(dbNucleo: DbNucleo, dbLic: Db, m: MemoriaAEvaluar, ahoraMs: number): string | null {
  if (!memoriaSePuntua(dbLic, m)) return 'el guion vigente no puntúa la memoria';
  // Una memoria de ensayo se pide con el plazo vencido a propósito, y la presentada se sube tras
  // entregarla (memoriaPresentada.ts): el plazo no frena a ninguna de las dos.
  const plazo =
    m.ensayo === 1 || m.presentada === 1 ? null : guardaPlazo(dbLic, m.licitacion_id, 'evaluacion', { ahoraMs }).error;
  if (plazo) return plazo.message;
  if (hayVersionAceptadaPosterior(dbLic, m)) return 'hay una versión posterior ya aceptada';
  if (autoevaluacionesHoy(dbNucleo, dbLic, m.licitacion_id, ahoraMs) >= TOPE_AUTOEVALUACIONES_DIA)
    return `ya van ${TOPE_AUTOEVALUACIONES_DIA} autoevaluaciones de esta oferta en 24 h`;
  return null;
}

/** La plataforma evalúa sola cada memoria que ensambla (sin levantar el freno del tipo: no lo pidió una persona). Se omite, con su motivo, si no se puntúa, no da tiempo, hay una versión posterior aceptada o la oferta ya gastó su tope del día. */
export function pedirEvaluacionDeMemoria(
  dbNucleo: DbNucleo,
  dbLic: Db,
  m: MemoriaAEvaluar,
  documento: string,
  ahoraMs = Date.now(),
): { trabajo: number } | { omitida: string } {
  const omitida = motivoDeOmision(dbNucleo, dbLic, m, ahoraMs);
  if (omitida) {
    log.info('autoevaluación omitida', { licitacion: m.licitacion_id, version: m.version, motivo: omitida });
    return { omitida };
  }
  const payload = { id: m.licitacion_id, documento, pedida_en: new Date(ahoraMs).toISOString() };
  return {
    trabajo: encolar(dbNucleo, {
      tipo: TIPO_EVALUACION,
      dominio: 'licitaciones',
      clave: `evaluacion-memoria-${m.licitacion_id}-v${m.version}`,
      payload,
    }),
  };
}

// ── Instrucciones ──

const comoLeer = (documento: string) =>
  documento.startsWith('Salidas/')
    ? `salidas_leer (ruta «${documento.slice('Salidas/'.length)}»)`
    : `biblioteca_leer (ruta «${documento.slice('Conocimiento/'.length)}»)`;

function pasoComparables(id: string): string {
  const { presentadas } = carpetasLicitaciones();
  return `3. Compáralo con propuestas anteriores parecidas (tipo, área, cliente, presupuesto), primero con lo que ya presentamos: licitaciones_propuestas (id=${id}) trae en «parecidas» las del registro con su resultado, puntuaciones, carpeta y documentos (ganadas primero), y biblioteca_buscar con carpeta «${presentadas}» busca en todo lo presentado (DOCUMENTACION PRESENTADA de cada una). Solo si no basta, busca en toda la Biblioteca. licitaciones_comparables da adjudicaciones parecidas.`;
}

function pasosFicha(id: string, documento: string): string[] {
  return [
    `1. Lee la licitación con licitaciones_ver (id=${id}): los criterios de su ficha aprobada (go_no_go.ficha.aprobada.datos.criterios, con peso, tipo y subcriterios) son la vara de medir; los requisitos y la documentación, lo que no puede faltar. Si tiene lotes de interés (go_no_go.ambito.lotes), la propuesta es para esos lotes: mídela con su objeto e importe.`,
    `2. Lee el documento entero con ${comoLeer(documento)}, por partes y hasta el final (sigue con desde=hasta). Anota la sección y la página ([pág. N]) de lo que comentes.`,
    pasoComparables(id),
    `4. Envía licitaciones_evaluacion (id=${id}, documento=«${documento}»): resumen; por cada criterio de la ficha, peso, tipo, puntuación estimada (≤ peso) con justificación y referencia; puntuacion_total = suma de los criterios y puntuacion_maxima = suma de los pesos; qué eliminar, modificar y reforzar (cada uno con su referencia a sección o página); los comparables usados con en qué se parecen; y los riesgos. Sé exigente y concreto: una puntuación alta sin motivos no ayuda.`,
  ];
}

function lineasVara(vara: Vara): string[] {
  return [queEsElDocumento(vara), ...lineasGuion(vara.guion)];
}

function queEsElDocumento(vara: Vara): string {
  const m = vara.memoria;
  if (!m)
    return 'La licitación tiene guion de la oferta: el documento se mide con los apartados de su memoria técnica.';
  if (m.sin_repartir)
    return `Es la memoria técnica v${m.version}, subida a mano entera: no trae los títulos de los apartados del guion y no se reescribe por apartados. Mídela igual con cada apartado del guion, buscando en el documento dónde trata cada uno: tu evaluación dice cuánto puntuaría y qué debe corregir a mano el equipo.`;
  return `Es la memoria técnica v${m.version} que montó la plataforma con el guion de la oferta: tu evaluación decide qué apartados se reescriben (los que queden por debajo de su tramo máximo) y con qué indicaciones.`;
}

function lineasGuion(g: GuionGuardado): string[] {
  const mem = g.datos.memoria!;
  const total = puntosTexto(mem.apartados.reduce((s, a) => s + a.puntos, 0));
  return [
    `VARA DE MEDIR: los ${mem.apartados.length} apartados de la memoria del guion (v${g.version}), ${total} puntos. Puntúa como la mesa: con la escala literal del pliego, eligiendo para cada apartado el tramo que le daría y citándolo.`,
    ...mem.apartados.flatMap((a, i) => [
      `${i + 1}. «${a.titulo}» (${puntosTexto(a.puntos)} puntos). Se valorará: ${a.se_valorara.length ? a.se_valorara.join('; ') : 'el pliego no lo detalla'}.`,
      `   Escala: ${a.escala.length ? a.escala.map((t) => `${puntosTexto(t.puntos)} puntos: ${t.descripcion}`).join(' | ') : 'el pliego no la detalla'}.`,
    ]),
    `Advertencias del pliego (literales): ${mem.advertencias.length ? mem.advertencias.map((x) => `«${x}»`).join(' ') : 'ninguna'}.`,
  ];
}

// En una versión entera los genéricos no se sitúan en un apartado: se citan por su página.
const DONDE_GENERICO = {
  apartado: 'con referencia («N. Título del apartado»)',
  entera: 'con referencia (la página y la sección del documento, «pág. 12, Anexo I»)',
};

function pasosGuion(id: string, documento: string, entera: boolean): string[] {
  return [
    `1. licitaciones_ver (id=${id}) y licitaciones_oferta (id=${id}) dan el contexto (objeto, lotes, guion entero y decisiones del equipo). La vara es la de arriba: los criterios automáticos y el precio no se puntúan aquí.`,
    `2. Lee el documento entero con ${comoLeer(documento)}, por partes y hasta el final (sigue con desde=hasta). Anota el apartado y la página ([pág. N]) de lo que comentes.`,
    pasoComparables(id),
    `4. Envía licitaciones_evaluacion (id=${id}, documento=«${documento}»): resumen; «criterios», uno por apartado y en su orden, con apartado (1 = el primero), criterio (el título literal), peso (sus puntos), tipo juicio_valor, tramo (los puntos del tramo de la escala que le daría la mesa), puntuacion (los del tramo; nunca más), justificación que cite el tramo y lo que falta para el siguiente, y referencia; puntuacion_total y puntuacion_maxima, las sumas.`,
    `5. «genericos»: cada párrafo que la mesa no puntuaría (no dice quién, cuándo ni con qué medida; es meramente declarativo; o repite el pliego), ${DONDE_GENERICO[entera ? 'entera' : 'apartado']}, texto literal del documento (hasta 300 caracteres; si lo recortas, une los trozos literales con «…») y por qué. Qué eliminar, modificar y reforzar, con referencia que empiece por el número y título del apartado («2. Gestión de incidencias — Indicadores»); comparables y riesgos. Sé exigente y concreto: un tramo alto sin motivos no ayuda.`,
  ];
}

/** Instrucciones del run de evaluación; con la base, mide con el guion si toca (memoria ensamblada o guion con memoria). */
export function instruccionesEvaluacion(id: string, documento: string, db?: Db): string {
  const vara = db ? varaDeEvaluacion(db, id, documento) : null;
  return [
    `Tarea de la plataforma de ${db ? nombreEmpresa(db) : 'la empresa'}: evalúa la propuesta «${documento}» para la licitación ${id} (evaluador). No modifiques el documento.`,
    ...(vara
      ? [...lineasVara(vara), '', ...pasosGuion(id, documento, Boolean(vara.memoria?.sin_repartir))]
      : pasosFicha(id, documento)),
    `${vara ? 6 : 5}. Si la herramienta responde con un error, corrige lo que indique y vuelve a enviarla.`,
    'No hagas nada más: no escribas en Salidas ni en la Biblioteca y no respondas en ningún canal.',
  ].join('\n');
}
