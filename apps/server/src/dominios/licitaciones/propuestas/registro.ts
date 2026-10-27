// Registro de propuestas presentadas: lo escribe una persona en la web. Es un hecho, no IA.
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { RutaDocumento } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import type { comprobacionesDe as ComprobacionesDe } from '../oferta/comprobaciones.js';
import { cancelarCarpetaPresentada, pedirCarpetaPresentada, pedirCopiaPaquete } from '../presentadas.js';
import { sincronizarOportunidad } from './oportunidad.js';
import { leccionesDeResolucion } from './leccionesResultado.js';

// Se anota cuándo, por cuánto, con qué documentos y, cuando se sabe, el resultado y las puntuaciones. Al
// registrarla la oportunidad pasa a «presentada» y se pide su carpeta en Conocimiento/…/Presentadas
// (presentadas.ts); el resultado lo pone la PLACSP al publicar la adjudicación (resolucion.ts) o una persona.
const log = logger('licitaciones');

// Las comprobaciones se cargan aparte: importarlas aquí cerraría un ciclo (comprobaciones → dossier → parecidas →
// registro) que evalúa decisionesSecciones antes que decisiones. Llega en cuanto termina de
// cargar el servidor; mientras no esté, el registro de un paquete se rechaza (no se salta la guardia).
let comprobacionesDe: typeof ComprobacionesDe | null = null;
import('../oferta/comprobaciones.js')
  .then((m) => {
    comprobacionesDe = m.comprobacionesDe;
  })
  .catch((err: unknown) => log.error('comprobaciones sin cargar para el registro', { error: errorMessage(err) }));

export const RESULTADOS_PROPUESTA = ['pendiente', 'ganada', 'perdida', 'excluida', 'desierta', 'retirada'] as const;
export type ResultadoPropuesta = (typeof RESULTADOS_PROPUESTA)[number];

const Fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');
const Importe = z.number().finite().positive().max(1e11);
const Puntos = z.number().finite().min(0).max(1000).nullable();
const Notas = z.string().max(5000);
// Los lotes de la PLACSP son códigos cortos («1», «2A»); vacío = el contrato entero.
const Lote = z
  .string()
  .trim()
  .max(20)
  .regex(/^[A-Za-z0-9 ._-]*$/, 'lote: el código del lote, p. ej. «1»');
const sinRepetidos = (xs: string[]) => new Set(xs).size === xs.length;

export const NuevaPropuesta = z
  .strictObject({
    lote: Lote.default(''),
    presentada_en: Fecha.optional().describe('Por defecto, hoy'),
    importe_ofertado: Importe.nullable().default(null).describe('Sin IVA'),
    presupuesto: Importe.optional().describe(
      'Presupuesto sin IVA con el que calcular la baja; por defecto el del lote o el de la licitación. Con precio_unitario, el precio unitario máximo',
    ),
    precio_unitario: Importe.optional().describe(
      'Si se ofertó un precio por unidad (p. ej., €/informe): la baja se calcula sobre el precio máximo',
    ),
    unidad: z.string().trim().min(1).max(40).optional().describe('La unidad del precio unitario: «informe», «alumno»'),
    paquete_version: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('La versión del paquete de presentación que se presentó: se copia a DOCUMENTACION PRESENTADA'),
    documentos: z.array(RutaDocumento).max(20).refine(sinRepetidos, 'documentos repetidos').default([]),
    notas: Notas.default(''),
    forzar_motivo: z
      .string()
      .trim()
      .min(15)
      .max(500)
      .optional()
      .describe('Por qué se registra el paquete aunque las comprobaciones tengan filas que impiden presentarlo'),
  })
  .refine((p) => (p.unidad === undefined) === (p.precio_unitario === undefined), {
    message: 'El precio unitario va con su unidad.',
    path: ['unidad'],
  });
export type NuevaPropuestaData = z.infer<typeof NuevaPropuesta>;

