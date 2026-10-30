// Herramientas MCP de las actas de expedientes ajenos: leer el acta que el código no
// pudo leer entera y devolver quién se presentó. Solo sirven dentro de la tarea licitaciones.leer_acta_mercado.
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../nucleo/agentes/registro.js';
import { registrarHerramienta } from '../../nucleo/mcp/herramienta.js';
import { actaMercadoParaHermes, ConsultaActaMercado, GuardarActaMercado, guardarActaMercado } from './actasMercado.js';
import { dbLicitaciones } from './db.js';
import { RespuestaPliego, responderPregunta } from './preguntasPliego.js';

export function herramientasActasMercado(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_acta_mercado',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaActaMercado,
    descripcion:
      'El acta (o informe de valoración o resolución) de una licitación ajena que pidió leer la tarea licitaciones.leer_acta_mercado: título, órgano, los lotes con su adjudicatario y nº de ofertas, y el texto del documento por trozos de 40.000 caracteres (sigue con «desde» = siguiente_desde). Solo lee.',
    recurso: (a) => a.id,
    ejecutar: async (a) => actaMercadoParaHermes(dbLicitaciones(), a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_acta_mercado_guardar',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: GuardarActaMercado,
    descripcion:
      'Devuelve quién se presentó a una licitación ajena según su acta (solo en la tarea licitaciones.leer_acta_mercado): en «licitadores», uno por empresa y lote con nif, nombre, lote, rol (licitadora, excluida o adjudicataria), importe_ofertado sin IVA, puntos_tecnicos, puntos_economicos y motivo_exclusion si constan; o sin_datos=true si el documento no lo dice. Un NIF que no está en el texto, con el control mal o de un lote que no existe se rechaza con su motivo.',
    recurso: (a) => a.id,
    ejecutar: async (a) => guardarActaMercado(dbLicitaciones(), a),
  });
}

// La respuesta a «Preguntar al pliego». Vive aquí por ser otra herramienta de una sola tarea.
export function herramientaPreguntaPliego(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_pliego_responder',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: RespuestaPliego,
    descripcion:
      'Responde a una pregunta de una persona sobre los pliegos (solo en la tarea licitaciones.preguntar_pliego): dice=true con una respuesta de una o dos frases y la «cita» literal del pliego con su «documento» (ruta); dice=false si los pliegos no lo dicen. La plataforma busca la cita literal en los pliegos: sin encontrarla, la respuesta se enseña como «no comprobada».',
    recurso: (a) => a.id,
    ejecutar: async (a, ag) => responderPregunta(dbLicitaciones(), a, ag.nombre),
  });
}
