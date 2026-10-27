// API web de los índices de mercado, el panorama, los vencimientos y la prueba hacia atrás.
import type { Request, Response, Router } from 'express';
import { invalido, responder } from '../../../nucleo/http.js';
import { usuarioDe } from '../../../nucleo/permisos.js';
import { ok } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import { indicesDeLicitacion, OpcionesIndices } from './index.js';
import { csvComparables } from '../exportar.js';
import { enviarCsv } from '../../../nucleo/csv.js';
import { OpcionesVencimientos, vencimientos } from './vencimientos.js';
import { historialAcierto, ultimoAcierto } from './acierto.js';
import { OpcionesPanorama, panorama } from './panorama.js';
import { dejarDeSeguirRenovacion, Renovacion, seguirRenovacion } from './renovaciones.js';

// Rutas: /api/licitaciones/licitaciones/:id/indices, /mercado/panorama, /mercado/vencimientos (con «Avisarme
// cuando salga» en /mercado/vencimientos/avisar) y /mercado/acierto.
function indices(id: string, req: Request, res: Response): void {
  const o = OpcionesIndices.safeParse(req.query);
  if (!o.success) return invalido(res, o.error);
  responder(res, indicesDeLicitacion(dbLicitaciones(), id, o.data));
}

function avisar(seguir: boolean) {
  return (req: Request, res: Response): void => {
    const r = Renovacion.safeParse(req.body);
    if (!r.success) return invalido(res, r.error);
    responder(
      res,
      seguir
        ? seguirRenovacion(dbLicitaciones(), r.data, usuarioDe(req)?.id ?? null)
        : dejarDeSeguirRenovacion(dbLicitaciones(), r.data),
    );
  };
}

export function rutasIndices(r: Router): void {
  r.get('/licitaciones/:id/indices', conId(indices));
  // Los comparables del índice en CSV: los mismos que la ficha, con el mismo lote.
  r.get(
    '/licitaciones/:id/indices/comparables.csv',
    conId((id, req, res) => {
      const o = OpcionesIndices.safeParse(req.query);
      if (!o.success) return invalido(res, o.error);
      const r = indicesDeLicitacion(dbLicitaciones(), id, o.data);
      if (r.error) return responder(res, r);
      enviarCsv(res, `comparables-${id}`, csvComparables(r.data.comparables));
    }),
  );
  r.get('/mercado/acierto', (_req, res) => {
    responder(res, ok({ ultimo: ultimoAcierto(dbLicitaciones()), historial: historialAcierto(dbLicitaciones()) }));
  });
  r.get('/mercado/panorama', (req, res) => {
    const o = OpcionesPanorama.safeParse(req.query);
    if (!o.success) return invalido(res, o.error);
    responder(res, ok(panorama(dbLicitaciones(), o.data)));
  });
  r.get('/mercado/vencimientos', (req, res) => {
    const o = OpcionesVencimientos.safeParse(req.query);
    if (!o.success) return invalido(res, o.error);
    responder(res, ok(vencimientos(dbLicitaciones(), o.data)));
  });
  r.post('/mercado/vencimientos/avisar', avisar(true));
  r.delete('/mercado/vencimientos/avisar', avisar(false));
}
