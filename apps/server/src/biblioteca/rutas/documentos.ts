// Rutas de los documentos de la Biblioteca: estado del índice y lectura de archivos de la bóveda.
import path from 'node:path';
import { Router } from 'express';
import { estadoIndexador } from '../motor/documentos/servicioIndice.js';
import { esDocumento } from '../motor/documentos/extraccion.js';
import { resolverRutaSegura } from '../motor/notas.js';
import { manejarError } from './errores.js';

export const rutasDocumentos = Router();

// Estado del índice de notas y documentos (cuánto hay leído y con vectores).
rutasDocumentos.get('/documents/status', (_req, res) => {
  res.json(estadoIndexador());
});

// El documento original, para abrirlo desde la búsqueda. Solo formatos de
// documento (nada que el navegador ejecute: PDF en su visor, texto como texto
// plano con nosniff, también el XML, Office se descarga) y dentro de la bóveda. Sin CSP sandbox:
// Chrome no abre PDF en un documento aislado.
rutasDocumentos.get('/files/raw', (req, res) => {
  const relativa = typeof req.query['path'] === 'string' ? req.query['path'] : '';
  try {
    if (!esDocumento(relativa)) {
      res.status(400).json({ error: 'unsafe_path', message: 'Solo se pueden abrir documentos.' });
      return;
    }
    const absoluta = resolverRutaSegura(relativa);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Un XML abierto como XML puede llevar XHTML con scripts: se enseña como texto.
    if (path.extname(absoluta).toLowerCase() === '.xml') res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(absoluta))}`);
    res.sendFile(absoluta, { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'not_found', message: 'Documento no encontrado.' });
    });
  } catch (err) {
    manejarError(err, res);
  }
});
