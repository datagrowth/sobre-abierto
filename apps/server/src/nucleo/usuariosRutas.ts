// Ajustes › Usuarios (/api/plataforma/usuarios): altas, cambios de rol, bajas y contraseñas
// temporales. Solo admin (nucleo/permisos.ts). Ninguna respuesta lleva el hash.
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { nucleo } from './contexto.js';
import { fallo, responder } from './http.js';
import { fail, ok } from './result.js';
import { cambiarUsuario, crearUsuario, listarUsuarios, restablecerContrasena } from './usuarios.js';

const IdUsuario = z.coerce.number().int().positive();

function conId(fn: (id: number, req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    const id = IdUsuario.safeParse(req.params['id']);
    if (!id.success) return responder(res, fail('invalid_input', 'Usuario no válido.'));
    fn(id.data, req, res);
  };
}

export function rutasUsuarios(): Router {
  const r = Router();
  r.get('/', (_req, res) => responder(res, ok({ usuarios: listarUsuarios(nucleo().db) })));
  r.post('/', (req, res) => {
    crearUsuario(nucleo().db, req.body ?? {}).then(
      (x) => responder(res, x, 201),
      fallo(res, 'usuario sin crear', 'usuarios'),
    );
  });
  r.patch(
    '/:id',
    conId((id, req, res) => responder(res, cambiarUsuario(nucleo().db, id, req.body ?? {}))),
  );
  r.post(
    '/:id/contrasena',
    conId((id, req, res) => {
      restablecerContrasena(nucleo().db, id, req.body ?? {}).then(
        (x) => responder(res, x),
        fallo(res, 'contraseña temporal sin poner', 'usuarios'),
      );
    }),
  );
  return r;
}
