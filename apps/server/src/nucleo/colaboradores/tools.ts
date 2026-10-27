// Tools MCP de colaboradores: buscar candidatos y ver fichas (lectura) y proponer un perfil leído de un CV.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../agentes/registro.js';
import { registrarHerramienta, RESPUESTA_DETALLE } from '../mcp/herramienta.js';
import { nucleo } from '../contexto.js';
import { ok } from '../result.js';
import { buscarCandidatos, ConsultaCandidatos } from './busqueda.js';
import { TIPOS_PERSONA } from './personas.js';
import { fichaDeEquipo, personasDeEquipo } from './fichaEquipo.js';
import { PerfilEntrada, proponerPerfil } from './propuestas.js';

// Leer (buscar candidatos y ver fichas): cualquier agente con token. Proponer un perfil leído de un CV: Hermes y
// el perfil «licitaciones». Son datos personales: la auditoría solo guarda ids, nunca nombres, textos ni rutas
// de CV.
const Ver = z.object({
  id: z.number().int().positive().optional().describe('Id del colaborador; sin id, la lista resumida'),
  tipo: z.enum(TIPOS_PERSONA).optional().describe('En la lista: solo internos o solo externos'),
});

function ver(a: z.infer<typeof Ver>) {
  if (a.id !== undefined) return fichaDeEquipo(nucleo().db, a.id);
  const personas = personasDeEquipo(nucleo().db, { inactivos: false, ...(a.tipo ? { tipo: a.tipo } : {}) });
  return ok(
    personas.map(({ id, nombre, tipo, rol, disponibilidad, anios_experiencia }) => ({
      id,
      nombre,
      tipo,
      rol,
      disponibilidad: disponibilidad.estado,
      anios_experiencia,
    })),
  );
}

export function herramientasColaboradores(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'colaboradores_buscar',
    dominio: 'colaboradores',
    accion: 'leer',
    entrada: ConsultaCandidatos,
    descripcion:
      'Personas del equipo (internas) y externas que encajan con uno o varios requisitos de medios personales (texto libre, p. ej. «Jefe de proyecto con titulación universitaria en informática, 5 años de experiencia, PMP e inglés B2»). Por requisito: lo que el código entendió (años mínimos, titulación, certificaciones, idiomas) e internos y externos por separado con puntuación 0–100, si cumplen los mínimos, cada regla (cumple, parcial, no_cumple, desconocido) con su detalle y la afinidad (tecnologías y rol citados, CPV, CV parecido en la Biblioteca). Sin IA: orientativo.',
    // Hasta 15 requisitos con sus candidatos y reglas: con 20.000 caracteres llegaba cortado
    // y Hermes no podía comprobar cuántos cumplían, así que no enviaba la ficha.
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: (a) => buscarCandidatos(nucleo().db, a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'colaboradores_ver',
    dominio: 'colaboradores',
    accion: 'leer',
    entrada: Ver,
    descripcion:
      'Ficha de un colaborador por id (tipo, rol, titulaciones, certificaciones, años de experiencia, sectores, CPV, tecnologías, idiomas, horas de docencia por materia con su evidencia, disponibilidad calculada con su motivo, ofertas en las que está, tarifa, ruta del CV en la Biblioteca y notas) o, sin id, la lista resumida de los activos.',
    recurso: (a) => (a.id !== undefined ? `persona-${a.id}` : null),
    ejecutar: async (a) => ver(a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'colaboradores_proponer_perfil',
    dominio: 'colaboradores',
    accion: 'proponer',
    entrada: PerfilEntrada,
    descripcion:
      'Envía el perfil de un colaborador leído de su CV (en Colaboradores/ de la Biblioteca): nombre, tipo, rol, titulaciones, certificaciones, años de experiencia, sectores, CPV, tecnologías, idiomas con nivel, horas de docencia por materia con su periodo y la página del CV, y perfil de LinkedIn si el CV lo trae. Sin otros datos de contacto ni DNI. Queda pendiente hasta que una persona lo apruebe en la web; si ya había uno pendiente de ese CV, lo sustituye.',
    // Ni la ruta del CV ni el nombre: suelen identificar a la persona.
    recurso: (a) => (a.persona_id !== undefined ? `persona-${a.persona_id}` : null),
    ejecutar: async (a, ag) => proponerPerfil(nucleo().db, a, ag.nombre),
  });
}
