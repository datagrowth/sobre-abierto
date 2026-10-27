// Cuántas veces se rechazó hace poco lo que Hermes envía por una tool (ficha, guion, apartado de la memoria).
import type { Db } from './store.js';

// Tras dos rechazos en un mismo rato se acepta con lo que falte como aviso: un tercero haría fallar el run y,
// tres seguidos, frenarían ese tipo de trabajo seis horas. Se cuenta en la auditoría de las tools
// (nucleo.auditoria_agentes).
const VENTANA_RECHAZOS_MS = 40 * 60_000;
const RECHAZOS_ANTES_DE_ACEPTAR = 2;

/** Rechazos de `herramienta` para `recurso` en la ventana que acaba en `ahoraMs`. */
function rechazosRecientes(db: Db, herramienta: string, recurso: string, ahoraMs: number): number {
  const desde = new Date(ahoraMs - VENTANA_RECHAZOS_MS).toISOString();
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM nucleo.auditoria_agentes
    WHERE herramienta = ? AND recurso = ? AND resultado = 'error' AND creado_en > ?`,
      )
      .get(herramienta, recurso, desde) as { n: number }
  ).n;
}

/** ¿Se rechaza aún lo que no pase la revisión? false tras dos rechazos recientes. */
export function exigirRevision(db: Db, herramienta: string, recurso: string, hoy: Date = new Date()): boolean {
  return rechazosRecientes(db, herramienta, recurso, hoy.getTime()) < RECHAZOS_ANTES_DE_ACEPTAR;
}
