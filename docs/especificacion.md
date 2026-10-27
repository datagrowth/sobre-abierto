# Especificación funcional

Qué hace Sobre Abierto y cómo se usa, pantalla por pantalla. Es la fuente de verdad del comportamiento
visible: un cambio que lo altere actualiza este archivo en el mismo PR. Cómo está hecho, en
[arquitectura.md](arquitectura.md); cómo se instala, en [instalacion.md](instalacion.md); cómo se opera, en
[operacion.md](operacion.md).

## Contenido

- [Navegación](#navegación)
- [Primeros pasos](#primeros-pasos)
- [Plazos](#plazos)
- [Aviso de versión nueva](#aviso-de-versión-nueva)
- [Radar de licitaciones](#radar-de-licitaciones)
  - [Lotes](#lotes)
  - [Idioma](#idioma)
  - [Auditoría de cobertura](#auditoría-de-cobertura)
  - [Histórico](#histórico)
  - [Carpetas](#carpetas)
  - [Carpeta única por licitación](#carpeta-única-por-licitación)
- [Oportunidades](#oportunidades)
  - [Oportunidades por estado](#oportunidades-por-estado)
  - [Encaje](#encaje)
- [Pipeline](#pipeline)
  - [Responsable e hitos](#responsable-e-hitos)
  - [Exportar CSV](#exportar-csv)
  - [Comentarios con menciones](#comentarios-con-menciones)
- [Ficha y oferta de una licitación](#ficha-y-oferta-de-una-licitación)
  - [Ficha de la licitación](#ficha-de-la-licitación)
  - [Ficha y go/no-go](#ficha-y-gono-go)
  - [Equipo de la licitación](#equipo-de-la-licitación)
  - [Precios](#precios)
  - [Antecedentes](#antecedentes)
  - [Asistente de la oferta](#asistente-de-la-oferta)
  - [Estado, filas y detalle de la oferta](#estado-filas-y-detalle-de-la-oferta)
  - [Revisión](#revisión)
  - [La Mesa](#la-mesa)
  - [Propuesta y vista Presentadas](#propuesta-y-vista-presentadas)
- [Mercado](#mercado)
  - [Panorama y Vencimientos](#panorama-y-vencimientos)
  - [Índices de mercado](#índices-de-mercado)
  - [Competidores](#competidores)
  - [Qué nos falta](#qué-nos-falta)
  - [Organismos](#organismos)
- [Aprendizaje](#aprendizaje)
- [Biblioteca de Conocimiento](#biblioteca-de-conocimiento)
  - [Google Drive](#google-drive)
  - [Hermes usa la Biblioteca](#hermes-usa-la-biblioteca)
- [Equipo](#equipo)
- [Hermes y los agentes](#hermes-y-los-agentes)
  - [Actividad](#actividad)
  - [Consola](#consola)
  - [Hermes trabaja las licitaciones](#hermes-trabaja-las-licitaciones)
  - [Hermes conoce su entorno](#hermes-conoce-su-entorno)
  - [Agentes (MCP)](#agentes-mcp)
  - [Propuestas de la IA](#propuestas-de-la-ia)
  - [Qué hace Hermes solo y cuándo no gasta cuota](#qué-hace-hermes-solo-y-cuándo-no-gasta-cuota)
  - [Estado y programación](#estado-y-programación)
- [Administración](#administración)
  - [Ajustes](#ajustes)
  - [Login y usuarios](#login-y-usuarios)
  - [Avisos por email](#avisos-por-email)
  - [Calendario](#calendario)
  - [API de lectura para BI](#api-de-lectura-para-bi)
  - [Aspecto](#aspecto)
  - [La instalación](#la-instalación)
  - [Instalación y actualización](#instalación-y-actualización)

## Navegación

No hay pantalla de Inicio: la app abre en el
**Pipeline**. La barra lateral, blanca y con el logotipo oficial, pone primero el trabajo:
**Pipeline** (las ofertas en curso) y **Oportunidades** (lo que puede encajar y está por
revisar); después lo que se sabe: **Mercado**
(Panorama, Competidores, Organismos, Vencimientos y Qué nos falta), **Aprendizaje**, **Biblioteca** y **Equipo**. Al pie, la pastilla
de Hermes (lleva a su **Actividad**, desde donde se abre la **Consola**), el estado del servidor,
**Ajustes** y Cerrar sesión. Cada sección muestra cuántas cosas esperan a una persona: el
Pipeline, las ofertas con algo tuyo en las comprobaciones, frenadas o con un aviso de la PLACSP;
Oportunidades, las que esperan revisión (las mismas que el aviso del Pipeline); Aprendizaje, las
lecciones por revisar y los porqués sin responder, y el título de la pestaña del navegador también. Cada pantalla
tiene su cabecera con migas, título y acciones. La ficha de una licitación es su propia página
(`#/licitacion/p-12345678/oferta`), con las migas al Pipeline o a Oportunidades y un ancho de
lectura de 1.200 px. Estas direcciones alternativas también valen: `#/hoy` y
`#/licitaciones` llevan al Pipeline, `#/licitaciones/oportunidades/p-…/…` a la ficha,
`#/licitaciones/presentadas` al Pipeline › Presentadas, competidores, organismos y Qué nos
falta a Mercado, y `#/licitaciones/ajustes/…` a Ajustes › Fuentes y filtros. Una dirección que no
existe enseña una página 404 con la marca de la instalación y un botón al Pipeline. El catálogo de componentes
está en `#/diseno`, fuera del menú. Si la sesión caduca a media faena, la web vuelve al login
con «Tu sesión ha caducado», y si no hay red al abrirla dice que no puede comprobar la sesión y
deja reintentar. Todo va en la dirección: se puede recargar, compartir el enlace a una ficha y
volver con Atrás del navegador o del móvil; los filtros de las listas se recuerdan al cambiar de
sección. Entre 900 y 1.199 px la barra queda solo con iconos; por debajo de 900 px hay menú en
cajón, las pestañas son un desplegable, los filtros se pliegan, la ficha lleva una barra fija
abajo («Volver» y el siguiente paso) y en el móvil todo lo que se pulsa mide al menos 44 px.

## Primeros pasos

En una instalación nueva el Pipeline vacío lleva, antes del aviso «Ninguna oferta en curso»,
una tarjeta «Primeros pasos» con lo que falta para que el radar trabaje para la empresa: **el perfil de la empresa**
(Ajustes › Empresa: nombre, NIF, región y zona horaria), **qué licitaciones buscar** (Ajustes › Fuentes y filtros:
mientras los filtros sigan siendo los de ejemplo, el paso está pendiente), **la IA** (Hermes configurado, Ajustes ›
Hermes) y, marcado «opcional», **Google Drive** (Ajustes › Drive; sin Drive la Biblioteca y las carpetas de las
licitaciones viven en el disco del servidor y el radar, la ficha y la oferta funcionan igual). Cada paso pendiente
tiene un botón **Abrir** que va a su pestaña; la tarjeta no guarda nada por sí sola. Solo la ve un administrador, y
desaparece sola cuando están hechos los tres pasos obligatorios.

## Plazos

En toda la web, «hoy», «mañana» y «en N días» cuentan por **día de calendario
peninsular** (un plazo de mañana a las 08:00 dice «mañana» aunque falten menos de 24 horas, y
nunca «hoy»), con la hora de Canarias al lado si la empresa está allí (la zona horaria de
Ajustes › Empresa).

## Aviso de versión nueva

Tras un despliegue, la pestaña que seguía abierta con la web anterior
muestra una banda «Hay una versión nueva de la plataforma. Recarga para seguir guardando» con
un botón **Recargar**; nunca recarga sola, para no perder lo que se está escribiendo. La web
lo comprueba cada 5 minutos, y también si el servidor rechaza un guardado: una pestaña con la
web anterior recibe un `409 version_antigua` en vez de guardar con un formato viejo (no se
guarda nada), y el aviso sale al instante. Lo que consulta la API sin ser la web (agentes,
`curl`) no se comprueba. Si una recarga automática de una lista o de una ficha falla, se
siguen viendo los datos de antes con un aviso para reintentar, en vez de dejarla en blanco.

## Radar de licitaciones

El radar vigila las licitaciones de la Plataforma de Contratación del Sector Público: las del Estado y
organismos adheridos y las de comunidades autónomas y entidades locales (plataformas agregadas). Lo que recoge se
trabaja en el **Pipeline**, **Oportunidades** y **Mercado**; **Presentadas**, lo presentado y su resultado, es una
vista del Pipeline.

- Cada 15 minutos baja lo nuevo, guarda los datos de cada licitación (órgano, importes,
  CPV, plazo, criterios con pesos, requisitos, lotes, pliegos y adjudicaciones con
  adjudicatario, importe y baja) y pasa un **prefiltro** amplio que se configura en
  **Licitaciones › Ajustes › Filtros** (CPV o palabras clave, importe por lote o del contrato, tipo de contrato,
  territorio: un desplegable para marcar las comunidades autónomas que interesan; ninguna = toda España). Al guardar los filtros se aplican también a lo que espera en «Sin cribar»:
  lo que ya no pasa sale y, si se vuelve a admitir, entra de nuevo.

### Lotes

Una licitación de 1 M€ puede tener un lote de 100.000 € al que se puede ir
solo. La PLACSP publica (solo en perfiles; las plataformas agregadas no) si se puede
presentar **a un solo lote**, **a uno o varios** o **a todos**, y el máximo de lotes por
oferta y adjudicables. Si se puede ir a lotes sueltos (o la regla no se publica), el
prefiltro deja pasar la licitación cuando **algún lote** cae en el rango de importe y
encaja por su CPV (o el del contrato) o por palabra clave, y el motivo dice qué lotes y
con qué importe; sin regla publicada añade «presentación por lotes sin confirmar». Un
lote sin importe publicado vale como mucho el total (si el total no llega al mínimo, no
pasa). Si ningún lote suelto encaja pero se puede ir a todos (uno o varios, o sin
regla), se mira el total. Si hay que ir a todos, cuenta el total. Al arrancar, la
ingesta pasa este prefiltro a lo ya guardado (candidatas sin lotes del prefiltro y
licitaciones abiertas que se rechazaron por el total).
El rango de importe vale también para lo ya cribado: lo que pasó sin importe publicado
(las agregadas a veces lo publican después) o antes de bajar el máximo pasa solo a
**Descartadas** si sus lotes de interés (o el contrato) quedan fuera; lo cambiado a mano no.

- Lo que pasa el prefiltro lo **criba Hermes** (perfil `licitaciones`) dos veces al día
  o al pulsar **Cribar ahora**, comparándolo con el perfil de la empresa
  (`Conocimiento/Empresa/perfil-licitaciones.md`): interesa, revisar o descartar, con
  motivo y confianza (interesa y revisar entran igual en **Nuevas**; el veredicto se ve en la fila) y, en licitaciones con lotes, los **lotes de interés** con el motivo
  de cada uno (se comprueba que existan, que no pasen del máximo, uno solo si la regla es
  «a un solo lote» y ninguno suelto si hay que ir a todos). Cada candidata lleva el
  **nivel de indicios** de licitación con nombre (ver **Antecedentes**), el adjudicatario
  anterior y los indicios principales: con nivel alto Hermes lo dice en el motivo y baja
  la confianza, sin descartar solo por eso. Las **formaciones** (cursos, planes de
  formación, capacitación, CPV 80…) solo interesan si son de las **áreas de formación** del perfil de la empresa
  (Ajustes › Empresa; sin áreas, como en una instalación nueva, se juzgan como
  cualquier otro contrato): Hermes descarta las de otra materia («Formación fuera de nuestras áreas: …») y
  deja en revisar las que el título no aclara; al leer el pliego, la ficha de una formación
  de otra materia es «No go» y la pasa sola a Descartadas. Sin Hermes configurado, las candidatas esperan.
  Si Hermes no pudo leer el perfil de licitaciones, la criba no se acepta y las candidatas
  se vuelven a cribar. Si el perfil no está (o está vacío), ni se le pide: las candidatas
  esperan en **Sin cribar**, todas las vistas de Licitaciones avisan de que falta,
  **Programado** da la criba por parada y **Cribar ahora** lo dice en vez de enviarla.

### Idioma

La PLACSP no publica el idioma de las plataformas autonómicas (y en el resto
pone siempre «es»), así que el código lo deduce del título: catalán o valenciano,
euskera, gallego o español. Las que no están en español llevan la marca «en catalán»,
«en euskera» o «en gallego» en la lista y en la ficha. En **Licitaciones › Ajustes ›
Filtros** se pueden descartar directamente las escritas en alguna de esas lenguas: no
entran y las que ya estaban en Nuevas pasan solas a Descartadas. Los
**idiomas del equipo** van en el perfil de la empresa: Hermes descarta en la criba lo
que exige una lengua que el equipo no habla y, al leer los pliegos, anota el requisito
de tipo **idioma** (perfil lingüístico, atención en catalán…); si es excluyente y no
lo cumplimos, la oportunidad pasa sola a Descartadas. Los avisos de lo
que impide que llegue trabajo (ingesta apagada o con error, Hermes sin conectar o
frenado) salen en todas las vistas, plegados en una línea. Cada fuente de la PLACSP se
vigila por separado y a su ritmo: si **perfiles de contratante** lleva más de 6 h sin
entradas nuevas, o **plataformas agregadas** (que publica un lote de madrugada) más de
30 h, el aviso nombra la fuente y, si la otra sigue al día, dice que es la PLACSP y no
nuestra ingesta. La lista va ordenada por
plazo con lo que sigue abierto primero y lo vencido al final. Una fila abre la ficha en su
propia página (ver **Ficha de la licitación**). La ficha lleva arriba, fija al
desplazarse y compacta, la decisión en una fila: estado, semáforo de requisitos, opinión
de Hermes y plazo, con el **siguiente paso** como botón principal a la derecha (seguir, generar la
ficha, preparar la oferta, registrar la presentación, anotar el resultado o recuperar
una descartada), con **Descartar…**, que pide el motivo (lo ve Hermes para afinar la
criba). Debajo, por pestañas: **Requisitos** (la ficha
go/no-go, con los requisitos en cinco apartados siempre a la vista: **Solvencia económica**
—con el seguro—, **Solvencia técnica** —con la experiencia y la clasificación—,
**Certificaciones** —con las habilitaciones—, **Perfiles** y **Otros requisitos**; un apartado vacío dice si el pliego no lo pide o no se encontró. Si una
solvencia tiene otra norma para las **empresas de nueva creación** (menos de cinco años, art.
90.4 LCSP) y la empresa lo es según su fecha de constitución, la fila enseña directamente esa
norma, con su página, y la regla general debajo en pequeño), **Resumen** (datos, lotes con su regla de presentación y
lo que eligió la criba, una sola lista de criterios —los de la ficha o, sin
ella, los de la PLACSP— con, debajo, los topes que fija el guion de la oferta para los criterios
automáticos y el **precio máximo por lote** que trae el guion («Lote 2: máx. 115,50 € por
alumno» o, si no consta, «Lote 2: no consta el máximo por alumno (presupuesto del lote
6.352,50 €)»; un «precio máximo 0» escrito en un criterio se lee «precio máximo: no consta (ver
por lote)»), y la decisión del equipo: triaje y notas; «De qué va» se lee entero, sin cortes, y
«Por qué pasó el prefiltro» va plegado), **Mercado** (antecedentes, precios,
adjudicaciones parecidas y las de esta licitación). La oferta se prepara en **Oferta** y
**Revisión**; en una descartada, la Oferta dice «Descartada: no hay nada que preparar. Para
retomarla, «Recuperar» en la cabecera.».
Los botones **Drive: pliegos** y **Drive: oferta** (la carpeta de Salidas con la memoria y los anexos)
están en la cabecera de la ficha, visibles en todas las pestañas, y abren la carpeta en Drive
(el de pliegos si hay pliegos descargados; el de la oferta desde que se prepara la oferta); si aún no
existe allí, lo dicen. El paso de firma conserva el suyo. A mano solo se fija el triaje (nueva, en preparación o
descartada); presentada, ganada y perdida salen de la propuesta
registrada y de su resultado, así que no pueden contradecirse.

### Auditoría de cobertura

**Auditoría de cobertura**: cada lunes cuenta, por comunidad
autónoma (NUTS 2 del lugar de ejecución), las licitaciones de nuestro sector que trajo la
PLACSP la semana que cerró, por separado la agregada (plataformas autonómicas y entidades
locales) y los perfiles, y repasa las tres anteriores. La cifra de cada plataforma
autonómica se apunta a mano por semana (`PUT /api/licitaciones/cobertura/autonomica`, con
de dónde sale) y el informe (`GET /api/licitaciones/cobertura`, MCP `licitaciones_cobertura`)
dice qué le falta a la agregada: con más de un 5 %, «añadir fuente». Se ve y se apunta en
**Ajustes › Fuentes y filtros**. Solo informa: sirve para decidir si se
añade alguna fuente directa.

### Histórico

**Histórico** (en **Estado**): carga años de la PLACSP (por defecto desde 2018; ZIP
por mes desde 2018 y anual antes; del año en curso, los meses ya cerrados, porque el
mes en curso lo trae el feed) de las dos fuentes, sin frenar el radar. Guarda solo
lo del sector (CPV de los filtros o del perfil de la empresa, o palabras clave) salvo
que se configure guardarlo todo. Muestra el progreso por fuente y año; si se corta,
sigue donde iba. Un año con error se reintenta al volver a pedirlo, por el mes en que
falló; uno hecho se reabre solo si han salido meses nuevos (sigue por ellos) o con
«Volver a cargar» (de cero). Lo cerrado del histórico no entra en el prefiltro; lo que
sigue abierto y en plazo, sí, igual que lo del feed.

- Los pliegos de lo que interesa se bajan solos a
  `Conocimiento/Licitaciones/Radar/<año>/<expediente> (<id>)/` (con un `datos.json`): llegan a
  Drive y se pueden buscar en la Biblioteca. Nunca se pisa un archivo existente. Se bajan
  de la PLACSP y de las plataformas autonómicas que sirven el PDF directamente (País Vasco,
  Cataluña y Comunidad de Madrid); los que se publican después de la criba también entran.
  Una nueva sin ningún pliego que bajar (la plataforma no los publica en sus datos
  abiertos o están en una de la que no se bajan) **se descarta sola** con ese motivo, salvo
  que alguien la haya movido a mano; si después la plataforma los publica y sigue en plazo,
  **vuelve sola a Nuevas** y sale como novedad (cuenta desde que vuelve). Si los pliegos
  existen pero la descarga da error en su servidor y no queda ninguno por bajar, pasa a
  **Errores** con el motivo y **Reintentar**; si no, hay que abrirlos desde su página.

### Carpetas

lo que baja el radar (`Licitaciones/Radar/`) y lo que hemos presentado
(`Licitaciones/Presentadas/`) van separados dentro de Conocimiento (rutas configurables).
Al registrar una presentación se crea
`Presentadas/<AAAA-MM - expediente - órgano abreviado - tema>/` (mes de presentación y
tema sacado del título, sin caracteres que Drive o Windows no admitan; si ya existe,
con `-1`) con `PLIEGOS`, `DOCUMENTACION PRESENTADA` y `OTROS DOCUMENTOS`, y los pliegos
de la licitación (todas sus carpetas) pasan de Radar a `PLIEGOS` (con Drive conectado,
por su API, con sus Google Docs; si no, en el disco, y la sincronización lo sube). Si
en Presentadas ya hay una carpeta de ese expediente (`AAAA-MM - <expediente> - …`, como
las que el equipo haya creado a mano), se usa esa en vez de crear otra; las propuestas
ya registradas también reciben (o enlazan) la suya. Al borrar la última propuesta de
una licitación, su carpeta se cancela si aún no se había creado (nunca se borra nada de
Drive). Lo que se baje después de esa licitación va a `PLIEGOS`; sin carpeta de
presentada, junto a los pliegos que ya tenga (así nunca queda partida en dos carpetas).
Una **reorganización única** adapta las carpetas que una instalación tuviera con
otra distribución: al
arrancar, si no está hecha, mueve en Drive las carpetas de primer nivel de
`Licitaciones` que empiezan por `AAAA-MM - ` a `Presentadas/` y las de
`Licitaciones/<año>/` que acaban en `(p-…)` o `(a-…)` a `Radar/<año>/`; nada más, sin
borrar ni sobrescribir (destino ocupado: `-1`), y actualiza las rutas guardadas para que
la Biblioteca, Hermes y la web sigan encontrando todo (también el `fuente` de las
propuestas de nota pendientes). Una carpeta con archivos que la sincronización aún no ha
subido a Drive no se mueve hasta el siguiente intento. Con Drive desconectado no hace
nada (y lo dice); mientras mueve y hasta que el cambio llega al disco, la descarga de
pliegos espera. Si alguna carpeta falla, se queda en su sitio, se reintenta cada 15
minutos y lo demás (descarga de pliegos, carpetas de presentadas) sigue. Funciona
también con la ingesta desactivada.

### Carpeta única por licitación

**Carpeta única por licitación** (detalle y migración en [operacion.md](operacion.md)). Cada
licitación del Pipeline tiene una sola carpeta en Conocimiento,
`Licitaciones/Ofertas/<expediente> · <título corto> (<id>)/`, con **Pliegos**, **Oferta** (lo
que genera la plataforma), **Sobres** (los paquetes), **Presentada** y **Resolución**. La ficha
enseña un solo botón, **Carpeta en Drive**, y **Aplicar** crea la carpeta de la oportunidad. La
Biblioteca la indexa entera, importes incluidos, para que Hermes aprenda de las ofertas pasadas;
las copias de CV solo las ve un agente con permiso de colaboradores.

## Oportunidades

**Oportunidades**: lo que puede encajar y aún no está en el Pipeline, para decidir
**Aplicar** (pasa al Pipeline, en preparación) o **Descartar** con su motivo tipificado, desde
la propia fila. Por fecha de cierre, la más cercana primero. Pestañas **Por revisar**, **Sin
cribar**, **Errores** y **Descartadas**. Lo que descartó Hermes (la criba o una ficha «No go»)
va a Descartadas **apagado**, con su motivo, junto a lo que descartó una persona, y se puede
aplicar igual. Pasadas las 50 primeras, **Ver más**. En un procedimiento en dos fases, el cierre
que se ve (y por el que se ordena) es el de la solicitud de participación mientras siga abierta.
A la izquierda, los filtros del prefiltro a la vista: opinión de Hermes (con sus cuentas),
comunidades autónomas (casillas; ninguna marcada, todas), importe por lote, prefijos CPV, palabras clave, palabras que descartan, tipo
de contrato y lenguas a descartar. Mientras nadie guarde los filtros del radar, que son de ejemplo,
un aviso pide «Ajusta tus CPV» y lleva a Fuentes y filtros (`de_ejemplo` en
`GET /api/licitaciones/filtros`). Empiezan como en Ajustes › Fuentes y filtros y se afinan en la
lista sin cambiar la ingesta («Volver a los del prefiltro»); se recuerdan durante la sesión. Los
prefijos CPV llevan su descripción oficial y se añaden con un buscador del vocabulario CPV: «72»
ofrece la división 72 y sus grupos, y una palabra («estadístic») los códigos que la dicen. El buscador encuentra por título, órgano, expediente o
título de un lote, sin acentos y por el principio de cada palabra («form ia» encuentra «Formación
en IA»); con **Buscar también en los pliegos descargados**, también lo que solo dice el pliego, y
la fila enseña dónde («En el PPT, pág. 12: «…»»). Cada fila lleva su **encaje** (0-100, con el
desglose al pasar el ratón); el orden sigue por fecha de cierre hasta que la calibración diga que
el encaje ordena como decidimos (entonces la lista va por encaje y lo dice). **Guardar búsqueda** guarda lo buscado y los filtros con un
nombre y cada cuánto avisar (cada día o cada semana) de las nuevas que entren en Por revisar y la
cumplan; cada persona ve las suyas en **Ajustes › Avisos** (con cuántas nuevas trajo esta semana,
pausar, borrar y «Ver en Oportunidades», que abre la lista con esa búsqueda). Una fila abre la ficha
en su página.

### Oportunidades por estado

**Oportunidades**: lista por estado con cuántas hay en cada uno, una pestaña por estado:
**Mi mesa** (en preparación), **Por decidir** (Hermes ya dejó la ficha y no se descartó
sola), **Nuevas** (cribadas, a la espera de que Hermes lea los pliegos), **Errores**,
**Descartadas (en plazo)** y, solo si las hay, **Sin cribar**. **Errores** son las nuevas
en plazo que el proceso automático ya no saca adelante solas, con el motivo en la fila y en
la ficha: ningún pliego se pudo bajar (ni queda ninguno por bajar), la Biblioteca no puede
leer los pliegos (escaneados o dañados) o Hermes no hizo la ficha en sus tres rondas. La
marca se recalcula en cada vuelta del radar, así que sale sola de Errores cuando se arregla
(y no tapa una ficha ya hecha). **Reintentar** vuelve a poner en cola los pliegos con error o
pide otra ficha; con pliegos ilegibles no sirve y la ficha propone subir uno legible o
descartar. Al registrar la presentación sale de aquí y pasa a la vista
**Presentadas**, que filtra por resultado (pendiente, ganada, perdida…). Por defecto se
ven Nuevas, Ficha por revisar y En preparación. La ficha no se aprueba: vale desde que llega. Con
búsqueda, comunidad autónoma (por su NUTS; por defecto, todas) y orden por plazo, importe o llegada. El orden por plazo es por el **próximo plazo**: en los
procedimientos en dos fases, la solicitud de participación mientras siga abierta (cierra antes
que la oferta) y, si no, la oferta; lo vencido va al final. Cada fila enseña lo que hace falta para
decidir sin abrirla: importe, plazo con su fecha y su hora, que no es la misma en todas
(«en 2 días · mié 7 oct · 14:00», y «(13:00 Canarias)» si la empresa está allí: la PLACSP publica la hora peninsular), semáforo de
requisitos, opinión de Hermes («Encaja», «Encaja con dudas» o «No encaja»; si la licitación ya tiene ficha,
la opinión de la ficha, con los pliegos leídos, manda sobre la de la criba, en la lista y en la
cabecera de la ficha) y su motivo a la vista, lotes de interés, si ya tiene
ficha por revisar y si es nueva desde la última visita. Si la lista sale vacía
pero hay candidatas sin cribar, lo dice y ofrece verlas o cribarlas. En «Sin cribar»
solo hay licitaciones abiertas con fecha límite: la que cierra (plazo vencido, adjudicada o anulada)
antes de que la IA la vea sale sola, y si un lote de criba falla sus candidatas vuelven
a la cola.

### Encaje

**Encaje**: de 0 a 100, siempre con su desglose («Encaje 82 · cómo sale» en el Resumen de
la ficha y delante de «¿Merece la pena?»). Seis componentes con su peso: **temática** 0,30 (la
opinión de Hermes mezclada con lo que se parece el CPV al del perfil y al de nuestras presentadas;
barra lavanda), **solvencia y medios** 0,20 (requisitos cumplidos 1, por confirmar 0,5, no
cumplidos 0), **competencia** 0,15 (ofertas esperadas por las adjudicaciones de CPV parecido; menos
si el órgano lo gana casi siempre otra empresa), **economía** 0,15 (el importe frente al de las
que ganamos), **capacidad** 0,10 (ofertas en preparación que cierran a ±7 días) e **historial**
0,10 (lo que ganamos con ese órgano, acercado a la tasa global si son pocas). Un excluyente que no
cumplimos deja el encaje en 20 como mucho («no elegible»). Lo que no tiene datos no cuenta (su peso
se reparte) y lo dice. `GET /api/licitaciones/encaje/calibracion` da su AUC frente a lo que decidimos (cada oferta, sin contar su propia propuesta, y con 20
preparadas y 20 descartadas como mínimo): hasta 0,75 no ordena. Hermes no ve el
encaje (saldría de su propia opinión).

## Pipeline

**Pipeline** (la pantalla principal): las ofertas en curso en un tablero de cinco
columnas, **En preparación → Lista para firmar → Presentada → En evaluación → Resuelta**, cada una
por fecha de cierre. «Lista para firmar» sale del veredicto de las comprobaciones; las tres últimas se
mueven solas con la PLACSP (presentada con el plazo abierto, en evaluación al cerrar el plazo o
con la licitación pendiente de adjudicación, resuelta al adjudicarse o al saber si ganamos). La
tarjeta lleva solo el expediente, el cierre en hora peninsular (con la de Canarias debajo si la empresa está allí; en ámbar
a 3 días o menos), el título corto, el importe y el botón de la carpeta de Drive (la de la oferta o,
si aún no existe, la de los pliegos), con el avatar de quien la lleva; en Resuelta, «Ganada» o
«Perdida» en lugar de la fecha. Lo resuelto se queda un año. El título corto lo propone Hermes en la ficha (`titulo_corto`) y, si
no, se recorta por código. Al pie, «N oportunidades pueden encajar y están pendientes de
revisión» con las cuatro más próximas a cerrar y **Revisarlas**. La vista **Lista** enseña lo
mismo con la columna como estado y se exporta a **CSV**.
**Mover una tarjeta** (arrastrándola o con su botón **Mover**, para teclado y móvil) hace la acción
real, para que el tablero no contradiga lo registrado: a Presentada abre el registro de la
presentación; de Presentada o En evaluación a Resuelta pide el resultado de cada lote; y de vuelta
a En preparación deshace una presentación hecha por error (borra su registro si ningún lote tiene
resultado). Lista para firmar y En evaluación no aceptan tarjetas: mientras arrastras dicen por qué.
**Presentadas** (lo presentado, su resultado y la tasa de éxito) es la tercera vista.

### Responsable e hitos

**Responsable e hitos**: quien pulsa **Aplicar** o **Preparar la oferta** pasa a llevarla
(si nadie la llevaba); en la cabecera de la ficha se ve su avatar y un `editor` o `admin` se la da
a otra persona del equipo o a nadie. Cada oferta en preparación tiene cuatro hitos contados hacia
atrás desde la hora interna de cierre: **Decidir si vamos** (D-10), **Decisiones y precio** (D-7),
**Memoria dada por buena** (D-3) y **Paquete y firma** (D-1). Un hito está hecho cuando su fase
de las comprobaciones lo está; si el plazo se rectifica, se mueven solos. «¿Llegamos?» dice el próximo (o
el vencido, en ámbar). Un hito pasado sin hacer es un riesgo de las comprobaciones, una sola fila con el
último vencido y cuántos anteriores faltan, que se acepta con motivo; su fecha ordena la lista de
lo que te toca y va al calendario de quien lleva la oferta.

### Exportar CSV

**Exportar CSV**: el Pipeline (vista Lista), Oportunidades (la pestaña con sus filtros),
Presentadas, Competidores, Organismos y las adjudicaciones comparables de un índice (pestaña
Mercado de la ficha) se descargan enteros, no solo la página a la vista, en CSV para Excel en
español: UTF-8 con BOM, separador «;», coma decimal y las bajas como porcentaje. Ajustes ›
Integraciones › Exportar tiene los cinco listados con lo de por defecto de su vista.

### Comentarios con menciones

**Comentarios con menciones**: hay un hilo en la Oferta («Comentarios del equipo»), en
cada comprobación de la Revisión y en cada requisito. Cualquiera comenta, también un `lector`;
**Mencionar** añade «@Nombre» de alguien del equipo. Una mención cuenta en la barra lateral, bajo
tu nombre («2 menciones sin leer», con la lista para ir a cada una), se da por leída al abrir la
pestaña donde está y, si tienes activado el aviso de menciones, te llega por email. Quien
escribió o un `editor` lo da por **Resuelto** (o lo reabre).

## Ficha y oferta de una licitación

Lo que se ve y se hace dentro de una licitación del Pipeline: la ficha, el equipo, el precio, los antecedentes, la oferta y lo presentado.

### Ficha de la licitación

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
se reparten entre esas pestañas. Estas direcciones alternativas también valen: `…/preparacion`,
`…/cabina` y `…/comprobaciones` abren la Oferta, y `…/comprobaciones#bloqueo=…` o
`…/comprobaciones#testid=…` (la Mesa, Hermes; también con `cabina`) la Revisión en esa
fila o pieza; `…/expediente` los Requisitos y `…/pliegos` el Resumen.

### Ficha y go/no-go

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

### Equipo de la licitación

**Equipo** (en el detalle de cada licitación). Por cada requisito de medios personales
de la ficha (con su página y si es excluyente), las personas del equipo y las
externas que mejor encajan, por separado, con una puntuación orientativa de 0 a 100,
si llegan a los mínimos y cada comprobación (experiencia, titulación, certificación,
idioma: cumple, en parte, no cumple o sin dato en el perfil) más la afinidad
(tecnologías y rol que cita el requisito, experiencia en el mismo CPV, CV que la
Biblioteca encuentra por significado). Sin ficha, o para otro requisito, se
busca escribiéndolo a mano. Sin IA: la decisión y la lectura de los CV son de una persona.
Con lotes de interés, la afinidad por CPV usa el de esos lotes.

### Precios

**Precios** (en el detalle de cada licitación). Con lotes de interés, se calcula para
el lote (su presupuesto y su CPV; con varios, se elige cuál) y no para el total. Con el
histórico de adjudicaciones,
la baja (`1 − importe adjudicado / presupuesto del lote`) de las adjudicaciones más
parecidas: mismo CPV de 8 cifras, tipo, procedimiento y banda de importe (de un tercio
al triple); si no hay al menos 20, se ensancha paso a paso (sin procedimiento, sin
banda, CPV de 5, 4, 3 y 2 cifras, todos los CPV) y dice qué segmento usó y cómo lo
eligió. Muestra los percentiles en barras (P10, P25, mediana, P75, P90), media,
dispersión, la evolución por año y la baja según el número de ofertas. Se descartan
las bajas imposibles (negativas, de más del 70 % o 0 con varias ofertas, que suelen ser
precios unitarios o el máximo de un acuerdo marco) y se dice cuántas.

- **Escenarios de oferta:** para cada percentil y para la baja que escribas, el importe
  sin IVA, en cuántas adjudicaciones parecidas ganó una baja igual o menor y si la
  oferta podría quedar como anormalmente baja según el art. 85 del RGLCAP con el número
  de ofertas esperado (por defecto, la mediana del segmento; se puede cambiar) y
  suponiendo que el resto oferta la baja mediana. Se puede limitar a «solo este órgano».
  Es orientativo: manda lo que diga el pliego.
- **Adjudicaciones parecidas:** adjudicaciones con la misma división CPV (2 primeras
  cifras), el mismo tipo de contrato y un presupuesto entre un tercio y el triple (con
  baja creíble); las del mismo órgano se buscan aparte para que no se queden fuera por
  antiguas, por NIF o, si la plataforma no lo publica, por código DIR3 o nombre del
  órgano. Orden: mismo órgano, **objeto parecido** (palabras del título sin años,
  números ni palabras vacías), CPV más largo en común y fecha. Cada una con
  adjudicatario, fecha, presupuesto, importe, baja, ofertas y enlace a la PLACSP; el
  bloque lo explica en «Cómo se eligen». «Solo este órgano» se aplica también a esta
  lista (y al segmento de bajas). No son las ediciones anteriores: esas están en
  **Antecedentes**.

### Antecedentes

**Antecedentes** (en el detalle de cada licitación). Muchas licitaciones «ya tienen
nombre»: aquí se ve si la misma licitación salió en años anteriores y quién la ganó.

- **Ediciones anteriores:** licitaciones del **mismo órgano** (por NIF; sin NIF, por
  DIR3 o por el nombre de la entidad: «Junta de Gobierno Local» o «Alcaldía» cuentan
  como su ayuntamiento) publicadas **al menos seis meses antes**, con un **objeto
  parecido** (palabras del título sin años, números de expediente ni palabras vacías;
  pesan más las que el órgano usa poco), CPV en común e importe parecido. Nunca cuentan
  el mismo servicio en otra provincia, ruta o sector, ni los contratos basados en un
  acuerdo marco. Con los umbrales elegidos, en una muestra revisada a mano de dos meses
  reales de la PLACSP (2023 y 2025) acertaban 9 de cada 10. Las adjudicaciones del mismo
  órgano con otro objeto van aparte y plegadas («No es una edición anterior: el objeto no se
  parece»): dicen qué más contrata el órgano, no quién ganó antes esta licitación, y son las
  mismas que Precios enseña con «Solo este órgano», para que las dos no se contradigan.
- **Línea de tiempo:** por edición (de la más reciente a la más antigua) el año, el
  expediente con enlace, el lote, quién ganó (nombre y NIF, con enlace a su ficha), el
  importe, la baja, el número de ofertas, la duración y el inicio y fin del contrato
  (el fin, estimado con inicio y duración si el órgano no lo publica) y el parecido. Con
  lotes, cada lote tiene la suya: se casa con el lote de nombre más parecido de cada
  edición, o con el contrato entero si antes no iba por lotes.
- **Indicios de licitación con nombre**, cada uno con su explicación y su dato, y un
  **nivel bajo, medio o alto** con reglas fijas (que el bloque enseña): mismo
  adjudicatario en las últimas ediciones seguidas, ediciones con una sola oferta o muy
  pocas (por lote: la mitad o más de sus lotes), bajas mínimas del adjudicatario anterior
  (menos del 2 %, sin contar las de una sola oferta, que ya cuentan como tales), el
  contrato nuevo empieza justo al acabar el anterior, plazo de presentación por debajo
  del mínimo legal de su procedimiento y tipo de contrato (días desde el anuncio: 15 en
  el abierto y 26 en obras y concesiones, 15 en el simplificado y 20 en obras, 10 o 5
  días hábiles en el sumario; el plazo en el mínimo, lo habitual, se enseña sin
  puntos), volumen de negocio por encima del tope legal de 1,5 veces el valor estimado
  (con un 10 % de margen) o trabajos similares de más del doble de su referencia (70 %
  de la anualidad media), y las señales del pliego de la ficha (las de un lote,
  solo en ese lote). En los lotes, la solvencia general se mide contra el contrato
  entero y la del lote contra el lote. Alto desde 5 puntos, medio desde 3. Son
  indicios, no pruebas, y se dice así; con lotes, cada lote tiene su nivel y el de la
  licitación es el mayor. Sin ediciones anteriores ni indicios, el bloque dice **Sin
  datos** (no «bajo») y por qué: órgano no identificable o histórico sin esos años.

### Asistente de la oferta

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

### Estado, filas y detalle de la oferta

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

### Revisión

**Revisión**, en su pestaña: lo que dicen las comprobaciones, colocado donde se lee
antes de firmar. Arriba, el estado de la oferta (el veredicto de las comprobaciones, plazos, Hermes en
vivo) con lo que queda («5 impiden · 10 riesgos · 7 pendientes…»), «Volver a revisar» y
**Registrar la presentación**, apagado si algo impide presentar, que lleva al registro del paquete
de abajo. Luego **Qué impide presentar**, con la acción de cada fila (ver más abajo). Debajo, una tarjeta por sobre (archivo electrónico del guion) con sus documentos
y, en cada uno, sus comprobaciones con su estado (correcto, riesgo, impide o pendiente): el precio
y los datos del anexo en la oferta económica de su lote; los criterios a los que nos acogemos en
su sobre; lo de la memoria (compromisos con coste, lo que promete, fugas, desfases) en la memoria,
con sus páginas frente al límite, que no lleva datos de otros sobres, el anonimato si el pliego lo
pide y la nota del crítico ciego, con los apartados por debajo del 70 % de sus puntos; los datos
de la empresa en el DEUC; los medios en el compromiso de adscripción; y las firmas de cada sobre.
Lo que no es de ningún documento sale arriba («Antes de los sobres»). Cada acción («Suavizar»,
«Kit de firma»…) lleva a su fila o al paquete, en la misma Revisión, donde se hace; «Pedir
cambios», a la memoria en la Oferta. Al final, lo que Hermes no pudo comprobar, «Revisar lo que
hizo Hermes» y el paquete con el kit de firma y su registro (ver más abajo).

### La Mesa

**La Mesa** (`GET /api/licitaciones/mesa`) no tiene pantalla propia: el servidor la saca de las
comprobaciones de cada oferta para **Siguiente tarea →** de la oferta (abre la oferta
más urgente en la Revisión con el foco en su fila, `#/licitaciones/oportunidades/<id>/comprobaciones#bloqueo=<clave>`)
y para Hermes (`licitaciones_mesa`). La cuenta de Licitaciones en la barra lateral son las
licitaciones que tienes que abrir (algo tuyo en las comprobaciones, una ficha por decidir o un aviso de
la PLACSP), cada una una vez, y debajo dice qué hay detrás («19 decisiones tuyas en 3 ofertas»);
una licitación descartada no cuenta. Los avisos de lo que
impide que llegue trabajo (ingesta parada, Hermes sin conectar o frenado) salen arriba en
Licitaciones. En la barra lateral, la pastilla **Hermes** dice qué hace Hermes
ahora por dominio (lo que corre, espera y falló) y lleva a Hermes › Actividad.

### Propuesta y vista Presentadas

**Propuesta** (en el detalle de cada licitación) y vista **Presentadas**.

- **Registro de lo presentado:** por licitación y lote, la fecha, el importe ofertado
  sin IVA (con la baja calculada contra el presupuesto del lote o de la licitación), los
  documentos presentados (rutas en `Salidas/…` o `Conocimiento/…`, elegidos de la
  carpeta de la licitación o escritos) y notas. Al registrarla, la oportunidad pasa a
  **Presentada** y se crea su carpeta en `Conocimiento/Licitaciones/Presentadas/` (ver
  **Carpetas**, en el Radar de licitaciones), que el bloque muestra. Después se apuntan el resultado (pendiente, ganada, perdida,
  excluida, desierta o retirada), las puntuaciones técnica, económica y total, la
  posición, la puntuación del ganador y las **lecciones aprendidas**. Si la criba eligió
  un único lote de interés, el formulario lo trae puesto.
- **Lotes de interés en borrador, evaluación y parecidas:** el borrador y la evaluación
  de Hermes se hacen para esos lotes (o para el contrato si hay que ir a todos) y las
  propuestas parecidas se buscan con su importe y su CPV.
- **Resultado automático:** cuando la PLACSP publica la adjudicación del lote (o del
  contrato), lo presentado pasa solo a **ganada** si el adjudicatario es el NIF del
  perfil de la empresa, a **perdida** si es otro (con quién ganó, por cuánto y con qué
  baja) o a **desierta**. Si la PLACSP cambia luego la adjudicación, el resultado
  automático cambia con ella. No decide si ganó una UTE (podemos estar en ella) ni pisa
  un resultado puesto a mano («Pendiente» se lo devuelve a la PLACSP); guardar solo
  puntos o notas no lo convierte en manual. Una propuesta al contrato entero en una
  licitación por lotes espera a que todos los lotes estén adjudicados o desiertos.
- **Estado de la oportunidad:** sale de todo lo presentado: **ganada** si algún lote
  está ganado, **perdida** si todo está decidido y algo perdido o excluido, y si no,
  **presentada** (también al reabrir un resultado). Da igual en qué orden se resuelvan
  los lotes. Si una persona movió la oportunidad a otro estado, no se toca.
- **Corregir lo registrado:** «Editar» deja cambiar la fecha, el importe (recalcula la
  baja) y los documentos, además del resultado, los puntos, las notas y las lecciones.
- **Preparación de la oferta** (en cuatro pasos: guion del pliego, decisiones, memoria técnica y
  presentación, que se trabajan en la Oferta y se revisan en la Revisión). Con el plazo
  vencido no se pide nada a Hermes; si lo que tarda (ficha rehecha ~40 min, guion ~45 min,
  propuesta de decisiones ~30 min, memoria ~2 h, nueva versión ~1 h 30 min, anexo ~20 min)
  más un margen para firmar y presentar (2 h, `LICITACIONES_MARGEN_FIRMA_HORAS`) no cabe
  antes del cierre, lo automático no se pide y lo que pide una persona (**Extraer del
  pliego**, **Pedir propuesta**, **Redactar memoria**, **Nueva versión**, **Rellenar con
  Hermes**) avisa de cuánto queda en hora peninsular (y de Canarias si la empresa está allí) y solo se pide si lo
  confirma (la nueva versión se mide por los apartados que rehace). Un trabajo de Hermes
  de la oferta que lleva en marcha más de lo normal se para y se relanza solo, una vez por
  intento y gastándolo (no pasa de sus tres runs), salvo que ya haya entregado lo suyo:
  1. **Guion del pliego.** Hermes extrae del pliego, todo literal y con documento y
     página, lo que hay que entregar y cómo se puntúa: cada archivo electrónico o sobre
     con sus documentos (quién los prepara y de qué modelo salen) y lo que está
     prohibido meter en él; la memoria técnica con su límite de páginas, su formato y sus
     apartados (uno por criterio de juicio de valor de la ficha, con sus puntos, lo que
     «se valorará» y la escala) y las advertencias —si el pliego la exige sin
     puntuarla («memoria no valorable»), sus apartados son el contenido mínimo que pide,
     sin puntos: se redacta igual, no tiene nota ni se autoevalúa (manda el guion vigente: si
     uno posterior la da por no valorable, la plataforma no encola la evaluación y la
     evaluación a mano se rechaza; una evaluación acepta máximo 0) y el límite de páginas
     se reparte a partes iguales—; los criterios automáticos (dónde se
     marcan, qué palabras los delatarían en la memoria, sus tramos con los puntos de cada
     uno, el documento que exigen y la penalización si se incumplen), la oferta económica
     **de cada lote** con su fórmula, su impuesto aparte y sus precios unitarios (concepto,
     unidad, máximo y cantidad) y el plazo. Si falta la oferta de algún lote, o la fórmula
     puntúa un precio por unidad que no viene, se lo devuelve a Hermes. Se pide solo al pasar a «En preparación» (y con cada
     ficha nueva, al cambiar los lotes de interés o al bajarse un anexo, modelo, DEUC o
     rectificación después del guion, que Hermes no leyó; si el trabajo falla, se vuelve a
     pedir solo hasta tres veces) o con **Extraer del pliego**; si los apartados no casan con la ficha,
     faltan páginas o el pliego fija un límite que no trae, la plataforma se lo devuelve a
     Hermes con la frase exacta. Si la ficha es más nueva que el guion, avisa. Si llega una
     rectificación o aclaración después de la ficha, o los lotes de interés cambian a unos que
     la ficha no comprobó, se pide antes **la ficha otra vez** (si da tiempo a la ficha y al
     guion antes del cierre) y el guion espera a esa ficha; si no da tiempo o la ficha falla
     tres veces, el guion sale con la ficha que hay.
  2. **Decisiones.** Quien lleva la oferta fija, antes de redactar, el equipo
     nominal (personas de Colaboradores con su rol en la oferta, dedicación y, con varios
     lotes, en cuáles trabaja), a qué criterios automáticos nos acogemos, **lote a lote** y
     con el **tramo** elegido (cuenta los puntos de cada tramo y aparte los que no dicen
     dónde consta que podemos cumplirlo), las herramientas, las **indicaciones para la memoria (opcional)** y el
     **precio de cada lote**: un campo por cada precio unitario de su oferta (€/alumno,
     €/edición…) o el importe total, con su baja, o «Pendiente» (al marcarlo se vacían sus
     precios). No se guarda un lote sin precio ni un precio por encima de su máximo; uno por
     debajo del umbral de anormalidad se guarda con aviso. Tampoco se guardan criterios o
     personas de lotes a los que no vamos. Si el guion cambia, hay que
     revisarlas y guardarlas otra vez. El formulario llega **relleno**: al llegar el guion
     (y con «Proponer de nuevo»; si la propuesta automática falla, se vuelve a pedir sola
     hasta tres veces; con un guion nuevo se pide también aunque ya haya decisiones
     guardadas, que no se tocan: la propuesta queda para «Cargarla en el formulario»), Hermes propone equipo, criterios automáticos,
     herramientas y enfoque con el porqué de cada cosa, leyendo los CV, el perfil de la
     empresa y las ofertas parecidas. Cada criterio automático va al **tramo más alto que
     podemos demostrar** hoy, con dónde consta; lo que exige un documento que no está en la
     Biblioteca va a 0 y explicado («0 puntos — exige el Dossier Técnico Homologado del
     fabricante»). Las indicaciones para la memoria nunca son obligatorias: la persona escribe, en positivo, lo que quiera que Hermes tenga en cuenta, y debajo del campo se ve la lista de lo que **Hermes recomienda no prometer** (hasta 10 compromisos, cada uno con su motivo); al guardar, nombrar un criterio de otro sobre se rechaza y prometer algo de esa lista da un aviso. Los que hay que acreditar, y los compromisos que el pliego pide probar con un documento o un hecho (plataforma ya en marcha), solo con la evidencia. El enfoque que propone va en positivo, sin citas del pliego, sin lotes a
     los que no vamos y sin nombrar criterios automáticos; el que escribe una persona se
     guarda sin citas del pliego. El precio lo sugiere la plataforma con las adjudicaciones
     parecidas: **equilibrio** (la baja más pequeña que habría ganado en precio el 80 % de
     ellas) y **máxima probabilidad** (la mayor baja sin caer en anormal), las dos un punto
     por debajo del umbral de anormalidad. El precio **no se rellena solo**: cada lote sin
     precio guardado abre «Pendiente» y vacío, con los sugeridos al lado («Sugerido, sin
     guardar», con **Usar**), y guardarlo sin tocar deja el precio pendiente. Los criterios
     automáticos se reconocen aunque Hermes o la persona los escriban con el código del pliego
     delante («2B1. – …»): se guardan con el nombre literal del guion. Nada se guarda
     hasta que una persona pulsa «Guardar decisiones». Los lotes no se eligen aquí: son
     los de interés del bloque **Lotes** (si llegan otros, no se guarda).
     **Comprobaciones de la oferta.** `GET /api/licitaciones/licitaciones/:id/comprobaciones` devuelve lo
     que pasa en la oferta, con ETag (la web pregunta a menudo y recibe 304 si no cambió):
     veredicto, fases y filas de bloqueo con clave estable, gravedad, cita, actor y acción.
     Una persona resuelve una fila con `POST …/comprobaciones/bloqueos/:clave` (`vamos`, `aceptar_riesgo`,
     `descartar` con motivo, o `aplicar_propuesta`); lo que impide presentar no se puede aceptar
     como riesgo. `GET /api/licitaciones/mesa` lista lo de hoy de todas las ofertas activas.
     **Decisiones por sección** (`PATCH …/oferta/decisiones/:seccion`: precio, equipo,
     automáticos, herramientas, enfoque o lotes) con versión; `GET …/oferta/decisiones/historial`
     las lista y `POST …/oferta/decisiones/deshacer` vuelve a una versión anterior.
     `POST …/oferta/impacto` calcula, sin escribir ni mostrar importes, qué piezas rehace un
     cambio (anexos, apartados, paquete) con su acción y coste antes de aplicarlo.
     **Lo que no casa.** La plataforma lista lo que no casa en la oferta, cada
     cosa con un enlace a donde se arregla: en rojo lo que **bloquea** (más lotes de interés
     de los que permite la regla, ficha hecha para otros lotes, anexos, modelos, DEUC o
     rectificaciones publicados en la PLACSP que no se han bajado, guion o decisiones de
     otros lotes, un anexo, modelo, DEUC o rectificación bajado después del guion, precio
     por encima del máximo o por debajo del umbral de anormalidad que fija el pliego —el
     porcentaje del IVA o del IGIC no cuenta como umbral—) y en ámbar los **avisos** (otros
     documentos sin bajar, pliegos sin comprobar, umbral estimado o que no se entiende, una
     ficha anterior a una rectificación, ir a menos lotes de los que cubre el guion, el precio
     de un lote por debajo de un umbral de anormalidad estimado o que no se entiende, un
     requisito excluyente de personal sin nadie del equipo con
     ese rol en su lote o con alguien que no tiene registrada la materia que pide —«monitorización de
     medios», «30 h de teleformación»—: los años totales no la acreditan). Con algo que bloquea, el paso Decisiones queda «Por revisar» y
     se dice qué arreglar primero: nunca «Todo listo». Hermes lo ve también en
     `licitaciones_oferta`.
  3. **Memoria técnica.** «Redactar memoria» (con guion, decisiones y Salidas) encarga a
     Hermes un apartado por run con su rúbrica, su extensión objetivo (su parte del
     límite de páginas por sus puntos, sin la holgura de la cuota), las decisiones (equipo
     con titulación, años y certificaciones; por roles y sin nombres ni méritos si un
     criterio automático de otro archivo puntúa la experiencia o la titulación del equipo)
     y el enfoque como instrucciones del equipo, sin citas al pliego. Si hay criterios
     automáticos en el mismo archivo, la tarea dice a cuáles nos acogemos y a cuáles no. Cada apartado se rechaza con la
     frase exacta si no trata cada punto de «se valorará», deja huecos
     («[PENDIENTE…]»), lleva citas internas del pliego (nombres de archivo, «§»,
     «pág. N»), se pasa de su cuota o, si la memoria puntúa, no llega al 70 % de ella, o
     matiza de más («si procede», «en su caso», «no incluye»…); a la tercera entra con
     avisos visibles. Las **fugas
     entre sobres** (causa de exclusión) se rechazan siempre: importes y bajas en frases
     que hablan de la oferta (precio, presupuesto, coste, IVA…; un importe que no habla de
     ella, como el ejemplo de un método, se rechaza como lo demás), marcas de
     los criterios automáticos del otro archivo, lo ofrecido en ellos según las decisiones
     (cifras como «2 horas» o «24/7» si la frase habla de su criterio, herramientas que solo
     se nombran ahí; no el nombre del criterio ni lo que no ofrecemos), sus anexos («Anexo
     V») y, si ese criterio puntúa al equipo, los años junto al nombre de alguien. Las
     frases que repiten con otras palabras lo que se declara en ellos (**ecos**) son una
     sospecha: se rechazan dos veces y a la tercera entran con aviso.
     **Método de la memoria.** Al pulsar «Redactar la memoria» la plataforma reúne en un dossier el pliego técnico, los criterios literales, el formato,
     la frontera con los otros sobres, la empresa, el equipo y lo aprendido; Hermes piensa una
     estrategia (temas ganadores, estructura con los títulos literales, qué sección responde a
     cada «se valorará» y una hoja de hechos con horarios, plazos, roles y cifras que todos los
     apartados copian), redacta la memoria entera de un tirón y un crítico ciego (otro modelo,
     si está configurado) la puntúa con citas literales. Si no llega al umbral, se reescriben
     solo los apartados flojos con lo que señala el crítico, hasta tres rondas; un apartado
     que empeora vuelve a su mejor versión (uno de pantallas tiene un reintento más). El
     crítico lee el documento como la verá la mesa (portada, numeración, figuras) con
     comprobaciones automáticas delante (numeración duplicada, frases y casos repetidos); no
     puede dejar un apartado por debajo del máximo sin decir por qué ni con qué arreglo, y lo
     que repite de la ronda anterior le llega al redactor como «no resuelto: cambia el
     enfoque». Si el crítico señala un valor de la hoja de hechos, antes de reescribir Hermes
     corrige solo ese valor y la memoria avisa «HECHO CAMBIADO» para que una persona lo revise. No se ensambla «como buena» con contradicciones de la hoja
     de hechos ni con más páginas que el límite si quedan rondas; si los bloqueantes no bajan en
     dos rondas, se para con aviso de revisión humana. La estrategia decide los parámetros que
     el pliego deja al licitador (calendario con fechas, arquitectura, modelos, umbrales,
     dedicaciones, soporte): antes de redactar, la **ficha de solución** enseña en la web todo
     lo que la memoria va a comprometer (también cada tramo del calendario, los riesgos y la
     hoja de hechos) para aceptarlo o editarlo («Aprobar y redactar», con quién la revisa); lo
     editado pasa a la estrategia y a la hoja de hechos, y si cambia el inicio el calendario
     se desplaza. La redacción
     espera hasta 24 h; sin respuesta, sigue con lo propuesto y la memoria avisa de que esos
     valores no se revisaron. Una memoria de ensayo no espera. La web muestra la línea de fases (Dossier →
     Estrategia → Ficha de solución → Redacción → Crítica → Ronda → Ensamblada), el dossier y la estrategia en
     Drive, la nota del crítico por ronda y apartado, si fue independiente y ciego, la hoja de
     hechos y lo que no casa con ella. Si el pliego pide CV anonimizados, el equipo va por
     roles, sin nombres. La memoria abre con una tabla «Cómo se responde a cada criterio»
     y el texto admite **negrita**, *cursiva*, listas numeradas y tablas
     apaisadas.
     Con el plazo vencido, «Más opciones» ofrece una **memoria de ensayo** para
     compararla con la presentada: se confirma, ninguna fase la frena por plazo, sale como
     `memoria-vN-ensayo.*`, se etiqueta «Ensayo (no presentada)» y no cuenta como la memoria
     de la oferta (ni se da por buena ni sale como pendiente).
     **Subir la memoria presentada (PDF o Word)** (arriba del paso 3, siempre que haya oferta y también con el plazo vencido) guarda tal cual la que se entregó, hecha fuera de la plataforma: pasa a ser LA memoria de la oferta («Presentada»: Hermes la evalúa y aprende de ella, no se revisa, no se mejora ni se descarta), se reparte por apartados solo si trae los títulos del guion y subir otra la sustituye (la anterior queda en el historial); presentada la oferta, el paso Memoria dice «Presentada» y ya no «Desfasado».
     Hermes puede dibujar figuras (pantallas, arquitectura, flujos, calendarios; hasta 4
     por apartado) como SVG: la plataforma las pasa a imagen y las mete en el Word
     numeradas («Figura 1. …»), revisa sus rótulos como el texto y rechaza siempre las
     que no se dibujan o traen scripts o recursos externos.
     Con todos, la plataforma monta `memoria-vN.docx` (portada con cada lote como «Lote N:
     nombre» y el título de la licitación entero —si es largo, se corta en una palabra con
     «…», nunca a media palabra—, índice, los títulos literales del pliego, «Página X de Y»
     solo en el cuerpo, con el total de páginas del cuerpo medido en el PDF —sin LibreOffice,
     «Página X», nunca «Página X de» en blanco— y,
     si el guion lo pide, el cierre «Lugar, fecha y firma del proponente» con el municipio
     y el representante del perfil de Empresa; lo que falte queda en blanco y se avisa) con su PDF y páginas reales
     si el monitor tiene LibreOffice (si no, páginas estimadas), más `.md` y `.json`, en
     `Salidas/Licitaciones/<expediente> (<id>)/`, y avisa si se pasa del límite, si un
     apartado no se pudo redactar o si el guion cambió. El paso gira alrededor de la
     **versión actual**: su estado, la nota estimada por Hermes, las páginas, los botones
     **Descargar Word / PDF**, **Dar por buena**, **Pedir cambios** y **Descartar**, una sola
     tabla de apartados (lo redactado y la nota de cada uno) y «Por qué esta nota»; las
     versiones anteriores van en el historial, y empezar desde cero, evaluar otro
     documento y los borradores antiguos en «Más opciones». La memoria entra **pendiente
     de revisar**: una persona la da por buena (pasa a «preparada» en la lista de
     presentación) o la descarta; para rehacerla se piden cambios. Si la versión es de **otro
     guion** (el vigente cambió después), «Dar por buena» deja de ser el botón principal y
     «Pedir cambios» no sale: el principal es **Rehacer con el guion vigente**, que pide
     confirmación con el coste («Hermes redacta la memoria desde cero con el guion vigente:
     unas 2 h de máquina. La versión anterior se queda en el historial.») y la Oferta dice «Esta
     versión es de otro guion: rehazla con el guion vigente (unas 2 h).». **Volver a montar sin IA** (en una
     versión ensamblada que no se subió a mano) rehace la portada y la firma con el perfil de
     empresa de ahora sin gastar Hermes: sale como `memoria-vN-2.*` (nunca pisa nada), conserva
     la revisión (si estaba dada por buena, lo sigue estando, y el paquete queda desfasado) y
     no se vuelve a evaluar. El aviso «Falta el perfil de la empresa…» se recalcula al leer:
     con el perfil ya completo dice «La portada de esta versión se montó sin el perfil de la empresa;
     ya está completo: «Volver a montar sin IA» la pone al día» (en una subida, «corrígela en
     tu Word»), y el de la firma desaparece cuando el perfil trae domicilio y representante.
     Una memoria **no valorable** no enseña nota: ni «Nota de Hermes», ni puntos por apartado,
     ni «Evaluar»; dice «No se puntúa: la mesa solo comprueba que está lo exigido». El aviso
     de lo que se acaba de hacer («Hermes rehace…», «Subida como v3…») queda encima de la
     versión y no desaparece al llegar la nueva. El documento entero
     (también el subido a mano) se vuelve a revisar al montarlo: las fugas quedan como
     avisos y se ven con su cita, y **Dar por buena** no pasa con fugas (tampoco con ecos)
     sin escribir el motivo para anularlas, que queda guardado con quién y cuáles. **Subir mi Word**
     (junto a «Descargar Word», y también sin memoria si hay guion; hasta 30 MB) recibe un .docx retocado a
     mano (o un PDF; uno sin los títulos del guion se guarda **entero**, sin error, con el aviso
     «Guardada entera…»: se revisa, se evalúa y enseña lecciones, pero no admite «Pedir cambios» ni
     «Actualizar los apartados afectados»; con la oferta presentada o el plazo vencido sugiere subirla
     como presentada, la de su lote si va por lotes): se guarda tal cual en Salidas como la versión siguiente (con su PDF y páginas
     reales si hay LibreOffice), entra pendiente de revisar y Hermes la evalúa sola. Su
     contenido se reparte por los títulos del guion y en el orden del Word, para poder pedir
     cambios desde ella: un «1.2 …» o un estilo de título abre bloque, las **tablas siguen
     siendo tablas**, las listas de Word son listas y las **imágenes** (PNG o JPEG) se guardan
     en `Salidas/…/memoria-vN-imagenes/` y vuelven a salir en las versiones que monte la
     plataforma (Hermes las conserva al rehacer un apartado y solo puede usar las de esta
     licitación). El apartado cuyo título no se encuentra queda sin texto y se rehace al
     pedir cambios; lo que va antes del apartado 1 (p. ej. un «Resumen ejecutivo») se avisa
     y no pasa, ni el cierre «En …, a …» con su firma (lo pone la plataforma), y el formato
     de letra hecho a mano tampoco. Las tablas del Word que monta la
     plataforma llevan el ancho de cada columna (según lo que contiene), para que Google
     Docs las pinte igual que Word.
     Al subirla se puede escribir **qué has mejorado y por qué**: con esa nota y los
     párrafos que cambiaron en cada apartado frente a la versión anterior de Hermes, Hermes
     propone **lecciones** concretas («Pon el calendario en una tabla…»), generales o solo
     de esta licitación, con su evidencia. Salen en la memoria («Lo que Hermes aprende de tus
     cambios») para aceptarlas o descartarlas; las aceptadas entran en la redacción
     de los apartados de las próximas memorias (las de esta licitación, solo en ella). Solo vale una: al
     ensamblarse o subirse una versión nueva, las anteriores sin revisar (y sus evaluaciones) se
     descartan solas, y se dice en el aviso y en los de la versión nueva («Al llegar la versión 3, la
     versión 2 sin revisar pasó a descartada.»); al aceptar una se descarta la que estaba aceptada. Cada versión ensamblada **se evalúa sola** como la mesa: un tramo de la
     escala del pliego por apartado, los párrafos genéricos señalados y qué apartados
     quedan por debajo de su tramo máximo («Volver a evaluar» la repite). **Pedir cambios**
     abre primero «¿Qué quieres que cambie?» (texto libre que manda sobre la evaluación) y
     luego los apartados que se rehacen (marcados por defecto los que pueden subir, con su
     nota); crea la versión siguiente rehaciendo solo esos para su tramo máximo con su texto
     anterior, tus indicaciones y lo que dijo la evaluación de cada apartado; los demás se copian
     tal cual. Con indicaciones no hace falta esperar a la evaluación. Si la base es de un guion
     anterior con los mismos apartados, se rehacen también los que cambiaron de puntos, contenido
     o escala.
     Es la acción **Nueva versión** descrita en «Actualizar los apartados afectados».
  4. **Presentación.** Qué va en cada archivo, el registro de lo presentado y las
     propuestas parecidas. La **checklist** lista cada documento del guion por archivo
     electrónico (obligatorio o no, quién lo prepara) con su estado (pendiente,
     borrador, preparado, no aplica), dónde está (Salidas, Conocimiento o un enlace) y
     una nota; la memoria pasa sola a «preparado» al aceptar la memoria ensamblada, y lo
     que el guion añade entra pendiente. La **hoja de datos** reúne lo que se copia en
     los modelos y en la PLACSP (empresa y representante, expediente, lotes, importe con
     IVA o IGIC —tipo general, a confirmar—, cuota, total, baja y criterios automáticos
     con su casilla) y dice lo que falta. **Rellenar con Hermes** (si el modelo está en un
     pliego Word; un `.doc` necesita LibreOffice; un PDF con formulario se rellena campo a campo, ver abajo): Hermes rellena
     solo los huecos del anexo con la hoja de datos; la plataforma rechaza cualquier
     cambio en el texto del modelo y el importe si el precio no está decidido, saca ese
     anexo a `Salidas/…/anexos/<nombre>-vN.docx` (+ PDF) y lo deja en «borrador» con
     avisos (huecos que quedan por rellenar a mano). Si entre los pliegos hay un Word suelto
     con el mismo anexo («ANEXO V.docx» para el «Anexo V»; nunca el VI ni el «V bis» si no se
     pide; con varios, el que nombra el lote), se rellena ese en vez de buscarlo dentro del
     PDF del pliego, y la fila dice «Modelo tomado de «ANEXO V.docx»». Al guardar las decisiones, los
     anexos con modelo Word se piden solos (el económico, cuando el precio de su lote está
     decidido), pero **solo si cambió lo que llevan**: el económico, el precio de su lote y
     los criterios automáticos; las declaraciones, el equipo, los criterios y los lotes.
     Guardar solo el enfoque o las herramientas no rehace ninguno, y cambiar el precio del
     lote 2 rehace solo su anexo económico. Lo que una persona ya marcó «preparado» no se
     rehace, solo se avisa con lo que cambió («El anexo es anterior a que cambiara el precio
     del lote 2 (decisiones de las 16:02): si cambió algo que lleva, rehazlo con «Rellenar con
     Hermes».»). El
     lugar y la fecha salen de la hoja («a la fecha de la firma electrónica»); la firma
     siempre queda en blanco. Un **PDF con formulario** (AcroForm) se rellena campo a campo sin
     aplanarlo, así que una persona puede corregirlo, y se guarda como
     `Salidas/…/anexos/<nombre>-vN.pdf`; solo con el botón «Rellenar con Hermes» (los anexos
     automáticos son solo de Word); nunca se rellenan los campos de firma, los de solo
     lectura ni el del nombre de quien firma, y el importe solo con el precio decidido (se
     rechazan por el nombre del campo o por el valor); como el PDF rellenado es el documento
     entero del pliego, si trae más páginas que las de sus campos la plataforma avisa de que
     puede traer más anexos y hay que recortarlo a mano. Si
     el modelo es un PDF sin campos, dañado, protegido con contraseña o con formulario
     dinámico (XFA) y no hay un Word suelto con el mismo anexo, la checklist lo dice («El
     modelo es un PDF sin campos: rellénalo a mano.») y no se pide. Con lotes, lo que va por lote tiene
     una fila por lote y su anexo se rellena con los datos de ese lote; al poner un Word en
     una fila, se genera su PDF al lado. **Preparar paquete de presentación** copia en
     `Salidas/…/PRESENTACION/v<n> <fecha>/` lo que se sube a la sede: una carpeta por lote y
     sobre con los archivos numerados en el orden de subida, el índice del sobre si el
     pliego lo pide (con lo que de verdad va dentro), `VALORES_A_TECLEAR.md` (por lote, en
     cifra y en letras: lo tecleado en la sede prevalece), `INSTRUCCIONES.md` (plazo en hora
     peninsular, con la de Canarias si la empresa está allí, orden de firma y subida) y `MANIFIESTO.json`. Antes enseña lo que
     bloquea (plazo, obligatorios sin archivo, memoria sin aceptar, precio pendiente o
     fuera de límites, fugas entre sobres, «[A CONFIRMAR]» o resaltado amarillo, la memoria
     en PDF con más de dos páginas sobre el límite del pliego, la memoria en el archivo del
     precio o la oferta económica fuera de él) y los avisos (huecos, otro lote, sin PDF, la
     memoria una o dos páginas por encima, un PDF sin firma electrónica en un archivo que el
     pliego pide firmado, dos filas con el mismo nombre en una carpeta, la memoria con una
     fuente, una letra o un interlineado por debajo de lo que pide el pliego), cada uno con su enlace; con bloqueos se genera
     igual, marcado «NO PRESENTABLE TODAVÍA». Cada vez es una versión nueva: nunca se pisa
     la anterior. El paso 4 queda «Hecho» con un paquete al día y sin bloqueos o con la
     presentación registrada, y las comprobaciones piden el paquete cuando falta o está desfasado.
     **Registrar presentación del paquete vN** precarga una fila por lote con lo decidido
     (importe o precio por unidad: con precio por informe o por alumno, la baja se calcula
     sobre su máximo) y registra cada lote; la versión presentada se copia entera, con los
     firmados que se le hayan añadido, a DOCUMENTACION PRESENTADA en cuanto su carpeta
     está lista, sin pisar nada. La firma y la presentación en la PLACSP las hace siempre
     una persona.
- **Evaluar una propuesta con Hermes** (con ficha): se elige un documento
  (de la carpeta de la licitación en Salidas o su carpeta de presentada en Conocimiento
  —o, sin ella, la de sus pliegos—, o con su ruta; no hay
  ninguno elegido de entrada para no evaluar un pliego por error) y
  Hermes lo lee entero y da una puntuación estimada total y por criterio de la ficha con
  su justificación, qué **eliminar, modificar y reforzar** (con sección o página), las
  propuestas (primero las de Presentadas) y adjudicaciones parecidas con las que comparó y los riesgos. Solo se
  admite con los criterios de la ficha (los mismos, con la misma suma de
  pesos). Es una opinión orientativa, pendiente de revisar como la memoria (aceptar o
  descartar): el documento no se toca.
- **Propuestas anteriores parecidas:** mismo órgano, clase o división CPV, tipo de
  contrato y presupuesto parecido (de un tercio al triple), las ganadas primero, con
  su carpeta de presentada, sus documentos y lecciones.
- **Vista Presentadas:** histórico filtrable por resultado y texto (abre el detalle de
  la licitación) y estadísticas: tasa de éxito (ganadas entre ganadas, perdidas y
  excluidas) total, por sector (división CPV), por órgano y por banda de importe;
  importe ganado; nuestra baja frente a la ganadora (en lo que ganamos y en lo que
  perdimos, con la diferencia); y puntuaciones medias frente al ganador.
  **Aprendido de las actas:** en cada carpeta de `Presentadas/` donde el equipo deja el
  acta de la mesa, el informe de valoración o la resolución de adjudicación (se
  reconoce por el nombre, en la carpeta o sus subcarpetas, sin contar `PLIEGOS` ni
  `DOCUMENTACION PRESENTADA`), Hermes la lee sola (dos por minuto, una vez por carpeta)
  o al pulsar «Leer actas pendientes (N)»: puntos por criterio nuestros y del ganador,
  lo que dijo la mesa de nuestra oferta copiado literal (el servidor lo comprueba con el
  documento) y lecciones concretas comparando con nuestra memoria presentada. Entra
  pendiente; una persona lo acepta o lo descarta. Solo lo aceptado se usa: al redactar
  cada apartado de la memoria (lo que dijeron las mesas en criterios parecidos) y en las
  propuestas parecidas (mismo órgano o CPV).

## Mercado

Lo adjudicado en la PLACSP, para decidir a qué licitaciones ir y con qué precio.

### Panorama y Vencimientos

Panorama abre Mercado: lo adjudicado en los CPV
del perfil en los últimos 24 meses por trimestre (el último, más claro, aún no ha acabado),
quién gana con su cuota del importe y la nuestra en verde, los órganos que más compran y la baja
mediana por tramo de ofertas. Un lote adjudicado a varias empresas con el mismo importe es un
acuerdo marco que publica su techo en cada adjudicataria: cuenta como adjudicación, pero su importe
no suma ni aquí ni en los totales de Competidores, Organismos y sus fichas (la fila del contrato
enseña lo publicado), y la nota de la gráfica dice cuántos lotes se han dejado fuera. Vencimientos lista los contratos de nuestro mercado que acaban en
los próximos 12 meses: adjudicatario actual, fin estimado (las prórrogas no las publica la
PLACSP), cuándo se espera la nueva licitación según la antelación con que publica ese órgano y
con qué confianza. **«Avisarme»** sigue el contrato: cuando el órgano publique una licitación
abierta con su CPV a 4 cifras, entra en Oportunidades con la etiqueta **«renovación que
seguías»**, aunque no pase el prefiltro.

### Índices de mercado

Para cada licitación (o lote), con lo adjudicado en la PLACSP en
los últimos 5 años (lo reciente pesa más: la mitad cada 2 años): **ofertas esperadas** con su
rango y cuántos comparables tuvieron un solo licitador, **baja esperada** según cuántas ofertas
se esperan, con su rango y el umbral de anormalidad, **el órgano** (qué parte de lo que adjudica
en nuestro mercado se lleva el primero y si está concentrado) y **licitadores probables** con su
evidencia («ganó 4 parecidas (2 en este órgano); última vez en marzo de 2026») y su baja media.
Cada cifra dice su muestra (n, CPV al que se llegó) y su confianza; con menos de 10 comparables o
a 2 cifras de CPV no sale en la cabecera. Se rehacen cada noche para lo que seguimos. La pestaña
Mercado de la ficha los enseña enteros; las actas de expedientes ajenos (leídas solas)
suman a los licitadores que se presentan y no ganan.
Cada mes se comprueban hacia atrás contra lo adjudicado en los últimos 12 meses y la
ficha dice cuánto se desvían de media («La baja esperada se desvía de media 5,8 puntos»).

### Competidores

Quién gana en nuestro sector (los CPV de **Filtros** y del perfil de
la empresa) en los últimos 12, 24 o 36 meses o en todo el histórico, ordenado por
importe ganado, por contratos o por **coincidencias** con lo que seguimos (contratos en
órganos donde tenemos oportunidades vivas o de su misma clase de CPV; vivas son las
que preparamos o presentamos y las nuevas con el plazo abierto), con búsqueda
por nombre o NIF. La **ficha** de cada empresa muestra contratos ganados, importe total
y medio, baja mediana con su rango (P25–P75), cuántas ofertas había en los contratos que
gana, si es pyme, los órganos donde gana (enlazan a su ficha), sus CPV y comunidades
autónomas más frecuentes, la evolución por año (contratos, importe y baja), los últimos
contratos con enlace a la PLACSP y las oportunidades nuestras donde coincide; con
«Solo nuestro sector» se limita a nuestros CPV. Avisa de que **solo hay datos de los
ganadores**: la PLACSP no publica la lista de licitadores, así que no se sabe en cuántos
concursos participa una empresa sin ganar. **Seguir** la pone en la lista «Seguidos»
con notas del equipo. **Resumen con Hermes** pide a Hermes una nota con esos datos, que
llega como propuesta a la Biblioteca (carpeta `Competidores`) para aprobarla.
Competidores y Organismos se abren **a nuestra escala**: el territorio de la
escala de los rankings (Ajustes › Fuentes y filtros) y la banda de importe en la que licitamos
(percentiles 10 y 90 de nuestras presentadas; con menos de 5, la de esa escala), dicha arriba
(«Banda 7-130 k€ · Canarias»); sin escala guardada, toda España y todos los importes. «Toda España» y «Todos los
importes» quitan cada filtro y «Ver más» trae la página siguiente. Una empresa sale una sola
vez aunque la PLACSP la publique con distintas formas jurídicas, y un órgano, sin los cargos
del final («Ayuntamiento de X - Junta de Gobierno Local» → «Ayuntamiento de X»).

### Qué nos falta

Lo que piden las oportunidades seguidas y se acredita con un papel:
certificaciones (ENS en una sola fila con las categorías que piden —alta, media, básica o sin indicar—, ISO, CMMI, partner de fabricante…), seguro de
responsabilidad civil, clasificación empresarial y habilitaciones. Por cada una: cuántas
licitaciones lo piden, en cuántas no lo tenemos (y el importe en juego), cuántas nos deja
fuera por ser excluyente, lo que exigen y las licitaciones, que se abren. Por periodo
(12 o 24 meses, 3 años, todo) y por filtro: **Nos deja fuera en 2 o más** (por
defecto: las de una sola licitación son muchas y tapan lo importante), **Nos deja
fuera**, **Lo que nos falta** o **Todo**. Sale de los requisitos de la PLACSP y de las
fichas de Hermes, sin IA; sirve para decidir qué certificación sacar. Aparte, la
**experiencia del personal**: la materia que piden al equipo y nadie acredita, y cuántas veces
nos dejó fuera (también los descartes tipificados por solvencia que hablan del personal, como
los «5 años en monitorización de medios» de un pliego). La fila de elegibilidad de las comprobaciones dice
en cuántas de las licitaciones que seguimos nos dejó fuera esa misma barrera.

### Organismos

Qué órganos licitan en nuestro sector: licitaciones, importe licitado,
adjudicaciones, baja media, oportunidades que seguimos y una **puntuación de interés**
orientativa (0–100: volumen licitado 45 %, meses con licitaciones 35 %, baja moderada
20 %), ordenable por interés, importe o número de licitaciones. La ficha muestra cuánto
licita (en total, en el sector y abiertas ahora: publicadas, en el feed y en plazo), a quién adjudica (los que más ganan,
que enlazan a su ficha, y cuánto se lleva el primero), baja y ofertas, evolución por
año, últimas adjudicaciones y nuestras oportunidades con ese órgano; también se puede
seguir con notas. Desde el detalle de una licitación, el órgano y cada adjudicatario
abren su ficha.

## Aprendizaje

**Aprendizaje** (`#/aprendizaje`): qué mejoramos en cada oferta, por qué,
dónde se aplicó después y si sirvió. Cada oferta deja **lecciones** con su evidencia en un mismo
libro, de cuatro fuentes: la **edición** (al subir la memoria presentada se compara con la final
de Hermes, apartado a apartado, y Hermes propone lecciones de los cambios), la **mesa** (el acta de
valoración, criterio a criterio), la **decisión** y el **precio** (los saca el código del
resultado de la PLACSP: perder contra quien ya ganó varias veces en ese órgano; nuestra baja
frente a la ganadora y a la mediana del segmento). Ninguna guarda nombres de personas.

- **Por revisar:** tarjetas con el enunciado, el origen, el alcance, la fuerza (cuántas ofertas
  distintas la apoyan) y la evidencia a la vista, con **Aceptar**, **Ajustar el alcance** (general,
  solo esa licitación, su órgano, su CPV o su tipo de contrato, y el tema de apartado; con los
  valores de su licitación, sin teclear) y **Descartar**. Al lado, la última comparación y el
  efecto. También el **porqué** de los 3 cambios más grandes de una presentada que no se explican
  solos (tres opciones y un campo libre) y las **resoluciones sin acta**: dónde dejarla o que la
  PLACSP la publicó y se baja sola (el expediente de lo resuelto se revisa una vez al día).
- **Libro:** las aceptadas (y las retiradas), filtrables por tema, origen, fuerza y texto, con
  dónde se aplicaron («En 3 apartados de 2 ofertas · cumplida 2 de 3 · crítico 78 %»). Una se
  **retira** con su motivo; las que llevan un año aceptadas sin pasar a ninguna memoria se retiran solas.
- **Comparar:** por oferta, la memoria final de Hermes frente a la presentada: «32 cambios: 12 de
  especificidad · 8 de estructura…», con la barra por tipo y cada cambio.
- **Efecto:** los puntos de juicio de valor frente al ganador, oferta a oferta, con un cuadrado
  verde donde se habían aceptado lecciones nuevas, y la tasa de éxito por trimestre. Es una
  tendencia, no una prueba, y la pantalla lo dice.
- Al redactar, Hermes recibe las aceptadas que tocan a cada apartado por su tema, su alcance y el
  órgano, y queda apuntado dónde se pasó cada una; el crítico ciego dice después si se cumplen. En
  la **Revisión**, cada memoria enseña «Lecciones aplicadas (N)», y una lección de fuerza alta que
  no se aplicó o no se cumple sale como riesgo, que se acepta con un motivo. Hermes consulta el
  libro (con su alcance y dónde se aplicó cada lección) antes de proponer una lección nueva, de
  decidir si ir o de proponer un precio.
- Un párrafo que se repite en 3 ofertas o más que funcionaron (ganadas o bien puntuadas por el
  crítico) se propone como nota de la Biblioteca («Párrafo que se repite»), una sola vez.

## Biblioteca de Conocimiento

La carpeta Conocimiento de tu Drive: notas markdown
y documentos (PDF, Word, Excel, PowerPoint, Google Docs…).

- Notas con backlinks y renombrado que actualiza enlaces. Para conversar con la
  Biblioteca se usa Hermes (skill `biblioteca` o MCP), no un chat propio.
- Búsqueda en notas y dentro de los documentos, por palabras y **por significado**
  («fianza» encuentra «garantía»), con un modelo que corre en el propio servidor. Los
  documentos se abren desde la búsqueda; los PDF escaneados (sin texto) y los de texto codificado (sale como símbolos) se señalan.
- **Propuestas:** notas que propone Hermes u otro agente (p. ej. el resumen de un
  competidor o lo que convierte de un documento subido) y que apruebas o rechazas; al
  aprobarlas se guardan junto a su documento. Cada una dice qué agente la propuso. Los
  pliegos del radar no generan notas: su análisis es la ficha de la licitación.
- **Subir documento:** a la carpeta que elijas de la Biblioteca (PDF, Office,
  OpenDocument, texto, XML o markdown, hasta 100 MB); llega a Drive en un minuto y nunca
  reemplaza un archivo con el mismo nombre.
- **Explorar** (la pestaña principal): las notas con su **tipo** (caso de
  éxito, metodología, ficha de servicio, normativa del cliente, oferta presentada o
  plantilla; del frontmatter `tipo` o, sin él, deducido de la carpeta y marcado con «*»), su
  carpeta, **en cuántas ofertas se ha usado** (las que Hermes leyó mientras trabajaba en cada
  oferta) y cuándo se revisó, con **Revisar** si lleva más de 12 meses sin revisar
  (`revisada_en` del frontmatter o, sin él, la última modificación). Filtros por tipo, sector y
  estado; el índice dice en una línea cuántos documentos y notas tiene leídos y cuántos PDF
  escaneados. Una fila abre la nota; la referencia sigue siendo Drive.
- **Propuestas de Hermes**, con su origen (desde un documento, un párrafo que se repite o un
  acta) y su tipo, y **Editar antes** (título y cuerpo) además de Aprobar y Rechazar.
- **Documentos sin nota:** lo de Drive que aún no tiene nota, con **Pedir nota** uno a uno o
  **Pedir las N notas a Hermes** en bloque; los PDF escaneados salen como «No se puede leer».
- **Huecos:** lo que han pedido los pliegos de los últimos 6 meses (criterios de valoración y
  requisitos de experiencia, solvencia técnica, certificaciones y medios de las fichas) y la
  Biblioteca no respalda: nada, solo documentos sin nota o una nota sin revisar. Cada uno con
  **Pedir borrador a Hermes** (llega a Propuestas, carpeta Borradores) o **Revisar nota**. Sin la
  búsqueda por significado lista, no se calculan.

### Google Drive

**Google Drive** (en **Ajustes**). Conectas tu cuenta y eliges una carpeta, que
pasa a ser la fuente de la verdad de Hermes. `Conocimiento`, `Agent Studio` (sus
`skills` se convierten en skills de Hermes) y `Salidas` se sincronizan en ambos
sentidos, cada minuto o en segundos si algo cambia en el servidor. Los Google Docs se
leen convertidos a Office. Cada día se sube una copia de seguridad de los datos de
Hermes (las bases de datos de la plataforma, una vez por semana por defecto); se puede
desactivar con `GDRIVE_BACKUP=0` si el VPS ya tiene copia, y el panel dice si está activa
y cuándo fue la última (docs/operacion.md → «Copia de seguridad»).

### Hermes usa la Biblioteca

**Hermes usa la Biblioteca** con la skill `biblioteca` (se instala sola): busca antes
de responder, lee documentos por partes con sus páginas, lista los documentos que aún
no tienen nota y propone notas. Nunca escribe directamente en la Biblioteca.

## Equipo

**Equipo** (`colaboradores` en el MCP). Personas del equipo y externas con lo que pueden
acreditar en una licitación: rol, titulaciones, certificaciones, años de experiencia,
sectores y CPV con experiencia, tecnologías y habilidades, idiomas con nivel, **horas de
docencia por materia** (horas, años y evidencia: «IA generativa · 160 h · 2024-2026 · CV,
pág. 3»), tarifa opcional, su CV en `Conocimiento/Colaboradores/` y notas. Cuatro pestañas:
Personas, Buscar por requisito, CV por revisar y A incorporar.

- **Personas:** lista con filtros (equipo o externos, texto, inactivos) y la ficha al
  lado; alta y edición a mano; «Dar de baja» las saca de las búsquedas sin borrarlas y
  «Borrar» elimina sus datos y sus perfiles leídos, también los rechazados (el CV
  sigue en Drive).
- **Disponibilidad calculada**, no declarada: con un contrato ganado en ejecución, «No
  disponible» (hasta su fin, si se conoce); con dos o más ofertas en curso (en preparación o
  presentadas), «Parcial»; si no, «Disponible». Sale del equipo de las decisiones de cada oferta.
- **Ficha:** lo que acredita (la docencia con su evidencia), **dónde está** (cada oferta con su
  rol y estado, o el contrato en ejecución) y cuántas ofertas resueltas se ganaron con ella.
  Avisa si su **CV se leyó hace más de 12 meses** o si hay un CV nuevo por revisar.
- **Alta desde CV:** el CV se sube a `Colaboradores/` y **Hermes** lo lee y propone el
  perfil (sin datos de contacto ni DNI; con las horas de docencia y la página del CV de cada
  una). Queda en **CV por revisar** hasta que alguien lo revisa, lo corrige si hace falta y
  lo aprueba (o lo rechaza). Si el CV es de alguien que ya está dado de alta, se actualiza su
  ficha y se conservan su tarifa y notas. «Releer CV con Hermes» repite la lectura y «Subir CV nuevo», en su
  ficha, sube su CV actualizado y lo enlaza a esa persona (sin duplicarla).
- **Buscar por requisito:** se pega un requisito de un pliego («Docente con al menos 150 h
  impartidas en IA en los 3 últimos años y titulación universitaria») y sale qué se puede
  comprobar (años, titulación, certificaciones, idiomas y horas de docencia en la materia y el
  periodo) y quién encaja, como en el bloque Equipo. Si nadie cumple, lleva a «A incorporar».
- **A incorporar:** los perfiles que una oferta se comprometió a incorporar sin nombrar a nadie,
  con los requisitos, la fecha límite para acreditarlo (con su cláusula) y el candidato.
  «Buscar candidatos» abre la búsqueda con sus requisitos, donde cada persona se puede proponer
  como candidato; «Marcar cubierto» lo da por resuelto.
- Son datos personales: no salen en los logs, y los eventos y la auditoría solo
  guardan el id de la persona (la ruta de un CV, como hash). Los CV de
  `Colaboradores/` nunca se convierten en notas de la Biblioteca, y un agente sin
  permiso para ver colaboradores no los encuentra ni los lee.

## Hermes y los agentes

Qué hace la IA, cómo trabaja y con qué herramientas. Hermes solo propone: una persona decide.

### Actividad

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

### Consola

**Consola** (Hermes). El dashboard oficial de Hermes (chat, canales, modelos, perfiles,
skills, cron, archivos, logs…) sin segundo login.

### Hermes trabaja las licitaciones

**Hermes trabaja las licitaciones** con la skill `licitaciones` (también se instala
sola, en Hermes y en cada perfil) y las herramientas MCP de la plataforma. La skill
va partida por fase: `SKILL.md` es el núcleo (herramientas, principios, carpetas y
estados) y cada fase vive en `references/` (cribar, ficha, guion, decisiones, memoria,
anexos, revisión previa, propuestas y actas, mercado); Hermes lee solo la de su tarea. Al
empezar, lee el veredicto y los bloqueos de la oferta y, con un «impide» de negocio, avisa y
no produce; en la revisión previa propone con evidencia y no aplica.

### Hermes conoce su entorno

**Hermes conoce su entorno** con la skill `entorno` (también se instala
sola): trabaja con las carpetas de Drive en local (`/opt/data/…`) en vez de por la API,
sabe qué son los Google Docs de `.gdocs`, dónde viven las skills de la empresa y dónde
está su orden `hermes`.

### Agentes (MCP)

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

### Propuestas de la IA

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

### Qué hace Hermes solo y cuándo no gasta cuota

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

### Estado y programación

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

## Administración

Configuración de la empresa, usuarios, avisos, integraciones e instalación.

### Ajustes

**Ajustes**, al pie de la barra lateral, en nueve pestañas:
**Empresa** (el perfil, con el nombre comercial y la zona horaria, y la carpeta Empresa),
**Marca** (nombre de la app, colores con su contraste AA comprobado y logo; solo admin),
**Usuarios y permisos**, **Avisos**, **Fuentes y filtros** (el estado del radar: cuentas,
ingesta, histórico de adjudicaciones, oportunidades, pliegos y fichas; la **auditoría de
cobertura** por comunidad con el formulario para apuntar la cifra autonómica; la **calidad del
dato**: adjudicaciones con importe por encima de 1,2 veces el presupuesto, baja de más del 70 %,
0 ofertas, NIF no válido o lote sin importe, con ejemplos y cuántas quedan fuera de los índices,
los pliegos que no se pueden leer, cuánto aciertan los índices y las actas ajenas leídas; y el
**prefiltro de entrada** y la **escala de los rankings** de competencia: territorio y banda), **Drive** (la conexión, las carpetas de Conocimiento, la **carpeta
única por licitación** —el ensayo, que dice qué se movería a `Licitaciones/Ofertas/` sin tocar
nada, y la migración, con confirmación y copia previa de las bases—, y la carpeta de notas de
la Biblioteca; ver «Carpeta de cada licitación» en [operacion.md](operacion.md)), **Hermes** (lo operativo: perfiles de oferta, tareas programadas, trabajos por oferta y fichas de Hermes) e
**Integraciones** y **Acerca de** (la versión, la licencia y el enlace al código fuente). Las direcciones alternativas (`#/ajustes/filtros-licitaciones`,
`…/estado-licitaciones`, `…/biblioteca`) llevan a su pestaña.

### Login y usuarios

Cada persona entra con su **email** y su contraseña de Hermes (12
caracteres como mínimo, guardada con scrypt). Un `admin` da de alta en **Ajustes › Usuarios
y permisos** con una contraseña temporal que la persona cambia en su primer acceso (hasta
entonces la web solo le deja cambiarla). Ahí mismo cambia roles, da de baja (la sesión se
cierra al momento) y pone otra contraseña temporal; cada persona cambia la suya en la misma
pestaña, y al cambiarla se cierran sus otras sesiones. Tiene que quedar siempre un admin
activo. Roles:

| Rol | Puede |
|---|---|
| `admin` | Todo: también decidir el precio, Empresa y costes internos, usuarios, avisos, Drive y la Consola de Hermes |
| `editor` | Aplicar oportunidades, preparar ofertas, decisiones salvo el precio, memoria y lecciones |
| `lector` | Ver (los botones que guardan salen desactivados), salvo Colaboradores (los CV) y la actividad en vivo de Hermes, que son de `editor` |

Lo que alguien guarda (decisiones, descartes, bloqueos de las comprobaciones, lecciones, revisiones,
pliegos subidos) queda con su nombre: lo pone el servidor desde la sesión, no lo que mande
el navegador. El login por variables de entorno (`MONITOR_BASIC_AUTH_*`, distinto del del dashboard de
Hermes, que no lo recibe) crea el primer `admin` al arrancar sin usuarios, y en cuanto ese
admin elige su contraseña deja de entrar: solo mientras ningún admin activo tenga la suya
sirve como **acceso de emergencia** (entra como admin, firma «Acceso de emergencia» y deja
aviso en el log), y las sesiones de emergencia abiertas caen al instante. Quien pierda el
acceso ejecuta dentro del contenedor del monitor `recuperarAcceso.js <email>`, que pone una
contraseña temporal al admin y le obliga a cambiarla al entrar. En Dokploy es obligatorio (y el secreto de
sesión `MONITOR_SESSION_SECRET`); en local, sin él el monitor queda abierto (uso de
escritorio, sin personas). La sesión se renueva sola mientras se usa (se cierra tras 12 h
sin usar el monitor o 7 días desde el login; un despliegue no la cierra) y **Salir** la
invalida. Si caduca con la web abierta, vuelve la pantalla de login. Tras 10 fallos desde una
IP, o 30 por minuto en total, el login se frena un rato. Solo se aceptan cambios y WebSockets
que vengan de la propia web (cabecera `Origin`).

### Avisos por email

**Avisos por email** (Ajustes › Avisos). Salen por el SMTP del correo de la empresa, con la
marca de la instalación, y ninguno lleva precios, costes ni datos de CV:

- **Resumen semanal**: el día y la hora (en la zona de la empresa) que elige un admin (por defecto, lunes a las
  8:00), a las personas que marca y con lo que elige: lo que cierra en los próximos 7 días, 5
  nuevas por revisar (las que cierran antes o, con el encaje calibrado, las de más encaje), las novedades (resoluciones de nuestras presentadas, competidores que
  seguimos que ganan algo, órganos que seguimos que publican) y las lecciones por revisar. Tiene
  vista previa y «Enviarme una prueba». Los demás lo ven en lectura.
- **Tus avisos**, que elige cada persona: plazo a menos de 48 h con algo que impide presentar o
  el precio sin decidir (dice qué falta, por categorías), el resultado de una presentada cuando lo
  publica la PLACSP (con el botón para subir el acta), las nuevas de sus búsquedas guardadas
  (cada día o cada semana, según la búsqueda) y los documentos de la carpeta Empresa que van a
  caducar (sin los CV) y las menciones en comentarios (todas las pendientes juntas en un email,
  al minuto, con quién te menciona y dónde, sin el texto).
- Cada aviso sale una vez. Sin SMTP configurado no sale ninguno (Ajustes lo dice).

### Calendario

**Calendario** (Ajustes › Integraciones): cada persona crea un enlace ICS y se suscribe desde
Google Calendar u Outlook. Lleva la fecha de cierre (y la solicitud de participación, si la hay) de
cada oferta en preparación, con el título y el órgano, en hora de Madrid con su zona: cada
calendario la enseña en su hora (Canarias o península). El enlace se ve una sola vez al crearlo;
«Revocar» o crear otro lo corta al momento. Lleva también los hitos sin hacer de las ofertas que
llevas tú o no lleva nadie.

### API de lectura para BI

**API de lectura para BI** (Ajustes › Integraciones, solo `admin`): un token por
integración (Power BI, una hoja de cálculo…), que se ve una sola vez al crearlo y se revoca al
momento. `GET /api/v1/pipeline`, `/presentadas` (con resultado, puntos y ganador), `/indices`
(los índices de mercado de cada segmento) y `/lecciones` (las aceptadas), con la cabecera
`Authorization: Bearer <token>`; solo lectura, por páginas (`desde` y `limite`, hasta 5.000) y
sin datos de personas, costes, notas ni documentos. Al lado, el estado del **MCP**: agentes con
acceso, última llamada y llamadas en 24 horas.

### Aspecto

Fondo blanco, texto en azul corporativo y DM Sans. El color dice
quién hizo qué: el verde es tu acción y lo decidido (un solo botón verde por vista; las filas de la Revisión pueden tener varios), el
lavanda lo que propone o hace Hermes, y el rojo y el ámbar solo «Impide» y «Riesgo», siempre
con su palabra. No hay modo oscuro. En móvil, la lateral es un cajón y las listas, la ficha y
la Oferta y la Revisión caben a 400 px sin desplazarse de lado. Todas las secciones comparten cabecera
(migas, título, acciones y pestañas).

### La instalación

Nada de una empresa concreta está en el código. La marca (nombre de la app,
colores y logo) la cambia un admin en **Ajustes › Marca** y va en `nucleo.db`; sin ella, el
sobre y los colores neutros de Sobre Abierto. La web la lee de `GET /api/config` y el logo de
`GET /api/marca/logo`. Lo de la empresa va en su perfil: el nombre comercial con que la nombran
las tareas de Hermes y la memoria, la zona horaria y las áreas de formación. Del entorno solo salen `APP_URL` (la
dirección pública) y `APP_SOURCE_URL`: el enlace al **código fuente** del pie de la barra
lateral y de Ajustes › Acerca de, que pide la AGPL.

### Instalación y actualización

Se instala con `install.sh` (o con el Compose de la raíz, o desde un panel) y
se actualiza cambiando `SOBRE_ABIERTO_VERSION`; el primer administrador es el correo y la contraseña inicial que
enseña el instalador, y cambia la contraseña en su primer acceso (desde entonces la del `.env` deja de entrar; el acceso se recupera con un comando dentro del contenedor). Ver el README y `docs/operacion.md`.
