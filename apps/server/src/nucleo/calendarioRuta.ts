// GET /cal/<token>.ics, fuera del login: lo pide Google Calendar u Outlook cada pocas horas, sin cookie.
import type { Request, Response } from 'express';
import { calendarioDelToken } from './calendario.js';
import { nucleo } from './contexto.js';
import { logger } from './log.js';
import { errorMessage } from './result.js';

const log = logger('calendario');

// Un token que no existe o revocado da 404 sin decir cuál de las dos cosas. El token no va al log.
export function rutaCalendario(req: Request, res: Response): void {
  const archivo = String(req.params['archivo'] ?? '');
  const token = archivo.endsWith('.ics') ? archivo.slice(0, -4) : '';
  try {
    const r = calendarioDelToken(nucleo().db, token);
    if (r.error) {
      res.status(404).type('text').send('No existe ese calendario.');
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.type('text/calendar; charset=utf-8').send(r.data);
  } catch (err) {
    log.error('calendario sin servir', { error: errorMessage(err) });
    res.status(500).type('text').send('No se pudo leer el calendario.');
  }
}
