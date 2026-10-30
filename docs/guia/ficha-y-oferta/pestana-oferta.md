# La pestaña Oferta

En la pestaña Oferta se prepara lo que se va a presentar. El asistente pregunta las decisiones que faltan, y las
comprobaciones dicen en cada momento qué impide presentar, qué es un riesgo y qué está listo.

<!-- captura: oferta · La pestaña Oferta con el asistente y el veredicto de las comprobaciones -->

## Asistente de la oferta

**Asistente de la oferta**, en la pestaña Oferta. Hermes pregunta una a una
las decisiones que faltan para redactar los documentos, por este orden: lotes (si nadie los ha
elegido), quién va en cada rol que exige el pliego, el precio de cada lote, si nos acogemos a
cada criterio automático (y a qué tramo), los datos que pide el anexo (subcontratación, impuesto,
orden de los lotes) y el enfoque de la memoria. Salen por código de lo que las comprobaciones dan por
pendiente: no pregunta lo que ya se sabe por la ficha o por lo decidido, y un criterio marcado
sin con qué acreditarlo vuelve a preguntarse. Cada pregunta cita el pliego y trae respuestas
rápidas con opciones reales: personas de Equipo con lo que les falta («docencia: 90 de 150 h»),
precios con su baja y el umbral de anormalidad, los tramos del criterio, sí o no.

- Una respuesta rápida se guarda al momento en su sección de las decisiones, sin IA. El precio
  se escribe o se elige siempre por código (el importe nunca llega a Hermes); un precio por
  unidad con una sola línea («alumno») se pregunta aquí y, con varias líneas, se fija en su fila de la Revisión.
- **«Hay que contratarlo»** repregunta: si el pliego no obliga a nombrarlo, cuándo habría que
  acreditarlo si nos proponen (la cláusula de «Si nos proponen» o, si no, 10 días hábiles del art.
  150.2 LCSP, con la fecha estimada) y si se compromete como «<rol> a incorporar». Queda en las
  decisiones, en la memoria y el anexo de medios, y en Equipo › A incorporar.
- Un texto libre lo lee **Hermes** (trabajo de cola, el primero) y enseña lo que entiende para
  confirmarlo o descartarlo; nada se guarda sin confirmarlo.
- A la derecha, **Lo que hay que decidir (N de M)**: se puede volver a cualquiera y cambiarla; si
  ya estaba decidida, «Qué cambia» enseña antes qué se rehace. Debajo, lo que generará **OK,
  generar los documentos** por sobres («Se generará» o «Generado»): se activa con todas las
  decisiones y pide ya la memoria, los anexos y el DEUC, que se dejan en la carpeta de la
  licitación.

## Estado, filas y detalle de la oferta

**Estado, filas y detalle de la oferta**: las comprobaciones se reparten entre la Oferta y la
Revisión. El botón de la cabecera lleva a la primera fila, en
la Revisión.

- **Arriba**, en la Oferta y en la Revisión, el veredicto que da el servidor (No presentable,
  Faltan decisiones, Hermes trabajando, Presentable con riesgos, Lista para firmar o
  Descartada), el plazo (con la hora de Canarias si la empresa está allí), el cierre interno, los lotes y
  **Hermes en vivo**: una línea por trabajo con su nombre, su sitio en la cola, la hora
  estimada en intervalo, el último fallo en palabras, el tope de runs del día y lo que lo
  frena; si la cadena está frenada por un bloqueo de elegibilidad, lo dice («Hermes no redacta
  la memoria ni los anexos hasta que decidas: …») con un enlace a cada fila. «Relanzar»
  solo sale cuando un run pasó lo normal sin avanzar. **Siguiente tarea →** salta a la
  siguiente oferta que te espera (la de la Mesa más urgente).
