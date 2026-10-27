// En qué orden salen los pendientes de la cola y cuáles retiene su dominio: la prioridad que da
// cada dominio, los cupos por tipo y los limitadores (p. ej. el tope de runs por oferta).
import type { Db } from './db.js';
import { recursoDe, tipoDe, tiposRegistrados, type TipoTrabajo, type Trabajo } from './colaTipos.js';
import { logger } from './log.js';

const log = logger('trabajos');

// Rango de lo que no define prioridad: detrás de lo urgente de licitaciones y delante de su fondo.
const PRIORIDAD_NEUTRA = 1_500_000;
// Techo de pendientes que se ordenan en cada vuelta (cada uno pasa por el gancho de su tipo).
export const MAX_PENDIENTES_VUELTA = 2000;

// Ganchos de prioridad fijados por un dominio, aparte de la definición del tipo: así sobreviven
// a que el tipo se registre (o se vuelva a registrar) después de fijarlos.
const prioridades = new Map<string, NonNullable<TipoTrabajo['prioridad']>>();
// Cupos por tipo («1 de cada N lanzamientos»): un tipo de fondo urgente para alguien (la ficha
// de lo nuevo) no se queda sin hueco mientras haya trabajo de oferta delante. `entra` dice qué
// pendientes del tipo pueden usar el cupo (p. ej. no la regeneración masiva de fichas, que va al final).
type Cupo = { cada: number; entra: (t: Trabajo) => boolean };
const cupos = new Map<string, Cupo>();
// Limitadores por dominio: dicen por qué un pendiente no debe salir aún (p. ej. su oferta ya
// gastó los runs del día) sin tocar su fila, para que salga solo en cuanto deje de estarlo.
export type Limitador = (t: Trabajo) => string | null;
const limitadores = new Map<string, Limitador>();
/** Motivo del limitador de licitaciones: la oferta llegó al tope de runs automáticos del día. */
export const MOTIVO_TOPE = 'tope_oferta';

/** Fija el gancho de prioridad de un tipo (un dominio lo reparte entre varios); vale aunque el tipo se registre después. */
export function fijarPrioridad(tipo: string, prioridad: NonNullable<TipoTrabajo['prioridad']>): void {
  // Un tipo desconocido casi siempre es un nombre mal escrito o un orden de arranque roto: sin
  // aviso, la cola volvería a FIFO sin que nada fallara.
  if (!tipoDe(tipo)) log.warn('prioridad fijada a un tipo de trabajo sin registrar', { tipo });
  prioridades.set(tipo, prioridad);
}

/**
 * Reserva a un tipo 1 de cada `cada` lanzamientos (cada ≥ 2), aunque haya trabajo más urgente;
 * solo a sus pendientes que cumplan `entra` (todos, por omisión).
 */
export function fijarCupo(tipo: string, cada: number, entra: (t: Trabajo) => boolean = () => true): void {
  if (!Number.isInteger(cada) || cada < 2) {
    log.warn('cupo de cola no válido: se ignora', { tipo, cada });
    return;
  }
  cupos.set(tipo, { cada, entra });
}

/** Fija el limitador de un dominio: si devuelve un motivo, sus pendientes no salen en esa vuelta. */
export function fijarLimitador(dominio: string, fn: Limitador): void {
  limitadores.set(dominio, fn);
}

/** Los tipos registrados con ese prefijo que no tienen gancho de prioridad (caen en PRIORIDAD_NEUTRA). */
export function tiposSinPrioridad(prefijo: string): string[] {
  return tiposRegistrados().filter((t) => t.startsWith(prefijo) && !prioridades.has(t) && !tipoDe(t)?.prioridad);
}

// Un gancho que falla (payload raro, base cerrada) deja ese trabajo en neutro: no para la cola.
function rangoDe(t: Trabajo): number {
  const gancho = prioridades.get(t.tipo) ?? tipoDe(t.tipo)?.prioridad;
  if (!gancho) return PRIORIDAD_NEUTRA;
  try {
    const r = gancho(JSON.parse(t.payload) as unknown, t);
    return Number.isFinite(r) ? r : PRIORIDAD_NEUTRA;
  } catch (e) {
    log.warn('prioridad fallida: el trabajo cae en neutro', {
      tipo: t.tipo,
      id: t.id,
      error: e instanceof Error ? e.message : String(e),
    });
    return PRIORIDAD_NEUTRA;
  }
}

export function porPrioridad(pendientes: Trabajo[]): Trabajo[] {
  const rangos = new Map(pendientes.map((t) => [t.id, rangoDe(t)] as const));
  return [...pendientes].sort((a, b) => rangos.get(a.id)! - rangos.get(b.id)! || a.id - b.id);
}

// Se calcula de los lanzamientos guardados, así que sobrevive a un reinicio. Con menos de
// `cada - 1` lanzamientos en el historial no cambia nada: sin historia no hay deuda que saldar.
export function aplicarCupos(db: Db, ordenados: Trabajo[]): Trabajo[] {
  let out = ordenados;
  for (const [tipo, { cada, entra }] of cupos) {
    const ultimos = db
      .prepare('SELECT tipo FROM trabajos_ia WHERE lanzado_en IS NOT NULL ORDER BY lanzado_en DESC, id DESC LIMIT ?')
      .all(cada - 1) as { tipo: string }[];
    if (ultimos.length < cada - 1 || ultimos.some((u) => u.tipo === tipo)) continue;
    const i = out.findIndex((t) => t.tipo === tipo && entra(t));
    if (i > 0) out = [out[i]!, ...out.slice(0, i), ...out.slice(i + 1)];
  }
  return out;
}

// Un limitador que falla deja salir el trabajo: un tope roto no puede parar la cola entera.
function motivoDe(fn: Limitador, t: Trabajo): string | null {
  try {
    return fn(t);
  } catch (e) {
    log.warn('limitador fallido: el trabajo sale', {
      dominio: t.dominio,
      id: t.id,
      clase: e instanceof Error ? e.name : typeof e,
    });
    return null;
  }
}

/** Por qué el limitador de su dominio retiene ahora un pendiente (p. ej. MOTIVO_TOPE); null si no lo retiene. */
export function motivoLimitador(t: Trabajo): string | null {
  const fn = limitadores.get(t.dominio);
  return fn ? motivoDe(fn, t) : null;
}

export type LimiteVuelta = { limitado: (t: Trabajo) => boolean; lanzado: (t: Trabajo) => void };

const recursoLimite = (t: Trabajo): string => `${t.dominio}
${recursoDe(t.payload) ?? `#${t.id}`}`;

/**
 * Si el limitador de su dominio retiene un pendiente en esta vuelta. Se calcula una vez por
 * oferta, tipo (las lecciones esperan al plazo y lo demás no) y origen (a mano o no): con cientos
 * de pendientes de una oferta, un solo recuento. Cada lanzamiento borra lo de su oferta, que ya
 * gastó un run más: con un hueco del tope y dos libres no salen dos de la misma.
 */
export function limiteDeVuelta(): LimiteVuelta {
  const cache = new Map<string, Map<string, string | null>>();
  return {
    limitado: (t) => {
      const fn = limitadores.get(t.dominio);
      if (!fn) return false;
      const deOferta = cache.get(recursoLimite(t)) ?? new Map<string, string | null>();
      cache.set(recursoLimite(t), deOferta);
      const clave = `${t.tipo}
${t.a_mano}`;
      if (!deOferta.has(clave)) deOferta.set(clave, motivoDe(fn, t));
      return deOferta.get(clave) !== null;
    },
    lanzado: (t) => {
      cache.delete(recursoLimite(t));
    },
  };
}
