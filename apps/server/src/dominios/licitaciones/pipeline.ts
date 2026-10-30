// El Pipeline: las ofertas en curso en cinco columnas, cada una ordenada por fecha de cierre.
import type { Db } from './store.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import { resumenDeComprobaciones } from './oferta/preparacion.js';
import { tituloCorto } from './tituloCorto.js';
import { responsablesDe, type Responsable } from './responsable.js';

export { tituloCorto };

// Columnas: En preparación → Lista para firmar → Presentada → En evaluación → Resuelta. «Lista para firmar» sale
// del veredicto de las comprobaciones; las tres últimas se mueven solas con la PLACSP (estado de la licitación
// y resultado de la oportunidad). La tarjeta lleva solo expediente, cierre, título corto, importe y la carpeta
// de Drive, y el avatar de quien la lleva. Debajo, el aviso de las oportunidades que pueden encajar y están por
// revisar.
export const COLUMNAS = [
  { clave: 'en_preparacion', titulo: 'En preparación' },
  { clave: 'lista_para_firmar', titulo: 'Lista para firmar' },
  { clave: 'presentada', titulo: 'Presentada' },
  { clave: 'en_evaluacion', titulo: 'En evaluación' },
  { clave: 'resuelta', titulo: 'Resuelta' },
] as const;
export type ColumnaPipeline = (typeof COLUMNAS)[number]['clave'];

export type TarjetaPipeline = {
  id: string;
  expediente: string;
  titulo: string;
  titulo_corto: string;
  organo: string;
  importe: number | null;
  fecha_limite: string | null;
  columna: ColumnaPipeline;
  resultado: 'ganada' | 'perdida' | null;
  responsable: Responsable | null;
};
type AvisoPorRevisar = {
  total: number;
  proximas: {
    id: string;
    titulo_corto: string;
    fecha_limite: string | null;
    importe: number | null;
    veredicto_ia: string | null;
  }[];
};
export type Pipeline = {
  columnas: { clave: ColumnaPipeline; titulo: string; tarjetas: TarjetaPipeline[] }[];
  por_revisar: AvisoPorRevisar;
};

const RESUELTA_PLACSP = new Set(['ADJ', 'RES']);

/**
 * La columna de una oferta de la empresa. Ganada o perdida: Resuelta. Presentada: Resuelta si la PLACSP
 * ya adjudicó, En evaluación si cerró el plazo, Presentada mientras sigue abierto. En preparación:
 * Lista para firmar si las comprobaciones lo dicen.
 */
export function columnaDe(
  o: { estado: string; estado_placsp: string; fecha_limite: string | null; veredicto: string | null },
  hoy: string,
): ColumnaPipeline {
  if (o.estado === 'ganada' || o.estado === 'perdida') return 'resuelta';
  if (o.estado === 'presentada') {
    if (RESUELTA_PLACSP.has(o.estado_placsp)) return 'resuelta';
    return o.estado_placsp === 'EV' || (o.fecha_limite !== null && o.fecha_limite <= hoy)
      ? 'en_evaluacion'
      : 'presentada';
  }
  return o.veredicto === 'lista_para_firmar' ? 'lista_para_firmar' : 'en_preparacion';
}

type Fila = {
  id: string;
  expediente: string;
  titulo: string;
  organo_nombre: string;
  presupuesto_sin_iva: number | null;
  fecha_limite: string | null;
  estado: string;
  op_estado: string;
  titulo_ficha: string | null;
  veredicto_ia: string | null;
};

export const TITULO_FICHA = `(SELECT json_extract(fi.datos, '$.titulo_corto') FROM fichas fi
  WHERE fi.licitacion_id = l.id AND fi.estado = 'aprobada' ORDER BY fi.id DESC LIMIT 1) AS titulo_ficha`;
const SELECT = `SELECT l.id, l.expediente, l.titulo, l.organo_nombre, l.presupuesto_sin_iva, l.fecha_limite, l.estado,
  o.estado AS op_estado, o.veredicto_ia, ${TITULO_FICHA} FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id`;
// Lo resuelto se queda un año en el tablero: después, en Presentadas.
const DIAS_RESUELTAS = 365;
const MAX_RESUELTAS = 20;

