// Telemetría del tiempo de persona: cuánto tiempo con foco pasa cada tarea de las comprobaciones hasta cerrarse.
import type { Request, Response, Router } from 'express';
import { z } from 'zod';
import { invalido, responder } from '../../../nucleo/http.js';
import { logger } from '../../../nucleo/log.js';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import { obtenerLicitacion, type Db } from '../store.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { comprobacionesDe } from './comprobaciones.js';
import { MINUTOS_POR_ACCION, type AccionBloqueo, type Bloqueo } from './comprobacionesTipos.js';

// Se mide por oferta y, si hay identidad, por persona. Mide el objetivo de 10-20 min por oferta en ofertas
// nuevas y recalibra los minutos fijos de las comprobaciones con la mediana real. Sin textos: la fila guarda la
// clave del bloqueo, su tipo de acción y la clave de persona; nunca el título, la cita ni lo escrito.
const log = logger('telemetria');

// Cuatro horas: más con foco en una sola fila es una pestaña olvidada, no trabajo.
const MAX_MS_FOCO = 14_400_000;
// Por debajo de 10 ofertas distintas la mediana dice más de una oferta rara que del trabajo.
const MIN_OFERTAS_MEDIANA = 10;
// Clave de persona opaca (un uuid), nunca su nombre: con el login único de hoy no llega y la fila
// queda sin persona. sendBeacon no lleva cabeceras: la web tendrá que mandarla por fetch.
const CABECERA_PERSONA = 'X-Persona';
const MS_MINUTO = 60_000;
const VIGENCIA_MEDIANAS_MS = 60_000;
// La web manda cada minuto (LATIDO_TELEMETRIA_MS): más del doble en un envío no es un latido.
const LATIDO_TELEMETRIA_MS = 60_000;
const MAX_MS_ENVIO = 2 * LATIDO_TELEMETRIA_MS;

const TIPOS_ACCION = Object.keys(MINUTOS_POR_ACCION) as [AccionBloqueo, ...AccionBloqueo[]];

const TelemetriaEntrada = z
  .object({
    clave: z.string().trim().min(1).max(200),
    tipo: z.enum(TIPOS_ACCION),
    ms_foco: z.number().int().min(0).max(MAX_MS_ENVIO),
    cerrada: z.boolean(),
  })
  .strict();
export type TelemetriaTarea = {
  clave: string;
  tipo: string;
  ms_foco: number;
  cerrada: boolean;
  persona: string | null;
};

const Persona = z.uuid();

/** La clave de persona de la cabecera, o null si no viene o no es un uuid (un nombre o un correo no se guardan). */
function personaDe(req: Request): string | null {
  const p = Persona.safeParse(req.get(CABECERA_PERSONA));
  return p.success ? p.data : null;
}

type FilaAbierta = { id: number; ms_foco: number };

// Los envíos de cada minuto suman en la fila abierta de esa tarea; cerrada, la siguiente vez que
// se trabaje en la misma clave (se reabrió) empieza otra.
function filaAbierta(db: Db, id: string, t: TelemetriaTarea): FilaAbierta | null {
  return (
    (db
      .prepare(
        `SELECT id, ms_foco FROM telemetria_tareas
    WHERE licitacion_id = ? AND clave = ? AND persona IS ? AND cerrada = 0 ORDER BY id DESC LIMIT 1`,
      )
      .get(id, t.clave, t.persona) as FilaAbierta | undefined) ?? null
  );
}

