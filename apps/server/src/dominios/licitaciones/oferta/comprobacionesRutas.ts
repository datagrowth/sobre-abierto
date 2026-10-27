// API web de las comprobaciones: GET /licitaciones/:id/comprobaciones con ETag y las acciones sobre una fila.
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import { invalido, responder } from '../../../nucleo/http.js';
import { conQuien } from '../../../nucleo/permisos.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import { comprobacionesDe } from './comprobaciones.js';
import { AccionEntrada, aplicarAccionBloqueo } from './comprobacionesBloqueos.js';
import { impactoDeLicitacion } from './impacto.js';
import { mesaDe } from './mesa.js';

// Express calcula el ETag del cuerpo y responde 304 si no cambió, así la web puede preguntar a menudo sin coste.
// Las acciones de dato (precio, equipo…) siguen en sus rutas.
const Clave = z.string().trim().min(1).max(200);

function accion(id: string, req: Request, res: Response): void {
  const clave = Clave.safeParse(req.params['clave']);
  if (!clave.success) return invalido(res, clave.error);
  const e = AccionEntrada.safeParse(conQuien(req));
  if (!e.success) return invalido(res, e.error);
  responder(res, aplicarAccionBloqueo(dbLicitaciones(), id, clave.data, e.data));
}

export function rutasComprobaciones(r: Router): void {
  // La Mesa (Hoy) cuelga de /api/licitaciones/mesa: lo de hoy de todas las ofertas activas.
  r.get('/mesa', (_req, res) => responder(res, mesaDe(dbLicitaciones(), nucleo().db)));
  r.get(
    '/licitaciones/:id/comprobaciones',
    conId((id, _req, res) => responder(res, comprobacionesDe(dbLicitaciones(), nucleo().db, id))),
  );
  r.post('/licitaciones/:id/comprobaciones/bloqueos/:clave', conId(accion));
  // POST por el cuerpo (el cambio), pero solo calcula: no escribe nada.
  r.post(
    '/licitaciones/:id/oferta/impacto',
    conId((id, req, res) => responder(res, impactoDeLicitacion(dbLicitaciones(), nucleo().db, id, req.body ?? {}))),
  );
}
