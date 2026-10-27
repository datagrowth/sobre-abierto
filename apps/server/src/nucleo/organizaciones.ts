// Organizaciones por NIF: un organismo, un competidor y un cliente pueden ser la misma entidad.
import type Database from 'better-sqlite3';
import {
  esUte,
  estadoNif,
  miembrosUte,
  nombreCanonico,
  normalizarNif,
  provinciaDeCp,
  type EstadoNif,
} from './identidad.js';

// Sin importar db.ts: db.ts importa este archivo para rellenar las organizaciones al migrar.
type Db = Database.Database;

export { normalizarNif };

// Los dominios las referencian, no las copian. Cada una guarda su identidad (identidad.ts): nombre canónico y
// alias, estado del NIF, si es una UTE (con sus miembros en ute_miembros) y la provincia.
type TipoOrganizacion = 'organismo' | 'empresa';

export type Organizacion = {
  nif: string;
  nombre: string;
  tipo: TipoOrganizacion;
  dir3?: string | null;
  ciudad?: string | null;
  nuts?: string | null;
  cp?: string | null;
};

export type OrganizacionGuardada = Organizacion & {
  actualizada_en: string;
  nombre_canonico: string | null;
  alias: string;
  provincia: string | null;
  es_ute: number;
  nif_estado: EstadoNif | null;
};

// Los alias sirven para buscar a una empresa por cualquiera de sus nombres; con 10 basta.
const MAX_ALIAS = 10;

function aliasCon(previos: string | undefined, nombre: string): string {
  let lista: string[] = [];
  try {
    const leidos: unknown = JSON.parse(previos ?? '[]');
    if (Array.isArray(leidos)) lista = leidos.filter((x): x is string => typeof x === 'string');
  } catch {
    // Un alias roto no impide guardar la organización: se empieza la lista de nuevo.
  }
  return JSON.stringify(lista.includes(nombre) || lista.length >= MAX_ALIAS ? lista : [...lista, nombre]);
}

/** Inserta o actualiza; un organismo nunca pasa a «empresa» por aparecer como adjudicatario. */
export function guardarOrganizacion(db: Db, org: Organizacion): void {
  const nif = normalizarNif(org.nif);
  const previa = db.prepare('SELECT alias FROM organizaciones WHERE nif = ?').get(nif) as { alias: string } | undefined;
  const ute = org.tipo === 'empresa' && esUte(nif, org.nombre);
  db.prepare(
    `INSERT INTO organizaciones (nif, nombre, tipo, dir3, ciudad, nuts, actualizada_en, nombre_canonico, alias, provincia, es_ute, nif_estado)
    VALUES (@nif, @nombre, @tipo, @dir3, @ciudad, @nuts, @ts, @canonico, @alias, @provincia, @ute, @estado)
    ON CONFLICT(nif) DO UPDATE SET nombre = excluded.nombre,
      tipo = CASE WHEN organizaciones.tipo = 'organismo' THEN 'organismo' ELSE excluded.tipo END,
      dir3 = COALESCE(excluded.dir3, organizaciones.dir3), ciudad = COALESCE(excluded.ciudad, organizaciones.ciudad),
      nuts = COALESCE(excluded.nuts, organizaciones.nuts), actualizada_en = excluded.actualizada_en,
      nombre_canonico = excluded.nombre_canonico, alias = excluded.alias, provincia = COALESCE(excluded.provincia, organizaciones.provincia),
      es_ute = MAX(organizaciones.es_ute, excluded.es_ute), nif_estado = excluded.nif_estado`,
  ).run({
    nif,
    nombre: org.nombre,
    tipo: org.tipo,
    dir3: org.dir3 ?? null,
    ciudad: org.ciudad ?? null,
    nuts: org.nuts ?? null,
    ts: new Date().toISOString(),
    canonico: nombreCanonico(org.nombre),
    alias: aliasCon(previa?.alias, org.nombre),
    provincia: provinciaDeCp(org.cp),
    ute: ute ? 1 : 0,
    estado: estadoNif(nif),
  });
  if (ute) guardarMiembrosUte(db, nif, org.nombre);
  else if (!previa && org.tipo === 'empresa') casarMiembrosPendientes(db, nif, nombreCanonico(org.nombre));
}

