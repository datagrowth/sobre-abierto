// Resume cada llamada a herramienta de Hermes en una línea (categoría y sujeto) para el gráfico de actividad.
// Todo lo que sale va al navegador: se recorta y se enmascaran secretos, y nunca se envían contenidos de archivos.

export type Category =
  'skills' | 'mcp' | 'web' | 'browser' | 'terminal' | 'code' | 'files' | 'memory' | 'delegation' | 'other';

export interface ToolDescription {
  category: Category;
  tool: string;
  subject: string;
  /** Para delegaciones: id con el que se verá al agente delegado (satélite). */
  agent?: string;
}

type Args = Record<string, unknown>;

const MAX_SUBJECT = 120;
// Lo que se mira de cada argumento. Hermes manda comandos y resultados de cualquier
// tamaño, y algunas regex de aquí (secretos, perfil de la CLI) son cuadráticas: sin
// recortar antes, un argumento de unos cientos de KB deja el servidor parado.
const MAX_ENTRADA = 8 * 1024;
const FALLBACK_KEYS = ['query', 'text', 'command', 'path', 'name', 'prompt', 'code', 'goal'];

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '$1-•••'],
  [/\b(ghp|gho|ghs|github_pat|xox[abp]|AIza|GOCSPX)[A-Za-z0-9_-]{6,}/g, '$1•••'],
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '$1 •••'],
  [/(--?(?:token|password|passwd|secret|api-?key|key)[ =])("[^"]*"|'[^']*'|\S+)/gi, '$1•••'],
  [/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g, '$1=•••'],
  [/(:\/\/[^:/\s]+:)[^@/\s]+@/g, '$1•••@'],
];

const SEPARADORES = new Set([' ', '\t', '\n', '\r', '"', "'", ',', ';', '(', ')', '[', ']', '{', '}', '<', '>']);

// Recorta a MAX_ENTRADA sin dejar a medias la última palabra: un secreto cortado
// podría no reconocerse como tal y salir en claro.
function acotado(text: string): string {
  if (text.length <= MAX_ENTRADA) return text;
  let fin = MAX_ENTRADA;
  while (fin > 0 && !SEPARADORES.has(text.charAt(fin))) fin--;
  return text.slice(0, fin);
}

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [re, rep]) => acc.replace(re, rep), acotado(text));
}

/** Una línea, sin secretos, como mucho `max` caracteres. */
export function clip(value: unknown, max = MAX_SUBJECT): string {
  if (value == null) return '';
  const text = redact(String(value).replace(/\s+/g, ' ').trim());
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function str(args: Args, key: string): string {
  const v = args[key];
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v) && v.length && typeof v[0] === 'string') return v[0];
  return '';
}

function firstOf<T = Args>(value: unknown): T | undefined {
  return Array.isArray(value) && value.length ? (value[0] as T) : undefined;
}

function plusMore(value: unknown): string {
  return Array.isArray(value) && value.length > 1 ? ` (+${value.length - 1})` : '';
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

// `patch` en modo V4A no trae `path`: los archivos van dentro del parche
// («*** Update File: …»). Solo se sacan sus rutas, nunca el contenido.
function patchTarget(args: Args): string {
  const direct = str(args, 'path');
  if (direct) return direct;
  const files = [...str(args, 'patch').matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) =>
    m[1]!.trim(),
  );
  if (files.length === 0) return '';
  return files.length > 1 ? `${files[0]} (+${files.length - 1})` : files[0]!;
}

