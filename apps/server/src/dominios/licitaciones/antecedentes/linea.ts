// Línea de tiempo de las ediciones anteriores: una fila por adjudicación (o por edición
// sin adjudicar) con quién ganó, importe, baja, ofertas, duración y fechas del contrato.
import { z } from 'zod';
import { ESTADOS, nombreDe, RESULTADOS, RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import { lotesDeDatos, type LoteDatos } from '../lotes.js';
import type { Db } from '../store.js';
import type { Encontrada } from './ediciones.js';

const Fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .transform((s) => s.slice(0, 10))
  .nullable()
  .catch(null);
export const Duracion = z.object({ valor: z.number(), unidad: z.string() }).nullable().catch(null);
// licitaciones.datos: las versiones guardadas antes no traen periodo ni el inicio de cada resultado.
const DatosEdicion = z
  .object({
    duracion: Duracion.optional().transform((d) => d ?? null),
    periodo: z
      .object({ inicio: Fecha, fin: Fecha })
      .nullable()
      .optional()
      .catch(null)
      .transform((p) => p ?? null),
    resultados: z
      .array(z.object({ lote: z.string().nullable().catch(null), inicio: Fecha.optional() }).catch({ lote: null }))
      .catch([]),
  })
  .catch({ duracion: null, periodo: null, resultados: [] });
export type DuracionData = z.infer<typeof Duracion>;

type Adjudicacion = {
  lote: string;
  resultado: string | null;
  fecha: string | null;
  ofertas: number | null;
  adjudicatario_nif: string | null;
  adjudicatario_nombre: string | null;
  importe_sin_iva: number | null;
  presupuesto_sin_iva: number | null;
  baja: number | null;
};

export type DetalleEdicion = {
  lotes: LoteDatos[];
  duracion: DuracionData;
  periodo: { inicio: string | null; fin: string | null } | null;
  inicios: Map<string, string>;
  adjudicaciones: Adjudicacion[];
};

export function detalleEdicion(db: Db, id: string): DetalleEdicion {
  const fila = db.prepare('SELECT datos FROM licitaciones WHERE id = ?').get(id) as { datos: string } | undefined;
  const datos = DatosEdicion.parse(leerJson(fila?.datos));
  const inicios = new Map(datos.resultados.filter((r) => r.inicio).map((r) => [r.lote ?? '', r.inicio as string]));
  const adjudicaciones = db
    .prepare(
      `SELECT lote, resultado, fecha, ofertas, adjudicatario_nif, adjudicatario_nombre, importe_sin_iva,
    presupuesto_sin_iva, baja FROM adjudicaciones WHERE licitacion_id = ? ORDER BY ord`,
    )
    .all(id) as Adjudicacion[];
  return {
    lotes: fila ? lotesDeDatos(fila.datos) : [],
    duracion: datos.duracion,
    periodo: datos.periodo,
    inicios,
    adjudicaciones,
  };
}

export function leerJson(texto: string | undefined): unknown {
  try {
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
}

// Una fila de la línea de tiempo. fin_estimado: el órgano no publicó el fin y se calcula
// con el inicio y la duración.
export type Hito = {
  licitacion_id: string;
  anio: string;
  fecha: string;
  expediente: string;
  titulo: string;
  url: string | null;
  estado: string;
  similitud: number;
  cpv_comun: string | null;
  lote: string | null;
  lote_nombre: string | null;
  presupuesto: number | null;
  resultado: string | null;
  adjudicada: boolean;
  adjudicatario_nif: string | null;
  adjudicatario_nombre: string | null;
  importe: number | null;
  baja: number | null;
  ofertas: number | null;
  duracion: DuracionData;
  inicio: string | null;
  fin: string | null;
  fin_estimado: boolean;
};

// Días de las unidades que se suman por días; meses y años se suman en el calendario.
const DIAS: Record<string, number> = { DAY: 1, WEE: 7 };
const UNIDADES = new Set(['DAY', 'WEE', 'MON', 'ANN']);

/** Fecha + duración CODICE (DAY, WEE, MON, ANN) → AAAA-MM-DD; null si la unidad no se conoce. */
export function sumarDuracion(fecha: string, d: NonNullable<DuracionData>): string | null {
  const t = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || !UNIDADES.has(d.unidad)) return null;
  if (d.unidad === 'MON') t.setUTCMonth(t.getUTCMonth() + d.valor);
  else if (d.unidad === 'ANN') t.setUTCFullYear(t.getUTCFullYear() + d.valor);
  else t.setUTCDate(t.getUTCDate() + d.valor * (DIAS[d.unidad] ?? 1));
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

function fechas(d: DetalleEdicion, lote: string): Pick<Hito, 'inicio' | 'fin' | 'fin_estimado'> {
  const inicio = d.inicios.get(lote) ?? d.inicios.get('') ?? d.periodo?.inicio ?? null;
  if (d.periodo?.fin) return { inicio, fin: d.periodo.fin, fin_estimado: false };
  const fin = inicio && d.duracion ? sumarDuracion(inicio, d.duracion) : null;
  return { inicio, fin, fin_estimado: fin !== null };
}

type Base = Pick<
  Hito,
  | 'licitacion_id'
  | 'anio'
  | 'fecha'
  | 'expediente'
  | 'titulo'
  | 'url'
  | 'estado'
  | 'similitud'
  | 'cpv_comun'
  | 'duracion'
>;

function base(e: Encontrada, d: DetalleEdicion): Base {
  return {
    licitacion_id: e.id,
    anio: e.fecha.slice(0, 4),
    fecha: e.fecha,
    expediente: e.expediente,
    titulo: e.titulo,
    url: e.url,
    estado: nombreDe(ESTADOS, e.estado) ?? e.estado,
    similitud: e.similitud,
    cpv_comun: e.cpv_comun,
    duracion: d.duracion,
  };
}

function hitoDe(e: Encontrada, d: DetalleEdicion, a: Adjudicacion): Hito {
  const adjudicada = a.resultado !== null && RESULTADOS_ADJUDICADOS.has(a.resultado);
  return {
    ...base(e, d),
    lote: a.lote || null,
    lote_nombre: d.lotes.find((l) => l.id === a.lote)?.nombre ?? null,
    presupuesto: a.presupuesto_sin_iva,
    resultado: nombreDe(RESULTADOS, a.resultado),
    adjudicada,
    adjudicatario_nif: adjudicada ? a.adjudicatario_nif : null,
    adjudicatario_nombre: adjudicada ? a.adjudicatario_nombre : null,
    importe: adjudicada ? a.importe_sin_iva : null,
    baja: adjudicada ? a.baja : null,
    ofertas: a.ofertas,
    ...fechas(d, a.lote),
  };
}

function sinAdjudicar(e: Encontrada, d: DetalleEdicion, lote: LoteDatos | null): Hito {
  return {
    ...base(e, d),
    lote: lote?.id ?? null,
    lote_nombre: lote?.nombre ?? null,
    presupuesto: lote ? lote.presupuesto_sin_iva : e.presupuesto,
    resultado: null,
    adjudicada: false,
    adjudicatario_nif: null,
    adjudicatario_nombre: null,
    importe: null,
    baja: null,
    ofertas: null,
    ...fechas(d, lote?.id ?? ''),
  };
}

/** Filas de una edición: todas sus adjudicaciones o solo las de `lote` (id del lote de la edición). */
export function hitosDe(e: Encontrada, d: DetalleEdicion, lote: string | null = null): Hito[] {
  const filas = lote === null ? d.adjudicaciones : d.adjudicaciones.filter((a) => a.lote === lote);
  if (filas.length) return filas.map((a) => hitoDe(e, d, a));
  return [sinAdjudicar(e, d, lote === null ? null : (d.lotes.find((l) => l.id === lote) ?? null))];
}
