// Utilidades de los paneles de Hermes Vault (sin componentes: así Vite puede
// recargar en caliente hermesVaultUi.jsx).

export function relativeTime(iso) {
  if (!iso) return 'nunca';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
}

// True si el error indica que el MOTOR de Hermes Vault no está disponible (el proxy
// devuelve 502/503/504 cuando el backend de Hermes Vault no responde, o falla la red).
// El motor también responde 503 con `not_configured` si no hay bóveda: eso no es caída.
export function engineDown(err) {
  if (err && err.code === 'not_configured') return false;
  if (err && typeof err.status === 'number') return err.status >= 502 && err.status <= 504;
  return err instanceof TypeError; // fetch no pudo conectar
}

// True si el motor responde que aún no hay bóveda vinculada.
export function isNotConfigured(err) {
  return Boolean(err && err.code === 'not_configured');
}

// Estado de error de una carga: sin bóveda, motor caído o error con su mensaje.
export function vaultErrorState(err) {
  if (isNotConfigured(err)) return { kind: 'not_configured' };
  if (engineDown(err)) return { kind: 'engine_down' };
  return { kind: 'error', message: (err && err.message) || 'Error' };
}
