// Tools MCP de la oferta: leer guion, decisiones y estado de la memoria, y enviar guion y apartados.
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Agente } from '../../../nucleo/agentes/registro.js';
import { puede } from '../../../nucleo/agentes/permisos.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { registrarHerramienta, RESPUESTA_DETALLE, RESPUESTA_LECTURA } from '../../../nucleo/mcp/herramienta.js';
import { ok } from '../../../nucleo/result.js';
import { dbLicitaciones } from '../db.js';
import { GuionEntrada, proponerGuion } from './guion.js';
import { ApartadoEntrada, recibirApartado, recursoApartado, rondaDeMemoria } from './memoria.js';
import { herramientaAnexo } from './anexosRutas.js';
import { conDeucParaAgente } from './deuc.js';
import { herramientasComprobaciones } from './toolsComprobaciones.js';
import { herramientasAsistente } from './asistenteTools.js';
import { herramientasRevision } from './toolsRevision.js';
import { herramientasMesa } from './toolsMesa.js';
import { herramientasDocumentos } from './toolsDocumentos.js';
import { herramientasCompromisos, registrarCostesDelCritico } from './toolsCompromisos.js';
import { CLAVES_DOSSIER, leerDossier } from './dossier.js';
import { EstrategiaEntrada, recibirEstrategia, recursoEstrategia } from './estrategia.js';
import { CriticaEntrada, recibirCritica, recursoCritica, RESPUESTA_PAQUETE, TOOL_PARES } from './critica.js';
import { CriticaParesEntrada, paqueteCritica, PARTES_CRITICA, recibirCriticaPares } from './criticaPares.js';
import { HechosEntrada, recibirHechos, recursoHechos } from './parcheHechos.js';
import { guardarJuicio, JuicioEntrada, paqueteJuicio, PARTES_JUICIO, recursoJuicio } from './evalMemorias.js';
import { PropuestaDecisionesEntrada, proponerDecisiones } from './propuestaDecisiones.js';
import { ConsultaOferta, ofertaParaAgente, taparPersonas } from './ofertaAgente.js';
import { LeccionesEntrada, proponerLecciones } from './lecciones.js';
import { ConsultaLibro, libroParaAgente } from './leccionesAplicadas.js';
import { paqueteParaAgente } from './paquete.js';
import { raicesActuales } from '../../../nucleo/salidas.js';

// Leer el guion, las decisiones y el estado de la memoria: cualquier agente con token (los nombres del equipo
// solo si además puede leer colaboradores). Enviar el guion y los apartados de la memoria: solo con «proponer»
// en licitaciones.
const ConsultaDossier = z.object({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  memoria_id: z.number().int().positive().describe('La memoria de la tarea'),
  seccion: z.enum(CLAVES_DOSSIER).optional().describe('Sin ella, el índice; con ella, su texto'),
  desde: z.number().int().min(0).optional().describe('Carácter desde el que seguir leyendo una sección larga'),
});

const ConsultaPaquete = z.object({
  id: z.string().trim().min(3).max(40).describe('Id de la licitación'),
  memoria_id: z.number().int().positive().describe('La memoria de la tarea'),
  parte: z
    .enum(PARTES_CRITICA)
    .describe(
      'rubrica, pliego, documento (la memoria ensamblada con las comprobaciones automáticas), memoria (solo el texto de los apartados) o, desde la ronda 1, documento_1 y documento_2 (las dos versiones que se comparan)',
    ),
  desde: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Carácter desde el que seguir (el «siguiente» de la respuesta anterior)'),
});

const ConsultaJuicio = z.object({
  caso: z.string().trim().min(2).max(60),
  doc_1: z.number().int().positive(),
  doc_2: z.number().int().positive(),
  lote: z.string().trim().min(1).max(80),
  parte: z.enum(PARTES_JUICIO).describe('rubrica, pliego, documento_1 o documento_2'),
  desde: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Carácter desde el que seguir (el «siguiente» de la respuesta anterior)'),
});

// Al cargar las tools de la oferta (al arrancar el MCP): el crítico y la crítica por pares solo se
// piden por ellas, así que ya llevan los añadidos caros. Una vez y no en cada sesión MCP: quien
// registre otro proveedor después (un test) no se ve pisado.
registrarCostesDelCritico();

