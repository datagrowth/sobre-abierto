// Traduce los errores del motor de la Biblioteca a respuestas HTTP con el estado y el mensaje adecuados.
import type { Response } from 'express';
import { ErrorBiblioteca } from '../motor/notas.js';
import { ErrorBandeja } from '../motor/bandeja.js';
import { ErrorRespaldo } from '../motor/respaldo.js';
import { logger } from '../../nucleo/log.js';
import { errorMessage } from '../../nucleo/result.js';

type CodigoConocido = ErrorBiblioteca['code'] | ErrorBandeja['code'] | ErrorRespaldo['code'];

// Tipado con los códigos que de verdad lanzan las librerías: uno nuevo obliga a darle estado aquí.
const ESTADO_POR_CODIGO: Record<CodigoConocido, number> = {
  not_configured: 503,
  not_found: 404,
  unsafe_path: 400,
  read_error: 500,
  write_error: 500,
  exists: 409,
  read_only: 403,
  invalid_content: 400,
  invalid_input: 400,
  conflict: 409,
  invalid_state: 409,
  io_error: 500,
};

// Un 500 no devuelve el mensaje del error: puede llevar rutas absolutas del servidor.
const MENSAJE_500 = 'Error interno de la Biblioteca.';
const log = logger('biblioteca.rutas');

export function manejarError(err: unknown, res: Response): void {
  const conocido = err instanceof ErrorBiblioteca || err instanceof ErrorBandeja || err instanceof ErrorRespaldo;
  const estado = conocido ? ESTADO_POR_CODIGO[err.code] : 500;
  if (estado < 500 && conocido) {
    res.status(estado).json({ error: err.code, message: err.message });
    return;
  }
  const codigo = conocido ? err.code : 'internal_error';
  log.error('error en una ruta de la Biblioteca', { code: codigo, error: errorMessage(err) });
  res.status(estado).json({ error: codigo, message: MENSAJE_500 });
}
