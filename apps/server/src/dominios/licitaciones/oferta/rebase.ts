// Rebase tras un guion compatible: lo hecho con el guion anterior pasa al nuevo si los cambios no lo tocan.
import { logger } from '../../../nucleo/log.js';
import type { Db } from '../store.js';
import {
  apartadosCompatibles,
  CambiosGuionSchema,
  componer,
  seccionesAfectadas,
  type CambiosGuion,
} from './guionDiff.js';

const log = logger('licitaciones');

// Volver a extraer el guion no obliga a empezar de cero. Pasan las decisiones, la propuesta, las memorias
// ensambladas y el paquete si los cambios (guiones.cambios) no los tocan. Ante la duda (cambios null, que cuenta
// como «cambió todo») no se rebasa nada: un falso «se mantiene» dejaría pasar piezas hechas con otro pliego.
// Solo SQL y el diff puro: guion.ts importa este módulo, y este no importa guion.ts.
export type Rebasado = { decisiones: number; propuesta: number; memorias: number; borradores: number; paquete: number };

// Unos cambios guardados que no se leen valen como «cambió todo»: null.
export function leerCambios(texto: string | null): CambiosGuion | null {
  if (texto === null) return null;
  try {
    const r = CambiosGuionSchema.safeParse(JSON.parse(texto));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * Qué cambió de un guion a otro posterior de la misma licitación, componiendo las versiones
 * intermedias. null si no se puede saber (otra licitación, al revés, una versión sin cambios
 * guardados o ilegibles), que cuenta como «cambió todo».
 */
export function cambiosEntre(db: Db, guionIdDesde: number, guionIdHasta: number): CambiosGuion | null {
  const ext = (gid: number) =>
    db.prepare('SELECT licitacion_id AS lic, version FROM guiones WHERE id = ?').get(gid) as
      { lic: string; version: number } | undefined;
  const desde = ext(guionIdDesde);
  const hasta = ext(guionIdHasta);
  if (!desde || !hasta || desde.lic !== hasta.lic || desde.version > hasta.version) return null;
  const filas = db
    .prepare('SELECT cambios FROM guiones WHERE licitacion_id = ? AND version > ? AND version <= ? ORDER BY version')
    .all(desde.lic, desde.version, hasta.version) as { cambios: string | null }[];
  const cambios = filas.map((f) => leerCambios(f.cambios));
  // Con un hueco de versiones (borrada a mano) tampoco se puede encadenar.
  if (filas.length !== hasta.version - desde.version || cambios.some((c) => c === null)) return null;
  return componer(cambios as CambiosGuion[]);
}

// El enfoque es texto libre de la persona: un apartado que cambia no lo invalida, los automáticos, el precio o los lotes sí.
const decisionesIntactas = (c: CambiosGuion) => !seccionesAfectadas(c).some((s) => s !== 'enfoque');
// La propuesta decide también el enfoque de cada apartado: cualquier cambio en ellos la desfasa.
const propuestaIntacta = (c: CambiosGuion) =>
  !c.automaticos.length && !c.ofertas.length && !c.lotes && !c.apartados.length;
// Solo si no cambió nada de la memoria: con un apartado de otros puntos, contenido o escala la
// versión se queda en su guion y la siguiente rehace solo esos (actualizarMemoria.ts).
const memoriaIntacta = (c: CambiosGuion) =>
  apartadosCompatibles(c) && !c.apartados.length && !c.memoria.valorable && !c.memoria.advertencias;

// Solo el guion_id: ni actualizada_en (los anexos y el paquete comparan con ella y no deben
// relanzarse) ni la versión, que es el bloqueo optimista del PATCH por sección: subirla daría a
// quien tiene el cajón abierto un 409 «Otra persona guardó…» sin que nadie haya guardado nada. Los
// datos no cambian, así que tampoco hay versión nueva en el historial; el rebase queda en el log.
function rebasarDecisiones(db: Db, id: string, anteriorId: number, nuevoId: number): number {
  return db
    .prepare('UPDATE decisiones_oferta SET guion_id = ? WHERE licitacion_id = ? AND guion_id = ?')
    .run(nuevoId, id, anteriorId).changes;
}

// Las que se están redactando o ensamblando siguen con el guion con que se pidieron: sus trabajos lo llevan en el payload.
function rebasarMemorias(
  db: Db,
  id: string,
  anteriorId: number,
  nuevoId: number,
): { memorias: number; borradores: number } {
  const ensambladas = "SELECT id FROM memorias WHERE licitacion_id = ? AND guion_id = ? AND estado = 'ensamblada'";
  const borradores = db
    .prepare(`UPDATE borradores SET guion_id = ? WHERE licitacion_id = ? AND memoria_id IN (${ensambladas})`)
    .run(nuevoId, id, id, anteriorId).changes;
  const memorias = db
    .prepare("UPDATE memorias SET guion_id = ? WHERE licitacion_id = ? AND guion_id = ? AND estado = 'ensamblada'")
    .run(nuevoId, id, anteriorId).changes;
  return { memorias, borradores };
}

/**
 * Pasa al guion nuevo lo hecho con el anterior que sus cambios no tocan; devuelve cuántas piezas
 * pasaron. Va dentro de la transacción que guarda el guion (guion.ts): o se guardan los dos o ninguno.
 */
export function rebasarTrasGuion(
  dbLic: Db,
  id: string,
  anteriorId: number,
  nuevoId: number,
  cambios: CambiosGuion | null,
): Rebasado {
  const nada: Rebasado = { decisiones: 0, propuesta: 0, memorias: 0, borradores: 0, paquete: 0 };
  if (!cambios) return nada;
  const decisiones = decisionesIntactas(cambios) ? rebasarDecisiones(dbLic, id, anteriorId, nuevoId) : 0;
  const propuesta = propuestaIntacta(cambios)
    ? dbLic
        .prepare('UPDATE propuestas_decisiones SET guion_id = ? WHERE licitacion_id = ? AND guion_id = ?')
        .run(nuevoId, id, anteriorId).changes
    : 0;
  const memorias = memoriaIntacta(cambios)
    ? rebasarMemorias(dbLic, id, anteriorId, nuevoId)
    : { memorias: 0, borradores: 0 };
  const paquete = cambios.vacio
    ? dbLic
        .prepare('UPDATE paquetes_presentacion SET guion_id = ? WHERE licitacion_id = ? AND guion_id = ?')
        .run(nuevoId, id, anteriorId).changes
    : 0;
  const r: Rebasado = { decisiones, propuesta, ...memorias, paquete };
  log.info('rebase tras un guion nuevo', { licitacion: id, guion: nuevoId, vacio: cambios.vacio, ...r });
  return r;
}

/**
 * Pasa al guion vigente las memorias ensambladas con uno anterior que sus cambios no tocan: las
 * que se estaban redactando cuando llegó el guion nuevo se ensamblan después, y rebasarTrasGuion
 * solo vio las ya ensambladas. Sin esto se quedaban «de otro guion» con una reextracción idéntica.
 */
export function rebasarMemoriasTardias(db: Db, id: string): number {
  const g = db.prepare('SELECT id FROM guiones WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1').get(id) as
    { id: number } | undefined;
  if (!g) return 0;
  const anteriores = db
    .prepare(
      "SELECT DISTINCT guion_id AS gid FROM memorias WHERE licitacion_id = ? AND estado = 'ensamblada' AND guion_id <> ?",
    )
    .all(id, g.id) as { gid: number }[];
  let n = 0;
  for (const { gid } of anteriores) {
    const c = cambiosEntre(db, gid, g.id);
    if (c && memoriaIntacta(c)) n += db.transaction(() => rebasarMemorias(db, id, gid, g.id).memorias)();
  }
  if (n) log.info('memoria ensamblada tras el guion nuevo: pasa a él', { licitacion: id, guion: g.id, memorias: n });
  return n;
}
