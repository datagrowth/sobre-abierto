// API de lectura para BI: /api/v1/<recurso>, solo lectura y con un token por integración (Power BI, una hoja…).
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { nucleo } from './contexto.js';
import type { Db } from './db.js';
import { logger } from './log.js';
import { errorMessage, fail, ok, type Result } from './result.js';

const log = logger('api-lectura');
// Va fuera del login de la web: entra con «Authorization: Bearer <token>», nunca con la cookie ni con el token en
// la URL (quedaría en los logs). Del token se guarda su sha256; sale una vez, al crearlo en Ajustes ›
// Integraciones, y revocarlo lo corta al momento. Los recursos los pone cada dominio con registrarLectura y no
// llevan datos de personas, costes ni textos internos.
const hashDe = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const PREFIJO = 'hrm_';
const TOKEN = /^hrm_[A-Za-z0-9_-]{43}$/;

// ─── Tokens (Ajustes › Integraciones, solo admin) ────────────────────────────

export type TokenApi = { id: number; nombre: string; creado_por: string; creado_en: string; ultimo_uso: string | null };
const NuevoToken = z.strictObject({
  nombre: z.string().trim().min(2, 'Ponle un nombre: para qué es (p. ej. «Power BI»).').max(60),
});

export function listarTokens(db: Db): TokenApi[] {
  return db
    .prepare(
      'SELECT id, nombre, creado_por, creado_en, ultimo_uso FROM api_tokens WHERE revocado_en IS NULL ORDER BY id',
    )
    .all() as TokenApi[];
}

/** Un token nuevo para una integración: el token, solo esta vez. */
export function crearToken(db: Db, quien: string, datos: unknown): Result<TokenApi & { token: string }> {
  const v = NuevoToken.safeParse(datos);
  if (!v.success) return fail('invalid_input', v.error.issues[0]?.message ?? 'Nombre no válido.');
  const token = `${PREFIJO}${crypto.randomBytes(32).toString('base64url')}`;
  const r = db
    .prepare('INSERT INTO api_tokens (nombre, hash, creado_por, creado_en) VALUES (?, ?, ?, ?)')
    .run(v.data.nombre, hashDe(token), quien.slice(0, 60), new Date().toISOString());
  const fila = db
    .prepare('SELECT id, nombre, creado_por, creado_en, ultimo_uso FROM api_tokens WHERE id = ?')
    .get(Number(r.lastInsertRowid)) as TokenApi;
  return ok({ ...fila, token });
}

export function revocarToken(db: Db, id: number): Result<{ revocado: true }> {
  const r = db
    .prepare('UPDATE api_tokens SET revocado_en = ? WHERE id = ? AND revocado_en IS NULL')
    .run(new Date().toISOString(), id);
  return r.changes ? ok({ revocado: true }) : fail('not_found', 'Ese token no existe o ya estaba revocado.');
}

/** La integración de una cabecera «Bearer hrm_…» vigente, o null; anota el uso. */
function integracionDe(db: Db, cabecera: string | undefined): TokenApi | null {
  const token = /^Bearer (\S+)$/.exec(cabecera ?? '')?.[1] ?? '';
  if (!TOKEN.test(token)) return null;
  const f = db
    .prepare(
      'SELECT id, nombre, creado_por, creado_en, ultimo_uso FROM api_tokens WHERE hash = ? AND revocado_en IS NULL',
    )
    .get(hashDe(token)) as TokenApi | undefined;
  if (!f) return null;
  db.prepare('UPDATE api_tokens SET ultimo_uso = ? WHERE id = ?').run(new Date().toISOString(), f.id);
  return f;
}

// ─── Recursos (los pone cada dominio) ────────────────────────────────────────

export type Fila = Record<string, string | number | boolean | null>;
type Lectura = { descripcion: string; filas: () => Fila[] };
const lecturas = new Map<string, Lectura>();

/** Un recurso de /api/v1: su nombre (en la ruta), qué es y sus filas, todas (la API las pagina). */
export function registrarLectura(nombre: string, descripcion: string, filas: () => Fila[]): void {
  lecturas.set(nombre, { descripcion, filas });
}

export const MAX_LIMITE = 5000;
const Pagina = z.object({
  desde: z.coerce.number().int().min(0).default(0),
  limite: z.coerce.number().int().min(1).max(MAX_LIMITE).default(1000),
});

function negar(res: Response, status: number, error: string, message: string): void {
  if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="hermes"');
  res.status(status).json({ error, message });
}

function leer(req: Request, res: Response): void {
  const l = lecturas.get(String(req.params['recurso']));
  if (!l) return negar(res, 404, 'not_found', `No hay ese recurso. Los que hay: ${[...lecturas.keys()].join(', ')}.`);
  const p = Pagina.safeParse(req.query);
  if (!p.success) return negar(res, 400, 'invalid_input', `desde: 0 o más; limite: de 1 a ${MAX_LIMITE}.`);
  const todas = l.filas();
  const datos = todas.slice(p.data.desde, p.data.desde + p.data.limite);
  const siguiente = p.data.desde + datos.length < todas.length ? p.data.desde + datos.length : null;
  res.json({ datos, total: todas.length, desde: p.data.desde, siguiente, generado_en: new Date().toISOString() });
}

/** /api/v1, antes del login de la web: con token y solo GET. */
export function rutasApiLectura(): Router {
  const r = Router();
  r.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return negar(res, 405, 'solo_lectura', 'La API es de solo lectura.');
    const integracion = integracionDe(nucleo().db, req.headers.authorization);
    if (!integracion)
      return negar(
        res,
        401,
        'sin_token',
        'Falta un token válido en «Authorization: Bearer …» (Ajustes › Integraciones).',
      );
    res.setHeader('Cache-Control', 'no-store');
    log.info('lectura de la API', { integracion: integracion.id, ruta: req.path });
    next();
  });
  r.get('/', (_req, res) => {
    res.json({
      recursos: [...lecturas].map(([nombre, l]) => ({ nombre, descripcion: l.descripcion, ruta: `/api/v1/${nombre}` })),
    });
  });
  r.get('/:recurso', (req, res) => {
    try {
      leer(req, res);
    } catch (err) {
      log.error('lectura de la API fallida', { recurso: String(req.params['recurso']), error: errorMessage(err) });
      negar(res, 500, 'internal_error', 'No se pudo leer.');
    }
  });
  r.use((_req, res) => negar(res, 404, 'not_found', 'No hay ese recurso.'));
  return r;
}
