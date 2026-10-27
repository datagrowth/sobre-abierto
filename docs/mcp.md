# Servidor MCP

<!-- Generado con «npm run docs:mcp -w @sobre-abierto/server». No lo edites a mano: un test falla si no coincide con el código. -->

La plataforma expone sus herramientas a los agentes (Hermes, sus perfiles y, si lo configuras, Claude Code u otro
cliente MCP) por el endpoint `/mcp`, con transporte HTTP. Hay 64 herramientas. Cada agente se autentica con su
propio token `Bearer` y ve solo las que su permiso permite; cada llamada queda en la auditoría.

## Permisos

Hay dos acciones: `leer` y `proponer` (incluye leer). Ningún agente escribe hechos ni aprueba: lo que propone lo
revisa una persona o lo valida el código.

| Agente | biblioteca | licitaciones | plataforma | colaboradores |
|---|---|---|---|---|
| `hermes` | proponer | proponer | proponer | — |
| `claude-code` | proponer | leer | proponer | leer |
| `licitaciones` | proponer | proponer | proponer | proponer |
| `oferta-licitaciones` | proponer | proponer | proponer | proponer |
| `critico-licitaciones` | — | proponer | — | — |
| cualquier otro agente con token | proponer | leer | leer | — |

- `hermes` es el perfil general; `licitaciones`, `oferta-licitaciones` y `critico-licitaciones` son los perfiles
  que crea `install.sh`. El crítico solo ve Licitaciones: no lee la Biblioteca ni los CV.
- Un archivo `permisos.json` junto a los tokens (`/opt/data/.agentes`) ajusta los permisos por agente y dominio con
  `leer`, `proponer` o `ninguno`. Un dominio que no existe se ignora, y un archivo mal formado se descarta entero.
- Las tools con dos permisos (por ejemplo, `licitaciones_equipo` también necesita `colaboradores:leer`) no se
  registran si falta alguno.
- `plataforma_estado` dice a quien lo llama qué herramientas tiene y cuáles le faltan, con el permiso que las daría.

## Conectar un agente

1. Crea un token de al menos 24 caracteres y guárdalo en `AGENTE_TOKEN_<NOMBRE>` (el nombre en mayúsculas, con `_`
   en lugar de `-`) en el `.env` del monitor, o como archivo `<nombre>.token` en `/opt/data/.agentes`.
2. En el cliente, apunta al endpoint `https://<tu-dominio>/mcp` con la cabecera `Authorization: Bearer <token>`.
3. Pide `plataforma_estado` para comprobar qué herramientas ve.

Las respuestas muy largas se recortan y dicen cómo seguir (`como_seguir`). Los parámetros con `*` son obligatorios.

## Biblioteca de Conocimiento

| Tool | Permiso | Qué hace | Parámetros |
|---|---|---|---|
| `biblioteca_buscar` | biblioteca:leer | Busca en la Biblioteca de Conocimiento (notas y documentos de Drive) por palabras y por significado. | `consulta`*, `carpeta`, `limite` |
| `biblioteca_documentos_sin_nota` | biblioteca:leer | Documentos de la Biblioteca que aún no tienen nota ni propuesta pendiente, del más nuevo al más antiguo. | `limite` |
| `biblioteca_leer` | biblioteca:leer | Lee una nota o un documento de la Biblioteca por partes, con marcas [pág. N]. | `ruta`*, `desde`, `max`, `pagina_desde`, `pagina_hasta`, `sin_membretes`, `desde_caracter` |
| `biblioteca_proponer` | biblioteca:proponer | Propone una nota nueva para la Biblioteca. | `titulo`*, `contenido`*, `fuente`, `carpeta`, `motivo` |
| `salidas_leer` | biblioteca:leer | Lee un documento de la carpeta Salidas de Drive (borradores, propuestas, entregables: Markdown, PDF, Word, OpenDocument, PowerPoint o Excel) por partes, con marcas [pág. N] si tiene páginas. | `ruta`*, `desde`, `max`, `pagina_desde`, `pagina_hasta`, `seccion` |
| `salidas_listar` | biblioteca:leer | Lista los documentos de una carpeta de Salidas y sus subcarpetas (4 niveles por defecto), con su ruta (la que usa salidas_leer), tamaño en bytes y fecha de modificación. | `carpeta`*, `profundidad` |

