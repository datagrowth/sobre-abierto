// Tools MCP de propuestas: leer el registro y sus estadísticas, y enviar evaluaciones y lo aprendido de un acta.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { registrarHerramienta, RESPUESTA_DETALLE } from '../../../nucleo/mcp/herramienta.js';
import { ok, type Result } from '../../../nucleo/result.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { dbLicitaciones } from '../db.js';
import { taparPersonas } from '../oferta/ofertaAgente.js';
import { estadisticasPropuestas } from './estadisticas.js';
import { EvaluacionEntrada, guardarEvaluacion } from './evaluacion.js';
import { propuestaDeLicitacion, propuestaParaAgente, raicesDocumentos } from './index.js';
import { listarPropuestas, RESULTADOS_PROPUESTA } from './registro.js';
import { AprendizajeEntrada, HERRAMIENTA_APRENDIZAJE, proponerAprendizaje } from './aprendizaje.js';

// Leer el registro y sus estadísticas: cualquier agente con token. Enviar una evaluación o lo aprendido de un
// acta: solo con «proponer» en licitaciones (Hermes y su perfil «licitaciones»). Registrar presentaciones y
// resultados es de personas.
const ConsultaPropuestas = z.object({
  id: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .optional()
    .describe(
      'Una licitación: sus propuestas, borradores, evaluaciones y las propuestas anteriores parecidas (ganadas primero). Sin id: el histórico y las estadísticas',
    ),
  resultado: z.enum(RESULTADOS_PROPUESTA).optional().describe('Solo sin id: filtra el histórico'),
  limite: z.number().int().min(1).max(100).default(20),
});

function consultar(a: z.infer<typeof ConsultaPropuestas>): Result<unknown> {
  const db = dbLicitaciones();
  if (a.id) {
    const p = propuestaDeLicitacion(db, raicesDocumentos(), a.id, a.limite);
    return p.error ? p : ok(propuestaParaAgente(p.data));
  }
  return ok({
    historico: listarPropuestas(db, { resultado: a.resultado, limite: a.limite }),
    estadisticas: estadisticasPropuestas(db),
  });
}

export function herramientasPropuestas(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_propuestas',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaPropuestas,
    descripcion:
      'Registro de propuestas presentadas por la empresa. Con id (una licitación), en este orden: «parecidas», las propuestas anteriores parecidas por órgano, CPV, tipo y presupuesto, las ganadas primero y las débiles («debil»: true, solo por el tipo de contrato o con poco parecido) al final, que no son precedente; de cada una, cuántos documentos tiene («documentos_n») y su «carpeta» (con su raíz, «Conocimiento/…»: léela con biblioteca_buscar y biblioteca_leer); «aprendizajes», lo aprendido de las actas de mesa (aceptado por una persona) del mismo órgano o CPV, con los puntos por criterio, el comentario literal de la mesa y las lecciones; lo presentado (lote, fecha, importe y baja ofertada, documentos, resultado, puntuaciones técnica/económica/total, posición, puntos del ganador, ganador según la PLACSP, notas y lecciones), sus borradores y memorias (las ensambladas solo con versión, estado, guion_id, rutas y fugas: lo demás está en licitaciones_oferta) y sus evaluaciones en resumen (sin las descartadas por una persona; cada una con su estado, documento, puntos totales y por apartado, número de genéricos y el arranque de su resumen). Sin id: el histórico y las estadísticas (tasa de éxito por sector, órgano y banda de importe; nuestra baja frente a la ganadora; puntuaciones medias). Toda ruta lleva su raíz («Conocimiento/…» o «Salidas/…»).',
    recurso: (a) => a.id ?? null,
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: async (a) => consultar(a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_evaluacion',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: EvaluacionEntrada,
    descripcion:
      'Envía la evaluación de un documento de propuesta («Salidas/…» o «Conocimiento/…»): resumen, puntuación estimada por criterio de la ficha aprobada (peso, tipo, puntuación ≤ peso, justificación y referencia), puntuacion_total (= suma) y puntuacion_maxima (= suma de pesos), qué eliminar, modificar y reforzar con referencia a sección o página, comparables usados y riesgos. Los criterios y sus pesos deben ser los de la ficha aprobada; si la licitación tiene guion con memoria (o el documento es una memoria ensamblada), uno por apartado del guion con «apartado», su título literal, sus puntos y el «tramo» de su escala que le daría la mesa, más los «genericos» (párrafos sin quién, cuándo ni medida, literales). Se guarda pendiente: una persona la acepta o la descarta en la web; el documento no se toca.',
    recurso: (a) => a.id,
    ejecutar: async (a, ag) => guardarEvaluacion(dbLicitaciones(), raicesDocumentos(), a, ag.nombre),
  });
  registrarHerramienta(server, agente, {
    nombre: HERRAMIENTA_APRENDIZAJE,
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: AprendizajeEntrada,
    descripcion:
      'Envía lo aprendido de un acta de mesa (solo en tareas de aprender de un acta), con la carpeta y el documento de la tarea: resultado, ganador, puntos nuestros y del ganador, criterios (criterio, puntos_max, nuestros, ganador, comentario_mesa literal del documento y pagina) y hasta 10 lecciones concretas, sin nombres de personas. Se rechaza si unos puntos superan el máximo, un comentario no está literal en el documento o una lección nombra a alguien del equipo. Las lecciones entran en el libro de lecciones (Aprendizaje). Queda pendiente: una persona lo acepta o lo descarta en la web.',
    recurso: (a) => a.carpeta,
    ejecutar: (a, ag) =>
      proponerAprendizaje(dbLicitaciones(), raicesDocumentos(), a, {
        agente: ag.nombre,
        revisar: true,
        tapar: taparPersonas(nucleo().db),
      }),
  });
}
