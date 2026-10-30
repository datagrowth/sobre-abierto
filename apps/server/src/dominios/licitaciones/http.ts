// Validación del :id de licitación en la API web de Licitaciones; las respuestas
// comunes (responder, invalido, fallo) son del núcleo.
import type { Request, Response } from 'express';
import { z } from 'zod';

const Id = z.string().regex(/^[pa]-[A-Za-z0-9_-]{1,30}$/);

/** «?confirmar=1»: la persona ya vio el aviso (p. ej. que queda poco plazo) y lo pide igualmente. */
export function confirmado(req: Request): boolean {
  return req.query['confirmar'] === '1';
}

/** Valida el :id de licitación de la ruta antes de llamar al manejador. */
export function conId(fn: (id: string, req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    const id = Id.safeParse(req.params['id']);
    if (!id.success) {
      res.status(400).json({ error: 'invalid_input', message: 'Id de licitación no válido.' });
      return;
    }
    fn(id.data, req, res);
  };
}

const IdNumerico = z.coerce.number().int().positive();

/** Valida un :n numérico de la ruta (propuestas, borradores, evaluaciones, búsquedas guardadas) antes de llamar al manejador. */
export function conNumero(fn: (n: number, req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    const n = IdNumerico.safeParse(req.params['n']);
    if (!n.success) {
      res.status(400).json({ error: 'invalid_input', message: 'Id no válido.' });
      return;
    }
    fn(n.data, req, res);
  };
}
