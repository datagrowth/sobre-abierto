// Propuestas anteriores parecidas a una licitación, para partir de lo que la empresa ya presentó.
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { clasesDe } from '../competencia/nuestras.js';
import { palabrasObjeto } from '../antecedentes/texto.js';
import { cpvsTexto, type Db } from '../store.js';
import { lotesDeLicitacion } from '../lotes.js';
import { aPropuesta, type Propuesta } from './registro.js';
import { aprendizajesDe, mismoOrgano, type Aprendizaje } from './aprendizaje.js';

// Sirven al Redactor y al Evaluador. Parecido es mismo órgano (cliente), misma clase o división CPV (área),
// mismo tipo de contrato y presupuesto parecido (÷3 a ×3). Las ganadas primero y las débiles (sin objeto ni CPV
// de verdad parecidos) al final: la web no las enseña. También se incluye lo aprendido de las actas de mesa del
// mismo órgano o CPV (aprendizaje.ts).
type Objetivo = {
  id: string;
  titulo: string;
  organo_nif: string | null;
  tipo_contrato: string | null;
  cpvs: string;
  presupuesto_sin_iva: number | null;
};
type Fila = Parameters<typeof aPropuesta>[0] & {
  titulo: string;
  organo: string;
  organo_nif: string | null;
  tipo_contrato: string | null;
  cpvs: string;
  base: number | null;
  carpeta: string | null;
};

export type Parecida = Pick<
  Propuesta,
  | 'id'
  | 'licitacion_id'
  | 'lote'
  | 'presentada_en'
  | 'resultado'
  | 'importe_ofertado'
  | 'baja_ofertada'
  | 'puntos_tecnica'
  | 'puntos_economica'
  | 'puntos_total'
  | 'puntos_ganador'
  | 'posicion'
  | 'documentos'
  | 'lecciones'
> & {
  titulo: string;
  organo: string;
  motivos: string[];
  puntos_parecido: number;
  carpeta: string | null;
  debil: boolean;
};

// Con un punto o menos (casi siempre solo el tipo de contrato) no es un precedente: se avisa
// para que el redactor no lea once documentos de algo que no se parece.
export const UMBRAL_PARECIDO = 1;
// Pasar de un punto tampoco basta: Una de IA en compras (CPV 72) salía para otra (formación,
// CPV 72500000 entre otros) por «misma división CPV 72» y el tipo de contrato. Sin la misma
// clase CPV hace falta además que el objeto se parezca: esta parte de las palabras del título en común.
const UMBRAL_OBJETO = 0.3;
const ORDEN_RESULTADO: Record<string, number> = { ganada: 0, perdida: 1, excluida: 2 };
const divisiones = (cpvs: string) =>
  new Set(
    cpvs
      .split(',')
      .filter(Boolean)
      .map((c) => c.slice(0, 2)),
  );

/** Motivos y puntos de parecido: órgano 3, clase CPV 2 (o división 1), tipo 1, presupuesto 1. */
function parecido(
  o: Objetivo,
  f: Pick<Fila, 'organo_nif' | 'tipo_contrato' | 'cpvs' | 'base'>,
): { puntos: number; motivos: string[] } {
  const motivos: string[] = [];
  let puntos = 0;
  if (o.organo_nif && f.organo_nif === o.organo_nif) {
    puntos += 3;
    motivos.push('mismo órgano');
  }
  const clase = clasesDe(f.cpvs).find((c) => clasesDe(o.cpvs).includes(c));
  const division = [...divisiones(f.cpvs)].find((d) => divisiones(o.cpvs).has(d));
  if (clase) {
    puntos += 2;
    motivos.push(`misma clase CPV ${clase}`);
  } else if (division) {
    puntos += 1;
    motivos.push(`misma división CPV ${division}`);
  }
  if (o.tipo_contrato && f.tipo_contrato === o.tipo_contrato) {
    puntos += 1;
    motivos.push('mismo tipo de contrato');
  }
  const a = o.presupuesto_sin_iva;
  if (a && f.base && f.base >= a / 3 && f.base <= a * 3) {
    puntos += 1;
    motivos.push('presupuesto parecido');
  }
  return { puntos, motivos };
}

/** Parte de las palabras del objeto que comparten dos títulos (Jaccard, sin pesos: son pocas propuestas). */
function parecidoObjeto(a: string, b: string): number {
  const x = palabrasObjeto(a);
  const y = palabrasObjeto(b);
  const comunes = [...x].filter((t) => y.has(t)).length;
  const total = new Set([...x, ...y]).size;
  return total ? comunes / total : 0;
}

/** Débil: un punto o menos, o sin la misma clase CPV y sin la división más un objeto parecido. */
function esDebil(o: Objetivo, f: Pick<Fila, 'titulo' | 'cpvs'>, puntos: number): boolean {
  if (puntos <= UMBRAL_PARECIDO) return true;
  if (clasesDe(f.cpvs).some((c) => clasesDe(o.cpvs).includes(c))) return false;
  const division = [...divisiones(f.cpvs)].some((d) => divisiones(o.cpvs).has(d));
  return !(division && parecidoObjeto(o.titulo, f.titulo) >= UMBRAL_OBJETO);
}