/** El título de la tarjeta: el corto que propuso Hermes en la ficha o, si no hay, el recorte por código. */
export const corto = (f: Pick<Fila, 'titulo' | 'titulo_ficha'>) =>
  f.titulo_ficha?.trim() ? f.titulo_ficha.trim() : tituloCorto(f.titulo);
const porCierre = (a: TarjetaPipeline, b: TarjetaPipeline) =>
  (a.fecha_limite ?? '9999').localeCompare(b.fecha_limite ?? '9999');

function tarjeta(db: Db, f: Fila, hoy: string, ahoraMs: number): Omit<TarjetaPipeline, 'responsable'> {
  const veredicto =
    f.op_estado === 'en_preparacion' ? (resumenDeComprobaciones(db, f.id, ahoraMs)?.veredicto.tipo ?? null) : null;
  const columna = columnaDe(
    { estado: f.op_estado, estado_placsp: f.estado, fecha_limite: f.fecha_limite, veredicto },
    hoy,
  );
  return {
    id: f.id,
    expediente: f.expediente,
    titulo: f.titulo,
    titulo_corto: corto(f),
    organo: f.organo_nombre,
    importe: f.presupuesto_sin_iva,
    fecha_limite: f.fecha_limite,
    columna,
    resultado: f.op_estado === 'ganada' || f.op_estado === 'perdida' ? f.op_estado : null,
  };
}

/** Una oportunidad nueva cuyo proceso falló y no tiene ficha: va a la pestaña Errores, no a Por revisar. */
export const SQL_CON_ERROR = `(o.estado = 'nueva' AND o.error_proceso IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM fichas fi WHERE fi.licitacion_id = o.licitacion_id AND fi.estado = 'aprobada'))`;

// Lo mismo que cuenta la pestaña Por revisar de Oportunidades: nuevas, abiertas y sin error.
const DONDE_POR_REVISAR = `WHERE o.estado = 'nueva' AND l.borrada_en IS NULL AND l.fecha_limite > ? AND NOT ${SQL_CON_ERROR}`;

/** Cuántas esperan revisión: la cuenta de Oportunidades en el menú y la del aviso del Pipeline. */
export function totalPorRevisar(db: Db, hoy: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id ${DONDE_POR_REVISAR}`,
      )
      .get(hoy) as { n: number }
  ).n;
}

function porRevisar(db: Db, hoy: string): AvisoPorRevisar {
  const donde = DONDE_POR_REVISAR;
  const total = totalPorRevisar(db, hoy);
  const filas = db.prepare(`${SELECT} ${donde} ORDER BY l.fecha_limite ASC LIMIT 4`).all(hoy) as Fila[];
  return {
    total,
    proximas: filas.map((f) => ({
      id: f.id,
      titulo_corto: corto(f),
      fecha_limite: f.fecha_limite,
      importe: f.presupuesto_sin_iva,
      veredicto_ia: f.veredicto_ia,
    })),
  };
}

/** El tablero entero: las cinco columnas con sus tarjetas y el aviso de lo que está por revisar. */
export function pipeline(db: Db, ahoraMs = Date.now()): Pipeline {
  const hoy = horaLocalEspana(ahoraMs);
  const desde = horaLocalEspana(ahoraMs - DIAS_RESUELTAS * 86_400_000);
  const filas = db
    .prepare(
      `${SELECT} WHERE o.estado IN ('en_preparacion', 'presentada')
    OR (o.estado IN ('ganada', 'perdida') AND COALESCE(l.fecha_limite, l.actualizada_en) >= ?)`,
    )
    .all(desde) as Fila[];
  const responsables = responsablesDe(
    db,
    filas.map((f) => f.id),
  );
  const tarjetas = filas.map((f) => ({ ...tarjeta(db, f, hoy, ahoraMs), responsable: responsables.get(f.id) ?? null }));
  const columnas = COLUMNAS.map((c) => {
    const deLaColumna = tarjetas.filter((t) => t.columna === c.clave).sort(porCierre);
    // Lo resuelto, lo más reciente primero y solo lo último.
    return { ...c, tarjetas: c.clave === 'resuelta' ? deLaColumna.reverse().slice(0, MAX_RESUELTAS) : deLaColumna };
  });
  return { columnas, por_revisar: porRevisar(db, hoy) };
}
