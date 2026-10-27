// Comparables C(L) de una licitación: adjudicaciones parecidas, por tipo de contrato, CPV, presupuesto y procedimiento.
import { RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import { FACTOR_BANDA, plausible } from '../precios/segmento.js';
import { SQL_SIN_INCIDENCIA } from '../calidad.js';
import type { Db } from '../store.js';
import { pesoAntiguedad, type Comparable } from './calculo.js';

// Mismo tipo de contrato; CPV principal a 8 cifras o, si no llegan a 20, a 6, 4, 3 y 2 (retroceso jerárquico);
// presupuesto entre un tercio y el triple; procedimiento del mismo grupo (abiertos frente a negociados, que se
// relaja si no hay muestra); de los 5 años anteriores a la fecha de referencia con peso 0,5^(años/2); y sin
// incidencias de calidad (calidad.ts). Los del mismo órgano son C_o(L). El CPV se busca por rango en
// licitacion_cpv (con índice) y se confirma en el lote adjudicado.
const MIN_COMPARABLES = 20;
const ANIOS = 5;
const ANIO_MS = 365.25 * 24 * 60 * 60_000;
// Negociados (con y sin publicidad) frente a todo lo demás: abiertos, simplificados, restringidos…
const NEGOCIADOS = new Set(['3', '4']);
const ADJUDICADOS = [...RESULTADOS_ADJUDICADOS].map((c) => `'${c}'`).join(',');

export type ConsultaIndices = {
  tipo: string | null;
  cpv: string | null;
  presupuesto: number | null;
  procedimiento: string | null;
  organo_nif: string | null;
  // Solo cuenta lo adjudicado antes de esta fecha (la prueba hacia atrás calcula con lo que se sabía entonces).
  referencia: string;
  excluir: string | null;
};

export type Muestra = {
  comparables: Comparable[];
  cpv: string | null;
  cifras_cpv: number;
  procedimiento_relajado: boolean;
  descripcion: string;
};

/** Prefijos del CPV principal en el orden del retroceso: 8, 6, 4, 3 y 2 cifras, sin repetir los que solo añaden ceros. */
export function prefijosRetroceso(cpv: string): string[] {
  const significativas = Math.max(2, cpv.replace(/0+$/, '').length);
  return [...new Set([8, 6, 4, 3, 2].map((n) => cpv.slice(0, Math.min(n, significativas))))];
}

const grupo = (procedimiento: string | null) =>
  procedimiento !== null && NEGOCIADOS.has(procedimiento) ? 'negociado' : 'abierto';

type Fila = {
  licitacion_id: string;
  lote: string;
  ofertas: number | null;
  baja: number | null;
  fecha: string | null;
  organo_nif: string | null;
  adjudicatario_nif: string | null;
  nif_valido: number | null;
  procedimiento: string | null;
};

// `prefijo` va como dato y el rango «prefijo:» (':' va detrás de '9') recoge todos los códigos que empiezan así.
function leer(db: Db, q: ConsultaIndices, prefijo: string): Fila[] {
  const desde = new Date(Date.parse(q.referencia) - ANIOS * ANIO_MS).toISOString().slice(0, 10);
  const condiciones = [
    `a.resultado IN (${ADJUDICADOS})`,
    'a.fecha_ref >= @desde',
    'a.fecha_ref < @hasta',
    "instr(a.cpvs, ',' || @prefijo) > 0",
    SQL_SIN_INCIDENCIA,
  ];
  if (q.tipo) condiciones.push('l.tipo_contrato = @tipo');
  if (q.excluir) condiciones.push('a.licitacion_id <> @excluir');
  if (q.presupuesto && q.presupuesto > 0) condiciones.push('a.presupuesto_sin_iva BETWEEN @min AND @max');
  return db
    .prepare(
      `SELECT a.licitacion_id, a.lote, a.ofertas, a.baja, a.fecha_ref AS fecha, a.organo_nif, a.adjudicatario_nif, a.nif_valido,
      l.procedimiento
    FROM (SELECT DISTINCT licitacion_id FROM licitacion_cpv WHERE cpv >= @prefijo AND cpv < @prefijo || ':') c
    JOIN adjudicaciones a ON a.licitacion_id = c.licitacion_id JOIN licitaciones l ON l.id = a.licitacion_id
    WHERE ${condiciones.join(' AND ')}`,
    )
    .all({
      desde,
      hasta: q.referencia.slice(0, 10),
      prefijo,
      tipo: q.tipo,
      excluir: q.excluir,
      min: (q.presupuesto ?? 0) / FACTOR_BANDA,
      max: (q.presupuesto ?? 0) * FACTOR_BANDA,
    }) as Fila[];
}

// Una baja fuera de lo creíble no cuenta para la baja, pero la adjudicación sigue contando sus ofertas.
function aComparable(f: Fila, q: ConsultaIndices, referenciaMs: number): Comparable {
  const ofertas = f.ofertas !== null && f.ofertas >= 1 ? f.ofertas : null;
  return {
    licitacion_id: f.licitacion_id,
    lote: f.lote,
    ofertas,
    baja: f.baja !== null && plausible(f.baja, ofertas) ? f.baja : null,
    fecha: f.fecha,
    organo_nif: f.organo_nif,
    adjudicatario_nif: f.nif_valido === 1 ? f.adjudicatario_nif : null,
    peso: pesoAntiguedad(f.fecha, referenciaMs),
    mismo_organo: q.organo_nif !== null && f.organo_nif === q.organo_nif,
  };
}

function describir(prefijo: string | null, relajado: boolean, q: ConsultaIndices): string {
  return [
    prefijo ? `CPV ${prefijo}${prefijo.length < 8 ? '…' : ''}` : 'sin CPV',
    `${ANIOS} años`,
    q.presupuesto ? `÷${FACTOR_BANDA}–×${FACTOR_BANDA} del presupuesto` : null,
    relajado ? 'cualquier procedimiento' : `procedimiento ${grupo(q.procedimiento)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** El primer nivel del retroceso con 20 comparables o, si ninguno llega, el más amplio. */
export function comparablesDe(db: Db, q: ConsultaIndices): Muestra {
  const referenciaMs = Date.parse(q.referencia);
  let ultima: Muestra = {
    comparables: [],
    cpv: null,
    cifras_cpv: 0,
    procedimiento_relajado: false,
    descripcion: 'sin CPV',
  };
  for (const prefijo of q.cpv ? prefijosRetroceso(q.cpv) : []) {
    const todas = leer(db, q, prefijo).map((f) => ({ f, c: aComparable(f, q, referenciaMs) }));
    for (const relajado of [false, true]) {
      const elegidas = relajado ? todas : todas.filter(({ f }) => grupo(f.procedimiento) === grupo(q.procedimiento));
      ultima = {
        comparables: elegidas.map((x) => x.c),
        cpv: prefijo,
        cifras_cpv: prefijo.length,
        procedimiento_relajado: relajado,
        descripcion: describir(prefijo, relajado, q),
      };
      if (elegidas.length >= MIN_COMPARABLES) return ultima;
    }
  }
  return ultima;
}
