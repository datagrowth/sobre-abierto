// Sacar un trabajo de su curso: relanzar los colgados (a mano o solos), cancelar los que ya no
// sirven y los zombis, pendientes que no salieron en días sin nada que los retenga.
import { ahora, type Db } from './db.js';
import { CODIGO_DESFASE, CODIGO_HERRAMIENTA, CODIGO_LIMITE } from './colaEsperas.js';
import { reactivarTipo } from './colaFrenos.js';
import type { LimiteVuelta } from './colaOrden.js';
import { actualizar, avisar, MAX_INTENTOS, obtenerTrabajo, pararRunDe, tipoDe, type Trabajo } from './colaTipos.js';
import { logger } from './log.js';
import { fail, ok, type Result } from './result.js';

const log = logger('trabajos');

// Un colgado se relanza sin gastar intento hasta este tope; luego vuelve a gastarlo, para que un
// trabajo que se cuelga siempre acabe fallido en vez de dar vueltas sin fin.
const MAX_RELANZAMIENTOS = 2;

export const CODIGO_RELANZADO = 'relanzado';

export const RELANZADO = 'Relanzado a mano';

/**
 * Una persona da por colgados los trabajos en marcha de un tipo para un recurso (el `id` del
 * payload): se para su run, si lo hay, y vuelven a la cola ya, con clave nueva y sin gastar
 * intento. Devuelve cuántos.
 */
export function relanzarTrabajos(db: Db, tipo: string, id: string): number {
  const filas = db
    .prepare(
      `SELECT * FROM trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.id') = ?`,
    )
    .all(tipo, id) as Trabajo[];
  for (const t of filas) {
    if (t.run_id) pararRunDe(t.tipo, t.run_id);
    actualizar(db, t.id, {
      estado: 'pendiente',
      run_id: null,
      lanzado_en: null,
      proximo_intento_en: ahora(),
      error: `${RELANZADO}: se paró el run anterior.`,
      codigo: CODIGO_RELANZADO,
    });
  }
  // Solo esa oferta: relanzar una no puede quitar el freno a las demás.
  if (filas.length) reactivarTipo(db, tipo, id);
  return filas.length;
}

/**
 * Cancela los trabajos pendientes o en marcha de un tipo y un recurso (el `id` del payload) cuyo
 * payload cumpla `quitar` (todos, por omisión) y para su run: lo que ya no sirve no debe gastar
 * intentos. Devuelve cuántos.
 */
export function cancelarTrabajosDe(
  db: Db,
  tipo: string,
  id: string,
  quitar: (payload: unknown) => boolean = () => true,
): number {
  const filas = db
    .prepare(
      `SELECT * FROM trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.id') = ?`,
    )
    .all(tipo, id) as Trabajo[];
  const sobran = filas.filter((t) => quitar(JSON.parse(t.payload)));
  for (const t of sobran) {
    if (t.run_id) pararRunDe(t.tipo, t.run_id);
    actualizar(db, t.id, { estado: 'cancelado', run_id: null, error: null });
  }
  return sobran.length;
}

/** «Cancelar» desde Estado: un trabajo pendiente o en marcha (para su run). */
export function cancelarTrabajo(db: Db, id: number): Result<{ id: number; estado: 'cancelado' }> {
  const t = obtenerTrabajo(db, id);
  if (!t) return fail('not_found', `No hay trabajo ${id}.`);
  if (t.estado !== 'pendiente' && t.estado !== 'lanzado')
    return fail('conflict', `El trabajo ${id} ya está ${t.estado}.`);
  if (t.run_id) pararRunDe(t.tipo, t.run_id);
  actualizar(db, t.id, { estado: 'cancelado', run_id: null, error: 'Cancelado a mano desde Estado.' });
  log.info('trabajo cancelado a mano', { id: t.id, tipo: t.tipo });
  return ok({ id: t.id, estado: 'cancelado' });
}

export const RELANZADO_SOLO = 'Relanzado solo';

/**
 * La plataforma da por colgados los trabajos en marcha de un tipo para un recurso: para su run
 * y los devuelve a la cola. Los MAX_RELANZAMIENTOS primeros no gastan intento (el cuelgue no suele
 * ser culpa del trabajo); los siguientes sí (al último, quedan fallidos). A diferencia de
 * relanzarTrabajos (una persona), no toca los pendientes (los que esperan una herramienta o su
 * reintento siguen esperando) ni quita el freno del tipo: un relanzamiento automático no puede
 * volver a lanzar las memorias de todas las licitaciones con la cuota del modelo. Devuelve cuántos.
 */
