// Quién se presentó a cada lote: adjudicataria, licitadoras y excluidas, con sus importes y puntos.
import { claseNif } from '../../nucleo/identidad.js';
import { RESULTADOS_ADJUDICADOS } from './placsp/codigos.js';
import type { Db } from './store.js';

// La PLACSP solo publica al adjudicatario, así que cada adjudicación con NIF válido siembra una fila
// «adjudicataria» con origen «placsp», y las actas y resoluciones añaden a los demás licitadores, sus importes y
// sus puntos. Una fila por (licitación, lote, empresa): lo que trae un acta completa lo de la PLACSP sin
// borrarlo, y el importe adjudicado de la PLACSP manda sobre el leído en un acta. Las personas físicas
// (autónomos) se guardan solo con su NIF, sin nombre.
export const ROLES_PARTICIPACION = ['adjudicataria', 'licitadora', 'excluida'] as const;
export const FUENTES_PARTICIPACION = ['placsp', 'acta', 'ted', 'manual'] as const;
type RolParticipacion = (typeof ROLES_PARTICIPACION)[number];
type FuenteParticipacion = (typeof FUENTES_PARTICIPACION)[number];

// confianza: 1 si lo publica la PLACSP o lo escribe una persona; menos si sale de leer un PDF.
export const SQL_PARTICIPACIONES = `
CREATE TABLE IF NOT EXISTS participaciones (
  licitacion_id TEXT NOT NULL, lote TEXT NOT NULL DEFAULT '', empresa_nif TEXT NOT NULL, empresa_nombre TEXT,
  rol TEXT NOT NULL CHECK (rol IN ('adjudicataria', 'licitadora', 'excluida')), importe_ofertado REAL,
  puntos_tecnicos REAL, puntos_economicos REAL, motivo_exclusion TEXT,
  fuente TEXT NOT NULL CHECK (fuente IN ('placsp', 'acta', 'ted', 'manual')), documento TEXT, confianza REAL NOT NULL DEFAULT 1,
  fecha_ref TEXT, actualizada_en TEXT NOT NULL, PRIMARY KEY (licitacion_id, lote, empresa_nif));
CREATE INDEX IF NOT EXISTS participaciones_empresa ON participaciones(empresa_nif, fecha_ref);
`;

const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS].map((c) => `'${c}'`).join(',');

// Lo que la PLACSP dice de una licitación (o de todas, sin filtro). nif_clase es la función SQL
// que registra store.ts; el nombre de una persona física no se copia.
const SEMBRAR = (filtro: string) => `
  INSERT INTO participaciones (licitacion_id, lote, empresa_nif, empresa_nombre, rol, importe_ofertado, fuente, confianza, fecha_ref, actualizada_en)
  SELECT a.licitacion_id, a.lote, a.adjudicatario_nif,
    CASE WHEN nif_clase(a.adjudicatario_nif) = 'persona_fisica' THEN NULL ELSE a.adjudicatario_nombre END,
    'adjudicataria', a.importe_sin_iva, 'placsp', 1, a.fecha_ref, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM adjudicaciones a
  WHERE a.resultado IN (${ADJUDICADOS}) AND a.adjudicatario_nif IS NOT NULL AND a.nif_valido = 1 ${filtro}
  ON CONFLICT (licitacion_id, lote, empresa_nif) DO UPDATE SET rol = 'adjudicataria',
    importe_ofertado = COALESCE(excluded.importe_ofertado, participaciones.importe_ofertado),
    fecha_ref = COALESCE(participaciones.fecha_ref, excluded.fecha_ref)`;

/** Vuelve a sembrar lo de la PLACSP de una licitación (tras guardar sus adjudicaciones, en la misma transacción). */
export function sembrarParticipaciones(db: Db, licitacionId: string): void {
  db.prepare("DELETE FROM participaciones WHERE licitacion_id = ? AND fuente = 'placsp'").run(licitacionId);
  db.prepare(SEMBRAR('AND a.licitacion_id = ?')).run(licitacionId);
}

