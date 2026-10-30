// Lo que la pantalla Equipo enseña de cada persona además de su ficha guardada.
import type { Db } from '../db.js';
import { ok, type Result } from '../result.js';
import {
  asignaciones as todasLasAsignaciones,
  DISPONIBLE,
  disponibilidadDe,
  type Asignacion,
  type Disponibilidad,
} from './disponibilidad.js';
import { listarPersonas, obtenerPersona, type FiltroPersonasData, type PersonaGuardada } from './personas.js';

// Incluye la disponibilidad calculada, si su CV es antiguo o hay uno nuevo por revisar y, en la ficha, dónde
// está (ofertas y contratos con su rol) y cuántas ofertas se ganaron con ella.
// Un CV leído hace más de un año ya no dice lo que la persona acredita hoy.
const MESES_CV_ANTIGUO = 12;

// leido_en: cuándo se aprobó lo leído del CV (o se dio de alta con él); nuevo: el perfil leído de un CV más reciente que espera revisión.
type EstadoCv = { leido_en: string | null; antiguo: boolean; nuevo: number | null };
export type PersonaEquipo = PersonaGuardada & { disponibilidad: Disponibilidad; cv: EstadoCv };
export type FichaEquipo = PersonaEquipo & {
  asignaciones: Asignacion[];
  ofertas: { ganadas: number; resueltas: number };
};

function haceMeses(desde: Date, meses: number): string {
  const d = new Date(desde);
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString();
}

function estadoCv(db: Db, p: PersonaGuardada, hoy = new Date()): EstadoCv {
  const aprobado = p.cv_ruta
    ? (
        db
          .prepare(
            `SELECT MAX(revisada_en) AS en FROM personas_propuestas
    WHERE persona_id = ? AND cv_ruta = ? AND estado = 'aprobada'`,
          )
          .get(p.id, p.cv_ruta) as { en: string | null }
      ).en
    : null;
  const leido = aprobado ?? (p.cv_ruta ? p.creada_en : null);
  const nuevo = db
    .prepare(
      "SELECT id FROM personas_propuestas WHERE persona_id = ? AND estado = 'pendiente' ORDER BY actualizada_en DESC LIMIT 1",
    )
    .get(p.id) as { id: number } | undefined;
  return {
    leido_en: leido,
    antiguo: leido !== null && leido < haceMeses(hoy, MESES_CV_ANTIGUO),
    nuevo: nuevo?.id ?? null,
  };
}

const RESUELTAS = new Set(['ganada', 'perdida', 'en_ejecucion']);

function enriquecer(db: Db, p: PersonaGuardada, suyas: Asignacion[], hoy: Date): PersonaEquipo {
  return { ...p, disponibilidad: suyas.length ? disponibilidadDe(suyas) : DISPONIBLE, cv: estadoCv(db, p, hoy) };
}

/** La lista de Equipo: cada persona con su disponibilidad calculada y el estado de su CV. */
export function personasDeEquipo(
  db: Db,
  filtro?: FiltroPersonasData,
  todas: Asignacion[] = todasLasAsignaciones(),
  hoy = new Date(),
): PersonaEquipo[] {
  return listarPersonas(db, filtro).map((p) =>
    enriquecer(
      db,
      p,
      todas.filter((a) => a.persona_id === p.id),
      hoy,
    ),
  );
}

/** La ficha de Equipo: lo de la lista más dónde está y las ofertas ganadas con ella. */
export function fichaDeEquipo(
  db: Db,
  id: number,
  todas: Asignacion[] = todasLasAsignaciones(),
  hoy = new Date(),
): Result<FichaEquipo> {
  const p = obtenerPersona(db, id);
  if (p.error) return p;
  const suyas = todas.filter((a) => a.persona_id === id);
  const resueltas = suyas.filter((a) => RESUELTAS.has(a.estado));
  return ok({
    ...enriquecer(db, p.data, suyas, hoy),
    asignaciones: suyas,
    ofertas: { ganadas: resueltas.filter((a) => a.estado !== 'perdida').length, resueltas: resueltas.length },
  });
}
