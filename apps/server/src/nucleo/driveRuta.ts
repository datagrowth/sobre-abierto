// API de la conexión con Google Drive: estado, autorización y carpeta elegida, con errores traducidos a HTTP.
import express, { type Response } from 'express';
import * as drive from './driveGoogle.js';
import type { Result } from './driveGoogle.js';
import { idDeSesion } from './autenticacion.js';
import { logger } from './log.js';

const log = logger('drive');

export const driveRouter = express.Router();
const json = express.json({ limit: '10kb' });

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  NOT_CONFIGURED: 409,
  NOT_CONNECTED: 409,
  REVOKED: 409,
  GOOGLE_ERROR: 502,
};

function send<T>(res: Response, { data, error }: Result<T>): void {
  if (!error) {
    res.json({ data });
    return;
  }
  res.status(STATUS_BY_CODE[error.code] ?? 500).json({ error: error.code, message: error.message });
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

driveRouter.get('/status', (req, res) => {
  res.json({ data: drive.getStatus(drive.redirectUriFor(req)) });
});

// Navegación del navegador (no fetch): de aquí a Google y de Google a /callback.
driveRouter.get('/connect', (req, res) => {
  const { data, error } = drive.startAuth(drive.redirectUriFor(req), idDeSesion(req));
  res.redirect(error ? `/?drive=${error.code}` : data);
});

driveRouter.get('/callback', async (req, res) => {
  const { code, state, error: denied } = req.query;
  const { error } = await drive.finishAuth(
    { code: text(code), state: text(state), error: text(denied) },
    idDeSesion(req),
  );
  if (error) log.warn('conexión con Drive fallida', { codigo: error.code });
  res.redirect(`/?drive=${error ? error.code : 'connected'}`);
});

driveRouter.get('/folders', async (req, res) => {
  send(res, await drive.listFolders(text(req.query.parent) || 'root'));
});

driveRouter.post('/folders', json, async (req, res) => {
  const { parent = 'root', name } = (req.body || {}) as { parent?: unknown; name?: unknown };
  send(res, await drive.createFolder(parent, name));
});

driveRouter.put('/folder', json, async (req, res) => {
  const { id, path } = (req.body || {}) as { id?: unknown; path?: unknown };
  send(res, await drive.selectFolder(id, path));
});

driveRouter.delete('/', async (_req, res) => {
  send(res, await drive.disconnect());
});