- **Qué impide presentar**, en la Revisión (descartada o por decidir con prisa, en la Oferta,
  con «Recuperar» o «Preparar la oferta» / «Descartar con motivo»): las filas abiertas, agrupadas
  y en el orden fijo de las comprobaciones, cada problema una vez, con lote, quién la mueve, la cita del
  pliego desplegable (abre el pliego en su página si está bajado) y sus botones. El botón de dato
  abre en la Oferta el apartado del detalle donde se arregla, con el foco en el campo; «Vamos»,
  aceptar un riesgo y descartar piden un motivo de una frase (15 caracteres como mínimo), y lo
  que impide presentar no se acepta como riesgo. El guion se valida por código: si sus puntos
  no suman los que reparte el pliego en un lote, o la memoria valorable va en el sobre del precio,
  impide; una fórmula de precio que no es de un tipo conocido sale como riesgo, con su cita, y
  no como «impide»: lo que impide no se puede aceptar y
  obligaría a forzar el registro por algo que no es un error de la oferta, sino que el código
  no sabe leer esa fórmula o el pliego no la da. Se lee en el pliego y se acepta con un motivo. Un
  apartado de la memoria que copia literal más del 30 % de una memoria presentada a otro órgano
  sale como riesgo, con el órgano y el expediente de donde viene. Si el crítico ciego da a la
  memoria menos del 70 % de los puntos de juicio de valor, es un riesgo con la nota y su margen
  («entre 28 y 32 si la mesa baja un tramo en cada apartado»). El precio de un lote se fija en la propia fila,
  con la baja y el umbral en vivo. Debajo, **Lo que Hermes comprobó** (plegado) y **lo que no
  pudo comprobar** (abierto, con «Lo he comprobado» fila a fila).
- **Detalle de la oferta** (Guion, Decisiones, Equipo, Memoria y Documentos), en la Oferta
  debajo del asistente, un apartado a la vista. Cerrarlo no pierde lo
  escrito y, con cambios sin guardar, cambiar de apartado, cambiar de pestaña
  de la ficha, ir a otra sección del menú, «Siguiente tarea» o cerrar la pestaña piden
  confirmación. Decisiones guarda **cada sección sola** (precio,
  equipo, criterios automáticos con su valor y los puntos estimados, herramientas, enfoque y
  lotes): un problema en el equipo no impide fijar el precio. Documentos va en tarjetas por
  archivo y lote con el estado que da la verificación, no un desplegable. Memoria gana
  «Volver a esta versión» en el historial, y las fugas anuladas se heredan si la frase no cambió.
- **Qué cambia**: antes de guardar una decisión, los lotes, el perfil de empresa o «Volver a
  extraer el guion», un panel dice qué se rehace, qué solo se marca, qué se pierde y qué sigue
  valiendo, con su coste en minutos y runs, y tres botones: «Guardar y rehacer lo afectado»,
  «Guardar y solo marcarlo» y «Cancelar». Si todo se regenera por código y cuesta 0 runs, se
  guarda directamente con un aviso en línea; si el cálculo falla, no guarda a ciegas: pregunta
  si guardar y marcarlo todo para revisar. **Deshacer el último cambio** enseña su propia vista
  previa y no encola nada.
- **Pie**: el paquete de presentación y su registro, una sola vez. «Registrar» se apaga
  mientras haya una fila que impida presentar; registrar igualmente exige un motivo, que queda
  guardado con la propuesta (`forzar_motivo`). Una oferta descartada se ve en solo lectura
  («Descartada el lun 12 oct por falta de encaje: …»), con «Recuperar» como único botón.
  Descartar desde la web pide siempre el tipo de motivo y unas palabras.
- **Telemetría**: la web mide cuánto tiempo con foco pasa cada fila hasta cerrarse (sin
  textos: clave, tipo de acción y milisegundos) para comprobar el objetivo de 10-20 min por
  oferta y recalibrar los minutos estimados con la mediana real; `GET
  /api/licitaciones/telemetria/resumen` lo resume.
- **Presentación**: en lo ya presentado (presentada, ganada o perdida) no hay comprobaciones; la pestaña
  **Presentación** junta la memoria (para subir la que se entregó), el registro de lo presentado
  con su resultado y puntuaciones y las propuestas anteriores parecidas. Todo lo de antes de
  presentar vive en la Oferta y la Revisión.
