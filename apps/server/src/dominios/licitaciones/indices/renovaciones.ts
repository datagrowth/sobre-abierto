// «Avisarme cuando salga»: seguir un contrato que vence y recibir su nueva licitación en Oportunidades.
import { z } from 'zod';
import { emitir } from '../../../nucleo/eventos.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Db } from '../store.js';

// Una persona sigue un contrato que vence y, cuando el mismo órgano publica una licitación abierta nueva (vista
// después de pedir el aviso) con su CPV a 4 cifras, desde 18 meses antes de su fin, esa licitación entra en
// Oportunidades como «renovación que seguías» (renovacion_de), aunque el prefiltro no la cogiera, y queda un
// evento en la Actividad.
export const Renovacion = z.strictObject({
  licitacion_id: z
    .string()
    .trim()
    .regex(/^[\w-]{3,40}$/, 'Id de licitación no válido.'),
  lote: z.string().trim().max(40).default(''),
});
export type RenovacionData = z.infer<typeof Renovacion>;

const MOTIVO_RENOVACION = 'renovación que seguías';

/** Sigue un contrato que vence: hace falta el NIF del órgano para reconocer su nueva licitación. */
export function seguirRenovacion(db: Db, r: RenovacionData, usuarioId: number | null): Result<{ seguida: boolean }> {
  const c = db
    .prepare(
      `SELECT c.fin_estimado, l.organo_nif FROM contratos c JOIN licitaciones l ON l.id = c.licitacion_id
    WHERE c.licitacion_id = ? AND c.lote = ?`,
    )
    .get(r.licitacion_id, r.lote) as { fin_estimado: string | null; organo_nif: string | null } | undefined;
  if (!c) return fail('not_found', 'No hay ningún contrato adjudicado con esa licitación y ese lote.');
  if (!c.organo_nif)
    return fail(
      'invalid_input',
      'El órgano de este contrato no publica su NIF: no se puede reconocer su nueva licitación.',
    );
  const cpvs = (
    db
      .prepare(`SELECT DISTINCT substr(cpv, 1, 4) AS c FROM licitacion_cpv WHERE licitacion_id = ? AND lote IN (?, '')`)
      .all(r.licitacion_id, r.lote) as { c: string }[]
  ).map((f) => f.c);
  if (!cpvs.length)
    return fail('invalid_input', 'El contrato no tiene CPV: no se puede reconocer su nueva licitación.');
  db.prepare(
    `INSERT INTO renovaciones_seguidas (licitacion_id, lote, organo_nif, cpvs4, fin_estimado, usuario_id, creada_en)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(licitacion_id, lote) DO NOTHING`,
  ).run(
    r.licitacion_id,
    r.lote,
    c.organo_nif,
    `,${cpvs.join(',')},`,
    c.fin_estimado,
    usuarioId,
    new Date().toISOString(),
  );
  return ok({ seguida: true });
}

export function dejarDeSeguirRenovacion(db: Db, r: RenovacionData): Result<{ seguida: boolean }> {
  const borradas = db
    .prepare('DELETE FROM renovaciones_seguidas WHERE licitacion_id = ? AND lote = ?')
    .run(r.licitacion_id, r.lote).changes;
  return borradas ? ok({ seguida: false }) : fail('not_found', 'Ese contrato no se estaba siguiendo.');
}

/** Claves «licitación|lote» de lo que se sigue, para marcar la lista de vencimientos. */
export function renovacionesSeguidas(db: Db): Set<string> {
  return new Set(
    (
      db.prepare('SELECT licitacion_id, lote FROM renovaciones_seguidas').all() as {
        licitacion_id: string;
        lote: string;
      }[]
    ).map((f) => `${f.licitacion_id}|${f.lote}`),
  );
}

type Seguida = {
  licitacion_id: string;
  lote: string;
  organo_nif: string;
  cpvs4: string;
  fin_estimado: string | null;
  creada_en: string;
};

// Solo cuenta lo que la plataforma vio por primera vez después de pedir el aviso (vista_en no cambia
// con las versiones): lo que ya estaba abierto entonces no es la renovación, y la persona ya podía verlo.
function nuevaEdicion(db: Db, s: Seguida): string | null {
  const desde = s.fin_estimado ?? s.creada_en.slice(0, 10);
  const f = db
    .prepare(
      `SELECT l.id FROM licitaciones l
    WHERE l.organo_nif = ? AND l.id <> ? AND l.estado IN ('PRE', 'PUB') AND l.borrada_en IS NULL AND l.vista_en > ?
      AND COALESCE(l.publicada_en, l.actualizada_en) >= date(?, '-18 months')
      AND EXISTS (SELECT 1 FROM licitacion_cpv c WHERE c.licitacion_id = l.id AND instr(?, ',' || substr(c.cpv, 1, 4) || ',') > 0)
    ORDER BY COALESCE(l.publicada_en, l.actualizada_en) DESC LIMIT 1`,
    )
    .get(s.organo_nif, s.licitacion_id, s.creada_en, desde, s.cpvs4) as { id: string } | undefined;
  return f?.id ?? null;
}

/** Busca la nueva licitación de lo que se sigue; la que aparece entra en Oportunidades. Devuelve cuántas encontró. */
export function vueltaRenovaciones(db: Db): number {
  const seguidas = db
    .prepare(
      'SELECT licitacion_id, lote, organo_nif, cpvs4, fin_estimado, creada_en FROM renovaciones_seguidas WHERE encontrada_id IS NULL',
    )
    .all() as Seguida[];
  let encontradas = 0;
  for (const s of seguidas) {
    const id = nuevaEdicion(db, s);
    if (!id) continue;
    const ts = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, rescatada, cambiada_a_mano, renovacion_de, creada_en, actualizada_en)
        VALUES (?, 'nueva', ?, 1, 0, ?, ?, ?) ON CONFLICT(licitacion_id) DO UPDATE SET renovacion_de = excluded.renovacion_de`,
      ).run(id, MOTIVO_RENOVACION, s.licitacion_id, ts, ts);
      db.prepare(
        'UPDATE renovaciones_seguidas SET encontrada_id = ?, encontrada_en = ? WHERE licitacion_id = ? AND lote = ?',
      ).run(id, ts, s.licitacion_id, s.lote);
      emitir(db, {
        tipo: 'licitacion.renovacion',
        dominio: 'licitaciones',
        recurso: id,
        datos: { de: s.licitacion_id, lote: s.lote },
      });
    })();
    encontradas += 1;
  }
  return encontradas;
}
