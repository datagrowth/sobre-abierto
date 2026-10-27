// Ediciones anteriores de una licitación: del mismo órgano, publicadas antes y con objeto, CPV e importe parecidos.
import { FACTOR_BANDA } from '../precios/segmento.js';
import type { Db } from '../store.js';
import { sqlOrgano, type ClaveOrgano } from './organo.js';
import { esDerivado, palabrasGuardadas, propiasEnAmbos, similitud, type Pesos } from './texto.js';
import { lugaresDe, otroLugar } from './lugares.js';

// Todo es código sobre datos de la PLACSP. El objeto se compara por las palabras del título ponderadas por su
// rareza dentro del órgano.
// Umbrales medidos con ediciones de la PLACSP separadas por dos años (perfiles y agregadas),
// revisando a mano muestras de parejas:
// - desde 0,7 el título es casi el mismo (cambian años, números o una palabra): vale
//   aunque el importe haya cambiado mucho (p. ej. de uno a cuatro años de contrato);
// - entre 0,5 y 0,7 casi siempre es la misma licitación si comparten CPV (2 cifras) y el
//   importe no es muy distinto (sin CPV común salían cosas como «aceite» frente a «higiene»
//   para los mismos centros), salvo el mismo servicio en otro sitio (ver lugares.ts y
//   propiasEnAmbos);
// - por debajo de 0,5, menos de la mitad de una muestra revisada eran la misma licitación
//   (otra ruta, otro evento, otro material): no cuentan.
const UMBRAL_TITULO = 0.7;
export const UMBRAL_PARECIDO = 0.5;
// Solo cuentan las publicadas al menos seis meses antes. Medido con datos reales: lo
// publicado por el mismo órgano en los meses anteriores con título parecido era casi
// siempre otra parte del mismo proyecto (otra ruta, otro hospital, la seguridad de las
// mismas fiestas) o la misma licitación repetida tras quedar desierta, no una edición anterior.
const SEPARACION_DIAS = 180;
// Un órgano muy grande (un servicio de salud con el histórico entero) se lee desde lo más
// reciente hasta este tope.
const MAX_CANDIDATAS = 20_000;
// Procedimientos derivados de acuerdo marco, de asociación para la innovación o de un
// sistema dinámico: repiten el título del acuerdo y no son ediciones.
const DERIVADOS = new Set(['7', '11', '12']);

export type Candidata = {
  id: string;
  expediente: string;
  titulo: string;
  url: string | null;
  estado: string;
  cpvs: string[];
  presupuesto: number | null;
  fecha: string;
  palabras: Set<string>;
};
// lugares: provincias o ciudades que nombra (lugares.ts).
export type Objeto = { palabras: Set<string>; cpvs: string[]; importe: number | null; lugares: Set<string> };
// importe_parecido: null si alguna de las dos no publica importe.
// distinto_lugar: cada título tiene una palabra propia que el otro no (otra provincia, otro centro).
export type Parecido = {
  similitud: number;
  cpv_comun: string | null;
  importe_parecido: boolean | null;
  distinto_lugar: boolean;
};
export type Encontrada = Candidata & Parecido;

type FilaCandidata = Omit<Candidata, 'cpvs' | 'palabras'> & { cpvs: string; titulo_palabras: string | null };

// Fecha de una edición: su anuncio de licitación o, si no consta (guardada antes de
// leerlo), la primera adjudicación o la última versión.
export const SQL_FECHA_EDICION = `COALESCE(l.publicada_en, (SELECT MIN(a.fecha_ref) FROM adjudicaciones a WHERE a.licitacion_id = l.id),
  substr(l.actualizada_en, 1, 10))`;

export function restarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);
}

const SQL_NO_DERIVADO = `COALESCE(l.procedimiento, '') NOT IN (${[...DERIVADOS].map((d) => `'${d}'`).join(', ')})`;

// Las licitaciones de un órgano ya leídas, por su clave: en una criba de 40 candidatas, las
// de un mismo órgano grande se leen una sola vez.
export type CacheOrganos = Map<string, Candidata[]>;

/**
 * Licitaciones del órgano (las MAX_CANDIDATAS más recientes) sin los procedimientos
 * derivados; los títulos de contrato basado se quitan al buscar.
 */