export function herramientasOferta(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_oferta',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaOferta,
    descripcion:
      'La oferta de una licitación, por secciones y con lo accionable primero. «estado»: descartada o retirada con su motivo, veredicto (el mismo que la web), vence_en (ISO con zona) y vence_texto (hora peninsular y de Canarias), hora_interna_cierre, «siguiente» (el primer bloqueo abierto), precio fijado por lote (nunca el importe), memoria aprobada, paquete vigente y si la propuesta, las decisiones o la memoria son de otro guion; léelo antes de trabajar. «bloqueos»: lo que impide o arriesga presentar, con la misma clave, categoría, lote, gravedad, cita, actor y acción que la web (lo que no casa entre lotes, ficha, pliegos, guion y decisiones viene aquí, con la categoría «coherencia»). «guion»: el guion vigente (archivos con sus documentos y prohibiciones, memoria con límite de páginas, formato y apartados con «se valorará», escala y advertencias, criterios automáticos con sus marcas, oferta económica y plazo). «decisiones»: lotes, criterios automáticos a los que nos acogemos, herramientas, enfoque y equipo (cada persona una vez en «personas», solo con permiso sobre colaboradores, y «roles» con persona_id). «propuesta»: la última propuesta de decisiones de Hermes. «memoria»: la memoria de la oferta por apartados (la presentada si se subió, con «presentada»: true; si no, la última) y, aparte, «memoria_ensayo» (pedida con el plazo vencido para medirla, no presentada). «memoria_historial»: todas las versiones con su revisión, evaluación y fugas. Sin «secciones», todas salvo memoria_historial. Con «apartado» (por defecto estado, bloqueos y apartado), su rúbrica, su cuota de caracteres y los criterios automáticos que no puede mencionar como índices de guion.automaticos; si el pliego no pide memoria, lo dice. Con «estado», si la plataforma preparó el DEUC en XML, «deuc»: su versión y las preguntas que quedan por responder en el servicio DEUC (motivos de exclusión; el DEUC lo prepara el código, no Hermes). En una memoria, «progreso.situacion» dice en qué está; con «ficha de solución pendiente de revisión», la redacción espera a que una persona acepte o edite en la web los parámetros de diseño de la estrategia («progreso.ficha»), hasta 24 h: no la pidas ni la redactes por tu cuenta.',
    recurso: (a) => a.id,
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: async (a, ag) =>
      conDeucParaAgente(
        dbLicitaciones(),
        ofertaParaAgente(dbLicitaciones(), nucleo().db, a, puede(ag.permisos, 'colaboradores', 'leer')),
      ),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_guion',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: GuionEntrada,
    descripcion:
      'Envía el guion de la oferta leído del pliego, todo literal y con documento y página: archivos electrónicos (nombre, contenido, prohibiciones, firma, documentos con tipo, obligatorio, quién lo produce y modelo), memoria (archivo, título, si se puntúa, límite de páginas, formato, apartados con título literal, puntos, «se valorará» y escala, advertencias), criterios automáticos (puntos, cómo se acredita, casilla, archivo y marcas), oferta económica (fórmula, presupuesto base, impuesto aparte, umbral de anormalidad, modelo y archivo) y plazo. Se comprueba contra la ficha aprobada (un apartado por criterio de juicio de valor, con sus puntos; sin ninguno, la memoria que exija el pliego va como no valorable, sin puntos) y el pliego (límite de páginas); cada envío es una versión nueva.',
    recurso: (a) => a.id,
    ejecutar: (a, ag) => proponerGuion(dbLicitaciones(), a, ag.nombre, { revisar: true }),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_memoria_apartado',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: ApartadoEntrada,
    descripcion:
      'Envía un apartado de la memoria técnica (solo en la tarea de redacción de la memoria entera, uno por envío y en cuanto lo termines), con los números de la tarea (memoria_id, guion_id, version, apartado): título literal del guion, bloques (subtítulo, párrafos, lista, tabla o figura SVG), «cubre» (cada punto de «se valorará» con el bloque y párrafo que lo trata), compromisos (qué, quién, cuándo o con qué medida) y, si quieres, fuentes. Se rechaza con la frase exacta si falta un punto de «se valorará», hay marcas sin terminar o citas internas del pliego, se pasa de la cuota o, si la memoria puntúa, no llega al 70 % de ella, o matiza de más («si procede», «en su caso», «no incluye»…); siempre (fuga entre sobres, causa de exclusión), si menciona importes o bajas de la oferta, criterios automáticos de otro archivo o lo ofrecido en ellos (lo que solo se parece a lo que se declara en ellos se rechaza dos veces y luego entra con aviso), y si una figura no se puede dibujar o trae scripts o recursos externos. La plataforma monta el documento cuando llegan todos.',
    recurso: (a) => recursoApartado(a, rondaDeMemoria(dbLicitaciones(), a.memoria_id)),
    ejecutar: async (a, ag) => recibirApartado(dbLicitaciones(), a, ag.nombre, { revisar: true }),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_decisiones',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: PropuestaDecisionesEntrada,
    descripcion:
      'Envía la propuesta de decisiones de la oferta (solo en tareas «propón las decisiones»), con el guion_id vigente: lotes, equipo (persona, rol en la oferta, dedicación y motivo), un criterio automático por cada uno del guion y lote (tipo compromiso o acreditacion, nos_acogemos, tramo, capacidad, evidencia y motivo: el tramo más alto con capacidad demostrada; lo que exige un documento que no está en la Biblioteca va a 0 y el motivo lo nombra), herramientas, enfoque en positivo y sin citas del pliego, y resumen. Sin precio. Es una propuesta: una persona la revisa y la guarda.',
    recurso: (a) => a.id,
    ejecutar: async (a, ag) => proponerDecisiones(dbLicitaciones(), nucleo().db, a, ag.nombre, { revisar: true }),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_lecciones',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: LeccionesEntrada,
    descripcion:
      'Envía las lecciones de una versión de la memoria retocada a mano (solo en tareas «aprende de la memoria vN»), con el memoria_id de la tarea: de 1 a 12, cada una con texto (qué hacer, concreto), alcance (general, licitacion, organo, tipo_contrato o cpv: el valor lo pone la plataforma), tema opcional, apartado (o null) y evidencia literal del cambio. Sin nombres de personas: se escribe el rol. Reenviar sustituye las pendientes. Una persona las acepta o las descarta.',
    recurso: (a) => `${a.id}#m${a.memoria_id}`,
    ejecutar: async (a, ag) => proponerLecciones(dbLicitaciones(), a, ag.nombre, taparPersonas(nucleo().db)),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_libro_lecciones',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaLibro,
    descripcion:
      'El libro de lecciones aceptadas de nuestras ofertas (de la edición de la memoria, del acta de la mesa, de la decisión de ir y del precio), las de más fuerza (ofertas distintas que las apoyan) primero. Con id, solo las que valen para esa licitación por su alcance (general, licitación, órgano, tipo de contrato o CPV). Cada una con su evidencia (el documento y el trozo, sin nombres si no puedes leer colaboradores) y dónde se aplicó (licitación, versión de la memoria, apartado y si el crítico la vio cumplida). Solo lee.',
    recurso: (a) => a.id ?? null,
    ejecutar: async (a, ag) =>
      ok({
        lecciones: libroParaAgente(
          dbLicitaciones(),
          a,
          puede(ag.permisos, 'colaboradores', 'leer') ? null : taparPersonas(nucleo().db),
        ),
      }),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_paquete',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaOferta.pick({ id: true }),
    descripcion:
      'El paquete de presentación vigente de una licitación (lo genera una persona en la web; esta tool no genera nada): el veredicto de las comprobaciones (veredicto: tipo y texto) y el recuento de «bloquea» y «aviso» por lote (por_lote, con «comun» para lo que no es de un lote), así que no hace falta pedir las comprobaciones aparte; carpetas por lote y sobre con sus archivos numerados en el orden de subida, firma pendiente de cada uno, las comprobaciones de ahora (plazo, coherencia, obligatorios, memoria, precios, fugas, marcas sin cerrar, huecos, otro lote, PDF; «bloquea» o «aviso») y el texto de INSTRUCCIONES.md. Sin importes: los valores económicos remiten a VALORES_A_TECLEAR.md.',
    recurso: (a) => a.id,
    respuestaLarga: RESPUESTA_DETALLE,
    ejecutar: async (a) => paqueteParaAgente(dbLicitaciones(), raicesActuales(), a.id),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_dossier',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaDossier,
    descripcion: `El dossier de una memoria técnica (solo en tareas de estrategia o redacción de la memoria entera): lo que la plataforma reúne para escribirla. Sin «seccion», el índice (${CLAVES_DOSSIER.join(', ')}) con su tamaño y si va recortada; con «seccion» (y «desde» para seguir), su texto por trozos. Una sección recortada dice dónde sigue (biblioteca_leer con ruta y páginas). El equipo, solo con permiso sobre colaboradores.`,
    recurso: (a) => `${a.id}#m${a.memoria_id}`,
    respuestaLarga: RESPUESTA_LECTURA,
    ejecutar: async (a, ag) => leerDossier(dbLicitaciones(), a, puede(ag.permisos, 'colaboradores', 'leer')),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_memoria_estrategia',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: EstrategiaEntrada,
    descripcion:
      'Envía la estrategia de una memoria técnica (solo en tareas «piensa la estrategia de la memoria»), con los números de la tarea (memoria_id, version): temas ganadores (3-6), audiencia, estructura (un elemento por apartado del guion, en orden, con su título literal, extensión objetivo en caracteres y secciones), mapa (cada «se valorará» → sección → evidencia), hoja de hechos (clave única, categoría, sobre qué, valor exacto y palabras ancla), frontera, reglas y solución (los parámetros de diseño ya decididos: calendario con fechas, arquitectura por capa, modelos, umbrales, banco de pruebas, formación y soporte, riesgos con dueño, siglas y dedicación de los roles, un caso por apartado, como mucho 5 pendientes que el pliego reserva al órgano, con su cita, y el catálogo normativo: las reglas del cliente con su norma, apartado y cita del dossier, si el dossier trae normativa). Se rechaza con la frase exacta si un título no es literal, falta un «se valorará» en el mapa, las extensiones no caben en el límite, un pendiente o una regla del catálogo no trae su cita, falta el catálogo habiendo normativa o un modelo fija una versión de más de 12 meses antes del inicio; siempre, si un hecho o la solución delatan un criterio automático o, con el equipo por roles, un hecho nombra a una persona.',
    recurso: (a) => recursoEstrategia(a),
    ejecutar: async (a, ag) => recibirEstrategia(dbLicitaciones(), nucleo().db, a, ag.nombre, { revisar: true }),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_memoria_hechos',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: HechosEntrada,
    descripcion:
      'Envía la corrección de la hoja de hechos de una memoria técnica en una ronda (solo en tareas «corrige la hoja de hechos»), con id, memoria_id y ronda de la tarea: por cada hecho que pide la tarea (los que cita el crítico), su clave, el valor nuevo (o el mismo, si se mantiene) y el motivo. Solo esos hechos; lo cambiado pasa a la hoja que copian los apartados y queda en los avisos de la memoria para que una persona lo revise. Se rechaza siempre un hecho que no se pidió, uno pedido sin respuesta, una fuga a otro archivo o un nombre con el equipo por roles; hasta el tercer envío, un valor que aplaza («a acordar», «pendiente de», «T0»).',
    recurso: (a) => recursoHechos(a),
    ejecutar: async (a, ag) => recibirHechos(dbLicitaciones(), a, ag.nombre, { revisar: true }),
  });
  herramientasCritica(server, agente);
  herramientasJuez(server, agente);
  herramientaAnexo(server, agente);
  herramientasComprobaciones(server, agente);
  herramientasAsistente(server, agente);
  herramientasRevision(server, agente);
  herramientasMesa(server, agente);
  herramientasDocumentos(server, agente);
  herramientasCompromisos(server, agente);
}

