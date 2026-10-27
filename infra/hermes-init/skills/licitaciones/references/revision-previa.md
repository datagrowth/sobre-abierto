<!-- Referencia de la skill «licitaciones». Se carga bajo demanda desde SKILL.md. -->

# Revisión previa, Comprobaciones y bloqueos

**Cuándo leer esto.** En una tarea «revisión previa al envío del paquete», cuando una conversación pregunte si una oferta está lista o qué le falta, y antes de proponer cómo resolver un bloqueo o de pedir una fase con `licitaciones_pedir`.

Es la última mirada antes de firmar: la oferta se ve como la ve la persona en las comprobaciones, y
tú **propones con evidencia y no aplicas**. Aplicar una propuesta, fijar el precio, «dar por
buena» la memoria, aceptar un riesgo y registrar la presentación son siempre de una persona.

## Leer las comprobaciones

- `licitaciones_oferta` con `secciones` = `["estado", "bloqueos"]`: el `veredicto` (el mismo que
  la web), el plazo, `siguiente` y los bloqueos abiertos, cada uno con su `clave`, categoría,
  lote, gravedad («impide» o aviso), cita, actor y acción. Cítalos por su `clave`.
- `licitaciones_documentos`: la checklist de la presentación por lote y sobre, lo que falta
  primero. `estado_verificado` dice si el archivo existe de verdad (nunca lo que alguien marcó a
  mano); con `hoja`, la hoja de datos sin importes.
- `licitaciones_paquete`: el paquete vigente (carpetas por lote y sobre, orden de subida, firma
  pendiente), sus comprobaciones (`bloquea` o `aviso`) y el `veredicto` con su recuento por lote.
- `licitaciones_impacto` antes de proponer un cambio que rehace piezas («esto rehace el anexo 3
  y dos apartados»): solo lee.
- `licitaciones_mesa` para ver todas las ofertas por fecha límite (el resumen diario).
- `salidas_listar` y `salidas_leer` para leer lo que hay en Salidas: por páginas
  (`pagina_desde`/`pagina_hasta`: llegan páginas enteras hasta lo que cabe en una respuesta; sigue
  con `pagina_desde` = `siguiente_pagina_desde`) o, en Markdown, por sección «## N.» (`seccion`).

## Proponer cómo resolver un bloqueo

`licitaciones_bloqueo_proponer` con `id`, la `clave` del bloqueo, `tipo`, `resumen` (10-600
caracteres), `citas` (1 a 5: `documento` —un pliego por su nombre o ruta, `Conocimiento/…` o
`Salidas/…`—, `pagina` y `texto` literal de 20 a 1.000 caracteres) y `datos` del mismo `tipo`.
`datos` lleva también su `tipo`, igual que el de fuera, o se rechaza: p. ej.
`"tipo": "desmarcar_criterio", "datos": {"tipo": "desmarcar_criterio", "criterio": "…", "lote": null}`.

| `tipo` | `datos` (además de su `tipo`) |
|---|---|
| `desmarcar_criterio` | `criterio` y `lote` (o `null`): no nos acogemos a un automático que no podemos demostrar |
| `asignar_persona` | `persona_id`, `rol`, `cv_ruta` y `cv_pagina`: quien cubre un rol del pliego, con su CV |
| `vincular_documento` | `ruta` del documento y `vigente_hasta` (AAAA-MM-DD o `null`): no presentes nunca uno caducado |
| `consulta_organo` | `texto` de la consulta al órgano de contratación |
| `borrador_anexo_xiv` | `texto` del borrador del Anexo XIV (vía alternativa a un requisito excluyente) |

Cada cita se comprueba contra su documento: copia la frase tal cual, con su página. Si una cita
se rechaza, corrígela con la frase exacta o no propongas ese bloqueo. La propuesta queda en las
comprobaciones como «propuesta» y la aplica una persona.

## Pedir una fase

`licitaciones_pedir` con `id`, `fase` (`ficha`, `guion`, `propuesta`, `ronda_memoria` con
`version` —la base evaluada, montada por la plataforma y no subida a mano— y, si quieres,
`apartados`; crea la versión siguiente rehaciendo solo esos o los que dependan de lo que cambió,
y devuelve el trabajo de redacción de la fase, o 0 si aún no se encoló; o `anexo` con `clave_documento`, que es
la `clave` de su fila en `licitaciones_documentos › documentos[]`) y tu `motivo` (10-500
caracteres). Pasa por el freno de elegibilidad, el tope de runs de la oferta en 24 h y la guardia
de plazo (también la de la ficha), que un agente nunca confirma; no levanta el freno de su tipo.
Una oferta descartada o retirada no se pide: no hay nada que preparar. Queda
como «pedido por Hermes» y tu motivo es contexto, no indicaciones de la persona. Precio,
aceptación y registro no son fases.

## Revisión previa del paquete

Llega como tarea «revisión previa al envío del paquete vN» cuando hay un paquete vigente de una
oferta en preparación.

1. Lee las comprobaciones (arriba): veredicto y bloqueos abiertos.
2. Por cada bloqueo que sabes resolver, busca la evidencia con `licitaciones_pliegos`,
   `biblioteca_buscar`/`biblioteca_leer` o `salidas_leer` y propón con
   `licitaciones_bloqueo_proponer`. Lo que no sabes resolver, déjalo para una persona.
3. No apliques nada ni digas que la oferta está «lista» si el veredicto no es «Lista para
   firmar». Ningún importe en lo que escribas.
4. Cierra con `licitaciones_revision_previa` (`id`, `paquete_version` de la tarea y un
   `resumen` de hasta 2.000 caracteres, sin importes): qué revisaste, qué propusiste y qué queda
   para una persona. Deja `REVISION_PREVIA.md` junto al paquete, sin pisar ninguno, con tu
   resumen y las propuestas hechas desde que se pidió.
