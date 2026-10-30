// API web de colaboradores (/api/colaboradores, detrás del login del servidor).
import express, { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { obtenerRutaBiblioteca } from '../../biblioteca/motor/configuracion.js';
import { nucleo } from '../contexto.js';
import { fallo, invalido, responder } from '../http.js';
import { buscarCandidatos, ConsultaCandidatos } from './busqueda.js';
import { evidenciaEnCv } from './evidencia.js';
import { actualizarPersona, borrarPersona, crearPersona, FiltroPersonas } from './personas.js';
import { fichaDeEquipo, personasDeEquipo } from './fichaEquipo.js';
import { cambiarPerfilAIncorporar, CambioPerfil, listarPerfilesAIncorporar } from './aIncorporar.js';
import { listarPropuestas, PedidoPerfilCv, pedirPerfilDesdeCv, RevisionPerfil, revisarPerfil } from './propuestas.js';

// Cubre alta, edición y baja a mano, alta desde un CV de la Biblioteca, perfiles pendientes de aprobar,
// búsqueda de candidatos para un requisito y perfiles a incorporar.
const Id = z.coerce.number().int().positive();

function conId(fn: (id: number, req: Request, res: Response) => void) {
  return (req: Request, res: Response): void => {
    const id = Id.safeParse(req.params['id']);
    if (!id.success) {
      res.status(400).json({ error: 'invalid_input', message: 'Id no válido.' });
      return;
    }
    fn(id.data, req, res);
  };
}

// La query llega como texto: se convierte aquí y se valida con el esquema del filtro.
const QueryLista = z.object({
  tipo: z.string().max(20).optional(),
  texto: z
    .string()
    .max(100)
    .optional()
    .transform((s) => s?.trim() || undefined),
  inactivos: z
    .enum(['0', '1'])
    .optional()
    .transform((v) => v === '1'),
});

function listar(req: Request, res: Response): void {
  const q = QueryLista.safeParse(req.query);
  if (!q.success) return invalido(res, q.error);
  const f = FiltroPersonas.safeParse(Object.fromEntries(Object.entries(q.data).filter(([, v]) => v !== undefined)));
  if (!f.success) return invalido(res, f.error);
  const db = nucleo().db;
  res.json({
    items: personasDeEquipo(db, f.data),
    propuestas_pendientes: listarPropuestas(db).length,
    a_incorporar: listarPerfilesAIncorporar(db).filter((p) => p.estado === 'pendiente').length,
  });
}

function buscar(req: Request, res: Response): void {
  const c = ConsultaCandidatos.safeParse(req.body);
  if (!c.success) return invalido(res, c.error);
  buscarCandidatos(nucleo().db, c.data).then(
    (r) => responder(res, r),
    fallo(res, 'fallo buscando candidatos', 'colaboradores'),
  );
}

// Con la raíz de la Biblioteca en la que se subió el CV (la de los ajustes de la web
// o, si no hay, VAULT_PATH), no con la de arranque.
function desdeCv(req: Request, res: Response): void {
  const p = PedidoPerfilCv.safeParse(req.body);
  if (!p.success) return invalido(res, p.error);
  responder(res, pedirPerfilDesdeCv(nucleo().db, obtenerRutaBiblioteca(), p.data), 202);
}

function cambiarIncorporar(id: number, req: Request, res: Response): void {
  const c = CambioPerfil.safeParse(req.body);
  if (!c.success) return invalido(res, c.error);
  responder(res, cambiarPerfilAIncorporar(nucleo().db, id, c.data));
}

function revisar(id: number, req: Request, res: Response): void {
  const r = RevisionPerfil.safeParse(req.body);
  if (!r.success) return invalido(res, r.error);
  responder(res, revisarPerfil(nucleo().db, id, r.data));
}

// La ficha abierta desde la matriz de equipo: ¿su CV menciona la materia, y en qué página?
function evidencia(id: number, req: Request, res: Response): void {
  const r = evidenciaEnCv(nucleo().db, id, { materia: req.query['materia'] });
  if (r.error?.code === 'biblioteca_no_disponible') {
    res.status(503).json({ error: r.error.code, message: r.error.message });
    return;
  }
  responder(res, r);
}

export function rutasColaboradores(): Router {
  const r = Router();
  r.use(express.json({ limit: '128kb' }));
  r.get('/', listar);
  r.post('/', (req, res) => responder(res, crearPersona(nucleo().db, req.body), 201));
  r.post('/buscar', buscar);
  r.post('/desde-cv', desdeCv);
  r.get('/propuestas', (_req, res) => {
    res.json(listarPropuestas(nucleo().db));
  });
  r.post('/propuestas/:id/revision', conId(revisar));
  r.get('/personas/:id/evidencia', conId(evidencia));
  r.get('/a-incorporar', (_req, res) => {
    res.json(listarPerfilesAIncorporar(nucleo().db));
  });
  r.patch('/a-incorporar/:id', conId(cambiarIncorporar));
  r.get(
    '/:id',
    conId((id, _req, res) => responder(res, fichaDeEquipo(nucleo().db, id))),
  );
  r.put(
    '/:id',
    conId((id, req, res) => responder(res, actualizarPersona(nucleo().db, id, req.body))),
  );
  r.delete(
    '/:id',
    conId((id, _req, res) => responder(res, borrarPersona(nucleo().db, id))),
  );
  r.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  return r;
}