export const CambioPropuesta = z
  .strictObject({
    presentada_en: Fecha.optional(),
    importe_ofertado: Importe.nullable().optional(),
    presupuesto: Importe.nullable().optional(),
    documentos: z.array(RutaDocumento).max(20).refine(sinRepetidos, 'documentos repetidos').optional(),
    resultado: z.enum(RESULTADOS_PROPUESTA).optional(),
    puntos_tecnica: Puntos.optional(),
    puntos_economica: Puntos.optional(),
    puntos_total: Puntos.optional(),
    posicion: z.number().int().min(1).max(500).nullable().optional(),
    puntos_ganador: Puntos.optional(),
    notas: Notas.optional(),
    lecciones: Notas.optional(),
  })
  .refine((c) => Object.keys(c).length > 0, 'Indica algún cambio.');
export type CambioPropuestaData = z.infer<typeof CambioPropuesta>;

type Fila = {
  id: number;
  licitacion_id: string;
  lote: string;
  presentada_en: string;
  importe_ofertado: number | null;
  presupuesto: number | null;
  baja_ofertada: number | null;
  documentos: string;
  resultado: ResultadoPropuesta;
  resultado_origen: 'placsp' | 'manual' | null;
  puntos_tecnica: number | null;
  puntos_economica: number | null;
  puntos_total: number | null;
  posicion: number | null;
  puntos_ganador: number | null;
  ganador_nif: string | null;
  ganador_nombre: string | null;
  importe_ganador: number | null;
  baja_ganadora: number | null;
  notas: string;
  lecciones: string;
  creada_en: string;
  actualizada_en: string;
  resuelta_en: string | null;
  unidad: string | null;
  precio_unitario: number | null;
  paquete_version: number | null;
  forzado_motivo: string | null;
};
export type Propuesta = Omit<Fila, 'documentos'> & { documentos: string[] };

export function aPropuesta(f: Fila): Propuesta {
  const docs = z.array(z.string()).catch([]).parse(JSON.parse(f.documentos));
  return { ...f, documentos: docs };
}

/** Baja de la oferta: 1 − importe / presupuesto, con cuatro decimales (como las adjudicaciones). */
export function bajaOfertada(importe: number | null, presupuesto: number | null): number | null {
  if (importe === null || presupuesto === null || presupuesto <= 0) return null;
  return Math.round((1 - importe / presupuesto) * 10_000) / 10_000;
}

const DatosLotes = z
  .object({
    lotes: z.array(z.object({ id: z.string(), presupuesto_sin_iva: z.number().nullable().catch(null) })).catch([]),
  })
  .catch({ lotes: [] });

type Licitacion = { presupuesto_sin_iva: number | null; datos: string };

/** Ids de los lotes de una licitación (vacío si no tiene lotes). */
export function lotesDe(datos: string): string[] {
  return DatosLotes.parse(JSON.parse(datos)).lotes.map((l) => l.id);
}

/** Presupuesto del lote pedido (o de la licitación, sin lote); error si el lote no existe. */
function presupuestoDe(l: Licitacion, lote: string): Result<number | null> {
  const lotes = DatosLotes.parse(JSON.parse(l.datos)).lotes;
  if (lote === '') return ok(l.presupuesto_sin_iva);
  const encontrado = lotes.find((x) => x.id === lote);
  if (!encontrado)
    return fail(
      'invalid_input',
      lotes.length
        ? `La licitación no tiene el lote «${lote}» (lotes: ${lotes.map((x) => x.id).join(', ')}).`
        : 'La licitación no tiene lotes: deja el lote vacío.',
    );
  return ok(encontrado.presupuesto_sin_iva ?? l.presupuesto_sin_iva);
}

export function obtenerPropuesta(db: Db, id: number): Propuesta | null {
  const f = db.prepare('SELECT * FROM propuestas WHERE id = ?').get(id) as Fila | undefined;
  return f ? aPropuesta(f) : null;
}

export function propuestasDe(db: Db, licitacionId: string): Propuesta[] {
  return (
    db.prepare('SELECT * FROM propuestas WHERE licitacion_id = ? ORDER BY lote, id').all(licitacionId) as Fila[]
  ).map(aPropuesta);
}

