// Versión de la web desplegada: el nombre con hash del bundle de entrada (assets/index-XXXX.js).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import { logger } from './log.js';
import { fail, ok, errorMessage, type Result } from './result.js';

// Una pestaña abierta antes del despliegue la compara con la del servidor y avisa de que recargue; sin esto sus
// guardados fallaban en bucle con el JS anterior.
export const CABECERA_VERSION_WEB = 'X-Web-Version';
const ERROR_VERSION_ANTIGUA = 'version_antigua';
const MENSAJE_VERSION_ANTIGUA = 'Hay una versión nueva de la plataforma: recarga la página. No se ha guardado nada.';

const log = logger('versionWeb');
const METODOS_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

const ENTRADA = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']*\/assets\/[^"']+)["']/i;

/** Nombre con hash del bundle de entrada de un index.html de Vite, o null si no hay (p. ej. el de desarrollo). */
export function leerVersionWeb(html: string): string | null {
  const ruta = ENTRADA.exec(html)?.[1];
  return ruta ? ruta.split('/').pop() || null : null;
}

/** Se lee una vez al arrancar: dist no cambia hasta el siguiente despliegue. Sin dist (desarrollo) devuelve null. */
export function versionWeb(distDir: string): Result<string | null> {
  try {
    return ok(leerVersionWeb(readFileSync(path.join(distDir, 'index.html'), 'utf8')));
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? ok(null) : fail('version_web_ilegible', errorMessage(e));
  }
}

/**
 * Rechaza con 409 las escrituras de una pestaña con la web anterior: su JS puede mandar
 * datos con un formato viejo y pisar lo guardado. Sin cabecera (agentes, curl, pestañas
 * previas a este cambio) no se comprueba, para no romper a quien no es el navegador.
 */
export function exigirVersionWeb(actual: string | null): RequestHandler {
  return (req, res, next) => {
    const enviada = req.get(CABECERA_VERSION_WEB);
    if (actual === null || METODOS_LECTURA.has(req.method) || !enviada || enviada === actual) {
      next();
      return;
    }
    log.warn('escritura con la web anterior', { metodo: req.method, ruta: req.baseUrl + req.path });
    res.status(409).json({ error: ERROR_VERSION_ANTIGUA, message: MENSAJE_VERSION_ANTIGUA });
  };
}

/** GET / → { version }: permite a la web comprobar si hay una versión nueva sin esperar al socket. */
export function rutaVersion(actual: string | null): Router {
  const router = Router();
  router.get('/', (_req, res) => {
    res.json({ version: actual });
  });
  return router;
}
