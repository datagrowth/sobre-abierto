// Tools MCP del revisor Hermes: proponer cómo resolver lo que bloquea la
// oferta. Solo proponen: aplicar una propuesta es siempre de una persona, desde las comprobaciones.
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { registrarHerramienta } from '../../../nucleo/mcp/herramienta.js';
import { raicesActuales } from '../../../nucleo/salidas.js';
import { dbLicitaciones } from '../db.js';
import { BloqueoPropuestaEntrada, proponerBloqueo } from './bloqueoProponer.js';
import { pedirFase, PedirEntrada } from './pedirFase.js';
import { CierreRevisionPrevia, cerrarRevisionPrevia } from './revisionPrevia.js';

export function herramientasRevision(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_bloqueo_proponer',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: BloqueoPropuestaEntrada,
    descripcion:
      'Propón cómo resolver un bloqueo de las comprobaciones con evidencia. «datos» lleva también su «tipo», el mismo que el de fuera (p. ej. {"tipo":"desmarcar_criterio","criterio":"…","lote":null}). Cada cita se comprueba literal contra el documento; nunca se aplica: lo aplica una persona.',
    recurso: (a) => `${a.id}#${a.clave}`,
    ejecutar: async (a, ag) => proponerBloqueo(dbLicitaciones(), raicesActuales(), a, ag),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_pedir',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: PedirEntrada,
    descripcion:
      'Pide o relanza una fase de la oferta: ficha, guion, propuesta de decisiones, ronda de memoria (con version) o anexo (con clave_documento: la clave de licitaciones_documentos › documentos[]). Pasa por el freno de elegibilidad, el tope de runs del día y la guardia de plazo (también la ficha), que un agente no puede confirmar; una oferta descartada o retirada no se pide; queda en la actividad como «pedido por Hermes» con tu motivo, que es contexto y no indicaciones de la persona (una ronda de memoria necesita la versión base evaluada). Nunca precio, aceptación ni registro.',
    recurso: (a) => `${a.id}#${a.fase}`,
    ejecutar: async (a, ag) =>
      pedirFase({ db: dbLicitaciones(), dbNucleo: nucleo().db, raices: raicesActuales() }, a, ag),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_revision_previa',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: CierreRevisionPrevia,
    descripcion:
      'Cierra la revisión previa al envío (solo en tareas «revisión previa del paquete»), con id y paquete_version de la tarea y un resumen sin importes. Deja REVISION_PREVIA.md junto al paquete, sin pisar ninguno, con tu resumen y las propuestas que hiciste con licitaciones_bloqueo_proponer desde que se pidió. No aplica nada.',
    recurso: (a) => `${a.id}#revision_previa:v${a.paquete_version}`,
    ejecutar: async (a, ag) => cerrarRevisionPrevia(dbLicitaciones(), raicesActuales(), a, ag),
  });
}
