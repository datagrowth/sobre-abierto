// Observa las sesiones de Hermes (archivos, logs y base de estado) y emite su actividad por Socket.io.
import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import type { Server as IOServer } from 'socket.io';
import { hermesFetch } from './clienteHermes.js';
import * as eventAdapter from './adaptadorEventos.js';
import type { ActivityItem, HermesPayload, SessionMessage } from './adaptadorEventos.js';
import { sessionsDir, logFile, profilesDir } from './directorioHermes.js';
import { query as queryStateDb, queryEn, type Row } from './baseEstado.js';
import { parseAgentLogLine } from './lectorLogs.js';
import { logger } from '../log.js';

const log = logger('observador-hermes');

const POLL_INTERVAL_MS = Number(process.env.HERMES_POLL_MS || 5000);
const MAX_POLLED_SESSIONS = Number(process.env.HERMES_MAX_POLLED_SESSIONS || 5);
const MAX_INITIAL_MESSAGES = Number(process.env.HERMES_MAX_INITIAL_MESSAGES || 80);
const LOG_TAIL_INTERVAL_MS = Number(process.env.HERMES_LOG_TAIL_MS || 1000);
// Sesiones recientes de cada perfil (licitaciones, oferta-licitaciones…): sus runs de la cola
// de IA no pasan por la state.db principal.
const SESIONES_POR_PERFIL = Number(process.env.HERMES_SESIONES_POR_PERFIL || 30);

type Session = Row & { id?: unknown; is_active?: unknown; source?: unknown; profile?: string; ended_at?: unknown };

// De qué perfil es cada sesión que no está en la state.db principal.
const perfilDeSesion = new Map<string, string>();

// In-memory caches (lightweight)
const state = {
  sessions: [] as Session[],
  lastError: null as string | null,
  // Per-session offset tracking for tail of legacy JSONL files
  fileOffsets: new Map<string, number>(), // path -> byte offset
  // Per-session message id tracking for the dashboard/state.db API
  seenMessageIds: new Map<string, Set<unknown>>(), // session id -> Set(message id)
  sessionMessages: new Map<string, HermesPayload[]>(), // session id -> recent normalized messages
  logOffset: 0,
  logReading: false,
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const COLUMNAS_SESION = `
      id, source, user_id, model, model_config, system_prompt,
      parent_session_id, started_at, ended_at, end_reason,
      message_count, tool_call_count, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, reasoning_tokens,
      billing_provider, billing_base_url, billing_mode,
      estimated_cost_usd, actual_cost_usd, cost_status, cost_source,
      pricing_version, title, api_call_count, handoff_state,
      handoff_platform, handoff_error`;

function loadLocalSessions(): Session[] {
  return queryStateDb(`SELECT ${COLUMNAS_SESION} FROM sessions ORDER BY started_at DESC`).map(sanitizeSession);
}

const rutaPerfil = (perfil: string) => path.join(profilesDir, perfil, 'state.db');

function perfilesConSesiones(): string[] {
  try {
    return fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^[a-z0-9][a-z0-9_-]*$/.test(d.name) && fs.existsSync(rutaPerfil(d.name)))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** Las sesiones recientes de cada perfil, con `profile` para que la web diga de quién son. */
function loadProfileSessions(): Session[] {
  return perfilesConSesiones().flatMap((perfil) =>
    queryEn(rutaPerfil(perfil), `SELECT ${COLUMNAS_SESION} FROM sessions ORDER BY started_at DESC LIMIT ?`, [
      SESIONES_POR_PERFIL,
    ]).map((s) => {
      perfilDeSesion.set(String(s['id']), perfil);
      return { ...sanitizeSession(s), profile: perfil };
    }),
  );
}

function loadLocalSessionMessages(sessionId: string): HermesPayload[] {
  const perfil = perfilDeSesion.get(sessionId);
  const consultar = perfil ? (sql: string, params: string[]) => queryEn(rutaPerfil(perfil), sql, params) : queryStateDb;
  return consultar(
    `
    SELECT
      id, session_id, role, content, tool_call_id, tool_calls, tool_name,
      timestamp, token_count, finish_reason, reasoning, reasoning_content,
      reasoning_details, codex_reasoning_items, codex_message_items,
      platform_message_id, observed
    FROM messages
    WHERE session_id = ?
    ORDER BY id ASC
  `,
    [sessionId],
  ) as HermesPayload[];
}

// El prompt de sistema y la config del modelo no salen del servidor.
function sanitizeSession(session: Session): Session {
  const { system_prompt: _prompt, model_config: _config, ...safe } = session;
  return safe;
}

function normalizeDashboardMessage(sessionId: string, msg: HermesPayload): SessionMessage {
  return {
    sessionId,
    role: msg.role,
    timestamp:
      typeof msg.timestamp === 'number'
        ? new Date(msg.timestamp * 1000).toISOString()
        : msg.timestamp || new Date().toISOString(),
    payload: { ...msg, timestamp: msg.timestamp, name: msg.tool_name || msg.name },
  };
}

function safeJsonParse(line: string): HermesPayload | null {
  try {
    return JSON.parse(line) as HermesPayload;
  } catch {
    return null;
  }
}

// Al navegador solo llega la actividad ya resumida y redactada, nunca el mensaje en crudo.
function emitMessage(io: IOServer, msg: SessionMessage): void {
  try {
    eventAdapter.adapt(io, msg);
  } catch (e) {
    log.error('error al adaptar un evento', { error: errorMessage(e) });
  }
}

// Reads new lines appended to a JSONL since the last offset and emits them
function tailJsonl(filePath: string, io: IOServer): void {
  fs.stat(filePath, (err, stat) => {
    if (err) return;
    const lastOffset = state.fileOffsets.get(filePath) || 0;
    if (stat.size <= lastOffset) return;

    const stream = fs.createReadStream(filePath, { start: lastOffset, end: stat.size - 1 });
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
    });
    stream.on('end', () => {
      const lines = buffer.split('\n');
      const sessionId = path.basename(filePath, '.jsonl');
      // El último elemento es una línea a medias o el '' tras el último \n: nunca
      // cuenta, para que el offset quede justo tras la última línea completa.
      let consumed = 0;
      lines.forEach((line, i) => {
        if (i === lines.length - 1) return;
        consumed += Buffer.byteLength(line, 'utf8') + 1; // +1 for \n
        const ev = line.trim() ? safeJsonParse(line) : null;
        if (!ev) return;
        emitMessage(io, { sessionId, role: ev.role, timestamp: ev.timestamp || new Date().toISOString(), payload: ev });
      });
      state.fileOffsets.set(filePath, lastOffset + consumed);
    });
    stream.on('error', (e) =>
      log.error('error al leer una sesión', { archivo: path.basename(filePath), error: e.message }),
    );
  });
}

