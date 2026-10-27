// Calidad del dato: comprobaciones por código de lo que trae la PLACSP, con una incidencia por cada fallo.
import { RESULTADOS_ADJUDICADOS } from './placsp/codigos.js';
import type { Db } from './store.js';

// Las incidencias van a calidad_incidencias, que se recuenta en Ajustes › Fuentes. Una adjudicación con
// incidencia no entra en los índices de mercado; la de NIF no válido sí (sus ofertas y su baja valen), pero su
// adjudicatario no cuenta como licitador (adjudicaciones.nif_valido). Se recalculan con cada licitación que se
// guarda y un arreglo las saca una vez de lo que ya había.
const REGLAS_CALIDAD = {
  sobre_presupuesto: 'Adjudicado por encima de 1,2 veces el presupuesto',
  baja_excesiva: 'Baja de más del 70 %',
  cero_ofertas: 'Adjudicado con 0 ofertas',
  nif_no_valido: 'NIF del adjudicatario no válido',
  lote_sin_importe: 'Lote sin importe',
} as const;
type ReglaCalidad = keyof typeof REGLAS_CALIDAD;

export const SQL_CALIDAD = `
CREATE TABLE IF NOT EXISTS calidad_incidencias (
  tabla TEXT NOT NULL, id TEXT NOT NULL, licitacion_id TEXT NOT NULL, lote TEXT NOT NULL DEFAULT '', regla TEXT NOT NULL, valor TEXT,
  detectada_en TEXT NOT NULL, PRIMARY KEY (tabla, id, regla));
CREATE INDEX IF NOT EXISTS calidad_licitacion ON calidad_incidencias(licitacion_id, lote);
CREATE INDEX IF NOT EXISTS calidad_regla ON calidad_incidencias(regla, detectada_en);
`;

/** Lo que deja fuera de los índices: una incidencia de la adjudicación que no sea solo del NIF. `a` es la adjudicación. */
export const SQL_SIN_INCIDENCIA = `NOT EXISTS (SELECT 1 FROM calidad_incidencias q WHERE q.licitacion_id = a.licitacion_id AND q.lote = a.lote
  AND q.tabla = 'adjudicaciones' AND q.regla <> 'nif_no_valido')`;

/** Importe que suma en el mercado: NULL si otra adjudicataria del mismo lote tiene el mismo importe. `a` es la adjudicación. */
// Así se publica un acuerdo marco con varias adjudicatarias: a cada una, el techo entero del lote. Es lo máximo
// que se podrá gastar, no lo adjudicado, y sumado una vez por empresa multiplica el mercado; lo gastado llega en
// los contratos basados, que se publican aparte. La adjudicación sigue contando como contrato.
export const SQL_IMPORTE_MERCADO = `CASE WHEN EXISTS (SELECT 1 FROM adjudicaciones m WHERE m.licitacion_id = a.licitacion_id
  AND m.lote = a.lote AND m.ord <> a.ord AND m.importe_sin_iva = a.importe_sin_iva) THEN NULL ELSE a.importe_sin_iva END`;

const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS].map((c) => `'${c}'`).join(',');
const AHORA = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const ID_ADJ = "a.licitacion_id || '|' || a.lote || '|' || a.ord";

