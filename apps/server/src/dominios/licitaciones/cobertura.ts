// Auditoría de cobertura de la PLACSP por comunidad autónoma.
import { z } from 'zod';
import type { Db } from './store.js';
import { esDelSector, sectorActual, type Sector } from './historico.js';
import { nombreTerritorio, territorioDe } from './competencia/territorios.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import { fail, ok, type Result } from '../../nucleo/result.js';

// Se separan por comunidad (NUTS 2) y por fuente: la agregada
// (plataformas autonómicas y entidades locales) y los perfiles (Estado). Lo que publica cada
// plataforma autonómica en sus datos abiertos se apunta a mano por semana: cada portal tiene
// su formato y la auditoría decide antes si merece la pena leerlos por código. Solo se añade
// una fuente directa si a la agregada le falta más de un 5 % (`UMBRAL_FALTA`). Solo informa:
// no cambia la ingesta.

// Cuenta cada semana las licitaciones del sector de la empresa por lugar de ejecución y fuente.
const UMBRAL_FALTA = 0.05;
/** Semanas que se recalculan en cada pasada: la PLACSP publica con retraso lo de días atrás. */
const SEMANAS_AUDITORIA = 4;
const SIN_COMUNIDAD = 'sin_comunidad';
const DIA_MS = 86_400_000;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const sumarDias = (fecha: string, dias: number) =>
  new Date(Date.parse(`${fecha}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10);

/** El lunes de la semana de `fecha` («AAAA-MM-DD»). */
export function lunesDe(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  return sumarDias(fecha, -((dia + 6) % 7));
}

/** Los lunes de las `n` últimas semanas cerradas antes de `hoy` (hora peninsular), del más antiguo al más reciente. */
export function semanasCerradas(hoy: string, n = SEMANAS_AUDITORIA): string[] {
  const ultima = sumarDias(lunesDe(hoy), -7);
  return Array.from({ length: n }, (_, i) => sumarDias(ultima, -7 * (n - 1 - i)));
}

type Fila = { fuente: string; nuts: string | null; cpvs: string; titulo: string; datos: string };
type Cuenta = { agregadas: number; perfiles: number };

function comunidadDe(nuts: string | null): string {
  const t = territorioDe(nuts);
  return t && /^ES[0-9A-Z]{2}$/.test(t) ? t : SIN_COMUNIDAD;
}

function lotesDe(datos: string): { cpvs: string[] }[] {
  const lotes = (JSON.parse(datos) as { lotes?: { cpvs?: string[] }[] }).lotes ?? [];
  return lotes.map((l) => ({ cpvs: l.cpvs ?? [] }));
}

/** Cuántas del sector de la empresa se publicaron esa semana, por comunidad y fuente. */
function contarSemana(db: Db, sector: Sector, lunes: string): Map<string, Cuenta> {
  const filas = db
    .prepare(
      `SELECT fuente, nuts, cpvs, titulo, datos FROM licitaciones
    WHERE publicada_en >= ? AND publicada_en < ?`,
    )
    .all(lunes, sumarDias(lunes, 7)) as Fila[];
  const cuentas = new Map<string, Cuenta>();
  for (const f of filas) {
    const l = { titulo: f.titulo, cpvs: f.cpvs.split(',').filter(Boolean), lotes: lotesDe(f.datos) };
    if (!esDelSector(sector, l as Parameters<typeof esDelSector>[1])) continue;
    const c = cuentas.get(comunidadDe(f.nuts)) ?? { agregadas: 0, perfiles: 0 };
    if (f.fuente === 'agregadas') c.agregadas += 1;
    else c.perfiles += 1;
    cuentas.set(comunidadDe(f.nuts), c);
  }
  return cuentas;
}

function guardarSemana(db: Db, lunes: string, cuentas: Map<string, Cuenta>, ahora: string): void {
  db.prepare('DELETE FROM cobertura_semanal WHERE semana = ?').run(lunes);
  const insertar = db.prepare(
    'INSERT INTO cobertura_semanal (semana, comunidad, agregadas, perfiles, calculada_en) VALUES (?, ?, ?, ?, ?)',
  );
  for (const [comunidad, c] of cuentas) insertar.run(lunes, comunidad, c.agregadas, c.perfiles, ahora);
}

/** La última vez que se contó (hora peninsular), o null si nunca. */
export function ultimaCobertura(db: Db): string | null {
  return (db.prepare('SELECT MAX(calculada_en) AS u FROM cobertura_semanal').get() as { u: string | null }).u;
}

/**
 * Cuenta las últimas semanas cerradas si falta la más reciente. Con lo ya guardado no hace nada:
 * se puede llamar en cada vuelta del radar. Devuelve las semanas contadas.
 */
export function vueltaCobertura(db: Db, ms = Date.now()): string[] {
  const ahora = horaLocalEspana(ms);
  const semanas = semanasCerradas(ahora.slice(0, 10));
  const hecha = db.prepare('SELECT 1 FROM cobertura_semanal WHERE semana = ? LIMIT 1').get(semanas.at(-1));
  if (hecha) return [];
  const sector = sectorActual(db, false);
  db.transaction(() => {
    for (const s of semanas) guardarSemana(db, s, contarSemana(db, sector, s), ahora);
  })();
  return semanas;
}

export const AnotacionAutonomica = z.strictObject({
  semana: z
    .string()
    .regex(FECHA, 'semana: el lunes en AAAA-MM-DD.')
    .refine((s) => lunesDe(s) === s, 'semana: tiene que ser un lunes.'),
  comunidad: z.string().regex(/^ES[0-9A-Z]{2}$/, 'comunidad: código NUTS 2, p. ej. ES51.'),
  publicadas: z.number().int().min(0).max(100_000),
  fuente: z.string().trim().min(3).max(300),
});
export type AnotacionAutonomica = z.infer<typeof AnotacionAutonomica>;

/** Apunta lo que publicó la plataforma autonómica esa semana (sus datos abiertos), con de dónde sale. */
export function anotarAutonomica(db: Db, a: AnotacionAutonomica, ms = Date.now()): Result<AnotacionAutonomica> {
  if (a.semana >= lunesDe(horaLocalEspana(ms).slice(0, 10)))
    return fail('invalid_input', 'Esa semana aún no ha terminado: se apunta cuando cierra.');
  db.prepare(
    `INSERT INTO cobertura_autonomica (semana, comunidad, publicadas, fuente, anotada_en) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (semana, comunidad) DO UPDATE SET publicadas = excluded.publicadas, fuente = excluded.fuente, anotada_en = excluded.anotada_en`,
  ).run(a.semana, a.comunidad, a.publicadas, a.fuente, horaLocalEspana(ms));
  return ok(a);
}

type Veredicto = 'anadir_fuente' | 'basta_placsp' | 'sin_dato';
type SemanaCobertura = {
  semana: string;
  agregadas: number;
  perfiles: number;
  autonomica: number | null;
  fuente: string | null;
};
type ComunidadCobertura = {
  comunidad: string;
  nombre: string;
  agregadas: number;
  perfiles: number;
  /** Solo de las semanas con la cifra autonómica apuntada, para comparar lo mismo con lo mismo. */
  comparadas: number;
  agregadas_comparadas: number;
  autonomica: number;
  falta: number | null;
  veredicto: Veredicto;
  semanas: SemanaCobertura[];
};
export type InformeCobertura = {
  umbral_falta: number;
  desde: string | null;
  hasta: string | null;
  calculada_en: string | null;
  comunidades: ComunidadCobertura[];
};

/** Lo que le falta a la agregada frente a la autonómica (0 a 1), o null si no hay con qué comparar. */
export function falta(agregadas: number, autonomica: number): number | null {
  if (autonomica <= 0) return null;
  return Math.max(0, autonomica - agregadas) / autonomica;
}

function veredicto(f: number | null): Veredicto {
  if (f === null) return 'sin_dato';
  return f > UMBRAL_FALTA ? 'anadir_fuente' : 'basta_placsp';
}

function resumirComunidad(comunidad: string, semanas: SemanaCobertura[]): ComunidadCobertura {
  const suma = (xs: SemanaCobertura[], k: 'agregadas' | 'perfiles') => xs.reduce((t, s) => t + s[k], 0);
  const comparadas = semanas.filter((s) => s.autonomica !== null);
  const autonomica = comparadas.reduce((t, s) => t + (s.autonomica ?? 0), 0);
  const f = falta(suma(comparadas, 'agregadas'), autonomica);
  return {
    comunidad,
    nombre: comunidad === SIN_COMUNIDAD ? 'Sin comunidad (lugar sin detallar)' : nombreTerritorio(comunidad),
    agregadas: suma(semanas, 'agregadas'),
    perfiles: suma(semanas, 'perfiles'),
    comparadas: comparadas.length,
    agregadas_comparadas: suma(comparadas, 'agregadas'),
    autonomica,
    falta: f,
    veredicto: veredicto(f),
    semanas,
  };
}

/** El informe: por comunidad, lo que trajo la PLACSP, lo apuntado de su plataforma y si hace falta una fuente directa. */
export function informeCobertura(db: Db): InformeCobertura {
  const filas = db
    .prepare(
      `SELECT c.semana, c.comunidad, c.agregadas, c.perfiles, a.publicadas AS autonomica, a.fuente
    FROM cobertura_semanal c LEFT JOIN cobertura_autonomica a ON a.semana = c.semana AND a.comunidad = c.comunidad
    UNION ALL
    SELECT a.semana, a.comunidad, 0, 0, a.publicadas, a.fuente FROM cobertura_autonomica a
    WHERE NOT EXISTS (SELECT 1 FROM cobertura_semanal c WHERE c.semana = a.semana AND c.comunidad = a.comunidad)
    ORDER BY 2, 1`,
    )
    .all() as (SemanaCobertura & { comunidad: string })[];
  const porComunidad = new Map<string, SemanaCobertura[]>();
  for (const { comunidad, ...s } of filas) porComunidad.set(comunidad, [...(porComunidad.get(comunidad) ?? []), s]);
  const comunidades = [...porComunidad]
    .map(([c, s]) => resumirComunidad(c, s))
    .sort((a, b) => (b.falta ?? -1) - (a.falta ?? -1) || b.agregadas - a.agregadas);
  const semanas = filas.map((f) => f.semana).sort();
  return {
    umbral_falta: UMBRAL_FALTA,
    desde: semanas[0] ?? null,
    hasta: semanas.at(-1) ?? null,
    calculada_en: ultimaCobertura(db),
    comunidades,
  };
}