- **Revisar lo que hizo Hermes**, una sección de la Revisión
  bajo los sobres (`GET/POST …/oferta/revision`) con una tarjeta por cosa que una
  persona debe aceptar o descartar: la propuesta de decisiones, la memoria, cada anexo, la guía
  del DEUC y la revisión previa del paquete. Abrir una tarjeta la marca como vista («nuevo para
  ti» se apaga); cerrarla vale para toda la oferta y, si su contenido cambia, se reabre.
  Descartar pide motivo en un diálogo de la app; aceptar vive en cada tarjeta, porque cada una
  aplica lo suyo:
  - **Propuesta de decisiones**: lo guardado frente a lo que propone Hermes, campo a campo, con
    «Aplicar» por fila (por ejemplo, cambiar solo el plazo del soporte es un clic y la fila pasa a
    «Sin cambios»). Lo aplicado queda con quién lo propuso y el motivo de Hermes aparte de la
    nota de la persona; nunca el precio. Las filas de acreditación se aplican de una en una (son
    una declaración) y una propuesta de otro guion no se aplica: Hermes la rehace.
  - **Memoria**: lo único que hay que leer de ella. La hoja de compromisos con lo que choca con
    las decisiones, el pliego o los anexos; hasta 5 párrafos marcados con su texto en cada ronda;
    la nota del crítico ciego con su margen (la autoevaluación del propio redactor infla la nota 6-8 puntos, así que no
    se enseña como nota, tampoco en el paso Memoria) y lo comprobado. **Dar por buena** dice antes
    qué se acepta (páginas, avisos, apartados sin redactar) y, si queda algo marcado o hay fugas,
    pide motivo; **Descartar** va aparte y con confirmación. Cada apartado rehecho por un cambio
    tardío se lee como diff palabra a palabra (lo quitado tachado, lo puesto subrayado) con
    «Aceptar el cambio» (no escribe: entra al darla por buena) y **Mantener el anterior**, que
    vuelve a poner el de la base y monta la versión sin IA (0 runs).
  - **Anexo**: el borrador en una columna legible con cada valor que puso Hermes resaltado (el
    dato de la hoja del que sale, al pasar el ratón), lo cambiado frente a la versión anterior
    con borde de aviso y los avisos arriba. Se acepta sin abrir el Word y
    queda «preparado».
  - **Guía del DEUC** (`DEUC_GUIA.md` en Salidas, 0 runs): los tres pasos (descargar `Deuc.xml`,
    importarlo en el servicio DEUC, rellenar con la guía) y la guía campo a campo con lo que falta
    escrito «FALTA: …», nunca inventado ni con importes. «Preparar de nuevo» escribe otra versión
    sin pisar la anterior. Es lo que acorta el DEUC mientras `LICITACIONES_DEUC_XML` siga apagado.
  - **Revisión previa** del paquete: tras cada versión del paquete, Hermes lee las comprobaciones y propone
    con citas literales cómo resolver los bloqueos que sabe resolver, deja `REVISION_PREVIA.md`
    junto al paquete y nunca aplica nada; «Ir a la fila» lleva a la fila, donde una persona la
    aplica o la descarta. Va sola una vez por versión del paquete (gasta cuota) y nunca con el
    freno de elegibilidad puesto; `POST …/oferta/revision-previa` la pide a mano.
- **Actualizar los apartados afectados**: tras un cambio de equipo o de lotes, «Qué cambia» dice
  qué apartados de la memoria nombran lo cambiado y lo que cuesta rehacerlos (una redacción de
  esos apartados más su crítica, unos 90 min como mucho); al guardar, el botón **Actualizar los
  apartados afectados** crea la versión siguiente (`POST …/actualizar-afectados`), que rehace
  exactamente los apartados que «Qué cambia» cobró (los que nombran el cambio): conservan su
  texto y cambian solo lo que depende del cambio; cada apartado rehecho llega a la tarjeta de la
  memoria con su diff. Hermes no rehace una versión subida a mano (un Word o un PDF): sus
  apartados salen «para revisar», sin coste, el botón no sale y el cambio se corrige en ese
  documento (o se pide una memoria nueva). Una montada sin dossier ni estrategia
  sí sirve de base: la versión nueva compone el dossier y pide la estrategia antes de redactar.
  Nunca mira el precio. Los paneles de Decisiones y de Lotes pasan la oferta y el cambio al
  panel, y la tarjeta de la memoria deduce sola lo cambiado desde que se pidió
  (`GET …/memoria/:version/afectados`, sin escribir) y ofrece el mismo botón. La memoria
  **presentada** y las de ensayo no se rehacen (tampoco cuentan en «Qué cambia»); con una memoria
  por lote, «Qué cambia» mira la última de cada lote.
- **Nueva versión** (`POST …/oferta/memoria/:version/mejorar`): la misma acción con las
  indicaciones de quien lleva la oferta («¿Qué quieres que cambie?», mínimo 10 caracteres), que
  mandan sobre la evaluación, pero para **mejorar**: cada apartado elegido se reescribe para su
  tramo máximo con lo que dijo la evaluación de la base (justificación, tramo, sugerencias y
  párrafos genéricos), en vez de conservar su texto. Sin apartados elegidos rehace los que la
  evaluación señala como mejorables; sin indicaciones hace falta la evaluación de la base.
- **Una ronda que pide Hermes** (`licitaciones_pedir` con la fase `ronda_memoria`, sobre una
  `version` base evaluada): crea la misma versión de mejora con el `motivo` de Hermes como
  contexto (no como indicaciones de la persona; un agente no puede mandar indicaciones) y
  devuelve el trabajo de redacción de la fase, o 0 si aún no se encoló. Ni la ronda ni la
  memoria que pide la cadena sola levantan el freno de su tipo en ninguna de sus fases. Pasa por el freno de elegibilidad, el tope de runs del día y la guardia de plazo; un
  agente no puede confirmar un aviso de plazo.
