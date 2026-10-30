# Hermes y los agentes

Qué hace la IA, cómo trabaja, con qué herramientas y dónde se ve lo que está haciendo. Hermes solo propone: una
persona decide. Cómo se mantienen sus perfiles y su cola en el servidor está en [Operar](../operar/README.md).

<!-- captura: actividad · La Actividad de Hermes con sus capacidades alrededor y el feed de acciones -->

## Actividad

Qué hace Hermes en la sesión elegida en la barra lateral, en vivo y
con lo ya ocurrido. El selector trae también las sesiones de cada perfil (las 30 últimas de
«Licitaciones», «Oferta licitaciones»…: criba, fichas, guiones, memorias), con el perfil
delante del origen:

- **Estado:** siempre a la vista si Hermes está trabajando (verde, con cronómetro
  desde tu petición; «Pensando…» cuando espera al modelo entre acciones) o en reposo
  (gris, con cuándo terminó). Se deduce de la propia actividad: un turno sigue
  abierto hasta la respuesta final de Hermes, o hasta 15 min sin movimiento.
- **Gráfico:** Hermes en el centro, rodeado de sus capacidades (Skills, MCP, Web,
  Navegador, Terminal, Código, Archivos, Memoria y Otras). Cada una se ilumina
  mientras se usa, muestra qué ha usado por última vez («google-workspace», «notion
  · search», el comando…) y se marca en rojo si falló.
- **Satélites:** los subagentes y perfiles delegados, con su acción actual.
- **Feed de actividad:** agrupado por petición, con una fila por acción («Skill:
  google-workspace», «Terminal: python …», «MCP notion · search», «Delegar: …»),
  su estado, su duración y el resultado al desplegarla. Se puede filtrar por
  capacidad.
- Los argumentos se recortan y se enmascaran los secretos antes de salir del
  servidor.

## Consola

**Consola** (Hermes). El dashboard oficial de Hermes (chat, canales, modelos, perfiles,
skills, cron, archivos, logs…) sin segundo login.

## Hermes trabaja las licitaciones

**Hermes trabaja las licitaciones** con la skill `licitaciones` (también se instala
sola, en Hermes y en cada perfil) y las herramientas MCP de la plataforma. La skill
va partida por fase: `SKILL.md` es el núcleo (herramientas, principios, carpetas y
estados) y cada fase vive en `references/` (cribar, ficha, guion, decisiones, memoria,
anexos, revisión previa, propuestas y actas, mercado); Hermes lee solo la de su tarea. Al
empezar, lee el veredicto y los bloqueos de la oferta y, con un «impide» de negocio, avisa y
no produce; en la revisión previa propone con evidencia y no aplica.

## Hermes conoce su entorno

**Hermes conoce su entorno** con la skill `entorno` (también se instala
sola): trabaja con las carpetas de Drive en local (`/opt/data/…`) en vez de por la API,
sabe qué son los Google Docs de `.gdocs`, dónde viven las skills de la empresa y dónde
está su orden `hermes`.

## Agentes (MCP)

El monitor es un servidor MCP en `/mcp`: Hermes, sus perfiles y
Claude Code usan las mismas herramientas (buscar y leer en la Biblioteca, proponer
notas, consultar y cribar licitaciones, enviar fichas, leer el perfil de la empresa,
antecedentes de una licitación (ediciones anteriores, quién las ganó e indicios de
licitación con nombre), precios y adjudicaciones parecidas de una licitación o de un segmento, ranking y ficha
de competidores y de organismos, colaboradores y candidatos para un requisito, equipo
propuesto de una licitación, perfiles leídos de un CV, registro de propuestas con sus
estadísticas, borradores y evaluaciones de propuestas, la Mesa y la checklist verificada de
documentos de una oferta, pedir una fase de la oferta o proponer cómo resolver un bloqueo (lo
aplica una persona), lectura de documentos de Salidas (por caracteres, páginas o sección),
estado y actividad de la plataforma —enteros o por
partes—, y los trabajos de la cola de IA por tipo, estado, código del fallo, licitación y
días, por páginas). Los plazos llegan a los agentes en ISO con la zona de Madrid
(«2026-10-15T08:00:00+02:00») y en texto, con la hora de Canarias si la empresa está allí; las rutas de documentos,
con su raíz («Conocimiento/…» o «Salidas/…»), y `biblioteca_leer` las acepta tal cual. Cada
agente entra con su propio token, solo ve las herramientas que puede usar y cada uso
queda auditado.

