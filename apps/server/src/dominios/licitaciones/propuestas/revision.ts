// Revisión de lo que escribe la IA (borrador y evaluación): entra pendiente y una persona lo acepta o descarta.
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { fugasDeBorrador, lugarDeFuga, type AnulacionFugas, type FugaEnMemoria } from '../oferta/fugasMemoria.js';
import type { Db } from '../store.js';

const log = logger('licitaciones');

// Lo descartado deja de mostrarse y de darse a Hermes como contexto, pero no se borra: queda constancia de lo
// que se pidió. Una memoria con fugas entre sobres (oferta/fugas.ts) solo se da por buena con el motivo de quien
// la revisa.
export const ESTADOS_REVISION = ['pendiente', 'aceptada', 'descartada'] as const;
export type EstadoRevision = (typeof ESTADOS_REVISION)[number];

export const Revision = z.strictObject({ decision: z.enum(['aceptar', 'descartar']) });
export type RevisionData = z.infer<typeof Revision>;

export const RevisionBorrador = z.strictObject({
  decision: Revision.shape.decision,
  anular_fugas: z
    .string()
    .trim()
    .min(15, 'Explica en una frase por qué no son fugas (al menos 15 caracteres).')
    .max(2000)
    .optional()
    .describe('Por qué lo detectado no es una fuga entre sobres: sin él no se da por buena una memoria con fugas'),
});
export type RevisionBorradorData = z.infer<typeof RevisionBorrador>;

const ESTADO = { aceptar: 'aceptada', descartar: 'descartada' } as const;

// El nombre de la tabla sale siempre de esta lista fija del código, nunca de la entrada.
const TABLAS = {
  borradores: { evento: 'licitacion.borrador', campo: 'borrador', ninguno: 'ningún borrador' },
  evaluaciones: { evento: 'licitacion.evaluacion', campo: 'evaluacion', ninguno: 'ninguna evaluación' },
} as const;
export type TablaIa = keyof typeof TABLAS;

// Tampoco la presentada (oferta/memoriaPresentada.ts): es lo que se entregó y solo la sustituye otra presentada.
const NO_ES_DE_ENSAYO =
  'NOT EXISTS (SELECT 1 FROM memorias m WHERE m.id = borradores.memoria_id AND (m.ensayo = 1 OR m.presentada > 0))';
// Con memoria por lote (oferta/memoriaLote.ts) cada lote tiene sus versiones: aceptar o montar la del
// lote 2 no descarta la del lote 4. Un borrador sin memoria cuenta como de la común (lote null).
const DEL_MISMO_LOTE = '(SELECT m.lote FROM memorias m WHERE m.id = borradores.memoria_id) IS ?';
// Las evaluaciones van por versión: la común (lote null) también descarta las de versiones sin memoria.
const VERSION_DEL_LOTE = {
  comun: 'NOT IN (SELECT version FROM memorias WHERE licitacion_id = evaluaciones.licitacion_id AND lote IS NOT NULL)',
  lote: 'IN (SELECT version FROM memorias WHERE licitacion_id = evaluaciones.licitacion_id AND lote IS ?)',
} as const;

const loteDelBorrador = (db: Db, borradorId: number): string | null =>
  (
    db
      .prepare('SELECT m.lote FROM borradores b JOIN memorias m ON m.id = b.memoria_id WHERE b.id = ?')
      .get(borradorId) as { lote: string | null } | undefined
  )?.lote ?? null;

/**
 * Una memoria nueva deja atrás a las anteriores: al ensamblarse, las que nadie revisó (y sus
 * evaluaciones) se descartan solas. La aceptada se queda hasta que se acepta otra, para que
 * la lista de presentación no se quede sin memoria mientras se revisa la nueva. Las de ensayo
 * no compiten con la de la oferta: ni se descartan ni pierden su nota (es lo que se mide). Con
 * memoria por lote, solo las del mismo lote que la nueva.
 */
export function descartarVersionesSinRevisar(
  db: Db,
  licitacionId: string,
  borradorId: number,
  version: number,
): number[] {
  const ts = new Date().toISOString();
  const lote = loteDelBorrador(db, borradorId);
  // Las versiones que se van, para decirlo: nada desaparece sin que nadie lo vea.
  const descartadas = (
    db
      .prepare(
        `SELECT DISTINCT version FROM borradores WHERE licitacion_id = ? AND origen = 'ensamblado'
    AND estado = 'pendiente' AND id <> ? AND version IS NOT NULL AND ${NO_ES_DE_ENSAYO} AND ${DEL_MISMO_LOTE} ORDER BY version`,
      )
      .all(licitacionId, borradorId, lote) as { version: number }[]
  ).map((f) => f.version);
  db.prepare(
    `UPDATE borradores SET estado = 'descartada', revisado_en = ? WHERE licitacion_id = ? AND origen = 'ensamblado'
    AND estado = 'pendiente' AND id <> ? AND ${NO_ES_DE_ENSAYO} AND ${DEL_MISMO_LOTE}`,
  ).run(ts, licitacionId, borradorId, lote);
  const delLote = lote === null ? VERSION_DEL_LOTE.comun : VERSION_DEL_LOTE.lote;
  db.prepare(
    `UPDATE evaluaciones SET estado = 'descartada', revisado_en = ? WHERE licitacion_id = ? AND estado = 'pendiente'
    AND json_extract(datos, '$.memoria.version') < ?
    AND json_extract(datos, '$.memoria.version') NOT IN (SELECT version FROM memorias WHERE licitacion_id = evaluaciones.licitacion_id AND (ensayo = 1 OR presentada > 0))
    AND json_extract(datos, '$.memoria.version') ${delLote}`,
  ).run(ts, licitacionId, version, ...(lote === null ? [] : [lote]));
  return descartadas;
}

