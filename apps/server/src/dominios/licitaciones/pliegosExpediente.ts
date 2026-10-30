// Contrasta lo que la empresa prepara con la página de su expediente en la PLACSP, no solo con el feed.
import type { Db } from './store.js';
import { ahora } from '../../nucleo/db.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { logger } from '../../nucleo/log.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import { USER_AGENT } from '../../nucleo/http.js';
import { esUrlDePlataforma } from './placsp/fuentes.js';
import { leerConTope, pedirPermitida } from './placsp/descarga.js';
import { documentosDelExpediente, esPaginaDeExpediente, type DocumentoExpediente } from './placsp/expediente.js';
import { desdeResueltas, SQL_RESUELTAS_SIN_ACTA } from './propuestas/actasQueFaltan.js';

// Los anuncios (y sus rectificaciones) y los «Otros documentos» que lista entran en la cola de pliegos (origen
// «expediente») y los baja la descarga de siempre. Cada licitación se revisa al pasar a «En preparación» y luego
// cada pocas horas mientras siga en plazo; la revisión (cuándo, cuántos documentos, el error) queda en
// expedientes_placsp, y una revisión buena es lo que da por comprobado que no falta nada publicado
// (pliegosCompletitud.ts).
export const REVISAR_CADA_MS = 6 * 60 * 60_000;
const REVISAR_RESUELTAS_MS = 24 * 60 * 60_000;
const MAX_POR_VUELTA = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 60_000;
const log = logger('licitaciones.expediente');

export type RevisionExpediente = {
  revisado_en: string;
  comprobado_en: string | null;
  documentos: number;
  error: string | null;
};

/** La última revisión de la página del expediente, o null si nunca se revisó. */
export function revisionExpediente(db: Db, id: string): RevisionExpediente | null {
  return (
    (db
      .prepare('SELECT revisado_en, comprobado_en, documentos, error FROM expedientes_placsp WHERE licitacion_id = ?')
      .get(id) as RevisionExpediente | undefined) ?? null
  );
}

/** El HTML de la página de un expediente de la PLACSP (solo de la propia plataforma, con tope de tamaño). */
export async function paginaExpediente(url: string): Promise<Result<string>> {
  if (!esUrlDePlataforma(url)) return fail('url_no_permitida', 'La licitación no enlaza a una página de la PLACSP.');
  const r = await pedirPermitida(
    url,
    { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    esUrlDePlataforma,
  );
  if (r.error) return r;
  if (!r.data.ok) {
    await r.data.body?.cancel().catch(() => undefined);
    return fail(`placsp_http_${r.data.status}`, r.data.statusText);
  }
  const bytes = await leerConTope(r.data, MAX_BYTES);
  if (bytes.error) return bytes;
  const html = bytes.data.toString('utf8');
  return esPaginaDeExpediente(html)
    ? ok(html)
    : fail('no_es_expediente', 'La PLACSP no devolvió la página del expediente (sin tabla de documentos).');
}

// INSERT OR IGNORE: lo que ya está en cola (del feed, con la misma URL) se queda como está.
function registrar(db: Db, id: string, docs: DocumentoExpediente[]): number {
  const insertar =
    db.prepare(`INSERT OR IGNORE INTO pliegos (licitacion_id, url, clase, nombre, estado, origen, actualizado_en)
    VALUES (?, ?, ?, ?, 'pendiente', 'expediente', ?)`);
  return docs.reduce((n, d) => n + insertar.run(id, d.url, d.clase, d.nombre, ahora()).changes, 0);
}

function apuntar(db: Db, id: string, cuando: string, r: Result<number>, documentos: number): void {
  db.prepare(
    `INSERT INTO expedientes_placsp (licitacion_id, revisado_en, comprobado_en, documentos, error) VALUES (@id, @cuando, @comprobado, @documentos, @error)
    ON CONFLICT(licitacion_id) DO UPDATE SET revisado_en = excluded.revisado_en, comprobado_en = COALESCE(excluded.comprobado_en, comprobado_en),
      documentos = CASE WHEN excluded.error IS NULL THEN excluded.documentos ELSE documentos END, error = excluded.error`,
  ).run({
    id,
    cuando,
    comprobado: r.error ? null : cuando,
    documentos,
    error: r.error ? `${r.error.code}: ${r.error.message}`.slice(0, 300) : null,
  });
}

/**
 * Lee la página del expediente de una licitación y deja en cola lo que publica y aún no estaba.
 * Devuelve cuántos documentos nuevos entran; el resultado (o el fallo) queda apuntado.
 */
async function revisarExpediente(db: Db, id: string, ahoraMs = Date.now()): Promise<Result<number>> {
  const l = db.prepare('SELECT url FROM licitaciones WHERE id = ?').get(id) as { url: string | null } | undefined;
  if (!l) return fail('not_found', 'La licitación no existe.');
  const html = await paginaExpediente(l.url ?? '').catch((err: unknown) =>
    fail<string>('placsp_inalcanzable', errorMessage(err)),
  );
  const docs = html.error ? [] : documentosDelExpediente(html.data, l.url ?? undefined);
  // Una página sin un solo documento que el parser entienda no es una revisión buena: lo más
  // probable es que haya cambiado su HTML, y darla por comprobada taparía lo que falte.
  const r: Result<number> = html.error
    ? html
    : docs.length
      ? ok(registrar(db, id, docs))
      : fail('expediente_sin_documentos', 'La página del expediente no lista ningún documento que se pueda leer.');
  apuntar(db, id, new Date(ahoraMs).toISOString(), r, docs.length);
  if (r.error) log.warn('expediente no revisado', { licitacion: id, error: r.error.code });
  return r;
}

let revisando = false;

/**
 * Revisa los expedientes de lo que la empresa prepara y sigue en plazo que nunca se revisaron o hace
 * más de seis horas, los de plazo más cercano primero y unos pocos por vuelta (la PLACSP es
 * lenta). Después, una vez al día, los de lo presentado y ya resuelto sin acta leída: si la
 * PLACSP publica el acta o el informe de valoración, se baja con los pliegos y se aprende de ella.
 * Devuelve cuántos documentos nuevos entraron en la cola.
 */
export async function revisarExpedientes(db: Db, ahoraMs = Date.now()): Promise<number> {
  if (revisando) return 0;
  revisando = true;
  try {
    const ids = db
      .prepare(
        `SELECT l.id FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
      LEFT JOIN expedientes_placsp e ON e.licitacion_id = l.id
      WHERE l.borrada_en IS NULL AND (
          (o.estado = 'en_preparacion' AND (l.fecha_limite IS NULL OR l.fecha_limite > @hoy) AND (e.revisado_en IS NULL OR e.revisado_en <= @antes))
          OR (${SQL_RESUELTAS_SIN_ACTA} AND (e.revisado_en IS NULL OR e.revisado_en <= @antesDia)))
      ORDER BY o.estado <> 'en_preparacion', e.revisado_en IS NOT NULL, COALESCE(l.fecha_limite, '9999') LIMIT @max`,
      )
      .all({
        hoy: horaLocalEspana(ahoraMs),
        antes: new Date(ahoraMs - REVISAR_CADA_MS).toISOString(),
        antesDia: new Date(ahoraMs - REVISAR_RESUELTAS_MS).toISOString(),
        desdeResueltas: desdeResueltas(ahoraMs),
        max: MAX_POR_VUELTA,
      }) as { id: string }[];
    let nuevos = 0;
    for (const { id } of ids) nuevos += (await revisarExpediente(db, id, ahoraMs)).data ?? 0;
    return nuevos;
  } finally {
    revisando = false;
  }
}