/** Suma el tiempo con foco de una tarea de las comprobaciones. not_found si la licitación no existe. */
export function registrarTiempo(db: Db, id: string, t: TelemetriaTarea, ahora: Date = new Date()): Result<null> {
  if (!obtenerLicitacion(db, id)) return fail('not_found', 'La licitación no existe.');
  const abierta = filaAbierta(db, id, t);
  if (abierta) {
    db.prepare('UPDATE telemetria_tareas SET ms_foco = ?, cerrada = ?, tipo = ? WHERE id = ?').run(
      Math.min(abierta.ms_foco + t.ms_foco, MAX_MS_FOCO),
      Number(t.cerrada),
      t.tipo,
      abierta.id,
    );
  } else if (t.ms_foco > 0) {
    // Sin foco y sin fila no hubo trabajo de persona: una fila a 0 hundiría la mediana.
    db.prepare(
      `INSERT INTO telemetria_tareas (licitacion_id, clave, tipo, persona, ms_foco, cerrada, creada_en)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, t.clave, t.tipo, t.persona, t.ms_foco, Number(t.cerrada), ahora.toISOString());
  }
  cache.delete(db);
  return ok(null);
}

const mediana = (xs: readonly number[]): number => {
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
};

type TareaCerrada = { tipo: string; licitacion_id: string; ms: number };

/**
 * Mediana de minutos por tipo de acción de las tareas cerradas (todas las personas de una misma
 * tarea suman), solo para los tipos medidos en al menos MIN_OFERTAS_MEDIANA ofertas distintas.
 */
export function medianasPorTipo(db: Db): Map<string, number> {
  const filas = db
    .prepare(
      `SELECT tipo, licitacion_id, SUM(ms_foco) AS ms FROM telemetria_tareas
    WHERE cerrada = 1 GROUP BY tipo, licitacion_id, clave`,
    )
    .all() as TareaCerrada[];
  const porTipo = new Map<string, TareaCerrada[]>();
  for (const f of filas) porTipo.set(f.tipo, [...(porTipo.get(f.tipo) ?? []), f]);
  const r = new Map<string, number>();
  for (const [tipo, tareas] of porTipo) {
    if (new Set(tareas.map((t) => t.licitacion_id)).size < MIN_OFERTAS_MEDIANA) continue;
    r.set(tipo, Math.round((mediana(tareas.map((t) => t.ms)) / MS_MINUTO) * 10) / 10);
  }
  return r;
}

// La Mesa compone las comprobaciones de cada oferta activa: sin esto serían N lecturas iguales por petición.
const cache = new Map<Db, { en: number; valor: Map<string, number> }>();

/** medianasPorTipo con un minuto de vigencia; registrarTiempo la invalida. */
export function medianasVigentes(db: Db, ahoraMs: number = Date.now()): Map<string, number> {
  const c = cache.get(db);
  if (c && ahoraMs - c.en < VIGENCIA_MEDIANAS_MS) return c.valor;
  const valor = medianasPorTipo(db);
  cache.set(db, { en: ahoraMs, valor });
  return valor;
}

/**
 * Los minutos de una fila con la mediana medida de su acción si la hay; si no, los de su regla
 * (la tabla fija). Lo de Hermes y lo de fuera de Hermes no es tiempo de persona y no se toca.
 */
export function minutosMedidos(b: Bloqueo, medianas: ReadonlyMap<string, number>): Bloqueo {
  if (b.actor === 'fuera' || b.actor === 'hermes') return b;
  const m = medianas.get(b.accion.tipo);
  return m === undefined ? b : { ...b, minutos: m };
}

export type ResumenTelemetria = {
  ofertas: {
    licitacion_id: string;
    minutos: number;
    tipos: { tipo: string; minutos: number; tareas: number; cerradas: number }[];
  }[];
};

type FilaResumen = { licitacion_id: string; tipo: string; ms: number; tareas: number; cerradas: number };

const minutos = (ms: number): number => Math.round((ms / MS_MINUTO) * 10) / 10;

/** Minutos con foco por oferta y tipo de acción, para medir el uso. */
export function resumenTelemetria(db: Db): ResumenTelemetria {
  const filas = db
    .prepare(
      `SELECT licitacion_id, tipo, SUM(ms_foco) AS ms, COUNT(DISTINCT clave) AS tareas,
      COUNT(DISTINCT CASE WHEN cerrada = 1 THEN clave END) AS cerradas
    FROM telemetria_tareas GROUP BY licitacion_id, tipo ORDER BY licitacion_id, tipo`,
    )
    .all() as FilaResumen[];
  const porOferta = new Map<string, FilaResumen[]>();
  for (const f of filas) porOferta.set(f.licitacion_id, [...(porOferta.get(f.licitacion_id) ?? []), f]);
  return {
    ofertas: [...porOferta].map(([licitacion_id, fs]) => ({
      licitacion_id,
      minutos: minutos(fs.reduce((s, f) => s + f.ms, 0)),
      tipos: fs.map((f) => ({ tipo: f.tipo, minutos: minutos(f.ms), tareas: f.tareas, cerradas: f.cerradas })),
    })),
  };
}

// La clave tiene que ser una fila de las comprobaciones de esa oferta, o una tarea ya abierta en la
// telemetría: la fila resuelta puede salir de las comprobaciones justo antes del envío que la cierra.
function claveConocida(db: Db, id: string, t: TelemetriaTarea): Result<null> {
  if (!obtenerLicitacion(db, id)) return fail('not_found', 'La licitación no existe.');
  if (filaAbierta(db, id, t)) return ok(null);
  const c = comprobacionesDe(db, nucleo().db, id);
  if (c.error) return c;
  return c.data.bloqueos.some((b) => b.clave === t.clave)
    ? ok(null)
    : fail('invalid_input', 'Esa tarea no está en las comprobaciones de esta oferta.');
}

function registrar(id: string, req: Request, res: Response): void {
  const e = TelemetriaEntrada.safeParse(req.body ?? {});
  if (!e.success) return invalido(res, e.error);
  const t = { ...e.data, persona: personaDe(req) };
  const db = dbLicitaciones();
  const conocida = claveConocida(db, id, t);
  if (conocida.error) return responder(res, conocida);
  const r = registrarTiempo(db, id, t);
  if (r.error) return responder(res, r);
  log.debug('tiempo de tarea', { licitacion: id, tipo: e.data.tipo, ms: e.data.ms_foco, cerrada: e.data.cerrada });
  res.status(204).end();
}

// La web la manda con navigator.sendBeacon, que no lleva X-Web-Version: exigirVersionWeb no la
// frena (sin cabecera no se comprueba), así una pestaña antigua no pierde su último minuto.
export function rutasTelemetria(r: Router): void {
  r.post('/licitaciones/:id/telemetria', conId(registrar));
  r.get('/telemetria/resumen', (_req, res) => {
    res.json(resumenTelemetria(dbLicitaciones()));
  });
}
