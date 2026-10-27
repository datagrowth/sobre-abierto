// Cifras de la cola para operar: cómo acabaron los trabajos por tipo y por qué fallaron, lo que
// tarda cada tipo y lo que hay por oferta o lleva horas sin salir.
import type { Db } from './db.js';
import {
  CODIGO_DESFASE,
  CODIGO_HERRAMIENTA,
  CODIGO_LIMITE,
  ESPERA_DESFASE,
  ESPERA_HERRAMIENTA,
  ESPERA_LIMITE,
  LIMITE_EN_ERROR,
} from './colaEsperas.js';
import { CODIGO_RELANZADO, RELANZADO, SIN_LANZAR, ZOMBI_MS } from './colaRelanzado.js';
import { dominiosPersonales, esDominioPersonal, recortarError, type EstadoTrabajo } from './colaTipos.js';

export function contarPorEstado(db: Db, desdeIso?: string): Record<string, number> {
  const donde = desdeIso ? 'WHERE actualizado_en >= ?' : '';
  const filas = db
    .prepare(`SELECT estado, COUNT(*) AS n FROM trabajos_ia ${donde} GROUP BY estado`)
    .all(...(desdeIso ? [desdeIso] : [])) as { estado: string; n: number }[];
  return Object.fromEntries(filas.map((f) => [f.estado, f.n]));
}

const DIA_MS = 86_400_000;
export const DIAS_ESTADISTICA = 7;
// Antes de que un pendiente pase a zombi, Estado ya enseña con «Cancelar» lo que lleva horas sin salir.
const SIN_SALIR_MS = 6 * 3_600_000;
const MAX_POR_OFERTA = 50;
const MAX_FALLOS_RECIENTES = 20;
const iso = (ms: number): string => new Date(ms).toISOString();
const personales = (): string => JSON.stringify(dominiosPersonales());

type PorOferta = { dominio: string; recurso: string; pendientes: number; en_marcha: number; fallidos: number };

// Sin los dominios con datos personales: su `id` diría de quién son.
function trabajosPorOferta(db: Db, desde: string): PorOferta[] {
  return db
    .prepare(
      `SELECT dominio, json_extract(payload, '$.id') AS recurso,
      SUM(estado = 'pendiente') AS pendientes, SUM(estado = 'lanzado') AS en_marcha, SUM(estado = 'fallido') AS fallidos
    FROM trabajos_ia WHERE (estado IN ('pendiente', 'lanzado') OR (estado = 'fallido' AND actualizado_en >= @desde))
      AND json_type(payload, '$.id') = 'text' AND dominio NOT IN (SELECT value FROM json_each(@personales))
    GROUP BY dominio, recurso ORDER BY en_marcha DESC, pendientes DESC, fallidos DESC, recurso LIMIT @max`,
    )
    .all({ desde, personales: personales(), max: MAX_POR_OFERTA }) as PorOferta[];
}

type FalloReciente = {
  id: number;
  tipo: string;
  dominio: string;
  recurso: string | null;
  codigo: string | null;
  error: string | null;
  en: string;
};

function fallosRecientes(db: Db, desde: string): FalloReciente[] {
  const filas = db
    .prepare(
      `SELECT id, tipo, dominio, json_extract(payload, '$.id') AS recurso, codigo, error, actualizado_en AS en
    FROM trabajos_ia WHERE estado = 'fallido' AND actualizado_en >= ? ORDER BY actualizado_en DESC, id DESC LIMIT ?`,
    )
    .all(desde, MAX_FALLOS_RECIENTES) as (Omit<FalloReciente, 'recurso'> & { recurso: unknown })[];
  return filas.map((f) => ({
    ...f,
    recurso: typeof f.recurso === 'string' && !esDominioPersonal(f.dominio) ? f.recurso : null,
    error: recortarError(f.error),
  }));
}

type SinSalir = {
  id: number;
  tipo: string;
  dominio: string;
  recurso: string | null;
  creado_en: string;
  zombi_en: string;
};

function sinSalir(db: Db, ahoraMs: number): SinSalir[] {
  const filas = db
    .prepare(
      `SELECT id, tipo, dominio, json_extract(payload, '$.id') AS recurso, creado_en FROM trabajos_ia
    WHERE ${SIN_LANZAR} ORDER BY id LIMIT @max`,
    )
    .all({ limite: iso(ahoraMs - SIN_SALIR_MS), max: MAX_POR_OFERTA }) as (Omit<SinSalir, 'recurso' | 'zombi_en'> & {
    recurso: unknown;
  })[];
  return filas.map((f) => ({
    ...f,
    recurso: typeof f.recurso === 'string' && !esDominioPersonal(f.dominio) ? f.recurso : null,
    zombi_en: iso(Date.parse(f.creado_en) + ZOMBI_MS),
  }));
}

