// Responsable de cada oferta: una persona de la web (nucleo.usuarios), cambiable desde la cabecera de la ficha.
import { z } from 'zod';
import { fail, ok, type Result } from '../../nucleo/result.js';
import type { Db } from './store.js';

// Se elige al pulsar «Preparar la oferta» (por defecto, quien pulsa). Se ve como avatar en el Pipeline y en la
// ficha, y decide de quién son los hitos del calendario. Solo sale el nombre: el email es PII y no hace falta
// para el avatar.
export type Responsable = { id: number; nombre: string };

// Una base de licitaciones abierta sin la del núcleo al lado (los tests de cada dominio) no tiene
// usuarios: sin la tabla, ninguna oferta tiene responsable.
const conUsuarios = new WeakMap<Db, boolean>();
function hayUsuarios(db: Db): boolean {
  let hay = conUsuarios.get(db);
  if (hay === undefined) {
    hay =
      db.prepare("SELECT 1 FROM nucleo.sqlite_master WHERE type = 'table' AND name = 'usuarios'").get() !== undefined;
    if (hay) conUsuarios.set(db, hay);
  }
  return hay;
}

/** Los responsables de varias ofertas de una vez (el Pipeline): solo los que tienen uno activo. */
export function responsablesDe(db: Db, ids: readonly string[]): Map<string, Responsable> {
  if (!ids.length || !hayUsuarios(db)) return new Map();
  const filas = db
    .prepare(
      `SELECT o.licitacion_id AS licitacion, u.id, u.nombre FROM oportunidades o
    JOIN nucleo.usuarios u ON u.id = o.responsable_id AND u.activo = 1
    WHERE o.licitacion_id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(ids)) as ({ licitacion: string } & Responsable)[];
  return new Map(filas.map((f) => [f.licitacion, { id: f.id, nombre: f.nombre }]));
}

export const responsableDe = (db: Db, id: string): Responsable | null => responsablesDe(db, [id]).get(id) ?? null;

const CambioResponsable = z.strictObject({ usuario_id: z.number().int().positive().nullable() });

/** Cambia (o quita, con null) el responsable de una oferta: una persona activa de la web. */
export function cambiarResponsable(db: Db, id: string, datos: unknown): Result<{ responsable: Responsable | null }> {
  const v = CambioResponsable.safeParse(datos);
  if (!v.success) return fail('invalid_input', 'Elige a una persona del equipo (usuario_id) o nadie (null).');
  if (!db.prepare('SELECT 1 FROM oportunidades WHERE licitacion_id = ?').get(id))
    return fail('not_found', 'Esa licitación no es una oportunidad.');
  const usuario = v.data.usuario_id;
  if (
    usuario !== null &&
    (!hayUsuarios(db) || !db.prepare('SELECT 1 FROM nucleo.usuarios WHERE id = ? AND activo = 1').get(usuario))
  ) {
    return fail('invalid_input', 'Esa persona no tiene acceso activo a Hermes.');
  }
  db.prepare('UPDATE oportunidades SET responsable_id = ?, actualizada_en = ? WHERE licitacion_id = ?').run(
    usuario,
    new Date().toISOString(),
    id,
  );
  return ok({ responsable: responsableDe(db, id) });
}
