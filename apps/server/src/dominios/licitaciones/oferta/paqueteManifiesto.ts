// El manifiesto de un paquete de presentación y la versión vigente (solo lee la base): lo usan
// el paquete, la API, la tool y «Hoy» sin traerse la escritura.
import { z } from 'zod';
import { logger } from '../../../nucleo/log.js';
import type { Db } from '../store.js';
import { decisionesDe } from './decisiones.js';

const log = logger('licitaciones');
const Texto = z.string();

const DocumentoManifiesto = z.object({
  orden: z.number().int(),
  nombre: Texto,
  clave: Texto,
  archivo: Texto,
  origen: Texto,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  estado_checklist: Texto,
  firma: z.literal('pendiente'),
});
const ValorManifiesto = z.object({
  lote: Texto.nullable(),
  concepto: Texto,
  valor: Texto,
  donde: Texto,
  economico: z.boolean(),
});
const ComprobacionManifiesto = z.object({
  tipo: Texto,
  gravedad: z.enum(['bloquea', 'aviso']),
  mensaje: Texto,
  donde: Texto.nullable(),
});
export const Manifiesto = z.object({
  licitacion: z.object({ id: Texto, expediente: Texto, titulo: Texto, organo: Texto }),
  version: z.number().int().positive(),
  generado_en: Texto,
  guion: z.object({ id: z.number().int(), version: z.number().int() }),
  decisiones_en: Texto.nullable(),
  plazo: z.object({ fecha_limite: Texto.nullable(), texto: Texto.nullable(), canal: Texto.nullable() }),
  lotes: z.array(Texto),
  carpetas: z.array(
    z.object({
      ruta: Texto,
      lote: Texto.nullable(),
      archivo: Texto,
      firma: Texto.nullable(),
      documentos: z.array(DocumentoManifiesto),
    }),
  ),
  valores: z.array(ValorManifiesto),
  comprobaciones: z.array(ComprobacionManifiesto),
  // Los textos del paquete (INSTRUCCIONES, guía del DEUC, compromisos…) con su sha256; no los traen los de antes.
  textos: z.array(z.object({ archivo: Texto, sha256: Texto, bytes: z.number().int().nonnegative() })).optional(),
});
export type ManifiestoData = z.infer<typeof Manifiesto>;

// copia: la de la versión presentada en DOCUMENTACION PRESENTADA (null si no se registró desde el paquete).
type CopiaPaquete = { estado: 'pendiente' | 'hecha' | 'error'; ruta: string | null; error: string | null };
export type PaqueteVigente = {
  version: number;
  ruta: string;
  creado_en: string;
  bloqueos: number;
  avisos: number;
  desfasado: boolean;
  copia: CopiaPaquete | null;
  manifiesto: ManifiestoData;
};
type FilaPaquete = {
  version: number;
  ruta: string;
  guion_id: number;
  manifiesto: string;
  bloqueos: number;
  avisos: number;
  creado_en: string;
  copia_estado: CopiaPaquete['estado'] | null;
  copia_ruta: string | null;
  copia_error: string | null;
};

/** La última versión del paquete y si está desfasada: el guion, las decisiones o la checklist cambiaron después. */
export function paqueteVigente(db: Db, id: string): PaqueteVigente | null {
  const f = db
    .prepare(
      `SELECT version, ruta, guion_id, manifiesto, bloqueos, avisos, creado_en, copia_estado, copia_ruta, copia_error
    FROM paquetes_presentacion WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1`,
    )
    .get(id) as FilaPaquete | undefined;
  if (!f) return null;
  const m = Manifiesto.safeParse(JSON.parse(f.manifiesto));
  if (!m.success) {
    log.warn('manifiesto de paquete no válido', { licitacion: id, version: f.version });
    return null;
  }
  const guion = (
    db.prepare('SELECT MAX(id) AS id FROM guiones WHERE licitacion_id = ?').get(id) as { id: number | null }
  ).id;
  const decisiones = decisionesDe(db, id)?.actualizada_en ?? null;
  const checklist = (
    db.prepare('SELECT MAX(actualizado_en) AS t FROM oferta_documentos WHERE licitacion_id = ?').get(id) as {
      t: string | null;
    }
  ).t;
  const desfasado =
    guion !== f.guion_id ||
    (decisiones !== null && decisiones > f.creado_en) ||
    (checklist !== null && checklist > f.creado_en);
  const copia = f.copia_estado ? { estado: f.copia_estado, ruta: f.copia_ruta, error: f.copia_error } : null;
  return {
    version: f.version,
    ruta: f.ruta,
    creado_en: f.creado_en,
    bloqueos: f.bloqueos,
    avisos: f.avisos,
    desfasado,
    copia,
    manifiesto: m.data,
  };
}
