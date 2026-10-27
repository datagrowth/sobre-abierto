// Subida de documentos desde la web a la Biblioteca (carpeta Conocimiento).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Readable } from 'node:stream';
import { Router, type Request, type Response } from 'express';
import busboy from 'busboy';
import { EXTENSIONES_DOCUMENTO } from '../motor/documentos/extraccion.js';
import { resolverRutaSegura } from '../motor/notas.js';
import { pedirReescaneo } from '../motor/documentos/servicioIndice.js';
import { CARPETA_PROPUESTAS } from '../motor/carpetas.js';
import { limpiarNombre } from '../../nucleo/nombres.js';
import { manejarError } from './errores.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { logger } from '../../nucleo/log.js';

// drive-sync los sube a Drive y el indexador los lee en unos segundos. Un archivo por petición, solo formatos
// que la Biblioteca sabe leer, sin pisar nada.
const MAX_BYTES_SUBIDA = 100 * 1024 * 1024;
const log = logger('biblioteca.subida');
const PERMITIDAS = new Set([...EXTENSIONES_DOCUMENTO, '.md']);

/** Carpeta relativa válida (sin «..», ocultas ni _Propuestas); vacía = raíz. */
export function carpetaSubida(crudo: unknown): Result<string> {
  if (crudo !== undefined && typeof crudo !== 'string') return fail('invalid_input', 'Carpeta no válida.');
  const crudas = (crudo ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  // Antes de limpiar: limpiarNombre quita el punto inicial y «..» u «.oculta» pasarían por carpetas normales.
  if (crudas.some((p) => p.startsWith('.'))) return fail('invalid_input', 'Carpeta no permitida.');
  const partes = crudas.map((p) => limpiarNombre(p, 100)).filter(Boolean);
  // Después de limpiar y sin distinguir mayúsculas: «_Propuestas#» o «_propuestas» acabarían en la bandeja de propuestas.
  if (partes.some((p) => p.toLowerCase() === CARPETA_PROPUESTAS.toLowerCase()))
    return fail('invalid_input', 'Carpeta no permitida.');
  return ok(partes.join('/'));
}

export function nombreSubida(crudo: string): Result<string> {
  const nombre = limpiarNombre(path.basename(crudo.replace(/\\/g, '/')), 150);
  if (!PERMITIDAS.has(path.extname(nombre).toLowerCase())) {
    return fail('invalid_input', `Formato no admitido. Se aceptan: ${[...PERMITIDAS].join(', ')}.`);
  }
  return ok(nombre);
}

async function destinoLibre(carpetaAbsoluta: string, nombre: string): Promise<string> {
  const extension = path.extname(nombre);
  const base = nombre.slice(0, nombre.length - extension.length);
  for (let i = 0; i < 1000; i++) {
    const candidato = path.join(carpetaAbsoluta, i === 0 ? nombre : `${base}-${i}${extension}`);
    if (
      !(await fsp.access(candidato).then(
        () => true,
        () => false,
      ))
    )
      return candidato;
  }
  return path.join(carpetaAbsoluta, `${base}-${crypto.randomUUID().slice(0, 8)}${extension}`);
}

type Recibido = { tmp: string; nombre: string; bytes: number; truncado: boolean };
type Temporal = { tmp: string; out: fs.WriteStream };

// Cierra el WriteStream (y espera a que suelte el descriptor: en Windows no se puede borrar
// un archivo abierto) y borra el temporal. Si no se puede borrar queda en el log, sin la ruta.
async function soltar({ tmp: temporal, out: salida }: Temporal): Promise<void> {
  const cerrado = salida.closed
    ? Promise.resolve()
    : new Promise<void>((r) => {
        salida.once('close', () => r());
      });
  salida.destroy();
  await cerrado;
  await fsp.rm(temporal, { force: true }).catch((err: unknown) => {
    log.warn('temporal de una subida sin borrar', { codigo: (err as NodeJS.ErrnoException).code ?? errorMessage(err) });
  });
}

// Una subida en curso. Termina una sola vez, bien (archivo entero en el temporal) o mal; si
// acaba mal suelta el temporal: un corte del cliente o un multipart mal formado no pueden
// dejar un `.subida-*` de hasta 100 MB ni la petición colgada.
class Subida {
  private hecha = false;
  private cerrada = false;
  private temporal: Temporal | null = null;
  private archivo: Result<Recibido> | null = null;

  constructor(
    private readonly dirAbs: string,
    private readonly resolver: (r: Result<Recibido>) => void,
  ) {}

  archivoNuevo(flujo: Readable & { truncated?: boolean }, nombreArchivo: string | undefined): void {
    const nombre = nombreSubida(nombreArchivo ?? '');
    if (nombre.error) {
      flujo.resume();
      this.archivo = nombre;
      return;
    }
    const temporal = path.join(this.dirAbs, `.subida-${crypto.randomUUID()}`);
    const salida = fs.createWriteStream(temporal, { flags: 'wx' });
    this.temporal = { tmp: temporal, out: salida };
    let bytes = 0;
    flujo.on('data', (c: Buffer) => {
      bytes += c.length;
    });
    flujo.on('error', (err: Error) => this.mal(fail('invalid_input', err.message)));
    salida.on('error', (err) => {
      log.error('no se pudo escribir una subida', { codigo: (err as NodeJS.ErrnoException).code ?? 'desconocido' });
      this.mal(fail('io_error', 'No se pudo guardar el archivo.'));
    });
    salida.on('finish', () => {
      this.archivo = ok({ tmp: temporal, nombre: nombre.data, bytes, truncado: flujo.truncated === true });
      this.quizasFin();
    });
    flujo.pipe(salida);
  }

  formularioCerrado(): void {
    this.cerrada = true;
    this.quizasFin();
  }

  mal(r: Result<never>): void {
    if (this.hecha) return;
    this.hecha = true;
    if (!this.temporal) {
      this.resolver(r);
      return;
    }
    void soltar(this.temporal).then(() => this.resolver(r));
  }

  // Bien solo cuando busboy ha cerrado el formulario y el archivo, si lo hay, está escrito entero.
  private quizasFin(): void {
    if (!this.cerrada || (this.temporal && !this.archivo)) return;
    const r = this.archivo ?? fail<Recibido>('invalid_input', 'No llegó ningún archivo.');
    if (r.error) {
      this.mal(r);
      return;
    }
    if (this.hecha) return;
    this.hecha = true;
    this.resolver(r);
  }
}

// El archivo se escribe primero a un temporal oculto (el indexador y drive-sync
// ignoran los ocultos) y solo se renombra cuando ha llegado entero.
function recibir(req: Request, carpetaAbsoluta: string): Promise<Result<Recibido>> {
  return new Promise((resolve) => {
    const subida = new Subida(carpetaAbsoluta, resolve);
    // Los navegadores mandan el nombre en UTF-8; busboy lo leería como latin1.
    const bb = busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: { files: 1, fileSize: MAX_BYTES_SUBIDA, fields: 5 },
    });
    bb.on('file', (_campo, flujo, informacion) => subida.archivoNuevo(flujo, informacion.filename));
    bb.on('error', (err: Error) => {
      req.unpipe(bb);
      req.resume();
      subida.mal(fail('invalid_input', err.message));
    });
    bb.on('close', () => subida.formularioCerrado());
    // Si el cliente corta, la petición no termina nunca y busboy no cierra: se da por fallida.
    req.on('close', () => {
      if (!req.complete) subida.mal(fail('invalid_input', 'La subida se cortó antes de terminar.'));
    });
    req.pipe(bb);
  });
}

