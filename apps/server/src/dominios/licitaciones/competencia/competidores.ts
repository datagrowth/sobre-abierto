// Competidores: quién gana en el sector de la empresa (ranking «en el punto de mira») y la ficha
// de cada uno por NIF. Todo sale de las adjudicaciones de la PLACSP, sin IA.
import { z } from 'zod';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { SQL_PLAUSIBLE } from '../precios/segmento.js';
import type { Db } from '../store.js';
import {
  ambitoDe,
  condicionEscala,
  condicionSector,
  NOTA_GANADORES,
  nombreEmpresa,
  OpcionesAmbito,
  patronTexto,
  siguienteDe,
  type Ambito,
} from './ambito.js';
import {
  ARGS_ADJUDICADO,
  conNombres,
  cpvsFrecuentes,
  importeTotal,
  nombresDe,
  porAnio,
  resumenBajas,
  resumenOfertas,
  SELECT_FILAS,
  SQL_ADJUDICADO,
  territorios,
  topGrupos,
  ultimosContratos,
  type Contrato,
  type FilaAdj,
  type Grupo,
  type ResumenBajas,
  type ResumenOfertas,
} from './agregados.js';
import { SQL_IMPORTE_MERCADO } from '../calidad.js';
import { clasesSeguidas, coincidencias, oportunidadesSeguidas, sqlSeguidas, type Coincidencia } from './nuestras.js';
import { nifsSeguidos, seguidoDe, type Seguido } from './seguidos.js';
import { miembrosDeUte, obtenerOrganizacion, utesDeEmpresa, type MiembroUte } from '../../../nucleo/organizaciones.js';

const ORDEN_COMPETIDORES = ['importe', 'contratos', 'coincidencias'] as const;
export const OpcionesCompetidores = OpcionesAmbito.extend({
  orden: z
    .enum(ORDEN_COMPETIDORES)
    .default('importe')
    .describe('importe ganado, nº de contratos o coincidencias con lo que seguimos'),
});
export type OpcionesCompetidoresData = z.infer<typeof OpcionesCompetidores>;

export type FilaRanking = {
  nif: string;
  nombre: string | null;
  contratos: number;
  importe: number;
  organos: number;
  baja_media: number | null;
  ofertas_media: number | null;
  pyme: number | null;
  ultimo: string | null;
  coincidencias: { total: number; mismo_organo: number; mismo_cpv: number };
  seguido: boolean;
};

type FilaSql = Omit<FilaRanking, 'coincidencias' | 'seguido'> & {
  total: number;
  c_total: number;
  c_organo: number;
  c_cpv: number;
};

// Las columnas por las que se ordena salen de esta tabla, nunca de la entrada.
const ORDEN_SQL: Record<(typeof ORDEN_COMPETIDORES)[number], string> = {
  importe: 'importe',
  contratos: 'contratos',
  coincidencias: 'c_total',
};

// El órgano se cruza con una subconsulta (SQLite la resuelve una vez): sin tope de órganos.
function sqlCruce(db: Db, hoy: Date): { organo: string; cpv: string; args: string[] } {
  const seguidas = sqlSeguidas(hoy);
  const clases = clasesSeguidas(oportunidadesSeguidas(db, hoy));
  const organo = `a.organo_nif IN (SELECT l.organo_nif ${seguidas.sql})`;
  const cpv = clases.length ? `(${clases.map(() => "instr(a.cpvs, ',' || ?) > 0").join(' OR ')})` : '0';
  return { organo, cpv, args: [...seguidas.args, ...clases, ...seguidas.args, ...clases] };
}

