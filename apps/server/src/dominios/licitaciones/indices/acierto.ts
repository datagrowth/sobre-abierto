// Prueba hacia atrás de los índices: compara lo esperado con lo que pasó en las adjudicaciones de los últimos 12 meses.
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { SQL_SIN_INCIDENCIA } from '../calidad.js';
import { condicionSector } from '../competencia/ambito.js';
import { sectorActual } from '../historico.js';
import { RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import { plausible } from '../precios/segmento.js';
import type { Db } from '../store.js';
import { baja, competencia } from './calculo.js';
import { comparablesDe } from './comparables.js';

// Una vez al mes, para las adjudicaciones del mercado de la empresa, se calculan las ofertas y la baja esperadas
// con lo que se sabía antes de su fecha (sin ella misma) y se comparan con lo que pasó. Se guarda en
// indices_acierto el error absoluto medio, el sesgo y la proporción de casos dentro del rango P25-P75 (debería
// rondar el 50 %). Se publica en Ajustes › Fuentes y en la ayuda de cada índice.
const INDICES_PROBADOS = ['ofertas', 'baja'] as const;
export type IndiceProbado = (typeof INDICES_PROBADOS)[number];

const MESES = 12;
// Tope de casos por prueba: con más, la prueba tarda horas y no cambia el resultado.
const MAX_CASOS = 300;
const POR_VUELTA = 10;
const HORA_PRUEBA = 3;
const DIA_MS = 24 * 60 * 60_000;
const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS].map((c) => `'${c}'`).join(',');

export type Caso = {
  licitacion_id: string;
  lote: string;
  fecha: string;
  ofertas: number | null;
  baja: number | null;
  tipo: string | null;
  cpv: string | null;
  presupuesto: number | null;
  procedimiento: string | null;
  organo_nif: string | null;
};

/** Las adjudicaciones de los CPV de la empresa de los últimos 12 meses (las más recientes, hasta el tope). */
export function casosDePrueba(db: Db, ahoraMs: number, max = MAX_CASOS): Caso[] {
  const sector = condicionSector('a.cpvs', sectorActual(db, false).cpvs);
  const desde = new Date(ahoraMs - MESES * 30.4375 * DIA_MS).toISOString().slice(0, 10);
  return db
    .prepare(
      `SELECT a.licitacion_id, a.lote, a.fecha_ref AS fecha, a.ofertas, a.baja, l.tipo_contrato AS tipo, a.presupuesto_sin_iva AS presupuesto,
      l.procedimiento, a.organo_nif,
      COALESCE((SELECT cpv FROM licitacion_cpv c WHERE c.licitacion_id = a.licitacion_id AND c.lote = a.lote ORDER BY principal DESC LIMIT 1),
        (SELECT cpv FROM licitacion_cpv c WHERE c.licitacion_id = a.licitacion_id AND c.lote = '' ORDER BY principal DESC LIMIT 1)) AS cpv
    FROM adjudicaciones a JOIN licitaciones l ON l.id = a.licitacion_id
    WHERE a.resultado IN (${ADJUDICADOS}) AND a.fecha_ref >= ? AND a.fecha_ref < ? AND ${sector.sql} AND ${SQL_SIN_INCIDENCIA}
    ORDER BY a.fecha_ref DESC, a.licitacion_id LIMIT ?`,
    )
    .all(desde, new Date(ahoraMs).toISOString().slice(0, 10), ...sector.args, max) as Caso[];
}

type Prediccion = { esperado: number | null; p25: number | null; p75: number | null; real: number | null };
export type Evaluado = Record<IndiceProbado, Prediccion>;

/** Lo que habrían dicho los índices el día de la adjudicación, frente a lo que pasó. */
export function evaluarCaso(db: Db, c: Caso): Evaluado {
  const muestra = comparablesDe(db, {
    tipo: c.tipo,
    cpv: c.cpv,
    presupuesto: c.presupuesto,
    procedimiento: c.procedimiento,
    organo_nif: c.organo_nif,
    referencia: c.fecha,
    excluir: c.licitacion_id,
  });
  const comp = competencia(muestra.comparables);
  const b = baja(muestra.comparables, comp.ofertas);
  const ofertas = c.ofertas !== null && c.ofertas >= 1 ? c.ofertas : null;
  return {
    ofertas: { esperado: comp.ofertas, p25: comp.rango.p25, p75: comp.rango.p75, real: ofertas },
    baja: {
      esperado: b.esperada,
      p25: b.rango.p25,
      p75: b.rango.p75,
      real: c.baja !== null && plausible(c.baja, ofertas) ? c.baja : null,
    },
  };
}

