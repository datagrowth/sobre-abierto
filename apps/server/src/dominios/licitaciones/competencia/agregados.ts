// Agregados de una lista de adjudicaciones (las de un competidor o las de un órgano), en JS y sin IA.
import { SQL_IMPORTE_MERCADO } from '../calidad.js';
import { RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import { media, percentil, percentiles, type Percentiles } from '../../../nucleo/estadistica.js';
import { tramoDeOfertas, TRAMOS_OFERTAS } from '../precios/estadistica.js';
import { plausible } from '../precios/segmento.js';
import type { Db } from '../store.js';
import { nombreTerritorio, territorioDe } from './territorios.js';

// Las fichas leen sus filas por índice (cientos o miles) y las resumen aquí: bajas, ofertas, grupos por órgano,
// adjudicatario, CPV, territorio y año.
export type FilaAdj = {
  licitacion_id: string;
  lote: string;
  fecha_ref: string | null;
  importe_sin_iva: number | null;
  // Lo que suma en los totales (calidad.ts): sin el techo de un acuerdo marco repetido en cada adjudicataria.
  importe_mercado: number | null;
  presupuesto_sin_iva: number | null;
  baja: number | null;
  ofertas: number | null;
  pyme: number | null;
  organo_nif: string | null;
  cpvs: string | null;
  nuts: string | null;
  adjudicatario_nif: string | null;
  adjudicatario_nombre: string | null;
};

const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS];
export const SQL_ADJUDICADO = `a.resultado IN (${ADJUDICADOS.map(() => '?').join(',')})`;
export const ARGS_ADJUDICADO: string[] = ADJUDICADOS;
export const SELECT_FILAS = `SELECT a.licitacion_id, a.lote, a.fecha_ref, a.importe_sin_iva, ${SQL_IMPORTE_MERCADO} AS importe_mercado,
  a.presupuesto_sin_iva, a.baja, a.ofertas,
  a.pyme, a.organo_nif, a.cpvs, a.nuts, a.adjudicatario_nif, a.adjudicatario_nombre FROM adjudicaciones a`;

const redondear = (n: number | null, d = 4) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);
const anioDe = (f: FilaAdj) => f.fecha_ref?.slice(0, 4) || null;

/** Bajas creíbles (las mismas reglas que el modelo de precios), ordenadas. */
function bajasValidas(filas: FilaAdj[]): number[] {
  return filas
    .filter((f) => f.baja !== null && plausible(f.baja, f.ofertas))
    .map((f) => f.baja as number)
    .sort((a, b) => a - b);
}

export type ResumenBajas = { n: number; media: number | null; percentiles: Percentiles };

export function resumenBajas(filas: FilaAdj[]): ResumenBajas {
  const bajas = bajasValidas(filas);
  return { n: bajas.length, media: redondear(media(bajas)), percentiles: percentiles(bajas) };
}

export type ResumenOfertas = {
  n: number;
  media: number | null;
  mediana: number | null;
  por_tramo: { clave: string; n: number }[];
};

/** Número de ofertas de los contratos ganados: cuánta competencia había cuando ganó. */
export function resumenOfertas(filas: FilaAdj[]): ResumenOfertas {
  const ofertas = filas
    .map((f) => f.ofertas)
    .filter((n): n is number => n !== null && n >= 1)
    .sort((a, b) => a - b);
  const cuenta = new Map<string, number>();
  for (const n of ofertas) {
    const t = tramoDeOfertas(n);
    if (t) cuenta.set(t, (cuenta.get(t) ?? 0) + 1);
  }
  const por_tramo = TRAMOS_OFERTAS.filter((t) => cuenta.has(t.clave)).map((t) => ({
    clave: t.clave,
    n: cuenta.get(t.clave) ?? 0,
  }));
  return { n: ofertas.length, media: redondear(media(ofertas), 2), mediana: percentil(ofertas, 0.5), por_tramo };
}

export type Grupo = {
  clave: string;
  nombre: string | null;
  contratos: number;
  importe: number;
  baja_mediana: number | null;
};

function agrupar(filas: FilaAdj[], clave: (f: FilaAdj) => string | null): Map<string, FilaAdj[]> {
  const grupos = new Map<string, FilaAdj[]>();
  for (const f of filas) {
    const k = clave(f);
    if (k === null) continue;
    const lista = grupos.get(k);
    if (lista) lista.push(f);
    else grupos.set(k, [f]);
  }
  return grupos;
}

function resumirGrupo(clave: string, filas: FilaAdj[]): Grupo {
  const importe = filas.reduce((s, f) => s + (f.importe_mercado ?? 0), 0);
  return {
    clave,
    nombre: null,
    contratos: filas.length,
    importe: Math.round(importe * 100) / 100,
    baja_mediana: redondear(percentil(bajasValidas(filas), 0.5)),
  };
}

