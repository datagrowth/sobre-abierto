// Cliente HTTP de la web (mismo origen, tras el login del monitor): peticiones JSON con
// errores como ApiError, subida de documentos a la Biblioteca y enlace a un documento.
import { MENSAJE_SIN_CONEXION, mensajeSinCuerpo } from './erroresHttp.js';
import { avisarSiSinSesion } from './sesion.js';
import {
  avisarSiNueva,
  avisarVersionNueva,
  cabeceraVersion,
  esVersionAntigua,
  CABECERA_VERSION_WEB,
} from './versionWeb.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const pedir = (path, init = {}) =>
  fetch(path, {
    ...init,
    headers: { Accept: 'application/json', ...cabeceraVersion(), ...(init.headers || {}) },
  }).catch((e) => {
    // Un fetch que falla antes de tener respuesta (red caída, servidor parado) llega como TypeError.
    throw e instanceof TypeError ? new ApiError(0, 'sin_conexion', MENSAJE_SIN_CONEXION) : e;
  });

async function leerCuerpo(res) {
  const body = await res.json().catch(() => null);
  if (esVersionAntigua(res.status, body)) avisarVersionNueva();
  avisarSiSinSesion(res.status);
  if (!res.ok)
    throw new ApiError(res.status, body?.error || 'http_error', body?.message || mensajeSinCuerpo(res.status));
  return body;
}

export async function request(path, init = {}) {
  const res = await pedir(path, init);
  // Antes de tirar el ApiError: un 400 por JS anterior al despliegue también debe avisar.
  avisarSiNueva(res.headers.get(CABECERA_VERSION_WEB));
  return leerCuerpo(res);
}

/**
 * GET con ETag: si el recurso no cambió desde `etag`, el servidor responde 304 sin cuerpo y
 * esto da { noCambio: true }; si cambió, { data, etag } con el ETag nuevo. Así una vista
 * puede preguntar a menudo (eventos, reconexión) sin rehacer nada.
 */
export async function requestCondicional(path, etag = null) {
  const res = await pedir(path, etag ? { headers: { 'If-None-Match': etag } } : {});
  avisarSiNueva(res.headers.get(CABECERA_VERSION_WEB));
  if (res.status === 304) return { noCambio: true };
  const data = await leerCuerpo(res);
  return { data, etag: res.headers.get('ETag') };
}

/** Un recurso que el servidor puede no tener aún (404) vale null: la vista no lo enseña en vez de dar error. */
export const nuloSi404 = (promesa) => promesa.catch((e) => (e?.status === 404 ? null : Promise.reject(e)));

export const json = (method, data) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export function subirDocumento(archivo, carpeta) {
  const form = new FormData();
  form.append('archivo', archivo, archivo.name);
  const q = carpeta ? `?carpeta=${encodeURIComponent(carpeta)}` : '';
  return request(`/hermes-vault/api/v1/upload${q}`, { method: 'POST', body: form });
}

export function urlDocumento(ruta) {
  return `/hermes-vault/api/v1/files/raw?path=${encodeURIComponent(ruta)}`;
}
