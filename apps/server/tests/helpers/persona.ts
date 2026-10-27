// Middleware de prueba que fija la persona de la petición en rutas montadas sin login.
import type { NextFunction, Request, Response } from 'express';
import { fijarUsuario } from '../../src/nucleo/permisos.js';
import type { Rol } from '../../src/nucleo/usuarios.js';

/** Cabecera con la que un test dice quién hace la petición (en el servidor lo dice la sesión). */
const CABECERA_PERSONA = 'x-prueba-persona';

/**
 * Para las rutas montadas sin el login: la persona de la sesión sale de `x-prueba-persona`
 * («Nombre» o «Nombre:rol», admin por defecto). Sin cabecera, la ruta firma «web», como siempre.
 */
export function comoPersona(req: Request, _res: Response, next: NextFunction): void {
  const h = req.headers[CABECERA_PERSONA];
  if (typeof h === 'string' && h) {
    const [nombre, rol] = h.split(':');
    fijarUsuario(req, {
      id: 1,
      nombre: decodeURIComponent(nombre!),
      rol: (rol as Rol | undefined) ?? 'admin',
      emergencia: false,
      debe_cambiarla: false,
    });
  }
  next();
}

/** Las cabeceras de una petición hecha por esa persona. */
export const de = (nombre: string, rol?: Rol): Record<string, string> => ({
  [CABECERA_PERSONA]: `${encodeURIComponent(nombre)}${rol ? `:${rol}` : ''}`,
});
