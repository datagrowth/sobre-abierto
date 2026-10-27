// El MCP en Ajustes › Integraciones: agentes con acceso, última llamada y llamadas en 24 horas.
import { agentesConocidos } from '../agentes/registro.js';
import { nucleo } from '../contexto.js';
import type { Db } from '../db.js';

// Los datos salen de la auditoría. Las claves viven en el registro de agentes y se cambian allí
// (docs/operacion.md); aquí solo se ven.
export type EstadoMcp = { agentes: number; ultima_llamada: string | null; llamadas_24h: number };

export function estadoMcp(db: Db, ahoraMs = Date.now()): EstadoMcp {
  const desde = new Date(ahoraMs - 86_400_000).toISOString();
  const f = db
    .prepare('SELECT MAX(creado_en) AS ultima, SUM(creado_en >= ?) AS dia FROM auditoria_agentes')
    .get(desde) as { ultima: string | null; dia: number | null };
  return {
    agentes: agentesConocidos(nucleo().config.agentesDir).length,
    ultima_llamada: f.ultima,
    llamadas_24h: f.dia ?? 0,
  };
}
