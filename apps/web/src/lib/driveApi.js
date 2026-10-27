// API del monitor para conectar Google Drive (apps/server/routes/drive.js).
// Todas devuelven { data, error } con error como texto listo para mostrar.
import { avisarVersionNueva, cabeceraVersion, esVersionAntigua } from './versionWeb';

async function request(path, init) {
  try {
    const res = await fetch(`/api/drive${path}`, {
      ...init,
      headers: { ...cabeceraVersion(), ...(init?.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (esVersionAntigua(res.status, body)) avisarVersionNueva();
    if (!res.ok) return { data: null, error: body.message || `Error ${res.status}` };
    return { data: body.data, error: null };
  } catch {
    return { data: null, error: 'No se pudo conectar con el servidor. Comprueba tu red y vuelve a intentarlo' };
  }
}

const withJson = (method, payload) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

// Mensajes para la vuelta de Google (/api/drive/callback redirige a /?drive=<resultado>).
const CALLBACK_MESSAGES = {
  connected: 'Cuenta conectada. Ahora elige la carpeta de Drive.',
  ACCESS_DENIED: 'No se concedió acceso a Drive.',
  INVALID_STATE: 'La autorización caducó. Vuelve a pulsar Conectar.',
  GOOGLE_ERROR: 'Google rechazó la conexión. Vuelve a intentarlo.',
  NOT_CONFIGURED: 'Faltan las credenciales de Google en Dokploy.',
  STORAGE_ERROR: 'No se pudo guardar la conexión en el servidor.',
};

function takeCallbackResult() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('drive');
  if (!result) return null;
  params.delete('drive');
  const qs = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
  return { ok: result === 'connected', message: CALLBACK_MESSAGES[result] || 'No se pudo conectar Drive.' };
}

// Se lee una sola vez al cargar la app y se limpia de la URL.
export const driveCallbackResult = takeCallbackResult();

export const DRIVE_CONNECT_URL = '/api/drive/connect';

export default {
  status: () => request('/status'),
  folders: (parent) => request(`/folders?parent=${encodeURIComponent(parent)}`),
  createFolder: (parent, name) => request('/folders', withJson('POST', { parent, name })),
  selectFolder: (id, path) => request('/folder', withJson('PUT', { id, path })),
  disconnect: () => request('', { method: 'DELETE' }),
};
