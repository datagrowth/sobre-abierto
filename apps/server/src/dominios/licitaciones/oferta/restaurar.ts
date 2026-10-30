// «Volver a esta versión»: la versión siguiente es una copia de una anterior, sin IA.
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import { avisoDescartadas, descartarVersionesSinRevisar } from '../propuestas/revision.js';
import { remontarMemoria, type FilaMemoria } from './ensamblado.js';
import { heredarAnulacion } from './fugasMemoria.js';
import { guionVigente } from './guion.js';
import { apartadosCompatibles } from './guionDiff.js';
import { cambiosEntre } from './rebase.js';

const log = logger('licitaciones');

export type MemoriaRestaurada = {
  memoria: number;
  version: number;
  desde: number;
  borrador: number;
  ruta: string;
  descartadas: number[];
  fugas_heredadas: number;
  avisos: string[];
  mensaje: string;
};

// Copia sus apartados tal cual y la monta con «volver a montar», así que la portada y la firma salen con el
// perfil de empresa de ahora y no se encola nada (ni la autoevaluación: el texto ya se evaluó en la versión de
// origen). La pendiente que deja atrás se descarta y se dice, y lo anulado en la de origen se hereda si la frase
// no cambió.
// Los avisos de la versión anterior que no son de la copia: lo que dejó atrás al llegar.
const PREFIJO_DESCARTADAS = 'Al llegar la v';

function versionDe(db: Db, id: string, version: number): FilaMemoria | null {
  return (
    (db.prepare('SELECT * FROM memorias WHERE licitacion_id = ? AND version = ?').get(id, version) as
      FilaMemoria | undefined) ?? null
  );
}

// Solo una ensamblada de la oferta que no sea ya la última de su lote (con memoria por lote, cada
// lote tiene sus versiones), y sin otra a medias (se montaría a la vez).
function comprobarOrigen(db: Db, id: string, version: number): Result<FilaMemoria> {
  const m = versionDe(db, id, version);
  if (!m) return fail('not_found', `No hay memoria v${version} de esta licitación.`);
  if (m.ensayo) return fail('conflicto', `La v${version} es de ensayo (no presentada): no se vuelve a ella.`);
  if (m.estado !== 'ensamblada')
    return fail('conflicto', `La v${version} no llegó a ensamblarse: no hay texto al que volver.`);
  const ultima = (
    db
      .prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ? AND ensayo = 0 AND lote IS ?')
      .get(id, m.lote ?? null) as { v: number }
  ).v;
  if (ultima === version)
    return fail(
      'conflicto',
      m.lote
        ? `La v${version} ya es la última versión de la memoria del lote ${m.lote}.`
        : `La v${version} ya es la última versión.`,
    );
  const abierta = db
    .prepare("SELECT version FROM memorias WHERE licitacion_id = ? AND estado IN ('redactando', 'ensamblando') LIMIT 1")
    .get(id) as { version: number } | undefined;
  if (abierta)
    return fail(
      'conflicto',
      `La v${abierta.version} se está redactando o montando: vuelve a la v${version} cuando termine.`,
    );
  return ok(m);
}

// La copia va con el guion vigente si sus apartados casan con los de la versión de origen; si
// no, con el suyo, para que el documento no mezcle títulos de un guion con textos de otro (las
// comprobaciones la marcan entonces como de otro guion).
function guionDeLaCopia(db: Db, origen: FilaMemoria): number {
  const vigente = guionVigente(db, origen.licitacion_id);
  if (!vigente || vigente.id === origen.guion_id) return origen.guion_id;
  const c = cambiosEntre(db, origen.guion_id, vigente.id);
  return c && apartadosCompatibles(c) ? vigente.id : origen.guion_id;
}

