// Posición, hora estimada y motivo de espera de un trabajo de la cola.
import type { Db } from './db.js';
import { percentil, percentiles } from './estadistica.js';
import { esperaHerramienta, pausaHastaMs } from './colaEsperas.js';
import { frenadoHasta } from './colaFrenos.js';
import { aplicarCupos, MAX_PENDIENTES_VUELTA, motivoLimitador, porPrioridad } from './colaOrden.js';
import { destinoDeTipo, esDominioPersonal, recortarError, type Trabajo } from './colaTipos.js';

// La hora sale de lo que tardaron los completados de cada tipo la última semana: un intervalo del percentil 5 al
// 95. Calibrado con una semana de producción (tests/nucleo/colaEtaCalibracion.test.ts), del 10 al 90 dejaba
// dentro el 83 % de los trabajos, al filo del 80 % exigido; del 5 al 95, el 88 %. Es orientativo: los runs en
// paralelo hacen que la suma de medianas sobreestime la espera.
export type DuracionTipo = { n: number; p5: number; p50: number; p90: number; p95: number };

type MotivoEspera =
  | 'pausa_limite'
  | 'freno'
  | 'espera_herramienta'
  | 'reintento'
  | 'tope_oferta'
  | 'plazo_cercano'
  | 'sin_perfil'
  | 'cola';

export type Eta = { desde: string; hasta: string; mediana_min: number };

export type DetalleTrabajo = {
  posicion: number | null;
  eta: Eta | null;
  mas_de_lo_normal: boolean;
  motivo_espera: MotivoEspera | null;
  intentos: number;
  proximo_intento_en: string | null;
  codigo: string | null;
  error: string | null;
};

export type ContextoEta = {
  ahoraMs: number;
  runsALaVez: number;
  orden: Trabajo[];
  duraciones: Map<string, DuracionTipo>;
  pausaMs: number;
};

// Con menos completados, un percentil 90 de 3 runs no dice nada: mejor sin hora que una falsa.
export const MIN_MUESTRAS = 5;
// La web pregunta en cada carga: recalcular los percentiles o el orden (cada pendiente pasa por
// el gancho de prioridad de su tipo) en cada petición cuesta más que la precisión que da.
const MEMO_MS = 60_000;
const DIA_MS = 86_400_000;
const MIN_MS = 60_000;
// La espera por herramientas desfasadas la marca la cola al llegarle el turno: es la misma espera.
const CODIGOS_HERRAMIENTA = new Set(['sin_herramienta', 'herramientas_desfasadas']);

const memoDuraciones = new WeakMap<Db, { en: number; dias: number; mapa: Map<string, DuracionTipo> }>();
const memoOrden = new WeakMap<Db, { en: number; firma: string; orden: Trabajo[] }>();

const vigente = (en: number, ahoraMs: number): boolean => Math.abs(ahoraMs - en) < MEMO_MS;

function duracionDe(minutos: number[]): DuracionTipo {
  const ordenados = [...minutos].sort((a, b) => a - b);
  const p = percentiles(ordenados);
  return {
    n: minutos.length,
    p5: percentil(ordenados, 0.05) ?? 0,
    p50: p.p50 ?? 0,
    p90: p.p90 ?? 0,
    p95: percentil(ordenados, 0.95) ?? 0,
  };
}

function minutosPorTipo(db: Db, desdeIso: string): Map<string, number[]> {
  const filas = db
    .prepare(
      `SELECT tipo, lanzado_en, actualizado_en FROM trabajos_ia
    WHERE estado = 'completado' AND lanzado_en IS NOT NULL AND actualizado_en >= ?`,
    )
    .all(desdeIso) as { tipo: string; lanzado_en: string; actualizado_en: string }[];
  const out = new Map<string, number[]>();
  for (const f of filas) {
    const min = (Date.parse(f.actualizado_en) - Date.parse(f.lanzado_en)) / MIN_MS;
    if (Number.isFinite(min) && min >= 0) out.set(f.tipo, [...(out.get(f.tipo) ?? []), min]);
  }
  return out;
}

