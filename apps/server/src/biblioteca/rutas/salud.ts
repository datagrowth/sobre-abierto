// Ruta de salud del motor de la Biblioteca: estado del servicio, tiempo en marcha y estado de la bóveda.
import { Router } from 'express';
import { entorno } from '../entorno.js';
import { obtenerRutaBiblioteca, obtenerEstadoRutaBiblioteca } from '../motor/configuracion.js';

export const rutasSalud = Router();

rutasSalud.get('/health', (_req, res) => {
  const estadoRuta = obtenerEstadoRutaBiblioteca();
  res.json({
    status: 'ok',
    service: 'hermes-vault-backend',
    version: '0.1.0',
    node_env: entorno.NODE_ENV,
    uptime_s: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    vault_path_configured: estadoRuta.ok,
    vault_path_set: obtenerRutaBiblioteca() !== null,
    vault_path_status: estadoRuta,
  });
});
