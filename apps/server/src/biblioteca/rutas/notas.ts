// Rutas de las notas de la Biblioteca: leer, crear, guardar, borrar, renombrar y consultar sus enlaces.
import { Router, type Request } from 'express';
import { leerNota, leerNotaCruda, crearNota, escribirNotaCruda, borrarNota } from '../motor/notas.js';
import { obtenerEnlacesNota, renombrarNotaActualizandoEnlaces } from '../motor/enlaces.js';
import { manejarError } from './errores.js';

export const rutasNotas = Router();

function extraerRutaRelativa(req: Request, sufijo?: string): string {
  const crudo = (req.params as Record<string, string | undefined>)['0'] ?? '';
  const decodificada = decodeURIComponent(crudo);
  if (sufijo && decodificada.endsWith(sufijo)) {
    return decodificada.slice(0, -sufijo.length);
  }
  return decodificada;
}

rutasNotas.get('/notes/*/links', async (req, res) => {
  try {
    const rutaRelativa = extraerRutaRelativa(req, '/links');
    res.json(await obtenerEnlacesNota(rutaRelativa));
  } catch (err) {
    manejarError(err, res);
  }
});

rutasNotas.get('/notes/*/raw', async (req, res) => {
  try {
    const rutaRelativa = extraerRutaRelativa(req, '/raw');
    res.json(await leerNotaCruda(rutaRelativa));
  } catch (err) {
    manejarError(err, res);
  }
});

rutasNotas.post('/notes/*/rename', async (req, res) => {
  try {
    const rutaRelativa = extraerRutaRelativa(req, '/rename');
    const { to, update_links } = (req.body ?? {}) as { to?: string; update_links?: unknown };
    res.json(await renombrarNotaActualizandoEnlaces(rutaRelativa, to ?? '', update_links !== false));
  } catch (err) {
    manejarError(err, res);
  }
});

rutasNotas.post('/notes', async (req, res) => {
  try {
    const { path: rutaNota, content: contenido } = (req.body ?? {}) as { path?: string; content?: unknown };
    res.json(await crearNota(rutaNota ?? '', contenido ?? ''));
  } catch (err) {
    manejarError(err, res);
  }
});

rutasNotas.put('/notes/*', async (req, res) => {
  try {
    const rutaRelativa = extraerRutaRelativa(req);
    const { content: contenido, base_hash } = (req.body ?? {}) as { content?: unknown; base_hash?: unknown };
    res.json(await escribirNotaCruda(rutaRelativa, contenido, base_hash));
  } catch (err) {
    manejarError(err, res);
  }
});

rutasNotas.delete('/notes/*', async (req, res) => {
  try {
    const rutaRelativa = extraerRutaRelativa(req);
    res.json(await borrarNota(rutaRelativa));
  } catch (err) {
    manejarError(err, res);
  }
});

rutasNotas.get('/notes/*', async (req, res) => {
  try {
    const rutaRelativa = extraerRutaRelativa(req);
    const nota = await leerNota(rutaRelativa);
    res.json(nota);
  } catch (err) {
    manejarError(err, res);
  }
});