// Presentar es una decisión del equipo: la oportunidad queda «presentada» y puesta a mano
// (los descartes automáticos ya no la tocan). Si ya estaba ganada o perdida por otro lote, la
// recalcula sincronizarOportunidad con la propuesta nueva.
function marcarPresentada(db: Db, id: string, ts: string): void {
  db.prepare(
    `INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, rescatada, cambiada_a_mano, creada_en, actualizada_en)
    VALUES (?, 'presentada', 'propuesta registrada a mano', 1, 1, ?, ?)
    ON CONFLICT(licitacion_id) DO UPDATE SET estado = 'presentada', cambiada_a_mano = 1, actualizada_en = excluded.actualizada_en
    WHERE oportunidades.estado NOT IN ('presentada', 'ganada', 'perdida')`,
  ).run(id, ts, ts);
  sincronizarOportunidad(db, id, ts);
}

const ESTADOS_ABIERTOS: ReadonlySet<string> = new Set(['abierto', 'propuesta']);
const TITULOS_EN_AVISO = 3;

function textoImpiden(titulos: readonly string[]): string {
  const vistos = titulos.slice(0, TITULOS_EN_AVISO).join('; ');
  const resto = titulos.length - TITULOS_EN_AVISO;
  return resto > 0 ? `${vistos} y ${resto} más` : vistos;
}

// Registrar el paquete es decir «lo presentamos»: si las comprobaciones tienen filas que lo impiden, solo
// con un motivo, que queda guardado. Sin paquete_version (registros de fuera de Hermes, como los
// de ofertas antiguas) no hay comprobaciones contra las que medir y no se frena. Devuelve el motivo a guardar.
function guardiaImpiden(db: Db, licitacionId: string, p: NuevaPropuestaData): Result<string | null> {
  if (!p.paquete_version) return ok(null);
  if (!comprobacionesDe)
    return fail('no_configurado', 'Las comprobaciones aún no están listas: vuelve a intentarlo en unos segundos.');
  const c = comprobacionesDe(db, nucleo().db, licitacionId);
  if (c.error) return c;
  const impiden = c.data.bloqueos.filter((b) => b.gravedad === 'impide' && ESTADOS_ABIERTOS.has(b.estado));
  if (!impiden.length) return ok(null);
  if (!p.forzar_motivo)
    return fail(
      'impide_abierto',
      `No se puede registrar: ${textoImpiden(impiden.map((b) => b.titulo))}. Resuélvelo o registra con un motivo.`,
    );
  // El motivo es texto libre de la persona: se guarda en la propuesta, no en el log.
  log.warn('registro forzado con impiden', { licitacion: licitacionId, n: impiden.length });
  return ok(p.forzar_motivo);
}

/** Registra la presentación de una oferta (una por licitación y lote). */
export function registrarPropuesta(db: Db, licitacionId: string, p: NuevaPropuestaData): Result<Propuesta> {
  const l = db.prepare('SELECT presupuesto_sin_iva, datos FROM licitaciones WHERE id = ?').get(licitacionId) as
    Licitacion | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${licitacionId}».`);
  const base = presupuestoDe(l, p.lote);
  if (base.error) return base;
  const forzado = guardiaImpiden(db, licitacionId, p);
  if (forzado.error) return forzado;
  if (db.prepare('SELECT 1 FROM propuestas WHERE licitacion_id = ? AND lote = ?').get(licitacionId, p.lote)) {
    return fail(
      'conflicto',
      `Ya hay una propuesta registrada para ${p.lote ? `el lote ${p.lote}` : 'esta licitación'}: edítala.`,
    );
  }
  const ts = new Date().toISOString();
  // Con precio unitario, «presupuesto» es el precio máximo: la baja sale del precio, no de un total.
  const presupuesto = p.presupuesto ?? (p.precio_unitario === undefined ? base.data : null);
  const baja = bajaOfertada(p.precio_unitario ?? p.importe_ofertado, presupuesto);
  const presentadaEn = p.presentada_en ?? ts.slice(0, 10);
  const id = db.transaction(() => {
    const nueva = Number(
      db
        .prepare(
          `INSERT INTO propuestas (licitacion_id, lote, presentada_en, importe_ofertado, presupuesto, baja_ofertada,
        documentos, notas, creada_en, actualizada_en, unidad, precio_unitario, paquete_version, forzado_motivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          licitacionId,
          p.lote,
          presentadaEn,
          p.importe_ofertado,
          presupuesto,
          baja,
          JSON.stringify(p.documentos),
          p.notas,
          ts,
          ts,
          p.unidad ?? null,
          p.precio_unitario ?? null,
          p.paquete_version ?? null,
          forzado.data,
        ).lastInsertRowid,
    );
    marcarPresentada(db, licitacionId, ts);
    pedirCarpetaPresentada(db, licitacionId, presentadaEn);
    if (p.paquete_version) pedirCopiaPaquete(db, licitacionId, p.paquete_version);
    return nueva;
  })();
  emitir(db, {
    tipo: 'licitacion.propuesta',
    dominio: 'licitaciones',
    recurso: licitacionId,
    datos: { propuesta: id, accion: 'registrada' },
  });
  return ok(obtenerPropuesta(db, id)!);
}