// agent.log solo marca inicio y fin de turno (el directo sale de los mensajes, que
// traen los argumentos). La etiqueta [sesión] de la línea dice de qué conversación es.
function emitLogLine(io: IOServer, line: string): void {
  const ev = parseAgentLogLine(line);
  if (!ev || !ev.session) return;
  if (ev.kind === 'turn_start') {
    eventAdapter.setActiveSession(ev.session);
    io.to(eventAdapter.SALA_ACTIVIDAD).emit('processing_start', {
      sessionId: ev.session,
      instruction: ev.instruction.slice(0, 200),
    });
  } else if (ev.kind === 'turn_end') {
    io.to(eventAdapter.SALA_ACTIVIDAD).emit('processing_stop', { sessionId: ev.session });
  }
}

function tailAgentLog(io: IOServer): void {
  if (!fs.existsSync(logFile)) return;
  if (state.logReading) return; // evita que dos polls solapados lean lo mismo
  fs.stat(logFile, (err, stat) => {
    if (err) return;
    if (stat.size < state.logOffset) state.logOffset = 0; // rotado/truncado → desde el inicio
    if (stat.size <= state.logOffset) return;
    state.logReading = true;
    const stream = fs.createReadStream(logFile, { start: state.logOffset, end: stat.size - 1 });
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
    });
    stream.on('end', () => {
      state.logOffset = stat.size;
      state.logReading = false;
      buffer
        .split('\n')
        .filter(Boolean)
        .forEach((line) => emitLogLine(io, line));
    });
    stream.on('error', (e) => {
      state.logReading = false;
      log.error('error al leer el log del agente', { error: e.message });
    });
  });
}

function initLogWatcher(io: IOServer): void {
  if (!fs.existsSync(logFile)) {
    log.warn('no existe el log del agente', { archivo: logFile });
    return;
  }
  // Empezamos al final del archivo: solo emitimos actividad *nueva* a partir de ahora.
  try {
    state.logOffset = fs.statSync(logFile).size;
  } catch {
    state.logOffset = 0;
  }

  // OJO: chokidar con awaitWriteFinish NO detecta los appends de un log que se
  // escribe constantemente (el archivo "nunca se estabiliza" y el evento 'change'
  // no dispara), así que los nodos no se iluminaban. Se usa un tail por polling,
  // que es fiable para logs append-only.
  setInterval(() => tailAgentLog(io), LOG_TAIL_INTERVAL_MS);
  log.info('siguiendo el log del agente', { archivo: logFile, cada_ms: LOG_TAIL_INTERVAL_MS });
}

export function initWatcher(io: IOServer): void {
  if (!fs.existsSync(sessionsDir)) {
    log.warn('no existe la carpeta de sesiones', { carpeta: sessionsDir });
    return;
  }

  // Seed offsets at end-of-file so we only emit *new* activity going forward
  for (const f of fs.readdirSync(sessionsDir).filter((name) => name.endsWith('.jsonl'))) {
    const full = path.join(sessionsDir, f);
    try {
      state.fileOffsets.set(full, fs.statSync(full).size);
    } catch {
      /* borrado entre readdir y stat */
    }
  }

  // chokidar 4+ no admite comodines: se vigila la carpeta y se ignora lo que no es .jsonl.
  const watcher = chokidar.watch(sessionsDir, {
    depth: 0,
    ignored: (ruta, stats) => Boolean(stats?.isFile()) && !ruta.endsWith('.jsonl'),
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  });

  watcher.on('add', (file) => {
    log.debug('sesión nueva', { archivo: path.basename(file) });
    state.fileOffsets.set(file, 0);
    tailJsonl(file, io);
  });
  watcher.on('change', (file) => {
    log.debug('sesión modificada', { archivo: path.basename(file) });
    tailJsonl(file, io);
  });
  watcher.on('ready', () => log.debug('observador de sesiones listo'));
  watcher.on('error', (err) => log.error('error del observador de sesiones', { error: errorMessage(err) }));

  log.info('vigilando las sesiones', { carpeta: sessionsDir });
  initLogWatcher(io);
}