/** Relleno de una vez con las adjudicaciones que ya había (arreglo de store.ts). */
export function rellenarParticipaciones(db: Db): void {
  db.exec(SEMBRAR(''));
}

export type Participacion = {
  licitacion_id: string;
  lote: string;
  empresa_nif: string;
  empresa_nombre: string | null;
  rol: RolParticipacion;
  importe_ofertado: number | null;
  puntos_tecnicos: number | null;
  puntos_economicos: number | null;
  motivo_exclusion: string | null;
  fuente: FuenteParticipacion;
  documento: string | null;
  confianza: number;
  fecha_ref: string | null;
};

export type NuevaParticipacion = Omit<
  Participacion,
  'fecha_ref' | 'empresa_nombre' | 'motivo_exclusion' | 'documento'
> & {
  empresa_nombre?: string | null;
  motivo_exclusion?: string | null;
  documento?: string | null;
  fecha_ref?: string | null;
};

/**
 * Guarda lo que trae un acta, una resolución o una persona. No rebaja a una adjudicataria (lo
 * dice la PLACSP) ni pisa datos con huecos: cada campo nuevo solo sustituye si trae valor.
 */
export function guardarParticipacion(db: Db, p: NuevaParticipacion): void {
  const nombre = claseNif(p.empresa_nif) === 'persona_fisica' ? null : (p.empresa_nombre ?? null);
  db.prepare(
    `INSERT INTO participaciones (licitacion_id, lote, empresa_nif, empresa_nombre, rol, importe_ofertado, puntos_tecnicos,
      puntos_economicos, motivo_exclusion, fuente, documento, confianza, fecha_ref, actualizada_en)
    VALUES (@licitacion_id, @lote, @empresa_nif, @nombre, @rol, @importe_ofertado, @puntos_tecnicos, @puntos_economicos, @motivo,
      @fuente, @documento, @confianza, @fecha_ref, @ts)
    ON CONFLICT (licitacion_id, lote, empresa_nif) DO UPDATE SET
      empresa_nombre = COALESCE(excluded.empresa_nombre, participaciones.empresa_nombre),
      rol = CASE WHEN participaciones.rol = 'adjudicataria' THEN 'adjudicataria' ELSE excluded.rol END,
      importe_ofertado = COALESCE(excluded.importe_ofertado, participaciones.importe_ofertado),
      puntos_tecnicos = COALESCE(excluded.puntos_tecnicos, participaciones.puntos_tecnicos),
      puntos_economicos = COALESCE(excluded.puntos_economicos, participaciones.puntos_economicos),
      motivo_exclusion = COALESCE(excluded.motivo_exclusion, participaciones.motivo_exclusion),
      fuente = CASE WHEN participaciones.fuente = 'manual' THEN 'manual' ELSE excluded.fuente END,
      documento = COALESCE(excluded.documento, participaciones.documento),
      confianza = MAX(participaciones.confianza, excluded.confianza),
      fecha_ref = COALESCE(participaciones.fecha_ref, excluded.fecha_ref), actualizada_en = excluded.actualizada_en`,
  ).run({
    ...p,
    nombre,
    motivo: p.motivo_exclusion ?? null,
    documento: p.documento ?? null,
    fecha_ref: p.fecha_ref ?? null,
    ts: new Date().toISOString(),
  });
}

/** Participaciones de una licitación: la adjudicataria primero y después por importe ofertado. */
export function participacionesDe(db: Db, licitacionId: string): Participacion[] {
  return db
    .prepare(
      `SELECT licitacion_id, lote, empresa_nif, empresa_nombre, rol, importe_ofertado, puntos_tecnicos, puntos_economicos,
      motivo_exclusion, fuente, documento, confianza, fecha_ref
    FROM participaciones WHERE licitacion_id = ?
    ORDER BY lote, CASE rol WHEN 'adjudicataria' THEN 0 WHEN 'licitadora' THEN 1 ELSE 2 END, importe_ofertado IS NULL, importe_ofertado`,
    )
    .all(licitacionId) as Participacion[];
}
