// Ruta que informa de la configuración del motor de la Biblioteca: modo, ruta de la bóveda y su estado.
import { Router } from 'express';
import { entorno } from '../entorno.js';
import { obtenerRutaBiblioteca, obtenerEstadoRutaBiblioteca } from '../motor/configuracion.js';

export const rutasConfiguracion = Router();

rutasConfiguracion.get('/config', (_req, res) => {
  const estadoRuta = obtenerEstadoRutaBiblioteca();
  res.json({
    mode: entorno.HERMES_VAULT_MODE,
    vault_path_configured: estadoRuta.ok,
    vault_path_set: obtenerRutaBiblioteca() !== null,
    vault_path_status: estadoRuta,
    version: '0.1.0',
  });
});
