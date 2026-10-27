// Respuestas HTTP comunes de las API web de los dominios: un Result se traduce a su
// código de estado y los errores de zod llegan legibles.
import type { Server } from 'node:http';
import type { RequestHandler, Response } from 'express';
import compression from 'compression';
import { z } from 'zod';
import { logger } from './log.js';
import { errorMessage, type Result } from './result.js';

// Con lo que la plataforma se presenta al pedir a la PLACSP y a otras plataformas de contratación.
export const USER_AGENT = 'sobre-abierto/1.0';

const STATUS: Record<string, number> = {
  not_found: 404,
  invalid_input: 400,
  too_large: 413,
  ya_cribado: 409,
  conflicto: 409,
  no_configurado: 503,
  drive_error: 502,
  plazo_vencido: 409,
  plazo_insuficiente: 409,
  plazo_justo: 409,
  via_alternativa: 409,
  ensayo_en_plazo: 409,
  ensayo_sin_confirmar: 409,
  impide_abierto: 409,
  sin_permiso: 403,
};

/** Para el rechazo de una promesa: 500 con rastro en el log (solo el mensaje del error). */
export function fallo(res: Response, que: string, modulo: string) {
  const log = logger(modulo);
  return (err: unknown): void => {
    log.error(que, { error: errorMessage(err).slice(0, 200) });
    res.status(500).json({ error: 'internal_error' });
  };
}

export function responder<T>(res: Response, r: Result<T>, okStatus = 200): void {
  if (r.error) res.status(STATUS[r.error.code] ?? 500).json({ error: r.error.code, message: r.error.message });
  else res.status(okStatus).json(r.data);
}

export function invalido(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: 'invalid_input', message: z.prettifyError(error) });
}

// En la query todo llega como texto: «1» activa una bandera.
export const Bandera = z
  .enum(['0', '1'])
  .optional()
  .transform((v) => v === '1');

// Traefik (el proxy de Dokploy) reutiliza una conexión con el servidor hasta 90 s sin uso;
// Node la cierra a los 5 s. Si Traefik manda una petición por una conexión que Node acaba
// de cerrar, devuelve 502 Bad Gateway, y al reintentar va por otra y sale bien: el «Bad
// Gateway intermitente» de las tools MCP (licitaciones_ver, pliegos, trabajos). Quien
// cierra tiene que ser el proxy: Node espera más que él.
const KEEP_ALIVE_MS = 95_000;

export function ajustarKeepAlive(server: Server): void {
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  // Si las cabeceras tuvieran menos tiempo que la conexión ociosa, Node cortaría igual.
  server.headersTimeout = KEEP_ALIVE_MS + 1_000;
}

/**
 * Compresión de las respuestas, salvo las de una petición con Range: el 206 de sendFile cuenta los
 * bytes sin comprimir y un trozo comprimido no casaría con su Content-Range (descargas reanudadas
 * o un visor que pide por partes recibirían el documento corrupto).
 */
export function comprimir(): RequestHandler {
  return compression({ filter: (req, res) => !req.headers.range && compression.filter(req, res) });
}
