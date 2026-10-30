// Lo programado: los automatismos de la plataforma y las tareas de cron de cada perfil de Hermes.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { errorMessage } from './result.js';

// Cada dominio registra los suyos con su última y próxima vez. Las tareas de cron se leen de los archivos
// `<HERMES_HOME>/cron/jobs.json` y `<HERMES_HOME>/profiles/<perfil>/cron/jobs.json`.
type EstadoProgramado = 'activo' | 'parado' | 'frenado' | 'en_pausa';

// accion: lo que la web puede lanzar a mano desde la fila («sync», «cribar»), si algo.
export type Automatismo = {
  id: string;
  dominio: string;
  nombre: string;
  que_hace: string;
  cada: string;
  ultima: string | null;
  proxima: string | null;
  estado: EstadoProgramado;
  detalle: string | null;
  accion: string | null;
};

type TareaHermes = {
  perfil: string;
  id: string;
  nombre: string;
  que_hace: string | null;
  cuando: string;
  estado: string;
  proxima: string | null;
  ultima: string | null;
  ultimo_resultado: string | null;
  ultimo_error: string | null;
  entrega: string | null;
};

export type CronPerfil = { perfil: string; tareas: TareaHermes[]; error: string | null };

const proveedores = new Map<string, () => Automatismo>();
const vueltas = new Map<string, string>();

export function registrarProgramado(id: string, fn: () => Automatismo): void {
  proveedores.set(id, fn);
}

/** Anota que un bucle acaba de dar una vuelta (en memoria: tras reiniciar, hasta la siguiente). */
export function marcarVuelta(id: string, cuando = new Date()): void {
  vueltas.set(id, cuando.toISOString());
}

export function ultimaVuelta(id: string): string | null {
  return vueltas.get(id) ?? null;
}

/** Próxima vez de algo que corre cada `ms`: tras la última, o ya si nunca corrió. */
export function siguiente(ultima: string | null, ms: number, ahora = new Date()): string {
  const t = ultima ? Date.parse(ultima) + ms : ahora.getTime();
  return new Date(Math.max(t, ahora.getTime())).toISOString();
}

export function automatismos(): Automatismo[] {
  return [...proveedores.entries()].map(([id, fn]) => {
    try {
      return fn();
    } catch (err) {
      return {
        id,
        dominio: '',
        nombre: id,
        que_hace: '',
        cada: '',
        ultima: null,
        proxima: null,
        estado: 'parado' as const,
        detalle: `No se pudo leer: ${errorMessage(err)}`,
        accion: null,
      };
    }
  });
}

// El archivo es de Hermes y puede cambiar de versión: solo se exige lo que se enseña y
// el resto se ignora. Un trabajo que no encaja no tumba a los demás.
const Texto = z.string().nullish().catch(null);
const Trabajo = z
  .object({
    id: z.string(),
    name: Texto,
    prompt: Texto,
    schedule_display: Texto,
    schedule: z.object({ display: Texto, expr: Texto }).loose().nullish().catch(null),
    enabled: z.boolean().nullish().catch(null),
    state: Texto,
    next_run_at: Texto,
    last_run_at: Texto,
    last_status: Texto,
    last_error: Texto,
    deliver: z
      .union([z.string(), z.array(z.string())])
      .nullish()
      .catch(null),
    paused_at: Texto,
  })
  .loose();
const ArchivoCron = z.object({ jobs: z.array(z.unknown()) }).loose();

const recorte = (t: string | null | undefined, max: number) =>
  t ? t.replace(/\s+/g, ' ').trim().slice(0, max) || null : null;

function estadoTarea(t: z.infer<typeof Trabajo>): string {
  if (t.state === 'paused' || t.paused_at || t.enabled === false) return 'en pausa';
  if (t.state === 'completed') return 'terminada';
  if (t.state === 'error' || t.last_status === 'error') return 'con error';
  return 'programada';
}

function aTarea(perfil: string, t: z.infer<typeof Trabajo>): TareaHermes {
  return {
    perfil,
    id: t.id,
    nombre: t.name || recorte(t.prompt, 60) || t.id,
    que_hace: recorte(t.prompt, 300),
    cuando: t.schedule_display || t.schedule?.display || t.schedule?.expr || '—',
    estado: estadoTarea(t),
    proxima: t.next_run_at ?? null,
    ultima: t.last_run_at ?? null,
    ultimo_resultado: t.last_status ?? null,
    ultimo_error: recorte(t.last_error, 300),
    entrega: Array.isArray(t.deliver) ? t.deliver.join(', ') : (t.deliver ?? null),
  };
}

function leerCronPerfil(perfil: string, archivo: string): CronPerfil {
  if (!fs.existsSync(archivo)) return { perfil, tareas: [], error: null };
  try {
    const crudo = ArchivoCron.safeParse(JSON.parse(fs.readFileSync(archivo, 'utf8')));
    if (!crudo.success)
      return { perfil, tareas: [], error: 'El archivo de tareas de Hermes no tiene el formato esperado.' };
    const tareas = crudo.data.jobs
      .map((j) => Trabajo.safeParse(j))
      .filter((r) => r.success)
      .map((r) => aTarea(perfil, r.data));
    return { perfil, tareas, error: null };
  } catch (err) {
    return { perfil, tareas: [], error: `No se pudo leer el archivo de tareas: ${errorMessage(err)}` };
  }
}

/** Tareas de cron del perfil principal y de cada perfil de Hermes. */
export function cronHermes(hermesHome: string): CronPerfil[] {
  const perfiles = path.join(hermesHome, 'profiles');
  const nombres = fs.existsSync(perfiles)
    ? fs
        .readdirSync(perfiles, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];
  return [
    leerCronPerfil('principal', path.join(hermesHome, 'cron', 'jobs.json')),
    ...nombres.map((n) => leerCronPerfil(n, path.join(perfiles, n, 'cron', 'jobs.json'))),
  ];
}
