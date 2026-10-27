// Traduce los mensajes de Hermes (JSONL, API del dashboard o state.db) a elementos de actividad de «En directo».

import type { Server as IOServer } from 'socket.io';
import { describeToolCall, describeResult, clip, type Category } from './actividadHerramientas.js';
import { logger } from '../log.js';

const log = logger('adaptador-eventos');

interface ToolCall {
  id?: string;
  tool_call_id?: string;
  call_id?: string;
  type?: string;
  name?: string;
  tool?: string;
  function?: { name?: string; arguments?: unknown };
  arguments?: unknown;
  input?: unknown;
}

/** Mensaje de Hermes tal cual llega (JSONL, API del dashboard o state.db). */
export interface HermesPayload {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  codex_message_items?: unknown;
  finish_reason?: unknown;
  name?: string;
  tool_name?: string;
  tool_call_id?: string;
  call_id?: string;
  id?: string | number;
  timestamp?: unknown;
  [key: string]: unknown;
}

export interface SessionMessage {
  sessionId: string;
  role?: string;
  timestamp: unknown;
  payload: HermesPayload;
}

export interface ActivityItem {
  id: string;
  sessionId: string;
  /** 'hermes' o el agente delegado que la hizo (id de la delegación o profile:<perfil>). */
  actor: string;
  kind: 'turn' | 'tool' | 'reply';
  category?: Category;
  tool?: string;
  subject: string;
  status: 'running' | 'ok' | 'error';
  at: number;
  endedAt?: number;
  result?: string;
  /** Delegaciones: id con el que aparecerá el agente delegado. */
  agent?: string;
  /** Respuestas: true si cierra el turno (texto sin más llamadas a herramientas). */
  final?: boolean;
}

// Cada elemento dice qué pidió el usuario, qué herramienta usó Hermes y con qué (skill, comando, URL…), cómo
// terminó y qué respondió. Una sola traducción sirve para el directo y para el historial.
const MAIN_ACTOR = 'hermes';
const LINK_WINDOW_MS = 15000;
const PROFILE_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_PENDING = 500;

type Args = Record<string, unknown>;

