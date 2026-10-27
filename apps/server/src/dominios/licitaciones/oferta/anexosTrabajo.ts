// El trabajo de rellenar un anexo en la cola de Hermes: su tipo, su payload, la clave del documento
// y si el anexo pedido ya llegó o sigue en curso.
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Db } from '../store.js';
import { SeccionesAnexo } from './dependenciasAnexo.js';
import { filaDocumento } from './documentos.js';

export const TIPO_ANEXO = 'licitaciones.anexo';
// dependencias: lo que llevaba el anexo al pedirlo; se guarda al recibirlo aunque las decisiones cambien mientras corre el run.
export const PayloadAnexo = z.object({
  id: z.string().min(3),
  clave: z.string().min(4),
  pedida_en: z.string().min(10),
  dependencias: SeccionesAnexo.optional(),
});
export type PayloadAnexoData = z.infer<typeof PayloadAnexo>;
export const CLAVE = /^a\d{1,2}-d\d{1,2}(?:-l[A-Za-z0-9._-]{1,20})?$/;

export const recursoAnexo = (a: { id: string; clave: string }) => `${a.id}#${a.clave}`;

export type TrabajoAnexo = { id: number; estado: string; actualizado_en: string };

export function trabajoAnexo(db: Db, id: string, clave: string): TrabajoAnexo | null {
  return (
    (db
      .prepare(
        `SELECT id, estado, actualizado_en FROM nucleo.trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.id') = ? AND json_extract(payload, '$.clave') = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(TIPO_ANEXO, id, clave) as TrabajoAnexo | undefined) ?? null
  );
}

/** Comprobación «hecho» del trabajo: llegó un anexo después de pedirlo (o el documento ya no está). */
export function anexoRecibido(db: Db, id: string, clave: string, pedidaEn: string): boolean {
  const f = filaDocumento(db, id, clave);
  return !f || f.oculto === 1 || (f.anexo_en !== null && f.anexo_en >= pedidaEn);
}

export function conClave(fn: (id: string, clave: string, req: Request, res: Response) => void) {
  return (id: string, req: Request, res: Response): void => {
    const clave = req.params['clave'] ?? '';
    if (!CLAVE.test(clave)) {
      res.status(400).json({ error: 'invalid_input', message: 'Clave de documento no válida.' });
      return;
    }
    fn(id, clave, req, res);
  };
}
