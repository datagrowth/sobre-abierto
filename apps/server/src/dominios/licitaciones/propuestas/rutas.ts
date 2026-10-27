// API web de propuestas (/api/licitaciones/…): registro, estadísticas, evaluación, lo aprendido y descargas.
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { nucleo } from '../../../nucleo/contexto.js';
import { leerPerfilEmpresa } from '../../../nucleo/empresa.js';
import { archivoExistente, EXTENSIONES_DOCUMENTO, RutaDocumento } from '../../../nucleo/salidas.js';
import { dbLicitaciones } from '../db.js';
import { invalido, responder } from '../../../nucleo/http.js';
import { conQuien } from '../../../nucleo/permisos.js';
import { conId, conNumero } from '../http.js';
import { estadisticasPropuestas } from './estadisticas.js';
import { pedirEvaluacion } from './evaluacion.js';
import { propuestaDeLicitacion, raicesDocumentos } from './index.js';
import { resolverPropuestas } from './resolucion.js';
import {
  borrarPropuesta,
  CambioPropuesta,
  cambiarPropuesta,
  deshacerPresentacion,
  FiltroPropuestas,
  listarPropuestas,
  NuevaPropuesta,
  obtenerPropuesta,
  registrarPropuesta,
} from './registro.js';
import { Revision, RevisionBorrador, revisarIa, type TablaIa } from './revision.js';
import { aprendizajesDe, revisarAprendizaje } from './aprendizaje.js';
import { revisarBorrador } from '../oferta/resumenMemoria.js';
import { pedirLecturaActas, resumenActas } from './actas.js';
import { actasQueFaltan } from './actasQueFaltan.js';
import { crearCarpetasPresentadas } from '../index.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage } from '../../../nucleo/result.js';

// Cubre el registro de presentaciones y resultados, las estadísticas, la evaluación con Hermes (y su revisión
// por una persona), lo aprendido de las actas de mesa y la descarga de documentos de Salidas.
const QueryLista = z.object({
  resultado: FiltroPropuestas.shape.resultado,
  texto: z
    .string()
    .max(100)
    .optional()
    .transform((s) => (s && s.trim().length >= 2 ? s.trim() : undefined)),
  limite: z.coerce.number().int().min(1).max(200).default(50),
});

// Un borrador puede traer además el motivo para dar por buena una memoria con fugas.
// motivo y quien: los de «Dar por buena» (resumenMemoria.ts), para una memoria con algo marcado.
const RevisionDeBorrador = RevisionBorrador.extend({
  motivo: z.string().trim().min(5, 'Escribe el motivo en pocas palabras.').max(1000).optional(),
  quien: z.string().trim().min(2).max(60).optional(),
});

function revisar(tabla: TablaIa) {
  return conNumero((n, req, res) => {
    if (tabla === 'borradores') {
      const b = RevisionDeBorrador.safeParse(conQuien(req));
      return b.success ? responder(res, revisarBorrador(dbLicitaciones(), n, b.data)) : invalido(res, b.error);
    }
    const r = Revision.safeParse(req.body ?? {});
    if (!r.success) return invalido(res, r.error);
    responder(res, revisarIa(dbLicitaciones(), tabla, n, r.data));
  });
}

const nifEmpresa = () => leerPerfilEmpresa(nucleo().db)?.perfil.nif ?? null;

const log = logger('licitaciones');

// Una propuesta antigua puede registrarse con la adjudicación ya publicada: se resuelve al
// momento. Su carpeta de presentada se crea después (Drive tarda): la respuesta no la espera.
function registrar(id: string, req: Request, res: Response): void {
  const p = NuevaPropuesta.safeParse(req.body ?? {});
  if (!p.success) return invalido(res, p.error);
  const db = dbLicitaciones();
  const r = registrarPropuesta(db, id, p.data);
  if (r.error) return responder(res, r);
  resolverPropuestas(db, nifEmpresa());
  res.status(201).json(obtenerPropuesta(db, r.data.id));
  crearCarpetasPresentadas().catch((err: unknown) =>
    log.error('carpeta de presentada fallida', { error: errorMessage(err) }),
  );
}

function cambiar(pid: number, req: Request, res: Response): void {
  const c = CambioPropuesta.safeParse(req.body ?? {});
  if (!c.success) return invalido(res, c.error);
  responder(res, cambiarPropuesta(dbLicitaciones(), pid, c.data));
}

// El histórico y sus estadísticas van juntos: la vista «Propuestas» muestra ambos.
function listar(req: Request, res: Response): void {
  const q = QueryLista.safeParse(req.query);
  if (!q.success) return invalido(res, q.error);
  const db = dbLicitaciones();
  const filtro = FiltroPropuestas.parse(Object.fromEntries(Object.entries(q.data).filter(([, v]) => v !== undefined)));
  res.json({ ...listarPropuestas(db, filtro), estadisticas: estadisticasPropuestas(db) });
}

