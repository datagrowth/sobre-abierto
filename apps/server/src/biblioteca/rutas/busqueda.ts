// Ruta de búsqueda de la Biblioteca: consulta notas y documentos a la vez y devuelve los resultados.
import { Router } from 'express';
import { buscarEnBiblioteca } from '../motor/documentos/busquedaHibrida.js';
import { manejarError } from './errores.js';

export const rutasBusqueda = Router();

rutasBusqueda.get('/search', async (req, res) => {
  const consultaOriginal = req.query['q'];
  const q = typeof consultaOriginal === 'string' ? consultaOriginal : '';
  const limiteCrudo = req.query['limit'];
  const limite = typeof limiteCrudo === 'string' ? Number.parseInt(limiteCrudo, 10) : 20;
  try {
    const aciertos = await buscarEnBiblioteca(q, limite);
    res.json({ query: q, items: aciertos });
  } catch (err) {
    manejarError(err, res);
  }
});
