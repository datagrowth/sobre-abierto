// Raíz de datos de Hermes: HERMES_HOME (en Docker, el volumen del agente) o ~/.hermes.
// Las variables específicas (HERMES_STATE_DB, HERMES_SESSIONS_DIR…) pueden sustituir una ruta suelta.
import path from 'node:path';
import os from 'node:os';

const HERMES_HOME = process.env.HERMES_HOME || path.join(os.homedir(), '.hermes');

function under(envName: string, ...parts: string[]): string {
  return process.env[envName] || path.join(HERMES_HOME, ...parts);
}

export const stateDbPath = under('HERMES_STATE_DB', 'state.db');
export const sessionsDir = under('HERMES_SESSIONS_DIR', 'sessions');
export const logFile = under('HERMES_LOG_FILE', 'logs', 'agent.log');
export const profilesDir = under('HERMES_PROFILES_DIR', 'profiles');
