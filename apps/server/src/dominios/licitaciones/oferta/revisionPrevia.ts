// Revisión previa al envío: tras cada versión del paquete, Hermes propone cómo resolver cada bloqueo.
import fs from 'node:fs';
import type { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { invalido, responder } from '../../../nucleo/http.js';
import { documentoEnDisco, type Raices } from '../../../nucleo/salidas.js';
import { encolar, encolarUnico } from '../../../nucleo/trabajos.js';
import { obtenerTrabajo } from '../../../nucleo/colaTipos.js';
import { dbLicitaciones } from '../db.js';
import { confirmado, conId } from '../http.js';
import type { Db } from '../store.js';
import { comprobacionesDe } from './comprobaciones.js';
import { avisarComprobaciones } from './comprobacionesBloqueos.js';
import { sinImportes } from './comprobacionesCoherencia.js';
import { frenoDeElegibilidad } from './frenoElegibilidad.js';
import { paqueteVigente } from './paquete.js';
import { DURACION_MIN, guardaPlazo, licitacionesEnPreparacion } from './plazo.js';

// Hermes lee las comprobaciones y propone, con citas literales, cómo resolver cada bloqueo que sabe resolver
// (licitaciones_bloqueo_proponer). Cierra con licitaciones_revision_previa, que deja REVISION_PREVIA.md junto al
// paquete y la tarjeta «revision_previa» de la bandeja. Gasta cuota: una sola vez por versión del paquete y
// nunca con el freno de elegibilidad puesto.
export const TIPO_REVISION_PREVIA = 'licitaciones.revision_previa';
export const PayloadRevisionPrevia = z.object({
  id: z.string().min(3),
  paquete_version: z.number().int().positive(),
  pedida_en: z.string().min(10),
});
export type PayloadRevisionPrevia = z.infer<typeof PayloadRevisionPrevia>;

export const CierreRevisionPrevia = z.strictObject({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  paquete_version: z.number().int().positive().describe('La versión del paquete de la tarea'),
  resumen: z
    .string()
    .trim()
    .min(10)
    .max(2000)
    .describe('Lo que revisaste, lo que propusiste y lo que queda para una persona; sin importes'),
});
export type CierreRevisionPrevia = z.infer<typeof CierreRevisionPrevia>;

const log = logger('licitaciones');
// De pedirla a tenerla (la guarda de plazo es la de siempre, plazo.ts): lee las comprobaciones y unos pocos pasajes.
export const DURACION_REVISION_MIN = DURACION_MIN.revision_previa;
const ARCHIVO = 'REVISION_PREVIA';
const VIVOS = new Set(['pendiente', 'lanzado']);

type FilaRevisionPrevia = {
  paquete_version: number;
  estado: 'pedida' | 'terminada' | 'fallida';
  resumen: string | null;
  ruta_md: string | null;
  trabajo_id: number | null;
  pedida_en: string;
  terminada_en: string | null;
};
export type OpcionesRevision = { aMano?: boolean; confirmado?: boolean | undefined; ahoraMs?: number | undefined };
export type RevisionEncolada = { trabajo: number; paquete_version: number; nuevo: boolean };

const claveDe = (id: string, v: number): string => `revision-previa-${id}-p${v}`;

function filaDe(db: Db, id: string, version: number): FilaRevisionPrevia | null {
  return (
    (db
      .prepare(
        `SELECT paquete_version, estado, resumen, ruta_md, trabajo_id, pedida_en, terminada_en FROM revisiones_previas
    WHERE licitacion_id = ? AND paquete_version = ?`,
      )
      .get(id, version) as FilaRevisionPrevia | undefined) ?? null
  );
}

const rutaPaquete = (db: Db, id: string, version: number): string | null =>
  (
    db.prepare('SELECT ruta FROM paquetes_presentacion WHERE licitacion_id = ? AND version = ?').get(id, version) as
      { ruta: string } | undefined
  )?.ruta ?? null;

function puertas(dbNucleo: DbNucleo, db: Db, id: string, version: number, op: OpcionesRevision): Result<null> {
  if (!rutaPaquete(db, id, version)) return fail('not_found', `La licitación ${id} no tiene paquete v${version}.`);
  const freno = frenoDeElegibilidad(db, dbNucleo, id, op.ahoraMs);
  if (freno.frenada) {
    const fila = freno.bloqueos[0]?.titulo;
    return fail(
      'conflicto',
      `La oferta está frenada por elegibilidad${fila ? ` («${fila}»)` : ''}: una persona tiene que decir «Vamos» antes de la revisión previa.`,
    );
  }
  const plazo = guardaPlazo(db, id, 'revision_previa', {
    aMano: op.aMano ?? false,
    confirmado: op.confirmado,
    ahoraMs: op.ahoraMs,
  });
  return plazo.error ? plazo : ok(null);
}

const trabajoVivo = (dbNucleo: DbNucleo, trabajo: number | null): boolean =>
  trabajo !== null && VIVOS.has(obtenerTrabajo(dbNucleo, trabajo)?.estado ?? '');

function guardarPedida(db: Db, id: string, version: number, trabajo: number, pedidaEn: string): void {
  db.prepare(
    `INSERT INTO revisiones_previas (licitacion_id, paquete_version, estado, trabajo_id, pedida_en) VALUES (?, ?, 'pedida', ?, ?)
    ON CONFLICT (licitacion_id, paquete_version) DO UPDATE SET estado = 'pedida', trabajo_id = excluded.trabajo_id, pedida_en = excluded.pedida_en,
    resumen = NULL, ruta_md = NULL, agente = NULL, terminada_en = NULL`,
  ).run(id, version, trabajo, pedidaEn);
}

/**
 * Encola la revisión previa del paquete vN. Lo automático, una sola vez por versión (clave
 * `revision-previa-<id>-p<v>`); una persona puede volver a pedirla (si ya hay una en marcha, esa).
 * Nunca con el freno de elegibilidad puesto ni si la guardia de plazo la rechaza.
 */
export function encolarRevisionPrevia(
  dbNucleo: DbNucleo,
  db: Db,
  id: string,
  version: number,
  op: OpcionesRevision = {},
): Result<RevisionEncolada> {
  const previa = filaDe(db, id, version);
  if (previa && (!op.aMano || trabajoVivo(dbNucleo, previa.trabajo_id)))
    return ok({ trabajo: previa.trabajo_id ?? 0, paquete_version: version, nuevo: false });
  const p = puertas(dbNucleo, db, id, version, op);
  if (p.error) return p;
  const pedidaEn = new Date(op.ahoraMs ?? Date.now()).toISOString();
  const payload: PayloadRevisionPrevia = { id, paquete_version: version, pedida_en: pedidaEn };
  const base = { tipo: TIPO_REVISION_PREVIA, dominio: 'licitaciones', payload };
  const trabajo = op.aMano
    ? encolarUnico(dbNucleo, { ...base, base: claveDe(id, version), aMano: true }).id
    : encolar(dbNucleo, { ...base, clave: claveDe(id, version) });
  guardarPedida(db, id, version, trabajo, pedidaEn);
  log.info('revisión previa pedida', { licitacion: id, version, trabajo, a_mano: Boolean(op.aMano) });
  return ok({ trabajo, paquete_version: version, nuevo: true });
}

/** La revisión previa a mano del paquete vigente (o de `version`). */
export function pedirRevisionPrevia(
  dbNucleo: DbNucleo,
  db: Db,
  id: string,
  op: { version?: number | undefined; confirmado?: boolean | undefined; ahoraMs?: number } = {},
): Result<RevisionEncolada> {
  const version = op.version ?? paqueteVigente(db, id)?.version;
  if (!version) return fail('not_found', 'Esta oferta aún no tiene paquete: la revisión previa se hace sobre él.');
  return encolarRevisionPrevia(dbNucleo, db, id, version, {
    aMano: true,
    confirmado: op.confirmado,
    ahoraMs: op.ahoraMs,
  });
}

/**
 * En cada vuelta, tras regenerar los paquetes: la revisión previa del paquete vigente de cada
 * oferta en preparación que aún no la tiene. Un paquete desfasado no: se rehace antes. Devuelve cuántas.
 */
export function revisionesPreviasAuto(dbNucleo: DbNucleo, db: Db, ahoraMs = Date.now()): number {
  let n = 0;
  for (const l of licitacionesEnPreparacion(db, ahoraMs)) {
    const p = paqueteVigente(db, l.id);
    if (!p || p.desfasado || filaDe(db, l.id, p.version)) continue;
    const r = encolarRevisionPrevia(dbNucleo, db, l.id, p.version, { ahoraMs });
    if (r.error) log.debug('revisión previa sin pedir', { licitacion: l.id, version: p.version, codigo: r.error.code });
    else n += 1;
  }
  return n;
}

export function instruccionesRevisionPrevia(p: PayloadRevisionPrevia, empresa: string): string {
  const { id, paquete_version: v } = p;
  return [
    `Tarea de la plataforma de ${empresa}: revisión previa al envío del paquete v${v} de la licitación ${id}. Propón con evidencia cómo resolver cada bloqueo de las comprobaciones que sepas resolver; no apliques nada. Sigue la skill «licitaciones».`,
    `1. licitaciones_oferta (id=${id}, secciones=[estado, bloqueos]): el veredicto y los bloqueos abiertos con su clave.`,
    '2. Por cada bloqueo que sabes resolver (desmarcar un criterio, asignar a una persona a un rol con su CV y página, vincular un documento de la Biblioteca o de Salidas con su vigencia, una consulta al órgano o el borrador del Anexo XIV), busca la evidencia con licitaciones_pliegos o biblioteca_leer.',
    `3. licitaciones_bloqueo_proponer (id=${id}, clave del bloqueo) con citas literales: copia la frase tal cual está en el documento y su página. Si una cita se rechaza, corrígela con la frase exacta o no propongas ese bloqueo.`,
    '4. No apliques nada ni digas que la oferta está «lista» si el veredicto no es «Lista para firmar». Precio, «dar por buena», riesgo aceptado y registro son de una persona. Ningún importe en lo que escribas.',
    `5. Cierra con licitaciones_revision_previa (id=${id}, paquete_version=${v}, resumen de hasta 2000 caracteres): qué revisaste, qué propusiste y qué queda para una persona.`,
    'No hagas nada más: no escribas en Salidas ni en la Biblioteca y no respondas en ningún canal.',
  ].join('\n');
}

/** ¿Cerró Hermes la revisión previa que pide este payload? */
export function revisionPreviaHecha(db: Db, p: PayloadRevisionPrevia): boolean {
  const f = filaDe(db, p.id, p.paquete_version);
  return f?.estado === 'terminada' && (f.terminada_en ?? '') >= p.pedida_en;
}

// ── Propuestas hechas desde que se pidió ────────────────────────────────────────────────────────

type CitaGuardada = { documento: string; pagina: number | null; texto: string };
type PropuestaRevision = {
  clave: string;
  titulo: string | null;
  tipo: string | null;
  resumen: string;
  citas: CitaGuardada[];
  en: string;
  quien: string;
};
type FilaPropuesta = {
  clave: string;
  propuesta_json: string | null;
  evidencia_json: string | null;
  en: string;
  quien: string;
};

function leerJson<T>(texto: string | null, porDefecto: T): T {
  try {
    return texto ? (JSON.parse(texto) as T) : porDefecto;
  } catch {
    // Una fila ilegible no tumba la revisión: sale sin ese dato.
    return porDefecto;
  }
}

/** La última propuesta de Hermes por bloqueo desde `desde`, con el título de su fila si sigue en las comprobaciones. */
function propuestasDesde(db: Db, id: string, desde: string): PropuestaRevision[] {
  const filas = db
    .prepare(
      `SELECT clave, propuesta_json, evidencia_json, en, quien FROM oferta_bloqueos b
    WHERE licitacion_id = ? AND estado = 'propuesta' AND en >= ?
      AND id = (SELECT MAX(id) FROM oferta_bloqueos x WHERE x.licitacion_id = b.licitacion_id AND x.clave = b.clave AND x.estado = 'propuesta' AND x.en >= ?)
    ORDER BY en, id`,
    )
    .all(id, desde, desde) as FilaPropuesta[];
  const comprobaciones = filas.length ? comprobacionesDe(db, nucleo().db, id).data : null;
  const titulos = new Map((comprobaciones?.bloqueos ?? []).map((b) => [b.clave, b.titulo]));
  return filas.map((f) => {
    const p = leerJson<{ tipo?: string; resumen?: string }>(f.propuesta_json, {});
    return {
      clave: f.clave,
      titulo: titulos.get(f.clave) ?? null,
      tipo: p.tipo ?? null,
      resumen: p.resumen ?? '',
      citas: leerJson<CitaGuardada[]>(f.evidencia_json, []),
      en: f.en,
      quien: f.quien,
    };
  });
}

// ── Cierre con REVISION_PREVIA.md ───────────────────────────────────────────────────────────────

function textoMd(v: number, resumen: string, propuestas: PropuestaRevision[]): string {
  const lineas = [
    `# Revisión previa del paquete v${v}`,
    '',
    'Lo propone Hermes; nada está aplicado: cada propuesta la aplica una persona desde su fila de las comprobaciones.',
    '',
    '## Resumen',
    '',
    resumen,
    '',
    '## Propuestas',
  ];
  if (!propuestas.length) lineas.push('', 'Hermes no propuso cómo resolver ningún bloqueo.');
  for (const p of propuestas) {
    lineas.push(
      '',
      `### ${p.titulo ?? p.clave}`,
      '',
      `- Bloqueo: \`${p.clave}\``,
      `- Tipo: ${p.tipo ?? 'sin tipo'}`,
      `- Propuesta: ${p.resumen}`,
    );
    for (const c of p.citas)
      lineas.push(`- Cita de «${c.documento}»${c.pagina === null ? '' : ` (pág. ${c.pagina})`}: «${c.texto}»`);
  }
  return `${sinImportes(lineas.join('\n'))}\n`;
}

// Sin pisar: si ya hay un REVISION_PREVIA.md (otra revisión de la misma versión), el siguiente libre.
function escribirSinPisar(dir: string, texto: string): string {
  for (let n = 1; ; n += 1) {
    const nombre = n === 1 ? `${ARCHIVO}.md` : `${ARCHIVO}-${n}.md`;
    try {
      fs.writeFileSync(path.join(dir, nombre), texto, { flag: 'wx' });
      return nombre;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

function filaAbierta(db: Db, e: CierreRevisionPrevia): Result<FilaRevisionPrevia & { ruta: string }> {
  const f = filaDe(db, e.id, e.paquete_version);
  if (!f)
    return fail(
      'not_found',
      `No hay ninguna revisión previa pedida del paquete v${e.paquete_version} de ${e.id}: usa los números de la tarea.`,
    );
  if (f.estado === 'terminada')
    return fail('conflicto', `La revisión previa del paquete v${e.paquete_version} ya está cerrada.`);
  const ruta = rutaPaquete(db, e.id, e.paquete_version);
  return ruta ? ok({ ...f, ruta }) : fail('not_found', `La licitación ${e.id} no tiene paquete v${e.paquete_version}.`);
}

export type RevisionCerrada = { paquete_version: number; ruta_md: string; propuestas: number };

/** Cierra la revisión previa: escribe REVISION_PREVIA.md (sin importes, sin pisar) junto al paquete y marca la fila terminada. */
export function cerrarRevisionPrevia(
  db: Db,
  raices: Raices,
  e: CierreRevisionPrevia,
  agente: Agente,
): Result<RevisionCerrada> {
  const f = filaAbierta(db, e);
  if (f.error) return f;
  const dir = documentoEnDisco(raices, f.data.ruta);
  if (dir.error) return dir;
  const propuestas = propuestasDesde(db, e.id, f.data.pedida_en);
  const resumen = sinImportes(e.resumen);
  let rutaMd: string;
  try {
    rutaMd = `${f.data.ruta}/${escribirSinPisar(dir.data, textoMd(e.paquete_version, resumen, propuestas))}`;
  } catch (err) {
    log.error('revisión previa sin escribir', {
      licitacion: e.id,
      version: e.paquete_version,
      error: errorMessage(err),
    });
    return fail('io_error', 'No se pudo escribir REVISION_PREVIA.md en Salidas.');
  }
  db.prepare(
    `UPDATE revisiones_previas SET estado = 'terminada', resumen = ?, ruta_md = ?, agente = ?, terminada_en = ?
    WHERE licitacion_id = ? AND paquete_version = ?`,
  ).run(resumen, rutaMd, agente.nombre, new Date().toISOString(), e.id, e.paquete_version);
  const comprobaciones = comprobacionesDe(db, nucleo().db, e.id);
  if (comprobaciones.data) avisarComprobaciones(e.id, comprobaciones.data.version);
  return ok({ paquete_version: e.paquete_version, ruta_md: rutaMd, propuestas: propuestas.length });
}

export type VistaRevisionPrevia = { revision: FilaRevisionPrevia | null; propuestas: PropuestaRevision[] };

/**
 * La revisión previa de un paquete (o la última, sin versión) y las propuestas que hizo Hermes
 * desde que se pidió. La tarjeta de la bandeja pide la suya: si no, una versión recién «pedida»
 * vaciaría la tarjeta de la memoria terminada.
 */
export function revisionPreviaDe(db: Db, id: string, paqueteVersion?: number): VistaRevisionPrevia {
  const r =
    (db
      .prepare(
        `SELECT paquete_version, estado, resumen, ruta_md, trabajo_id, pedida_en, terminada_en FROM revisiones_previas
    WHERE licitacion_id = ? AND (? IS NULL OR paquete_version = ?) ORDER BY paquete_version DESC LIMIT 1`,
      )
      .get(id, paqueteVersion ?? null, paqueteVersion ?? null) as FilaRevisionPrevia | undefined) ?? null;
  return { revision: r, propuestas: r ? propuestasDesde(db, id, r.pedida_en) : [] };
}

// ── Rutas ───────────────────────────────────────────────────────────────────────────────────────

const ConsultaRevision = z.object({ paquete_version: z.coerce.number().int().positive().optional() });
const PedirRevisionCuerpo = z.strictObject({
  paquete_version: z.number().int().positive().optional(),
  confirmado: z.boolean().optional(),
});

export function rutasRevisionPrevia(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/revision-previa',
    conId((id, req, res) => {
      const q = ConsultaRevision.safeParse(req.query ?? {});
      if (!q.success) {
        invalido(res, q.error);
        return;
      }
      responder(res, ok(revisionPreviaDe(dbLicitaciones(), id, q.data.paquete_version)));
    }),
  );
  r.post(
    '/licitaciones/:id/oferta/revision-previa',
    conId((id, req, res) => {
      const cuerpo = PedirRevisionCuerpo.safeParse(req.body ?? {});
      if (!cuerpo.success) {
        invalido(res, cuerpo.error);
        return;
      }
      const op = { version: cuerpo.data.paquete_version, confirmado: cuerpo.data.confirmado || confirmado(req) };
      responder(res, pedirRevisionPrevia(nucleo().db, dbLicitaciones(), id, op), 202);
    }),
  );
}