// Prefer active/runtime sessions first (where live Telegram work happens),
// then fill the remaining budget with newest sessions.
function prioritize(sessions: Session[]): Session[] {
  const all = sessions.filter((s) => s && s.id);
  const prioritized: Session[] = [];
  const pushUnique = (s: Session) => {
    if (prioritized.some((x) => String(x.id) === String(s.id))) return;
    prioritized.push(s);
  };
  all.filter((s) => s.is_active || (s.profile && !s.ended_at)).forEach(pushUnique);
  all.filter((s) => s.source === 'telegram').forEach(pushUnique);
  all.forEach(pushUnique);
  return prioritized.slice(0, MAX_POLLED_SESSIONS);
}

async function fetchMessages(sessionId: string): Promise<HermesPayload[]> {
  // Las de un perfil no están en la API del panel (que es la del perfil principal).
  if (perfilDeSesion.has(sessionId)) return loadLocalSessionMessages(sessionId);
  try {
    const data = (await hermesFetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages`)) as {
      messages?: unknown;
    } | null;
    const messages = Array.isArray(data?.messages) ? (data.messages as HermesPayload[]) : [];
    return messages.length ? messages : loadLocalSessionMessages(sessionId);
  } catch {
    return loadLocalSessionMessages(sessionId);
  }
}

async function pollSessionMessages(io: IOServer, sessions: Session[]): Promise<void> {
  for (const session of prioritize(sessions)) {
    const sessionId = String(session.id);
    const messages = await fetchMessages(sessionId);

    const seen = state.seenMessageIds.get(sessionId) ?? new Set<unknown>();
    state.seenMessageIds.set(sessionId, seen);
    const cached = state.sessionMessages.get(sessionId) || [];
    const isFirstPoll = seen.size === 0;
    const firstEmitted = Math.max(0, messages.length - MAX_INITIAL_MESSAGES);
    const toEmit: SessionMessage[] = [];

    messages.forEach((msg, index) => {
      const key = msg.id ?? `${msg.role}:${msg.timestamp}:${String(msg.content || '').slice(0, 80)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const normalized = normalizeDashboardMessage(sessionId, msg);
      cached.push(normalized.payload);
      if (!isFirstPoll || index >= firstEmitted) toEmit.push(normalized);
    });

    state.sessionMessages.set(sessionId, cached.slice(-500));
    for (const msg of toEmit) emitMessage(io, msg);
  }
}

async function pollOnce(io: IOServer): Promise<void> {
  let sessions: Session[];
  try {
    const value = (await hermesFetch('/api/sessions')) as { sessions?: unknown } | unknown[] | null;
    const raw = Array.isArray(value) ? value : (value as { sessions?: unknown } | null)?.sessions;
    sessions = (Array.isArray(raw) ? (raw as Session[]) : []).map(sanitizeSession);
  } catch {
    sessions = loadLocalSessions();
  }
  sessions = [...sessions, ...loadProfileSessions()];
  state.lastError = null;

  // Emit always — frontend can dedupe
  state.sessions = sessions;
  eventAdapter.setSessionParents(sessions);
  io.to(eventAdapter.SALA_ACTIVIDAD).emit('hermes_sessions', sessions);
  try {
    await pollSessionMessages(io, sessions);
  } catch (e) {
    state.lastError = errorMessage(e);
    log.error('error al consultar a Hermes', { error: state.lastError });
  }
}

export function startPolling(io: IOServer): void {
  void pollOnce(io);
  setInterval(() => void pollOnce(io), POLL_INTERVAL_MS);
  log.info('consulta periódica a Hermes', { cada_ms: POLL_INTERVAL_MS });
}

export function getState(): { sessions: Session[]; lastError: string | null } {
  return { sessions: state.sessions, lastError: state.lastError };
}

function readSessionMessages(sessionId: string): HermesPayload[] | null {
  const cached = state.sessionMessages.get(sessionId);
  if (cached) return cached;
  const file = path.join(sessionsDir, `${sessionId}.jsonl`);
  if (fs.existsSync(file)) {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map(safeJsonParse)
      .filter((m): m is HermesPayload => m !== null);
  }
  return loadLocalSessionMessages(sessionId);
}

/** Actividad ya ocurrida en una sesión (para ver el historial al elegirla). */
export function readSessionActivity(sessionId: string, limit?: number): ActivityItem[] {
  return eventAdapter.buildActivity(sessionId, readSessionMessages(sessionId) || [], limit);
}
