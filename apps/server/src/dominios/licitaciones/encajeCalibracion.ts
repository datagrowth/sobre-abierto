// Calibración del encaje con el histórico de decisiones: ¿ordena el encaje como lo hacen las personas?
import { leerPerfilEmpresa } from '../../nucleo/empresa.js';
import {
  contextoEncaje,
  contextoSin,
  COMPONENTES,
  encajeDe,
  entradaDeGoNoGo,
  opinionQueManda,
  type ClaveComponente,
  type Encaje,
} from './encaje.js';
import { goNoGo } from './ficha.js';
import type { Db } from './store.js';

// Positivas, las que una persona pasó a preparar (y las presentadas); negativas, las que una persona descartó.
// El AUC dice la probabilidad de que una preparada tenga más encaje que una descartada. Hasta llegar a 0,75 el
// encaje no ordena Oportunidades (se ordena por plazo y se enseñan los componentes). Sin un mínimo de decididas
// de cada clase no hay AUC.
export const AUC_PARA_ORDENAR = 0.75;
export const MIN_POR_CLASE = 20;

/** AUC de Mann-Whitney: la proporción de pares (positiva, negativa) en que gana la positiva; un empate vale medio. */
export function auc(positivas: number[], negativas: number[]): number | null {
  if (!positivas.length || !negativas.length) return null;
  let gana = 0;
  for (const p of positivas) for (const n of negativas) gana += p > n ? 1 : p === n ? 0.5 : 0;
  return gana / (positivas.length * negativas.length);
}

export type Calibracion = {
  positivas: number;
  negativas: number;
  minimo: number;
  suficiente: boolean;
  auc: number | null;
  ordena: boolean;
  componentes: { clave: ClaveComponente; auc: number | null; con_datos: number }[];
};

const SQL_DECIDIDAS = `SELECT l.*, o.estado AS op_estado, o.veredicto_ia, o.cambiada_a_mano, o.descarte_automatico, o.lotes_interes, o.lotes_prefiltro,
    CASE WHEN o.estado IN ('en_preparacion', 'presentada', 'ganada', 'perdida') OR EXISTS (SELECT 1 FROM propuestas p WHERE p.licitacion_id = l.id) THEN 1
      WHEN o.estado = 'descartada' AND (SELECT d.automatico FROM descartes_historial d WHERE d.licitacion_id = l.id AND d.accion = 'descartada' ORDER BY d.id DESC LIMIT 1) = 0 THEN 0
    END AS clase
  FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id`;

type Decidida = Parameters<typeof goNoGo>[1] & {
  id: string;
  cpvs: string;
  organo_nif: string | null;
  presupuesto_sin_iva: number | null;
  fecha_limite: string | null;
  veredicto_ia: string | null;
  cambiada_a_mano: number;
  descarte_automatico: number;
  clase: number | null;
};

// Cada decidida se puntúa sin sus propias propuestas (contextoSin): con ellas, una preparada se compararía
// consigo misma y el AUC saldría alto sin señal. Ojo: con los datos de hoy, no con los del día de la decisión.
function encajeDeDecidida(
  db: Db,
  ctx: ReturnType<typeof contextoEncaje>,
  perfil: Parameters<typeof goNoGo>[2],
  f: Decidida,
  hoy: Date,
): Encaje {
  const g = goNoGo(db, f, perfil, hoy);
  const de_hermes = !f.cambiada_a_mano && (f.veredicto_ia === 'descartar' || Boolean(f.descarte_automatico));
  const opinion = opinionQueManda({
    de_hermes,
    decision_ficha: g.ficha.aprobada?.datos.recomendacion.decision ?? null,
    veredicto_ia: f.veredicto_ia,
  });
  return encajeDe(ctx, entradaDeGoNoGo(f, g, opinion));
}

export function calibrarEncaje(db: Db, ahoraMs = Date.now(), minimo = MIN_POR_CLASE): Calibracion {
  const perfil = leerPerfilEmpresa(db)?.perfil ?? null;
  const ctx = contextoEncaje(db, perfil, ahoraMs);
  const filas = (db.prepare(SQL_DECIDIDAS).all() as Decidida[]).filter((f) => f.clase === 0 || f.clase === 1);
  const calculadas = filas.map((f) => ({
    clase: f.clase,
    e: encajeDeDecidida(db, contextoSin(ctx, f.id), perfil, f, new Date(ahoraMs)),
  }));
  const positivas = calculadas.filter((x) => x.clase === 1).length;
  const negativas = calculadas.length - positivas;
  const suficiente = positivas >= minimo && negativas >= minimo;
  const valores = (clase: number, de: (e: Encaje) => number | null) =>
    calculadas
      .filter((x) => x.clase === clase)
      .map((x) => de(x.e))
      .filter((v): v is number => v !== null);
  const aucDe = (de: (e: Encaje) => number | null) => (suficiente ? auc(valores(1, de), valores(0, de)) : null);
  const total = aucDe((e) => e.valor);
  return {
    positivas,
    negativas,
    minimo,
    suficiente,
    auc: total,
    ordena: total !== null && total >= AUC_PARA_ORDENAR,
    componentes: COMPONENTES.map((c) => {
      const de = (e: Encaje) => e.componentes.find((x) => x.clave === c.clave)?.valor ?? null;
      return { clave: c.clave, auc: aucDe(de), con_datos: calculadas.filter((x) => de(x.e) !== null).length };
    }),
  };
}

// Calibrar recorre todas las decididas: se guarda unas horas por base (en memoria; un reinicio la rehace).
const VIGENCIA_MS = 6 * 3_600_000;
const vigentes = new WeakMap<Db, { hasta: number; c: Calibracion }>();

/** La calibración de las últimas horas (la de la lista, el resumen semanal y GET /encaje/calibracion). */
export function calibracionVigente(db: Db, ahoraMs = Date.now()): Calibracion {
  const v = vigentes.get(db);
  if (v && v.hasta > ahoraMs) return v.c;
  const c = calibrarEncaje(db, ahoraMs);
  vigentes.set(db, { hasta: ahoraMs + VIGENCIA_MS, c });
  return c;
}

/** La puerta: el encaje solo ordena (Oportunidades y el resumen semanal) si la calibración lo dice. */
export const encajeOrdena = (db: Db, ahoraMs = Date.now()): boolean => calibracionVigente(db, ahoraMs).ordena;