- **Memoria por lote**: si el pliego exige una memoria específica por lote (por ejemplo,
  lotes 2 y 4), Hermes redacta una por cada lote decidido, cada una solo con las decisiones, los
  automáticos y el equipo de su lote; la versión sigue siendo de la licitación (v5 · lote 2,
  v6 · lote 4). En la web, el paso Memoria tiene una sección «Memoria del lote N» por lote (con su
  historial y «Empezar desde cero») y un solo botón, **Redactar las memorias (una por lote)**; la
  checklist, las comprobaciones y el paquete exigen la de cada lote (y su Anexo VI) y avisan del lote que
  falta. La **memoria presentada** también es por lote: subir la del lote 4 no toca la del lote 2,
  la oferta solo se da por cerrada cuando todos los lotes a los que vamos tienen la suya (o hay una
  común), y la Revisión no sugiere nada sobre lo entregado de cada lote.
  «La memoria de la oferta» de cada lote es su presentada y, si no hay, su última no de ensayo.
- **Equipo sin nombres**: si el pliego pide CV anonimizados, la memoria no puede nombrar al equipo
  en ninguna versión (redactada por la plataforma o subida): guardar un apartado que lo nombra devuelve error y las
  comprobaciones lo marcan; el paso Memoria dice qué apartados y cuántas personas (`memoria-anonimato`). Las
  comprobaciones marcan también la memoria que se pasa del límite de páginas y, cuando se pide por roles,
  la que nombra al equipo.
- **Enfoque opcional y «no prometer»**: el enfoque de las decisiones nunca es obligatorio:
  Hermes hace su estrategia desde el pliego; la persona añade solo lo que quiera, en positivo, y Hermes propone una lista de **«no prometer»** (hasta 10,
  con motivo) que se ve debajo del campo. Al guardar, nombrar un criterio de otro sobre en el
  enfoque se rechaza siempre y prometer algo de «no prometer» da un aviso.
- **Memoria que se actualiza**: el dossier guarda una huella por sección (equipo, herramientas,
  empresa, criterios de otros sobres, lotes y plazo). Si algo cambió, la tarjeta de la memoria dice
  «Cambió desde esta versión: … Afecta a los apartados 2 y 4; el resto se mantiene» y **Actualizar
  los apartados afectados** crea la versión siguiente: copia literal los apartados no
  afectados (con sus ediciones a mano) y rehace solo los afectados, sin volver a pedir dossier ni
  estrategia. Si nada depende de lo cambiado, lo dice: la memoria sigue valiendo.
- **Biblioteca por carpeta**: el panel de la Biblioteca filtra por carpeta.
- **Tabla de apartados de la memoria**: en la tabla de apartados del paso Memoria, **Ver texto** enseña lo
  redactado sin descargar el Word ni salir de la Oferta, con la ronda en que va y cuántas veces
  lo rechazó el revisor (un rechazo es un reintento, en gris; solo el fallo va en rojo). Desde
  una fuga o desde «Otra ronda con estos motivos», **Pedir cambios** llega precargado con los
  apartados y la cita de cada fuga.
- **Equipo**: arriba del apartado, la matriz rol exigido × persona (`GET …/oferta/equipo/matriz`):
  cada rol que pide el pliego es una fila con sus materias y su página, y cada persona asignada
  lleva ✓, ✗ o «no comprobado» por materia con su fuente (Colaboradores o, con **Buscar en los
  CV**, la Biblioteca). Se asigna a alguien desde la fila de su rol; lo asignado se ve «pendiente
  de guardar» hasta guardar la sección. Una ✗ enlaza a la ficha de la persona en esa materia
  (`#/equipo/<id>#campo=compostaje`): si su CV la menciona, la ficha dice en qué página y se
  añade a su experiencia con un clic (solo se lee el CV de esa persona).
- **Datos de anexo** (apartado Decisiones): lo que un anexo pide y el pliego no fija (si se
  subcontratan los servidores, el orden de preferencia de los lotes, el impuesto y su tipo) es
  una sección propia de las decisiones, con la cita de lo que lo pide; las comprobaciones lo dejan en
  riesgo hasta cinco días antes del plazo y la hoja de datos usa lo decidido.
- **Si nos proponen** (apartado Guion): lo que el pliego pide solo al propuesto como adjudicatario
  (protección de datos, confidencialidad, garantía definitiva…), con su cita; no va en la
  checklist de la presentación.