export type OperacionCola = {
  por_estado_7_dias: Record<string, number>;
  por_oferta: PorOferta[];
  fallos_recientes: FalloReciente[];
  sin_salir: SinSalir[];
};

/** Lo de Ajustes › Estado para operar: estados y fallos de 7 días, trabajos por oferta y lo que no sale. */
export function operacionCola(db: Db, ahoraMs = Date.now()): OperacionCola {
  const desde = iso(ahoraMs - DIAS_ESTADISTICA * DIA_MS);
  return {
    por_estado_7_dias: contarPorEstado(db, desde),
    por_oferta: trabajosPorOferta(db, desde),
    fallos_recientes: fallosRecientes(db, desde),
    sin_salir: sinSalir(db, ahoraMs),
  };
}

export type EstadisticaTipo = {
  tipo: string;
  completados: number;
  fallidos: number;
  cancelados: number;
  en_curso: number;
  // Fallidos entre terminados (completados + fallidos); null si no terminó ninguno.
  tasa_fallo: number | null;
  fallos_por_codigo: Record<string, number>;
  // Pendientes que esperan por algo (límite de uso, herramienta, herramientas desfasadas…), por código.
  esperas_por_codigo: Record<string, number>;
};

const CAMPO_ESTADO: Record<EstadoTrabajo, 'completados' | 'fallidos' | 'cancelados' | 'en_curso'> = {
  completado: 'completados',
  fallido: 'fallidos',
  cancelado: 'cancelados',
  pendiente: 'en_curso',
  lanzado: 'en_curso',
};

function sumar(e: EstadisticaTipo, f: { estado: EstadoTrabajo; codigo: string | null; n: number }): void {
  const campo = CAMPO_ESTADO[f.estado];
  if (!campo) return;
  e[campo] += f.n;
  if (f.estado === 'pendiente' && f.codigo)
    e.esperas_por_codigo[f.codigo] = (e.esperas_por_codigo[f.codigo] ?? 0) + f.n;
  if (f.estado !== 'fallido') return;
  const codigo = f.codigo ?? 'sin_codigo';
  e.fallos_por_codigo[codigo] = (e.fallos_por_codigo[codigo] ?? 0) + f.n;
}

/**
 * Cómo acabaron, por tipo, los trabajos que se movieron en los últimos días y por qué
 * fallaron: con cientos de fallidos, leer los mensajes uno a uno no dice qué arreglar.
 */
export function estadisticasCola(
  db: Db,
  dias = DIAS_ESTADISTICA,
  ahoraMs = Date.now(),
): { desde: string; por_tipo: EstadisticaTipo[] } {
  const desde = new Date(ahoraMs - dias * DIA_MS).toISOString();
  const filas = db
    .prepare(
      `SELECT tipo, estado, codigo, COUNT(*) AS n FROM trabajos_ia WHERE actualizado_en >= ?
    GROUP BY tipo, estado, codigo`,
    )
    .all(desde) as { tipo: string; estado: EstadoTrabajo; codigo: string | null; n: number }[];
  const porTipo = new Map<string, EstadisticaTipo>();
  for (const f of filas) {
    const e = porTipo.get(f.tipo) ?? {
      tipo: f.tipo,
      completados: 0,
      fallidos: 0,
      cancelados: 0,
      en_curso: 0,
      tasa_fallo: null,
      fallos_por_codigo: {},
      esperas_por_codigo: {},
    };
    sumar(e, f);
    porTipo.set(f.tipo, e);
  }
  const por_tipo = [...porTipo.values()].map((e) => {
    const terminados = e.completados + e.fallidos;
    return { ...e, tasa_fallo: terminados ? Math.round((e.fallidos / terminados) * 100) / 100 : null };
  });
  return { desde, por_tipo: por_tipo.sort((a, b) => b.fallidos - a.fallidos || a.tipo.localeCompare(b.tipo)) };
}

// Con menos muestras, una mediana la mueve un solo run raro: mejor la duración presupuestada.
const MUESTRAS_MEDIANA = 5;
const DIAS_MEDIANA = 14;

