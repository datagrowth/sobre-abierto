// Los avisos que cada persona quiere recibir por email, activados en Ajustes › Avisos (usuarios.avisos, JSON).
import { z } from 'zod';
import type { Db } from './db.js';
import { fail, ok, type Result } from './result.js';

// Son plazo a 48 h con algo que impide, resoluciones, menciones, búsquedas guardadas y caducidades de la carpeta
// Empresa. El resumen semanal no va aquí: a quién llega lo decide un admin (avisos.ts).
const AVISOS_PERSONALES = ['urgentes', 'resoluciones', 'menciones', 'busquedas', 'caducidades'] as const;
export type AvisoPersonal = (typeof AVISOS_PERSONALES)[number];
export type Preferencias = Record<AvisoPersonal, boolean>;

// Lo que no lleva fecha fija llega por defecto; las caducidades, solo a quien las pide.
export const PREFERENCIAS_POR_DEFECTO: Preferencias = {
  urgentes: true,
  resoluciones: true,
  menciones: true,
  busquedas: true,
  caducidades: false,
};

const Cambio = z.partialRecord(z.enum(AVISOS_PERSONALES), z.boolean());

function leer(texto: string | null | undefined): Preferencias {
  try {
    const v = Cambio.safeParse(JSON.parse(texto || '{}'));
    return { ...PREFERENCIAS_POR_DEFECTO, ...(v.success ? v.data : {}) };
  } catch {
    return { ...PREFERENCIAS_POR_DEFECTO };
  }
}

export function preferenciasDe(db: Db, usuarioId: number): Preferencias {
  const f = db.prepare('SELECT avisos FROM usuarios WHERE id = ?').get(usuarioId) as { avisos: string } | undefined;
  return leer(f?.avisos);
}

export function guardarPreferencias(db: Db, usuarioId: number, datos: unknown): Result<Preferencias> {
  const v = Cambio.safeParse(datos);
  if (!v.success) return fail('invalid_input', `Avisos: ${AVISOS_PERSONALES.join(', ')}, cada uno sí o no.`);
  const f = db.prepare('SELECT avisos FROM usuarios WHERE id = ? AND activo = 1').get(usuarioId) as
    { avisos: string } | undefined;
  if (!f) return fail('not_found', 'Ese usuario no existe.');
  const nuevas = { ...leer(f.avisos), ...v.data };
  db.prepare('UPDATE usuarios SET avisos = ?, actualizado_en = ? WHERE id = ?').run(
    JSON.stringify(nuevas),
    new Date().toISOString(),
    usuarioId,
  );
  return ok(nuevas);
}

export type Destinatario = { id: number; nombre: string; email: string };
type FilaDestinatario = Destinatario & { avisos: string };

// El primer admin nace con el usuario de siempre como «email» hasta que pone el suyo: sin @ no se le escribe.
export const tieneEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const conEmail = (f: { email: string }) => tieneEmail(f.email);

/** Las personas activas que quieren un aviso personal. */
export function quienesQuieren(db: Db, aviso: AvisoPersonal): Destinatario[] {
  const filas = db
    .prepare('SELECT id, nombre, email, avisos FROM usuarios WHERE activo = 1 ORDER BY id')
    .all() as FilaDestinatario[];
  return filas
    .filter((f) => conEmail(f) && leer(f.avisos)[aviso])
    .map(({ id, nombre, email }) => ({ id, nombre, email }));
}

/** Las personas activas con email de una lista de ids (los destinatarios del resumen semanal). */
export function destinatariosDe(db: Db, ids: readonly number[]): Destinatario[] {
  if (!ids.length) return [];
  const filas = db
    .prepare(
      `SELECT id, nombre, email FROM usuarios WHERE activo = 1 AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
    )
    .all(...ids) as Destinatario[];
  return filas.filter(conEmail);
}