function firstLine(code: string): string {
  const lines = code
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.find((l) => l.startsWith('#'))?.replace(/^#+\s*/, '') || lines[0] || '';
}

// hermes -p <perfil> chat -q "<consulta>": delegación a un perfil por la CLI.
const PROFILE_CLI_RE = /\bhermes\b[^\n]*?(?:-p|--profile)\s+["']?([A-Za-z0-9_-]+)["']?/;
const PROFILE_QUERY_RE = /(?:-q|--query)\s+(?:"([^"]*)"|'([^']*)'|(\S+))/;

function describeTerminal(args: Args): ToolDescription {
  const command = acotado(str(args, 'command') || str(args, 'cmd'));
  const profile = command.match(PROFILE_CLI_RE)?.[1];
  if (profile && /\b(chat|-q|--query)\b/.test(command)) {
    const q = command.match(PROFILE_QUERY_RE);
    const query = q?.[1] ?? q?.[2] ?? q?.[3] ?? '';
    return {
      category: 'delegation',
      tool: 'terminal',
      agent: `profile:${profile}`,
      subject: clip(query ? `Perfil ${profile}: ${query}` : `Perfil ${profile}`),
    };
  }
  return { category: 'terminal', tool: 'terminal', subject: clip(command) };
}

function describeDelegate(args: Args, callId: string): ToolDescription {
  const action = str(args, 'action');
  if (action && action !== 'spawn') {
    return {
      category: 'delegation',
      tool: 'delegate_task',
      subject: clip(`${action} ${str(args, 'subagent_id')}`.trim()),
    };
  }
  const task = firstOf(args.tasks);
  const goal =
    (task && typeof task.goal === 'string' ? task.goal : '') || str(args, 'goal') || str(args, 'task') || 'Subagente';
  return {
    category: 'delegation',
    tool: 'delegate_task',
    agent: callId,
    subject: clip(`${goal}${plusMore(args.tasks)}`),
  };
}

// Nombres con prefijo: mcp__<servidor>__<tool>, connectors__<app>__<tool>.
function describePrefixed(name: string): ToolDescription | null {
  const [prefix, owner, ...rest] = name.split('__');
  if (!owner || !rest.length) return null;
  if (prefix === 'mcp') return { category: 'mcp', tool: name, subject: clip(`${owner} · ${rest.join('__')}`) };
  if (prefix === 'connectors') return { category: 'mcp', tool: name, subject: clip(`${owner} · ${rest.join('__')}`) };
  return null;
}

type Describer = (args: Args) => [Category, string];

const DESCRIBERS: Record<string, Describer> = {
  skill_view: (a) => ['skills', [str(a, 'name'), str(a, 'file_path')].filter(Boolean).join(' → ')],
  skills_list: (a) => ['skills', str(a, 'category') ? `listar ${str(a, 'category')}` : 'listar'],
  skill_manage: (a) => {
    const op = firstOf(a.operations);
    const action = (op && typeof op.action === 'string' ? op.action : '') || str(a, 'action');
    const name = (op && typeof op.name === 'string' ? op.name : '') || str(a, 'name');
    return ['skills', `${[action, name].filter(Boolean).join(' ')}${plusMore(a.operations)}`];
  },
  web_search: (a) => ['web', str(a, 'query')],
  web_extract: (a) => ['web', `${str(a, 'urls')}${plusMore(a.urls)}`],
  x_search: (a) => ['web', `X: ${str(a, 'query')}`],
  browser_navigate: (a) => ['browser', str(a, 'url')],
  browser_click: (a) => ['browser', `clic ${str(a, 'ref')}`],
  browser_type: (a) => ['browser', `escribir en ${str(a, 'ref')}`],
  browser_scroll: (a) => ['browser', `scroll ${str(a, 'direction')}`],
  browser_press: (a) => ['browser', `tecla ${str(a, 'key')}`],
  browser_vision: (a) => ['browser', `visión: ${str(a, 'question')}`],
  browser_cdp: (a) => ['browser', `CDP ${str(a, 'method')}`],
  browser_dialog: (a) => ['browser', `diálogo ${str(a, 'action')}`],
  browser_exec: (a) => ['browser', firstLine(str(a, 'code'))],
  execute_code: (a) => ['code', firstLine(str(a, 'code'))],
  process_manage: (a) => ['terminal', `proceso ${str(a, 'action')} ${str(a, 'session_id')}`],
  read_file: (a) => ['files', `leer ${basename(str(a, 'path'))}`],
  write_file: (a) => ['files', `escribir ${str(a, 'path')}`],
  patch: (a) => ['files', `editar ${patchTarget(a)}`.trim()],
  search_files: (a) => ['files', `buscar ${str(a, 'pattern')}${str(a, 'path') ? ` en ${str(a, 'path')}` : ''}`],
  memory: (a) => ['memory', `${str(a, 'action') || 'leer'} (${str(a, 'target') || 'memory'})`],
  session_search: (a) => ['memory', `recordar ${str(a, 'query')}`],
  cronjob_manage: (a) => ['other', `cron ${str(a, 'action')} ${str(a, 'name') || str(a, 'job_id')}`],
  vision_analyze: (a) => ['other', `visión: ${str(a, 'question')}`],
  video_analyze: (a) => ['other', `vídeo: ${str(a, 'question')}`],
  image_generate: (a) => ['other', `imagen: ${str(a, 'prompt')}`],
  video_generate: (a) => ['other', `vídeo: ${str(a, 'prompt')}`],
  text_to_speech: (a) => ['other', `voz: ${str(a, 'text')}`],
  clarify: (a) => {
    const q = firstOf(a.questions);
    return ['other', `pregunta: ${(q && typeof q.question === 'string' ? q.question : '') || str(a, 'question')}`];
  },
  todo_list: (a) => ['other', Array.isArray(a.todos) ? `tareas: ${a.todos.length}` : 'tareas'],
  tool_search: (a) => ['other', `buscar tools: ${str(a, 'queries')}`],
  computer_use: (a) => ['browser', `escritorio: ${str(a, 'action')}`],
};

function fallbackSubject(args: Args): string {
  for (const key of FALLBACK_KEYS) {
    const value = str(args, key);
    if (value) return key === 'code' ? firstLine(value) : value;
  }
  return '';
}

export function describeToolCall(rawName: string, args: Args = {}, callId = ''): ToolDescription {
  const name = rawName || 'tool';
  const lower = name.toLowerCase();
  if (lower === 'terminal' || lower === 'bash' || lower === 'shell') return describeTerminal(args);
  if (lower === 'delegate_task' || lower.endsWith('.delegate_task')) return describeDelegate(args, callId);
  if (lower === 'tool_call') {
    const inner = firstOf(args.calls);
    if (inner && typeof inner.name === 'string') {
      const innerArgs = (inner.arguments && typeof inner.arguments === 'object' ? inner.arguments : {}) as Args;
      return describeToolCall(inner.name, innerArgs, callId);
    }
  }
  const prefixed = describePrefixed(name);
  if (prefixed) return prefixed;
  const describer = DESCRIBERS[lower];
  if (describer) {
    const [category, subject] = describer(args);
    return { category, tool: name, subject: clip(subject) };
  }
  const category: Category = lower.startsWith('browser_') ? 'browser' : 'other';
  return { category, tool: name, subject: clip(fallbackSubject(args)) };
}

/** Categoría sin argumentos (logs de perfil, que solo traen el nombre). */
export function categoryOf(name: string): Category {
  return describeToolCall(name).category;
}

// ─── Resultados ─────────────────────────────────────────────────────────────

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type ResultStatus = 'ok' | 'error';

function delegateSummary(results: { status?: unknown; summary?: string; error?: string }[]): {
  status: ResultStatus;
  text: string;
} {
  const failed = results.some(
    (r) => r.status && !['completed', 'success', 'done', 'ok'].includes(String(r.status).toLowerCase()),
  );
  const text = results
    .map((r) => r.summary || r.error || '')
    .filter(Boolean)
    .join(' · ');
  return { status: failed ? 'error' : 'ok', text };
}

/**
 * Resultado de una herramienta: si falló y un resumen corto. Hermes devuelve
 * texto o JSON ({error}, {success:false}, {output}, {results:[…]} en delegaciones).
 */
export function describeResult(content: unknown): { status: ResultStatus; result: string } {
  const raw = typeof content === 'string' ? content : content == null ? '' : JSON.stringify(content);
  const obj = (typeof content === 'object' && content !== null ? content : parseJson(raw)) as Record<
    string,
    unknown
  > | null;
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    if (Array.isArray(obj.results)) {
      const { status, text } = delegateSummary(obj.results as never[]);
      return { status, result: clip(text, 200) };
    }
    const failed = Boolean(obj.error) || obj.success === false || String(obj.status || '').toLowerCase() === 'error';
    const text = failed
      ? (obj.error ?? obj.message ?? raw)
      : (obj.output ?? obj.result ?? obj.summary ?? obj.message ?? raw);
    return {
      status: failed ? 'error' : 'ok',
      result: clip(typeof text === 'string' ? text : JSON.stringify(text), 200),
    };
  }
  const failed = /^\s*(error|traceback|exception)\b/i.test(raw);
  return { status: failed ? 'error' : 'ok', result: clip(raw, 200) };
}
