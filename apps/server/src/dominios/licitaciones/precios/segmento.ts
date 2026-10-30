// Muestra de bajas de adjudicaciones parecidas, con retroceso jerárquico del segmento.
import { nombreDe, PROCEDIMIENTOS, RESULTADOS_ADJUDICADOS, TIPOS_CONTRATO } from '../placsp/codigos.js';
import type { Db } from '../store.js';
import { tramoDeOfertas, type Observacion } from './estadistica.js';
import { claveOrgano, sqlOrgano, type ClaveOrgano } from '../antecedentes/organo.js';

// Se empieza por el segmento más fino (CPV de 8 cifras, tipo, procedimiento y banda de importe) y se va
// ensanchando (sin procedimiento, sin banda, CPV más corto…) hasta tener la muestra mínima. Así una licitación
// rara no se queda sin referencia y una común se compara con lo más parecido.
// Rango plausible de baja. Una baja negativa (adjudicado por encima del presupuesto) o
// por encima del 70 % casi siempre es un error de datos: IVA incluido en un lado y no
// en el otro, precios unitarios publicados como importe total, o lotes mal casados.
// En un mes real del feed de perfiles: 1 % negativas, 13 % por encima del 70 % (la
// mayoría rozando el 100 %: precio unitario como importe).
const BAJA_MIN = 0;
const BAJA_MAX = 0.7;
// Una baja exactamente 0 con dos o más ofertas es casi siempre el presupuesto máximo de
// un acuerdo marco o de precios unitarios publicado como importe, no una oferta: fuera.
// Con una sola oferta sí es creíble (el único licitador oferta el presupuesto).
// Una adjudicada con 0 ofertas es un error de datos (incidencia de calidad, calidad.ts): fuera.
export const SQL_PLAUSIBLE = `a.baja BETWEEN ${BAJA_MIN} AND ${BAJA_MAX} AND NOT (a.baja = 0 AND COALESCE(a.ofertas, 0) >= 2) AND COALESCE(a.ofertas, 1) <> 0`;
// Banda de importe: ×/÷ 3 alrededor del presupuesto (medio orden de magnitud a cada lado).
export const FACTOR_BANDA = 3;
// Tope de filas que se leen por consulta: las más recientes.
const LIMITE_FILAS = 50_000;

export type Consulta = {
  cpv: string | null;
  presupuesto: number | null;
  tipo: string | null;
  procedimiento: string | null;
  // NIF del órgano: solo se filtra por él si mismo_organo. Sin NIF (plataformas agregadas),
  // su DIR3 y su nombre normalizado (organo_dir3, organo_norm de licitaciones).
  organo: string | null;
  mismo_organo: boolean;
  organo_dir3?: string | null;
  organo_norm?: string | null;
  // Título (o nombre del lote) para ordenar las adjudicaciones parecidas por objeto.
  titulo?: string | null;
  // Número de ofertas esperado: si se da, se compara solo con adjudicaciones de su tramo.
  ofertas: number | null;
  // Licitación que no debe contarse (la que se está estudiando).
  excluir: string | null;
};

type Fila = {
  baja: number;
  cpvs: string;
  tipo: string | null;
  proc: string | null;
  presupuesto: number | null;
  organo: string | null;
  ofertas: number | null;
  anio: number | null;
};

export type Nivel = { cpv: string | null; tipo: boolean; proc: boolean; banda: boolean };

export type Segmento = {
  descripcion: string;
  nivel: Nivel;
  n: number;
  excluidas: number;
  suficiente: boolean;
  minimo: number;
  importe_min: number | null;
  importe_max: number | null;
  probados: { descripcion: string; n: number }[];
};

/** Prefijos del CPV de más fino a más grueso (8, 5, 4, 3, 2 cifras) sin repetir los que son solo ceros. */
export function prefijosCpv(cpv: string): string[] {
  const significativo = cpv.replace(/0+$/, '');
  const largos = [8, 5, 4, 3, 2].filter((n) =>
    n === 8 ? significativo.length > 5 : n <= Math.max(significativo.length, 2),
  );
  return [...new Set(largos.map((n) => cpv.slice(0, n)))];
}

const VARIANTES = [
  { tipo: true, proc: true, banda: true },
  { tipo: true, proc: false, banda: true },
  { tipo: true, proc: false, banda: false },
];
const SIN_CPV: Nivel[] = [
  { cpv: null, tipo: true, proc: false, banda: true },
  { cpv: null, tipo: true, proc: false, banda: false },
  { cpv: null, tipo: false, proc: false, banda: false },
];

// Un filtro sin dato en la consulta (p. ej. sin procedimiento) no filtra: esos niveles se funden.
function efectivo(n: Nivel, c: Consulta): Nivel {
  return {
    cpv: n.cpv,
    tipo: n.tipo && c.tipo !== null,
    proc: n.proc && c.procedimiento !== null,
    banda: n.banda && c.presupuesto !== null,
  };
}