// Las reglas de las adjudicaciones y los lotes, con `filtro` para una sola licitación o vacío para todas.
const DETECTAR = (filtroAdj: string, filtroLote: string) => `
  INSERT OR REPLACE INTO calidad_incidencias (tabla, id, licitacion_id, lote, regla, valor, detectada_en)
  SELECT 'adjudicaciones', ${ID_ADJ}, a.licitacion_id, a.lote, 'sobre_presupuesto', round(a.importe_sin_iva / a.presupuesto_sin_iva, 4), ${AHORA}
    FROM adjudicaciones a WHERE a.resultado IN (${ADJUDICADOS}) AND a.presupuesto_sin_iva > 0 AND a.importe_sin_iva > 1.2 * a.presupuesto_sin_iva ${filtroAdj}
  UNION ALL
  SELECT 'adjudicaciones', ${ID_ADJ}, a.licitacion_id, a.lote, 'baja_excesiva', round(1 - a.importe_sin_iva / a.presupuesto_sin_iva, 4), ${AHORA}
    FROM adjudicaciones a WHERE a.resultado IN (${ADJUDICADOS}) AND a.presupuesto_sin_iva > 0 AND a.importe_sin_iva >= 0
      AND a.importe_sin_iva < 0.3 * a.presupuesto_sin_iva ${filtroAdj}
  UNION ALL
  SELECT 'adjudicaciones', ${ID_ADJ}, a.licitacion_id, a.lote, 'cero_ofertas', '0', ${AHORA}
    FROM adjudicaciones a WHERE a.resultado IN (${ADJUDICADOS}) AND a.ofertas = 0 ${filtroAdj}
  UNION ALL
  SELECT 'adjudicaciones', ${ID_ADJ}, a.licitacion_id, a.lote, 'nif_no_valido', a.adjudicatario_nif, ${AHORA}
    FROM adjudicaciones a WHERE a.nif_valido = 0 ${filtroAdj}
  UNION ALL
  SELECT 'lotes', x.licitacion_id || '|' || x.numero, x.licitacion_id, x.numero, 'lote_sin_importe', NULL, ${AHORA}
    FROM lotes x WHERE (x.presupuesto_sin_iva IS NULL OR x.presupuesto_sin_iva <= 0) ${filtroLote}`;

/** Rehace las incidencias de una licitación (en la transacción de guardarLicitacion, tras sus adjudicaciones y lotes). */
export function detectarIncidencias(db: Db, licitacionId: string): void {
  db.prepare('DELETE FROM calidad_incidencias WHERE licitacion_id = ?').run(licitacionId);
  db.prepare(DETECTAR('AND a.licitacion_id = @id', 'AND x.licitacion_id = @id')).run({ id: licitacionId });
}

/** Relleno de una vez con lo que ya había (arreglo de store.ts). */
export function rellenarIncidencias(db: Db): void {
  db.exec(DETECTAR('', ''));
}

const MAX_EJEMPLOS = 5;

export type ResumenCalidad = {
  incidencias: {
    regla: ReglaCalidad;
    texto: string;
    n: number;
    ejemplos: { licitacion_id: string; lote: string; titulo: string | null; valor: string | null }[];
  }[];
  fuera_de_indices: number;
  pliegos_ilegibles: {
    n: number;
    ejemplos: { licitacion_id: string; titulo: string | null; detalle: string | null }[];
  };
};

/** Recuento de Ajustes › Fuentes: incidencias por regla con ejemplos, lo que queda fuera de los índices y los pliegos que no se leen. */
export function resumenCalidad(db: Db): ResumenCalidad {
  const cuentas = new Map(
    (
      db.prepare('SELECT regla, COUNT(*) AS n FROM calidad_incidencias GROUP BY regla').all() as {
        regla: string;
        n: number;
      }[]
    ).map((f) => [f.regla, f.n]),
  );
  const ejemplos =
    db.prepare(`SELECT q.licitacion_id, q.lote, q.valor, l.titulo FROM calidad_incidencias q LEFT JOIN licitaciones l ON l.id = q.licitacion_id
    WHERE q.regla = ? ORDER BY q.detectada_en DESC, q.licitacion_id LIMIT ${MAX_EJEMPLOS}`);
  const fuera = db
    .prepare(
      `SELECT COUNT(DISTINCT licitacion_id || '|' || lote) AS n FROM calidad_incidencias
    WHERE tabla = 'adjudicaciones' AND regla <> 'nif_no_valido'`,
    )
    .get() as { n: number };
  const ilegibles = db
    .prepare(
      `SELECT o.licitacion_id, l.titulo, o.error_detalle AS detalle FROM oportunidades o LEFT JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.error_proceso IN ('pliegos_ilegibles', 'pliegos_error') ORDER BY o.actualizada_en DESC`,
    )
    .all() as ResumenCalidad['pliegos_ilegibles']['ejemplos'];
  return {
    incidencias: (Object.keys(REGLAS_CALIDAD) as ReglaCalidad[]).map((regla) => ({
      regla,
      texto: REGLAS_CALIDAD[regla],
      n: cuentas.get(regla) ?? 0,
      ejemplos: (cuentas.get(regla) ? ejemplos.all(regla) : []) as ResumenCalidad['incidencias'][number]['ejemplos'],
    })),
    fuera_de_indices: fuera.n,
    pliegos_ilegibles: { n: ilegibles.length, ejemplos: ilegibles.slice(0, MAX_EJEMPLOS) },
  };
}