/** El NIF de la única empresa conocida con ese nombre canónico (sin UTE ni NIF inválido); null si no hay o hay varias. */
function nifPorNombre(db: Db, canonico: string): string | null {
  const filas = db
    .prepare(
      `SELECT nif FROM organizaciones WHERE nombre_canonico = ? AND tipo = 'empresa' AND es_ute = 0
    AND nif_estado <> 'no_valido' LIMIT 2`,
    )
    .all(canonico) as { nif: string }[];
  return filas.length === 1 ? filas[0]!.nif : null;
}

/** Separa la UTE en sus miembros la primera vez que se ve; los que no se casan quedan solo con su nombre. */
function guardarMiembrosUte(db: Db, uteNif: string, nombre: string): void {
  const ya = db.prepare('SELECT 1 FROM ute_miembros WHERE ute_nif = ? LIMIT 1').get(uteNif);
  if (ya) return;
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ute_miembros (ute_nif, miembro_nombre, miembro_canonico, miembro_nif) VALUES (?, ?, ?, ?)',
  );
  for (const miembro of miembrosUte(nombre)) {
    const canonico = nombreCanonico(miembro);
    ins.run(uteNif, miembro, canonico, nifPorNombre(db, canonico));
  }
}

// Una empresa que aparece después de su UTE: se casa con los miembros que la esperaban si su nombre es único.
function casarMiembrosPendientes(db: Db, nif: string, canonico: string): void {
  if (nifPorNombre(db, canonico) !== nif) return;
  db.prepare('UPDATE ute_miembros SET miembro_nif = ? WHERE miembro_nif IS NULL AND miembro_canonico = ?').run(
    nif,
    canonico,
  );
}

/**
 * Relleno de una vez al crear las columnas de identidad: los NIF con «ES» delante pasan al
 * normalizado (si ya estaba, se queda el que había), cada organización recibe su nombre
 * canónico, su primer alias, su estado de NIF y si es UTE, y las UTE se separan en miembros.
 */
export function rellenarIdentidad(db: Db): void {
  db.exec('CREATE INDEX IF NOT EXISTS organizaciones_canonico ON organizaciones(nombre_canonico, tipo)');
  for (const { nif } of db.prepare("SELECT nif FROM organizaciones WHERE nif GLOB 'ES*'").all() as { nif: string }[]) {
    const normal = normalizarNif(nif);
    if (normal === nif) continue;
    db.prepare('UPDATE OR IGNORE organizaciones SET nif = ? WHERE nif = ?').run(normal, nif);
    db.prepare('DELETE FROM organizaciones WHERE nif = ?').run(nif);
  }
  const filas = db.prepare('SELECT nif, nombre, tipo FROM organizaciones').all() as {
    nif: string;
    nombre: string;
    tipo: string;
  }[];
  const actualizar = db.prepare(
    'UPDATE organizaciones SET nombre_canonico = ?, alias = ?, es_ute = ?, nif_estado = ? WHERE nif = ?',
  );
  const utes: { nif: string; nombre: string }[] = [];
  for (const f of filas) {
    const ute = f.tipo === 'empresa' && esUte(f.nif, f.nombre);
    actualizar.run(nombreCanonico(f.nombre), JSON.stringify([f.nombre]), ute ? 1 : 0, estadoNif(f.nif), f.nif);
    if (ute) utes.push(f);
  }
  for (const u of utes) guardarMiembrosUte(db, u.nif, u.nombre);
}

export function obtenerOrganizacion(db: Db, nif: string): OrganizacionGuardada | null {
  const row = db.prepare('SELECT * FROM organizaciones WHERE nif = ?').get(normalizarNif(nif));
  return (row as OrganizacionGuardada | undefined) ?? null;
}

export type MiembroUte = { nombre: string; nif: string | null; porcentaje: number | null };

/** Miembros de una UTE (vacío si no lo es o no se pudieron separar). */
export function miembrosDeUte(db: Db, uteNif: string): MiembroUte[] {
  return db
    .prepare(
      `SELECT miembro_nombre AS nombre, miembro_nif AS nif, porcentaje FROM ute_miembros WHERE ute_nif = ?
    ORDER BY miembro_nombre`,
    )
    .all(normalizarNif(uteNif)) as MiembroUte[];
}

/** UTE en las que figura una empresa como miembro (por su NIF). */
export function utesDeEmpresa(db: Db, nif: string): string[] {
  return (
    db.prepare('SELECT ute_nif FROM ute_miembros WHERE miembro_nif = ? ORDER BY ute_nif').all(normalizarNif(nif)) as {
      ute_nif: string;
    }[]
  ).map((f) => f.ute_nif);
}
