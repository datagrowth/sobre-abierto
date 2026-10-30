// Frenos de la cola: un tipo, o un tipo para una oferta, que falla siempre deja de lanzarse unas
// horas; lo levantan una persona que lo pide a mano o el arranque de una versión nueva del servidor.
import { ahora, type Db } from './db.js';
import { claveReactivado, leerMarca, ponerMarca } from './colaMarcas.js';
import { ESPERA_HERRAMIENTA, esperaHerramienta } from './colaEsperas.js';
import { avisar, esDominioPersonal, recursoDe, tiposRegistrados, type Trabajo } from './colaTipos.js';
import { versionServidor } from './versionServidor.js';

// Freno: si los últimos trabajos de un tipo para una oferta acabaron todos fallidos, algo falla
// siempre con ella y reintentar solo gasta uso del modelo. Esa oferta espera unas horas o hasta
// que una persona la reactive; las demás del mismo tipo siguen (la urgente no paga los fallos
// de otras). Si fallan muchos seguidos repartidos entre varias ofertas, el fallo es del tipo
// (p. ej. el perfil de Hermes no tiene las herramientas) y se frena entero.
const FRENO_FALLOS = 3;
const FRENO_GLOBAL_FALLOS = 6;
const FRENO_GLOBAL_RECURSOS = 3;
const FRENO_MS = 6 * 60 * 60_000;

// Frenos de la vuelta anterior: solo el que aparece de nuevo avisa, no cada vuelta que sigue frenado.
let frenosVistos: Set<string> | null = null;

type Terminado = { estado: string; actualizado_en: string; recurso: unknown };

/**
 * Regla del freno tras desplegar, en forma pura: un freno cuyo último fallo es anterior al
 * arranque de una versión nueva del servidor ya no vale, porque esos fallos pueden ser de un error
 * que esta versión arregla. Vale igual para el freno del tipo y para el de una oferta.
 */
export function frenoSuperadoPorArranque(freno: { desde: number; ultimoFallo: number }, arranqueMs: number): boolean {
  return freno.ultimoFallo < arranqueMs;
}

// La última reactivación a mano que vale para ese recurso: la de su tipo o la suya (cola_marcas).
function reactivadoAMano(db: Db, tipo: string, recurso?: string): string {
  const delTipo = leerMarca(db, claveReactivado(tipo)) ?? '';
  const delRecurso = recurso === undefined ? '' : (leerMarca(db, claveReactivado(tipo, recurso)) ?? '');
  return delRecurso > delTipo ? delRecurso : delTipo;
}

// Los fallos que cuentan para el freno: desde esa reactivación o desde que arrancó esta versión
// del servidor (versionServidor.ts), lo último: un arreglo desplegado no espera a que caduque el freno.
function reactivadoDesde(db: Db, tipo: string, recurso?: string): string {
  const aMano = reactivadoAMano(db, tipo, recurso);
  const version = versionServidor()?.desde ?? '';
  return version > aMano ? version : aMano;
}

// El freno dura FRENO_MS desde el último de esos fallos (y caduca solo).
function frenoDesde(ultimos: Terminado[], ahoraMs: number): string | null {
  const hasta = Math.max(...ultimos.map((u) => Date.parse(u.actualizado_en))) + FRENO_MS;
  return hasta > ahoraMs ? new Date(hasta).toISOString() : null;
}

const todosFallidos = (u: Terminado[], n: number): boolean => u.length >= n && u.every((x) => x.estado === 'fallido');

/**
 * Freno del tipo entero: los FRENO_GLOBAL_FALLOS últimos terminados fallaron y son de al menos
 * FRENO_GLOBAL_RECURSOS ofertas distintas, o los FRENO_FALLOS últimos fallaron y alguno no es de
 * ninguna oferta (la criba, sin `id`: un fallo que no se puede atribuir es del tipo).
 */
function frenoGlobal(db: Db, tipo: string, desde: string, ahoraMs: number): string | null {
  const ultimos = db
    .prepare(
      `SELECT estado, actualizado_en, json_extract(payload, '$.id') AS recurso FROM trabajos_ia
    WHERE tipo = ? AND estado IN ('completado', 'fallido') AND actualizado_en > ? ORDER BY id DESC LIMIT ?`,
    )
    .all(tipo, desde, FRENO_GLOBAL_FALLOS) as Terminado[];
  const corto = ultimos.slice(0, FRENO_FALLOS);
  if (todosFallidos(corto, FRENO_FALLOS) && corto.some((u) => u.recurso === null)) return frenoDesde(corto, ahoraMs);
  const recursos = new Set(ultimos.map((u) => u.recurso).filter((r) => r !== null));
  if (todosFallidos(ultimos, FRENO_GLOBAL_FALLOS) && recursos.size >= FRENO_GLOBAL_RECURSOS)
    return frenoDesde(ultimos, ahoraMs);
  return null;
}

