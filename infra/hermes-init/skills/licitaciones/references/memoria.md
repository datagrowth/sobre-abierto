<!-- Referencia de la skill «licitaciones». Se carga bajo demanda desde SKILL.md. -->

# Memoria técnica

**Cuándo leer esto.** En cualquier tarea de memoria, también las de un lote concreto y las de una versión nueva (sección «Memoria por lote y versión nueva»): la estrategia, la redacción de la memoria entera, la corrección de hechos de una ronda o la crítica ciega (secciones «Estrategia de la memoria», «Redactar la memoria entera», «Corregir hechos en una ronda» y «Criticar una memoria (ciego)»; las reglas de cada apartado y las figuras están en «Reglas de cada apartado» y «Figuras»), «aprende de la memoria vN» (sección «Aprender de una versión editada a mano») y «compara dos memorias» del banco de pruebas.

Antes de trabajar en una oferta, lee `licitaciones_oferta` con `secciones` = `["estado", "bloqueos"]` (regla del núcleo de la skill).

## Reglas de cada apartado

La memoria se redacta en una sola tarea («Redactar la memoria entera»), pero cada apartado se
envía por separado y pasa estas reglas. **Es texto final** que se entrega al órgano de
contratación: nada de huecos, borradores ni avisos internos. Por apartado, la tarea trae
(título literal, puntos, «se valorará», escala, advertencias y página), la **extensión
objetivo** (el 90-100 % de su cuota: su parte del límite de páginas por sus puntos, con un
15 % de holgura), las **decisiones** del equipo (lotes, equipo nominal con su rol, titulación,
años, certificaciones y su CV, herramientas e instrucciones del equipo) y la **frontera con
los otros sobres**: las materias que se valoran en otro archivo y sus **marcas**, que no
aparecen en la memoria ni para afirmarlas ni para negarlas. No las cambies; si el guion
(`licitaciones_oferta`) dice algo distinto, manda el guion. Las instrucciones del equipo
orientan qué contar y con qué énfasis: no las copies en el texto. Si la memoria **no es
valorable** (el pliego la exige sin puntuarla), la tarea trae en vez de «se valorará» y
escala el **contenido que exige el pliego**: trátalo todo, claro y verificable (si falta
algo, la oferta puede quedar excluida), y la cuota es el límite repartido a partes iguales,
sin suelo y sin relleno.

1. Si necesitas más que lo que trae la tarea, `licitaciones_oferta` con `id` y `apartado`: la
   misma rúbrica, el guion entero y las decisiones. `licitaciones_ver`, la ficha.
2. El objeto del servicio: `licitaciones_pliegos` con los temas de la memoria
   (`objeto_alcance`, `prestaciones`, `niveles_servicio`, `metodologia_entregables`,
   `formacion_transferencia`, `destinatarios_usuarios`) y los habituales (medios personales
   y materiales, lugar, plazos, penalizaciones): qué se presta, a quién, con qué nivel, cómo
   y qué se entrega. Lo que necesites entero del PPT, por páginas.
3. Lo que hicimos otras veces: `licitaciones_propuestas` → `parecidas` y `aprendizajes`, y
   `biblioteca_buscar` con `carpeta` = `Licitaciones/Presentadas`. Reutiliza lo que
   funcionó, sin datos de otro cliente.
4. Escribe concreto y operativo (quién, qué, cuándo, con qué herramienta, con qué
   indicador), en español de España, de usted hacia el órgano y con voz de empresa, **en
   afirmativo, en presente o futuro de compromiso** («<empresa> implanta…», «<empresa>
   implantará…», «la responsable revisará cada lunes…», con el nombre de la empresa que da la tarea). Los parámetros de diseño (región,
   servicios, modelo, umbrales, horario, tiempos, dedicaciones, fechas) se fijan con su valor y
   se escriben como hecho («La solución usa…», «El servicio se presta de 9:00 a 18:00 h»), sin
   «el órgano lo ratifica en el acta»: repetida, la mesa lo lee como aplazamiento (contador
   RATIFICACIONES: más de una por apartado se rechaza; solo para lo que el pliego reserva
   expresamente al órgano). Nada de «a acordar», «sujeto a
   validación» ni calendarios relativos a «T0»: se tolera un aplazamiento cada dos páginas
   (contador APLAZAMIENTOS) y solo para lo que el pliego reserva al órgano. Sin condicionales ni matices que resten («en la medida de lo posible», «si
   procede», «en su caso», «no incluye»): lo que no ofrecemos no se menciona. Sin autoelogio
   ni «líder», sin repetir el pliego. Nuestros diferenciadores, con hechos: soluciones a
   medida, trato directo con quien hace el trabajo, autonomía del cliente al terminar y
   **alcance claro en positivo** (qué entregamos, cuándo y cómo se mide). **Audiencia**: las
   herramientas, los ejemplos y el nivel técnico se ajustan a los destinatarios que fija el
   pliego (a quien usa ofimática, ejemplos de su trabajo diario, no herramientas de
   ingeniería de datos). **Prosa** que se lee de corrido: párrafos completos, frases con
   sujeto y verbo, sus artículos y conectores; nada de frases nominales, retahílas de
   sustantivos ni palabras unidas con barras («lectura/escritura»); las tablas, solo para
   datos. Si no cabe, quita lo secundario: no comprimas la sintaxis (contador PROSA
   TELEGRÁFICA: menos de un 33 % de artículos, preposiciones y conjunciones en los párrafos o
   palabras pegadas). **Extensión**: ocupa el 90-100 % de la cuota con contenido que
   puntúa. El texto se entrega tal cual: lo que tomes del pliego va en prosa propia, **sin
   citarlo** (nada de nombres de archivo, «§» ni «pág. N»; si hace falta nombrarlo, «como
   pide el apartado 4.1 de la ETC»).
