// Resultado de las propuestas a partir de la PLACSP: ganada, perdida o desierta al publicarse la adjudicación.
import { emitir } from '../../../nucleo/eventos.js';
import { normalizarNif } from '../../../nucleo/organizaciones.js';
import { RESULTADOS_ADJUDICADOS } from '../placsp/codigos.js';
import type { Db } from '../store.js';
import { sincronizarOportunidad } from './oportunidad.js';
import { lotesDe } from './registro.js';
import { leccionesDeResolucion, MINIMO_PRECIOS } from './leccionesResultado.js';

// Cuando la PLACSP publica la adjudicación de una licitación (o del lote) a la que la empresa se presenta, la
// propuesta pasa sola a «ganada» si el adjudicatario es el NIF del perfil de la empresa, a «perdida» si es otro
// o a «desierta». Si la PLACSP cambia luego la adjudicación (recurso, renuncia, provisional que pasa a otro), se
// vuelve a decidir. Nunca pisa un resultado puesto por una persona. Las puntuaciones las mete una persona: la
// PLACSP no las publica.
// Desierto, desistimiento y renuncia: el contrato no se adjudica a nadie. El «desierto
// provisionalmente» (6) y el «licitador mejor valorado» (10) aún pueden cambiar.
const SIN_ADJUDICAR = new Set(['3', '4', '5', '7']);

export type FilaAdjudicacion = {
  lote: string;
  resultado: string | null;
  adjudicatario_nif: string | null;
  adjudicatario_nombre: string | null;
  importe_sin_iva: number | null;
  baja: number | null;
};
export type Decision = { resultado: 'ganada' | 'perdida' | 'desierta' | null; ganador: FilaAdjudicacion | null };

const adjudicada = (f: FilaAdjudicacion) =>
  f.resultado !== null && RESULTADOS_ADJUDICADOS.has(f.resultado) && f.adjudicatario_nif !== null;
const cerrada = (f: FilaAdjudicacion) => adjudicada(f) || (f.resultado !== null && SIN_ADJUDICAR.has(f.resultado));

/**
 * Qué dicen las adjudicaciones del lote de la empresa (o de todos, si la propuesta es al contrato
 * entero) sobre la propuesta de la empresa. Sin el NIF de la empresa solo se sabe quién ganó.
 * Si ganó una UTE (NIF que empieza por U) no se decide: la empresa puede formar parte de ella.
 * `lotes`: los de la licitación si la propuesta es al contrato entero. La PLACSP no publica
 * nada de un lote sin resolver, así que cada uno debe tener su fila cerrada.
 */
export function decidirResultado(filas: FilaAdjudicacion[], nifEmpresa: string | null, lotes: string[] = []): Decision {
  const ganadas = filas.filter(adjudicada);
  const nuestra = nifEmpresa ? ganadas.find((f) => f.adjudicatario_nif === nifEmpresa) : undefined;
  if (nuestra) return { resultado: 'ganada', ganador: nuestra };
  const ganador = ganadas[0] ?? null;
  const todosLosLotes = lotes.every((l) => filas.some((f) => f.lote === l && cerrada(f)));
  const ute = ganadas.some((f) => f.adjudicatario_nif!.startsWith('U'));
  if (!nifEmpresa || !filas.length || !filas.every(cerrada) || !todosLosLotes || ute)
    return { resultado: null, ganador };
  return { resultado: ganadas.length ? 'perdida' : 'desierta', ganador };
}

type Candidata = {
  id: number;
  licitacion_id: string;
  lote: string;
  resultado: string;
  resultado_origen: string | null;
  ganador_nif: string | null;
  datos: string;
};

// Todas las que tienen adjudicación publicada: las automáticas se vuelven a decidir y de
// todas se apunta el ganador si cambia.
const CANDIDATAS = `SELECT p.id, p.licitacion_id, p.lote, p.resultado, p.resultado_origen, p.ganador_nif, l.datos
  FROM propuestas p JOIN licitaciones l ON l.id = p.licitacion_id
  WHERE EXISTS (SELECT 1 FROM adjudicaciones a WHERE a.licitacion_id = p.licitacion_id AND (p.lote = '' OR a.lote = p.lote))`;

function filasDe(db: Db, p: Candidata): FilaAdjudicacion[] {
  return db
    .prepare(
      `SELECT lote, resultado, adjudicatario_nif, adjudicatario_nombre, importe_sin_iva, baja FROM adjudicaciones
    WHERE licitacion_id = ? AND (? = '' OR lote = ?) ORDER BY ord`,
    )
    .all(p.licitacion_id, p.lote, p.lote) as FilaAdjudicacion[];
}

function guardarGanador(db: Db, p: Candidata, g: FilaAdjudicacion, ts: string): void {
  db.prepare(
    `UPDATE propuestas SET ganador_nif = ?, ganador_nombre = ?, importe_ganador = ?, baja_ganadora = ?, actualizada_en = ?
    WHERE id = ?`,
  ).run(g.adjudicatario_nif, g.adjudicatario_nombre, g.importe_sin_iva, g.baja, ts, p.id);
}

function aplicarResultado(
  db: Db,
  p: Candidata,
  resultado: 'ganada' | 'perdida' | 'desierta',
  ts: string,
  minimoPrecios: number,
): boolean {
  const r = db
    .prepare(
      `UPDATE propuestas SET resultado = ?, resultado_origen = 'placsp', resuelta_en = ?, actualizada_en = ?
    WHERE id = ? AND resultado = ? AND (resultado_origen IS NULL OR resultado_origen = 'placsp')`,
    )
    .run(resultado, ts, ts, p.id, p.resultado);
  if (r.changes === 0) return false;
  sincronizarOportunidad(db, p.licitacion_id, ts);
  leccionesDeResolucion(db, p.id, minimoPrecios);
  // Sin el NIF del ganador: puede ser una persona física (su DNI).
  const antes = p.resultado !== 'pendiente' ? { antes: p.resultado } : {};
  emitir(db, {
    tipo: 'licitacion.propuesta_resuelta',
    dominio: 'licitaciones',
    recurso: p.licitacion_id,
    datos: { propuesta: p.id, resultado, origen: 'placsp', ...antes },
  });
  return true;
}

function revisar(db: Db, p: Candidata, nif: string | null, ts: string, minimoPrecios: number): boolean {
  const d = decidirResultado(filasDe(db, p), nif, p.lote === '' ? lotesDe(p.datos) : []);
  if (d.ganador && d.ganador.adjudicatario_nif !== p.ganador_nif) guardarGanador(db, p, d.ganador, ts);
  if (p.resultado_origen === 'manual' || !d.resultado || d.resultado === p.resultado) return false;
  return aplicarResultado(db, p, d.resultado, ts, minimoPrecios);
}

/**
 * Revisa las propuestas con adjudicación publicada. Devuelve cuántos resultados cambiaron. Cada
 * resultado nuevo deja sus lecciones de decisión y de precio (`minimoPrecios`: las adjudicaciones
 * que hacen falta para dar la mediana del segmento).
 */
export function resolverPropuestas(db: Db, nifEmpresa: string | null, minimoPrecios = MINIMO_PRECIOS): number {
  const nif = nifEmpresa ? normalizarNif(nifEmpresa) : null;
  const ts = new Date().toISOString();
  let resueltas = 0;
  for (const p of db.prepare(CANDIDATAS).all() as Candidata[]) {
    if (db.transaction(() => revisar(db, p, nif, ts, minimoPrecios))()) resueltas += 1;
  }
  return resueltas;
}