// apartados_rehechos vacío distingue la copia de una mejora (que siempre rehace alguno). Nace
// «ensamblada» sin documento solo para que remontarMemoria la reserve en el acto.
function crearCopia(db: Db, origen: FilaMemoria): { id: number; version: number } {
  return db.transaction(() => {
    const version =
      (
        db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(origen.licitacion_id) as {
          v: number;
        }
      ).v + 1;
    const avisos = (JSON.parse(origen.avisos) as string[]).filter((a) => !a.startsWith(PREFIJO_DESCARTADAS));
    if (origen.subida)
      avisos.push(
        `La v${origen.version} era un Word subido a mano: la v${version} se monta con el texto reconocido de sus apartados, sin el formato de ese Word.`,
      );
    // La copia es del mismo lote que su origen: si no, la de un lote pasaría a ser la común.
    const id = Number(
      db
        .prepare(
          `INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, avisos, version_base, apartados_rehechos, fase, ronda, coherencia, lote)
      VALUES (?, ?, ?, 'ensamblada', ?, ?, ?, '[]', ?, ?, ?, ?)`,
        )
        .run(
          origen.licitacion_id,
          guionDeLaCopia(db, origen),
          version,
          new Date().toISOString(),
          JSON.stringify(avisos),
          origen.version,
          origen.fase,
          origen.ronda,
          origen.coherencia,
          origen.lote ?? null,
        ).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos, caracteres, paginas_estimadas, avisos, agente, recibido_en, error)
      SELECT ?, apartado, estado, datos, caracteres, paginas_estimadas, avisos, ?, recibido_en, error FROM memoria_apartados WHERE memoria_id = ?`,
    ).run(id, `copiado-v${origen.version}`, origen.id);
    // La tabla guía sale de la estrategia de su memoria.
    db.prepare(
      `INSERT INTO memoria_estrategias (memoria_id, datos, avisos, agente, trabajo_id, ruta_md, creada_en)
      SELECT ?, datos, avisos, agente, trabajo_id, ruta_md, creada_en FROM memoria_estrategias WHERE memoria_id = ?`,
    ).run(id, origen.id);
    return { id, version };
  })();
}

// Si no se pudo montar, la copia no queda a medias: se borra y todo sigue como estaba.
function deshacerCopia(db: Db, memoriaId: number): void {
  db.transaction(() => {
    for (const t of ['memoria_apartados', 'memoria_estrategias'])
      db.prepare(`DELETE FROM ${t} WHERE memoria_id = ?`).run(memoriaId);
    db.prepare('DELETE FROM memorias WHERE id = ?').run(memoriaId);
  })();
}

// Lo que la copia deja atrás, dicho en sus avisos y en la respuesta.
function dejarAtras(
  db: Db,
  copia: { id: number; version: number },
  id: string,
  borrador: number,
): { descartadas: number[]; avisos: string[] } {
  const descartadas = descartarVersionesSinRevisar(db, id, borrador, copia.version);
  const avisos = JSON.parse(
    (db.prepare('SELECT avisos FROM memorias WHERE id = ?').get(copia.id) as { avisos: string }).avisos,
  ) as string[];
  const dicho = avisoDescartadas(copia.version, descartadas);
  if (dicho) avisos.push(dicho);
  db.prepare('UPDATE memorias SET avisos = ? WHERE id = ?').run(JSON.stringify(avisos), copia.id);
  return { descartadas, avisos };
}

/** «Se crea la nueva versión igual que la restaurada, sin Hermes. La pendiente pasa a descartada.» */
function mensajeRestaurada(version: number, desde: number, descartadas: number[]): string {
  const base = `Se crea la v${version} igual que la v${desde}, sin Hermes (0 runs).`;
  if (!descartadas.length) return base;
  const vs = descartadas.map((v) => `v${v}`);
  return descartadas.length === 1
    ? `${base} La ${vs[0]} pendiente pasa a descartada.`
    : `${base} Las ${vs.slice(0, -1).join(', ')} y ${vs.at(-1)} pendientes pasan a descartadas.`;
}

/** Crea la versión siguiente igual que la `version` elegida, sin ningún trabajo de IA. */
export async function restaurarVersion(
  db: Db,
  id: string,
  version: number,
  raices: Raices = raicesActuales(),
): Promise<Result<MemoriaRestaurada>> {
  const origen = comprobarOrigen(db, id, version);
  if (origen.error) return origen;
  const copia = crearCopia(db, origen.data);
  const montada = await remontarMemoria(db, id, copia.version, raices);
  if (montada.error) {
    deshacerCopia(db, copia.id);
    return montada;
  }
  const atras = dejarAtras(db, copia, id, montada.data.borrador);
  const heredadas = heredarAnulacion(db, copia.id, origen.data);
  emitir(db, {
    tipo: 'licitacion.memoria',
    dominio: 'licitaciones',
    recurso: id,
    datos: { accion: 'restaurada', version: copia.version, version_base: version, descartadas: atras.descartadas },
  });
  log.info('memoria restaurada', {
    licitacion: id,
    version: copia.version,
    desde: version,
    descartadas: atras.descartadas.length,
  });
  return ok({
    memoria: copia.id,
    version: copia.version,
    desde: version,
    borrador: montada.data.borrador,
    ruta: montada.data.ruta,
    descartadas: atras.descartadas,
    fugas_heredadas: heredadas,
    avisos: atras.avisos,
    mensaje: mensajeRestaurada(copia.version, version, atras.descartadas),
  });
}
