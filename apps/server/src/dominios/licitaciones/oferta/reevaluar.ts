// «Volver a evaluar» una versión ensamblada: pide la autoevaluación de su .docx a petición de una persona.
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { fail, type Result } from '../../../nucleo/result.js';
import type { Raices } from '../../../nucleo/salidas.js';
import { pedirEvaluacion } from '../propuestas/evaluacion.js';
import type { Db } from '../store.js';
import { memoriaSePuntua, type FilaMemoria } from './ensamblado.js';

function memoriaPorVersion(db: Db, id: string, version: number): FilaMemoria | null {
  return (
    (db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(id, version) as
      FilaMemoria | undefined) ?? null
  );
}

/** Vuelve a evaluar una memoria ensamblada (su .docx), a petición de una persona. */
export function evaluarMemoria(
  dbNucleo: DbNucleo,
  dbLic: Db,
  raices: Raices,
  pedido: { id: string; version: number },
): Result<{ trabajo: number }> {
  if (!dbLic.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(pedido.id))
    return fail('not_found', `No hay ninguna licitación con id «${pedido.id}».`);
  const m = memoriaPorVersion(dbLic, pedido.id, pedido.version);
  if (!m) return fail('not_found', `No hay memoria v${pedido.version} de esta licitación.`);
  const b =
    m.borrador_id === null
      ? undefined
      : (dbLic.prepare('SELECT ruta FROM borradores WHERE id = ?').get(m.borrador_id) as { ruta: string } | undefined);
  if (m.estado !== 'ensamblada' || !b)
    return fail('conflicto', `La memoria v${pedido.version} aún no está ensamblada: se evalúa sola al ensamblarse.`);
  if (!memoriaSePuntua(dbLic, m))
    return fail(
      'invalid_input',
      'El pliego no puntúa esta memoria (no valorable): no hay nota que sacar, solo comprobar que trae lo exigido.',
    );
  return pedirEvaluacion(dbNucleo, dbLic, raices, { id: pedido.id, documento: b.ruta });
}
