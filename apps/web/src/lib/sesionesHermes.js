// Utilidades de las sesiones de Hermes: títulos, etiquetas de origen, orden, filtrado y tiempo relativo.
function toMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sourceLabel(source) {
  const value = String(source || 'desconocida').toLowerCase();
  const labels = {
    cli: 'CLI',
    telegram: 'Telegram',
    gateway: 'Gateway',
    discord: 'Discord',
    cron: 'Cron',
    api: 'API',
    // Las tareas que la plataforma encarga a Hermes llegan por su API server.
    api_server: 'Plataforma',
  };
  return labels[value] || value.charAt(0).toUpperCase() + value.slice(1);
}

/** «Licitaciones · API» para las sesiones de un perfil; si no, solo el origen. */
export function etiquetaSesion(session = {}) {
  const origen = sourceLabel(session.source);
  if (!session.profile) return origen;
  const perfil = String(session.profile).replace(/-/g, ' ');
  return `${perfil.charAt(0).toUpperCase()}${perfil.slice(1)} · ${origen}`;
}

export function normalizeSession(session = {}) {
  // Las de un perfil salen de su state.db: sin last_active, con started_at y ended_at.
  const lastActiveMs = toMillis(
    session.last_active ??
      session.lastActive ??
      session.updated_at ??
      session.created_at ??
      session.ended_at ??
      session.started_at,
  );
  return {
    ...session,
    id: String(session.id || ''),
    source: session.source || 'unknown',
    title: session.title || '',
    preview: session.preview || '',
    message_count: session.message_count ?? session.messageCount ?? 0,
    lastActiveMs,
  };
}

export function sortSessionsByActivity(sessions = []) {
  return sessions.map(normalizeSession).sort((a, b) => (b.lastActiveMs || 0) - (a.lastActiveMs || 0));
}

export function filterSessions(sessions = [], { source = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return sortSessionsByActivity(sessions).filter((session) => {
    const matchesSource = source === 'all' || String(session.source || '').toLowerCase() === source;
    if (!matchesSource) return false;
    if (!q) return true;
    return [session.id, session.source, session.title, session.preview, session.user_id, session.handoff_platform]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });
}

export function getSessionTitle(session = {}) {
  const normalized = normalizeSession(session);
  return normalized.title || normalized.preview || normalized.id || 'Sesión sin título';
}

export function formatRelativeTime(ms, now = Date.now()) {
  if (!ms) return 'sin fecha';
  const diff = Math.max(0, now - ms);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'ahora';
  if (diff < hour) return `hace ${Math.floor(diff / minute)} min`;
  if (diff < day) return `hace ${Math.floor(diff / hour)} h`;
  return `hace ${Math.floor(diff / day)} d`;
}

export function compactId(id = '') {
  const value = String(id);
  if (value.length <= 18) return value;
  return `${value.slice(0, 9)}…${value.slice(-6)}`;
}