export function candidatasDelOrgano(db: Db, clave: ClaveOrgano, cache: CacheOrganos = new Map()): Candidata[] {
  const k = JSON.stringify(clave);
  const leidas = cache.get(k);
  if (leidas) return leidas;
  const organo = sqlOrgano(clave, 'l');
  const filas = db
    .prepare(
      `SELECT l.id, l.expediente, l.titulo, l.titulo_palabras, l.url, l.estado, l.cpvs, l.presupuesto_sin_iva AS presupuesto,
      ${SQL_FECHA_EDICION} AS fecha
    FROM licitaciones l WHERE ${organo.sql} AND ${SQL_NO_DERIVADO} ORDER BY l.actualizada_en DESC LIMIT ?`,
    )
    .all(...organo.args, MAX_CANDIDATAS) as FilaCandidata[];
  const candidatas = filas.map(({ titulo_palabras: guardadas, ...f }) => ({
    ...f,
    cpvs: f.cpvs.split(',').filter(Boolean),
    palabras: palabrasGuardadas(guardadas, f.titulo),
  }));
  cache.set(k, candidatas);
  return candidatas;
}

/** Las publicadas al menos seis meses antes de `referencia`, sin la propia. */
export function anterioresA(candidatas: Candidata[], excluir: string, referencia: string): Candidata[] {
  const antes = restarDias(referencia, SEPARACION_DIAS);
  return candidatas.filter((c) => c.id !== excluir && c.fecha <= antes);
}

/** El prefijo más largo que comparten dos CPV de las listas (2 cifras o más), o null. */
function cpvComun(a: string[], b: string[]): string | null {
  let mejor = '';
  for (const x of a)
    for (const y of b) {
      let n = 0;
      while (n < 8 && x[n] === y[n]) n += 1;
      if (n > mejor.length) mejor = x.slice(0, n);
    }
  return mejor.length >= 2 ? mejor : null;
}

function importeParecido(a: number | null, b: number | null): boolean | null {
  if (!a || !b) return null;
  return a / b <= FACTOR_BANDA && b / a <= FACTOR_BANDA;
}

function parecido(o: Objeto, c: Pick<Candidata, 'palabras' | 'cpvs' | 'presupuesto'>, pesos: Pesos): Parecido {
  return {
    similitud: similitud(o.palabras, c.palabras, pesos),
    cpv_comun: cpvComun(o.cpvs, c.cpvs),
    importe_parecido: importeParecido(o.importe, c.presupuesto),
    distinto_lugar: propiasEnAmbos(o.palabras, c.palabras, pesos),
  };
}

/** Reglas de la cabecera: título casi igual, o parecido con CPV común e importe no muy distinto. */
export function esEdicion(p: Parecido): boolean {
  if (p.similitud >= UMBRAL_TITULO) return true;
  return p.similitud >= UMBRAL_PARECIDO && !p.distinto_lugar && p.cpv_comun !== null && p.importe_parecido !== false;
}

/**
 * Una adjudicación del mismo órgano solo cuenta como edición anterior si el objeto se parece
 * (UMBRAL_PARECIDO, el mismo de las ediciones) y comparte CPV; las demás son «otro objeto del
 * mismo órgano»: dicen que el órgano contrata, no quién ganó esta licitación antes.
 */
export function otroObjetoDelOrgano(c: {
  mismo_organo: boolean;
  parecido: number | null;
  cpv_comun: string | null;
}): boolean {
  return c.mismo_organo && !((c.parecido ?? 0) >= UMBRAL_PARECIDO && c.cpv_comun !== null);
}

/** Las `limite` ediciones más parecidas, de la más reciente a la más antigua. */
export function buscarEdiciones(candidatas: Candidata[], o: Objeto, pesos: Pesos, limite: number): Encontrada[] {
  if (!o.palabras.size) return [];
  const porParecido = candidatas
    .map((c) => ({ ...c, ...parecido(o, c, pesos) }))
    .filter(esEdicion)
    .sort((a, b) => b.similitud - a.similitud);
  // Lugares y contratos basados (regex sobre el título) solo de las mejores, hasta tener `limite`.
  const mejores: Encontrada[] = [];
  for (const c of porParecido) {
    if (mejores.length >= limite) break;
    if (!otroLugar(o.lugares, lugaresDe(c.titulo)) && !esDerivado(c.titulo)) mejores.push(c);
  }
  return mejores.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export const DESCRIPCION_BUSQUEDA = `Ediciones anteriores: licitaciones del mismo órgano publicadas al menos seis meses antes que esta, sin contratos basados en un acuerdo marco, cuyo objeto se parece. El parecido compara las palabras del título sin años, números de expediente ni palabras vacías, y pesa más las que el órgano usa poco (su nombre o «hospital» apenas cuentan). Cuenta como edición con un parecido de ${UMBRAL_TITULO} o más, o de ${UMBRAL_PARECIDO} o más si comparten CPV (al menos la división, 2 cifras), el importe no se sale de entre un tercio y el triple y no tiene cada título una palabra que el órgano casi no usa y el otro no (otro centro, otra ruta). Nunca si nombran provincias, ciudades o comunidades distintas: es el mismo servicio en otro sitio. En licitaciones con lotes, cada lote se busca por su nombre y se casa con el lote de nombre más parecido de cada edición.`;
