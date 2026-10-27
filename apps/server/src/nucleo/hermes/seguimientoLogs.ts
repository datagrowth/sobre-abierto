// Sigue el agent.log de cada perfil de Hermes y emite su actividad en vivo (actor `profile:<perfil>`).
import fs from 'node:fs';
import path from 'node:path';
import type { Server as IOServer } from 'socket.io';
import { parseAgentLogLine, type LogEvent } from './lectorLogs.js';
import { profilesDir } from './directorioHermes.js';
import { sessionForProfile, SALA_ACTIVIDAD, type ActivityItem } from './adaptadorEventos.js';
import { categoryOf } from './actividadHerramientas.js';
import { logger } from '../log.js';

const log = logger('seguimiento-logs');

// Se lee el log y no state.db porque la delegación a un perfil es síncrona: state.db solo recibe la
// conversación cuando el trabajo ya terminó. Los elementos salen como `activity`.
const TAIL_MS = Number(process.env.PROFILE_TAIL_MS || 1000);
const RESCAN_MS = Number(process.env.PROFILE_RESCAN_MS || 20000);

interface LogFile {
  logPath: string;
  offset: number;
}

const files = new Map<string, LogFile>(); // perfil -> log y offset
let lastRescan = 0;
let seq = 0;

function rescanProfiles(): void {
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }
  for (const profile of names) {
    if (files.has(profile)) continue;
    const logPath = path.join(profilesDir, profile, 'logs', 'agent.log');
    let offset = 0;
    try {
      offset = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    } catch {
      offset = 0;
    }
    files.set(profile, { logPath, offset });
  }
}

function toActivity(profile: string, ev: LogEvent): ActivityItem | null {
  if (ev.kind !== 'tool') return null;
  const sessionId = sessionForProfile(profile);
  if (!sessionId) return null;
  return {
    id: `profile:${ev.session || profile}:${ev.ts}:${seq++}`,
    sessionId,
    actor: `profile:${profile}`,
    kind: 'tool',
    category: categoryOf(ev.tool),
    tool: ev.tool,
    subject: '',
    status: ev.failed ? 'error' : 'ok',
    at: ev.ts,
    endedAt: ev.ts,
    result: ev.duration,
  };
}

function readProfile(io: IOServer, profile: string, entry: LogFile): void {
  fs.stat(entry.logPath, (err, st) => {
    if (err) return;
    if (st.size < entry.offset) entry.offset = 0; // rotado/truncado
    if (st.size <= entry.offset) return;
    const stream = fs.createReadStream(entry.logPath, { start: entry.offset, end: st.size - 1 });
    let buf = '';
    stream.on('data', (c) => {
      buf += c.toString();
    });
    stream.on('end', () => {
      entry.offset = st.size;
      for (const line of buf.split('\n')) {
        const ev = parseAgentLogLine(line);
        const item = ev && toActivity(profile, ev);
        if (item) io.to(SALA_ACTIVIDAD).emit('activity', item);
      }
    });
    stream.on('error', () => {});
  });
}

function tick(io: IOServer): void {
  const now = Date.now();
  if (now - lastRescan > RESCAN_MS) {
    rescanProfiles();
    lastRescan = now;
  }
  for (const [profile, entry] of files) readProfile(io, profile, entry);
}

export function init(io: IOServer): void {
  rescanProfiles();
  lastRescan = Date.now();
  setInterval(() => tick(io), TAIL_MS);
  log.info('vigilando los logs de los perfiles', { perfiles: files.size });
}
