// Parser puro de una línea del agent.log de Hermes: devuelve una acción normalizada o null si no es relevante.

// Formatos reconocidos (idénticos en el log del orquestador y en el de cada perfil):
//   2026-06-11 14:38:08,515 INFO [<session>] agent.tool_executor: tool search_files completed (0.16s, 87 chars)
//   ...agent.tool_executor: tool terminal failed (1.20s): <error>
//   ...agent.conversation_loop: API call #4: model=gpt-5.5 provider=openai-codex in=16616 out=.. total=..
//   ...agent.conversation_loop: conversation turn: session=.. model=.. msg='<texto>'
//   ...agent.conversation_loop: Turn ended: reason=..
const TS_RE = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;
const SESSION_RE = /\[(\d{8}_\d{6}_[A-Za-z0-9]+)\]/; // p.ej. [20260611_143755_ffcdd1]

interface LogEventBase {
  ts: number;
  session: string | null;
}

export type LogEvent = LogEventBase &
  (
    | { kind: 'turn_start'; instruction: string }
    | { kind: 'tool'; tool: string; duration: string; failed: boolean }
    | { kind: 'api'; call: number; model: string; provider: string; inTok: number; outTok: number; totalTok: number }
    | { kind: 'turn_end' }
  );

export function parseAgentLogLine(line: string): LogEvent | null {
  if (!line || !line.trim()) return null;
  const tsM = line.match(TS_RE);
  const ts = tsM?.[1] ? new Date(tsM[1].replace(' ', 'T')).getTime() : Date.now();
  const session = line.match(SESSION_RE)?.[1] ?? null;

  let m: RegExpMatchArray | null;
  if ((m = line.match(/conversation turn:.*msg='([^']*)/))) {
    return { ts, session, kind: 'turn_start', instruction: m[1] ?? '' };
  }
  if ((m = line.match(/agent\.tool_executor: tool ([\w.-]+) (completed|failed) \(([^)]*)\)/))) {
    return { ts, session, kind: 'tool', tool: m[1] ?? '', duration: m[3] ?? '', failed: m[2] === 'failed' };
  }
  if ((m = line.match(/API call #(\d+): model=([^ ]+) provider=([^ ]+).*in=(\d+) out=(\d+) total=(\d+)/))) {
    return {
      ts,
      session,
      kind: 'api',
      call: Number(m[1]),
      model: m[2] ?? '',
      provider: m[3] ?? '',
      inTok: Number(m[4]),
      outTok: Number(m[5]),
      totalTok: Number(m[6]),
    };
  }
  if (line.includes('Turn ended:')) {
    return { ts, session, kind: 'turn_end' };
  }
  return null;
}
