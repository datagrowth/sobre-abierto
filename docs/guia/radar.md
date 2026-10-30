# Radar de licitaciones

El radar trae las licitaciones a la plataforma: descarga la PLACSP, pasa un prefiltro amplio y deja que Hermes cribe
lo que queda. Aquí están también las reglas de los lotes, el idioma, la auditoría de cobertura y el histórico.

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

## Lotes

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

## Idioma

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

## Auditoría de cobertura

**Auditoría de cobertura**: cada lunes cuenta, por comunidad
autónoma (NUTS 2 del lugar de ejecución), las licitaciones de nuestro sector que trajo la
PLACSP la semana que cerró, por separado la agregada (plataformas autonómicas y entidades
locales) y los perfiles, y repasa las tres anteriores. La cifra de cada plataforma
autonómica se apunta a mano por semana (`PUT /api/licitaciones/cobertura/autonomica`, con
de dónde sale) y el informe (`GET /api/licitaciones/cobertura`, MCP `licitaciones_cobertura`)
dice qué le falta a la agregada: con más de un 5 %, «añadir fuente». Se ve y se apunta en
**Ajustes › Fuentes y filtros**. Solo informa: sirve para decidir si se
añade alguna fuente directa.

## Histórico

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