export type Acierto = {
  indice: IndiceProbado;
  n: number;
  error_absoluto_medio: number | null;
  cobertura_rango: number | null;
  sesgo: number | null;
};

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Error absoluto medio, sesgo (esperado − real) y proporción de reales dentro de P25-P75, por índice. */
export function resumirAcierto(evaluados: Evaluado[]): Acierto[] {
  return INDICES_PROBADOS.map((indice) => {
    const utiles = evaluados.map((e) => e[indice]).filter((p) => p.esperado !== null && p.real !== null);
    const n = utiles.length;
    if (!n) return { indice, n, error_absoluto_medio: null, cobertura_rango: null, sesgo: null };
    const dentro = utiles.filter(
      (p) => p.p25 !== null && p.p75 !== null && p.real! >= p.p25 && p.real! <= p.p75,
    ).length;
    return {
      indice,
      n,
      error_absoluto_medio: r4(utiles.reduce((s, p) => s + Math.abs(p.esperado! - p.real!), 0) / n),
      cobertura_rango: r4(dentro / n),
      sesgo: r4(utiles.reduce((s, p) => s + (p.esperado! - p.real!), 0) / n),
    };
  });
}

function guardarAcierto(db: Db, mes: string, aciertos: Acierto[], ahoraMs = Date.now()): void {
  const ins =
    db.prepare(`INSERT OR REPLACE INTO indices_acierto (indice, mes, n, error_absoluto_medio, cobertura_rango, sesgo, calculado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (const a of aciertos)
      ins.run(a.indice, mes, a.n, a.error_absoluto_medio, a.cobertura_rango, a.sesgo, new Date(ahoraMs).toISOString());
  })();
}

export type AciertoPublicado = Acierto & { mes: string; calculado_en: string; texto: string | null };

const PUNTOS = (fraccion: number) => (fraccion * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 });
const OFERTAS = (n: number) => n.toLocaleString('es-ES', { maximumFractionDigits: 1 });

/** «La baja esperada se desvía de media 5,8 puntos» / «Las ofertas esperadas se desvían de media 1,4 ofertas». */
export function textoAcierto(a: Acierto): string | null {
  if (a.error_absoluto_medio === null) return null;
  return a.indice === 'baja'
    ? `La baja esperada se desvía de media ${PUNTOS(a.error_absoluto_medio)} puntos (prueba hacia atrás, 12 meses, n = ${a.n})`
    : `Las ofertas esperadas se desvían de media ${OFERTAS(a.error_absoluto_medio)} ofertas (prueba hacia atrás, 12 meses, n = ${a.n})`;
}

/** La última prueba publicada de cada índice, o vacío si aún no hay ninguna. */
export function ultimoAcierto(db: Db): Partial<Record<IndiceProbado, AciertoPublicado>> {
  const filas = db
    .prepare(
      `SELECT indice, mes, n, error_absoluto_medio, cobertura_rango, sesgo, calculado_en FROM indices_acierto
    WHERE mes = (SELECT MAX(mes) FROM indices_acierto)`,
    )
    .all() as (Acierto & { mes: string; calculado_en: string })[];
  return Object.fromEntries(filas.map((f) => [f.indice, { ...f, texto: textoAcierto(f) }]));
}

/** Historial para Ajustes › Fuentes: los últimos meses de cada índice, el más reciente primero. */
export function historialAcierto(db: Db, meses = 12): (Acierto & { mes: string })[] {
  return db
    .prepare(
      `SELECT indice, mes, n, error_absoluto_medio, cobertura_rango, sesgo FROM indices_acierto
    WHERE mes IN (SELECT DISTINCT mes FROM indices_acierto ORDER BY mes DESC LIMIT ?) ORDER BY mes DESC, indice`,
    )
    .all(meses) as (Acierto & { mes: string })[];
}

// La prueba en curso: los casos que quedan y lo evaluado. En memoria: si se reinicia el servidor
// a medias, vuelve a empezar (aún no hay fila del mes).
let enCurso: { mes: string; casos: Caso[]; evaluados: Evaluado[] } | null = null;

/**
 * Desde las 3:00 del primer día en que no haya prueba del mes (hora peninsular), evalúa unos pocos
 * casos por vuelta y, al acabar, guarda el resumen del mes. Devuelve el mes guardado, o null.
 */
export function vueltaAcierto(db: Db, ahoraMs = Date.now()): string | null {
  const local = horaLocalEspana(ahoraMs);
  const mes = local.slice(0, 7);
  if (!enCurso || enCurso.mes !== mes) {
    const hecha = db.prepare('SELECT 1 FROM indices_acierto WHERE mes = ? LIMIT 1').get(mes);
    if (hecha || Number(local.slice(11, 13)) < HORA_PRUEBA) return null;
    enCurso = { mes, casos: casosDePrueba(db, ahoraMs), evaluados: [] };
  }
  for (const c of enCurso.casos.splice(0, POR_VUELTA)) enCurso.evaluados.push(evaluarCaso(db, c));
  if (enCurso.casos.length) return null;
  guardarAcierto(db, mes, resumirAcierto(enCurso.evaluados), ahoraMs);
  enCurso = null;
  return mes;
}

/** Para los tests: olvida la prueba en curso. */
export function reiniciarPruebaAcierto(): void {
  enCurso = null;
}
