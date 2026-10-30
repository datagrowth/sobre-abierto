# La ficha de la licitación

La ficha reúne en una página lo necesario para decidir si nos presentamos: la cabecera con sus tres preguntas y el
go/no-go, con cada requisito del pliego, su estado y la página donde aparece.

<!-- captura: ficha · La cabecera de la ficha con sus tres preguntas y el semáforo de requisitos -->

## Ficha de la licitación

La cabecera lleva el título, el órgano,
el expediente, el procedimiento, los lotes y el importe, el botón del siguiente paso y **tres
preguntas**: **¿Podemos?** (el veredicto de las comprobaciones o, sin ellas, el semáforo de requisitos),
**¿Merece la pena?** (ofertas esperadas y baja esperada con su rango P25-P75, la muestra y la
confianza, de los índices de mercado, y la opinión de Hermes; con confianza baja no da la
cifra: «pocos datos (n = 7)») y **¿Llegamos?** (el plazo peninsular, con la hora de Canarias si la empresa está allí, y
el cierre interno). Las pestañas son siempre las mismas: **Resumen** (de qué va, la
recomendación de Hermes, datos, lotes, pliegos y notas con el estado, y **Preguntar al
pliego**: una pregunta concreta —«¿Piden ENS?»— va a Hermes con prioridad y vuelve con la cita
literal del pliego, «cita comprobada» con su página o «no comprobada», o con «Hermes no lo
encontró en el pliego (no comprobado)» —una ausencia no tiene cita que buscar—, que deja copiar
el borrador de la consulta al órgano; con la oferta en marcha, una
respuesta se pasa a las comprobaciones como riesgo), **Requisitos** (por
áreas: solvencia económica, técnica, certificaciones, perfiles y otros, cada área con su estado
en la cabecera; los excluyentes por confirmar arriba, el filtro por lotes de interés y el
buscador del expediente; cada requisito con la frase literal del pliego que copia Hermes y
**«cita comprobada»** con la página donde está de verdad, o **«cita no localizada»** si no está
tal cual en los pliegos leídos; las filas de la Revisión que salen de un requisito citan esa
frase), **Criterios de valoración** (el reparto de puntos entre juicio de
valor y fórmulas y los criterios de los lotes de interés) y **Mercado** (los índices con su
barra de rango, licitadores probables, el órgano y los comparables del índice; los escenarios
de oferta con nuestra baja, antecedentes y adjudicaciones). Con la oferta en preparación, además
**Oferta**: el asistente que pregunta, que se abre por defecto, con el detalle de la oferta
debajo, y **Revisión**: lo que impide presentar, lo generado por sobre y documento, y el
registro; por revisar con el plazo encima o descartada tras empezarla, solo **Oferta**, con lo que
hay que decidir; en lo presentado, **Presentación**. Las comprobaciones (veredicto, filas y Mesa)
se reparten entre esas pestañas. Estas direcciones alternativas también valen: `…/preparacion`
y `…/comprobaciones` abren la Oferta, y `…/comprobaciones#bloqueo=…` o
`…/comprobaciones#testid=…` (la Mesa, Hermes) la Revisión en esa
fila o pieza; `…/expediente` los Requisitos y `…/pliegos` el Resumen.

## Ficha y go/no-go

Un semáforo dice de un vistazo si podemos presentarnos: verde
(cumplimos todo lo evaluado), ámbar (hay requisitos por confirmar o que no cumplimos
pero no excluyen) o rojo (un requisito excluyente no se cumple, con cuál y por qué).
Debajo, cada requisito con su estado (cumple, no cumple, por confirmar o **no procede**
—el pliego lo pide pero no nos afecta, p. ej. lo de las UTE—): primero, en
grande, **qué piden** y lo exigido; debajo, **cómo estamos nosotros**, el **dato** nuestro
que lo decide (perfil, notas, colaboradores) y la página del pliego; los criterios con su peso y si van por fórmula o juicio
de valor; la documentación por sobre; las fechas clave; las garantías; las
penalizaciones; los riesgos; la recomendación (go, no go o con dudas) y las **señales de
pliego a medida** que haya visto Hermes (experiencia o tecnología muy específicas, marca
o compatibilidad obligatoria sin «o equivalente», criterios de juicio de valor que
premian a quien ya presta el servicio, solvencia a medida), con cita y página; en cuanto
llega la ficha se suman a los indicios de **Antecedentes**.