/** «Al llegar la v4, la v3 sin revisar pasó a descartada.» (o «las v2 y v3 … pasaron a descartadas»); null si no se fue ninguna. */
export function avisoDescartadas(version: number, descartadas: number[]): string | null {
  if (!descartadas.length) return null;
  if (descartadas.length === 1) return `Al llegar la v${version}, la v${descartadas[0]} sin revisar pasó a descartada.`;
  const vs = descartadas.map((v) => `v${v}`);
  return `Al llegar la v${version}, las ${vs.slice(0, -1).join(', ')} y ${vs.at(-1)} sin revisar pasaron a descartadas.`;
}

// Aceptar una memoria ensamblada descarta las demás versiones de su lote (solo vale una por lote); las de ensayo, no.
function descartarOtrasMemorias(db: Db, licitacionId: string, borradorId: number): void {
  const b = db.prepare("SELECT 1 FROM borradores WHERE id = ? AND origen = 'ensamblado'").get(borradorId);
  if (!b) return;
  db.prepare(
    `UPDATE borradores SET estado = 'descartada', revisado_en = ? WHERE licitacion_id = ? AND origen = 'ensamblado'
    AND estado <> 'descartada' AND id <> ? AND ${NO_ES_DE_ENSAYO} AND ${DEL_MISMO_LOTE}`,
  ).run(new Date().toISOString(), licitacionId, borradorId, loteDelBorrador(db, borradorId));
}

const CITAS_EN_EL_RECHAZO = 5;

function rechazoPorFugas(fugas: FugaEnMemoria[]): string {
  const citas = fugas
    .slice(0, CITAS_EN_EL_RECHAZO)
    .map((f) => `${lugarDeFuga(f)}: «${f.cita}» (${f.descripcion})`)
    .join('; ');
  const mas = fugas.length > CITAS_EN_EL_RECHAZO ? ` y ${fugas.length - CITAS_EN_EL_RECHAZO} más` : '';
  return `La memoria menciona lo que va en el archivo de los criterios automáticos o de la oferta económica, causa de exclusión: ${citas}${mas}. Corrígela (pide cambios o sube una versión editada) o, si no son fugas, explica por qué en «anular_fugas».`;
}

// Dar por buena una memoria con fugas la excluiría: solo con el motivo de quien la revisa, que
// queda guardado junto a lo que anuló.
function comprobarFugas(db: Db, borradorId: number, motivo: string | undefined): Result<null> {
  const fugas = fugasDeBorrador(db, borradorId);
  if (!fugas.length) return ok(null);
  if (!motivo) return fail('conflicto', rechazoPorFugas(fugas));
  const anulacion: AnulacionFugas = {
    motivo,
    en: new Date().toISOString(),
    fugas: fugas.map(({ apartado, tipo, marca, criterio, cita }) => ({ apartado, tipo, marca, criterio, cita })),
  };
  db.prepare('UPDATE memorias SET anulacion_fugas = ? WHERE id = (SELECT memoria_id FROM borradores WHERE id = ?)').run(
    JSON.stringify(anulacion),
    borradorId,
  );
  log.warn('memoria dada por buena con fugas anuladas', { borrador: borradorId, fugas: fugas.length });
  return ok(null);
}

// Aceptar una memoria de ensayo descartaría la de la oferta (descartarOtrasMemorias): nunca se da por buena.
const esDeEnsayo = (db: Db, borradorId: number): boolean =>
  db
    .prepare('SELECT 1 FROM borradores b JOIN memorias m ON m.id = b.memoria_id WHERE b.id = ? AND m.ensayo = 1')
    .get(borradorId) !== undefined;

// La presentada ya está dada por buena al subirla y es lo entregado: ni se acepta otra vez ni se descarta por error.
const esPresentada = (db: Db, borradorId: number): boolean =>
  db
    .prepare('SELECT 1 FROM borradores b JOIN memorias m ON m.id = b.memoria_id WHERE b.id = ? AND m.presentada > 0')
    .get(borradorId) !== undefined;

/** Una persona acepta o descarta un borrador o una evaluación de la IA. */
export function revisarIa(
  db: Db,
  tabla: TablaIa,
  id: number,
  r: RevisionBorradorData,
): Result<{ id: number; estado: EstadoRevision }> {
  const t = TABLAS[tabla];
  const fila = db.prepare(`SELECT licitacion_id FROM ${tabla} WHERE id = ?`).get(id) as
    { licitacion_id: string } | undefined;
  if (!fila) return fail('not_found', `No hay ${t.ninguno} con id ${id}.`);
  const estado = ESTADO[r.decision];
  if (tabla === 'borradores' && esPresentada(db, id))
    return fail(
      'conflicto',
      'Es la memoria presentada: lo entregado no se revisa ni se descarta; si te equivocaste de archivo, sube la buena como presentada.',
    );
  if (tabla === 'borradores' && estado === 'aceptada' && esDeEnsayo(db, id))
    return fail(
      'conflicto',
      'Es una memoria de ensayo (no presentada): sirve para compararla con la presentada y no se da por buena.',
    );
  const fugas = tabla === 'borradores' && estado === 'aceptada' ? comprobarFugas(db, id, r.anular_fugas) : ok(null);
  if (fugas.error) return fugas;
  db.prepare(`UPDATE ${tabla} SET estado = ?, revisado_en = ? WHERE id = ?`).run(estado, new Date().toISOString(), id);
  if (tabla === 'borradores' && estado === 'aceptada') descartarOtrasMemorias(db, fila.licitacion_id, id);
  emitir(db, {
    tipo: t.evento,
    dominio: 'licitaciones',
    recurso: fila.licitacion_id,
    datos: { [t.campo]: id, accion: 'revisada', estado },
  });
  return ok({ id, estado });
}
