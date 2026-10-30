// Lo que comparten los módulos de la cola de IA: la fila del trabajo, el registro de tipos que hace
// cada dominio (a qué perfil va, con qué instrucciones, cómo saber si se hizo) y los avisos de cambio.
import { ahora, type Db } from './db.js';
import { emitir } from './eventos.js';
import { pararRun, type DestinoHermes } from './hermes/runs.js';
import type { OrigenMetricas } from './hermes/metricas.js';
import { logger } from './log.js';

export type EstadoTrabajo = 'pendiente' | 'lanzado' | 'completado' | 'fallido' | 'cancelado';

export type Trabajo = {
  id: number;
  tipo: string;
  dominio: string;
  clave: string;
  payload: string;
  estado: EstadoTrabajo;
  run_id: string | null;
  intentos: number;
  error: string | null;
  proximo_intento_en: string | null;
  creado_en: string;
  actualizado_en: string;
  lanzado_en: string | null;
  metricas: string | null;
  // El código del último fallo o espera (`sin_resultado`, `run_inactivo`, `limite_uso`…).
  codigo: string | null;
  // Lanzamiento del run más antiguo de este trabajo que puede seguir vivo (uno parado sin
  // confirmación, p. ej. al relanzarlo, aún puede guardar): desde ahí pudo leer lo que guardó.
  run_vivo_desde: string | null;
  // 1 si lo pidió una persona en la web; 0 si lo encoló la plataforma.
  a_mano: number;
  // Veces que se relanzó solo por colgado sin gastar intento (tope MAX_RELANZAMIENTOS).
  relanzamientos: number;
};

export type TipoTrabajo = {
  destino: () => DestinoHermes | null;
  // Asíncrona si hay que leer algo (p. ej. los campos de un PDF) antes de componerlas.
  instrucciones: (payload: unknown, trabajo: Trabajo) => string | Promise<string>;
  // ¿El run dejó lo que tenía que dejar? Si no, se reintenta. Recibe el trabajo para poder
  // enlazar el resultado con él (y con sus métricas).
  hecho: (payload: unknown, trabajo: Trabajo) => boolean;
  // Quién ejecuta el run (agente de la auditoría y state.db del perfil), para sus métricas.
  metricas?: OrigenMetricas;
  // Tiempo máximo del run y sin llamar a ninguna herramienta, si el tipo necesita otros que
  // RUN_MAX_MS e INACTIVO_MAX_MS (la memoria entera en un run tarda más de 30 min).
  maxMs?: number;
  inactivoMs?: number;
  // Orden en la cola: el rango menor sale antes (a igualdad, el más antiguo). Sin gancho, el
  // tipo cae en PRIORIDAD_NEUTRA. El núcleo no conoce los dominios: cada uno dice qué urge.
  prioridad?: (payload: unknown, trabajo: Trabajo) => number;
};

export const MAX_INTENTOS = 3;

// Dominios cuyos trabajos leen datos personales (CV): la respuesta de Hermes puede citarlos,
// así que no se guarda en el error, que se ve en la web y en plataforma_estado.
const DOMINIOS_PERSONALES = new Set(['colaboradores']);
export const esDominioPersonal = (dominio: string): boolean => DOMINIOS_PERSONALES.has(dominio);
export const dominiosPersonales = (): string[] => [...DOMINIOS_PERSONALES];
const tipos = new Map<string, TipoTrabajo>();

/** La definición registrada de un tipo, si la hay. */
export const tipoDe = (tipo: string): TipoTrabajo | undefined => tipos.get(tipo);

/** Los tipos registrados, en orden de registro. */
export const tiposRegistrados = (): string[] => [...tipos.keys()];

// Evento que emite cada dominio cuando un trabajo suyo falla, se frena o espera (p. ej.
// «licitacion.trabajo»); sin él, el aviso va como «trabajo.cambio».
const eventosTrabajo = new Map<string, string>();
const EVENTO_GENERICO = 'trabajo.cambio';

const log = logger('trabajos');

// Al log va solo `codigo`; en el trabajo se guardan los dos (`error` para la web, `codigo`
// para contar por qué fallan).
export type Fallo = { codigo: string; error: string; limite?: boolean };

export function fijarEventoTrabajos(dominio: string, tipoEvento: string): void {
  eventosTrabajo.set(dominio, tipoEvento);
}

// El nombre en español de cada trabajo lo da su dominio: la web lo enseña tal cual en los avisos
// y en HermesEnVivo, para que una misma cosa no tenga dos nombres.
const nombresTrabajo = new Map<string, (tipo: string, payload: string) => string>();