5. `licitaciones_memoria_apartado` con los números de la tarea (`memoria_id`, `guion_id`,
   `version`, `apartado`), el `titulo` literal, `bloques` (1 a 15: `subtitulo` opcional,
   `parrafos` de 20 a 3.000 caracteres, `lista` (viñetas), `lista_numerada` (pasos que empiezan
   en 1 en cada bloque) o `tabla` con `cabecera` y `filas`, `apaisado` para una tabla ancha (una
   de 6 columnas o más ya va en horizontal), y `figura` opcional con `titulo` y `svg`; ver
   «Figuras». En el texto solo valen `**negrita**` y `*cursiva*`: cualquier otra marca de
   Markdown saldría tal cual y se rechaza), `cubre`
   (cada punto de «se valorará» con el `bloque` y, si puedes, el `parrafo` que lo trata,
   contando desde 1) y `compromisos` (`que`, `quien`, `cuando_o_medida`). `fuentes`
   (documento y página en que te apoyas) es opcional y no va al documento.

Qué comprueba el servidor, en este orden (rechaza con la frase exacta; tras dos rechazos se
acepta con avisos que ve el equipo, salvo lo marcado «siempre»: una fuga al archivo de los
automáticos o de la oferta económica excluye la oferta y nunca entra):

| Comprobación | Rechazo |
|---|---|
| Título | Debe ser el literal del guion (sin contar tildes, mayúsculas ni un «1.» delante) |
| Cobertura | Cada punto de «se valorará» declarado en `cubre`; `cubre` apunta a bloques y párrafos que existen y solo a puntos de este apartado |
| Sin terminar | Nada de `[PENDIENTE`, `[COMPLETAR`, `[TODO`, «por confirmar», `TBD`, `XXX` |
| Sin dinero (siempre, sin aceptación con avisos) | Ningún importe (`€`, «euros») ni baja o descuento con `%` en una frase que hable de la oferta (precio, presupuesto, coste, honorarios, IVA…): van en la oferta económica y mencionarlos es causa de exclusión. Un importe que no hable de ella (el ejemplo de un método de valoración) se rechaza como los demás problemas: déjalo claro en la frase o quítalo |
| Sin citas | Nada de nombres de archivo, «§», «pág. N» ni «(… pp. N)» en el texto |
| Sin automáticos (siempre, sin aceptación con avisos) | Ninguna `marca` de los criterios automáticos que van en otro archivo (p. ej. «ISO 14001»), se acoja la empresa o no; nada de lo que ofrecemos en ellos según las decisiones (la cifra del nivel, como «2 horas» o «24/7», al hablar de ese criterio, o la herramienta que solo se nombra ahí, como «RustDesk»); ni sus anexos («Anexo V»); si puntúan la experiencia, titulación o certificaciones del equipo, ni los años de alguien del equipo junto a su nombre (redacta por roles) |
| Ecos | No contar con otras palabras lo que se declara en los automáticos de otro archivo a los que nos acogemos (p. ej. «accederá solo a lo imprescindible para resolver la incidencia» cuando la declaración del sobre C dice eso). Es una sospecha: tras dos rechazos entra con aviso, y quien da la memoria por buena tiene que dar el motivo |
| Extensión | No más caracteres que la cuota del apartado y, si la memoria puntúa, no menos del 70 % (sin límite de páginas no hay cuota) |
| Tono | Como mucho dos matices que restan («no se oferta», «no equivale», «no incluye», «en la medida de lo posible», «si procede», «en su caso»…), o uno cada dos páginas |
| Forma | Cada compromiso con `quien` y `cuando_o_medida`; al menos un párrafo (no solo listas o tablas); letra de las figuras ≥ 7 pt en la página; pie sin «Figura N» |
| Figuras (siempre, sin aceptación con avisos) | Como mucho 4 por apartado; cada `svg` se dibuja sin errores, con `viewBox` y sin scripts, `on…=`, `<image>`, `<foreignObject>`, `href` o `url()` externos, `@import`, DOCTYPE ni entidades |

Los rótulos de las figuras (`<text>`) y su pie pasan las mismas comprobaciones que el texto:
nada de importes, criterios automáticos, citas internas ni huecos dentro de un dibujo.

También rechaza un apartado para otra memoria o versión, para una memoria que no está en la
redacción y para un apartado que ya recibió (si hay que rehacerlo, el equipo pide la versión
siguiente o una ronda). Cuando llegan todos y pasan la crítica, la plataforma monta el `.docx`
con portada, índice y los títulos literales; tú no escribes archivos.

Ejemplo de la forma (recortado: un apartado real ocupa el 90-100 % de su cuota):

```json
{
  "id": "p-12345678", "memoria_id": 12, "guion_id": 7, "version": 1, "apartado": 2,
  "titulo": "Gestión de incidencias y control de calidad",
  "bloques": [
    { "subtitulo": "Procedimiento de incidencias",
      "parrafos": ["Analítica Ejemplo registrará cada incidencia en el gestor de tickets el mismo día en que llegue, con su prioridad (alta, media o baja) y la persona responsable. Las de prioridad alta se atenderán en 4 horas laborables; el resto, en 2 días."],
      "lista": ["Alta: afecta a datos personales o a un plazo legal", "Media: bloquea a una unidad", "Baja: consulta o mejora"] },
    { "subtitulo": "Indicadores de calidad",
      "parrafos": ["El servicio se medirá cada mes con estos indicadores, que se entregan a la entidad en el informe de seguimiento."],
      "tabla": { "cabecera": ["Indicador", "Objetivo", "Medida"], "filas": [["Consultas respondidas en plazo", "≥ 95 %", "Mensual"], ["Incidencias reabiertas", "≤ 5 %", "Mensual"]] } },
    { "subtitulo": "Control y seguimiento",
      "parrafos": ["La responsable del servicio se reunirá cada mes con la Asesoría Jurídica para revisar los indicadores y acordar las correcciones, que quedan en acta."] }
  ],
  "cubre": [
    { "item": "Procedimiento de gestión de incidencias", "bloque": 1, "parrafo": 1 },
    { "item": "Indicadores de calidad del servicio", "bloque": 2, "parrafo": 1 },
    { "item": "Mecanismos de control y seguimiento", "bloque": 3, "parrafo": 1 }
  ],
  "compromisos": [
    { "que": "Atender las incidencias de prioridad alta", "quien": "Responsable del servicio", "cuando_o_medida": "4 horas laborables" },
    { "que": "Informe mensual de indicadores", "quien": "Responsable del servicio", "cuando_o_medida": "Primeros 5 días de cada mes" }
  ]
}
```

