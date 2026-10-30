// Rutas de la bandeja de propuestas: listar, leer, editar, aprobar y rechazar las notas propuestas.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { listarPendientes, aprobar, rechazar, leerPropuesta, editarPropuesta } from '../motor/bandeja.js';
import { pedirReescaneo } from '../motor/documentos/servicioIndice.js';
import { manejarError } from './errores.js';

export const rutasBandeja = Router();

function extraerNombreArchivo(req: Request): string {
  const crudo = (req.params as Record<string, string | undefined>)['filename'] ?? '';
  return decodeURIComponent(crudo);
}

rutasBandeja.get('/inbox', async (_req, res) => {
  try {
    res.json({ items: await listarPendientes() });
  } catch (err) {
    manejarError(err, res);
  }
});

rutasBandeja.post('/inbox/:filename/approve', async (req, res) => {
  try {
    const nombreArchivo = extraerNombreArchivo(req);
    res.json(await aprobar(nombreArchivo));
    pedirReescaneo();
  } catch (err) {
    manejarError(err, res);
  }
});

rutasBandeja.post('/inbox/:filename/reject', async (req, res) => {
  try {
    const nombreArchivo = extraerNombreArchivo(req);
    res.json(await rechazar(nombreArchivo));
  } catch (err) {
    manejarError(err, res);
  }
});

const Edicion = z.strictObject({ title: z.string().trim().min(1).max(200), body: z.string() });

// «Editar antes»: se corrige la propuesta en su sitio y se aprueba después.
rutasBandeja.get('/inbox/:filename', async (req, res) => {
  try {
    res.json(await leerPropuesta(extraerNombreArchivo(req)));
  } catch (err) {
    manejarError(err, res);
  }
});

rutasBandeja.put('/inbox/:filename', async (req, res) => {
  const e = Edicion.safeParse(req.body ?? {});
  if (!e.success) {
    res.status(400).json({ error: 'invalid_input', message: 'Hace falta «title» y «body».' });
    return;
  }
  try {
    await editarPropuesta(extraerNombreArchivo(req), e.data);
    res.json({ ok: true });
  } catch (err) {
    manejarError(err, res);
  }
});
