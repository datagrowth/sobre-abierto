# Revisión y la Mesa

La Revisión es la última parada antes de firmar: junta lo que dicen las comprobaciones de cada documento. La Mesa saca
de todas las ofertas la siguiente tarea de cada persona y de Hermes.

<!-- captura: revision · La Revisión con lo que impide presentar y una tarjeta por sobre -->

## Revisión

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

## La Mesa

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