## Propuestas de la IA

Todo lo que propone un agente (fichas de ayuda, perfiles leídos de un CV, el perfil de la empresa) se revisa igual: quién lo
propone y cuándo, qué trae o qué cambia campo a campo (antes → después) y **Aprobar**
como acción principal, con **Rechazar** aparte.

- **Empresa:** el perfil con lo que la empresa puede acreditar (NIF, clasificaciones,
  volumen de negocio por año, certificaciones, seguro de responsabilidad civil, plantilla
  media, años de actividad, CPV con experiencia, mayor contrato similar de los últimos
  tres años y notas), la **dirección** estructurada (calle, código postal, municipio y
  provincia; de ella se deriva el domicilio de texto que leen los anexos y la hoja de datos),
  los **certificados** (nombre, nivel solo para el ENS —básica, media o alta— y caducidad; de
  ellos se derivan las certificaciones), el **representante** (nombre, NIF y cargo de quien
  firma los anexos) y el **contacto** (correo y teléfono), que van a la hoja de datos de
  la oferta. Al guardarlo se vuelven a evaluar las oportunidades abiertas.
  Un agente (Hermes o Claude
  Code) puede proponer uno completo: sale un aviso con quién lo propone, qué campos cambia
  y de dónde salen los datos, y no cambia nada hasta que alguien pulsa **Cargar en el
  formulario**, lo revisa y lo guarda (o lo descarta).

## Qué hace Hermes solo y cuándo no gasta cuota

