// Ámbito de los agregados de competencia: qué es «el sector de la empresa» (prefijos CPV de los
// filtros y del perfil de empresa, o los que se pidan) y desde qué fecha se cuenta.
import { z } from 'zod';
import { percentil } from '../../../nucleo/estadistica.js';
import { FORMA_JURIDICA } from '../../../nucleo/identidad.js';
import { normalizarOrgano, textoBase } from '../antecedentes/texto.js';
import { sectorActual } from '../historico.js';
import type { Db } from '../store.js';
import { leerEscala } from './escala.js';
import { nombreTerritorio } from './territorios.js';

const Cpvs = z.array(z.string().regex(/^\d{2,8}$/, 'prefijo CPV de 2 a 8 cifras')).max(50);

// Prefijo NUTS (país y, si se quiere, región: «ES7» es Canarias, «ES30» Madrid). Solo letras y cifras, así
// que va tal cual en un LIKE sin comodines del usuario.
const PrefijoNuts = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}[0-9A-Z]{0,3}$/, 'prefijo NUTS, p. ej. «ES7»');

// Lo común a los rankings, para las tools y la web.
export const OpcionesAmbito = z.object({
  meses: z.number().int().min(0).max(240).default(24).describe('Últimos N meses (0 = todo el histórico)'),
  cpv: Cpvs.optional().describe('Prefijos CPV del sector; por defecto, los de los filtros y del perfil de la empresa'),
  texto: z.string().trim().min(2).max(100).optional().describe('Parte del nombre o del NIF'),
  importe_min: z
    .number()
    .min(0)
    .max(1e10)
    .optional()
    .describe(
      'Presupuesto mínimo sin IVA (€); por defecto, la banda en la que licitamos (o la de la escala de los rankings)',
    ),
  importe_max: z
    .number()
    .min(0)
    .max(1e10)
    .optional()
    .describe(
      'Presupuesto máximo sin IVA (€); por defecto, la banda en la que licitamos (o la de la escala de los rankings)',
    ),
  todos_importes: z.boolean().default(false).describe('true = sin banda de importe («Todos los importes»)'),
  nuts: PrefijoNuts.optional().describe(
    'Prefijo NUTS del lugar de ejecución, p. ej. «ES7» (Canarias) o «ES30» (Madrid); por defecto, el de la escala de los rankings',
  ),
  toda_espana: z.boolean().default(false).describe('true = sin filtro de territorio («Toda España»)'),
  desde: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .default(0)
    .describe('Posición desde la que seguir («Ver más»): el «siguiente» de la página anterior'),
  limite: z.number().int().min(1).max(100).default(30),
});
type OpcionesAmbitoData = z.infer<typeof OpcionesAmbito>;

export type Banda = { min: number; max: number; origen: 'pedida' | 'propia' | 'ajuste' };
// territorio: el nombre del prefijo NUTS, para enseñarlo («Canarias»).
export type Ambito = {
  cpvs: string[];
  meses: number;
  desde: string;
  banda: Banda | null;
  nuts: string | null;
  territorio: string | null;
};

type OpcionesDeAmbito = { meses: number; cpv?: string[] | undefined } & Partial<
  Pick<OpcionesAmbitoData, 'importe_min' | 'importe_max' | 'todos_importes' | 'nuts' | 'toda_espana'>
>;

const MIN_PRESENTADAS_BANDA = 5;
// Un máximo abierto: ningún presupuesto llega a 10.000 millones.
const SIN_MAXIMO = 1e10;

/**
 * Banda de importe en la que licita la empresa: percentiles 10 y 90 del presupuesto de las
 * presentadas (o de lo ofertado si no consta). Con menos de 5 no es una banda, es ruido: vale
 * la de la escala de los rankings (escala.ts) y, sin ella, no hay banda.
 */
export function bandaPropia(db: Db): Banda | null {
  const valores = (
    db
      .prepare(
        `SELECT COALESCE(presupuesto, importe_ofertado) AS v FROM propuestas
    WHERE COALESCE(presupuesto, importe_ofertado) > 0 ORDER BY v`,
      )
      .all() as { v: number }[]
  ).map((f) => f.v);
  if (valores.length >= MIN_PRESENTADAS_BANDA)
    return {
      min: Math.round(percentil(valores, 0.1) ?? 0),
      max: Math.round(percentil(valores, 0.9) ?? 0),
      origen: 'propia',
    };
  const e = leerEscala(db);
  if (e.banda_min === null && e.banda_max === null) return null;
  return { min: e.banda_min ?? 0, max: e.banda_max ?? SIN_MAXIMO, origen: 'ajuste' };
}

// Un mínimo o un máximo sueltos dejan abierto el otro extremo; si llegan al revés se ordenan
// (el esquema no lleva refine para que las opciones de cada ranking puedan extenderlo).
function bandaDe(db: Db, o: OpcionesDeAmbito): Banda | null {
  if (o.importe_min !== undefined || o.importe_max !== undefined) {
    const [min, max] = [o.importe_min ?? 0, o.importe_max ?? SIN_MAXIMO].sort((x, y) => x - y) as [number, number];
    return { min, max, origen: 'pedida' };
  }
  return o.todos_importes ? null : bandaPropia(db);
}

// Sin territorio pedido, el de la escala de los rankings; sin él, toda España.
function nutsDe(db: Db, o: OpcionesDeAmbito): string | null {
  if (o.nuts) return o.nuts;
  return o.toda_espana ? null : leerEscala(db).region_nuts;
}

