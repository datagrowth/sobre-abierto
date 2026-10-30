// API REST de la Biblioteca para la skill «biblioteca» de Hermes, con el token del agente.
import express, { Router, type Request, type Response } from 'express';
import { construirContextoMd, obtenerContextoPara } from '../motor/contexto.js';
import { crearPropuesta } from '../motor/bandeja.js';
import { MAX_BYTES_NOTA } from '../motor/notas.js';
import {
  listarDocumentos,
  leerTexto,
  aRelativaBiblioteca,
  relativaBibliotecaOCruda,
  MAX_CARACTERES_LECTURA,
} from '../motor/documentos/lector.js';
import { pedirReescaneo } from '../motor/documentos/servicioIndice.js';
import { manejarError } from './errores.js';
import { agenteDe, requiere } from '../../nucleo/agentes/autenticacionAgentes.js';
import { CARPETA_COLABORADORES, carpetasOcultas, enColaboradores } from '../../nucleo/colaboradores/cvs.js';
import { carpetasConFicha, dominioConFicha } from '../../nucleo/documentos.js';
import { motivoBiblioteca } from '../../nucleo/mcp/biblioteca.js';

// Los CV de Colaboradores/ son datos personales: como en las tools MCP, sin permiso de
// leer colaboradores no se buscan, listan ni leen, y nunca se convierten en notas. Tampoco
// los pliegos y bases que ya analiza un dominio con su ficha (serían una nota por pliego).
function ocultas(res: Response): string[] {
  return carpetasOcultas(agenteDe(res)?.permisos ?? {});
}

function sinPermisoCv(res: Response): void {
  res.status(403).json({
    error: 'forbidden',
    message: 'Los CV de Colaboradores/ son datos personales: sin permiso para leer colaboradores.',
  });
}

function texto(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length >= min && t.length <= max ? t : null;
}

function entero(value: unknown, porDefecto: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : porDefecto;
}

function invalida(res: Response, mensaje: string): void {
  res.status(400).json({ error: 'invalid_input', message: mensaje });
}

// Solo lee y propone: las notas nuevas quedan en _Propuestas hasta que alguien las aprueba. Va con el token del
// agente (nucleo/agentes), no con la sesión del navegador; los agentes nuevos usan el servidor MCP (/mcp).
async function buscar(req: Request, res: Response): Promise<void> {
  const cuerpo = (req.body ?? {}) as Record<string, unknown>;
  const consulta = texto(cuerpo['consulta'], 2, 500);
  if (!consulta) return invalida(res, '«consulta» debe tener entre 2 y 500 caracteres.');
  const limite = entero(cuerpo['limite'], 5, 1, 20);
  const contexto = await obtenerContextoPara(consulta, {
    limit: limite,
    body_max_chars: 3000,
    exclude_folders: ocultas(res),
  });
  const permisos = { permisos: agenteDe(res)?.permisos ?? {} };
  const elementos = contexto.items.filter((i) => motivoBiblioteca(i.path, permisos) === null);
  res.json({
    consulta,
    resultados: elementos.map(({ path: ruta, title: titulo, kind, score: puntuacion, snippet: fragmento }) => ({
      ruta,
      titulo,
      tipo: kind,
      score: puntuacion,
      fragmento,
    })),
    contexto:
      elementos.length === contexto.items.length ? contexto.context_md : construirContextoMd(consulta, elementos),
  });
}

async function leer(req: Request, res: Response): Promise<void> {
  const ruta = texto(req.query['ruta'], 1, 1000);
  if (!ruta) return invalida(res, 'Falta «ruta».');
  if (ocultas(res).length && enColaboradores(relativaBibliotecaOCruda(ruta))) return sinPermisoCv(res);
  const motivo = motivoBiblioteca(relativaBibliotecaOCruda(ruta), { permisos: agenteDe(res)?.permisos ?? {} });
  if (motivo) {
    res.status(403).json({ error: 'forbidden', message: motivo });
    return;
  }
  const desde = entero(req.query['desde'], 0, 0, Number.MAX_SAFE_INTEGER);
  const max = entero(req.query['max'], MAX_CARACTERES_LECTURA, 1, MAX_CARACTERES_LECTURA);
  res.json(await leerTexto(ruta, desde, max));
}

async function documentos(req: Request, res: Response): Promise<void> {
  const sinNota = req.query['sin_nota'] === '1' || req.query['sin_nota'] === 'true';
  const excluir = sinNota ? [CARPETA_COLABORADORES, ...carpetasConFicha()] : ocultas(res);
  res.json(await listarDocumentos(sinNota, entero(req.query['limite'], 50, 1, 500), excluir));
}

function rutaOpcional(value: unknown): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  const crudo = texto(value, 1, 1000);
  if (!crudo) return null;
  try {
    return aRelativaBiblioteca(crudo);
  } catch {
    return null;
  }
}

async function proponer(req: Request, res: Response): Promise<void> {
  const cuerpo = (req.body ?? {}) as Record<string, unknown>;
  const titulo = texto(cuerpo['titulo'], 1, 200);
  const contenido = typeof cuerpo['contenido'] === 'string' ? cuerpo['contenido'] : '';
  if (!titulo) return invalida(res, '«titulo» debe tener entre 1 y 200 caracteres.');
  if (!contenido.trim() || Buffer.byteLength(contenido, 'utf8') > MAX_BYTES_NOTA)
    return invalida(res, '«contenido» vacío o demasiado grande.');
  const fuente = rutaOpcional(cuerpo['fuente']);
  const carpeta = rutaOpcional(cuerpo['carpeta']);
  if (fuente === null || carpeta === null)
    return invalida(res, '«fuente» y «carpeta» deben ser rutas dentro de la Biblioteca.');
  if ([fuente, carpeta].some((r) => r !== undefined && enColaboradores(r)))
    return invalida(res, 'Los CV de Colaboradores/ no se convierten en notas.');
  const dominio = fuente === undefined ? null : dominioConFicha(fuente);
  if (dominio) return invalida(res, `Ese documento ya lo analiza ${dominio} con su ficha: no se convierte en nota.`);
  const motivo = texto(cuerpo['motivo'], 1, 500) ?? undefined;
  const creada = await crearPropuesta({
    title: titulo,
    body: contenido,
    source: fuente,
    folder: carpeta,
    reason: motivo,
    origin: agenteDe(res)?.nombre,
  });
  pedirReescaneo();
  res.status(201).json({ ruta: creada.path, estado: 'pendiente' });
}

function envolver(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err: unknown) => manejarError(err, res));
  };
}

export function crearRutasAgente(): Router {
  const rutas = Router();
  // Holgura sobre MAX_BYTES_NOTA: el JSON escapado ocupa más que el texto.
  rutas.use(express.json({ limit: '8mb' }));
  rutas.post('/buscar', envolver(buscar));
  rutas.get('/leer', envolver(leer));
  rutas.get('/documentos', envolver(documentos));
  rutas.post('/propuestas', requiere('biblioteca', 'proponer'), envolver(proponer));
  rutas.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  return rutas;
}
