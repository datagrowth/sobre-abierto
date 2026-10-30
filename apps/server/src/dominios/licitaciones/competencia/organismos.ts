// Organismos: cuánto licita cada órgano en el sector de la empresa, a quién adjudica, con qué baja
// y frente a cuántas ofertas, y cuáles interesan a la empresa. Sin IA: datos de la PLACSP.
import { z } from 'zod';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { ESTADOS_ABIERTOS } from '../placsp/codigos.js';
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { SQL_PLAUSIBLE } from '../precios/segmento.js';
import type { Db } from '../store.js';
import {
  ambitoDe,
  coincideTexto,
  condicionEscala,
  condicionSector,
  NOTA_GANADORES,
  nombreOrgano,
  OpcionesAmbito,
  siguienteDe,
  type Ambito,
} from './ambito.js';
import {
  ARGS_ADJUDICADO,
  importeTotal,
  nombresDe,
  porAnio,
  resumenBajas,
  resumenOfertas,
  SELECT_FILAS,
  SQL_ADJUDICADO,
  topGrupos,
  ultimosContratos,
  type Contrato,
  type FilaAdj,
  type Grupo,
  type ResumenBajas,
  type ResumenOfertas,
} from './agregados.js';
import { SQL_IMPORTE_MERCADO } from '../calidad.js';
import { oportunidadesSeguidas, type Nuestra } from './nuestras.js';
import { nifsSeguidos, seguidoDe, type Seguido } from './seguidos.js';
import { interes, type Interes } from './interes.js';

const ORDEN_ORGANISMOS = ['interes', 'importe', 'licitaciones'] as const;
export const OpcionesOrganismos = OpcionesAmbito.extend({
  orden: z
    .enum(ORDEN_ORGANISMOS)
    .default('interes')
    .describe('interés (volumen, recurrencia y baja), importe licitado o nº de licitaciones'),
});
export type OpcionesOrganismosData = z.infer<typeof OpcionesOrganismos>;

type Licitado = { nif: string; licitaciones: number; importe_licitado: number; meses_activos: number };
type Adjudicado = {
  nif: string;
  adjudicaciones: number;
  importe_adjudicado: number;
  baja_media: number | null;
  ofertas_media: number | null;
  adjudicatarios: number;
};

export type FilaOrganismo = Licitado &
  Omit<Adjudicado, 'nif'> & { nombre: string | null; oportunidades: number; seguido: boolean; interes: Interes };

// La fecha de una licitación es la de su última versión publicada (la PLACSP no da la de
// publicación en el feed). INDEXED BY: el índice licitaciones_sector cubre la consulta
// entera; por su cuenta SQLite elige el de órgano y lee cada fila con su JSON (1-3 s frente
// a 0,1 s con 150.000 licitaciones).
// El presupuesto está en el índice y el NUTS no: SQLite lee la fila solo de las que pasan
// fecha, banda y sector (65 ms con 150.000 filas anchas en competenciaRendimiento.test.ts).
function licitado(db: Db, a: Ambito): Licitado[] {
  const sector = condicionSector('l.cpvs', a.cpvs);
  const escala = condicionEscala('l.presupuesto_sin_iva', 'l.nuts', a);
  return db
    .prepare(
      `SELECT l.organo_nif AS nif, COUNT(*) AS licitaciones, COALESCE(SUM(l.presupuesto_sin_iva), 0) AS importe_licitado,
      COUNT(DISTINCT substr(l.actualizada_en, 1, 7)) AS meses_activos
    FROM licitaciones AS l INDEXED BY licitaciones_sector WHERE l.organo_nif IS NOT NULL AND l.actualizada_en >= ? AND ${sector.sql} AND ${escala.sql} GROUP BY l.organo_nif`,
    )
    .all(a.desde, ...sector.args, ...escala.args) as Licitado[];
}

// NOT INDEXED por lo mismo que en competidores: leer la tabla seguida es lo más rápido.
function adjudicado(db: Db, a: Ambito): Adjudicado[] {
  const sector = condicionSector('a.cpvs', a.cpvs);
  const escala = condicionEscala('COALESCE(a.presupuesto_sin_iva, a.importe_sin_iva)', 'a.nuts', a);
  return db
    .prepare(
      `SELECT a.organo_nif AS nif, COUNT(*) AS adjudicaciones, COALESCE(SUM(${SQL_IMPORTE_MERCADO}), 0) AS importe_adjudicado,
      AVG(CASE WHEN ${SQL_PLAUSIBLE} THEN a.baja END) AS baja_media, AVG(CASE WHEN a.ofertas >= 1 THEN a.ofertas END) AS ofertas_media,
      COUNT(DISTINCT a.adjudicatario_nif) AS adjudicatarios
    FROM adjudicaciones AS a NOT INDEXED
    WHERE ${SQL_ADJUDICADO} AND a.organo_nif IS NOT NULL AND a.fecha_ref >= ? AND ${sector.sql} AND ${escala.sql} GROUP BY a.organo_nif`,
    )
    .all(...ARGS_ADJUDICADO, a.desde, ...sector.args, ...escala.args) as Adjudicado[];
}

