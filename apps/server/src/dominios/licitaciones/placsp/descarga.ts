// Descargas de la PLACSP y de las plataformas admitidas, con cada redirección comprobada.
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';

// fetch, por defecto, sigue las redirecciones y baja el destino antes de que se pueda mirar adónde fue: aquí
// cada salto (su Location) pasa por la misma lista de URLs permitidas antes de pedirse. Y el cuerpo se lee por
// trozos con un tope, para no cargar entero en memoria lo que no se va a guardar.
const MAX_SALTOS = 3;
const REDIRECCIONES = new Set([301, 302, 303, 307, 308]);

function siguienteSalto(res: Response, actual: string): Result<string> {
  const destino = res.headers.get('location');
  if (!destino) return fail(`placsp_http_${res.status}`, 'Redirección sin destino.');
  try {
    return ok(new URL(destino, actual).toString());
  } catch {
    return fail('url_no_permitida', 'La redirección apunta a una dirección no válida.');
  }
}

/**
 * Pide `url` siguiendo como mucho tres redirecciones, todas dentro de `permitida`. Devuelve
 * la respuesta final (sin leer el cuerpo); un salto fuera de la lista no se llega a pedir.
 */
export async function pedirPermitida(
  url: string,
  init: RequestInit,
  permitida: (u: string) => boolean,
): Promise<Result<Response>> {
  let actual = url;
  try {
    for (let salto = 0; salto <= MAX_SALTOS; salto += 1) {
      if (!permitida(actual))
        return fail('url_no_permitida', `La descarga sale de las direcciones admitidas: ${new URL(actual).hostname}`);
      const res = await fetch(actual, { ...init, redirect: 'manual' });
      if (!REDIRECCIONES.has(res.status)) return ok(res);
      await res.body?.cancel();
      const siguiente = siguienteSalto(res, actual);
      if (siguiente.error) return siguiente;
      actual = siguiente.data;
    }
    return fail('demasiadas_redirecciones', `Más de ${MAX_SALTOS} redirecciones.`);
  } catch (err) {
    return fail('placsp_inalcanzable', errorMessage(err));
  }
}

/** El cuerpo entero, o `demasiado_grande` en cuanto pasa de `maxBytes` (y se deja de leer). */
export async function leerConTope(res: Response, maxBytes: number): Promise<Result<Buffer>> {
  if (!res.body) return ok(Buffer.alloc(0));
  const lector = res.body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  try {
    for (let r = await lector.read(); !r.done; r = await lector.read()) {
      total += r.value.byteLength;
      if (total > maxBytes) {
        await lector.cancel();
        return fail('demasiado_grande', `El documento supera ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      }
      trozos.push(r.value);
    }
    return ok(Buffer.concat(trozos));
  } catch (err) {
    return fail('placsp_inalcanzable', errorMessage(err));
  }
}
