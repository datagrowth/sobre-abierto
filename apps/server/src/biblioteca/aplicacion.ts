// Aplicación Express del motor de la Biblioteca: monta las rutas de notas, propuestas, búsqueda y subida.
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { rutasSalud } from './rutas/salud.js';
import { rutasConfiguracion } from './rutas/configuracion.js';
import { rutasAjustes } from './rutas/ajustes.js';
import { rutasBiblioteca } from './rutas/biblioteca.js';
import { rutasNotas } from './rutas/notas.js';
import { rutasBandeja } from './rutas/bandeja.js';
import { rutasBusqueda } from './rutas/busqueda.js';
import { rutasDocumentos } from './rutas/documentos.js';
import { rutasSubida } from './rutas/subida.js';
import { logger } from '../nucleo/log.js';

const log = logger('biblioteca');

/**
 * API de la Biblioteca como sub-app de Express. El servidor la monta en
 * /hermes-vault detrás de su login, así que aquí no hay CORS, auth ni estáticos.
 */
export function crearAplicacionBiblioteca(): Express {
  const app = express();

  // Holgura sobre MAX_BYTES_NOTA (2 MB): el JSON escapado ocupa más que el texto y
  // el límite real de una nota lo aplica motor/notas.ts con un 400 claro.
  app.use(express.json({ limit: '8mb' }));

  app.use('/api/v1', rutasSalud);
  app.use('/api/v1', rutasConfiguracion);
  app.use('/api/v1', rutasAjustes);
  app.use('/api/v1', rutasBiblioteca);
  app.use('/api/v1', rutasNotas);
  app.use('/api/v1', rutasBandeja);
  app.use('/api/v1', rutasBusqueda);
  app.use('/api/v1', rutasDocumentos);
  app.use('/api/v1', rutasSubida);

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if ((err as { type?: string } | null)?.type === 'entity.too.large') {
      res.status(413).json({ error: 'invalid_content', message: 'El contenido enviado es demasiado grande.' });
      return;
    }
    const mensaje = err instanceof Error ? err.message : 'unknown error';
    log.error('error en la API de la Biblioteca', { error: mensaje });
    res.status(500).json({ error: 'internal_error', message: mensaje });
  });

  return app;
}