const VACIO: Omit<Adjudicado, 'nif'> = {
  adjudicaciones: 0,
  importe_adjudicado: 0,
  baja_media: null,
  ofertas_media: null,
  adjudicatarios: 0,
};

function unir(db: Db, a: Ambito, hoy: Date): FilaOrganismo[] {
  const adj = new Map(adjudicado(db, a).map(({ nif, ...x }) => [nif, x]));
  const lic = licitado(db, a);
  const vistos = new Set(lic.map((l) => l.nif));
  const todos = [
    ...lic,
    ...[...adj.keys()]
      .filter((n) => !vistos.has(n))
      .map((nif) => ({ nif, licitaciones: 0, importe_licitado: 0, meses_activos: 0 })),
  ];
  const nuestras = cuentaPorOrgano(oportunidadesSeguidas(db, hoy));
  const seguidos = nifsSeguidos(db, 'organismo');
  const maxImporte = Math.max(0, ...todos.map((l) => l.importe_licitado));
  return todos.map((l) => {
    const x = adj.get(l.nif) ?? VACIO;
    return {
      ...l,
      ...x,
      nombre: null,
      oportunidades: nuestras.get(l.nif) ?? 0,
      seguido: seguidos.has(l.nif),
      interes: interes({ ...l, baja_media: x.baja_media }, maxImporte, a.meses),
    };
  });
}

function cuentaPorOrgano(nuestras: Nuestra[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of nuestras) if (n.organo_nif) m.set(n.organo_nif, (m.get(n.organo_nif) ?? 0) + 1);
  return m;
}

const ORDENAR: Record<(typeof ORDEN_ORGANISMOS)[number], (a: FilaOrganismo, b: FilaOrganismo) => number> = {
  interes: (a, b) => b.interes.puntos - a.interes.puntos || b.importe_licitado - a.importe_licitado,
  importe: (a, b) => b.importe_licitado - a.importe_licitado || b.importe_adjudicado - a.importe_adjudicado,
  licitaciones: (a, b) => b.licitaciones - a.licitaciones || b.importe_licitado - a.importe_licitado,
};

const r4 = (n: number | null) => (n === null ? null : Math.round(n * 10_000) / 10_000);

export type RankingOrganismos = {
  total: number;
  desde: number;
  siguiente: number | null;
  items: FilaOrganismo[];
  ambito: Ambito;
  nota: string;
};

/**
 * Órganos que licitan en el sector, el periodo, la banda y el territorio, con lo que adjudican
 * y una puntuación de interés. El nombre, sin los cargos del final (normalizarOrgano).
 */
export function rankingOrganismos(db: Db, o: OpcionesOrganismosData, hoy = new Date()): RankingOrganismos {
  const ambito = ambitoDe(db, o, hoy);
  const filas = unir(db, ambito, hoy);
  const nombres = nombresDe(
    db,
    filas.map((f) => f.nif),
  );
  const conNombre = filas
    .map((f) => ({ ...f, nombre: nombreOrgano(nombres.get(f.nif) ?? null) }))
    .filter((f) => coincideTexto(o.texto, f.nif, f.nombre));
  const items = conNombre
    .sort((x, y) => ORDENAR[o.orden](x, y) || x.nif.localeCompare(y.nif))
    .slice(o.desde, o.desde + o.limite)
    .map((f) => ({
      ...f,
      importe_licitado: Math.round(f.importe_licitado),
      importe_adjudicado: Math.round(f.importe_adjudicado),
      baja_media: r4(f.baja_media),
      ofertas_media: r4(f.ofertas_media),
    }));
  return {
    total: conNombre.length,
    desde: o.desde,
    siguiente: siguienteDe(o.desde, items.length, conNombre.length),
    items,
    ambito,
    nota: NOTA_GANADORES,
  };
}

export type FichaOrganismo = {
  nif: string;
  nombre: string | null;
  dir3: string | null;
  ciudad: string | null;
  nuts: string | null;
  licitaciones: {
    total: number;
    del_sector: number;
    importe_sector: number;
    abiertas: number;
    por_anio: { anio: string; licitaciones: number }[];
  };
  adjudicaciones: { contratos: number; importe: number; adjudicatarios: number; concentracion: number | null };
  bajas: ResumenBajas;
  ofertas: ResumenOfertas;
  adjudicatarios: Grupo[];
  por_anio: Grupo[];
  ultimas: Contrato[];
  oportunidades: Omit<Nuestra, 'clases'>[];
  seguido: Seguido | null;
  solo_sector: boolean;
  nota: string;
};

type LicOrgano = {
  id: string;
  estado: string;
  presupuesto_sin_iva: number | null;
  cpvs: string;
  actualizada_en: string;
  organo_nombre: string;
  fecha_limite: string | null;
  borrada_en: string | null;
};

// Abierta como en el prefiltro: publicada, no retirada del feed y con el plazo (en hora de
// España) sin vencer.
function abierta(l: LicOrgano, hoy: Date): boolean {
  if (!ESTADOS_ABIERTOS.has(l.estado) || l.borrada_en) return false;
  return !l.fecha_limite || l.fecha_limite > horaLocalEspana(hoy.getTime());
}

