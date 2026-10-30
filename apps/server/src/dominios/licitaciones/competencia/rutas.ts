// API web de competencia (/api/licitaciones/competidores, /organismos y /seguidos).
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import { dbLicitaciones } from '../db.js';
import { Bandera, invalido, responder } from '../../../nucleo/http.js';
import { fichaCompetidor, OpcionesCompetidores, rankingCompetidores } from './competidores.js';
import { fichaOrganismo, OpcionesOrganismos, rankingOrganismos } from './organismos.js';
import { pedirResumenCompetidor } from './resumen.js';
import { csvCompetidores, csvOrganismos } from '../exportar.js';
import { enviarCsv } from '../../../nucleo/csv.js';
import { dejarDeSeguir, listarSeguidos, Nif, seguir, Seguimiento, TIPOS_SEGUIDO } from './seguidos.js';
import { guardarEscala, leerEscala } from './escala.js';

// La query llega como texto: se convierte aquí y se valida con el mismo esquema que las tools.
const QueryRanking = z.object({
  meses: z.coerce.number().optional(),
  cpv: z
    .string()
    .max(600)
    .optional()
    .transform((s) =>
      s
        ? s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        : undefined,
    ),
  texto: z
    .string()
    .max(100)
    .optional()
    .transform((s) => s?.trim() || undefined),
  limite: z.coerce.number().optional(),
  desde: z.coerce.number().optional(),
  orden: z.string().max(20).optional(),
  importe_min: z.coerce.number().optional(),
  importe_max: z.coerce.number().optional(),
  todos_importes: Bandera,
  nuts: z.string().max(5).optional(),
  toda_espana: Bandera,
});

function opciones<S extends z.ZodType>(req: Request, res: Response, esquema: S): z.infer<S> | null {
  const q = QueryRanking.safeParse(req.query);
  if (!q.success) {
    invalido(res, q.error);
    return null;
  }
  const o = esquema.safeParse(Object.fromEntries(Object.entries(q.data).filter(([, v]) => v !== undefined)));
  if (!o.success) {
    invalido(res, o.error);
    return null;
  }
  return o.data;
}

function conNif(fn: (nif: string, req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    const nif = Nif.safeParse(req.params['nif']);
    if (!nif.success) {
      res.status(400).json({ error: 'invalid_input', message: 'NIF no válido.' });
      return;
    }
    fn(nif.data, req, res);
  };
}

const QueryFicha = z.object({ solo_sector: Bandera });
const Tipo = z.enum(TIPOS_SEGUIDO);

function ficha(tipo: 'competidor' | 'organismo') {
  return conNif((nif, req, res) => {
    const q = QueryFicha.safeParse(req.query);
    if (!q.success) return invalido(res, q.error);
    const db = dbLicitaciones();
    if (tipo === 'competidor') responder(res, fichaCompetidor(db, nif, q.data));
    else responder(res, fichaOrganismo(db, nif, q.data));
  });
}

function conTipo(fn: (tipo: z.infer<typeof Tipo>, nif: string, req: Request, res: Response) => void) {
  return conNif((nif, req, res) => {
    const tipo = Tipo.safeParse(req.params['tipo']);
    if (!tipo.success) return invalido(res, tipo.error);
    fn(tipo.data, nif, req, res);
  });
}

function ponerSeguido(tipo: z.infer<typeof Tipo>, nif: string, req: Request, res: Response): void {
  const s = Seguimiento.safeParse(req.body ?? {});
  if (!s.success) return invalido(res, s.error);
  responder(res, seguir(dbLicitaciones(), tipo, nif, s.data));
}

function seguidos(req: Request, res: Response): void {
  const tipo = Tipo.safeParse(req.query['tipo']);
  if (!tipo.success) return invalido(res, tipo.error);
  res.json(listarSeguidos(dbLicitaciones(), tipo.data));
}

export function rutasCompetencia(r: Router): void {
  // La escala con que se abren los rankings (Ajustes › Fuentes y filtros).
  r.get('/competencia/escala', (_req, res) => {
    res.json(leerEscala(dbLicitaciones()));
  });
  r.put('/competencia/escala', (req, res) => {
    responder(res, guardarEscala(dbLicitaciones(), req.body));
  });
  r.get('/competidores', (req, res) => {
    const o = opciones(req, res, OpcionesCompetidores);
    if (o) res.json(rankingCompetidores(dbLicitaciones(), o));
  });
  r.get('/competidores.csv', (req, res) => {
    const o = opciones(req, res, OpcionesCompetidores);
    if (o) enviarCsv(res, 'competidores', csvCompetidores(dbLicitaciones(), o));
  });
  r.get('/organismos.csv', (req, res) => {
    const o = opciones(req, res, OpcionesOrganismos);
    if (o) enviarCsv(res, 'organismos', csvOrganismos(dbLicitaciones(), o));
  });
  r.get('/competidores/:nif', ficha('competidor'));
  r.post(
    '/competidores/:nif/resumen',
    conNif((nif, _req, res) => responder(res, pedirResumenCompetidor(nucleo().db, dbLicitaciones(), nif), 202)),
  );
  r.get('/organismos', (req, res) => {
    const o = opciones(req, res, OpcionesOrganismos);
    if (o) res.json(rankingOrganismos(dbLicitaciones(), o));
  });
  r.get('/organismos/:nif', ficha('organismo'));
  r.get('/seguidos', seguidos);
  r.put('/seguidos/:tipo/:nif', conTipo(ponerSeguido));
  r.delete(
    '/seguidos/:tipo/:nif',
    conTipo((tipo, nif, _req, res) => responder(res, dejarDeSeguir(dbLicitaciones(), tipo, nif))),
  );
}
