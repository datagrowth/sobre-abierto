// Consultas de la cola para la web, el MCP y Ajustes › Estado: el estado general, el listado de
// trabajos y lo que espera o corre (o acaba de fallar) para un recurso.
import type { Db } from './db.js';
import { contextoEta, detalleTrabajo, type DetalleTrabajo } from './colaEta.js';
import { desfasadosDeLaCola, pausaIso } from './colaEsperas.js';
import { contarPorEstado, DIAS_ESTADISTICA, estadisticasCola, operacionCola } from './colaEstadisticas.js';
import { frenadosDeLaCola, frenosLevantadosPorVersion, type Frenado, type LevantadosPorVersion } from './colaFrenos.js';
import {
  esDominioPersonal,
  obtenerTrabajo,
  recortarError,
  tiposConHermes,
  type EstadoTrabajo,
  type Trabajo,
} from './colaTipos.js';
import type { Desfase } from './mcp/huellas.js';
import { runsALaVezActual } from './trabajos.js';

const DIA_MS = 86_400_000;

/** Lo justo de la cola para «Programado»: cuánto espera, cuánto corre y qué está parado. */
export function resumenCola(db: Db): {
  pendientes: number;
  en_marcha: number;
  frenados: Frenado[];
  pausa_hasta: string | null;
  desfasados: Desfase[];
  levantados_por_version: LevantadosPorVersion | null;
} {
  const n = (estado: string) =>
    (db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia WHERE estado = ?').get(estado) as { n: number }).n;
  return {
    pendientes: n('pendiente'),
    en_marcha: n('lanzado'),
    frenados: frenadosDeLaCola(db),
    pausa_hasta: pausaIso(db),
    desfasados: desfasadosDeLaCola(db),
    levantados_por_version: frenosLevantadosPorVersion(db),
  };
}

export function estadoCola(db: Db, ahoraMs = Date.now()): Record<string, unknown> {
  const filas = db
    .prepare(
      `SELECT id, tipo, dominio, estado, intentos, codigo, error, json_extract(payload, '$.id') AS recurso,
    actualizado_en, metricas FROM trabajos_ia ORDER BY id DESC LIMIT 10`,
    )
    .all() as { dominio: string; error: string | null; metricas: string | null; recurso: unknown }[];
  // Sin `dominio` en la salida: solo sirve para ocultar de quién es un trabajo con datos personales.
  const ultimos = filas.map(({ dominio, ...u }) => ({
    ...u,
    recurso: esDominioPersonal(dominio) ? null : u.recurso,
    error: recortarError(u.error),
    metricas: u.metricas ? (JSON.parse(u.metricas) as unknown) : null,
  }));
  const frenados = frenadosDeLaCola(db);
  return {
    por_estado: contarPorEstado(db),
    ultimos,
    ultimos_7_dias: estadisticasCola(db, DIAS_ESTADISTICA, ahoraMs),
    tipos_con_hermes: tiposConHermes(),
    frenados,
    pausa_por_limite_hasta: pausaIso(db),
    // Perfiles de Hermes con la lista de herramientas de antes del despliegue: sus trabajos esperan a que se reinicie.
    herramientas_desfasadas: desfasadosDeLaCola(db),
    ...operacionCola(db, ahoraMs),
    // Frenos que levantó el despliegue de una versión nueva: sus fallos eran de la anterior.
    frenos_levantados_por_version: frenosLevantadosPorVersion(db, ahoraMs),
  };
}

export type FiltroTrabajos = {
  tipo?: string | undefined;
  estado?: EstadoTrabajo | undefined;
  codigo?: string | undefined;
  recurso?: string | undefined;
  dias?: number | undefined;
  desde: number;
  limite: number;
};

// Solo fragmentos fijos: los valores van como parámetros.
function condiciones(f: FiltroTrabajos, ahoraMs: number): { where: string; args: (string | number)[] } {
  const c: [string, string | number | undefined][] = [
    ['tipo = ?', f.tipo],
    ['estado = ?', f.estado],
    ['codigo = ?', f.codigo],
    ["json_extract(payload, '$.id') = ?", f.recurso],
    ['actualizado_en >= ?', f.dias ? new Date(ahoraMs - f.dias * DIA_MS).toISOString() : undefined],
  ];
  const usadas = c.filter((x): x is [string, string | number] => x[1] !== undefined);
  return {
    where: usadas.length ? `WHERE ${usadas.map(([s]) => s).join(' AND ')}` : '',
    args: usadas.map(([, v]) => v),
  };
}

/**
 * Trabajos de la cola por tipo, estado, código, recurso (el `id` del payload: la licitación o
 * la convocatoria) y antigüedad, del más nuevo al más viejo y por páginas.
 */
export function listarTrabajos(
  db: Db,
  f: FiltroTrabajos,
  ahoraMs = Date.now(),
): { total: number; desde: number; siguiente: number | null; trabajos: unknown[] } {
  const { where, args } = condiciones(f, ahoraMs);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM trabajos_ia ${where}`).get(...args) as { n: number }).n;
  const filas = db
    .prepare(
      `SELECT id, tipo, dominio, estado, codigo, intentos, error, json_extract(payload, '$.id') AS recurso,
    creado_en, actualizado_en, lanzado_en, metricas FROM trabajos_ia ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, f.limite, f.desde) as (Pick<Trabajo, 'id' | 'dominio' | 'estado' | 'error' | 'metricas'> & {
    recurso: unknown;
  })[];
  const enCola = enColaDe(db, filas, ahoraMs);
  // Los trabajos con datos personales (CV) no dicen de quién son.
  const trabajos = filas.map((t) => ({
    ...t,
    recurso: esDominioPersonal(t.dominio) ? null : t.recurso,
    error: recortarError(t.error),
    metricas: t.metricas ? (JSON.parse(t.metricas) as unknown) : null,
    ...enCola.get(t.id),
  }));
  const siguiente = f.desde + filas.length < total ? f.desde + filas.length : null;
  return { total, desde: f.desde, siguiente, trabajos };
}

