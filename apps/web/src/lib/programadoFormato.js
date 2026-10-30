// Formato de «Programado» (sin React, con tests): cuándo fue y cuándo toca, en relativo.

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

function cantidad(ms) {
  if (ms < HORA) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < DIA) return `${Math.round(ms / HORA)} h`;
  const d = Math.round(ms / DIA);
  return `${d} ${d === 1 ? 'día' : 'días'}`;
}

/** ISO → «hace 3 min», «dentro de 2 h», «ahora»; «—» sin fecha. */
export function cuando(iso, ahora = Date.now()) {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  const dif = t - ahora;
  if (Math.abs(dif) < 45_000) return 'ahora';
  return dif > 0 ? `dentro de ${cantidad(dif)}` : `hace ${cantidad(-dif)}`;
}

export const ESTADOS_PROGRAMADO = {
  activo: { texto: 'activo', tono: 'exito' },
  parado: { texto: 'parado', tono: 'neutro' },
  frenado: { texto: 'frenado', tono: 'aviso' },
  en_pausa: { texto: 'en pausa', tono: 'aviso' },
};

const TONO_TAREA = { programada: 'exito', 'en pausa': 'neutro', terminada: 'neutro', 'con error': 'error' };

export function tonoTarea(estado) {
  return TONO_TAREA[estado] ?? 'neutro';
}

/** Perfil de Hermes para leer: «principal» → «Hermes (principal)», «licitaciones» → «Hermes (licitaciones)». */
export function nombrePerfil(perfil) {
  return `Hermes (${perfil})`;
}
