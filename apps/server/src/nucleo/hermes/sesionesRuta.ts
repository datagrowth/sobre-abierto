// API de sesiones de Hermes: lista las sesiones y devuelve la actividad ya registrada de cada una.
import { Router } from 'express';
import { getState, readSessionActivity } from './observador.js';

export const sessionsRouter = Router();

sessionsRouter.get('/', (_req, res) => {
  res.json({ sessions: getState().sessions });
});

const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

// Lo que ya pasó en la sesión, con el mismo formato que el evento `activity`.
sessionsRouter.get('/:id/activity', (req, res) => {
  const id = req.params.id;
  if (!SESSION_ID_RE.test(id)) {
    res.status(400).json({ error: 'Invalid session id' });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 300, 1), 1000);
  res.json({ id, activity: readSessionActivity(id, limit) });
});