## Licitaciones

| Tool | Permiso | Qué hace | Parámetros |
|---|---|---|---|
| `competidores_ranking` | licitaciones:leer | Empresas que más ganan en nuestro sector (prefijos CPV de los filtros y del perfil de la empresa, o los que indiques) en los últimos N meses (24 por defecto): contratos, importe, órganos distintos, baja media, ofertas… | `meses`, `cpv`, `texto`, `importe_min`, `importe_max`, `todos_importes`, `nuts`, `toda_espana`, `desde`, `limite`, `orden` |
| `competidores_ver` | licitaciones:leer | Ficha de un competidor por NIF: contratos ganados, importe total y medio, órganos donde gana, CPV y territorios (NUTS) frecuentes, baja media y su rango (percentiles), número de ofertas de los contratos que gana, evol… | `solo_sector`, `nif`* |
| `licitaciones_acta_mercado` | licitaciones:leer | El acta (o informe de valoración o resolución) de una licitación ajena que pidió leer la tarea licitaciones.leer_acta_mercado: título, órgano, los lotes con su adjudicatario y nº de ofertas, y el texto del documento p… | `id`*, `desde` |
| `licitaciones_acta_mercado_guardar` | licitaciones:proponer | Devuelve quién se presentó a una licitación ajena según su acta (solo en la tarea licitaciones.leer_acta_mercado): en «licitadores», uno por empresa y lote con nif, nombre, lote, rol (licitadora, excluida o adjudicata… | `id`*, `licitadores`, `sin_datos` |
| `licitaciones_anexo` | licitaciones:proponer | Envía el relleno de un anexo (solo en tareas «rellena el modelo»). | `id`*, `clave`*, `desde_parrafo`, `hasta_parrafo`, `sustituciones`, `campos` |
| `licitaciones_antecedentes` | licitaciones:leer | Antecedentes de una licitación (por id): ediciones anteriores del mismo órgano (por NIF o, sin él, por DIR3 o nombre) con objeto parecido, publicadas al menos seis meses antes, con una línea de tiempo (año, expediente… | `id`*, `lote`, `limite` |
| `licitaciones_aprendizaje` | licitaciones:proponer | Envía lo aprendido de un acta de mesa (solo en tareas de aprender de un acta), con la carpeta y el documento de la tarea: resultado, ganador, puntos nuestros y del ganador, criterios (criterio, puntos_max, nuestros, g… | `carpeta`*, `documento`*, `resultado`*, `ganador`*, `puntos_nuestros`*, `puntos_ganador`*, `criterios`*, `lecciones`* |
| `licitaciones_barreras` | licitaciones:leer | Qué nos falta: certificaciones (ENS, ISO…), seguro de responsabilidad civil, clasificación empresarial y habilitaciones que piden las oportunidades seguidas (las de los últimos «meses», sin las sin cribar), con cuánta… | `meses` |
| `licitaciones_bloqueo_proponer` | licitaciones:proponer | Propón cómo resolver un bloqueo de las comprobaciones con evidencia. | `id`*, `clave`*, `tipo`*, `resumen`*, `citas`*, `datos`* |
| `licitaciones_candidatas` | licitaciones:leer | Candidatas de un lote de criba, en formato compacto (con la regla de presentación por lotes, los máximos y los lotes con id, nombre, importe y CPV), y la ruta del perfil de la empresa con el que hay que cribarlas. | `lote`* |
| `licitaciones_cobertura` | licitaciones:leer | Auditoría de cobertura de la PLACSP por comunidad autónoma: por semana cerrada (lunes, hora peninsular), las licitaciones de nuestro sector que trajo la agregada y los perfiles, por lugar de ejecución, y lo que public… | — |
| `licitaciones_comparables` | licitaciones:leer | Adjudicaciones parecidas a una licitación (por id) o a un segmento (cpv + importe + tipo). | `importe`, `lote`, `mismo_organo`, `id`, `cpv`, `tipo`, `procedimiento`, `limite` |
| `licitaciones_compromisos` | licitaciones:leer | Lo que la memoria técnica compromete y cuesta al ejecutar el contrato (frecuencias, horas fijas, sesiones, entrevistas, material por persona, plazos cortos), lo mismo que ve la persona en las comprobaciones y en el re… | `id`*, `version`, `lote`, `solo_caros` |
| `licitaciones_cribar` | licitaciones:proponer | Envía los veredictos de un lote de criba: exactamente uno por candidata, con veredicto (interesa, descartar o revisar), motivo, confianza de 0 a 1 y, en licitaciones con lotes a las que se puede ir por lotes sueltos, … | `lote`*, `veredictos`* |
| `licitaciones_decisiones` | licitaciones:proponer | Envía la propuesta de decisiones de la oferta (solo en tareas «propón las decisiones»), con el guion_id vigente: lotes, equipo (persona, rol en la oferta, dedicación y motivo), un criterio automático por cada uno del … | `id`*, `guion_id`*, `lotes`, `equipo`*, `automaticos`, `herramientas`, `enfoque`, `no_prometer`, `resumen`* |
| `licitaciones_documentos` | licitaciones:leer | La checklist de documentos de la presentación de una licitación, con lo que falta primero: «resumen» (obligatorios, verificados, faltan) y, por documento, clave, nombre, lote, sobre, tipo, si es obligatorio, «estado_v… | `id`*, `lote`, `sobre`, `hoja` |
| `licitaciones_dossier` | licitaciones:leer | El dossier de una memoria técnica (solo en tareas de estrategia o redacción de la memoria entera): lo que la plataforma reúne para escribirla. | `id`*, `memoria_id`*, `seccion`, `desde` |
| `licitaciones_equipo` | licitaciones:leer + colaboradores:leer | Equipo propuesto para una licitación: por cada requisito de medios personales de su ficha, los colaboradores internos y externos que mejor encajan, con puntuación 0–100, si cumplen los mínimos y cada regla (años, titu… | `id`*, `limite` |
| `licitaciones_eval_juicio` | licitaciones:proponer | Envía el juicio por pares de dos memorias (solo en tareas «compara dos memorias»), con caso, doc_1, doc_2 y lote de la tarea: por criterio de la rúbrica el preferido (1, 2 o empate), el margen, los puntos de cada uno,… | `caso`*, `lote`*, `doc_1`*, `doc_2`*, `por_criterio`*, `total_1`*, `total_2`*, `maximo`*, `preferido_global`*, `que_marca_la_diferencia`* |
| `licitaciones_eval_paquete` | licitaciones:leer | El paquete de un juicio por pares del banco de pruebas de memorias (solo en tareas «compara dos memorias»): la rúbrica, lo que el juez necesita del pliego y los dos documentos (sin decir de quién son), por trozos («de… | `caso`*, `doc_1`*, `doc_2`*, `lote`*, `parte`*, `desde` |
| `licitaciones_evaluacion` | licitaciones:proponer | Envía la evaluación de un documento de propuesta («Salidas/…» o «Conocimiento/…»): resumen, puntuación estimada por criterio de la ficha aprobada (peso, tipo, puntuación ≤ peso, justificación y referencia), puntuacion… | `id`*, `documento`*, `resumen`*, `puntuacion_total`*, `puntuacion_maxima`*, `criterios`*, `eliminar`*, `modificar`*, `reforzar`*, `comparables`*, `riesgos`*, `genericos`, `memoria` |
| `licitaciones_ficha` | licitaciones:proponer | Envía la ficha de una licitación leída de sus pliegos: resumen, requisitos (tipo, excluyente, cumple si/no/dudoso con justificación y página), criterios con peso y tipo, documentación por sobre, hitos, garantías, pena… | `titulo_corto`, `resumen`*, `requisitos`*, `criterios`*, `documentacion`*, `hitos`*, `garantias`*, `penalizaciones`*, `riesgos`*, `recomendacion`*, `presentacion_lotes`, `senales_pliego`, `cobertura`, `id`* |
| `licitaciones_guion` | licitaciones:proponer | Envía el guion de la oferta leído del pliego, todo literal y con documento y página: archivos electrónicos (nombre, contenido, prohibiciones, firma, documentos con tipo, obligatorio, quién lo produce y modelo), memori… | `archivos`*, `memoria`*, `automaticos`*, `oferta_economica`, `ofertas_economicas`, `plazo`*, `lotes`, `documentos_adjudicacion`, `alcance`, `id`* |
| `licitaciones_impacto` | licitaciones:leer | Qué rehace un cambio antes de hacerlo: piezas afectadas, acción, coste y lo que se mantiene. | `id`*, `cambio`* |
| `licitaciones_indices` | licitaciones:leer | Índices de mercado de una licitación (o de un `lote`; por defecto, el primero de interés), los mismos que ve la persona en la ficha: `competencia` (ofertas esperadas con su rango, P(un solo licitador) y si se mezcló c… | `lote`, `id`* |
| `licitaciones_lecciones` | licitaciones:proponer | Envía las lecciones de una versión de la memoria retocada a mano (solo en tareas «aprende de la memoria vN»), con el memoria_id de la tarea: de 1 a 12, cada una con texto (qué hacer, concreto), alcance (general, licit… | `id`*, `memoria_id`*, `lecciones`*, `cambios` |
| `licitaciones_libro_lecciones` | licitaciones:leer | El libro de lecciones aceptadas de nuestras ofertas (de la edición de la memoria, del acta de la mesa, de la decisión de ir y del precio), las de más fuerza (ofertas distintas que las apoyan) primero. | `id`, `tema`, `origen`, `retiradas`, `limite` |
| `licitaciones_licitadores` | licitaciones:leer | Licitadores de una licitación (o de un `lote`): `probables` (quién suele presentarse a lo comparable, con puntos, ganadas, presentadas, en este órgano, última vez, baja media y evidencia) y `presentados` (si ya se res… | `lote`, `id`* |
| `licitaciones_memoria_apartado` | licitaciones:proponer | Envía un apartado de la memoria técnica (solo en la tarea de redacción de la memoria entera, uno por envío y en cuanto lo termines), con los números de la tarea (memoria_id, guion_id, version, apartado): título litera… | `titulo`*, `bloques`*, `cubre`*, `compromisos`*, `fuentes`, `id`*, `memoria_id`*, `guion_id`*, `version`*, `apartado`* |
| `licitaciones_memoria_critica` | licitaciones:proponer | Envía la crítica ciega de una memoria técnica (solo en tareas «puntúa la memoria», ronda 0; desde la ronda 1 la crítica es por pares), con id, memoria_id y ronda de la tarea: por apartado el tramo de su escala, los pu… | `apartados`*, `resumen`*, `id`*, `memoria_id`*, `ronda`*, `lecciones` |
| `licitaciones_memoria_critica_paquete` | licitaciones:leer | El paquete ciego para criticar una memoria técnica (solo en tareas «puntúa la memoria» o «compara dos versiones»): la rúbrica (apartados con «se valorará», puntos, escala y advertencias), el pliego (identificación, pl… | `id`*, `memoria_id`*, `parte`*, `desde` |
| `licitaciones_memoria_critica_pares` | licitaciones:proponer | Envía la crítica por pares de una memoria técnica en una ronda de reescritura (solo en tareas «compara dos versiones», ronda 1 o más), con id, memoria_id y ronda de la tarea: por apartado el documento preferido («1», … | `apartados`*, `resumen`*, `id`*, `memoria_id`*, `ronda`* |
| `licitaciones_memoria_estrategia` | licitaciones:proponer | Envía la estrategia de una memoria técnica (solo en tareas «piensa la estrategia de la memoria»), con los números de la tarea (memoria_id, version): temas ganadores (3-6), audiencia, estructura (un elemento por aparta… | `temas`*, `audiencia`*, `estructura`*, `mapa`*, `hechos`*, `frontera`*, `reglas`*, `solucion`*, `id`*, `memoria_id`*, `version`* |
| `licitaciones_memoria_hechos` | licitaciones:proponer | Envía la corrección de la hoja de hechos de una memoria técnica en una ronda (solo en tareas «corrige la hoja de hechos»), con id, memoria_id y ronda de la tarea: por cada hecho que pide la tarea (los que cita el crít… | `id`*, `memoria_id`*, `ronda`*, `hechos`* |
| `licitaciones_mesa` | licitaciones:leer | La Mesa: ofertas por fecha límite para decidir, con su veredicto, su primer bloqueo, cuántas tareas tiene la persona, la cola y los compromisos caros de la memoria por suavizar (cuántos, horas y hasta cuándo da tiempo… | `desde`, `limite` |
| `licitaciones_oferta` | licitaciones:leer | La oferta de una licitación, por secciones y con lo accionable primero. | `id`*, `apartado`, `lote`, `secciones` |
| `licitaciones_oferta_hilo` | licitaciones:leer | El hilo del asistente de la oferta de una licitación: lo que respondió la persona a cada pregunta (lotes, equipo por rol, criterios automáticos, datos del anexo, enfoque), lo que guardó la plataforma, los textos libre… | `id`* |
| `licitaciones_oferta_interpretar` | licitaciones:proponer | Devuelve lo que entiendes de un texto libre del asistente de la oferta (lo pide la tarea licitaciones.interpretar_respuesta): con entendido=true, la «opcion» que corresponde o, si no es ninguna, la decisión en «accion… | `id`*, `mensaje`*, `entendido`*, `opcion`, `accion`, `explicacion`, `repregunta` |
| `licitaciones_oportunidades` | licitaciones:leer | Oportunidades de licitación que sigue la empresa, por «estados» (lista; por defecto nueva, ficha_por_revisar y en_preparacion), ordenadas por el próximo plazo (la solicitud de participación mientras siga abierta), 10 … | `estados`, `texto`, `pagina`, `limite`, `orden`, `comunidad` |
| `licitaciones_paquete` | licitaciones:leer | El paquete de presentación vigente de una licitación (lo genera una persona en la web; esta tool no genera nada): el veredicto de las comprobaciones (veredicto: tipo y texto) y el recuento de «bloquea» y «aviso» por l… | `id`* |
| `licitaciones_pedir` | licitaciones:proponer | Pide o relanza una fase de la oferta: ficha, guion, propuesta de decisiones, ronda de memoria (con version) o anexo (con clave_documento: la clave de licitaciones_documentos › documentos[]). | `id`*, `fase`*, `clave_documento`, `version`, `apartados`, `motivo`* |
| `licitaciones_plazos` | licitaciones:leer | Oportunidades que seguimos con fin de plazo de presentación en los próximos N días, con el plazo en ISO con zona y en texto (hora peninsular y de Canarias), el semáforo de requisitos y lo que espera revisión. | `dias` |
| `licitaciones_pliego_responder` | licitaciones:proponer | Responde a una pregunta de una persona sobre los pliegos (solo en la tarea licitaciones.preguntar_pliego): dice=true con una respuesta de una o dos frases y la «cita» literal del pliego con su «documento» (ruta); dice… | `id`*, `pregunta`*, `dice`*, `respuesta`*, `cita`, `documento` |
| `licitaciones_pliegos` | licitaciones:leer | Pasajes de los pliegos ya bajados e indexados de una licitación, por tema (solvencia_economica, solvencia_tecnica, clasificacion, medios_personales, medios_materiales, certificaciones, habilitacion, subcontratacion, i… | `id`*, `temas`, `max_por_tema`, `max_caracteres` |
| `licitaciones_precios` | licitaciones:leer | Bajas de adjudicación (1 - importe adjudicado / presupuesto del lote) de licitaciones parecidas del histórico de la PLACSP, por id de licitación o por cpv + importe + tipo. | `importe`, `lote`, `mismo_organo`, `ofertas`, `filtrar_ofertas`, `bajas`, `id`, `cpv`, `tipo`, `procedimiento` |
| `licitaciones_propuestas` | licitaciones:leer | Registro de propuestas presentadas por la empresa. | `id`, `resultado`, `limite` |
| `licitaciones_revision_previa` | licitaciones:proponer | Cierra la revisión previa al envío (solo en tareas «revisión previa del paquete»), con id y paquete_version de la tarea y un resumen sin importes. | `id`*, `paquete_version`*, `resumen`* |
| `licitaciones_ver` | licitaciones:leer | Todo de una licitación: datos de la PLACSP (criterios con pesos, requisitos, garantías, lotes, documentos, adjudicaciones), estado de la oportunidad, lotes (con los que encajaron en el prefiltro y los de interés de la… | `id`* |
| `organismos_ranking` | licitaciones:leer | Órganos de contratación que licitan en nuestro sector en los últimos N meses: licitaciones, importe licitado, meses con actividad, adjudicaciones, importe adjudicado, baja media, ofertas medias, adjudicatarios distint… | `meses`, `cpv`, `texto`, `importe_min`, `importe_max`, `todos_importes`, `nuts`, `toda_espana`, `desde`, `limite`, `orden` |
| `organismos_ver` | licitaciones:leer | Ficha de un órgano de contratación por NIF: licitaciones (total, del sector, abiertas, por año), a quién adjudica (los 10 que más ganan y la concentración del primero), baja media y percentiles, ofertas medias, evoluc… | `solo_sector`, `nif`* |

## Plataforma (perfil de la empresa, estado, trabajos y Salidas)

| Tool | Permiso | Qué hace | Parámetros |
|---|---|---|---|
| `plataforma_actividad` | plataforma:leer | Actividad reciente: últimas acciones de Hermes en sus sesiones, uso de herramientas por agente y eventos entre dominios. | `limite`, `seccion` |
| `plataforma_empresa` | plataforma:leer | Perfil de la empresa para evaluar requisitos de licitaciones: NIF, clasificaciones (grupo, subgrupo, categoría), volumen anual de negocio por año, certificaciones, seguro de responsabilidad civil, plantilla media, año… | — |
| `plataforma_empresa_proponer` | plataforma:proponer | Propone el perfil de la empresa completo (no un parche: lo que no envíes queda vacío). | `perfil`*, `motivo`* |
| `plataforma_estado` | plataforma:leer | Estado de la plataforma: índice de la Biblioteca, ingesta de licitaciones, colaboradores, agentes y cola de trabajos de IA (cuántos hay por estado en total y en los últimos 7 días —por_estado_7_dias—, los fallos de es… | `seccion` |
| `plataforma_trabajos` | plataforma:leer | Trabajos de la cola de IA (criba, fichas, guiones, memorias, anexos…) filtrados por tipo, estado, código del fallo, licitación y días, del más nuevo al más viejo y por páginas: «total» y «siguiente» (pásala como «desd… | `tipo`, `estado`, `codigo`, `licitacion`, `dias`, `desde`, `limite` |

## Colaboradores

| Tool | Permiso | Qué hace | Parámetros |
|---|---|---|---|
| `colaboradores_buscar` | colaboradores:leer | Personas del equipo (internas) y externas que encajan con uno o varios requisitos de medios personales (texto libre, p. ej. | `texto`, `requisitos`, `cpvs`, `tipo`, `limite` |
| `colaboradores_proponer_perfil` | colaboradores:proponer | Envía el perfil de un colaborador leído de su CV (en Colaboradores/ de la Biblioteca): nombre, tipo, rol, titulaciones, certificaciones, años de experiencia, sectores, CPV, tecnologías, idiomas con nivel, horas de doc… | `cv_ruta`*, `persona_id`, `perfil`* |
| `colaboradores_ver` | colaboradores:leer | Ficha de un colaborador por id (tipo, rol, titulaciones, certificaciones, años de experiencia, sectores, CPV, tecnologías, idiomas, horas de docencia por materia con su evidencia, disponibilidad calculada con su motiv… | `id`, `tipo` |
