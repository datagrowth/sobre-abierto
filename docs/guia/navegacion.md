# Navegación

Cómo se mueve uno por la web: qué hay en la barra lateral, qué direcciones existen, cómo se ve en el móvil y qué pasa
cuando se despliega una versión nueva con la pestaña abierta.

<!-- captura: navegacion · La barra lateral con Pipeline, Oportunidades, Mercado, Aprendizaje, Biblioteca y Equipo, y la pastilla de Hermes al pie -->

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

## Aviso de versión nueva

Tras un despliegue, la pestaña que seguía abierta con la web anterior
muestra una banda «Hay una versión nueva de la plataforma. Recarga para seguir guardando» con
un botón **Recargar**; nunca recarga sola, para no perder lo que se está escribiendo. La web
lo comprueba cada 5 minutos, y también si el servidor rechaza un guardado: una pestaña con la
web anterior recibe un `409 version_antigua` en vez de guardar con un formato viejo (no se
guarda nada), y el aviso sale al instante. Lo que consulta la API sin ser la web (agentes,
`curl`) no se comprueba. Si una recarga automática de una lista o de una ficha falla, se
siguen viendo los datos de antes con un aviso para reintentar, en vez de dejarla en blanco.

## Aspecto

Fondo blanco, texto en azul corporativo y DM Sans. El color dice
quién hizo qué: el verde es tu acción y lo decidido (un solo botón verde por vista; las filas de la Revisión pueden tener varios), el
lavanda lo que propone o hace Hermes, y el rojo y el ámbar solo «Impide» y «Riesgo», siempre
con su palabra. No hay modo oscuro. En móvil, la lateral es un cajón y las listas, la ficha y
la Oferta y la Revisión caben a 400 px sin desplazarse de lado. Todas las secciones comparten cabecera
(migas, título, acciones y pestañas).