/** Duración en minutos (p5, p50, p90, p95) de los completados de cada tipo; sin el tipo si tiene menos de MIN_MUESTRAS. */
export function duracionesPorTipo(db: Db, ahoraMs: number, dias = 7): Map<string, DuracionTipo> {
  const m = memoDuraciones.get(db);
  if (m && m.dias === dias && vigente(m.en, ahoraMs)) return m.mapa;
  const mapa = new Map<string, DuracionTipo>();
  for (const [tipo, minutos] of minutosPorTipo(db, new Date(ahoraMs - dias * DIA_MS).toISOString())) {
    if (minutos.length >= MIN_MUESTRAS) mapa.set(tipo, duracionDe(minutos));
  }
  memoDuraciones.set(db, { en: ahoraMs, dias, mapa });
  return mapa;
}

// Cambia en cuanto entra, sale o se toca un pendiente: así la memo no da posiciones viejas.
function firmaPendientes(db: Db): string {
  const f = db
    .prepare(
      "SELECT COUNT(*) AS n, MAX(id) AS id, MAX(actualizado_en) AS en FROM trabajos_ia WHERE estado = 'pendiente'",
    )
    .get() as { n: number; id: number | null; en: string | null };
  return `${f.n}|${f.id}|${f.en}`;
}

/**
 * Si vueltaCola se saltaría ahora el pendiente (desfase, espera de herramienta, freno o limitador):
 * no ocupa sitio delante de nadie. Freno y herramienta, una vez por tipo y oferta. Lo que no tiene
 * perfil de Hermes se deja: es un fallo de configuración que motivo_espera ya dice (sin_perfil).
 */
function retenidoDe(db: Db, ahoraMs: number): (t: Trabajo) => boolean {
  const frenos = new Map<string, boolean>();
  return (t) => {
    if (t.codigo === 'herramientas_desfasadas') return true;
    const clave = `${t.tipo}
${recursoDe(t) ?? ''}`;
    if (!frenos.has(clave))
      frenos.set(
        clave,
        esperaHerramienta(db, t.tipo) !== null || frenadoHasta(db, t.tipo, ahoraMs, recursoDe(t)) !== null,
      );
    return frenos.get(clave)! || motivoLimitador(t) !== null;
  };
}

/**
 * Los pendientes que pueden salir ya, en el orden en que los sacaría la cola (prioridad y cupos),
 * sin los que se saltaría: el orden real, para que la posición no cuente lo que no va a salir.
 */
function ordenPendientes(db: Db, ahoraMs: number): Trabajo[] {
  const firma = firmaPendientes(db);
  const m = memoOrden.get(db);
  if (m && m.firma === firma && vigente(m.en, ahoraMs)) return m.orden;
  const listos = db
    .prepare(
      `SELECT * FROM trabajos_ia WHERE estado = 'pendiente'
    AND (proximo_intento_en IS NULL OR proximo_intento_en <= ?) ORDER BY id LIMIT ?`,
    )
    .all(new Date(ahoraMs).toISOString(), MAX_PENDIENTES_VUELTA) as Trabajo[];
  const retenido = retenidoDe(db, ahoraMs);
  const orden = aplicarCupos(db, porPrioridad(listos)).filter((t) => !retenido(t));
  memoOrden.set(db, { en: ahoraMs, firma, orden });
  return orden;
}

/** Lo que hace falta para detallar varios trabajos de una vez sin recalcular la cola por cada uno. */
export function contextoEta(db: Db, ahoraMs: number, runsALaVez: number): ContextoEta {
  return {
    ahoraMs,
    runsALaVez: Math.max(1, runsALaVez),
    orden: ordenPendientes(db, ahoraMs),
    duraciones: duracionesPorTipo(db, ahoraMs),
    pausaMs: pausaHastaMs(db, ahoraMs),
  };
}

