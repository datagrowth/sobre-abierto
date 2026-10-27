// Hora local de España: la PLACSP publica los plazos en hora peninsular y se guardan así, sin zona.

// Ejemplo: «AAAA-MM-DDT08:00:00». Compararlos con toISOString() (UTC) corre el corte una o dos horas, y
// Date.parse de una fecha sin zona depende de la TZ del proceso. Con la zona fija en el formateador, el
// resultado no depende de cómo se arranque el proceso.
const ZONA = 'Europe/Madrid';

const FORMATO = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** El instante `ms` (por defecto, ahora) en hora local de Europe/Madrid: «AAAA-MM-DDTHH:MM:SS». */
export function horaLocalEspana(ms = Date.now()): string {
  const p = Object.fromEntries(FORMATO.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p['year']}-${p['month']}-${p['day']}T${p['hour']}:${p['minute']}:${p['second']}`;
}

const HORA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * El instante (ms) de una hora local de España sin zona («2026-10-15T08:00:00», como guarda
 * los plazos de la PLACSP), con el desfase de Europe/Madrid de ese día y no con la TZ del
 * proceso: para contar cuánto queda hasta un plazo. null si no es una fecha con hora.
 */
export function instanteDeHoraEspana(local: string): number | null {
  const m = HORA_LOCAL.exec(local);
  if (!m) return null;
  const comoUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  const desfase = (ms: number) => Date.parse(`${horaLocalEspana(ms)}Z`) - ms;
  // El desfase se mide otra vez en el instante aproximado: el día del cambio de hora, el de la
  // hora buscada puede no ser el de la misma hora en UTC.
  return comoUtc - desfase(comoUtc - desfase(comoUtc));
}

/**
 * Una hora local de España sin zona en ISO con su desfase de ese día («2026-10-15T08:00:00» →
 * «2026-10-15T08:00:00+02:00»): para un agente, que si no la leería como UTC o con su zona.
 * null si no es una fecha con hora.
 */
export function isoConZonaEspana(local: string): string | null {
  const instante = instanteDeHoraEspana(local);
  if (instante === null) return null;
  const minutos = Math.round((Date.parse(`${horaLocalEspana(instante)}Z`) - instante) / 60_000);
  const abs = Math.abs(minutos);
  const zona = `${minutos < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${horaLocalEspana(instante)}${zona}`;
}

// Las zonas de España: la peninsular (la de la PLACSP, también Baleares, Ceuta y Melilla) y la de
// Canarias, que va siempre una hora por detrás. La de la empresa sale de su perfil.
export const ZONAS_HORARIAS = ['Europe/Madrid', 'Atlantic/Canary'] as const;
export type ZonaHoraria = (typeof ZONAS_HORARIAS)[number];
export const ZONA_PENINSULAR: ZonaHoraria = 'Europe/Madrid';
export const HORA_DE: Record<ZonaHoraria, string> = {
  'Europe/Madrid': 'hora peninsular',
  'Atlantic/Canary': 'hora de Canarias',
};

const PARTES_LOCALES: Record<ZonaHoraria, Intl.DateTimeFormat> = Object.fromEntries(
  ZONAS_HORARIAS.map((z) => [
    z,
    new Intl.DateTimeFormat('en-CA', {
      timeZone: z,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }),
  ]),
) as Record<ZonaHoraria, Intl.DateTimeFormat>;
const DIAS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/**
 * El instante en la hora de la empresa (los avisos que van «a las 8:00»): el día (AAAA-MM-DD), el día
 * de la semana (1 lunes … 7 domingo), la hora (0-23) y la semana ISO («2026-W43»).
 */
export function enHoraLocal(
  ms: number,
  zona: ZonaHoraria,
): { fecha: string; dia: number; hora: number; semana: string } {
  const p = Object.fromEntries(PARTES_LOCALES[zona].formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const fecha = `${p['year']}-${p['month']}-${p['day']}`;
  const dia = DIAS[p['weekday'] ?? ''] ?? 1;
  // Semana ISO: la del jueves de esta semana.
  const jueves = new Date(Date.parse(`${fecha}T00:00:00Z`) + (4 - dia) * 86_400_000);
  const enero = Date.UTC(jueves.getUTCFullYear(), 0, 1);
  const n = Math.ceil(((jueves.getTime() - enero) / 86_400_000 + 1) / 7);
  return {
    fecha,
    dia,
    hora: Number(p['hour']) % 24,
    semana: `${jueves.getUTCFullYear()}-W${String(n).padStart(2, '0')}`,
  };
}
