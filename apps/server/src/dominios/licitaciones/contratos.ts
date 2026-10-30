// Contratos adjudicados y cuándo acaban: de aquí salen los vencimientos y cuándo se espera la nueva licitación.
import { sumarDuracion } from './antecedentes/linea.js';
import { RESULTADOS_ADJUDICADOS } from './placsp/codigos.js';
import type { Db } from './store.js';

// Una fila por lote adjudicado con la fecha de adjudicación, el inicio (el del resultado, el previsto del
// contrato o, sin ellos, la adjudicación) y el fin estimado (el previsto o inicio + duración). La PLACSP no
// publica las prórrogas en el CODICE: prorrogas_max y prorrogas_usadas quedan vacías hasta que una fuente las
// traiga. Se escribe con cada licitación que se guarda y un arreglo rellena lo que ya había.
export const SQL_CONTRATOS = `
CREATE TABLE IF NOT EXISTS contratos (
  licitacion_id TEXT NOT NULL, lote TEXT NOT NULL DEFAULT '', adjudicado_en TEXT, inicio TEXT, fin_estimado TEXT,
  duracion_valor REAL, duracion_unidad TEXT, prorrogas_max INTEGER, prorrogas_usadas INTEGER, PRIMARY KEY (licitacion_id, lote));
CREATE INDEX IF NOT EXISTS contratos_fin ON contratos(fin_estimado);
`;

const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS].map((c) => `'${c}'`).join(',');

/** fin_contrato(inicio, valor, unidad) en SQL: el último día del contrato, o null. La registra store.ts. */
export function finContrato(inicio: unknown, valor: unknown, unidad: unknown): string | null {
  if (
    typeof inicio !== 'string' ||
    typeof valor !== 'number' ||
    typeof unidad !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}/.test(inicio)
  )
    return null;
  return sumarDuracion(inicio.slice(0, 10), { valor, unidad });
}

const ESCRIBIR = (filtro: string) => `
  INSERT OR REPLACE INTO contratos (licitacion_id, lote, adjudicado_en, inicio, fin_estimado, duracion_valor, duracion_unidad)
  SELECT id, lote, adjudicado_en, inicio,
    COALESCE(fin_previsto, fin_contrato(inicio, duracion_valor, duracion_unidad)), duracion_valor, duracion_unidad
  FROM (SELECT l.id, COALESCE(json_extract(r.value, '$.lote'), '') AS lote, substr(json_extract(r.value, '$.fecha'), 1, 10) AS adjudicado_en,
      substr(COALESCE(json_extract(r.value, '$.inicio'), json_extract(l.datos, '$.periodo.inicio'), json_extract(r.value, '$.fecha')), 1, 10) AS inicio,
      substr(json_extract(l.datos, '$.periodo.fin'), 1, 10) AS fin_previsto,
      json_extract(l.datos, '$.duracion.valor') AS duracion_valor, json_extract(l.datos, '$.duracion.unidad') AS duracion_unidad
    FROM licitaciones l, json_each(l.datos, '$.resultados') r
    WHERE json_valid(l.datos) AND json_extract(r.value, '$.codigo') IN (${ADJUDICADOS}) ${filtro})`;

/** Rehace los contratos de una licitación (en la transacción de guardarLicitacion). */
export function guardarContratos(db: Db, licitacionId: string): void {
  db.prepare('DELETE FROM contratos WHERE licitacion_id = ?').run(licitacionId);
  db.prepare(ESCRIBIR('AND l.id = ?')).run(licitacionId);
}

/** Relleno de una vez con lo ya adjudicado (arreglo de store.ts). */
export function rellenarContratos(db: Db): void {
  db.exec(ESCRIBIR(''));
}
