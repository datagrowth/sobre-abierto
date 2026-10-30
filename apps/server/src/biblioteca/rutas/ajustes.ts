// Rutas de ajustes de la Biblioteca: comprobar, crear, cambiar y restablecer la ruta de la bóveda.
import { Router, type Response } from 'express';
import { entorno } from '../entorno.js';
import {
  obtenerRutaBiblioteca,
  obtenerEstadoRutaBiblioteca,
  obtenerArchivoConfiguracion,
  comprobarRutaBiblioteca,
  fijarRutaBiblioteca,
  crearRutaBiblioteca,
  obtenerRutaSugerida,
  restablecerRutaBiblioteca,
  rutaBibliotecaFijada,
  ErrorConfiguracion,
} from '../motor/configuracion.js';
import { manejarError } from './errores.js';

export const rutasAjustes = Router();

// Con la ruta fijada por el servidor tampoco se comprueban rutas: /settings/check
// diría a cualquier sesión qué carpetas existen en el servidor y cuántas notas tienen.
function soloLectura(res: Response): boolean {
  if (!rutaBibliotecaFijada()) return false;
  res.status(403).json({
    error: 'read_only_mode',
    message: 'La ruta de la bóveda la fija el servidor (VAULT_PATH): no se cambia desde la web.',
  });
  return true;
}

function errorConfiguracion(err: unknown, res: Response): void {
  if (err instanceof ErrorConfiguracion) {
    const estado = err.code === 'read_only_mode' ? 403 : err.code === 'invalid_path' ? 400 : 500;
    res.status(estado).json({ error: err.code, message: err.message });
    return;
  }
  manejarError(err, res);
}

function rutaDelCuerpo(cuerpo: unknown): string {
  const ruta = (cuerpo as { path?: unknown } | undefined)?.path;
  return typeof ruta === 'string' ? ruta : '';
}

rutasAjustes.get('/settings', (_req, res) => {
  const actual = obtenerRutaBiblioteca();
  res.json({
    mode: entorno.HERMES_VAULT_MODE,
    editable: !rutaBibliotecaFijada(),
    vault_path: actual,
    env_vault_path: entorno.VAULT_PATH,
    vault_path_set: actual !== null,
    vault_path_status: obtenerEstadoRutaBiblioteca(),
    suggested_vault_path: obtenerRutaSugerida(),
    config_file: obtenerArchivoConfiguracion(),
  });
});

rutasAjustes.post('/settings/check', (req, res) => {
  if (soloLectura(res)) return;
  res.json(comprobarRutaBiblioteca(rutaDelCuerpo(req.body)));
});

rutasAjustes.post('/settings/vault', (req, res) => {
  if (soloLectura(res)) return;
  try {
    res.json(fijarRutaBiblioteca(rutaDelCuerpo(req.body)));
  } catch (err) {
    errorConfiguracion(err, res);
  }
});

rutasAjustes.post('/settings/vault/create', (req, res) => {
  if (soloLectura(res)) return;
  try {
    res.json(crearRutaBiblioteca(rutaDelCuerpo(req.body)));
  } catch (err) {
    errorConfiguracion(err, res);
  }
});

rutasAjustes.delete('/settings/vault', (_req, res) => {
  if (soloLectura(res)) return;
  restablecerRutaBiblioteca();
  res.json({ vault_path: obtenerRutaBiblioteca() });
});
