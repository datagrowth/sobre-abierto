// Acciones de la persona sobre una fila de las comprobaciones, guardadas en oferta_bloqueos.
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { CATEGORIAS_DESCARTE, cambiarOportunidad } from '../oportunidades.js';
import type { Db } from '../store.js';
import { comprobacionesDe } from './comprobaciones.js';
import type { Bloqueo, Comprobaciones, EstadoBloqueo } from './comprobacionesTipos.js';

// Son «Vamos», «Aceptar el riesgo», «Descartar con motivo» y «Aplicar la propuesta». Cada una queda con la huella
// que se vio, quién y por qué: si la fila cambia, las comprobaciones la vuelven a abrir sola.
export const AccionEntrada = z.strictObject({
  accion: z.enum(['vamos', 'aceptar_riesgo', 'descartar', 'aplicar_propuesta']),
  motivo: z.string().trim().min(3, 'Escribe el motivo en pocas palabras.').max(500).optional(),
  categoria_descarte: z.enum(CATEGORIAS_DESCARTE).optional(),
  quien: z.string().trim().min(2).max(60).optional(),
});
export type AccionEntrada = z.infer<typeof AccionEntrada>;

export const TIPO_EVENTO_COMPROBACIONES = 'licitacion.comprobaciones';

const log = logger('licitaciones');

// Descartar es de la oferta, no de la fila: se anota abierta para que, si se recupera, siga a la vista.
const ESTADO_TRAS: Record<AccionEntrada['accion'], EstadoBloqueo> = {
  vamos: 'vamos',
  aceptar_riesgo: 'riesgo_aceptado',
  descartar: 'abierto',
  aplicar_propuesta: 'resuelto',
};

function rechazo(b: Bloqueo, e: AccionEntrada): Result<null> {
  if (e.accion === 'vamos' && (b.categoria !== 'elegibilidad' || !e.motivo))
    return fail('invalid_input', 'Vamos solo vale para un bloqueo de elegibilidad, y con motivo.');
  if (e.accion === 'aceptar_riesgo' && b.gravedad !== 'riesgo' && b.gravedad !== 'no_comprobado') {
    return fail(
      'conflicto',
      'Esto impide presentar: no se puede aceptar como riesgo. Resuélvelo o descarta la oferta.',
    );
  }
  if (e.accion === 'aceptar_riesgo' && !e.motivo) return fail('invalid_input', 'Para aceptar un riesgo, di por qué.');
  if (e.accion === 'descartar' && !e.motivo) return fail('invalid_input', 'Al descartar, di por qué.');
  if (e.accion === 'aplicar_propuesta' && (b.estado !== 'propuesta' || !b.propuesta))
    return fail('conflicto', 'No hay propuesta de Hermes para este bloqueo.');
  return ok(null);
}

function anotar(db: Db, id: string, b: Bloqueo, e: AccionEntrada): Result<null> {
  const quien = e.quien ?? 'web';
  const propuesta = e.accion === 'aplicar_propuesta' && b.propuesta ? JSON.stringify(b.propuesta) : null;
  return db.transaction((): Result<null> => {
    if (e.accion === 'descartar') {
      const d = cambiarOportunidad(
        db,
        id,
        { estado: 'descartada', motivo_descarte: e.motivo, categoria_descarte: e.categoria_descarte },
        quien,
      );
      if (d.error) return d;
    }
    db.prepare(
      'INSERT INTO oferta_bloqueos (licitacion_id, clave, huella, estado, propuesta_json, quien, motivo, en) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, b.clave, b.huella, ESTADO_TRAS[e.accion], propuesta, quien, e.motivo ?? null, new Date().toISOString());
    return ok(null);
  })();
}

function anotarSinLanzar(db: Db, id: string, b: Bloqueo, e: AccionEntrada): Result<null> {
  try {
    return anotar(db, id, b, e);
  } catch (err) {
    log.error('acción de las comprobaciones sin guardar', { id, clave: b.clave, error: errorMessage(err) });
    return fail('io_error', 'No se pudo guardar la acción.');
  }
}

/** Avisa a quien mira las comprobaciones de que tienen versión nueva. Un fallo al avisar no deshace la acción. */
export function avisarComprobaciones(id: string, version: string): void {
  try {
    emitir(nucleo().db, {
      tipo: TIPO_EVENTO_COMPROBACIONES,
      dominio: 'licitaciones',
      recurso: id,
      datos: { id, version },
    });
  } catch (err) {
    log.error('evento de las comprobaciones sin emitir', { id, error: errorMessage(err) });
  }
}

/** Aplica una acción a la fila `clave` de las comprobaciones actuales y devuelve las comprobaciones recalculadas. */
export function aplicarAccionBloqueo(
  db: Db,
  id: string,
  clave: string,
  entrada: AccionEntrada,
): Result<Comprobaciones> {
  const actual = comprobacionesDe(db, nucleo().db, id);
  if (actual.error) return actual;
  const b = actual.data.bloqueos.find((x) => x.clave === clave);
  if (!b) return fail('not_found', 'Ese bloqueo ya no está en las comprobaciones.');
  const r = rechazo(b, entrada);
  if (r.error) return r;
  const a = anotarSinLanzar(db, id, b, entrada);
  if (a.error) return a;
  const nueva = comprobacionesDe(db, nucleo().db, id);
  if (nueva.data) avisarComprobaciones(id, nueva.data.version);
  return nueva;
}
