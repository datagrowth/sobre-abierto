// Competidores y organismos que el equipo marca a mano para tenerlos en el punto de
// mira, con sus notas. Es una decisión humana: solo la web la cambia, nunca un agente.
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { normalizarNif } from '../../../nucleo/organizaciones.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Db } from '../store.js';
import { ARGS_ADJUDICADO, nombresDe, SQL_ADJUDICADO } from './agregados.js';
import { SQL_IMPORTE_MERCADO } from '../calidad.js';

export const TIPOS_SEGUIDO = ['competidor', 'organismo'] as const;
export type TipoSeguido = (typeof TIPOS_SEGUIDO)[number];

export const Nif = z
  .string()
  .trim()
  .transform(normalizarNif)
  .pipe(z.string().regex(/^[A-Z0-9]{3,20}$/, 'NIF no válido'));
export const Seguimiento = z.strictObject({ notas: z.string().max(5000).default('') });

export type Seguido = { nif: string; notas: string; creado_en: string; actualizado_en: string };
export type SeguidoConDatos = Seguido & {
  nombre: string | null;
  contratos: number;
  importe: number;
  ultimo: string | null;
};

// Competidor: el que gana; organismo: el que adjudica. Cada uno por su índice.
const COLUMNA: Record<TipoSeguido, string> = { competidor: 'adjudicatario_nif', organismo: 'organo_nif' };

// Recurso del evento: el NIF solo para organismos. El de un competidor puede ser el DNI de
// una persona física, y los eventos no guardan datos personales.
function recursoDe(tipo: TipoSeguido, nif: string): string {
  return tipo === 'organismo' ? `organismo:${nif}` : 'competidor';
}

function existe(db: Db, tipo: TipoSeguido, nif: string): boolean {
  const enAdj = db.prepare(`SELECT 1 FROM adjudicaciones WHERE ${COLUMNA[tipo]} = ? LIMIT 1`).get(nif);
  const enLic = tipo === 'organismo' && db.prepare('SELECT 1 FROM licitaciones WHERE organo_nif = ? LIMIT 1').get(nif);
  return Boolean(enAdj || enLic || db.prepare('SELECT 1 FROM nucleo.organizaciones WHERE nif = ?').get(nif));
}

/** Marca (o actualiza las notas de) un competidor u organismo seguido. */
export function seguir(db: Db, tipo: TipoSeguido, nif: string, s: z.infer<typeof Seguimiento>): Result<Seguido> {
  if (!existe(db, tipo, nif)) return fail('not_found', `No hay datos de ningún ${tipo} con NIF ${nif}.`);
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO seguidos (tipo, nif, notas, creado_en, actualizado_en) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tipo, nif) DO UPDATE SET notas = excluded.notas, actualizado_en = excluded.actualizado_en`,
  ).run(tipo, nif, s.notas, ts, ts);
  emitir(db, {
    tipo: 'licitaciones.seguido',
    dominio: 'licitaciones',
    recurso: recursoDe(tipo, nif),
    datos: { seguido: true },
  });
  return ok(seguidoDe(db, tipo, nif) as Seguido);
}

export function dejarDeSeguir(db: Db, tipo: TipoSeguido, nif: string): Result<{ borrado: boolean }> {
  const borrado = db.prepare('DELETE FROM seguidos WHERE tipo = ? AND nif = ?').run(tipo, nif).changes > 0;
  if (!borrado) return fail('not_found', `Ese ${tipo} no estaba en seguimiento.`);
  emitir(db, {
    tipo: 'licitaciones.seguido',
    dominio: 'licitaciones',
    recurso: recursoDe(tipo, nif),
    datos: { seguido: false },
  });
  return ok({ borrado });
}

export function seguidoDe(db: Db, tipo: TipoSeguido, nif: string): Seguido | null {
  return (
    (db
      .prepare('SELECT nif, notas, creado_en, actualizado_en FROM seguidos WHERE tipo = ? AND nif = ?')
      .get(tipo, nif) as Seguido | undefined) ?? null
  );
}

export function nifsSeguidos(db: Db, tipo: TipoSeguido): Set<string> {
  return new Set(
    (db.prepare('SELECT nif FROM seguidos WHERE tipo = ?').all(tipo) as { nif: string }[]).map((f) => f.nif),
  );
}

/** Los seguidos de un tipo con su nombre y lo que han ganado (competidor) o adjudicado (organismo). */
export function listarSeguidos(db: Db, tipo: TipoSeguido): SeguidoConDatos[] {
  const seguidos = db
    .prepare('SELECT nif, notas, creado_en, actualizado_en FROM seguidos WHERE tipo = ? ORDER BY actualizado_en DESC')
    .all(tipo) as Seguido[];
  const totales =
    db.prepare(`SELECT COUNT(*) AS contratos, COALESCE(SUM(${SQL_IMPORTE_MERCADO}), 0) AS importe, MAX(a.fecha_ref) AS ultimo,
    MAX(a.adjudicatario_nombre) AS nombre FROM adjudicaciones a WHERE a.${COLUMNA[tipo]} = ? AND ${SQL_ADJUDICADO}`);
  const nombres = nombresDe(
    db,
    seguidos.map((s) => s.nif),
  );
  return seguidos.map((s) => {
    const t = totales.get(s.nif, ...ARGS_ADJUDICADO) as {
      contratos: number;
      importe: number;
      ultimo: string | null;
      nombre: string | null;
    };
    const nombre = nombres.get(s.nif) ?? (tipo === 'competidor' ? t.nombre : null);
    return { ...s, nombre, contratos: t.contratos, importe: Math.round(t.importe * 100) / 100, ultimo: t.ultimo };
  });
}