// El juez ciego del banco de pruebas de memorias (evalMemorias.ts).
function herramientasJuez(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_eval_paquete',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaJuicio,
    descripcion:
      'El paquete de un juicio por pares del banco de pruebas de memorias (solo en tareas «compara dos memorias»): la rúbrica, lo que el juez necesita del pliego y los dos documentos (sin decir de quién son), por trozos («desde»).',
    recurso: (a) => recursoJuicio(a),
    respuestaLarga: RESPUESTA_PAQUETE,
    ejecutar: async (a) => paqueteJuicio(dbLicitaciones(), a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_eval_juicio',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: JuicioEntrada,
    descripcion:
      'Envía el juicio por pares de dos memorias (solo en tareas «compara dos memorias»), con caso, doc_1, doc_2 y lote de la tarea: por criterio de la rúbrica el preferido (1, 2 o empate), el margen, los puntos de cada uno, la razón y la cita literal del preferido; los totales, el máximo, el preferido global y lo que marca la diferencia. Se rechaza siempre si faltan criterios, los puntos pasan del máximo o los totales no suman; hasta el tercer envío, una cita que no está tal cual.',
    recurso: (a) => recursoJuicio(a),
    ejecutar: async (a, ag) => guardarJuicio(dbLicitaciones(), a, ag.nombre, { revisar: true }),
  });
}

