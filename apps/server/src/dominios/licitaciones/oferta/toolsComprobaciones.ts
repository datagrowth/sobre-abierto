// Tools MCP de las comprobaciones: lo que ve la persona, para el agente. Solo leen: aplicar un
// cambio o cerrar una fila es siempre de una persona.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { puede } from '../../../nucleo/agentes/permisos.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { registrarHerramienta } from '../../../nucleo/mcp/herramienta.js';
import { ok } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import { CambioImpacto } from './dependencias.js';
import { impactoDeLicitacion, impactoSinNombres } from './impacto.js';

const ConsultaImpacto = z.object({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  cambio: CambioImpacto.describe(
    'Una sola cosa: decisiones ({precio: {lote}}, {equipo: [{persona_id, sale}]}, automaticos, herramientas o enfoque), lotes (los que quedarían), empresa (los campos del perfil que cambian) o guion: «reextraer»',
  ),
});

export function herramientasComprobaciones(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_impacto',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaImpacto,
    descripcion:
      'Qué rehace un cambio antes de hacerlo: piezas afectadas, acción, coste y lo que se mantiene. Solo lee; aplicar el cambio es de una persona. Sin importes.',
    recurso: (a) => a.id,
    ejecutar: async (a, ag) => {
      const r = impactoDeLicitacion(dbLicitaciones(), nucleo().db, a.id, { cambio: a.cambio });
      if (r.error || puede(ag.permisos, 'colaboradores', 'leer')) return r;
      return ok(impactoSinNombres(nucleo().db, r.data));
    },
  });
}