/** Fecha (AAAA-MM-DD) de hace `meses` meses; con 0, desde siempre. */
// El día se recorta al último del mes de destino: el 31 de mayo menos tres meses es el 28 de
// febrero, no el 3 de marzo (Date.UTC desborda al mes siguiente y la ventana perdería días).
export function desdeMeses(meses: number, hoy = new Date()): string {
  if (meses <= 0) return '';
  const anio = hoy.getUTCFullYear();
  const mes = hoy.getUTCMonth() - meses;
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes, Math.min(hoy.getUTCDate(), ultimoDia))).toISOString().slice(0, 10);
}

/** Sector, periodo, banda de importe y territorio; sin banda ni territorio pedidos, los de la empresa. */
export function ambitoDe(db: Db, o: OpcionesDeAmbito, hoy = new Date()): Ambito {
  const cpvs = o.cpv?.length ? [...new Set(o.cpv)] : sectorActual(db, false).cpvs;
  const nuts = nutsDe(db, o);
  return {
    cpvs,
    meses: o.meses,
    desde: desdeMeses(o.meses, hoy),
    banda: bandaDe(db, o),
    nuts,
    territorio: nuts ? nombreTerritorio(nuts) : null,
  };
}

/**
 * Condición de banda y territorio sobre columnas fijas del código (nunca entrada): el importe
 * (presupuesto sin IVA) y el NUTS de la fila. Sin banda ni territorio no filtra.
 */
export function condicionEscala(
  importe: string,
  nuts: string,
  a: Pick<Ambito, 'banda' | 'nuts'>,
): { sql: string; args: (string | number)[] } {
  const partes: string[] = [];
  const args: (string | number)[] = [];
  if (a.banda) {
    partes.push(`${importe} BETWEEN ? AND ?`);
    args.push(a.banda.min, a.banda.max);
  }
  if (a.nuts) {
    partes.push(`${nuts} LIKE ?`);
    args.push(`${a.nuts}%`);
  }
  return { sql: partes.length ? partes.join(' AND ') : '1', args };
}

/** Posición de la página siguiente para «Ver más», o null si ya no hay más. */
export function siguienteDe(desde: number, vistos: number, total: number): number | null {
  return desde + vistos < total ? desde + vistos : null;
}

const MENORES = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'para', 'por', 'a', 'al']);

// Solo los nombres todo en mayúsculas o todo en minúsculas: uno ya escrito con mayúsculas
// y minúsculas («McKinsey», «eDreams») se deja como viene.
function capitalizar(nombre: string): string {
  if (nombre !== nombre.toUpperCase() && nombre !== nombre.toLowerCase()) return nombre;
  return nombre
    .toLowerCase()
    .replace(
      /(^|[\s(/-])(\p{L}+)/gu,
      (_m, antes: string, palabra: string) =>
        antes + (antes && MENORES.has(palabra) ? palabra : palabra.charAt(0).toUpperCase() + palabra.slice(1)),
    );
}

/** Nombre de empresa para enseñar: sin forma jurídica, espacios de más ni todo en mayúsculas. */
export function nombreEmpresa(nombre: string | null): string | null {
  if (!nombre?.trim()) return null;
  const limpio = nombre
    .replace(/\s+/g, ' ')
    .trim()
    .replace(FORMA_JURIDICA, '')
    .replace(/[\s,.]+$/, '');
  return capitalizar(limpio || nombre.trim());
}

/** ¿Contiene alguno de los campos el texto buscado? Sin tildes ni mayúsculas. */
export function coincideTexto(texto: string | undefined, ...campos: (string | null)[]): boolean {
  if (!texto) return true;
  const buscado = textoBase(texto);
  return campos.some((c) => c !== null && textoBase(c).includes(buscado));
}

/**
 * Nombre de órgano para enseñar: sin los cargos del final («Ayuntamiento de X - Junta de
 * Gobierno Local» → «Ayuntamiento de X»). Se quita cada trozo final que normalizarOrgano
 * también quita, así se conservan las tildes y las mayúsculas del nombre publicado.
 */
export function nombreOrgano(nombre: string | null): string | null {
  if (!nombre?.trim()) return null;
  const clave = normalizarOrgano(nombre);
  // Trozos y separadores alternos: al quitar un cargo se quita también su guion, y el resto
  // se queda como se publicó.
  const trozos = nombre.trim().split(/(\s*[-–]\s*)/);
  while (trozos.length > 2 && normalizarOrgano(trozos.slice(0, -2).join('')) === clave) trozos.splice(-2);
  return capitalizar(trozos.join(''));
}

/**
 * Condición «la fila es del sector» sobre una columna de CPV en formato «,72000000,».
 * Sin prefijos no filtra. `columna` es siempre un nombre fijo del código, nunca entrada.
 */
export function condicionSector(columna: string, cpvs: string[]): { sql: string; args: string[] } {
  if (!cpvs.length) return { sql: '1', args: [] };
  return { sql: `(${cpvs.map(() => `instr(${columna}, ',' || ?) > 0`).join(' OR ')})`, args: cpvs };
}

/** Patrón LIKE para buscar texto libre (sin comodines del usuario). */
export function patronTexto(texto: string | undefined): string | null {
  return texto ? `%${texto.replace(/[%_\\]/g, '')}%` : null;
}

export const NOTA_GANADORES =
  'Solo hay datos de los ganadores: la PLACSP publica quién gana cada contrato o lote, pero no la lista de todos los licitadores ni sus ofertas. Por eso no se puede saber en cuántos concursos participa una empresa ni cuántas veces pierde.';