function aParecida(f: Fila, o: Objetivo): Parecida {
  const p = aPropuesta(f);
  const { puntos, motivos } = parecido(o, f);
  return {
    id: p.id,
    licitacion_id: p.licitacion_id,
    lote: p.lote,
    presentada_en: p.presentada_en,
    resultado: p.resultado,
    importe_ofertado: p.importe_ofertado,
    baja_ofertada: p.baja_ofertada,
    puntos_tecnica: p.puntos_tecnica,
    puntos_economica: p.puntos_economica,
    puntos_total: p.puntos_total,
    puntos_ganador: p.puntos_ganador,
    posicion: p.posicion,
    documentos: p.documentos,
    lecciones: p.lecciones,
    titulo: f.titulo,
    organo: f.organo,
    motivos,
    puntos_parecido: puntos,
    carpeta: f.carpeta,
    debil: esDebil(o, f, puntos),
  };
}

// Con lotes de interés, lo que se presentaría son esos lotes: su importe y su CPV son
// los que hay que comparar con lo presentado antes.
function objetivoDe(db: Db, licitacionId: string): Objetivo | null {
  const o = db
    .prepare('SELECT id, titulo, organo_nif, tipo_contrato, cpvs, presupuesto_sin_iva FROM licitaciones WHERE id = ?')
    .get(licitacionId) as Objetivo | undefined;
  const ambito = lotesDeLicitacion(db, licitacionId)?.ambito;
  if (!o || !ambito?.por_lotes) return o ?? null;
  return { ...o, cpvs: cpvsTexto(ambito.cpvs), presupuesto_sin_iva: ambito.importe ?? o.presupuesto_sin_iva };
}

/** Propuestas de otras licitaciones que se parecen en algo, las débiles al final; entre iguales, las ganadas primero y luego por parecido y fecha. */
export function propuestasParecidas(db: Db, licitacionId: string, limite: number): Result<Parecida[]> {
  const o = objetivoDe(db, licitacionId);
  if (!o) return fail('not_found', `No hay ninguna licitación con id «${licitacionId}».`);
  // La carpeta de lo presentado (en Conocimiento) trae lo que se entregó: el Redactor y el Evaluador la leen.
  const filas = db
    .prepare(
      `SELECT p.*, l.titulo, l.organo_nombre AS organo, l.organo_nif, l.tipo_contrato, l.cpvs,
      COALESCE(p.presupuesto, l.presupuesto_sin_iva) AS base, c.ruta AS carpeta FROM propuestas p JOIN licitaciones l ON l.id = p.licitacion_id
      LEFT JOIN carpetas_presentadas c ON c.licitacion_id = p.licitacion_id AND c.estado = 'hecha'
    WHERE p.licitacion_id <> ?`,
    )
    .all(licitacionId) as Fila[];
  const parecidas = filas.map((f) => aParecida(f, o)).filter((p) => p.puntos_parecido > 0);
  parecidas.sort(
    (a, b) =>
      Number(a.debil) - Number(b.debil) ||
      (ORDEN_RESULTADO[a.resultado] ?? 3) - (ORDEN_RESULTADO[b.resultado] ?? 3) ||
      b.puntos_parecido - a.puntos_parecido ||
      b.presentada_en.localeCompare(a.presentada_en),
  );
  return ok(parecidas.slice(0, limite));
}

export type AprendizajeParecido = Pick<
  Aprendizaje,
  'id' | 'carpeta' | 'licitacion_id' | 'expediente' | 'organo' | 'documento'
> &
  Pick<
    Aprendizaje['datos'],
    'resultado' | 'ganador' | 'puntos_nuestros' | 'puntos_ganador' | 'criterios' | 'lecciones'
  > & { motivos: string[] };

type Destino = { organo_nif: string | null; organo_nombre: string; cpvs: string };

// Con la licitación enlazada (carpeta creada por la plataforma) se compara NIF y CPV; si no,
// solo el órgano por su nombre, que es lo que dice la carpeta.
function motivosAprendizaje(db: Db, a: Aprendizaje, o: Destino): string[] {
  const l = a.licitacion_id
    ? (db.prepare('SELECT organo_nif, cpvs FROM licitaciones WHERE id = ?').get(a.licitacion_id) as
        { organo_nif: string | null; cpvs: string } | undefined)
    : undefined;
  const motivos: string[] = [];
  if ((o.organo_nif && l?.organo_nif === o.organo_nif) || mismoOrgano(a.organo, o.organo_nombre))
    motivos.push('mismo órgano');
  const clase = l ? clasesDe(l.cpvs).find((c) => clasesDe(o.cpvs).includes(c)) : undefined;
  if (clase) motivos.push(`misma clase CPV ${clase}`);
  return motivos;
}

/** Lo aprendido de las actas (aceptado por una persona) en el mismo órgano o la misma clase CPV. */
export function aprendizajesParecidos(db: Db, licitacionId: string, limite: number): AprendizajeParecido[] {
  const o = db.prepare('SELECT organo_nif, organo_nombre, cpvs FROM licitaciones WHERE id = ?').get(licitacionId) as
    Destino | undefined;
  if (!o) return [];
  return aprendizajesDe(db, true)
    .filter((a) => a.licitacion_id !== licitacionId)
    .map((a) => ({ a, motivos: motivosAprendizaje(db, a, o) }))
    .filter((x) => x.motivos.length > 0)
    .slice(0, limite)
    .map(({ a, motivos }) => ({
      id: a.id,
      carpeta: a.carpeta,
      licitacion_id: a.licitacion_id,
      expediente: a.expediente,
      organo: a.organo,
      documento: a.documento,
      resultado: a.datos.resultado,
      ganador: a.datos.ganador,
      puntos_nuestros: a.datos.puntos_nuestros,
      puntos_ganador: a.datos.puntos_ganador,
      criterios: a.datos.criterios,
      lecciones: a.datos.lecciones,
      motivos,
    }));
}
