// Panorama del mercado de la empresa: lo adjudicado en los CPV del perfil en los últimos 24 meses.
import { z } from 'zod';
import { percentil } from '../../../nucleo/estadistica.js';
import { leerPerfilEmpresa } from '../../../nucleo/empresa.js';
import { claseNif } from '../../../nucleo/identidad.js';
import { nombresDe } from '../competencia/agregados.js';
import { condicionSector, nombreEmpresa, nombreOrgano } from '../competencia/ambito.js';
import { sectorActual } from '../historico.js';
import { RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import { tramoDeOfertas, TRAMOS_OFERTAS } from '../precios/estadistica.js';
import { plausible } from '../precios/segmento.js';
import { SQL_IMPORTE_MERCADO, SQL_SIN_INCIDENCIA } from '../calidad.js';
import type { Db } from '../store.js';

// Por trimestre; la baja y las ofertas por tramo; los órganos que más compran y los adjudicatarios que más
// ganan, con la cuota de la empresa. Todo de la PLACSP y por código.
export const OpcionesPanorama = z.object({ meses: z.coerce.number().int().min(3).max(60).default(24) });

const TOP = 5;
const MES_MS = 30.4375 * 24 * 60 * 60_000;
const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS].map((c) => `'${c}'`).join(',');

type Fila = {
  licitacion_id: string;
  lote: string;
  fecha: string;
  importe: number | null;
  // El importe publicado: distinto de `importe` solo en los acuerdos marco con varias adjudicatarias.
  publicado: number | null;
  baja: number | null;
  ofertas: number | null;
  organo_nif: string | null;
  organo: string;
  adjudicatario_nif: string | null;
};

type Trimestre = { trimestre: string; importe: number; adjudicaciones: number };
type Tramo = { tramo: string; adjudicaciones: number; baja_mediana: number | null };
type Puesto = {
  nif: string;
  nombre: string | null;
  importe: number;
  contratos: number;
  cuota: number;
  nosotros: boolean;
};

export type Panorama = {
  desde: string;
  hasta: string;
  n: number;
  importe: number;
  cpvs: string[];
  trimestres: Trimestre[];
  tramos: Tramo[];
  organos: Omit<Puesto, 'nosotros'>[];
  adjudicatarios: Puesto[];
  nuestra_cuota: Puesto | null;
  // Lotes de acuerdo marco con varias adjudicatarias: cuentan como adjudicaciones, pero su techo no suma.
  acuerdos_marco: { lotes: number; adjudicaciones: number };
  nota: string;
};

const NOTA =
  'Adjudicaciones de la PLACSP en los CPV del perfil y los filtros, sin las que tienen incidencias de calidad. El techo de un acuerdo marco con varias adjudicatarias no suma importe. La cuota es del importe adjudicado; una UTE cuenta como tal.';

/** Trimestre de una fecha: «2026-T3». */
export function trimestreDe(fecha: string): string {
  return `${fecha.slice(0, 4)}-T${Math.floor((Number(fecha.slice(5, 7)) - 1) / 3) + 1}`;
}

/** Los trimestres entre dos fechas, aunque no tengan adjudicaciones (la gráfica no se salta ninguno). */
export function trimestresEntre(desde: string, hasta: string): string[] {
  const fin = trimestreDe(hasta);
  let anio = Number(desde.slice(0, 4));
  let t = Math.floor((Number(desde.slice(5, 7)) - 1) / 3) + 1;
  const lista: string[] = [];
  while (`${anio}-T${t}` <= fin) {
    lista.push(`${anio}-T${t}`);
    if (t === 4) {
      t = 1;
      anio += 1;
    } else t += 1;
  }
  return lista;
}

function agrupar<T>(
  filas: Fila[],
  clave: (f: Fila) => string | null,
  crear: (k: string) => T,
  sumar: (acc: T, f: Fila) => void,
): Map<string, T> {
  const m = new Map<string, T>();
  for (const f of filas) {
    const k = clave(f);
    if (k === null) continue;
    const acc = m.get(k) ?? crear(k);
    sumar(acc, f);
    m.set(k, acc);
  }
  return m;
}

function puestos(
  filas: Fila[],
  clave: (f: Fila) => string | null,
  total: number,
): Map<string, Omit<Puesto, 'nombre' | 'nosotros'>> {
  return agrupar(
    filas,
    clave,
    (nif) => ({ nif, importe: 0, contratos: 0, cuota: 0 }),
    (acc, f) => {
      acc.importe += f.importe ?? 0;
      acc.contratos += 1;
      acc.cuota = total ? Math.round((acc.importe / total) * 10_000) / 10_000 : 0;
    },
  );
}

