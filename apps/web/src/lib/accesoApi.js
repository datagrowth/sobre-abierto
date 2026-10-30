// Acceso de cada persona (/auth, fuera de /api) y gestión de usuarios de Ajustes › Usuarios (solo admin).
import { ApiError, json, request } from './apiCliente.js';

/** Cambia la contraseña propia; devuelve { usuario } y deja la sesión de este navegador abierta. */
export async function cambiarContrasena(actual, nueva) {
  const res = await fetch('/auth/contrasena', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actual, nueva }),
  });
  const body = await res.json().catch(() => null);
  // Los errores de /auth traen el texto en «message» o, los de sesión, en «error».
  if (!res.ok)
    throw new ApiError(res.status, body?.error || 'http_error', body?.message || body?.error || `HTTP ${res.status}`);
  return body;
}

export const usuariosApi = {
  listar: () => request('/api/plataforma/usuarios'),
  crear: (datos) => request('/api/plataforma/usuarios', json('POST', datos)),
  cambiar: (id, datos) => request(`/api/plataforma/usuarios/${encodeURIComponent(id)}`, json('PATCH', datos)),
  temporal: (id, contrasena) =>
    request(`/api/plataforma/usuarios/${encodeURIComponent(id)}/contrasena`, json('POST', { contrasena })),
};

// Los avisos por email de quien entra (Ajustes › Avisos › Tus avisos).
export const misAvisosApi = {
  leer: () => request('/api/plataforma/yo/avisos'),
  guardar: (cambio) => request('/api/plataforma/yo/avisos', json('PUT', cambio)),
};

// El enlace del calendario ICS de quien entra (Ajustes › Integraciones): la URL sale solo al crearlo.
export const calendarioApi = {
  estado: () => request('/api/plataforma/yo/calendario'),
  crear: () => request('/api/plataforma/yo/calendario', { method: 'POST' }),
  revocar: () => request('/api/plataforma/yo/calendario', { method: 'DELETE' }),
};

/** La dirección del calendario: la que da el servidor o, sin dirección pública configurada, la de esta web. */
export const urlCalendario = (r, origen) => r?.url ?? (r?.ruta ? `${origen}${r.ruta}` : null);
