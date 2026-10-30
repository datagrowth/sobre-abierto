// Comprueba que una ruta de la bóveda es un archivo regular y no sale de ella por enlaces simbólicos.
import fs from 'node:fs';
import fsp, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';

// Sin seguir enlaces en el último tramo (lo que pudo cambiar tras comprobar la ruta) y
// sin bloquearse al abrir un FIFO. En Windows no existen ninguna de las dos banderas.
const ABRIR_PARA_LEER = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);

function codigo(err: unknown): string {
  return (err as NodeJS.ErrnoException).code ?? '';
}

function dentroDe(base: string, rutaReal: string): boolean {
  return rutaReal === base || rutaReal.startsWith(base.endsWith(path.sep) ? base : base + path.sep);
}

// Ruta real de la raíz. La raíz no puede ser ella misma un enlace: si Hermes cambia la
// carpeta por un enlace a «/», todo el disco quedaría «dentro».
function raizReal(raiz: string): Result<string> {
  const st = fs.lstatSync(raiz, { throwIfNoEntry: false });
  if (!st) return fail('not_found', 'La carpeta de la bóveda no existe.');
  if (!st.isDirectory())
    return fail('unsafe_path', 'La carpeta de la bóveda es un enlace o no es una carpeta: configura la ruta real.');
  try {
    return ok(fs.realpathSync.native(raiz));
  } catch (err) {
    return fail('unsafe_path', `No se pudo resolver la carpeta de la bóveda: ${codigo(err) || errorMessage(err)}`);
  }
}

function existeSinSeguir(absoluta: string): boolean {
  try {
    return fs.lstatSync(absoluta, { throwIfNoEntry: false }) !== undefined;
  } catch {
    return false;
  }
}

// Comparar el texto de una ruta no basta para quedarse dentro de la bóveda: Hermes comparte el volumen y tiene
// terminal, y un enlace simbólico (o una unión de Windows) dentro de ella apuntaría a cualquier archivo del
// servidor, como el token de Drive (/drive-state/drive.json). Tampoco basta con que exista: leer un FIFO o un
// dispositivo (/dev/zero) colgaría el proceso.
/**
 * Comprueba que `abs` (ya dentro de `raiz` como texto) siga dentro al resolver enlaces:
 * si existe, su ruta real; si aún no (escrituras), la de su carpeta existente más
 * cercana. Si existe, además, tiene que ser un archivo normal o una carpeta.
 */
export function comprobarRutaReal(raiz: string, absoluta: string): Result<void> {
  const base = raizReal(raiz);
  if (base.error) return base;
  const fuera = fail<void>('unsafe_path', 'La ruta sale de la bóveda por un enlace.');
  for (let actual = absoluta; ; actual = path.dirname(actual)) {
    let rutaReal: string;
    try {
      rutaReal = fs.realpathSync.native(actual);
    } catch (err) {
      if (codigo(err) !== 'ENOENT' && codigo(err) !== 'ENOTDIR') return fuera;
      // Un enlace roto: al escribir se seguiría y crearía el archivo fuera de la bóveda.
      if (existeSinSeguir(actual) || path.dirname(actual) === actual) return fuera;
      continue;
    }
    if (!dentroDe(base.data, rutaReal)) return fuera;
    if (actual !== absoluta) return ok(undefined);
    const st = fs.statSync(rutaReal, { throwIfNoEntry: false });
    if (st && !st.isFile() && !st.isDirectory()) return fail('unsafe_path', 'No es un archivo normal.');
    return ok(undefined);
  }
}

export type ArchivoLeido = { contenido: Buffer; stat: fs.Stats };

/**
 * Lee un archivo normal sin seguir un enlace en el último tramo ni bloquearse en un FIFO.
 * `limiteBytes` evita cargar en memoria lo que no se va a procesar.
 */
export async function leerArchivoRegular(
  absoluta: string,
  limiteBytes = Number.POSITIVE_INFINITY,
): Promise<Result<ArchivoLeido>> {
  let fh: FileHandle;
  try {
    fh = await fsp.open(absoluta, ABRIR_PARA_LEER);
  } catch (err) {
    if (codigo(err) === 'ENOENT') return fail('not_found', 'No existe.');
    if (codigo(err) === 'ELOOP') return fail('unsafe_path', 'Es un enlace simbólico.');
    return fail('read_error', errorMessage(err));
  }
  try {
    const stat = await fh.stat();
    if (!stat.isFile()) return fail('unsafe_path', 'No es un archivo normal.');
    if (stat.size > limiteBytes) return fail('too_large', `Supera ${limiteBytes} bytes.`);
    return ok({ contenido: await fh.readFile(), stat });
  } catch (err) {
    return fail('read_error', errorMessage(err));
  } finally {
    await fh.close().catch(() => undefined);
  }
}