/** Lotes cuyo importe no suma por ser el techo de un acuerdo marco repetido en cada adjudicataria. */
function acuerdosMarco(filas: Fila[]): Panorama['acuerdos_marco'] {
  const am = filas.filter((f) => f.importe === null && f.publicado !== null);
  return { lotes: new Set(am.map((f) => `${f.licitacion_id}|${f.lote}`)).size, adjudicaciones: am.length };
}

const porImporte = <T extends { importe: number }>(a: T, b: T) => b.importe - a.importe;

/** El panorama de los últimos `meses` (24 por defecto). */
export function panorama(db: Db, o: z.infer<typeof OpcionesPanorama>, ahoraMs = Date.now()): Panorama {
  const { cpvs } = sectorActual(db, false);
  const sector = condicionSector('a.cpvs', cpvs);
  const hasta = new Date(ahoraMs).toISOString().slice(0, 10);
  const desde = new Date(ahoraMs - o.meses * MES_MS).toISOString().slice(0, 10);
  const filas = db
    .prepare(
      `SELECT a.licitacion_id, a.lote, a.fecha_ref AS fecha, ${SQL_IMPORTE_MERCADO} AS importe, a.importe_sin_iva AS publicado, a.baja, a.ofertas, a.organo_nif, l.organo_nombre AS organo,
      CASE WHEN a.nif_valido = 1 THEN a.adjudicatario_nif END AS adjudicatario_nif
    FROM adjudicaciones a JOIN licitaciones l ON l.id = a.licitacion_id
    WHERE a.resultado IN (${ADJUDICADOS}) AND a.fecha_ref >= ? AND a.fecha_ref <= ? AND ${sector.sql} AND ${SQL_SIN_INCIDENCIA}`,
    )
    .all(desde, hasta, ...sector.args) as Fila[];
  const total = filas.reduce((s, f) => s + (f.importe ?? 0), 0);
  const porTrimestre = agrupar(
    filas,
    (f) => trimestreDe(f.fecha),
    (trimestre) => ({ trimestre, importe: 0, adjudicaciones: 0 }),
    (acc, f) => {
      acc.importe += f.importe ?? 0;
      acc.adjudicaciones += 1;
    },
  );
  const tramos = TRAMOS_OFERTAS.map((t) => {
    const del = filas.filter((f) => tramoDeOfertas(f.ofertas) === t.clave);
    const bajas = del
      .filter((f) => f.baja !== null && plausible(f.baja, f.ofertas))
      .map((f) => f.baja!)
      .sort((a, b) => a - b);
    return { tramo: t.clave, adjudicaciones: del.length, baja_mediana: percentil(bajas, 0.5) };
  });
  const nombresOrgano = new Map(filas.filter((f) => f.organo_nif).map((f) => [f.organo_nif!, f.organo]));
  const organos = [...puestos(filas, (f) => f.organo_nif, total).values()]
    .sort(porImporte)
    .slice(0, TOP)
    .map((p) => ({ ...p, nombre: nombreOrgano(nombresOrgano.get(p.nif) ?? null) }));
  const nifPropio = leerPerfilEmpresa(db)?.perfil?.nif ?? null;
  const ganadores = [...puestos(filas, (f) => f.adjudicatario_nif, total).values()].sort(porImporte);
  const top = ganadores.slice(0, TOP);
  const nuestro = nifPropio ? (ganadores.find((g) => g.nif === nifPropio) ?? null) : null;
  const nombres = nombresDe(
    db,
    [...top, ...(nuestro ? [nuestro] : [])].map((g) => g.nif).filter((n) => claseNif(n) !== 'persona_fisica'),
  );
  const conNombre = (g: Omit<Puesto, 'nombre' | 'nosotros'>): Puesto => ({
    ...g,
    nombre: claseNif(g.nif) === 'persona_fisica' ? null : nombreEmpresa(nombres.get(g.nif) ?? null),
    nosotros: g.nif === nifPropio,
  });
  return {
    desde,
    hasta,
    n: filas.length,
    importe: Math.round(total * 100) / 100,
    cpvs,
    trimestres: trimestresEntre(desde, hasta).map(
      (t) => porTrimestre.get(t) ?? { trimestre: t, importe: 0, adjudicaciones: 0 },
    ),
    tramos,
    organos,
    adjudicatarios: top.map(conNombre),
    nuestra_cuota: nuestro ? conNombre(nuestro) : null,
    acuerdos_marco: acuerdosMarco(filas),
    nota: NOTA,
  };
}