/** Freno de una oferta: sus FRENO_FALLOS últimos trabajos terminados de ese tipo fallaron todos. */
function frenoDeRecurso(db: Db, tipo: string, recurso: string, desde: string, ahoraMs: number): string | null {
  const ultimos = db
    .prepare(
      `SELECT estado, actualizado_en, json_extract(payload, '$.id') AS recurso FROM trabajos_ia
    WHERE tipo = ? AND json_extract(payload, '$.id') = ? AND estado IN ('completado', 'fallido') AND actualizado_en > ?
    ORDER BY id DESC LIMIT ?`,
    )
    .all(tipo, recurso, desde, FRENO_FALLOS) as Terminado[];
  return todosFallidos(ultimos, FRENO_FALLOS) ? frenoDesde(ultimos, ahoraMs) : null;
}

/**
 * Hasta cuándo está frenado un tipo (sin recurso: solo el freno del tipo entero) o un tipo para
 * una oferta (el del tipo o el suyo, el que dure más), contando desde la última reactivación a
 * mano o el arranque de una versión nueva del servidor. Se calcula de la tabla y de cola_marcas, así
 * que sobrevive a un reinicio. «Últimos» por orden de llegada, no de cierre: un trabajo que falla
 * tarda más en cerrarse (tres intentos con esperas), y por fecha de cierre los fallos de unas pocas
 * ofertas quedarían al final aunque entre medias otras hubieran salido bien.
 */
export function frenadoHasta(db: Db, tipo: string, ahoraMs = Date.now(), recurso?: string): string | null {
  const desde = reactivadoDesde(db, tipo, recurso);
  const global = frenoGlobal(db, tipo, desde, ahoraMs);
  const propio = recurso === undefined ? null : frenoDeRecurso(db, tipo, recurso, desde, ahoraMs);
  if (global === null || propio === null) return global ?? propio;
  return global > propio ? global : propio;
}

/**
 * Una persona pide la tarea a mano (p. ej. «Cribar ahora»): los fallos anteriores ya no frenan
 * el tipo, o solo esa oferta si se da `recurso`. Queda en cola_marcas: sobrevive a un reinicio.
 */
export function reactivarTipo(db: Db, tipo: string, recurso?: string): void {
  ponerMarca(db, claveReactivado(tipo, recurso), ahora());
}

/**
 * Además de quitar el freno (solo de esa oferta, con `recurso`: pedir una no se lo quita a las
 * demás), los trabajos que esperaban una herramienta vuelven a la cola ya. Esa espera sí es del
 * tipo entero (Hermes no tiene la herramienta: esperaHerramienta para todo el tipo), y pedirlo a
 * mano es la señal de que ya se reinició: dejar esperando a las demás ofertas retendría también
 * a la pedida.
 */
export function reanudarTipo(db: Db, tipo: string, recurso?: string): void {
  reactivarTipo(db, tipo, recurso);
  db.prepare('UPDATE trabajos_ia SET proximo_intento_en = NULL WHERE tipo = ? AND estado = ? AND error LIKE ?').run(
    tipo,
    'pendiente',
    `${ESPERA_HERRAMIENTA}%`,
  );
}

/**
 * Si un pendiente no puede salir en esta vuelta por un freno (del tipo o de su oferta) o porque
 * su tipo espera una herramienta. Se calcula una vez por tipo y oferta y vuelta.
 */
export function frenoDeVuelta(db: Db): (t: Trabajo) => boolean {
  const cache = new Map<string, boolean>();
  return (t) => {
    const recurso = recursoDe(t.payload);
    const clave = `${t.tipo}\n${recurso ?? ''}`;
    if (!cache.has(clave))
      cache.set(
        clave,
        frenadoHasta(db, t.tipo, Date.now(), recurso) !== null || esperaHerramienta(db, t.tipo) !== null,
      );
    return cache.get(clave)!;
  };
}

