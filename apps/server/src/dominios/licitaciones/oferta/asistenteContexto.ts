// Lo que mira el asistente de la oferta para preguntar, leído una vez por petición.
import { listarPersonas, type PersonaGuardada } from '../../../nucleo/colaboradores/personas.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { fichasDe, type FichaDatosData } from '../ficha.js';
import { idsDelAmbito, lotesDeLicitacion, type LotesLicitacion } from '../lotes.js';
import { obtenerLicitacion, type Db, type FilaLicitacion } from '../store.js';
import { hiloDe, type MensajeHilo } from './asistenteHilo.js';
import { decisionesDe, lotesDecididos, type DecisionesData, type DecisionesGuardadas } from './decisiones.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { propuestaDecisionesDe, type PropuestaGuardada } from './propuestaDecisiones.js';

// Guion vigente, decisiones (o unas vacías con los lotes del ámbito), ficha aprobada, lotes, propuesta de
// Hermes, personas e hilo. Las preguntas son funciones puras sobre esto.
export type ContextoAsistente = {
  dbLic: Db;
  dbNucleo: DbNucleo;
  id: string;
  licitacion: FilaLicitacion;
  guion: GuionGuardado;
  guardadas: DecisionesGuardadas | null;
  d: DecisionesData;
  lotes: LotesLicitacion;
  ambito: string[];
  ficha: FichaDatosData | null;
  propuesta: DecisionesData | null;
  propuestaGuardada: PropuestaGuardada | null;
  personas: PersonaGuardada[];
  hilo: MensajeHilo[];
  ahoraMs: number;
};

const VACIAS = { equipo: [], automaticos: [], herramientas: [], enfoque: '', ofertas: [], a_incorporar: [] };

/** El contexto de una licitación con guion vigente; null sin licitación o sin guion (aún no se puede preguntar). */
export function contextoAsistente(
  dbLic: Db,
  dbNucleo: DbNucleo,
  id: string,
  ahoraMs = Date.now(),
): ContextoAsistente | null {
  const licitacion = obtenerLicitacion(dbLic, id);
  const guion = licitacion ? guionVigente(dbLic, id) : null;
  const lotes = lotesDeLicitacion(dbLic, id);
  if (!licitacion || !guion || !lotes) return null;
  const guardadas = decisionesDe(dbLic, id);
  const guardada = propuestaDecisionesDe(dbLic, id);
  // La de otro guion puede hablar de otros criterios o roles: solo vale la del vigente.
  const propuesta = guardada?.guion_id === guion.id ? guardada : null;
  return {
    dbLic,
    dbNucleo,
    id,
    licitacion,
    guion,
    guardadas,
    lotes,
    ambito: idsDelAmbito(lotes.ambito),
    d: guardadas?.datos ?? { ...VACIAS, lotes: lotesDecididos(dbLic, id, []) },
    ficha: fichasDe(dbLic, id).aprobada?.datos ?? null,
    propuesta: propuesta?.decisiones ?? null,
    propuestaGuardada: propuesta,
    personas: listarPersonas(dbNucleo),
    hilo: hiloDe(dbLic, id),
    ahoraMs,
  };
}

export const delLote = (lote: string | null): string => (lote ? ` del lote ${lote}` : '');
export const recorte = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);
export const capital = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
