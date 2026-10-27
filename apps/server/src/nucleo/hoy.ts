// «Hoy»: lo que hay que mirar al entrar, reunido de todos los dominios sin que el núcleo dependa de ellos.
import { z } from 'zod';
import { errorMessage } from './result.js';
import { logger } from './log.js';

// Cada dominio aporta lo que vence pronto, lo que espera aprobación de una persona, lo nuevo desde la última
// visita y, si prepara algo con plazo, cuánto queda y qué falta; la web lo enseña en una bandeja y cuenta lo
// pendiente en la barra lateral.
type EnlaceHoy = { seccion: string; vista?: string; id?: string };
// corto: lo que es en dos o tres palabras («Memoria v5 por revisar»), para la barra lateral.
export type ItemHoy = {
  tipo: string;
  titulo: string;
  detalle: string | null;
  fecha: string | null;
  importe: number | null;
  enlace: EnlaceHoy;
  corto?: string;
};
// Lo que se está preparando: cuenta atrás hasta su plazo y lo que falta. vence_en es el instante
// del plazo en UTC, para que la web cuente sin pasar la fecha por la zona del navegador (en
// Canarias, una hora por detrás de la hora peninsular de la PLACSP); restante_ms, al servirlo.
export type ItemPreparacion = ItemHoy & { vence_en: string | null; restante_ms: number | null; falta: string[] };
export type HoyDominio = {
  seccion: string;
  vence: ItemHoy[];
  por_aprobar: ItemHoy[];
  novedades: ItemHoy[];
  novedades_total: number;
  en_preparacion?: ItemPreparacion[];
  // Lo que la cuenta del menú cuenta en vez de por_aprobar cuando el dominio sabe más: en
  // Licitaciones, cuántas licitaciones esperan a la persona (las de su Mesa y los avisos).
  tareas?: number;
  // Lo que dice la barra lateral debajo de la sección, con las mismas cuentas que `tareas`.
  resumen?: string;
  // Cuentas de otras entradas del menú que salen del mismo dominio (Licitaciones: Oportunidades).
  otras_cuentas?: Record<string, number>;
};
type Proveedor = (desde: string) => HoyDominio | Promise<HoyDominio>;

export const ConsultaHoy = z.object({
  // Desde cuándo es «nuevo» (la última visita del navegador); sin él, las últimas 24 horas.
  desde: z.string().datetime({ offset: true }).optional(),
});

const proveedores = new Map<string, Proveedor>();
const log = logger('plataforma');
const DIA_MS = 86_400_000;

export function registrarHoy(nombre: string, fn: Proveedor): void {
  proveedores.set(nombre, fn);
}

/** Un dominio que falla no deja la bandeja vacía: se omite y queda en el log. */
async function deUno(nombre: string, fn: Proveedor, desde: string): Promise<HoyDominio | null> {
  try {
    return await fn(desde);
  } catch (err) {
    log.warn('hoy: un dominio no respondió', { dominio: nombre, error: errorMessage(err) });
    return null;
  }
}

export async function resumenHoy(
  desde?: string,
  ahoraMs = Date.now(),
): Promise<{ desde: string; secciones: HoyDominio[]; cuentas: Record<string, number> }> {
  const inicio = desde ?? new Date(ahoraMs - DIA_MS).toISOString();
  const secciones = (await Promise.all([...proveedores].map(([n, fn]) => deUno(n, fn, inicio)))).filter(
    (s): s is HoyDominio => s !== null,
  );
  const cuentas: Record<string, number> = {};
  for (const s of secciones) {
    cuentas[s.seccion] = (cuentas[s.seccion] ?? 0) + (s.tareas ?? s.por_aprobar.length);
    for (const [k, n] of Object.entries(s.otras_cuentas ?? {})) cuentas[k] = (cuentas[k] ?? 0) + n;
  }
  return { desde: inicio, secciones, cuentas };
}
