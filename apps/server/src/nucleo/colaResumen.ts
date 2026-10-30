// La pastilla «Hermes» de la barra lateral: qué corre, qué espera y qué falló, separado por dominio.
import type { Db } from './db.js';
import { logger } from './log.js';
import { errorMessage } from './result.js';
import { pausaHastaMs } from './colaEsperas.js';
import { ZOMBI_MS } from './colaRelanzado.js';
import { esDominioPersonal, nombreDe, tiposConHermes } from './colaTipos.js';

// Separado por dominio para que los zombis de un dominio sin IA (sin perfil de Hermes) no parezcan trabajo
// atascado de otro. El núcleo no conoce los títulos de los recursos: cada dominio registra cómo leerlos.
export type Titulos = (ids: string[]) => Record<string, string>;

// nombre: el del dominio (fijarNombreTrabajos), el mismo que enseña HermesEnVivo.
type EnMarcha = { tipo: string; nombre: string; recurso: string | null; titulo: string | null };
export type ResumenDominio = {
  dominio: string;
  en_marcha: EnMarcha[];
  en_cola: number;
  fallos_24h: number;
  zombis: number;
  en_pausa: boolean;
  motivo_pausa: 'sin_perfil' | 'limite' | null;
};

const DIA_MS = 86_400_000;
const titulos = new Map<string, Titulos>();
const log = logger('cola');

export function registrarTitulos(dominio: string, fn: Titulos): void {
  titulos.set(dominio, fn);
}

// Un dominio cuyo lector falla deja la pastilla sin títulos, no sin pastilla.
function titulosDe(dominio: string, ids: string[]): Record<string, string> {
  const fn = titulos.get(dominio);
  if (!fn || !ids.length) return {};
  try {
    return fn(ids);
  } catch (err) {
    log.warn('títulos de la cola sin leer', { dominio, error: errorMessage(err) });
    return {};
  }
}

type Lanzado = { tipo: string; payload: string; recurso: unknown };

function enMarchaDe(db: Db, dominio: string): EnMarcha[] {
  const filas = db
    .prepare(
      `SELECT tipo, payload, json_extract(payload, '$.id') AS recurso FROM trabajos_ia
    WHERE dominio = ? AND estado = 'lanzado' ORDER BY id`,
    )
    .all(dominio) as Lanzado[];
  // De quién es un trabajo de un dominio con datos personales no sale de aquí: ni el recurso ni
  // lo que el payload añadiría al nombre.
  if (esDominioPersonal(dominio))
    return filas.map((f) => ({ tipo: f.tipo, nombre: nombreDe(dominio, f.tipo), recurso: null, titulo: null }));
  const ids = [...new Set(filas.map((f) => f.recurso).filter((r): r is string => typeof r === 'string'))];
  const leidos = titulosDe(dominio, ids);
  return filas.map((f) => {
    const recurso = typeof f.recurso === 'string' ? f.recurso : null;
    return {
      tipo: f.tipo,
      nombre: nombreDe(dominio, f.tipo, f.payload),
      recurso,
      titulo: recurso === null ? null : (leidos[recurso] ?? null),
    };
  });
}

type Cuentas = { en_cola: number; fallos_24h: number; zombis: number };

// Zombi con la misma regla que cancelarZombis: uno relanzado a mano o con el reloj reiniciado por
// un freno tiene actualizado_en reciente y todavía puede salir.
function cuentasDe(db: Db, dominio: string, ahoraMs: number): Cuentas {
  return db
    .prepare(
      `SELECT
      COALESCE(SUM(estado = 'pendiente'), 0) AS en_cola,
      COALESCE(SUM(estado = 'fallido' AND actualizado_en >= @dia), 0) AS fallos_24h,
      COALESCE(SUM(estado = 'pendiente' AND lanzado_en IS NULL AND creado_en < @zombi AND actualizado_en < @zombi), 0) AS zombis
    FROM trabajos_ia WHERE dominio = @dominio`,
    )
    .get({
      dia: new Date(ahoraMs - DIA_MS).toISOString(),
      zombi: new Date(ahoraMs - ZOMBI_MS).toISOString(),
      dominio,
    }) as Cuentas;
}

// Sin perfil antes que el límite: el límite pasa solo en minutos, la falta de perfil no.
function pausaDe(
  db: Db,
  dominio: string,
  conHermes: Set<string>,
  pausaLimite: boolean,
): Pick<ResumenDominio, 'en_pausa' | 'motivo_pausa'> {
  const tipos = db.prepare('SELECT DISTINCT tipo FROM trabajos_ia WHERE dominio = ?').all(dominio) as {
    tipo: string;
  }[];
  if (!tipos.some((t) => conHermes.has(t.tipo))) return { en_pausa: true, motivo_pausa: 'sin_perfil' };
  return pausaLimite ? { en_pausa: true, motivo_pausa: 'limite' } : { en_pausa: false, motivo_pausa: null };
}

// Solo los dominios con algo que contar: lo vivo o un fallo reciente.
function dominiosConAlgo(db: Db, ahoraMs: number): string[] {
  return (
    db
      .prepare(
        `SELECT DISTINCT dominio FROM trabajos_ia WHERE estado IN ('pendiente', 'lanzado')
    OR (estado = 'fallido' AND actualizado_en >= ?) ORDER BY dominio`,
      )
      .all(new Date(ahoraMs - DIA_MS).toISOString()) as { dominio: string }[]
  ).map((f) => f.dominio);
}

/** La pastilla «Hermes»: por dominio, lo que corre (con el título del recurso), lo que espera, los fallos de 24 h, los zombis y si está en pausa. */
export function resumenPorDominio(db: Db, ahoraMs = Date.now()): { dominios: ResumenDominio[] } {
  const conHermes = new Set(tiposConHermes());
  const pausaLimite = pausaHastaMs(db, ahoraMs) > ahoraMs;
  return {
    dominios: dominiosConAlgo(db, ahoraMs).map((dominio) => ({
      dominio,
      en_marcha: enMarchaDe(db, dominio),
      ...cuentasDe(db, dominio, ahoraMs),
      ...pausaDe(db, dominio, conHermes, pausaLimite),
    })),
  };
}