// Un freno que no estaba en la vuelta anterior avisa una vez, con el último fallo que lo causó.
// La primera vuelta tras arrancar solo toma nota: reiniciar no debe repetir los avisos de antes.
export function avisarFrenosNuevos(db: Db): void {
  const ahoraSet = new Set<string>();
  for (const f of frenadosDeLaCola(db)) {
    const clave = `${f.tipo}
${f.recurso ?? ''}`;
    ahoraSet.add(clave);
    if (frenosVistos === null || frenosVistos.has(clave)) continue;
    const ultimo = db
      .prepare(
        `SELECT * FROM trabajos_ia WHERE tipo = ? AND estado = 'fallido'
      AND (? IS NULL OR json_extract(payload, '$.id') = ?) ORDER BY actualizado_en DESC LIMIT 1`,
      )
      .get(f.tipo, f.recurso, f.recurso) as Trabajo | undefined;
    if (ultimo) avisar(db, ultimo, 'frenado', { proximo_intento_en: f.hasta });
  }
  frenosVistos = ahoraSet;
}

// recurso null: el tipo entero está frenado.
export type Frenado = { tipo: string; hasta: string; recurso: string | null };

/**
 * Las ofertas de un tipo con un fallido en las últimas FRENO_MS (solo esas pueden estar frenadas
 * por su cuenta). Las de dominios con datos personales no salen: su `id` diría de quién son.
 */
export function recursosConFallos(db: Db, tipo: string, ahoraMs: number): string[] {
  const filas = db
    .prepare(
      `SELECT DISTINCT json_extract(payload, '$.id') AS recurso, dominio FROM trabajos_ia
    WHERE tipo = ? AND estado = 'fallido' AND actualizado_en > ? ORDER BY recurso`,
    )
    .all(tipo, new Date(ahoraMs - FRENO_MS).toISOString()) as { recurso: unknown; dominio: string }[];
  const recursos = filas
    .filter((f) => typeof f.recurso === 'string' && !esDominioPersonal(f.dominio))
    .map((f) => f.recurso as string);
  return [...new Set(recursos)];
}

/** Lo frenado de un tipo: el tipo entero (recurso null) y cada oferta frenada por sus fallos. */
export function frenadosDeTipo(db: Db, tipo: string, ahoraMs = Date.now()): Frenado[] {
  const global = frenadoHasta(db, tipo, ahoraMs);
  const out: Frenado[] = global ? [{ tipo, hasta: global, recurso: null }] : [];
  for (const recurso of recursosConFallos(db, tipo, ahoraMs)) {
    const hasta = frenoDeRecurso(db, tipo, recurso, reactivadoDesde(db, tipo, recurso), ahoraMs);
    if (hasta) out.push({ tipo, hasta, recurso });
  }
  return out;
}

export const frenadosDeLaCola = (db: Db): Frenado[] => tiposRegistrados().flatMap((tipo) => frenadosDeTipo(db, tipo));

// ofertas: los frenos por oferta (cola_marcas) que levantó, solo si hay alguno.
export type LevantadosPorVersion = { desde: string; tipos: string[]; ofertas?: { tipo: string; recurso: string }[] };

// Con solo las reactivaciones a mano seguiría frenado, pero lo supera el arranque de esta versión.
function superado(hasta: string | null, desde: string, arranqueMs: number): boolean {
  if (hasta === null) return false;
  return frenoSuperadoPorArranque(
    { desde: desde ? Date.parse(desde) : 0, ultimoFallo: Date.parse(hasta) - FRENO_MS },
    arranqueMs,
  );
}

/** Los frenos (del tipo o de una oferta) que seguirían puestos con los fallos de antes de esta versión (null si ninguno): para Estado y Programado. */
export function frenosLevantadosPorVersion(db: Db, ahoraMs = Date.now()): LevantadosPorVersion | null {
  const v = versionServidor();
  if (!v) return null;
  const arranque = Date.parse(v.desde);
  const delTipo = tiposRegistrados().filter((tipo) => {
    const desde = reactivadoAMano(db, tipo);
    return superado(frenoGlobal(db, tipo, desde, ahoraMs), desde, arranque);
  });
  const ofertas = tiposRegistrados().flatMap((tipo) =>
    recursosConFallos(db, tipo, ahoraMs)
      .filter((recurso) => {
        const desde = reactivadoAMano(db, tipo, recurso);
        return superado(frenoDeRecurso(db, tipo, recurso, desde, ahoraMs), desde, arranque);
      })
      .map((recurso) => ({ tipo, recurso })),
  );
  if (!delTipo.length && !ofertas.length) return null;
  return { desde: v.desde, tipos: delTipo, ...(ofertas.length ? { ofertas } : {}) };
}
