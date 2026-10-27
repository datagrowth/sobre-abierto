// Logger estructurado: una línea JSON por evento, con nivel y módulo. Nunca
// recibe tokens, contenidos de documentos ni datos personales.
type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, string | number | boolean | null | undefined>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = ORDER[(process.env.LOG_LEVEL as Level) in ORDER ? (process.env.LOG_LEVEL as Level) : 'info'];

function write(level: Level, mod: string, msg: string, fields: Fields): void {
  if (ORDER[level] < MIN || process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, mod, msg, ...fields });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export type Logger = Record<Level, (msg: string, fields?: Fields) => void>;

export function logger(mod: string): Logger {
  return {
    debug: (msg, fields = {}) => write('debug', mod, msg, fields),
    info: (msg, fields = {}) => write('info', mod, msg, fields),
    warn: (msg, fields = {}) => write('warn', mod, msg, fields),
    error: (msg, fields = {}) => write('error', mod, msg, fields),
  };
}