// NOT INDEXED: con el índice por NIF, SQLite recorre en orden de NIF saltando a cada fila
// (2,4 s con 400.000 adjudicaciones en disco); leyendo la tabla seguida tarda 0,1 s.
function consultaRanking(db: Db, a: Ambito, o: OpcionesCompetidoresData, hoy: Date): FilaSql[] {
  const cruce = sqlCruce(db, hoy);
  const sector = condicionSector('a.cpvs', a.cpvs);
  const escala = condicionEscala('COALESCE(a.presupuesto_sin_iva, a.importe_sin_iva)', 'a.nuts', a);
  const texto = patronTexto(o.texto);
  const sql = `SELECT a.adjudicatario_nif AS nif, MAX(a.adjudicatario_nombre) AS nombre, COUNT(*) AS contratos,
      COALESCE(SUM(${SQL_IMPORTE_MERCADO}), 0) AS importe, COUNT(DISTINCT a.organo_nif) AS organos,
      AVG(CASE WHEN ${SQL_PLAUSIBLE} THEN a.baja END) AS baja_media, AVG(CASE WHEN a.ofertas >= 1 THEN a.ofertas END) AS ofertas_media,
      AVG(a.pyme) AS pyme, MAX(a.fecha_ref) AS ultimo,
      SUM(CASE WHEN ${cruce.organo} OR ${cruce.cpv} THEN 1 ELSE 0 END) AS c_total,
      SUM(CASE WHEN ${cruce.organo} THEN 1 ELSE 0 END) AS c_organo, SUM(CASE WHEN ${cruce.cpv} THEN 1 ELSE 0 END) AS c_cpv,
      COUNT(*) OVER () AS total
    FROM adjudicaciones AS a NOT INDEXED
    WHERE ${SQL_ADJUDICADO} AND a.adjudicatario_nif IS NOT NULL AND a.fecha_ref >= ? AND ${sector.sql} AND ${escala.sql}
      ${texto ? 'AND (a.adjudicatario_nombre LIKE ? OR a.adjudicatario_nif LIKE ?)' : ''}
    GROUP BY a.adjudicatario_nif ORDER BY ${ORDEN_SQL[o.orden]} DESC, importe DESC, nif LIMIT ? OFFSET ?`;
  const args = [
    ...cruce.args,
    ...ARGS_ADJUDICADO,
    a.desde,
    ...sector.args,
    ...escala.args,
    ...(texto ? [texto, texto] : []),
    o.limite,
    o.desde,
  ];
  return db.prepare(sql).all(...args) as FilaSql[];
}

const r4 = (n: number | null) => (n === null ? null : Math.round(n * 10_000) / 10_000);

export type RankingCompetidores = {
  total: number;
  desde: number;
  siguiente: number | null;
  items: FilaRanking[];
  ambito: Ambito;
  nota: string;
};

/**
 * Competidores que más ganan en el sector, el periodo, la banda y el territorio, con sus
 * coincidencias con lo que sigue la empresa. Una fila por NIF (ya normalizado al guardar), con el
 * nombre de nucleo.organizaciones sin forma jurídica: las variantes con que la PLACSP publica
 * a una misma empresa no salen como empresas distintas.
 */
export function rankingCompetidores(db: Db, o: OpcionesCompetidoresData, hoy = new Date()): RankingCompetidores {
  const ambito = ambitoDe(db, o, hoy);
  const filas = consultaRanking(db, ambito, o, hoy);
  const seguidos = nifsSeguidos(db, 'competidor');
  const nombres = nombresDe(
    db,
    filas.map((f) => f.nif),
  );
  const items = filas.map(({ total: _t, c_total, c_organo, c_cpv, ...f }) => ({
    ...f,
    nombre: nombreEmpresa(nombres.get(f.nif) ?? f.nombre),
    importe: Math.round(f.importe * 100) / 100,
    baja_media: r4(f.baja_media),
    ofertas_media: r4(f.ofertas_media),
    pyme: r4(f.pyme),
    coincidencias: { total: c_total, mismo_organo: c_organo, mismo_cpv: c_cpv },
    seguido: seguidos.has(f.nif),
  }));
  const total = filas[0]?.total ?? 0;
  return {
    total,
    desde: o.desde,
    siguiente: siguienteDe(o.desde, items.length, total),
    items,
    ambito,
    nota: NOTA_GANADORES,
  };
}

export const OpcionesFicha = z.object({
  solo_sector: z.boolean().default(false).describe('Solo adjudicaciones de los CPV del sector (por defecto, todas)'),
});

