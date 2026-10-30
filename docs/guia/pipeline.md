# Pipeline

El Pipeline es la pantalla con la que se abre la web: las ofertas en curso, desde que se decide ir hasta que se
resuelven, con quién lleva cada una, sus hitos y los comentarios del equipo.

<!-- captura: pipeline · El tablero del Pipeline con las cinco columnas y una tarjeta por oferta -->

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

## Responsable e hitos

**Responsable e hitos**: quien pulsa **Aplicar** o **Preparar la oferta** pasa a llevarla
(si nadie la llevaba); en la cabecera de la ficha se ve su avatar y un `editor` o `admin` se la da
a otra persona del equipo o a nadie. Cada oferta en preparación tiene cuatro hitos contados hacia
atrás desde la hora interna de cierre: **Decidir si vamos** (D-10), **Decisiones y precio** (D-7),
**Memoria dada por buena** (D-3) y **Paquete y firma** (D-1). Un hito está hecho cuando su fase
de las comprobaciones lo está; si el plazo se rectifica, se mueven solos. «¿Llegamos?» dice el próximo (o
el vencido, en ámbar). Un hito pasado sin hacer es un riesgo de las comprobaciones, una sola fila con el
último vencido y cuántos anteriores faltan, que se acepta con motivo; su fecha ordena la lista de
lo que te toca y va al calendario de quien lleva la oferta.

## Exportar CSV

**Exportar CSV**: el Pipeline (vista Lista), Oportunidades (la pestaña con sus filtros),
Presentadas, Competidores, Organismos y las adjudicaciones comparables de un índice (pestaña
Mercado de la ficha) se descargan enteros, no solo la página a la vista, en CSV para Excel en
español: UTF-8 con BOM, separador «;», coma decimal y las bajas como porcentaje. Ajustes ›
Integraciones › Exportar tiene los cinco listados con lo de por defecto de su vista.

## Comentarios con menciones

**Comentarios con menciones**: hay un hilo en la Oferta («Comentarios del equipo»), en
cada comprobación de la Revisión y en cada requisito. Cualquiera comenta, también un `lector`;
**Mencionar** añade «@Nombre» de alguien del equipo. Una mención cuenta en la barra lateral, bajo
tu nombre («2 menciones sin leer», con la lista para ir a cada una), se da por leída al abrir la
pestaña donde está y, si tienes activado el aviso de menciones, te llega por email. Quien
escribió o un `editor` lo da por **Resuelto** (o lo reabre).