// Resultado puesto por una persona: manda sobre la PLACSP. La oportunidad se recalcula con
// todas sus propuestas (sincronizarOportunidad).
function columnasResultado(resultado: ResultadoPropuesta | undefined, ts: string): Record<string, unknown> {
  if (resultado === undefined) return {};
  if (resultado === 'pendiente') return { resultado, resultado_origen: null, resuelta_en: null };
  return { resultado, resultado_origen: 'manual', resuelta_en: ts };
}

function columnasCambio(previa: Propuesta, c: CambioPropuestaData, ts: string): Record<string, unknown> {
  const { documentos, resultado, ...resto } = c;
  const importe = c.importe_ofertado !== undefined ? c.importe_ofertado : previa.importe_ofertado;
  const presupuesto = c.presupuesto !== undefined ? c.presupuesto : previa.presupuesto;
  return {
    ...resto,
    ...columnasResultado(resultado, ts),
    ...(documentos ? { documentos: JSON.stringify(documentos) } : {}),
    baja_ofertada: bajaOfertada(previa.precio_unitario ?? importe, presupuesto),
    actualizada_en: ts,
  };
}

/** Cambio hecho por una persona: datos de la oferta, resultado, puntuaciones, notas y lecciones. */
export function cambiarPropuesta(db: Db, id: number, c: CambioPropuestaData): Result<Propuesta> {
  const previa = obtenerPropuesta(db, id);
  if (!previa) return fail('not_found', `No hay ninguna propuesta con id ${id}.`);
  const ts = new Date().toISOString();
  // Volver a mandar el mismo resultado (al guardar solo los puntos) no lo pasa a «manual».
  const resultado = c.resultado !== previa.resultado ? c.resultado : undefined;
  const cols = columnasCambio(previa, { ...c, resultado }, ts);
  // Los nombres de columna salen del esquema zod estricto, nunca de la entrada.
  const sets = Object.keys(cols)
    .map((k) => `${k} = @${k}`)
    .join(', ');
  db.transaction(() => {
    db.prepare(`UPDATE propuestas SET ${sets} WHERE id = @id`).run({ ...cols, id });
    if (resultado) {
      sincronizarOportunidad(db, previa.licitacion_id, ts);
      leccionesDeResolucion(db, id);
    }
  })();
  emitir(db, {
    tipo: 'licitacion.propuesta',
    dominio: 'licitaciones',
    recurso: previa.licitacion_id,
    datos: { propuesta: id, accion: 'cambiada', ...(resultado ? { resultado } : {}) },
  });
  return ok(obtenerPropuesta(db, id)!);
}

/** Borra un registro hecho por error. La oportunidad se queda en su estado; si era la última, la carpeta de lo presentado aún sin crear se cancela. */
export function borrarPropuesta(db: Db, id: number): Result<{ borrada: number }> {
  const previa = obtenerPropuesta(db, id);
  if (!previa) return fail('not_found', `No hay ninguna propuesta con id ${id}.`);
  db.transaction(() => {
    db.prepare('DELETE FROM propuestas WHERE id = ?').run(id);
    cancelarCarpetaPresentada(db, previa.licitacion_id);
  })();
  emitir(db, {
    tipo: 'licitacion.propuesta',
    dominio: 'licitaciones',
    recurso: previa.licitacion_id,
    datos: { propuesta: id, accion: 'borrada' },
  });
  return ok({ borrada: id });
}