export type FichaCompetidor = Identidad & {
  nif: string;
  pyme: number | null;
  resumen: {
    contratos: number;
    licitaciones: number;
    importe: number;
    importe_medio: number | null;
    organos: number;
    primero: string | null;
    ultimo: string | null;
  };
  bajas: ResumenBajas;
  ofertas: ResumenOfertas;
  organos: Grupo[];
  cpvs: { cpv: string; contratos: number }[];
  territorios: Grupo[];
  por_anio: Grupo[];
  ultimos: Contrato[];
  coincidencias: Coincidencia[];
  seguido: Seguido | null;
  solo_sector: boolean;
  nota: string;
};

function filasDe(db: Db, nif: string, cpvs: string[] | null): FilaAdj[] {
  const sector = condicionSector('a.cpvs', cpvs ?? []);
  return db
    .prepare(`${SELECT_FILAS} WHERE a.adjudicatario_nif = ? AND ${SQL_ADJUDICADO} AND ${sector.sql}`)
    .all(nif, ...ARGS_ADJUDICADO, ...sector.args) as FilaAdj[];
}

function resumen(filas: FilaAdj[]): FichaCompetidor['resumen'] {
  const fechas = filas
    .map((f) => f.fecha_ref)
    .filter((x): x is string => Boolean(x))
    .sort();
  const importe = importeTotal(filas);
  return {
    contratos: filas.length,
    licitaciones: new Set(filas.map((f) => f.licitacion_id)).size,
    importe,
    importe_medio: filas.length ? Math.round((importe / filas.length) * 100) / 100 : null,
    organos: new Set(filas.map((f) => f.organo_nif).filter(Boolean)).size,
    primero: fechas[0] ?? null,
    ultimo: fechas.at(-1) ?? null,
  };
}

type Identidad = {
  nombre: string | null;
  tipo: string | null;
  alias: string[];
  provincia: string | null;
  nif_estado: string | null;
  miembros_ute: MiembroUte[];
  utes: string[];
};

function aliasDe(texto: string | undefined): string[] {
  try {
    const lista: unknown = JSON.parse(texto ?? '[]');
    return Array.isArray(lista) ? lista.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Con los alias, la UTE separada en sus miembros y las UTE en las que entra la empresa.
function identidad(db: Db, nif: string, filas: FilaAdj[]): Identidad | null {
  const org = obtenerOrganizacion(db, nif);
  if (!org && !filas.length) return null;
  const reciente = [...filas].sort((a, b) => (b.fecha_ref ?? '').localeCompare(a.fecha_ref ?? ''))[0];
  return {
    nombre: org?.nombre ?? reciente?.adjudicatario_nombre ?? null,
    tipo: org?.tipo ?? null,
    alias: aliasDe(org?.alias),
    provincia: org?.provincia ?? null,
    nif_estado: org?.nif_estado ?? null,
    miembros_ute: miembrosDeUte(db, nif),
    utes: utesDeEmpresa(db, nif),
  };
}

/** Ficha de un competidor por NIF: lo que gana, dónde, con qué baja y frente a cuántas ofertas. */
export function fichaCompetidor(
  db: Db,
  nif: string,
  o: z.infer<typeof OpcionesFicha>,
  hoy = new Date(),
): Result<FichaCompetidor> {
  const filas = filasDe(db, nif, o.solo_sector ? ambitoDe(db, { meses: 0 }).cpvs : null);
  const id = identidad(db, nif, filas);
  if (!id) return fail('not_found', `No hay adjudicaciones ni datos de la empresa con NIF ${nif}.`);
  const conPyme = filas.filter((f) => f.pyme !== null);
  return ok({
    nif,
    ...id,
    pyme: conPyme.length ? r4(conPyme.filter((f) => f.pyme === 1).length / conPyme.length) : null,
    resumen: resumen(filas),
    bajas: resumenBajas(filas),
    ofertas: resumenOfertas(filas),
    organos: conNombres(
      db,
      topGrupos(filas, (f) => f.organo_nif, 10),
    ),
    cpvs: cpvsFrecuentes(filas, 10),
    territorios: territorios(filas, 10),
    por_anio: porAnio(filas),
    ultimos: ultimosContratos(db, filas, 10),
    coincidencias: coincidencias(oportunidadesSeguidas(db, hoy), filas),
    seguido: seguidoDe(db, 'competidor', nif),
    solo_sector: o.solo_sector,
    nota: NOTA_GANADORES,
  });
}
