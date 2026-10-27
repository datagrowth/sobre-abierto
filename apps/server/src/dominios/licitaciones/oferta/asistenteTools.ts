// Herramientas MCP del asistente de la oferta: leer el hilo y devolver la interpretación de un texto libre.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { puede } from '../../../nucleo/agentes/permisos.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { registrarHerramienta } from '../../../nucleo/mcp/herramienta.js';
import { ok } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import { hiloDe, type MensajeHilo } from './asistenteHilo.js';
import { InterpretacionEntrada, interpretarRespuesta } from './asistenteInterpretar.js';
import { taparPersonas } from './ofertaAgente.js';

// El hilo se lee sin importes, y sin nombres para quien no puede ver colaboradores. La interpretación queda por
// confirmar en la web.
const ConsultaHilo = z.object({ id: z.string().trim().min(3).max(40).describe('Id de la licitación') });

// El precio es de la persona: ni el importe ni la frase que lo lleva salen a un agente.
const DE_PRECIO = (m: MensajeHilo) => m.pregunta?.startsWith('precio:') || m.datos.accion?.tipo === 'precio';

/** El hilo para un agente: sin importes y, sin permiso de colaboradores, sin nombres. */
export function hiloParaAgente(hilo: MensajeHilo[], tapar: ((t: string) => string) | null): unknown[] {
  return hilo.map((m) => {
    if (DE_PRECIO(m))
      return {
        id: m.id,
        pregunta: m.pregunta,
        autor: m.autor,
        tipo: m.tipo,
        texto: 'Precio decidido por una persona (el importe no se comparte).',
        estado: m.estado,
        creado_en: m.creado_en,
      };
    const texto = tapar ? tapar(m.texto) : m.texto;
    const { accion: _accion, ...datos } = m.datos;
    return { ...m, texto, datos: tapar ? { ...datos, accion: m.datos.accion?.tipo ?? null } : m.datos };
  });
}

export function herramientasAsistente(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_oferta_hilo',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaHilo,
    descripcion:
      'El hilo del asistente de la oferta de una licitación: lo que respondió la persona a cada pregunta (lotes, equipo por rol, criterios automáticos, datos del anexo, enfoque), lo que guardó la plataforma, los textos libres y lo que interpretó Hermes (por confirmar, confirmado o rechazado). Del precio solo dice que está decidido: el importe no se comparte. Solo lee.',
    recurso: (a) => a.id,
    ejecutar: async (a, ag) => {
      const tapar = puede(ag.permisos, 'colaboradores', 'leer') ? null : taparPersonas(nucleo().db);
      return ok({ id: a.id, mensajes: hiloParaAgente(hiloDe(dbLicitaciones(), a.id), tapar) });
    },
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_oferta_interpretar',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: InterpretacionEntrada,
    descripcion:
      'Devuelve lo que entiendes de un texto libre del asistente de la oferta (lo pide la tarea licitaciones.interpretar_respuesta): con entendido=true, la «opcion» que corresponde o, si no es ninguna, la decisión en «accion» con la forma que dice la tarea; con entendido=false, la «repregunta» con lo que hay que aclarar. No guarda nada: una persona lo confirma en la web.',
    recurso: (a) => a.id,
    ejecutar: (a, ag) => interpretarRespuesta(dbLicitaciones(), nucleo().db, a, ag.nombre),
  });
}
