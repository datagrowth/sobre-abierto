// Un archivo pequeño subido desde la web (multipart), recibido en memoria, con tamaño máximo y extensiones permitidas.
import path from 'node:path';
import type { Request } from 'express';
import busboy from 'busboy';
import { fail, ok, type Result } from './result.js';
import { limpiarNombre } from './nombres.js';

// Es para documentos que el dominio procesa en el momento (p. ej. una memoria .docx editada a mano), no para
// guardar en la Biblioteca. Se admite un solo archivo por petición.
// campos: los de texto del mismo formulario (p. ej. una nota que acompaña al archivo).
export type ArchivoRecibido = { nombre: string; datos: Buffer; campos: Record<string, string> };
export type OpcionesSubida = { maxBytes: number; extensiones: string[] };
// Los campos de texto no tienen límite práctico (una nota larga no se corta): solo un tope
// técnico de 1 MB para que un formulario roto no llene la memoria.
const CAMPO_MAX = 1024 * 1024;

function nombreValido(raw: string | undefined, extensiones: string[]): Result<string> {
  const nombre = limpiarNombre(path.basename(String(raw ?? '').replace(/\\/g, '/')), 150);
  if (!extensiones.includes(path.extname(nombre).toLowerCase()))
    return fail('invalid_input', `Formato no admitido: sube un archivo ${extensiones.join(' o ')}.`);
  return ok(nombre);
}

const tamano = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${Math.round(bytes / 1024 / 1024)} MB` : `${Math.round(bytes / 1024)} KB`;

/** Lee el único archivo del formulario; nunca lanza (un corte o un formulario roto es un error). */
export function recibirArchivo(req: Request, op: OpcionesSubida): Promise<Result<ArchivoRecibido>> {
  return new Promise((resolve) => {
    let hecho = false;
    let archivo: Result<Omit<ArchivoRecibido, 'campos'>> | null = null;
    const campos: Record<string, string> = {};
    const terminar = (r: Result<ArchivoRecibido>) => {
      if (!hecho) {
        hecho = true;
        resolve(r);
      }
    };
    let bb: ReturnType<typeof busboy>;
    try {
      bb = busboy({
        headers: req.headers,
        defParamCharset: 'utf8',
        limits: { files: 1, fileSize: op.maxBytes, fields: 5, fieldSize: CAMPO_MAX },
      });
    } catch {
      terminar(fail('invalid_input', 'Hay que enviar el archivo como formulario (multipart/form-data).'));
      return;
    }
    bb.on('file', (_campo, stream, info) => {
      const nombre = nombreValido(info.filename, op.extensiones);
      if (nombre.error) {
        archivo = nombre;
        stream.resume();
        return;
      }
      const trozos: Buffer[] = [];
      stream.on('data', (c: Buffer) => trozos.push(c));
      stream.on('end', () => {
        const datos = Buffer.concat(trozos);
        archivo = (stream as { truncated?: boolean }).truncated
          ? fail('too_large', `El archivo pasa de ${tamano(op.maxBytes)}.`)
          : datos.length
            ? ok({ nombre: nombre.data, datos })
            : fail('invalid_input', 'El archivo está vacío.');
      });
    });
    bb.on('error', (err: Error) => {
      req.unpipe(bb);
      req.resume();
      terminar(fail('invalid_input', err.message));
    });
    // Un tick después: el último trozo del archivo puede llegar justo tras cerrar el formulario.
    bb.on('field', (nombre, valor) => {
      campos[nombre] = valor;
    });
    bb.on('close', () =>
      setImmediate(() => {
        const a = archivo ?? fail<Omit<ArchivoRecibido, 'campos'>>('invalid_input', 'No llegó ningún archivo.');
        terminar(a.error ? a : ok({ ...a.data, campos }));
      }),
    );
    req.on('close', () => {
      if (!req.complete) terminar(fail('invalid_input', 'La subida se cortó antes de terminar.'));
    });
    req.pipe(bb);
  });
}