- Lo que la PLACSP publica estructurado (clasificación exigida, volumen de negocio,
  seguro, trabajos similares, plantilla) lo compara el código con el perfil de la
  empresa al momento. La clasificación solo excluye en obras de 500.000 € o más; en
  servicios es una alternativa a la solvencia y, si la tenemos, la acredita. Si el
  umbral publicado no es un importe (un ratio como «1,5» o un número de trabajos),
  queda por confirmar en vez de compararse como euros.
- El resto lo lee **Hermes** de los pliegos: en cuanto se descargan (o al pulsar
  **Generar ficha**, activo solo cuando ya hay pliegos descargados; mientras tanto el botón
  dice «Ficha en cola…» o «Generando ficha…» y no deja pedirla otra vez) deja una ficha
  con todo lo anterior citando página. **Se aplica al llegar**, sin aprobarla: cuenta en
  el semáforo y, si un excluyente no se cumple o recomienda «No go», la oportunidad pasa sola
  a Descartadas; si no, pasa a **Ficha por revisar**. Con ficha, el botón dice **Volver a generar la
  ficha** y la nueva sustituye a la anterior. Lo que la PLACSP dejó «por confirmar»
  porque no da el detalle no se repite en la lista: una línea dice que está leído del
  pliego en la ficha y deja de contar como duda.
- **Hermes lee los pliegos por temas**, no de principio a fin: la plataforma le da los
  pasajes de cada tema (solvencia, medios, certificaciones, subcontratación, idioma,
  lugar, criterios, sobres, garantías…) con su página y él lee por páginas la cláusula o
  el cuadro de características entero. Usa el perfil de la empresa con sus **notas** y
  sus idiomas, `perfil-licitaciones.md` y los **colaboradores** (cuántos cumplen los
  mínimos de cada perfil exigido).
- **La ficha debe estar completa**: cada tema de la lista (solvencia económica y técnica,
  clasificación, medios personales y materiales, certificaciones, habilitación,
  subcontratación, idioma, seguro, visita, lugar y presencialidad) va en los requisitos
  o dice que el pliego no lo pide (con su página) o que no se encontró; lo que la PLACSP
  publica sin detalle tiene que estar leído; los excluyentes citan documento y página.
  Si falta algo, la plataforma se lo devuelve a Hermes diciendo qué; a la tercera la
  acepta con avisos. Debajo de los requisitos se ve lo que el pliego no pide y, en ámbar,
  lo que no se encontró.
- **Comprobado con nuestros datos.** Cuando la plataforma tiene el dato, corrige lo que
  dijo Hermes y lo dice en el requisito («Comprobado con nuestros datos. Hermes decía:
  Por confirmar»): volumen de negocio contra el importe exigido, idiomas del equipo,
  certificaciones del perfil y de sus notas, clasificación, seguro, subcontratación y
  UTE (con «concurre en solitario»), colaboradores (solo para dejar «por confirmar» un
  perfil: los años o la titulación no prueban la experiencia concreta que pide el
  pliego, así que nunca lo dan por cumplido) y la
  excepción de empresas de nueva creación (sin la página del pliego que la admite, o
  con cinco años o más, queda por confirmar). Donde no tiene el dato, un «cumple» cuya
  justificación dice que falta la prueba («no consta», «sin acreditar», «pendiente de
  acreditar», «por confirmar», «no verificado») queda **por confirmar**. Lo que el
  pliego exime («no se exige», «exento», «se dispensa», «no será necesario acreditar»)
  queda en **no procede** y no cuenta como incumplido, aunque nombre certificaciones o un
  seguro que no tenemos; una exención fiscal («exento de IGIC»), la de otra clase de
  empresas, una con salvedad («pero sí el ENS») o con condición («no será necesario
  acreditarlo si figura en el ROLECE») no cuenta, ni «no será necesario aportarlo» (dice
  cuándo se entrega, no si se exige).