type EnCola = Pick<DetalleTrabajo, 'posicion' | 'eta' | 'motivo_espera'>;

// Solo los pendientes y en marcha tienen sitio en la cola; el contexto se calcula una vez por página.
function enColaDe(db: Db, filas: { id: number; estado: EstadoTrabajo }[], ahoraMs: number): Map<number, EnCola> {
  const vivos = filas.filter((f) => f.estado === 'pendiente' || f.estado === 'lanzado');
  const out = new Map<number, EnCola>();
  if (!vivos.length) return out;
  const ctx = contextoEta(db, ahoraMs, runsALaVezActual());
  for (const f of vivos) {
    const t = obtenerTrabajo(db, f.id);
    if (!t) continue;
    const d = detalleTrabajo(db, t, ctx);
    out.set(f.id, { posicion: d.posicion, eta: d.eta, motivo_espera: d.motivo_espera });
  }
  return out;
}

// Lo de DetalleTrabajo es opcional: lo barato (trabajoEnCurso) solo trae los campos de la fila.
export type EnCurso = {
  estado: 'en_cola' | 'generando';
  desde: string;
  id?: number;
  tipo?: string;
} & Partial<DetalleTrabajo>;

/**
 * El último trabajo de `tipo` para el recurso `id` (payload.id) que espera turno o corre
 * en Hermes, para que la web diga «en cola» o «generando» en vez de dejar pedirlo otra vez.
 * `dbDominio` es la base de un dominio con el núcleo adjunto como `nucleo`.
 */
export function trabajoEnCurso(dbDominio: Db, tipo: string, id: string): EnCurso | null {
  const t = dbDominio
    .prepare(
      `SELECT estado, actualizado_en, intentos, proximo_intento_en, codigo FROM nucleo.trabajos_ia
    WHERE tipo = ? AND estado IN ('pendiente', 'lanzado') AND json_extract(payload, '$.id') = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(tipo, id) as
    Pick<Trabajo, 'estado' | 'actualizado_en' | 'intentos' | 'proximo_intento_en' | 'codigo'> | undefined;
  if (!t) return null;
  return {
    estado: t.estado === 'lanzado' ? 'generando' : 'en_cola',
    desde: t.actualizado_en,
    intentos: t.intentos,
    proximo_intento_en: t.proximo_intento_en,
    codigo: t.codigo,
  };
}

/**
 * Como trabajoEnCurso, con su posición en la cola, la hora estimada y el motivo de la espera
 * (más caro: ordena la cola). `dbNucleo` es la base del núcleo, sin adjuntar.
 */
export function trabajoEnCursoDetallado(dbNucleo: Db, tipo: string, id: string, ahoraMs = Date.now()): EnCurso | null {
  const t = dbNucleo
    .prepare(
      `SELECT * FROM trabajos_ia WHERE tipo = ? AND estado IN ('pendiente', 'lanzado')
    AND json_extract(payload, '$.id') = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(tipo, id) as Trabajo | undefined;
  if (!t) return null;
  const detalle = detalleTrabajo(dbNucleo, t, contextoEta(dbNucleo, ahoraMs, runsALaVezActual()));
  return {
    estado: t.estado === 'lanzado' ? 'generando' : 'en_cola',
    desde: t.actualizado_en,
    id: t.id,
    tipo: t.tipo,
    ...detalle,
  };
}

export type UltimoFallo = { codigo: string | null; error: string | null; intentos: number; en: string };

/**
 * El último fallo definitivo de `tipo` para el recurso `id` en las últimas 24 h, si no lo tapa un
 * completado posterior: tras el fallo final trabajoEnCurso da null y la pantalla volvía al botón
 * sin decir que falló. `dbDominio` es la base de un dominio con el núcleo adjunto como `nucleo`.
 */
export function ultimoFallo(dbDominio: Db, tipo: string, id: string, ahoraMs = Date.now()): UltimoFallo | null {
  const f = dbDominio
    .prepare(
      `SELECT dominio, codigo, error, intentos, actualizado_en FROM nucleo.trabajos_ia
    WHERE tipo = ? AND estado = 'fallido' AND json_extract(payload, '$.id') = ? AND actualizado_en >= ?
    ORDER BY actualizado_en DESC, id DESC LIMIT 1`,
    )
    .get(tipo, id, new Date(ahoraMs - DIA_MS).toISOString()) as
    Pick<Trabajo, 'dominio' | 'codigo' | 'error' | 'intentos' | 'actualizado_en'> | undefined;
  if (!f) return null;
  const completado = dbDominio
    .prepare(
      `SELECT 1 FROM nucleo.trabajos_ia WHERE tipo = ? AND estado = 'completado'
    AND json_extract(payload, '$.id') = ? AND actualizado_en > ? LIMIT 1`,
    )
    .get(tipo, id, f.actualizado_en);
  if (completado) return null;
  return {
    codigo: f.codigo,
    error: esDominioPersonal(f.dominio) ? null : recortarError(f.error, 300),
    intentos: f.intentos,
    en: f.actualizado_en,
  };
}