/** Los `limite` grupos con más contratos (a igualdad, más importe). */
export function topGrupos(filas: FilaAdj[], clave: (f: FilaAdj) => string | null, limite: number): Grupo[] {
  return [...agrupar(filas, clave)]
    .map(([k, v]) => resumirGrupo(k, v))
    .sort((a, b) => b.contratos - a.contratos || b.importe - a.importe)
    .slice(0, limite);
}

export function porAnio(filas: FilaAdj[]): Grupo[] {
  return [...agrupar(filas, anioDe)].map(([k, v]) => resumirGrupo(k, v)).sort((a, b) => a.clave.localeCompare(b.clave));
}

/** CPV más frecuentes (cada adjudicación cuenta una vez por cada CPV que lleva). */
export function cpvsFrecuentes(filas: FilaAdj[], limite: number): { cpv: string; contratos: number }[] {
  const cuenta = new Map<string, number>();
  for (const f of filas) {
    for (const cpv of new Set((f.cpvs ?? '').split(',').filter(Boolean))) cuenta.set(cpv, (cuenta.get(cpv) ?? 0) + 1);
  }
  return [...cuenta]
    .map(([cpv, contratos]) => ({ cpv, contratos }))
    .sort((a, b) => b.contratos - a.contratos || a.cpv.localeCompare(b.cpv))
    .slice(0, limite);
}

export function territorios(filas: FilaAdj[], limite: number): Grupo[] {
  return topGrupos(filas, (f) => territorioDe(f.nuts), limite).map((g) => ({
    ...g,
    nombre: nombreTerritorio(g.clave),
  }));
}

/** Nombre de cada NIF en nucleo.organizaciones (los que no estén se quedan sin nombre). */
// De 500 en 500: un IN con miles de parámetros se acerca al límite de SQLite.
const TROZO = 500;

export function nombresDe(db: Db, nifs: string[]): Map<string, string> {
  const unicos = [...new Set(nifs)];
  const nombres = new Map<string, string>();
  for (let i = 0; i < unicos.length; i += TROZO) {
    const trozo = unicos.slice(i, i + TROZO);
    const filas = db
      .prepare(`SELECT nif, nombre FROM nucleo.organizaciones WHERE nif IN (${trozo.map(() => '?').join(',')})`)
      .all(...trozo) as { nif: string; nombre: string }[];
    for (const f of filas) nombres.set(f.nif, f.nombre);
  }
  return nombres;
}

export function conNombres(db: Db, grupos: Grupo[]): Grupo[] {
  const nombres = nombresDe(
    db,
    grupos.map((g) => g.clave),
  );
  return grupos.map((g) => ({ ...g, nombre: nombres.get(g.clave) ?? g.nombre }));
}

export type Contrato = {
  licitacion_id: string;
  lote: string;
  titulo: string;
  expediente: string;
  organo: string;
  organo_nif: string | null;
  url: string | null;
  fecha: string | null;
  adjudicatario_nif: string | null;
  adjudicatario_nombre: string | null;
  presupuesto: number | null;
  importe: number | null;
  baja: number | null;
  ofertas: number | null;
};

/** Las `limite` adjudicaciones más recientes, con el título y el enlace de su licitación. */
export function ultimosContratos(db: Db, filas: FilaAdj[], limite: number): Contrato[] {
  const recientes = [...filas].sort((a, b) => (b.fecha_ref ?? '').localeCompare(a.fecha_ref ?? '')).slice(0, limite);
  if (!recientes.length) return [];
  const ids = [...new Set(recientes.map((f) => f.licitacion_id))];
  const lic = db
    .prepare(
      `SELECT id, titulo, expediente, organo_nombre, url FROM licitaciones WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .all(...ids) as { id: string; titulo: string; expediente: string; organo_nombre: string; url: string | null }[];
  const porId = new Map(lic.map((l) => [l.id, l]));
  return recientes.map((f) => {
    const l = porId.get(f.licitacion_id);
    return {
      licitacion_id: f.licitacion_id,
      lote: f.lote,
      titulo: l?.titulo ?? '',
      expediente: l?.expediente ?? '',
      organo: l?.organo_nombre ?? '',
      organo_nif: f.organo_nif,
      url: l?.url ?? null,
      fecha: f.fecha_ref,
      adjudicatario_nif: f.adjudicatario_nif,
      adjudicatario_nombre: f.adjudicatario_nombre,
      presupuesto: f.presupuesto_sin_iva,
      importe: f.importe_sin_iva,
      baja: f.baja,
      ofertas: f.ofertas,
    };
  });
}

export function importeTotal(filas: FilaAdj[]): number {
  return Math.round(filas.reduce((s, f) => s + (f.importe_mercado ?? 0), 0) * 100) / 100;
}