function mediana(valores: number[]): number | null {
  if (valores.length < MUESTRAS_MEDIANA) return null;
  const v = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(v.length / 2);
  return v.length % 2 ? v[medio]! : (v[medio - 1]! + v[medio]!) / 2;
}

/**
 * Lo que tarda de verdad cada tipo (minutos): la mediana de los completados de los últimos días,
 * de lanzarse (o de pedirse, si no consta) a terminar. null con menos de 5 muestras.
 */
export function medianasDuracion(
  db: Db,
  tipos: readonly string[],
  dias = DIAS_MEDIANA,
  ahoraMs = Date.now(),
): Record<string, number | null> {
  const desde = new Date(ahoraMs - dias * DIA_MS).toISOString();
  const consulta = db.prepare(`SELECT COALESCE(lanzado_en, creado_en) AS inicio, actualizado_en AS fin FROM trabajos_ia
    WHERE tipo = ? AND estado = 'completado' AND actualizado_en >= ?`);
  return Object.fromEntries(
    tipos.map((tipo) => {
      const filas = consulta.all(tipo, desde) as { inicio: string; fin: string }[];
      const minutos = filas
        .map((f) => (Date.parse(f.fin) - Date.parse(f.inicio)) / 60_000)
        .filter((m) => Number.isFinite(m) && m >= 0);
      const m = mediana(minutos);
      return [tipo, m === null ? null : Math.round(m)];
    }),
  );
}

// Los errores guardados antes de la columna `codigo` solo tienen el mensaje: se reconocen por
// cómo empiezan (son los mensajes de la propia cola) o por el código que llevan delante.
const CODIGO_POR_MENSAJE: [RegExp, string][] = [
  [/^El run terminó sin dejar el resultado/, 'sin_resultado'],
  [/^Hermes ya no conoce el run/, 'run_perdido'],
  [/^Hermes lleva \d+ min sin usar/, 'run_inactivo'],
  [/^El run superó el tiempo máximo/, 'run_tiempo_maximo'],
  [/^No se pudo consultar el run/, 'consulta_fallida'],
  [/^Sin destino de Hermes/, 'sin_destino'],
  [/^Tipo de trabajo desconocido/, 'tipo_desconocido'],
  [/^Error interno al preparar/, 'error_interno'],
  [new RegExp(`^(${ESPERA_LIMITE}|hermes_http_429)`), CODIGO_LIMITE],
  [new RegExp(`^${ESPERA_HERRAMIENTA}`), CODIGO_HERRAMIENTA],
  [new RegExp(`^${RELANZADO}`), CODIGO_RELANZADO],
  [new RegExp(`^${ESPERA_DESFASE}`), CODIGO_DESFASE],
];

/** El código de un error guardado sin él: «desconocido» si es un mensaje de Hermes sin código. */
export function codigoDeError(error: string): string {
  // Un 429 con el mensaje de Hermes («HTTP 429: The usage limit…») no empieza por un prefijo conocido.
  if (LIMITE_EN_ERROR.test(error)) return CODIGO_LIMITE;
  const conocido = CODIGO_POR_MENSAJE.find(([re]) => re.test(error))?.[1];
  if (conocido) return conocido;
  const delante = /^(hermes_[a-z0-9_]+): /.exec(error)?.[1];
  if (delante) return delante;
  const estado = /^Run (\w+)\.$/.exec(error)?.[1];
  return estado ? `run_${estado}` : 'desconocido';
}

/** Pone código a los trabajos con error guardados antes de que existiera (al arrancar; luego no queda ninguno). */
export function rellenarCodigos(db: Db): number {
  const filas = db
    .prepare(
      "SELECT id, error, codigo FROM trabajos_ia WHERE error IS NOT NULL AND (codigo IS NULL OR codigo = 'desconocido')",
    )
    .all() as { id: number; error: string; codigo: string | null }[];
  // Un «desconocido» que sigue siéndolo no cuenta: así el arranque siguiente devuelve 0.
  const nuevos = filas
    .map((f) => ({ id: f.id, codigo: codigoDeError(f.error), antes: f.codigo }))
    .filter((f) => f.codigo !== f.antes);
  const poner = db.prepare('UPDATE trabajos_ia SET codigo = ? WHERE id = ?');
  db.transaction(() => {
    for (const f of nuevos) poner.run(f.codigo, f.id);
  })();
  return nuevos.length;
}