/** Niveles del retroceso, de más específico a más general, sin repetidos. */
export function niveles(c: Consulta): Nivel[] {
  const conCpv = c.cpv ? prefijosCpv(c.cpv).flatMap((cpv) => VARIANTES.map((v) => ({ cpv, ...v }))) : [];
  const vistos = new Set<string>();
  return [...conCpv, ...SIN_CPV]
    .map((n) => efectivo(n, c))
    .filter((n) => {
      const clave = JSON.stringify(n);
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
}

export function banda(presupuesto: number | null): { min: number; max: number } | null {
  return presupuesto === null || presupuesto <= 0
    ? null
    : { min: presupuesto / FACTOR_BANDA, max: presupuesto * FACTOR_BANDA };
}

function enBanda(valor: number | null, b: { min: number; max: number } | null): boolean {
  return b === null || (valor !== null && valor >= b.min && valor <= b.max);
}

function casa(f: Fila, n: Nivel, c: Consulta): boolean {
  if (n.cpv && !f.cpvs.includes(`,${n.cpv}`)) return false;
  if (n.tipo && f.tipo !== c.tipo) return false;
  if (n.proc && f.proc !== c.procedimiento) return false;
  if (n.banda && !enBanda(f.presupuesto, banda(c.presupuesto))) return false;
  return c.ofertas === null || tramoDeOfertas(f.ofertas) === tramoDeOfertas(c.ofertas);
}

/** El órgano de la consulta: por NIF o, sin él, por DIR3 o nombre. */
export function claveDeConsulta(c: Consulta): ClaveOrgano | null {
  return claveOrgano({ organo_nif: c.organo, organo_dir3: c.organo_dir3 ?? null, organo_norm: c.organo_norm ?? null });
}

export function plausible(baja: number, ofertas: number | null): boolean {
  return baja >= BAJA_MIN && baja <= BAJA_MAX && !(baja === 0 && (ofertas ?? 0) >= 2) && ofertas !== 0;
}

const EUROS = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

function describir(n: Nivel, c: Consulta): string {
  const b = n.banda ? banda(c.presupuesto) : null;
  const partes = [
    n.cpv ? `CPV ${n.cpv}${n.cpv.length < 8 ? '…' : ''}` : 'todos los CPV',
    n.tipo ? nombreDe(TIPOS_CONTRATO, c.tipo) : null,
    n.proc ? nombreDe(PROCEDIMIENTOS, c.procedimiento) : null,
    b ? `${EUROS.format(b.min)}–${EUROS.format(b.max)} €` : null,
    c.mismo_organo ? 'mismo órgano' : null,
    c.ofertas !== null ? `${tramoDeOfertas(c.ofertas)} ofertas` : null,
  ];
  return partes.filter(Boolean).join(' · ');
}

function leerFilas(db: Db, c: Consulta, cpv: string | null): Fila[] {
  const adjudicados = [...RESULTADOS_ADJUDICADOS];
  const condiciones = [`a.resultado IN (${adjudicados.map(() => '?').join(',')})`, 'a.baja IS NOT NULL'];
  const args: (string | number)[] = [...adjudicados];
  if (c.excluir) {
    condiciones.push('l.id <> ?');
    args.push(c.excluir);
  }
  if (cpv) {
    condiciones.push("instr(l.cpvs, ',' || ?) > 0");
    args.push(cpv);
  }
  const clave = c.mismo_organo ? claveDeConsulta(c) : null;
  if (clave) {
    const o = sqlOrgano(clave, 'l');
    condiciones.push(o.sql);
    args.push(...o.args);
  }
  return db
    .prepare(
      `SELECT a.baja, l.cpvs, l.tipo_contrato AS tipo, l.procedimiento AS proc, a.presupuesto_sin_iva AS presupuesto,
      l.organo_nif AS organo, a.ofertas, CAST(substr(COALESCE(a.fecha, l.actualizada_en), 1, 4) AS INTEGER) AS anio
    FROM adjudicaciones a JOIN licitaciones l ON l.id = a.licitacion_id WHERE ${condiciones.join(' AND ')}
    ORDER BY COALESCE(a.fecha, l.actualizada_en) DESC LIMIT ?`,
    )
    .all(...args, LIMITE_FILAS) as Fila[];
}

type Medido = { nivel: Nivel; validas: Fila[]; excluidas: number };

function medir(filas: Fila[], nivel: Nivel, c: Consulta): Medido {
  const del = filas.filter((f) => casa(f, nivel, c));
  const validas = del.filter((f) => plausible(f.baja, f.ofertas));
  return { nivel, validas, excluidas: del.length - validas.length };
}

// Las filas de los niveles con CPV salen de una consulta por el CPV de 2 cifras; los
// niveles sin CPV, de otra sin él, que solo se hace si los primeros no llegan al mínimo.
function* recorrer(db: Db, c: Consulta): Generator<Medido> {
  const leidas = new Map<string | null, Fila[]>();
  for (const nivel of niveles(c)) {
    const cpv2 = nivel.cpv?.slice(0, 2) ?? null;
    const filas = leidas.get(cpv2) ?? leerFilas(db, c, cpv2);
    leidas.set(cpv2, filas);
    yield medir(filas, nivel, c);
  }
}

/** Elige el primer nivel con muestra suficiente (o el más general si ninguno llega). */
export function elegirSegmento(
  db: Db,
  c: Consulta,
  minimo: number,
): { segmento: Segmento; observaciones: Observacion[] } {
  const probados: { descripcion: string; n: number }[] = [];
  let elegido: Medido | null = null;
  for (const m of recorrer(db, c)) {
    probados.push({ descripcion: describir(m.nivel, c), n: m.validas.length });
    elegido = m;
    if (m.validas.length >= minimo) break;
  }
  const e = elegido ?? { nivel: SIN_CPV[2] as Nivel, validas: [], excluidas: 0 };
  const b = e.nivel.banda ? banda(c.presupuesto) : null;
  const segmento: Segmento = {
    descripcion: describir(e.nivel, c),
    nivel: e.nivel,
    n: e.validas.length,
    excluidas: e.excluidas,
    suficiente: e.validas.length >= minimo,
    minimo,
    importe_min: b?.min ?? null,
    importe_max: b?.max ?? null,
    probados,
  };
  return { segmento, observaciones: e.validas.map((f) => ({ baja: f.baja, anio: f.anio, ofertas: f.ofertas })) };
}
