// Avisos fuera de la app: el resumen semanal que decide un admin (Ajustes › Avisos).
import { z } from 'zod';
import { nucleo } from './contexto.js';
import { enviarCorreo, hayCorreo } from './correo.js';
import { montarCorreo, type BloqueCorreo, type Plantilla } from './correoPlantillas.js';
import { destinatariosDe, type Destinatario } from './avisosPersona.js';
import type { Db } from './db.js';
import { zonaEmpresa } from './empresa.js';
import { enHoraLocal } from './fechas.js';
import { logger } from './log.js';
import { leerMarca } from './marca.js';
import { errorMessage, fail, ok, type Result } from './result.js';

const log = logger('avisos');

// El resumen semanal llega el día y a la hora (de la zona de la empresa) que decide un admin, a las personas que
// marca y con lo que elige. Los demás avisos (plazo a 48 h, resolución, búsquedas guardadas, caducidades) son
// personales y los registra cada dominio. Cada aviso se envía una vez (avisos_enviados) aunque la vuelta pase
// cada minuto, y sin SMTP queda apuntado como no enviado. Ningún aviso lleva precios, costes ni datos de CV.
const SECCIONES_RESUMEN = ['plazos', 'nuevas', 'novedades', 'lecciones'] as const;
type SeccionResumenClave = (typeof SECCIONES_RESUMEN)[number];

const ConfigResumen = z.strictObject({
  destinatarios: z.array(z.number().int().positive()).max(200),
  dia: z.number().int().min(1).max(7),
  hora: z.number().int().min(0).max(23),
  secciones: z.partialRecord(z.enum(SECCIONES_RESUMEN), z.boolean()),
});
export type ConfigResumenData = {
  destinatarios: number[];
  dia: number;
  hora: number;
  secciones: Record<SeccionResumenClave, boolean>;
};

// Lunes a las 8:00 en la hora de la empresa, con todo y a nadie: un admin elige quién lo recibe.
const RESUMEN_POR_DEFECTO: ConfigResumenData = {
  destinatarios: [],
  dia: 1,
  hora: 8,
  secciones: { plazos: true, nuevas: true, novedades: true, lecciones: true },
};

export function configResumen(db: Db): ConfigResumenData {
  const f = db.prepare('SELECT destinatarios, dia, hora, secciones FROM avisos_config WHERE id = 1').get() as
    { destinatarios: string; dia: number; hora: number; secciones: string } | undefined;
  if (!f) return RESUMEN_POR_DEFECTO;
  const v = ConfigResumen.safeParse({
    destinatarios: JSON.parse(f.destinatarios),
    dia: f.dia,
    hora: f.hora,
    secciones: JSON.parse(f.secciones),
  });
  return v.success
    ? { ...v.data, secciones: { ...RESUMEN_POR_DEFECTO.secciones, ...v.data.secciones } }
    : RESUMEN_POR_DEFECTO;
}

export function guardarConfigResumen(db: Db, datos: unknown): Result<ConfigResumenData> {
  const v = ConfigResumen.safeParse(datos);
  if (!v.success)
    return fail(
      'invalid_input',
      'Resumen: destinatarios (ids), día de 1 (lunes) a 7, hora de 0 a 23 y qué secciones lleva.',
    );
  const c = v.data;
  db.prepare(
    `INSERT INTO avisos_config (id, destinatarios, dia, hora, secciones, actualizado_en) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET destinatarios = excluded.destinatarios, dia = excluded.dia, hora = excluded.hora, secciones = excluded.secciones, actualizado_en = excluded.actualizado_en`,
  ).run(
    JSON.stringify([...new Set(c.destinatarios)]),
    c.dia,
    c.hora,
    JSON.stringify(c.secciones),
    new Date().toISOString(),
  );
  return ok(configResumen(db));
}

// ─── Lo que aporta cada dominio ──────────────────────────────────────────────

export type SeccionResumen = { clave: SeccionResumenClave; bloque: BloqueCorreo };
type Proveedor = (desdeMs: number, ahoraMs: number) => SeccionResumen[];
type Periodico = (ahoraMs: number) => Promise<void>;

const proveedores = new Map<string, Proveedor>();
const periodicos = new Map<string, Periodico>();

/** El contenido del resumen semanal que pone un dominio (lo de los últimos 7 días y lo de los próximos). */
export function registrarResumenSemanal(dominio: string, fn: Proveedor): void {
  proveedores.set(dominio, fn);
}

/** Un aviso que se mira en cada vuelta (cada minuto) y decide él si toca. */
export function registrarAvisoPeriodico(id: string, fn: Periodico): void {
  periodicos.set(id, fn);
}

const SEMANA_MS = 7 * 86_400_000;

