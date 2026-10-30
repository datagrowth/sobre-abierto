// Rutas de lectura general de la bóveda: lista de notas, carpetas, estadísticas y notas recientes.
import { Router } from 'express';
import { obtenerEstadisticas, obtenerRecientes, listarNotas, listarCarpetas } from '../motor/notas.js';
import { manejarError } from './errores.js';

export const rutasBiblioteca = Router();

// Lista COMPLETA de notas de la bóveda (para el índice navegable de la pestaña Notas).
rutasBiblioteca.get('/vault/notes', async (_req, res) => {
  try {
    res.json({ items: await listarNotas() });
  } catch (err) {
    manejarError(err, res);
  }
});

rutasBiblioteca.get('/vault/stats', async (_req, res) => {
  try {
    res.json(await obtenerEstadisticas());
  } catch (err) {
    manejarError(err, res);
  }
});

rutasBiblioteca.get('/vault/recent', async (req, res) => {
  const limiteCrudo = req.query['limit'];
  const limite = typeof limiteCrudo === 'string' ? Number.parseInt(limiteCrudo, 10) : 10;
  const limiteSeguro = Number.isFinite(limite) && limite > 0 && limite <= 200 ? limite : 10;
  try {
    res.json({ items: await obtenerRecientes(limiteSeguro) });
  } catch (err) {
    manejarError(err, res);
  }
});

rutasBiblioteca.get('/vault/folders', async (_req, res) => {
  try {
    res.json({ folders: await listarCarpetas() });
  } catch (err) {
    manejarError(err, res);
  }
});