/** Hora de un mensaje de Hermes en ms (state.db guarda segundos). */
function toMs(value: unknown, fallback = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e11 ? value * 1000 : value;
  if (typeof value === 'string' && value) {
    const n = Number(value);
    if (Number.isFinite(n)) return toMs(n, fallback);
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = parseJson(raw);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

// state.db guarda tool_calls como texto JSON; la API y el JSONL, como array.
function toolCallsOf(payload: HermesPayload): ToolCall[] {
  const direct = parseJsonArray(payload.tool_calls);
  if (direct.length) return direct as ToolCall[];
  return (parseJsonArray(payload.codex_message_items) as ToolCall[]).filter(
    (i) => i.type === 'tool_call' || i.type === 'function_call',
  );
}

function argsOf(tc: ToolCall): Args {
  const raw = tc.function?.arguments ?? tc.arguments ?? tc.input ?? null;
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  return parsed && typeof parsed === 'object' ? (parsed as Args) : {};
}

function callIdOf(tc: ToolCall): string | null {
  return tc.id || tc.tool_call_id || tc.call_id || null;
}

/** Llamadas abiertas por `${sessionId}::${callId}`, para emparejar su resultado. */
export type PendingCalls = Map<string, ActivityItem>;

/**
 * Elementos de actividad de un mensaje. Puro salvo `pending`, que guarda las
 * llamadas abiertas para completarlas cuando llega su resultado.
 */
export function messageActivities(
  sessionId: string,
  payload: HermesPayload,
  pending: PendingCalls,
  actor = MAIN_ACTOR,
): ActivityItem[] {
  const at = toMs(payload.timestamp);
  const msgKey = payload.id ?? at;
  const base = { sessionId, actor, at };
  const text = typeof payload.content === 'string' ? payload.content : '';

  if (payload.role === 'user') {
    return text
      ? [{ ...base, id: `turn:${sessionId}:${msgKey}`, kind: 'turn', subject: clip(text, 200), status: 'ok' }]
      : [];
  }

  if (payload.role === 'assistant') {
    const items: ActivityItem[] = toolCallsOf(payload).map((tc, i) => {
      const callId = callIdOf(tc) || `${msgKey}:${i}`;
      const name = tc.function?.name || tc.name || tc.tool || 'tool';
      const d = describeToolCall(name, argsOf(tc), callId);
      const item: ActivityItem = {
        ...base,
        id: `tool:${sessionId}:${callId}`,
        kind: 'tool',
        status: 'running',
        category: d.category,
        tool: d.tool,
        subject: d.subject,
        ...(d.agent ? { agent: d.agent } : {}),
      };
      pending.set(`${sessionId}::${callId}`, item);
      return item;
    });
    // Texto junto a llamadas es un comentario a mitad de turno; solo, es la respuesta final.
    if (text)
      items.push({
        ...base,
        id: `reply:${sessionId}:${msgKey}`,
        kind: 'reply',
        subject: clip(text, 200),
        status: 'ok',
        final: items.length === 0,
      });
    return items;
  }

  if (payload.role === 'tool' || payload.role === 'tool_response') {
    const callId = payload.tool_call_id || payload.call_id;
    if (!callId) return [];
    const key = `${sessionId}::${callId}`;
    const open = pending.get(key);
    pending.delete(key);
    const { status, result } = describeResult(payload.content);
    if (open) return [{ ...open, status, endedAt: at, result }];
    const d = describeToolCall(payload.tool_name || payload.name || 'tool');
    return [
      {
        ...base,
        id: `tool:${sessionId}:${callId}`,
        kind: 'tool',
        status,
        endedAt: at,
        result,
        category: d.category,
        tool: d.tool,
        subject: d.subject,
      },
    ];
  }

  return [];
}

/** Historial de una sesión: los elementos de sus mensajes, fusionados por id. */
export function buildActivity(sessionId: string, messages: HermesPayload[], limit = 300): ActivityItem[] {
  const pending: PendingCalls = new Map();
  const byId = new Map<string, ActivityItem>();
  for (const msg of messages) {
    for (const item of messageActivities(sessionId, msg, pending)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.at - b.at).slice(-limit);
}

// ─── Directo ────────────────────────────────────────────────────────────────

const livePending: PendingCalls = new Map();
// Sesión hija (subagente) → sesión y actor del padre.
const childSessions = new Map<string, { sessionId: string; actor: string }>();
const knownSessions = new Set<string>();
// Perfil → sesión que lo lanzó con `hermes -p`, para atribuir su actividad.
const profileSessions = new Map<string, { sessionId: string; at: number }>();
let activeSession: string | null = null;

/** Sesión del orquestador con turno en curso (según agent.log). */
export function setActiveSession(sessionId: string | null): void {
  if (sessionId) activeSession = sessionId;
}

/** Sesión a la que atribuir la actividad de un perfil delegado. */
export function sessionForProfile(profile: string): string | null {
  const entry = profileSessions.get(profile);
  if (entry && Date.now() - entry.at < PROFILE_SESSION_TTL_MS) return entry.sessionId;
  return activeSession;
}

// Sesión → sesión padre, según Hermes (parent_session_id de la lista de sesiones).
const sessionParents = new Map<string, string>();

export function setSessionParents(sessions: { id?: unknown; parent_session_id?: unknown }[]): void {
  for (const s of sessions) {
    if (s.id && s.parent_session_id) sessionParents.set(String(s.id), String(s.parent_session_id));
  }
}

function latestDelegation(filter: (item: ActivityItem) => boolean): ActivityItem | null {
  let latest: ActivityItem | null = null;
  for (const item of livePending.values()) {
    if (item.tool === 'delegate_task' && item.agent && filter(item) && (!latest || item.at > latest.at)) latest = item;
  }
  return latest;
}

// ¿Esta sesión es un subagente? Si Hermes dice quién es su padre, se usa su última
// delegación abierta. Si no, solo cuenta como subagente una sesión cuyo primer
// mensaje llega poco después de una delegación (y no una antigua que se ve por
// primera vez al repasar el historial).
function linkChildSession(sessionId: string, firstAt: number): void {
  if (knownSessions.has(sessionId)) return;
  knownSessions.add(sessionId);
  const parentId = sessionParents.get(sessionId);
  const delegation = parentId
    ? latestDelegation((item) => item.sessionId === parentId)
    : latestDelegation(
        (item) => item.sessionId !== sessionId && firstAt >= item.at && firstAt - item.at < LINK_WINDOW_MS,
      );
  if (delegation?.agent) {
    childSessions.set(sessionId, { sessionId: delegation.sessionId, actor: delegation.agent });
    log.debug('subagente enlazado', { sesion: sessionId.slice(0, 12), padre: delegation.sessionId.slice(0, 12) });
  } else if (parentId) {
    childSessions.set(sessionId, { sessionId: parentId, actor: `subagent:${sessionId}` });
  }
}

function noteProfiles(items: ActivityItem[]): void {
  for (const item of items) {
    if (item.agent?.startsWith('profile:') && item.status === 'running') {
      profileSessions.set(item.agent.slice('profile:'.length), { sessionId: item.sessionId, at: Date.now() });
    }
  }
}

/**
 * Sala de Socket.io con quien puede ver la actividad de Hermes (editor o admin): lleva fragmentos de
 * instrucciones y resultados, que pueden traer datos de pliegos y de la empresa.
 */
export const SALA_ACTIVIDAD = 'actividad';

export function adapt(io: IOServer, message: SessionMessage): void {
  const { sessionId, payload } = message;
  linkChildSession(sessionId, toMs(payload.timestamp));
  const parent = childSessions.get(sessionId);
  const outSession = parent?.sessionId || sessionId;
  const actor = parent?.actor || MAIN_ACTOR;

  // El turno del subagente no es un turno de la conversación que se está viendo.
  if (parent && payload.role === 'user') return;
  const items = messageActivities(sessionId, payload, livePending, actor).map((item) =>
    parent ? { ...item, sessionId: outSession } : item,
  );
  noteProfiles(items);
  // Llamadas del historial cuyo resultado nunca llega: se olvidan las más viejas.
  while (livePending.size > MAX_PENDING) livePending.delete(livePending.keys().next().value as string);

  if (!parent && payload.role === 'user') {
    io.to(SALA_ACTIVIDAD).emit('processing_start', {
      sessionId: outSession,
      instruction: typeof payload.content === 'string' ? clip(payload.content, 200) : '',
    });
  }
  for (const item of items) io.to(SALA_ACTIVIDAD).emit('activity', item);
  if (!parent && payload.role === 'assistant' && (payload.finish_reason || payload.content)) {
    io.to(SALA_ACTIVIDAD).emit('processing_stop', { sessionId: outSession });
  }
}