- **Reutilizar un documento** (apartado Documentos): en la tarjeta de un documento sin preparar,
  usar el certificado vigente de la carpeta Empresa o el que entregamos en una oferta anterior.
  Se copia a Salidas de la oferta sin pisar nada y la fila queda en borrador hasta que una
  persona lo da por bueno; un certificado de acreditación se revisa uno a uno y nunca se
  reutiliza uno caducado. Lo propio de esta oferta (memoria, oferta económica, DEUC, modelos del
  pliego) no se reutiliza.
- **Kit de firma** (pie, con el paquete vigente): las carpetas por lote y sobre con sus archivos
  en el orden de subida, firmar todo de una vez con AutoFirma, `VALORES_A_TECLEAR.md` al lado, el
  enlace a la PLACSP y «Abrir en Drive» una sola vez; INSTRUCCIONES.md dice en positivo lo que el
  código comprobó y lo que no puede comprobar. Firmar y subir lo hace siempre una persona.
- **Lo que promete la memoria**: una fila de riesgo en las comprobaciones (y la misma en la Mesa y
  el MCP) cuando la memoria ensamblada promete algo que no cuadra con las decisiones, el pliego o
  los anexos: una persona que no está en el equipo, un plazo distinto del del guion, un criterio
  automático al que no nos acogemos, lo que Hermes dijo no prometer o un dato distinto del anexo.
  Nunca impide presentar.
- **Compromisos que cuestan dinero** (por ejemplo, una memoria que promete un kit a cada alumna, 3,5 h
  fijas por subgrupo y semana o una entrevista con cada alumna apta: cientos de horas que el pliego no
  pedía). El servidor lee la memoria con patrones (sin Hermes, sin runs) y, por
  cada compromiso con una cifra o una frecuencia, calcula su coste en horas y euros con el
  alcance del guion, el pliego y los costes internos, y lo coteja con el PPT y el PCAP: «Lo pide el
  pliego» o «Añadido por nosotros» (con el criterio que lo puntúa, si lo hay). En la Revisión, cada
  añadido caro es una fila de riesgo (nunca impide presentar, pero sí «Lista para firmar» hasta que
  se arregla o se acepta con motivo) con el chip de coste, «De dónde sale la cifra», la forma más
  barata y **Suavizar**: una ronda de memoria que sustituye la cita por la formulación barata sin
  añadir compromisos que el pliego no pide. Con dos o más, arriba van el total de los añadidos
  y **Suavizar todos** (una sola ronda por memoria); si los añadidos suman la mitad del presupuesto
  base o más, una fila de total lo avisa. «Dar por buena» pide motivo si queda uno caro, y el
  resumen de la memoria trae la tabla de compromisos con su coste. La Mesa (`licitaciones_mesa`) avisa «Revisa los
  N compromisos caros (~X h) antes de …», con la hora hasta la que aún da tiempo a otra ronda, y
  «Ya no da tiempo» si pasó. Sin pliego legible todo sale «Sin cotejar con el pliego». Los
  euros solo se ven en la web: Hermes lee horas y un nivel (bajo, medio, alto) con
  `licitaciones_compromisos` y `licitaciones_mesa`, nunca euros.
- **Costes internos** (Ajustes › Empresa, bloque aparte con su propio «Guardar costes»; API
  `/api/plataforma/empresa/costes`): €/h (por defecto `LICITACIONES_PRECIO_HORA`, o 25), material y
  envío por persona, tamaño del subgrupo, horas por informe, plazo de referencia y los umbrales de
  lo que es caro (15 h; max(300 €, 2 % del presupuesto del lote); total del 50 %). Va aparte del
  perfil de la empresa para que nunca llegue a un agente.
- **Subir un pliego que falta** (Expediente, `POST …/pliegos`, hasta 60 MB): lo que la PLACSP no
  dejó bajar, o una rectificación, va a la carpeta de pliegos de Conocimiento; la Biblioteca lo
  indexa, el expediente dice quién lo subió y, si rectifica, la ficha se rehace sola. Las carpetas
  de pliegos y de la oferta se abren desde la cabecera de la ficha («Drive: pliegos», «Drive:
  oferta»).
- **Carpeta Empresa** (Ajustes › Empresa, debajo del perfil; API
  `/api/plataforma/empresa/documentos`): certificados, ROLECE, AEAT, TGSS, títulos y CV con horas
  desglosadas que valen para cualquier oferta, con su caducidad (presentar uno caducado excluye la
  oferta); la barra lateral avisa en Ajustes de lo caducado o a punto de caducar y Hermes lo ve en `plataforma_empresa`.