function resumenLicitaciones(lics: LicOrgano[], cpvs: string[], hoy: Date): FichaOrganismo['licitaciones'] {
  const delSector = cpvs.length ? lics.filter((l) => cpvs.some((p) => l.cpvs.includes(`,${p}`))) : lics;
  const anios = new Map<string, number>();
  for (const l of delSector)
    anios.set(l.actualizada_en.slice(0, 4), (anios.get(l.actualizada_en.slice(0, 4)) ?? 0) + 1);
  return {
    total: lics.length,
    del_sector: delSector.length,
    importe_sector: Math.round(delSector.reduce((s, l) => s + (l.presupuesto_sin_iva ?? 0), 0)),
    abiertas: delSector.filter((l) => abierta(l, hoy)).length,
    por_anio: [...anios].sort(([x], [y]) => x.localeCompare(y)).map(([anio, licitaciones]) => ({ anio, licitaciones })),
  };
}

function resumenAdjudicaciones(filas: FilaAdj[], ganadores: Grupo[]): FichaOrganismo['adjudicaciones'] {
  const nifs = new Set(filas.map((f) => f.adjudicatario_nif).filter(Boolean));
  const primero = ganadores[0]?.contratos ?? 0;
  return {
    contratos: filas.length,
    importe: importeTotal(filas),
    adjudicatarios: nifs.size,
    concentracion: filas.length ? r4(primero / filas.length) : null,
  };
}

// Nombre del adjudicatario: el publicado en su adjudicación más reciente.
function conNombreAdjudicatario(filas: FilaAdj[], grupos: Grupo[]): Grupo[] {
  const nombres = new Map<string, string>();
  for (const f of [...filas].sort((a, b) => (a.fecha_ref ?? '').localeCompare(b.fecha_ref ?? ''))) {
    if (f.adjudicatario_nif && f.adjudicatario_nombre) nombres.set(f.adjudicatario_nif, f.adjudicatario_nombre);
  }
  return grupos.map((g) => ({ ...g, nombre: nombres.get(g.clave) ?? g.nombre }));
}

function datosOrganismo(
  db: Db,
  nif: string,
  lics: LicOrgano[],
): Pick<FichaOrganismo, 'nombre' | 'dir3' | 'ciudad' | 'nuts'> | null {
  const org = db.prepare('SELECT nombre, dir3, ciudad, nuts FROM nucleo.organizaciones WHERE nif = ?').get(nif) as
    Pick<FichaOrganismo, 'nombre' | 'dir3' | 'ciudad' | 'nuts'> | undefined;
  if (org) return { ...org, nombre: nombreOrgano(org.nombre) };
  return lics.length
    ? { nombre: nombreOrgano(lics[0]?.organo_nombre ?? null), dir3: null, ciudad: null, nuts: null }
    : null;
}

/** Ficha de un órgano: cuánto licita (en total y en el sector), a quién adjudica y con qué baja. */
export function fichaOrganismo(
  db: Db,
  nif: string,
  o: { solo_sector: boolean },
  hoy = new Date(),
): Result<FichaOrganismo> {
  const cpvsSector = ambitoDe(db, { meses: 0 }).cpvs;
  const lics = db
    .prepare(
      `SELECT id, estado, presupuesto_sin_iva, cpvs, actualizada_en, organo_nombre, fecha_limite, borrada_en
    FROM licitaciones WHERE organo_nif = ? ORDER BY actualizada_en DESC`,
    )
    .all(nif) as LicOrgano[];
  const datos = datosOrganismo(db, nif, lics);
  if (!datos) return fail('not_found', `No hay licitaciones ni datos del órgano con NIF ${nif}.`);
  const sector = condicionSector('a.cpvs', o.solo_sector ? cpvsSector : []);
  const filas = db
    .prepare(`${SELECT_FILAS} WHERE a.organo_nif = ? AND ${SQL_ADJUDICADO} AND ${sector.sql}`)
    .all(nif, ...ARGS_ADJUDICADO, ...sector.args) as FilaAdj[];
  const ganadores = conNombreAdjudicatario(
    filas,
    topGrupos(filas, (f) => f.adjudicatario_nif, 10),
  );
  return ok({
    nif,
    ...datos,
    licitaciones: resumenLicitaciones(lics, cpvsSector, hoy),
    adjudicaciones: resumenAdjudicaciones(filas, ganadores),
    bajas: resumenBajas(filas),
    ofertas: resumenOfertas(filas),
    adjudicatarios: ganadores,
    por_anio: porAnio(filas),
    ultimas: ultimosContratos(db, filas, 10),
    oportunidades: oportunidadesSeguidas(db, hoy)
      .filter((n) => n.organo_nif === nif)
      .map(({ clases: _c, ...n }) => n),
    seguido: seguidoDe(db, 'organismo', nif),
    solo_sector: o.solo_sector,
    nota: NOTA_GANADORES,
  });
}