export function relanzarColgadosDe(db: Db, tipo: string, id: string): number {
  const filas = db
    .prepare(
      `SELECT * FROM trabajos_ia WHERE tipo = ? AND estado = 'lanzado'
    AND json_extract(payload, '$.id') = ?`,
    )
    .all(tipo, id) as Trabajo[];
  for (const t of filas) {
    if (t.run_id) pararRunDe(t.tipo, t.run_id);
    relanzarColgado(db, t);
  }
  return filas.length;
}

function relanzarColgado(db: Db, t: Trabajo): void {
  const gratis = t.relanzamientos < MAX_RELANZAMIENTOS;
  const intentos = gratis ? t.intentos : t.intentos + 1;
  const fin = intentos >= MAX_INTENTOS;
  actualizar(db, t.id, {
    estado: fin ? 'fallido' : 'pendiente',
    intentos,
    relanzamientos: gratis ? t.relanzamientos + 1 : t.relanzamientos,
    run_id: null,
    lanzado_en: null,
    proximo_intento_en: fin ? null : ahora(),
    codigo: CODIGO_RELANZADO,
    error: `${RELANZADO_SOLO}: el run llevaba más de lo normal y se paró${fin ? ' en su último intento' : ''}.`,
  });
  avisar(db, t, fin ? 'fallido' : 'relanzado', { codigo: CODIGO_RELANZADO, intentos });
}

const DIA_MS = 86_400_000;
const iso = (ms: number): string => new Date(ms).toISOString();

// Un pendiente que en 48 h no ha salido ni una vez no va a salir solo. También mira
// actualizado_en: uno relanzado a mano vuelve sin lanzado_en y no es un zombi.
export const ZOMBI_MS = 2 * DIA_MS;
const CODIGO_ZOMBI = 'zombi';
// Pendientes que nunca salieron y nadie tocó desde @limite (la consulta de zombis y la de Estado).
export const SIN_LANZAR =
  "estado = 'pendiente' AND lanzado_en IS NULL AND creado_en < @limite AND actualizado_en < @limite";

// Esperas con su motivo a la vista (la herramienta que falta, Hermes por reiniciar, el límite de uso):
// la propia cola las retiene, no son zombis.
const CODIGOS_DE_ESPERA: ReadonlySet<string> = new Set([CODIGO_HERRAMIENTA, CODIGO_DESFASE, CODIGO_LIMITE]);
type Retenido = (t: Trabajo) => boolean;

const retenidoPorCodigo =
  (ahoraMs: number): Retenido =>
  (t) =>
    CODIGOS_DE_ESPERA.has(t.codigo ?? '') ||
    (t.proximo_intento_en !== null && Date.parse(t.proximo_intento_en) > ahoraMs);

// Lo que la vuelta no lanzaría por un freno conocido: tipo o perfil desfasado, tipo u oferta
// frenados, cupo o tope por oferta, o un tipo sin perfil de Hermes.
export function retenidoEnLaVuelta(v: { desfases: Set<string>; frenado: Retenido; limite: LimiteVuelta }): Retenido {
  const porCodigo = retenidoPorCodigo(Date.now());
  const sinPerfil = (t: Trabajo): boolean => {
    const def = tipoDe(t.tipo);
    return def !== undefined && !def.destino();
  };
  return (t) => porCodigo(t) || v.desfases.has(t.tipo) || v.frenado(t) || v.limite.limitado(t) || sinPerfil(t);
}

/**
 * Cancela los pendientes que en 48 h no han salido nunca (código `zombi`) y avisa de cada uno.
 * Los retenidos por un freno conocido no: se les reinicia el reloj, así las 48 h cuentan desde
 * que se levanta el freno (el lunes que se reinicia Hermes no se pierde lo pedido el viernes).
 */
export function cancelarZombis(db: Db, ahoraMs = Date.now(), retenido: Retenido = retenidoPorCodigo(ahoraMs)): number {
  const ts = iso(ahoraMs);
  const candidatos = db
    .prepare(`SELECT * FROM trabajos_ia WHERE ${SIN_LANZAR} ORDER BY id`)
    .all({ limite: iso(ahoraMs - ZOMBI_MS) }) as Trabajo[];
  const tocar = db.prepare('UPDATE trabajos_ia SET actualizado_en = ? WHERE id = ?');
  const cancelar = db.prepare(
    `UPDATE trabajos_ia SET estado = 'cancelado', codigo = @codigo, error = @error, run_id = NULL, actualizado_en = @ts WHERE id = @id`,
  );
  let n = 0;
  for (const t of candidatos) {
    if (retenido(t)) {
      tocar.run(ts, t.id);
      continue;
    }
    cancelar.run({ id: t.id, codigo: CODIGO_ZOMBI, error: 'Cancelado solo: llevaba 48 h en la cola sin salir.', ts });
    avisar(db, t, 'cancelado', { codigo: CODIGO_ZOMBI });
    n += 1;
  }
  if (n) log.info('zombis de la cola cancelados', { n });
  return n;
}