// El crítico ciego: solo ve el paquete (rúbrica, pliego y memoria) y envía su crítica.
function herramientasCritica(server: McpServer, agente: Agente): void {
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_memoria_critica_paquete',
    dominio: 'licitaciones',
    accion: 'leer',
    entrada: ConsultaPaquete,
    descripcion:
      'El paquete ciego para criticar una memoria técnica (solo en tareas «puntúa la memoria» o «compara dos versiones»): la rúbrica (apartados con «se valorará», puntos, escala y advertencias), el pliego (identificación, pliego técnico, criterios literales y formato), el documento (la memoria ensamblada como la verá la mesa: portada, índice, guía, numeración y contenido de las figuras, precedida de las comprobaciones automáticas: numeración duplicada, frases repetidas e identificadores de caso repetidos), la memoria (solo el texto de los apartados) y, desde la ronda 1, documento_1 y documento_2 (las dos versiones que se comparan, igual de ensambladas, sin decir cuál es la nueva), cada parte por trozos («desde»). Nunca da decisiones, estrategia, equipo ni evaluaciones anteriores.',
    recurso: (a) => `${a.id}#m${a.memoria_id}#paquete`,
    respuestaLarga: RESPUESTA_PAQUETE,
    ejecutar: async (a) => paqueteCritica(dbLicitaciones(), a),
  });
  registrarHerramienta(server, agente, {
    nombre: 'licitaciones_memoria_critica',
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: CriticaEntrada,
    descripcion:
      'Envía la crítica ciega de una memoria técnica (solo en tareas «puntúa la memoria», ronda 0; desde la ronda 1 la crítica es por pares), con id, memoria_id y ronda de la tarea: por apartado el tramo de su escala, los puntos (como mucho los del tramo), la cita literal que lo justifica, los motivos para bajar (cita, motivo y arreglo) y lo que falta; y un resumen. Se rechaza siempre un tramo fuera de la escala, un apartado que falta, un tramo por debajo del máximo sin ningún motivo para bajar o un resumen que dice «máximo» con algún apartado por debajo; hasta el tercer envío, una cita que no está tal cual en la memoria, un tramo máximo con motivos para bajar o un motivo por aplazamiento cuyo arreglo no da el valor (al tercero, sin cita se guarda un tramo por debajo).',
    recurso: (a) => recursoCritica(a),
    ejecutar: async (a, ag) => recibirCritica(dbLicitaciones(), a, ag.nombre, { revisar: true }),
  });
  registrarHerramienta(server, agente, {
    nombre: TOOL_PARES,
    dominio: 'licitaciones',
    accion: 'proponer',
    entrada: CriticaParesEntrada,
    descripcion:
      'Envía la crítica por pares de una memoria técnica en una ronda de reescritura (solo en tareas «compara dos versiones», ronda 1 o más), con id, memoria_id y ronda de la tarea: por apartado el documento preferido («1», «2» o «empate»), la evaluación de cada documento (tramo de su escala, cita literal, motivos para bajar con cita, motivo y arreglo, y lo que falta; documento_2 solo si difieren) y, sin empate, la diferencia; y un resumen. La plataforma conserva por apartado la versión preferida. Se rechaza siempre un apartado que falta, un tramo fuera de la escala, un tramo por debajo del máximo sin motivos, un apartado idéntico sin empate, uno distinto sin documento_2, un preferido con menos tramo que el otro o sin diferencia; hasta el tercer envío, una cita que no está tal cual en su documento (al tercero, se guarda un tramo por debajo).',
    recurso: (a) => recursoCritica(a),
    ejecutar: async (a, ag) => recibirCriticaPares(dbLicitaciones(), a, ag.nombre, { revisar: true }),
  });
}