async function guardar(
  carpetaAbsoluta: string,
  r: Recibido,
  raiz: string,
): Promise<Result<{ ruta: string; bytes: number }>> {
  if (r.truncado || r.bytes === 0) {
    await fsp.rm(r.tmp, { force: true });
    return fail('invalid_input', r.bytes === 0 ? 'El archivo está vacío.' : 'El archivo supera 100 MB.');
  }
  const destino = await destinoLibre(carpetaAbsoluta, r.nombre);
  await fsp.rename(r.tmp, destino);
  pedirReescaneo();
  return ok({ ruta: path.relative(raiz, destino).split(path.sep).join('/'), bytes: r.bytes });
}

async function subir(req: Request, res: Response): Promise<void> {
  if (!req.is('multipart/form-data')) {
    res.status(415).json({ error: 'invalid_input', message: 'Envía el archivo como multipart/form-data.' });
    return;
  }
  const carpeta = carpetaSubida(req.query['carpeta']);
  if (carpeta.error) {
    res.status(400).json({ error: carpeta.error.code, message: carpeta.error.message });
    return;
  }
  const raiz = resolverRutaSegura('.');
  const carpetaAbsoluta = resolverRutaSegura(carpeta.data || '.');
  await fsp.mkdir(carpetaAbsoluta, { recursive: true });
  const recibido = await recibir(req, carpetaAbsoluta);
  const r = recibido.error ? recibido : await guardar(carpetaAbsoluta, recibido.data, raiz);
  if (r.error)
    res.status(r.error.code === 'io_error' ? 500 : 400).json({ error: r.error.code, message: r.error.message });
  else res.status(201).json(r.data);
}

export const rutasSubida = Router();

rutasSubida.post('/upload', (req, res) => {
  subir(req, res).catch((err: unknown) => manejarError(err, res));
});