- Cada ficha lleva su **calidad** (0–100: cobertura de temas y de la PLACSP, citas,
  dudas, número de requisitos) y, si se sabe, el **modelo** de Hermes, la duración, las
  llamadas y los tokens, plegado en **Detalles técnicos** (no sirven para decidir). Una ficha hecha con una versión anterior del análisis lo avisa;
  las de lo que está en Nuevas o En preparación y en plazo se vuelven a pedir solas
  (2 a la vez, para no agotar el uso del modelo; primero las que vencen antes; **Programado** deja pausarlo).
- Un PDF escaneado o con el texto codificado se lee con OCR al indexarlo (en español, hasta
  150 páginas); solo si ni así da texto cuenta como ilegible.
- Si el PCAP (o, sin él, el PPT) no se puede leer —PDF dañado, escaneado o con el texto codificado, una página
  web servida como PDF—, la ficha no se pide sola: la pestaña **Pliegos** dice
  qué documento falla y **Estado** lista los pliegos que no se pueden leer.
- **Pliegos completos.** En Nuevas, mientras nadie pide la ficha, se baja lo justo para
  ella (PCAP, PPT y hasta 8 anexos legibles). En cuanto se pide la ficha o pasa a **En
  preparación** se baja todo lo publicado: los anexos sin tope, los «Otros documentos» de
  la PLACSP (memoria justificativa, notas de rectificación, aclaraciones) y lo que adjuntan
  los anuncios. El tipo lo dicen los bytes (también si el nombre no lleva extensión); lo
  que no reconocen vale por su extensión solo si es un documento de una lista cerrada
  (presupuestos `.bc3`, planos, cartografía, imágenes, firmas): un ejecutable, un script o
  un «modelo.pdf.js» no se guarda solo y la pestaña Pliegos pide bajarlo a mano. Un ZIP se
  descomprime (un ZIP dentro de otro también, con un tope común de 200 documentos y
  300 MB; si se pasa, no se deja a medias: se pide revisarlo a mano) y cada documento de
  dentro es un pliego más («<zip> - <documento>» en Drive); un ZIP que guarda un PDF sin
  comprimir se reconoce por la firma del ZIP y no se toma por PDF; la petición del DEUC (XML) se
  guarda y se marca para importarla en el servicio DEUC. Si la plataforma falla (caída o
  lenta) se reintenta sola, cada vez esperando más, hasta el plazo. La pestaña
  **Pliegos** dice qué documento publicado falta en Drive y por qué, y lo que el guion o
  la ficha citan sin estar entre los pliegos. Lo que está **En preparación** se contrasta
  además con la **página del expediente** en la PLACSP (al entrar y cada 6 horas mientras
  siga en plazo): el PDF de cada anuncio (también de sus versiones anteriores y
  rectificaciones) y cada «Otro documento» que lista entran en la cola y se bajan como el
  resto (lo mismo publicado dos veces queda una sola vez en Drive). Lo que aún no se
  ha contrastado con esa página queda **sin comprobar** (el Resumen y la Oferta lo avisan,
  con el fallo de la página si lo hubo) hasta que esa página se lee
  bien, la PLACSP publique otra versión o se recargue el histórico; mientras, los pliegos no
  se dan por completos.