### Figuras

Cuando el apartado pide **pantallas (mockups), una arquitectura, un flujo, un organigrama o
un calendario**, dibújalo en vez de describirlo en prosa o con dibujos ASCII: una figura
ahorra media página de texto y la mesa la entiende de un vistazo. Va en `figura` del bloque
que la explica, al final del bloque. La plataforma la numera en orden («Figura 1. …»), la pasa
a imagen y la mete en el Word centrada, a todo el ancho (16 cm) y con su pie; en el texto
preséntala como «la figura siguiente», nunca por número.

- `titulo`: el pie, una frase («Arquitectura de la plataforma en Azure»), sin «Figura N».
- `svg`: un único `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500">…</svg>`
  autocontenido. Formas (`rect`, `line`, `path`, `circle`, `polygon`), `text` y, si hace falta,
  `defs` con `marker` o `linearGradient` referenciados con `#id`.
- Letra: `font-family="Arial, Liberation Sans, sans-serif"` y `font-size` ≥ 13 con un
  `viewBox` de 800 de ancho (en la página son ≈ 7 pt o más; la plataforma rechaza menos).
  Rótulos cortos; nada de párrafos dentro del dibujo.
- Colores sobrios: fondo blanco, cajas en gris claro (#F2F4F7) con borde (#5B6B7F), un color
  de acento (#1F6FB2) para lo nuestro; texto en #1D2733. Que se entienda impreso en gris.
- Proporción apaisada (más ancho que alto, p. ej. 800×500); como mucho 800×1000.
- Prohibido: `<script>`, atributos `on…=`, `<image>`, `<foreignObject>`, `href` o `url()`
  que no empiecen por `#`, `@import`, DOCTYPE y entidades. Se rechaza siempre.
- Una pantalla (mockup) es un esquema: marco de ventana, barra superior, menú y las cajas de
  lo que se ve con sus rótulos reales («Ficha de entrada», «Buscar expediente»), no un dibujo
  detallado.
- **Apartado de pantallas** (pide mockup, maqueta, prototipo o interfaz): hasta **10
  figuras**, una por pantalla. Cada pantalla lleva **llamadas numeradas** (1, 2, 3…) sobre lo
  que se ve y, en el mismo bloque, la `lista_numerada` que explica cada llamada; con varias
  pantallas, una **tabla de pantallas** (pantalla, para qué sirve, quién la usa). Un mismo caso
  recorre todas las pantallas: es el hilo común; en el resto de apartados, un caso distinto en
  cada uno. Sin leyenda o sin tabla, se rechaza hasta el tercer envío.

```json
{ "subtitulo": "Arquitectura de la solución",
  "parrafos": ["La figura siguiente resume cómo fluyen los datos desde las fuentes del cliente hasta los cuadros de mando, y qué pieza administra cada equipo."],
  "figura": { "titulo": "Arquitectura de la plataforma de datos",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 800 300\" font-family=\"Arial, Liberation Sans, sans-serif\"><defs><marker id=\"f\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"8\" markerHeight=\"8\" orient=\"auto\"><path d=\"M0,0 L10,5 L0,10 z\" fill=\"#5B6B7F\"/></marker></defs><rect x=\"20\" y=\"110\" width=\"200\" height=\"80\" rx=\"8\" fill=\"#F2F4F7\" stroke=\"#5B6B7F\"/><text x=\"120\" y=\"156\" font-size=\"16\" text-anchor=\"middle\" fill=\"#1D2733\">Fuentes del cliente</text><rect x=\"300\" y=\"110\" width=\"200\" height=\"80\" rx=\"8\" fill=\"#1F6FB2\"/><text x=\"400\" y=\"156\" font-size=\"16\" text-anchor=\"middle\" fill=\"#FFFFFF\">Integración y modelo</text><rect x=\"580\" y=\"110\" width=\"200\" height=\"80\" rx=\"8\" fill=\"#F2F4F7\" stroke=\"#5B6B7F\"/><text x=\"680\" y=\"156\" font-size=\"16\" text-anchor=\"middle\" fill=\"#1D2733\">Cuadros de mando</text><line x1=\"220\" y1=\"150\" x2=\"296\" y2=\"150\" stroke=\"#5B6B7F\" stroke-width=\"2\" marker-end=\"url(#f)\"/><line x1=\"500\" y1=\"150\" x2=\"576\" y2=\"150\" stroke=\"#5B6B7F\" stroke-width=\"2\" marker-end=\"url(#f)\"/></svg>" } }
```

Una figura cuenta en la cuota por lo que ocupa en la página (una de 800×500 a todo el ancho,
unos 10 cm de alto, equivale a unos 1.200 caracteres), no por sus rótulos.

### Nueva versión de una memoria

Cada memoria ensamblada se evalúa sola con la escala del guion (ver «Evaluar una memoria con
la escala del guion» en `references/propuestas-actas.md`). La versión siguiente de una memoria
montada es de una de dos clases, y la tarea de redacción dice cuál:

- **Por un cambio tardío** («Actualizar los apartados afectados»: cambió el equipo, los lotes, la
  empresa o el guion). Cada apartado a rehacer trae un bloque **ACTUALIZACIÓN DE LA vN POR UN
  CAMBIO TARDÍO** con lo que cambió (o las indicaciones de quien lleva la oferta, que **mandan**)
  y el **texto actual** del apartado, que puede estar editado a mano. Cambia solo lo que depende
  del cambio y conserva el resto palabra por palabra.
- **Para mejorar** («Nueva versión» de una persona, con o sin indicaciones, o una ronda que pides
  tú con `licitaciones_pedir` › `ronda_memoria`). Cada apartado a rehacer trae primero las
  **INDICACIONES DE QUIEN LLEVA LA OFERTA** si las hay (mandan sobre la evaluación), después
  **MEJORA DE LA VERSIÓN N** con el tramo en que lo dejó la evaluación, la justificación, las
  sugerencias (Modificar, Reforzar, Eliminar) y los párrafos genéricos de ese apartado, y al final
  el **TEXTO ANTERIOR**. Reescríbelo entero para su tramo máximo: conserva lo que la mesa
  valoraría y corrige lo señalado; no lo reenvíes tal cual. Si la pediste tú, tu `motivo` llega
  como contexto (**HERMES PIDIÓ ESTA RONDA PORQUE**): no manda sobre la evaluación ni añade
  compromisos. Una ronda tuya necesita la versión base evaluada; sin `apartados`, rehace los que
  la evaluación deja por debajo de su tramo máximo.

En las dos, la plataforma copia tal cual los apartados que no se rehacen (con las ediciones a
mano), conserva la estrategia sin los hechos que el cambio dejó atrás y te encarga **una sola
tarea de redacción** con los apartados elegidos; el dossier lo recompone el código. Si la base es
de un guion anterior con los mismos apartados, se rehacen también los que cambiaron de puntos,
contenido o escala. Si la base no tiene estrategia (una memoria montada sin fases), primero llega la tarea de estrategia y después la de redacción.

- Las figuras del texto anterior aparecen como «Figura: pie», con sus rótulos y su SVG entero: si
  siguen valiendo, reenvíalas (retocadas si hace falta) en el bloque que toque.
- Si el texto anterior trae **TABLAS** (en JSON, tal cual van en `tabla`) o **IMÁGENES**
  (`"imagen": {"ruta", "ancho", "alto", "pie"}`), conserva las tablas (mejóralas si toca, sin
  convertirlas en listas) y, para mantener una imagen, pon ese mismo objeto `imagen` en el bloque
  donde va. No inventes rutas: la plataforma solo acepta las imágenes guardadas de esta licitación.
- Si el apartado no llegó a redactarse en la versión anterior, redáctalo entero.
- Cada apartado se envía igual (`licitaciones_memoria_apartado`) y pasa las mismas
  comprobaciones, cuota incluida. Después, la crítica y las rondas siguen solas.

Una versión **subida a mano** (un Word o PDF de una persona) no sirve de base: pedir una ronda
sobre ella da `conflicto`; la persona la corrige en su documento o pide una memoria nueva.

## Memoria por lote y versión nueva

- **Una por lote.** Si el guion trae `memoria.por_lote` = `true` (el pliego exige una memoria
  específica por lote), la plataforma pide una memoria por cada lote decidido y `licitaciones_oferta`
  lo dice en la sección `memoria`, en `memorias_por_lote`: una entrada por lote,
  `{ lote, version, estado, por_revisar, presentada }` (`version` `null`: aún sin pedir; `null` en
  vez de la lista = una memoria común). Con memoria por lote, pide la de un lote con `lote`
  (`licitaciones_oferta` con `secciones: ["memoria"]` y `lote: "2"`): trae sus apartados, su
  evaluación y lo que mejorar. Sin `lote`, `memoria` es `null` con `aviso_memoria` en cuanto algún
  lote tiene la suya (no se elige una por ti): mira `memorias_por_lote` para saber qué falta en cada lote, y un lote
  con `"presentada": true` ya está entregado y no se mejora. Cada tarea de memoria
  lleva su **lote** («solo de este lote»): escribe únicamente con las decisiones, el equipo y los
  criterios automáticos de ese lote y no menciones el otro. La versión sigue siendo de la licitación
  (versión 5 · lote 2, versión 6 · lote 4). Se revisa y se da por buena una por lote.
- **Equipo sin nombres.** Si el pliego pide CV anonimizados, la sección `memoria` lo dice en
  `memoria.anonimato` (`{ exige, apartados, personas }`: `exige` true, y qué apartados nombran ya a
  alguien del equipo y a cuántas personas): en ninguna
  versión nombres a las personas, solo roles. Guardar un apartado que las nombra se rechaza.
- **La presentada no se toca.** Una memoria marcada como presentada (por lote, si hay lotes) ni se
  mejora ni se rehace por un cambio tardío.
- **Versión nueva tras un cambio.** Si cambió el equipo, las herramientas, los lotes u otro sobre
  desde que se redactó, la versión nueva entra en la redacción y la tarea te dice qué apartados
  rehacer (ver «Nueva versión de una memoria»): redacta solo esos, el resto se copia tal cual
  (con las ediciones a mano) y la estrategia llega sin los hechos que el cambio dejó atrás.

## Plan, redacción entera y crítico ciego

La memoria no se escribe apartado a apartado en runs aislados: la plataforma compone un
**dossier** (todo lo que hace falta en un solo sitio), tú piensas la **estrategia**, redactas la
memoria **entera en un run**, el código comprueba la **coherencia** con la hoja de hechos y un
**crítico ciego** la puntúa; si no llega al umbral, se reescriben solo los apartados flojos.
`licitaciones_oferta` (sección `memoria`) trae el `progreso` de la memoria: en qué fase está
(`progreso.situacion`) y su ficha de solución (`progreso.ficha`); es `null` en una versión subida
a mano. Cada tarea dice cuál de estas tres te toca.

### Estrategia de la memoria

1. `licitaciones_dossier` con `id` y `memoria_id`: el índice y después **cada sección entera**
   (identificacion, pliego_tecnico, criterios, formato, frontera, empresa, equipo, herramientas,
   lecciones, parecidas), sin saltarte ninguna. Una sección recortada dice dónde sigue
   (`biblioteca_leer` con ruta y páginas): léelo.
2. **Decisiones de diseño**: somos el implantador y decidimos. Fija un valor concreto para
   cada parámetro que el pliego deja al licitador (región y servicios de nube, modelo y versión,
   límites de ejecución, presupuesto de tokens y latencia p95, umbrales de calidad, banco de
   pruebas, horario de soporte y tiempos por prioridad, dedicación por rol y fechas desde el
   inicio previsto con los festivos descontados). Lo decidido se escribe como hecho («La
   solución usa X en la región Y»), nunca «proponemos X; el órgano lo ratifica en el
   acta»; «se ratifica en…» solo para lo que el pliego reserva al órgano (`pendientes_legitimos`),
   como mucho una vez por apartado. Solo queda abierto lo que el pliego reserva expresamente
   al órgano, y aun así con nuestra propuesta por defecto. «No consta en el dossier» no es motivo
   para no fijar un valor de diseño; lo que no se inventa son importes, acreditaciones,
   certificaciones, licencias, accesos concedidos y normas que no están en el dossier.
3. Piensa la oferta como el mejor competidor: **reglas de oro**, de 3 a 6 **temas ganadores**
   (mensaje, por qué puntúa según la rúbrica, la prueba que lo demuestra y en qué apartados va),
   **audiencia** (destinatarios, nivel, ejemplos de su día a día y qué evitar), la **estructura**
   (un elemento por apartado del guion, en orden, con su **título literal**, la extensión objetivo
   en caracteres —la tarea da el intervalo de cada uno y el total que cabe— y sus secciones con
   contenido y elementos: tabla, figura, lista, cronograma o riesgos), el **mapa** (cada «se
   valorará» de cada apartado → la sección que lo trata → la evidencia, en una frase legible con
   espacios entre palabras y cifras: sale tal cual en la tabla guía del documento) y la **frontera**.
4. **Hoja de hechos**: cada horario, plazo, rol, indicador, cifra, herramienta y fecha que salga
   en más de un apartado, con su valor exacto y de 1 a 5 palabras ancla. Es el contrato: todos
   los apartados la copian tal cual (si no, un apartado dice 9-18 h y otro 9-17 h).
   Nada de lo que va en otros archivos ni importes: un hecho que delata un criterio automático se
   rechaza siempre. Si el dossier dice **«equipo por roles, sin nombres»**, los hechos de rol
   nombran el rol, nunca a la persona (también se rechaza siempre). Cada hecho de rol lleva en
   `corto` su sigla (obligatoria si el rol pasa de 40 caracteres) y cada hecho, en `apartados`,
   dónde sale: cada apartado que puntúa necesita al menos 2 cifras o indicadores (hechos o
   evidencias del mapa con su número). Las fechas, absolutas.
5. **Solución** (`solucion`): el calendario con fechas reales desde el inicio previsto de
   «identificacion» (semanas con fechas, trabajo, sigla del rol, entregable y puerta; festivos y
   regla de desplazamiento), la arquitectura por capa (servicio, tier, región, motivo, control y
   alternativa; vacía si no hay sistemas), los modelos (familias y versiones **vigentes a la
   fecha del pliego**: una versión fechada de más de 12 meses antes del inicio previsto se
   rechaza salvo que el pliego la cite; si no consta una versión vigente, la familia y el nivel
   con el criterio de sustitución), los umbrales (métrica, fórmula, umbral,
   con qué y cuándo: **en qué entorno y con qué datos** se mide cada indicador —sintéticos,
   muestra o reales—, coherente con el calendario: nada con datos reales en un entorno o una
   fecha que el calendario aún no permite), el banco de pruebas, la formación y el soporte solo si los pide el pliego
   o se acreditan en esta memoria, de 3 a 15 riesgos con dueño, la sigla y la dedicación de cada
   rol (`alias_roles`), un caso distinto por apartado y como mucho 5 `pendientes_legitimos`,
   cada uno con la **cita literal** del pliego o de la aclaración que lo reserva al órgano (se
   comprueba contra el dossier) y nuestra propuesta por defecto. Si la sección
   `normativa_cliente` del dossier trae pasajes de normas del cliente (no solo el índice o el
   contrato), el **catálogo normativo** (`catalogo_normativo`): una fila por regla que aplica la
   solución (`id` R01, R02…, `regla` operativa, `norma` con su código y apartado tal como salen en
   el dossier, `cita` literal de un pasaje de **esa misma norma** —nunca del pliego; se comprueba
   contra el dossier, y el apartado tiene que salir en sus pasajes o se deja solo el código— y
   `donde` se aplica en la solución); una cita que leíste con `biblioteca_leer` pasa con aviso;
   sin normativa, vacío. Y los **compromisos** (`compromisos`): cada cosa que la memoria promete
   y cuesta al ejecutar (frecuencias, horas, sesiones, material, entrevistas, informes,
   disponibilidad fuera de horario). `clase` «exigido» si lo pide el pliego, con la `cita`
   literal del dossier (se comprueba como la de un pendiente); «anadido» (sin tilde) si lo
   ofrecemos nosotros, con el `criterio` o apartado que lo puntúa y por qué `compensa`. El coste
   va en `horas` de persona en todo el contrato y, si lo que cuesta no son horas (material,
   desplazamientos), en `nivel` («bajo», «medio» o «alto»), con el `supuesto` en horas o
   unidades («150 alumnas × 1 h», «150 kits impresos»). Nunca importes ni moneda en ningún campo:
   la memoria va en un sobre sin precios y se rechaza. `quitado` siempre en false. Lo
   añadido solo entra si compensa los puntos que da y, por defecto, en su **formulación más
   barata que puntúe**: a petición en vez de fija, mensual en vez de semanal, asíncrono en vez de
   presencial, materiales digitales o del alumnado en vez de kits, las frecuencias y cantidades
   mínimas que valore el pliego. Nada de guardias, fines de semana, entrevistas con cada persona
   ni material físico por persona si el pliego no lo exige o lo puntúa. Un añadido de más de
   40 h o de coste alto sale marcado en la ficha para que la persona lo mantenga, lo suavice o
   lo quite (más de 10 h es coste medio).
   Todo compromiso lleva su coste, también el exigido: uno exigido caro sale en la ficha (sin
   poder quitarlo) para comprobar que la cita lo pide tal cual. No marques «exigido» lo que la
   cita no pide literalmente: si el pliego pide «seguimiento del alumnado», lo exigido es eso, no
   una entrevista semanal con cada alumna.
6. `licitaciones_memoria_estrategia` con `id`, `memoria_id`, `version` y todo lo anterior. Se
   rechaza con la frase exacta (hasta el tercer envío) un título que no es el literal, un «se
   valorará» sin sección en el mapa, extensiones que no caben, un aplazamiento sin valor («T0»,
   «a acordar», «sujeto a validación»… sin cifra al lado), un calendario sin fechas o antes del
   inicio previsto, un apartado sin cifras, un rol largo sin sigla, una regla del catálogo cuya
   cita o norma no está en el dossier (o el catálogo vacío habiendo normativa), un modelo con
   versión anticuada, un compromiso exigido sin una cita que esté en el dossier, un añadido sin
   criterio o sin coste, o un pendiente sin cita o con
   un nombre genérico («calendario», «plazo»: di cuál; un nombre genérico no exime nada); una
   fuga en la solución, siempre. No redactes la memoria. Antes de redactar, una persona revisa
   la solución en la web (la **ficha de solución**) y puede cambiar valores; mientras tanto,
   `licitaciones_oferta` dice «ficha de solución pendiente de revisión»: no hagas nada.

### Redactar la memoria entera

La tarea trae la **estrategia entera** (es el contrato), el índice del dossier, la rúbrica y la
cuota de cada apartado pendiente, las decisiones del equipo y las reglas habituales (las de
«Reglas de cada apartado», incluidas «Figuras»).

1. Antes de escribir, lee enteras del dossier `pliego_tecnico`, `criterios`, `frontera` y
   `equipo`; el resto, cuando lo necesites.
2. Escribe tú solo y seguido, en orden, con la misma voz y los mismos hechos, nombres y cifras
   en todos los apartados. Cifras, horarios y plazos, exactos de la hoja de hechos; cada rol,
   entero la primera vez (en la tabla del equipo) y después por su sigla; la solución se
   compromete tal cual. Si la tarea trae la **FICHA DE SOLUCIÓN**, manda sobre la estrategia y
   la hoja de hechos: donde difieran, usa la ficha (y si cambió el inicio, desplaza el
   calendario). Una frase de 6 palabras o más repetida más de 8 veces sale como aviso. Lo que la estrategia marca como tabla, cronograma o registro de
   riesgos va como tabla; una figura, como SVG. El **catálogo normativo** de la solución va como
   tabla (id, regla, norma y apartado, dónde se aplica) en el apartado del diseño funcional, y
   cada regla se cita por su id donde se aplica. **Compromete solo lo que está en la tabla de
   compromisos, en la solución y en la hoja de hechos** (y en la ficha, sin lo que la persona
   quitó), con sus cifras (la formación con sus horas y sesiones, el soporte con su horario):
   cualquier otra
   frecuencia, cantidad, número de horas, material físico o disponibilidad fuera de horario se
   escribe como capacidad o a petición («a petición de la entidad», «hasta N al mes»), nunca
   como compromiso fijo. «Podrá» no basta: «un kit que podrá llevarse a casa» sigue prometiendo
   el kit. Lo quitado en la ficha no se escribe aunque lo traiga otra parte. En las rondas, lo
   que el crítico echa en falta y el criterio valora expresamente («se valorará…») sí se concreta
   con las cifras de la solución o de la hoja.
3. **Envía cada apartado en cuanto lo termines** con `licitaciones_memoria_apartado` (los números
   de la tarea y `apartado` = N), no todos al final: cada envío es la señal de que sigues
   trabajando y, si el run se corta, lo enviado se queda. Un reintento te pide solo lo que falta
   y trae el texto de lo ya recibido para no contradecirlo.
4. Además de las comprobaciones habituales, cada apartado se contrasta con la **hoja de hechos**:
   una contradicción («la hoja dice L-V 9:00-17:00 y aquí pone de 9 a 18 h») se rechaza con la
   frase exacta hasta el tercer envío; un nombre del equipo cuando va por roles, siempre. Copia
   el valor de la hoja. También hasta el tercer envío, las frases que comprometen «cada semana»,
   «cada día», algo «por alumna», N horas, una guardia, el domingo, un kit o una entrevista
   individual y no están en los compromisos, la solución ni la hoja: reescríbelas a petición o
   como capacidad, o quítalas.
5. En una **ronda de reescritura**, cada apartado a rehacer trae su texto actual, lo que señala
   el crítico (cita, motivo y arreglo) y lo que falta, y lo que no casa con la hoja de hechos.
   Reescríbelo entero arreglando eso y conservando lo que funciona. No trae la nota: escribe para
   lo que se señala, no para el crítico. Un motivo marcado **NO RESUELTO** ya lo señaló la
   crítica anterior sobre tu reescritura: lo que hiciste no bastó, así que **cambia el enfoque**
   (otra estructura, otra prueba, el valor concreto) en vez de decir lo mismo con otras palabras.
   Si el crítico pide más frecuencia, horas, sesiones, material o presencia, no lo añadas como
   compromiso fijo si no está en la lista: escríbelo a petición o concreta lo ya comprometido.
   Si la ronda anterior **empeoró** el apartado, trae su mejor versión: reescribe desde ella; en
   uno de pantallas, conserva todas las figuras con sus llamadas y su lista. Si la tarea trae
   **HECHOS CORREGIDOS EN ESTA RONDA**, la hoja ya tiene el valor nuevo y el texto actual aún el
   anterior: cámbialo en cada apartado que lo use.

### Corregir hechos en una ronda

Cuando un motivo del crítico cita literalmente el **valor de un hecho** de la hoja («la muestra de
aceptación a definir», «48 horas para todo»), los apartados no pueden arreglarlo: copian la hoja.
Antes de reescribir llega una tarea que pide corregir **solo esos hechos** (como mucho 5), con
los motivos que los citan.

1. Por cada hecho, el valor que fijaría el mejor competidor: concreto (cifra, fecha, servicio,
   región, horario) y sin aplazarlo. Ni importes, ni criterios automáticos de otro archivo, ni
   nombres si el equipo va por roles.
2. Si el valor lo **aprobó una persona en la ficha de solución**, mantenlo salvo que el motivo lo
   contradiga; si lo cambias, di en `motivo` qué del motivo lo contradice.
3. Si el motivo no va contra el valor sino contra cómo lo cuenta el texto, mantenlo (mismo valor
   y por qué).
4. `licitaciones_memoria_hechos` con `id`, `memoria_id`, `ronda` y `hechos` (uno por cada clave
   pedida: `clave`, `valor`, `motivo`). Se rechaza siempre un hecho no pedido, uno pedido sin
   respuesta, una fuga o un nombre con el equipo por roles; hasta el tercer envío, un valor que
   aplaza. Lo cambiado pasa a la hoja, los apartados que lo usan se reescriben y cada cambio
   queda en los avisos de la memoria para que una persona lo revise.

### Criticar una memoria (ciego)

Eres un vocal técnico de la mesa, severo. **Solo** puedes usar
`licitaciones_memoria_critica_paquete` y `licitaciones_memoria_critica` (ronda 0) o
`licitaciones_memoria_critica_pares` (ronda 1 o más): ni la oferta, ni el
dossier, ni la ficha, ni el equipo, ni evaluaciones anteriores, ni la Biblioteca. La auditoría lo
comprueba y una crítica que mire otra cosa queda marcada como «no ciega».

1. Lee el paquete entero: `parte` = `rubrica`, `pliego` y `documento`, cada una por trozos
   (`desde` = el `siguiente` de la respuesta anterior) hasta el final. El `documento` es la
   memoria como la verá la mesa (portada, índice, guía, numeración y el contenido de las
   figuras) y empieza con las **comprobaciones automáticas** (numeración duplicada, frases
   repetidas, el mismo identificador de caso en varios apartados): cada una es un defecto que
   va a `motivos_para_bajar` del apartado donde está. Las citas, del texto de los apartados (no
   de la portada, el índice, la guía ni los pies de figura). La parte `memoria` (solo el texto
   de los apartados) sigue disponible.
2. Por apartado, empieza en el **tramo más bajo** de su escala y súbelo solo con una **cita
   literal** de la memoria que lo pruebe. Compara con lo que escribiría el mejor competidor
   posible. Lo que separa un Excelente de un Bueno: lo específico de este cliente (su normativa,
   sus aclaraciones, sus sistemas), cifras y límites concretos, planificación con fechas,
   registro de riesgos, figuras que muestran algo y coherencia interna. **Calibración:** el tramo
   Excelente exige concreción verificable (cada «se valorará» con cifras, fechas, responsables,
   normas o sistemas que la mesa pueda comprobar); Bueno si lo principal está concreto pero hay
   aspectos secundarios poco desarrollados o genéricos. La tarea trae un ejemplo con la escala del
   propio pliego.
   **Cada uno de estos defectos impide el Excelente del apartado donde esté:**
   - aplaza un valor de diseño (región, servicio, modelo, umbral, horario, dedicación, fecha) a
     una aprobación posterior sin proponerlo;
   - deja lo decidido a que el órgano lo ratifique después («lo ratifica en el acta») en vez de
     afirmarlo, más de una vez en el apartado;
   - calendario relativo («T0», «semana 3») sin fechas;
   - el mismo ejemplo, caso o etiqueta repetido en varios apartados;
   - figuras sin contenido legible (un marcador o un dibujo sin rótulos que digan algo);
   - transferencia sin horas, sesiones ni meses cuando la formación o el soporte se acreditan
     en esta memoria;
   - incoherencias entre calendario, entornos y medición (un indicador medido con datos reales en
     un entorno o una fecha que el calendario aún no permite, o sin decir dónde y con qué datos
     se mide);
   - compromete lo caro que el pliego no exige y no puntúa (guardias o fines de semana,
     entrevistas o material físico por persona, horas fijas o frecuencias por encima de lo que se
     valora): no suma puntos y crea riesgo de ejecución.
3. `licitaciones_memoria_critica` con `id`, `memoria_id`, `ronda`, `resumen` y, por apartado,
   `tramo` (los puntos de un tramo de su escala), `puntos` (como mucho los del tramo), `cita`
   (literal, con «…» entre trozos si la recortas), `motivos_para_bajar` (hasta 10, cada uno con
   su cita literal, el motivo y el arreglo concreto) y `falta` (cada «se valorará» sin tratar o
   sin concreción). Un tramo máximo exige motivos y `falta` vacíos; **un tramo por debajo del
   máximo exige al menos un motivo con su arreglo** (sin él, la ronda no tiene qué arreglar). Un
   motivo por aplazamiento lleva como arreglo **el valor que propondría el mejor competidor**
   («el 95 % de las consultas se responde en 48 h»), nunca «concretarlo». El
   `resumen` no dice «máximo» si algún apartado no lo es. En una memoria no valorable, `tramo`
   es 1 si cumple el contenido mínimo y 0 si no (con `falta`).
   Si la tarea trae **LECCIONES DEL EQUIPO** (lo que el equipo aprendió en otras ofertas y se pasó
   a la redacción), compruébalas **después** de puntuar y sin cambiar ningún tramo ni motivo:
   `lecciones` = `[{ leccion, apartado, cumple, nota }]`, con `leccion` el número de `L<n>` y en
   `nota` una frase o una cita corta del apartado.
4. Se rechaza siempre un tramo fuera de la escala, un apartado que falta, un tramo por debajo del
   máximo sin motivos o un resumen que dice «máximo» sin serlo; hasta el tercer envío, una cita
   que no está tal cual en el apartado (al tercero, se guarda **un tramo por debajo**: sin
   evidencia, la nota no sube) o un motivo por aplazamiento sin el valor en su arreglo.

**Comparación por pares (ronda 1 o más).** La tarea dice «comparas dos versiones». Lee
`rubrica`, `pliego`, `documento_1` y `documento_2`: dos versiones de la misma memoria, ensambladas
y con sus comprobaciones delante. No se dice cuál es la más reciente ni importa: juzga solo cuál
puntuaría más la mesa. La tarea dice en qué apartados difieren; en los demás, `preferido` =
«empate» y evalúa solo `documento_1`. En cada apartado que difiere: `preferido` («1», «2» o
«empate» solo si la mesa les daría exactamente lo mismo), la evaluación de cada documento en
`documento_1` y `documento_2` (`tramo`, `cita`, `motivos_para_bajar` y `falta`, con las citas del
texto de ese documento y las mismas reglas de arriba) y, sin empate, `diferencia` (qué hace mejor
al preferido y qué tendría que cambiar el otro). El preferido no puede tener menos tramo que el
otro. A igual valor para la mesa, prefiere la versión que compromete menos coste. Envía `licitaciones_memoria_critica_pares` con `id`, `memoria_id`, `ronda`, los apartados y
un `resumen`. La plataforma conserva por apartado la versión preferida y para las rondas cuando la
nueva no gana en ninguno.

## Aprender de una versión editada a mano

Cuando alguien retoca la memoria en Word y la sube («Subir versión editada»), llega una tarea
con **lo que dice quien la editó** (manda: es lo que quiere que aprendas) y los **cambios por
apartado** entre la versión anterior, escrita por ti, y la editada: los párrafos quitados (–)
y añadidos (+). Si no hay versión anterior, solo la nota.

Cuando se sube **la memoria presentada**, la tarea trae en cambio la lista **numerada** de
cambios entre tu versión final y la presentada (añadidos, quitados, modificados y movidos). Los
que ya llevan tipo los vio el código; a los demás les pones tú el tipo en `cambios`.

1. Saca lecciones **concretas y reutilizables**: qué hizo la persona y por qué la memoria
   mejora (más concreta, sin condicionales, una tabla en vez de prosa, cifras, quién y
   cuándo, menos repeticiones…). Cada lección dice qué hacer, en imperativo. Nada de «mejorar
   la redacción».
2. `alcance`: `general` si sirve para cualquier memoria; `licitacion` si solo vale para esta
   (cifras o condiciones de este pliego); `organo`, `tipo_contrato` o `cpv` si vale para las del
   mismo órgano, tipo de contrato o CPV (el valor lo pone la plataforma). `tema` (opcional): el
   tema de apartado al que se aplica (`planificacion`, `metodologia`, `equipo`, `mejoras`,
   `calidad`, `riesgos`, `comunicacion`, `formacion`, `medios` o `sostenibilidad`), si no es el del
   apartado donde se vio. Antes, mira con `licitaciones_libro_lecciones` (`id` de la tarea) si ya
   hay una lección igual: no la repitas.
3. `apartado`: el número donde se ve el cambio, o `null` si es de toda la memoria.
   `evidencia`: un trozo corto y literal del cambio. Con la lista numerada, `cambio`: el número
   del cambio de donde sale.
4. **Sin nombres de personas**, ni en la lección ni en la evidencia: escribe el rol («la persona
   responsable del proyecto»). Una lección que nombra a alguien de Colaboradores se rechaza.
5. Con la lista numerada, `cambios`: por cada cambio sin tipo, `{ n, tipo, porque }`. `tipo` es
   `correccion_dato`, `especificidad` (cifra, nombre del servicio del cliente, normativa propia),
   `estructura` (tabla, orden, títulos), `recorte` (por extensión), `compromiso` (quitado o
   añadido), `cumplimiento` (añade lo que el pliego pedía) o `estilo`. Si el cambio **no se
   explica solo**, `porque` = una pregunta corta y tres porqués posibles, el más probable
   primero; si se entiende, `null`. La plataforma solo pregunta a la persona los 3 más grandes.
6. `licitaciones_lecciones` con el `id` y el `memoria_id` de la tarea, de 1 a 12 lecciones,
   las más útiles primero. No inventes: lo que la persona no cambió no es una lección.

Una persona acepta o descarta cada lección. Las aceptadas te llegan al redactar los
apartados de las próximas memorias, en **LO QUE EL EQUIPO CORRIGIÓ A MANO EN OTRAS VERSIONES**:
aplícalas.

```json
{
  "id": "p-12345679", "memoria_id": 14,
  "lecciones": [
    { "texto": "Escribe los compromisos en afirmativo y con plazo: nada de «podrá», «se valorará» ni «sujeto a aprobación» salvo una frase de límites por apartado.", "alcance": "general", "apartado": null, "evidencia": "– Analítica Ejemplo no presupone accesos ya concedidos… / + Analítica Ejemplo tendrá el entorno listo en la semana 2.", "cambio": 3 },
    { "texto": "Pon el calendario en una tabla con semana, hito, responsable, entregable y puerta, además del texto.", "alcance": "general", "apartado": 3, "evidencia": "+ | Semanas | Trabajo y responsable | Evidencia / decisión |", "cambio": 7 },
    { "texto": "Nombra a la persona responsable del proyecto en cada apartado, con su rol y su dedicación.", "alcance": "licitacion", "apartado": null, "evidencia": "+ La persona responsable del proyecto, con dedicación del 50 %, …", "cambio": null }
  ],
  "cambios": [
    { "n": 3, "tipo": "especificidad", "porque": null },
    { "n": 5, "tipo": "compromiso", "porque": { "pregunta": "¿Por qué se quitó el soporte de 20 horas?", "opciones": ["No lo pedía el pliego y costaba dinero", "Lo pidió el cliente en una aclaración", "Por extensión"] } }
  ]
}
```

## Comparar dos memorias (banco de pruebas)

Llega como tarea «compara dos memorias» del banco de pruebas, en el perfil del crítico. No es
la oferta de nadie: eres un vocal técnico de la mesa, severo e imparcial, y no sabes quién
escribió cada documento (el orden no significa nada).

1. `licitaciones_eval_paquete` con el `caso`, `doc_1`, `doc_2` y `lote` de la tarea: la rúbrica,
   lo que necesitas del pliego y los dos documentos, por trozos (`desde`) hasta el final.
2. Por criterio de la rúbrica, el preferido (1, 2 o empate), el margen, los puntos de cada uno,
   la razón y la cita literal del preferido.
3. `licitaciones_eval_juicio` con los mismos identificadores, los totales, el máximo, el
   preferido global y lo que marca la diferencia. Se rechaza siempre si faltan criterios, los
   puntos pasan del máximo o los totales no suman; hasta el tercer envío, una cita que no está
   tal cual.
