// Lo que la pestaña «En directo» deriva de la lista de actividad: sin React,
// para poder probarlo. Un elemento es el evento `activity` del servidor:
// { id, sessionId, actor, kind: turn|tool|reply, category, tool, subject,
//   status: running|ok|error, at, endedAt?, result?, agent? }

export const MAIN_ACTOR = 'hermes';
// Una capacidad sigue encendida un rato tras terminar, para que se vea.
const ACTIVE_LINGER_MS = 4000;
const ERROR_LINGER_MS = 15000;
const SATELLITE_LINGER_MS = 20000;
const SATELLITE_IDLE_MS = 60000;

function sortByTime(items) {
  return [...items].sort((a, b) => a.at - b.at);
}

function endOf(item) {
  return item.endedAt || item.at;
}

/** Estado de cada capacidad: último uso, si está en marcha, si falló y cuántas veces se usó. */
export function capabilityStates(items, now) {
  const states = {};
  for (const item of sortByTime(items)) {
    if (item.kind !== 'tool' || !item.category) continue;
    const st = states[item.category] || { count: 0, last: null };
    st.count += 1;
    st.last = item;
    states[item.category] = st;
  }
  for (const st of Object.values(states)) {
    const { last } = st;
    st.active = last.status === 'running' || now - endOf(last) < ACTIVE_LINGER_MS;
    st.error = last.status === 'error' && now - endOf(last) < ERROR_LINGER_MS;
  }
  return states;
}

function actorLabel(actor) {
  if (actor.startsWith('profile:')) return `Perfil ${actor.slice('profile:'.length)}`;
  return 'Subagente';
}

/**
 * Agentes delegados que se ven como satélites: las delegaciones de Hermes
 * (mientras corren y un rato después) y cualquier otro actor con actividad
 * reciente, con su última acción.
 */
export function satellites(items, now) {
  const byAgent = new Map();
  for (const item of sortByTime(items)) {
    if (item.kind === 'tool' && item.category === 'delegation' && item.actor === MAIN_ACTOR) {
      const key = item.agent || item.id;
      byAgent.set(key, {
        ...(byAgent.get(key) || {}),
        id: key,
        label: item.subject || 'Subagente',
        status: item.status,
        since: item.at,
        endedAt: item.endedAt,
      });
    } else if (item.actor && item.actor !== MAIN_ACTOR && item.kind === 'tool') {
      const prev = byAgent.get(item.actor) || {
        id: item.actor,
        label: actorLabel(item.actor),
        status: 'running',
        since: item.at,
      };
      byAgent.set(item.actor, { ...prev, lastAction: item });
    }
  }
  return [...byAgent.values()].filter((sat) => {
    if (sat.status === 'running')
      return !sat.lastAction || now - endOf(sat.lastAction) < SATELLITE_IDLE_MS || now - sat.since < SATELLITE_IDLE_MS;
    return now - (sat.endedAt || endOf(sat.lastAction || { at: sat.since })) < SATELLITE_LINGER_MS;
  });
}

// Un turno sin respuesta final y sin movimiento durante este rato se da por
// cortado; una herramienta "en marcha" tan antigua, también.
const STALE_TURN_MS = 15 * 60 * 1000;
const STALE_TOOL_MS = 30 * 60 * 1000;
// Margen entre el reloj del navegador (processing_start) y el de Hermes.
const CLOCK_SKEW_MS = 5000;

/**
 * Qué hace Hermes ahora, a partir de su actividad (no depende solo de los avisos
 * de inicio y fin de turno, que pueden perderse o llegar antes que los mensajes):
 * - 'tool': alguna herramienta en marcha (`current`, la más reciente);
 * - 'thinking': turno abierto sin herramienta en marcha (esperando al modelo);
 * - 'idle': sin nada abierto; `endedAt` es cuándo terminó.
 * `since` es cuándo empezó el turno en curso.
 */
export function agentState(items, now, { executing = false, executingSince = 0 } = {}) {
  const sorted = sortByTime(items);
  const turn = sorted.filter((i) => i.kind === 'turn').pop();
  const afterTurn = turn ? sorted.filter((i) => i.at >= turn.at && i !== turn) : [];
  const finalReply = afterTurn.filter((i) => i.kind === 'reply' && i.final && i.actor === MAIN_ACTOR).pop();
  const lastAt = sorted.reduce((max, i) => Math.max(max, endOf(i)), 0);
  const running = sorted.filter((i) => i.kind === 'tool' && i.status === 'running' && now - i.at < STALE_TOOL_MS);

  const openTurn = Boolean(turn) && !finalReply && now - lastAt < STALE_TURN_MS;
  const flagged = executing && !(finalReply && finalReply.at >= executingSince - CLOCK_SKEW_MS);
  if (running.length === 0 && !openTurn && !flagged) {
    return { phase: 'idle', current: null, since: null, endedAt: finalReply?.at ?? (lastAt || null) };
  }
  const current = running[running.length - 1] || null;
  // Si el aviso de inicio llegó antes que el mensaje nuevo, el turno cuenta desde el aviso.
  const turnStart = turn?.at ?? current?.at ?? now;
  const since = flagged && executingSince > turnStart + CLOCK_SKEW_MS ? executingSince : turnStart;
  return { phase: current ? 'tool' : 'thinking', current, since, endedAt: null };
}

/** «hace 3 min», «hace 2 h»… para mostrar cuándo terminó. */
export function formatAgo(ms, now) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'hace unos segundos';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

/** Tiempo transcurrido compacto: «45 s», «3 min 05 s», «1 h 02 min». */
export function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min`;
}

/**
 * Actividad agrupada por turno (lo que pidió el usuario y lo que hizo Hermes
 * después). Grupos del más reciente al más antiguo; dentro, en orden.
 */
export function groupByTurn(items) {
  const groups = [];
  let current = null;
  for (const item of sortByTime(items)) {
    if (item.kind === 'turn') {
      current = { turn: item, items: [] };
      groups.push(current);
    } else {
      if (!current) {
        current = { turn: null, items: [] };
        groups.push(current);
      }
      current.items.push(item);
    }
  }
  return groups.reverse();
}

export function formatDuration(item) {
  if (!item.endedAt || item.endedAt < item.at) return '';
  const ms = item.endedAt - item.at;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}