- **Por lote:** los requisitos y la solvencia se miden contra los lotes de interés (los
  requisitos propios de otros lotes no cuentan y la clasificación obligatoria se mide
  con su importe), contra los que encajaron en el prefiltro si la criba no eligió, o
  contra el total si hay que presentarse a todos (entonces un excluyente de cualquier
  lote deja fuera). Con «a un solo lote» o un máximo de lotes por oferta, si hay más
  lotes de interés de los que permite la regla no se recorta ninguno: el bloque **Lotes**
  lo marca en rojo y la oferta no está lista hasta elegir a cuáles vamos; si algún lote en
  juego no publica importe, se mide con el del contrato. Si la
  PLACSP no publica la regla, Hermes la confirma en el PCAP dentro de la ficha (regla y
  máximo, que se ven en la ficha); si el pliego obliga a todos los lotes, al llegar la
  ficha se descartan los lotes de interés y, si el total queda fuera del rango de importe de **Filtros**, la
  oportunidad pasa a **Descartadas**. Lo mismo si la PLACSP publica después que hay que ir a
  todos. En el bloque **Lotes** se puede cambiar a qué lotes vamos (columna «Vamos» y
  **Guardar lotes a los que vamos**), dentro de la regla de presentación: pasan a ser los
  de interés y son los únicos lotes de la oferta (las decisiones van siempre a esos). Si
  el guion de la oferta no cubre algún lote de interés, Hermes lo vuelve a extraer solo (si
  está en preparación) y no se redacta hasta tenerlo; ir a menos lotes de los que cubre el
  guion solo se avisa (lo de los otros lotes no se presenta). Al guardar, el aviso dice lo
  que va a pasar de verdad: qué lotes se añaden y cuáles se quitan y, en preparación, si
  Hermes rehará la ficha o el guion (solo si se hicieron para otros lotes; quitar lotes no
  obliga a rehacerlos). La ficha se rehace sola (en
  preparación, si se puede leer y da tiempo) si se hizo para otros lotes o llegó una
  rectificación o aclaración después de ella; mientras tanto, la Oferta lo avisa.
- El detalle se actualiza solo cuando llega la ficha o la oportunidad se descarta sola.
- **Descarte automático:** si un requisito excluyente no se cumple (en los datos de la
  PLACSP o en la ficha), la oportunidad que esté sin cribar o nueva pasa sola a
  **Descartadas** con el motivo («Se descartó sola porque no la podemos presentar»); con
  **Recuperar** una persona la devuelve a Nuevas y el código ya no la toca. Nunca cambia
  una que alguien haya movido a mano ni las que están en preparación, presentadas,
  ganadas o perdidas. Descartadas solo lista las que siguen en plazo: una cerrada ya no
  se puede presentar.
- **Ficha «No go»:** si la ficha de Hermes recomienda no ir, la oportunidad que sigue por
  decidir (Nueva o **Ficha por revisar**, sin que nadie la haya movido a mano) pasa sola a
  **Descartadas**, tipificada como «Hermes: no ir», con el motivo «Hermes: no go — …» (el de
  la recomendación, recortado) y una fila en el historial de descartes firmada por Hermes. En
  la lista y en la cabecera se lee «Hermes: no ir» en vez de «Ficha: No go»; el aviso dice
  que Hermes leyó los pliegos y recomienda no ir. Las de preparación, presentadas o movidas
  por una persona no se tocan. **Recuperar** la devuelve a Ficha por revisar y una ficha
  «No go» posterior no la vuelve a descartar. Si llega una ficha nueva que ya no dice
  «No go», la descartada solo por la anterior vuelve sola a Nuevas (con su fila en el
  historial).
  El **seguro de responsabilidad civil** nunca descarta: si no lo tenemos o no llega al
  importe, sale «sin cumplir, no excluyente» con el aviso de que se contrata antes de
  presentarse. Si el pliego dice que no lo pide o lo exime («no procede», «no se exige»,
  «el lote 3 está exento»), la ficha lo
  marca como «no aplica» y no cuenta como incumplido.
