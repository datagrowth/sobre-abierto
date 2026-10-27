// Aviso de versión nueva de la web. Sin React: la comparación es pura y el aviso viaja
// como evento de window para que lo recoja AvisoVersionNueva.
export const EVENTO_VERSION_NUEVA = 'version-nueva';
export const CABECERA_VERSION_WEB = 'X-Web-Version';

/** Nombre con hash del bundle de entrada de esta pestaña; null en desarrollo (/src/main.jsx). */
export function versionPropia(doc) {
  const src = doc?.querySelector?.('script[type="module"][src*="/assets/"]')?.getAttribute('src');
  return src ? src.split('/').pop() || null : null;
}

/** Falta alguna de las dos: no se puede saber, así que no se avisa. */
export const esVersionNueva = (propia, servidor) => Boolean(propia && servidor && propia !== servidor);

/** Compara con la del servidor y, si es otra, avisa. Devuelve si avisó. */
export function avisarSiNueva(servidor) {
  if (typeof window === 'undefined' || !esVersionNueva(versionPropia(document), servidor)) return false;
  window.dispatchEvent(new CustomEvent(EVENTO_VERSION_NUEVA));
  return true;
}

/** Cabecera con la versión de esta pestaña; vacía en desarrollo, donde no hay hash de bundle. */
export function cabeceraVersion(doc = globalThis.document) {
  const v = versionPropia(doc);
  return v ? { [CABECERA_VERSION_WEB]: v } : {};
}

export const COMPROBAR_CADA_MS = 5 * 60_000;

/** El servidor rechaza escrituras de una pestaña anterior al despliegue con este 409. */
export const esVersionAntigua = (status, body) => status === 409 && body?.error === 'version_antigua';

/** Avisa sin comparar hashes: el 409 ya prueba que la pestaña está desfasada. */
export function avisarVersionNueva() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENTO_VERSION_NUEVA));
}

/** Pregunta al servidor su versión y avisa si es otra. Nunca lanza: devuelve { data, error }. */
export async function comprobarVersion(fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn('/api/version', { headers: { Accept: 'application/json' } });
    if (!res.ok) return { data: null, error: new Error(`HTTP ${res.status}`) };
    const body = await res.json();
    return { data: { avisado: avisarSiNueva(body?.version) }, error: null };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