export function fijarNombreTrabajos(dominio: string, fn: (tipo: string, payload: string) => string): void {
  nombresTrabajo.set(dominio, fn);
}

/** El nombre en español de un trabajo; sin payload, el del tipo («Memoria: apartados»). */
export const nombreDe = (dominio: string, tipo: string, payload = '{}'): string =>
  nombresTrabajo.get(dominio)?.(tipo, payload) ?? tipo;

type CambioAviso = Partial<Pick<Trabajo, 'codigo' | 'intentos' | 'proximo_intento_en'>>;

/**
 * Avisa de que un trabajo falló, se frenó, espera o se relanzó. Lleva solo ids y contadores:
 * nunca el error ni el payload, que pueden citar datos personales (CV), y en dominios personales
 * tampoco el recurso, cuyo `id` diría de quién es.
 */
export function avisar(
  db: Db,
  t: Trabajo,
  estado: 'fallido' | 'frenado' | 'esperando' | 'relanzado' | 'cancelado',
  cambio: CambioAviso = {},
): void {
  const c = { codigo: t.codigo, intentos: t.intentos, proximo_intento_en: t.proximo_intento_en, ...cambio };
  try {
    emitir(db, {
      tipo: eventosTrabajo.get(t.dominio) ?? EVENTO_GENERICO,
      dominio: t.dominio,
      recurso: DOMINIOS_PERSONALES.has(t.dominio) ? null : (recursoDe(t.payload) ?? null),
      datos: {
        trabajo: t.id,
        tipo: t.tipo,
        estado,
        codigo: c.codigo,
        intentos: c.intentos,
        proximo_intento_en: c.proximo_intento_en,
      },
    });
  } catch (e) {
    // Un aviso que falla no puede romper la cola.
    log.warn('no se pudo emitir el evento del trabajo', { id: t.id, clase: e instanceof Error ? e.name : typeof e });
  }
}

export function registrarTipoTrabajo(tipo: string, def: TipoTrabajo): void {
  tipos.set(tipo, def);
}

export function actualizar(
  db: Db,
  id: number,
  cambios: Partial<
    Pick<
      Trabajo,
      | 'estado'
      | 'run_id'
      | 'intentos'
      | 'error'
      | 'codigo'
      | 'proximo_intento_en'
      | 'lanzado_en'
      | 'metricas'
      | 'run_vivo_desde'
      | 'relanzamientos'
    >
  >,
): void {
  const campos = Object.keys(cambios);
  const sets = campos.map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE trabajos_ia SET ${sets}, actualizado_en = @ts WHERE id = @id`).run({
    ...cambios,
    ts: ahora(),
    id,
  });
}

/** El agente (perfil) que ejecuta un tipo, el de su auditoría; null si no tiene métricas o no está registrado. */
export function agenteDeTipo(tipo: string): string | null {
  return tipos.get(tipo)?.metricas?.agente ?? null;
}

/** El perfil de Hermes al que va ahora un tipo de trabajo; null si no tiene o no está registrado. */
export function destinoDeTipo(tipo: string): DestinoHermes | null {
  return tipos.get(tipo)?.destino() ?? null;
}

/** Los tipos registrados que tienen ahora un perfil de Hermes al que ir (los demás no salen nunca). */
export function tiposConHermes(): string[] {
  return [...tipos.keys()].filter((k) => tipos.get(k)?.destino());
}

/**
 * Para en Hermes el run de un trabajo cancelado en marcha (p. ej. al borrar a una persona).
 * No espera: si Hermes no responde, el resultado que llegue se rechaza igualmente.
 */
export function pararRunDe(tipo: string, runId: string): void {
  const destino = destinoDeTipo(tipo);
  if (!destino) return;
  void pararRun(destino, runId).then((r) => {
    if (r.error) log.warn('no se pudo parar el run', { tipo, codigo: r.error.code });
  });
}

/** El `id` del payload (la licitación o la convocatoria), si lo lleva. */
export function recursoDe(payload: string): string | undefined {
  try {
    const id = (JSON.parse(payload) as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

const MAX_ERROR_LISTADO = 1500;

/** Recorta por el final: lo que explica el fallo suele estar al principio del mensaje. */
export function recortarError(e: string | null, max = MAX_ERROR_LISTADO): string | null {
  return e !== null && e.length > max ? `${e.slice(0, max - 1)}…` : e;
}

export function obtenerTrabajo(db: Db, id: number): Trabajo | null {
  return (db.prepare('SELECT * FROM trabajos_ia WHERE id = ?').get(id) as Trabajo | undefined) ?? null;
}
