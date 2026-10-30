// La checklist del paso Presentación para la web: por documento, si Hermes puede rellenarlo, si está
// en curso, de qué modelo sale y sus avisos. Solo lee.
import path from 'node:path';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import type { Raices } from '../../../nucleo/salidas.js';
import type { EnCurso } from '../../../nucleo/colaConsultas.js';
import type { Db } from '../store.js';
import { infoDeuc, type InfoDeuc } from './deuc.js';
import {
  documentoDelGuion,
  documentosDe,
  resumenDocumentos,
  type DocumentoConClave,
  type DocumentoOferta,
  type ResumenDocumentos,
} from './documentos.js';
import type { TipoModeloPdf } from './modelosPdf.js';
import { type TrabajoAnexo, trabajoAnexo } from './anexosTrabajo.js';
import { homonimoDe, modeloDe } from './anexosModelo.js';
import { analisisDe, motivoNoRellenable } from './anexosModeloPdf.js';

const enCursoDe = (t: TrabajoAnexo | null): EnCurso | null =>
  t ? { estado: t.estado === 'lanzado' ? 'generando' : 'en_cola', desde: t.actualizado_en } : null;

/**
 * El modelo del que sale el anexo, para «Abrir el modelo»: su ruta en Conocimiento y la primera
 * página del tramo; hasta_pagina, solo si el tramo de un PDF ocupa varias («págs. X-Y» en la web).
 */
type InfoModelo = { tipo: 'docx' | TipoModeloPdf; ruta: string; pagina: number | null; hasta_pagina?: number };
// modelo: null sin modelo que rellenar o con un PDF aún sin analizar.
// deuc: solo en la fila del DEUC (oferta/deuc.ts).
type InfoAnexo = {
  rellenable: boolean;
  motivo: string | null;
  en_curso: EnCurso | null;
  avisos: string[];
  modelo: InfoModelo | null;
  deuc?: InfoDeuc;
};
export type DocumentoConAnexo = Omit<DocumentoOferta, 'avisos'> & { anexo: InfoAnexo };

type Donde = { db: Db; raices: Raices; id: string };

function infoModelo(c: Donde, d: DocumentoConClave): InfoModelo | null {
  const m = modeloDe(c.db, c.raices, c.id, d);
  if (m.error) return null;
  if (m.data.ext !== '.pdf') return { tipo: 'docx', ruta: m.data.ruta, pagina: null };
  const a = analisisDe(c.db, m.data, d).data;
  if (!a) return null;
  const pagina = a.desde_pagina ?? d.doc.origen?.pagina ?? null;
  const varias = a.hasta_pagina !== null && pagina !== null && a.hasta_pagina > pagina;
  return { tipo: a.tipo, ruta: m.data.ruta, pagina, ...(varias ? { hasta_pagina: a.hasta_pagina! } : {}) };
}

export async function conAnexo(c: Donde, d: DocumentoConClave, doc: DocumentoOferta): Promise<DocumentoConAnexo> {
  const { avisos, ...resto } = doc;
  const motivo = await motivoNoRellenable(c.db, c.raices, c.id, d);
  const homonimo = homonimoDe(c.db, c.id, d);
  const tomado = homonimo ? [`Modelo tomado de «${path.posix.basename(homonimo)}».`] : [];
  const anexo = {
    rellenable: motivo === null,
    motivo,
    en_curso: enCursoDe(trabajoAnexo(c.db, c.id, d.clave)),
    avisos: [...avisos, ...tomado],
    modelo: infoModelo(c, d),
  };
  if (d.doc.tipo === 'deuc') return { ...resto, anexo: { ...anexo, deuc: infoDeuc(c.db, c.id) } };
  return { ...resto, anexo };
}

export const AVISO_SIN_GUION = 'Aún no hay guion: Hermes lo saca del pliego.';
export type ChecklistOferta = { documentos: DocumentoConAnexo[]; resumen: ResumenDocumentos; aviso?: string };

/** La checklist con, por documento, si se puede rellenar con Hermes, si está en curso y sus avisos. Solo lee. */
export async function documentosOferta(db: Db, raices: Raices, id: string): Promise<Result<ChecklistOferta>> {
  if (!db.prepare('SELECT 1 FROM licitaciones WHERE id = ?').get(id))
    return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const { guion, documentos } = documentosDe(db, id);
  if (!guion) return ok({ documentos: [], resumen: resumenDocumentos([]), aviso: AVISO_SIN_GUION });
  const out: DocumentoConAnexo[] = [];
  for (const doc of documentos) {
    const d = guion ? documentoDelGuion(guion.datos, doc.clave) : null;
    if (d) out.push(await conAnexo({ db, raices, id }, d, doc));
  }
  return ok({ documentos: out, resumen: resumenDocumentos(documentos) });
}