const NO_SE_DESHACE =
  'Solo se deshace una presentación aún sin resultado: si ya tiene uno, bórralo antes en la ficha (Presentación).';

/**
 * Devuelve a «En preparación» una oferta presentada por error (arrastrarla en el Pipeline):
 * borra sus propuestas, todas aún pendientes, y la carpeta de lo presentado que no se haya creado.
 * Con algún resultado anotado no se deshace: se perderían puntos y lecciones sin avisar.
 */
export function deshacerPresentacion(
  db: Db,
  licitacionId: string,
): Result<{ estado: 'en_preparacion'; borradas: number }> {
  const op = db.prepare('SELECT estado FROM oportunidades WHERE licitacion_id = ?').get(licitacionId) as
    { estado: string } | undefined;
  if (!op) return fail('not_found', 'Esa licitación no es una oportunidad.');
  if (op.estado !== 'presentada') return fail('invalid_input', NO_SE_DESHACE);
  const resultados = db.prepare('SELECT resultado FROM propuestas WHERE licitacion_id = ?').all(licitacionId) as {
    resultado: string;
  }[];
  if (resultados.some((r) => r.resultado !== 'pendiente')) return fail('invalid_input', NO_SE_DESHACE);
  const ts = new Date().toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM propuestas WHERE licitacion_id = ?').run(licitacionId);
    cancelarCarpetaPresentada(db, licitacionId);
    db.prepare(
      `UPDATE oportunidades SET estado = 'en_preparacion', cambiada_a_mano = 1, actualizada_en = ? WHERE licitacion_id = ?`,
    ).run(ts, licitacionId);
  })();
  emitir(db, {
    tipo: 'licitacion.propuesta',
    dominio: 'licitaciones',
    recurso: licitacionId,
    datos: { accion: 'deshecha', borradas: resultados.length },
  });
  return ok({ estado: 'en_preparacion', borradas: resultados.length });
}

export const FiltroPropuestas = z.object({
  resultado: z.enum(RESULTADOS_PROPUESTA).optional(),
  texto: z.string().trim().min(2).max(100).optional(),
  limite: z.number().int().min(1).max(200).default(50),
});
export type FiltroPropuestasData = z.infer<typeof FiltroPropuestas>;

export type PropuestaConLicitacion = Propuesta & {
  titulo: string;
  expediente: string;
  organo: string;
  organo_nif: string | null;
  cpvs: string;
};

/** Histórico de propuestas, de la más reciente a la más antigua, con su licitación. */
export function listarPropuestas(db: Db, f: FiltroPropuestasData): { total: number; items: PropuestaConLicitacion[] } {
  const conds = [
    f.resultado ? 'p.resultado = @resultado' : '',
    f.texto ? '(l.titulo LIKE @texto OR l.organo_nombre LIKE @texto OR l.expediente LIKE @texto)' : '',
  ].filter(Boolean);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const args = {
    resultado: f.resultado ?? null,
    texto: f.texto ? `%${f.texto.replace(/[%_]/g, '')}%` : null,
    limite: f.limite,
  };
  const desde = `FROM propuestas p JOIN licitaciones l ON l.id = p.licitacion_id ${where}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${desde}`).get(args) as { n: number }).n;
  const filas = db
    .prepare(
      `SELECT p.*, l.titulo, l.expediente, l.organo_nombre AS organo, l.organo_nif, l.cpvs ${desde}
    ORDER BY p.presentada_en DESC, p.id DESC LIMIT @limite`,
    )
    .all(args) as (Fila & Omit<PropuestaConLicitacion, keyof Propuesta>)[];
  return { total, items: filas.map((x) => ({ ...x, ...aPropuesta(x) })) };
}