const Evaluar = z.strictObject({ documento: RutaDocumento });

function evaluar(id: string, req: Request, res: Response): void {
  const e = Evaluar.safeParse(req.body ?? {});
  if (!e.success) return invalido(res, e.error);
  responder(
    res,
    pedirEvaluacion(nucleo().db, dbLicitaciones(), raicesDocumentos(), { id, documento: e.data.documento }),
    202,
  );
}

// Solo formatos de documento: un .html o .svg dejado en Salidas se abriría en el mismo
// origen que el servidor, con la sesión de quien lo abre. El único .xml es el DEUC que prepara
// la plataforma (oferta/deuc.ts), y siempre se descarga: un XML en línea puede traer XSLT o XHTML.
const esDeucXml = (r: string) => /\/anexos\/DEUC-v\d+\.xml$/.test(r);
const QueryDocumento = z.object({
  ruta: RutaDocumento.refine((r) => r.startsWith('Salidas/'), 'solo documentos de Salidas').refine(
    (r) => EXTENSIONES_DOCUMENTO.has(path.posix.extname(r).toLowerCase()) || esDeucXml(r),
    'solo documentos (PDF, Word, Markdown, texto, hojas o presentaciones)',
  ),
});

// Los de Conocimiento se abren con la Biblioteca (/hermes-vault/api/v1/files/raw), con las mismas cabeceras.
function documento(req: Request, res: Response): void {
  const q = QueryDocumento.safeParse(req.query);
  if (!q.success) return invalido(res, q.error);
  const abs = archivoExistente(raicesDocumentos(), q.data.ruta);
  if (abs.error) return responder(res, abs);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Solo lo que el navegador muestra bien va en línea; un .docx o .doc se descarga (y Word lo abre).
  const enLinea = ['.pdf', '.md', '.txt'].includes(path.extname(abs.data).toLowerCase());
  res.setHeader(
    'Content-Disposition',
    `${enLinea ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(path.basename(abs.data))}`,
  );
  if (esDeucXml(q.data.ruta)) res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.sendFile(abs.data, { dotfiles: 'allow' });
}

// A mano se leen todas las actas pendientes de una vez (hay pocas carpetas de lo presentado).
const MAX_ACTAS_A_MANO = 20;

function aprendizajes(_req: Request, res: Response): void {
  const db = dbLicitaciones();
  res.json({ items: aprendizajesDe(db), ...resumenActas(nucleo().db, db, raicesDocumentos().conocimiento) });
}

function leerActas(_req: Request, res: Response): void {
  const conocimiento = raicesDocumentos().conocimiento;
  if (!conocimiento) {
    res
      .status(503)
      .json({ error: 'no_configurado', message: 'Falta la carpeta Conocimiento (VAULT_PATH) en el servidor.' });
    return;
  }
  res.status(202).json({
    encolados: pedirLecturaActas(nucleo().db, dbLicitaciones(), { conocimiento, max: MAX_ACTAS_A_MANO, aMano: true }),
  });
}

export function rutasPropuestas(r: Router): void {
  r.get('/propuestas', listar);
  r.patch('/propuestas/:n', conNumero(cambiar));
  r.delete(
    '/propuestas/:n',
    conNumero((n, _req, res) => responder(res, borrarPropuesta(dbLicitaciones(), n))),
  );
  r.patch('/borradores/:n', revisar('borradores'));
  r.patch('/evaluaciones/:n', revisar('evaluaciones'));
  r.get('/aprendizajes', aprendizajes);
  r.get('/aprendizaje/actas-que-faltan', (_req, res) => {
    res.json({ items: actasQueFaltan(dbLicitaciones(), raicesDocumentos().conocimiento) });
  });
  r.post('/aprendizajes/leer', leerActas);
  r.patch(
    '/aprendizajes/:n',
    conNumero((n, req, res) => {
      const d = Revision.safeParse(req.body ?? {});
      if (!d.success) return invalido(res, d.error);
      responder(res, revisarAprendizaje(dbLicitaciones(), n, d.data));
    }),
  );
  r.get(
    '/licitaciones/:id/propuesta',
    conId((id, _req, res) => responder(res, propuestaDeLicitacion(dbLicitaciones(), raicesDocumentos(), id))),
  );
  r.post('/licitaciones/:id/propuestas', conId(registrar));
  r.post(
    '/licitaciones/:id/propuestas/deshacer',
    conId((id, _req, res) => responder(res, deshacerPresentacion(dbLicitaciones(), id))),
  );
  r.post('/licitaciones/:id/evaluaciones', conId(evaluar));
  r.get('/salidas/documento', documento);
}
