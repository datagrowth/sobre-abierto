// Lo que el instalador necesita saber tras actualizar para reiniciar Hermes solo cuando hace falta:
// qué perfiles tienen la lista de herramientas de antes del despliegue y cuántos runs cortaría.
import type { Db } from '../db.js';
import { agentesDeHermes } from '../agentes/registro.js';
import { desfasados } from './huellas.js';

export type EstadoReinicio = { desfasados: string[]; enMarcha: number };

export function estadoReinicio(db: Db, agentesDir: string): EstadoReinicio {
  const enMarcha = (db.prepare("SELECT COUNT(*) AS n FROM trabajos_ia WHERE estado = 'lanzado'").get() as { n: number })
    .n;
  return { desfasados: desfasados(db, agentesDeHermes(agentesDir)).map((d) => d.agente), enMarcha };
}

/** Una clave por línea, fácil de leer desde el shell: «desfasados=a,b» y «en_marcha=N». */
export const textoReinicio = (e: EstadoReinicio): string =>
  `desfasados=${e.desfasados.join(',')}\nen_marcha=${e.enMarcha}`;