/** El resumen semanal con lo de cada dominio y solo las secciones elegidas. */
export function resumenSemanal(db: Db, ahoraMs = Date.now()): Plantilla {
  const cfg = configResumen(db);
  const secciones: SeccionResumen[] = [];
  for (const [dominio, fn] of proveedores) {
    try {
      secciones.push(...fn(ahoraMs - SEMANA_MS, ahoraMs));
    } catch (err) {
      log.error('resumen semanal sin la parte de un dominio', { dominio, error: errorMessage(err) });
    }
  }
  const orden = (s: SeccionResumen) => SECCIONES_RESUMEN.indexOf(s.clave);
  const elegidas = secciones.filter((s) => cfg.secciones[s.clave]).sort((a, b) => orden(a) - orden(b));
  return {
    asunto: `Hermes: tu semana (${enHoraLocal(ahoraMs, zonaEmpresa(db)).semana.replace('-W', ', semana ')})`,
    titulo: 'Qué hacer esta semana',
    intro: 'Lo que cierra en los próximos días, lo nuevo que puede encajar y lo que ha pasado en la última semana.',
    bloques: elegidas.map((s) => s.bloque),
    boton: { texto: 'Abrir Hermes', enlace: '#/pipeline' },
  };
}

// ─── Envío ───────────────────────────────────────────────────────────────────

export const yaEnviado = (db: Db, clave: string): boolean =>
  db.prepare('SELECT 1 FROM avisos_enviados WHERE clave = ?').get(clave) !== undefined;

/** Apunta que algo ya se avisó (p. ej. cada documento de un email que lleva varios). */
export function anotarAviso(db: Db, clave: string, tipo: string): void {
  db.prepare(
    "INSERT OR IGNORE INTO avisos_enviados (clave, tipo, destinatarios, estado, en) VALUES (?, ?, 0, 'incluido', ?)",
  ).run(clave, tipo, new Date().toISOString());
}

export type Envio = { estado: 'enviado' | 'sin_smtp' | 'fallo' | 'sin_destinatarios' | 'repetido'; enviados: number };

/**
 * Envía un aviso una sola vez (por su clave), uno a cada persona (nadie ve a quién más le llega).
 * Se apunta aunque no salga: sin SMTP, o si falla, no se reintenta cada minuto.
 */
export async function enviarAviso(
  db: Db,
  x: { clave: string; tipo: string; para: readonly Destinatario[]; plantilla: Plantilla },
): Promise<Envio> {
  if (yaEnviado(db, x.clave)) return { estado: 'repetido', enviados: 0 };
  if (!x.para.length) return { estado: 'sin_destinatarios', enviados: 0 };
  const correo = montarCorreo(x.plantilla, nucleo().config.urlWeb, leerMarca(db));
  let enviados = 0;
  let estado: Envio['estado'] = hayCorreo() ? 'enviado' : 'sin_smtp';
  if (estado === 'enviado') {
    for (const d of x.para) {
      const r = await enviarCorreo({ ...correo, para: d.email }, x.tipo);
      if (r.error) estado = 'fallo';
      else enviados += 1;
    }
  }
  db.prepare(
    'INSERT OR IGNORE INTO avisos_enviados (clave, tipo, destinatarios, estado, en) VALUES (?, ?, ?, ?, ?)',
  ).run(x.clave, x.tipo, enviados, estado, new Date().toISOString());
  log.info('aviso por email', { tipo: x.tipo, estado, enviados, de: x.para.length });
  return { estado, enviados };
}

/**
 * El resumen semanal si toca: el día y desde la hora elegidos (en la hora de la empresa), una vez por semana.
 * Se monta solo si va a salir: la vuelta pasa cada minuto de ese día y montarlo recorre los dominios.
 */
export async function resumenSiToca(db: Db, ahoraMs = Date.now()): Promise<Envio | null> {
  const cfg = configResumen(db);
  const c = enHoraLocal(ahoraMs, zonaEmpresa(db));
  if (c.dia !== cfg.dia || c.hora < cfg.hora) return null;
  const clave = `resumen:${c.semana}`;
  if (yaEnviado(db, clave)) return { estado: 'repetido', enviados: 0 };
  const para = destinatariosDe(db, cfg.destinatarios);
  if (!para.length) return { estado: 'sin_destinatarios', enviados: 0 };
  return enviarAviso(db, { clave, tipo: 'resumen_semanal', para, plantilla: resumenSemanal(db, ahoraMs) });
}

/** Una vuelta: el resumen si toca y cada aviso periódico; un fallo de uno no para a los demás. */
export async function vueltaAvisos(db: Db, ahoraMs = Date.now()): Promise<void> {
  try {
    await resumenSiToca(db, ahoraMs);
  } catch (err) {
    log.error('resumen semanal sin enviar', { error: errorMessage(err) });
  }
  for (const [id, fn] of periodicos) {
    try {
      await fn(ahoraMs);
    } catch (err) {
      log.error('aviso periódico fallido', { id, error: errorMessage(err) });
    }
  }
}