**Qué hace Hermes solo y cuándo no gasta cuota** (cola de IA y oferta): la cola ordena por
plazo (lo de una oferta primero, luego la ficha de lo nuevo, al final lo de fondo; lo que pide
una persona sale antes) y reserva un hueco de cada tres lanzamientos a las fichas nuevas. Cada
trabajo pendiente o en marcha muestra su posición, una hora estimada orientativa (sin hora si
hay menos de 5 trabajos parecidos de la semana) y por qué espera: límite de uso, freno,
herramienta desfasada, reintento, tope de la oferta, plazo cercano, perfil sin configurar o
simple cola. No gasta cuota cuando: la cola está pausada por el límite de uso (la pausa
sobrevive a un reinicio); un tipo u oferta está frenado tras fallar sus últimos trabajos (se
reactiva pidiéndolo a mano); una oferta llegó a su tope de 24 h (`LICITACIONES_RUNS_OFERTA_DIA`
runs automáticos, `LICITACIONES_PROPUESTAS_DIA` propuestas; lo pedido a mano no cuenta); la
oferta está en sus últimas horas y solo quedan lecciones; pulsar dos veces lo mismo no encola
dos runs; las comprobaciones tienen un bloqueo de elegibilidad sin resolver (ni memoria ni anexos hasta
que se resuelva, alguien diga «Vamos» o acepte el riesgo de lo no comprobado); un anexo cuyo
dato de la hoja cambió se regenera por código (precio del lote, NIF, domicilio), sin run y en una versión nueva; un guion nuevo que no
toca lo hecho (decisiones, propuesta, memorias, paquete) lo conserva (rebase) y solo desfasa lo
que tocó; y el paquete de presentación desfasado se rehace por código si no hay bloqueos
abiertos (nunca crea el primero; si falla, espera 10 minutos antes de volver a intentarlo).
Con todas las decisiones tomadas, la memoria se pide sola, salvo si ya hay una que sirve: del
guion vigente, en marcha, o de un guion anterior cuyos apartados no cambiaron de sitio (se
mejora rehaciendo solo los que cambiaron.
**Anexos con modelo PDF**: en la vuelta de la oferta la plataforma analiza cada modelo PDF
del guion vigente (5 por vuelta como mucho) y lo clasifica: con formulario, Hermes lo rellena por
campos; sin formulario pero con el tramo del modelo localizado (al menos un hueco y 6 páginas
como mucho; si el guion cita página, gana su tramo), se **transcribe a .docx** y se rellena por
el camino Word, con el aviso «Transcrito del PDF del pliego («…», págs. X-Y): compáralo con el
original antes de firmar.»; una **tabla de requisitos** sin huecos (cabecera «Requisito» y
«Cumplimiento» y al menos 3 filas «N.M …», como un anexo de 31 requisitos) se
convierte en un .docx propio con una fila por requisito y huecos en «Cumplimiento» y
«Evidencia/fuente»; lo escaneado, sin huecos o de más de 6 páginas, «rellénalo a mano» con su
motivo. Mientras se analiza, el anexo dice «Hermes está leyendo el modelo PDF: en un minuto se
podrá rellenar.». Un transcrito se regenera por código (0 runs) como un Word, y la cadena lo
pide como los demás. Un hueco que no sale de la hoja va como «Redacción» con sus fuentes
(documentos que existen) y sale en los avisos para comprobarlo. Si un modelo PDF cambia de
versión de análisis, se reanaliza solo. **Vía alternativa** de un requisito excluyente (el Anexo
XIV frente al ENS): solo cuando las comprobaciones tienen ese requisito abierto (sin «Vamos»); pedirla a
mano responde 409 `via_alternativa` y la web pregunta «¿Pedirlo igualmente?» con el coste; la
cadena nunca la pide. **DEUC** (con `LICITACIONES_DEUC_XML=1`; apagado por defecto): la
plataforma prepara `anexos/DEUC-vN.xml` por código (0 runs, sin precio) desde la petición del
órgano y el perfil de empresa (empresa, representante, lotes decididos y volumen de negocio);
los motivos de exclusión los responde una persona en el servicio DEUC. La fila queda en borrador
con «Quedan N preguntas por responder…» y INSTRUCCIONES.md del paquete dice cuántas; sin NIF o
domicilio, 409 con lo que falta. Cada vuelta saca versión nueva solo si cambia lo que lleva
(petición, empresa, representante, lotes o volumen); si ya estaba «preparado», solo avisa; si
se editó a mano, no se rehace; con un impide de elegibilidad abierto, no se prepara solo. El
.xml solo se descarga como adjunto (`GET /salidas/documento`).
En **Hermes en vivo** (pastilla «Hermes» y ficha de la oferta, `GET
/api/licitaciones/:id/oferta/hermes`) se ve, por oferta, lo que hace ahora, su sitio y hora,
el último fallo y lo que la frena; lo que pidió Hermes con `licitaciones_pedir` (con el freno
de elegibilidad, el tope de runs del día y la guardia de plazo, que un agente no puede saltar)
sale como «pedido por Hermes».

## Estado y programación

**Estado**: arriba, **Programado**: lo que la plataforma hace sola (cola de IA, ingesta
de la PLACSP, criba con Hermes y mantenimiento del radar),
cada cuánto, cuándo fue la última vez y cuándo toca la próxima, si está parado, frenado
o en pausa y por qué, con **Sincronizar ahora** y **Cribar ahora**; y las **tareas
programadas de Hermes** de cada perfil (nombre, qué hace, cuándo, última y próxima vez,
dónde entrega y el último error). Las de Hermes solo se ven: se crean y cambian en el
Panel de Hermes (Cron). Se actualiza cada 30 s. Debajo, cómo va la ingesta de cada fuente, el histórico por año, la reorganización
de carpetas (estado, qué se movió, qué no y por qué, errores, y **Comprobar de nuevo**),
cuántas oportunidades hay por estado, los lotes de criba, las descargas, las fichas y
las carpetas de presentadas. **Pliegos que no se pueden leer** lista los de lo que
seguimos en plazo con su problema. **Fichas de Hermes** enseña las últimas fichas con
su versión, modelo, calidad, dudas, correcciones con nuestros datos, duración, llamadas
y respuestas recortadas, y las medias por modelo: sirve para comparar modelos del
perfil `licitaciones`. En Programado, **Fichas al día** sigue la regeneración de las
fichas antiguas y deja pausarla o reanudarla. Los avisos de la cola nombran cada trabajo
en español («La redacción de la memoria», «Las propuestas de decisiones»…), nunca por su
tipo interno; un fallo por el límite de uso del modelo («HTTP 429: The usage limit…») cuenta
como límite de uso, no como error desconocido.