function recursoDe(t: Trabajo): string | undefined {
  try {
    const id = (JSON.parse(t.payload) as { id?: unknown } | null)?.id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

const enFuturo = (iso: string | null, ahoraMs: number): boolean => iso !== null && Date.parse(iso) > ahoraMs;

// Del más general al más concreto: lo que para toda la cola explica la espera antes que lo propio.
function motivoEspera(db: Db, t: Trabajo, ctx: ContextoEta): MotivoEspera {
  if (ctx.pausaMs > ctx.ahoraMs) return 'pausa_limite';
  if (CODIGOS_HERRAMIENTA.has(t.codigo ?? '') || esperaHerramienta(db, t.tipo)) return 'espera_herramienta';
  if (frenadoHasta(db, t.tipo, ctx.ahoraMs, recursoDe(t)) !== null) return 'freno';
  if (!destinoDeTipo(t.tipo)) return 'sin_perfil';
  if (enFuturo(t.proximo_intento_en, ctx.ahoraMs)) return 'reintento';
  const limite = motivoLimitador(t);
  return limite === 'tope_oferta' || limite === 'plazo_cercano' ? limite : 'cola';
}

function eta(inicioMs: number, d: DuracionTipo): Eta {
  return {
    desde: new Date(inicioMs + d.p5 * MIN_MS).toISOString(),
    hasta: new Date(inicioMs + d.p95 * MIN_MS).toISOString(),
    mediana_min: d.p50,
  };
}

// Lo que va delante se reparte entre los runs a la vez; un tipo sin muestras no suma.
function inicioPendiente(t: Trabajo, indice: number, ctx: ContextoEta): number {
  const base = Math.max(ctx.ahoraMs, ctx.pausaMs, t.proximo_intento_en ? Date.parse(t.proximo_intento_en) || 0 : 0);
  const delante = ctx.orden
    .slice(0, Math.max(0, indice))
    .reduce((s, o) => s + (ctx.duraciones.get(o.tipo)?.p50 ?? 0), 0);
  return base + (delante / ctx.runsALaVez) * MIN_MS;
}

function posicionYEta(
  t: Trabajo,
  d: DuracionTipo | undefined,
  ctx: ContextoEta,
): Pick<DetalleTrabajo, 'posicion' | 'eta' | 'mas_de_lo_normal'> {
  if (t.estado === 'lanzado') {
    const lanzado = t.lanzado_en ? Date.parse(t.lanzado_en) : NaN;
    if (!d || !Number.isFinite(lanzado)) return { posicion: 0, eta: null, mas_de_lo_normal: false };
    // Con el mismo límite que eta.hasta: dentro de lo estimado nunca es «más de lo normal».
    return { posicion: 0, eta: eta(lanzado, d), mas_de_lo_normal: ctx.ahoraMs > lanzado + d.p95 * MIN_MS };
  }
  const i = ctx.orden.findIndex((o) => o.id === t.id);
  // Fuera del orden (freno, tope de la oferta, plazo, herramienta) la cola no lo lanzará: sin hora,
  // salvo que espere un reintento con hora conocida.
  const conHora = i >= 0 || enFuturo(t.proximo_intento_en, ctx.ahoraMs);
  return {
    posicion: i >= 0 ? i + 1 : null,
    eta: d && conHora ? eta(inicioPendiente(t, i, ctx), d) : null,
    mas_de_lo_normal: false,
  };
}

const VIVOS = new Set(['pendiente', 'lanzado']);

/** Posición en la cola, hora estimada, motivo de la espera e intentos de un trabajo. */
export function detalleTrabajo(db: Db, t: Trabajo, ctx: ContextoEta): DetalleTrabajo {
  const vivo = VIVOS.has(t.estado);
  const pos = vivo
    ? posicionYEta(t, ctx.duraciones.get(t.tipo), ctx)
    : { posicion: null, eta: null, mas_de_lo_normal: false };
  return {
    ...pos,
    motivo_espera: t.estado === 'pendiente' ? motivoEspera(db, t, ctx) : null,
    intentos: t.intentos,
    proximo_intento_en: t.proximo_intento_en,
    codigo: t.codigo,
    // Los datos personales (CV) pueden salir en la respuesta de Hermes que guarda el error.
    error: esDominioPersonal(t.dominio) ? null : recortarError(t.error, 300),
  };
}
