<!-- Referencia de la skill «licitaciones». Se carga bajo demanda desde SKILL.md. -->

# Propuestas, evaluaciones y actas de mesa

**Cuándo leer esto.** En una tarea de evaluación (de un documento con «Evaluar» o de una memoria recién ensamblada: sección «Evaluar una memoria con la escala del guion»), en una tarea de aprender de un acta (sección «Aprender de un acta de mesa»), en la de leer el acta de una licitación ajena (sección «Leer el acta de un expediente ajeno») y cuando pregunten por lo que hemos presentado y sus resultados.

## Propuestas: registro y evaluación

Las personas registran en la web lo que presentamos (lote, fecha, importe, documentos) y,
cuando se sabe, las puntuaciones. El resultado lo pone el código con la adjudicación de la
PLACSP (ganada si el adjudicatario es el NIF del perfil de la empresa) o una persona.
`licitaciones_propuestas` lo lee; tú nunca lo cambias.

### Evaluar una propuesta

Llega como tarea automática cuando alguien elige un documento y pulsa «Evaluar» (exige
ficha), y sola cada vez que la plataforma ensambla una memoria. No modifiques el documento.
Si la licitación tiene guion con memoria (o el documento es una memoria ensamblada), la vara
son **los apartados del guion** y la tarea los trae con su escala: sigue «Evaluar una memoria
con la escala del guion». Si no, la de la ficha:

1. `licitaciones_ver`: los criterios de la ficha (`go_no_go.ficha.aprobada.datos.criterios`,
   no `datos.criterios`, que son los de la PLACSP en bruto) son la vara de medir. Con lotes
   de interés (`go_no_go.ambito.lotes`), la propuesta es para esos lotes.
2. Lee el documento entero, por partes y hasta el final (`salidas_leer` para `Salidas/…`,
   `biblioteca_leer` para `Conocimiento/…`), anotando sección y página.
3. Compara con lo parecido, primero con lo presentado: `licitaciones_propuestas`
   (`parecidas`, con resultado, puntuaciones y `carpeta`), sus documentos,
   `biblioteca_buscar` con `carpeta` = `Licitaciones/Presentadas` y
   `licitaciones_comparables`.
4. `licitaciones_evaluacion` con todo de una vez. Reglas que comprueba el servidor:
   `puntuacion` de cada criterio ≤ su `peso`; `puntuacion_total` = suma de las
   puntuaciones; `puntuacion_maxima` = suma de los pesos (vale 0 si el pliego no puntúa la memoria; y si el guion vigente la da por no valorable, el servidor rechaza la evaluación); los criterios son los de la ficha
   (los mismos y con la misma suma de pesos); sin campos de más. Sé exigente y concreto:
   cada sugerencia con su `referencia` (sección o página).

```json
{
  "id": "p-20435341",
  "documento": "Salidas/Licitaciones/E2026016793 (p-20435341)/memoria.docx",
  "resumen": "Memoria sólida en metodología, floja en equipo y plan de calidad.",
  "puntuacion_total": 70, "puntuacion_maxima": 100,
  "criterios": [
    { "criterio": "Precio", "peso": 60, "tipo": "formula", "puntuacion": 48, "justificacion": "Con la baja prevista (mediana del segmento)." },
    { "criterio": "Memoria técnica", "peso": 40, "tipo": "juicio_valor", "puntuacion": 22, "justificacion": "Metodología genérica, sin hitos.", "referencia": "2. Metodología, pág. 6" }
  ],
  "eliminar": [{ "referencia": "1. Presentación, pág. 2", "que": "La historia de la empresa no puntúa y gasta páginas." }],
  "modificar": [{ "referencia": "3. Plan de trabajo", "que": "Ajustar el calendario a los hitos del PPT." }],
  "reforzar": [{ "referencia": "4. Equipo", "que": "Nombrar a las personas con su experiencia en el CPV." }],
  "comparables": [{ "tipo": "propuesta", "referencia": "p-18431943 lote 3", "resultado": "ganada", "parecido": "Mismo tipo de servicio; ganó con equipo nominal." }],
  "riesgos": [{ "descripcion": "Supera el límite de 30 páginas", "gravedad": "alta" }]
}
```

### Evaluar una memoria con la escala del guion

Puntúa **como la mesa**: la tarea trae cada apartado con «se valorará», su **escala literal**
(tramos con puntos y descripción) y las advertencias del pliego (p. ej. «no se valorarán las
manifestaciones genéricas…»). Para cada apartado elige el tramo que le daría la mesa y cítalo.
Tu evaluación decide qué apartados se reescriben al pulsar «Mejorar» y con qué indicaciones.

- `criterios`: **uno por apartado y en su orden**, con `apartado` (1 = el primero),
  `criterio` (el título literal), `peso` (sus puntos), `tipo` `juicio_valor`, `tramo` (los
  puntos de uno de los tramos de su escala) y `puntuacion` (la del tramo; nunca más). La
  justificación cita el tramo y dice qué falta para el siguiente. Los criterios automáticos y
  el precio no se puntúan aquí: van en otro archivo.
- `genericos`: cada párrafo que la mesa no puntuaría (no dice quién, cuándo ni con qué
  medida; es meramente declarativo; o repite el pliego), con `referencia`, `texto` **literal**
  del documento (hasta 300 caracteres; si lo recortas, une los trozos literales con «…») y
  `por_que`. En una memoria ensamblada el servidor comprueba que el texto está tal cual.
- `eliminar`, `modificar` y `reforzar` con una `referencia` que **empiece por el número y el
  título del apartado** («2. Gestión de incidencias… — Indicadores»): así cada indicación
  llega a la redacción de ese apartado.
- `memoria` la pone la plataforma; no hace falta enviarla.

Rechazos (frase exacta): «Puntúa los 4 apartados de la memoria del guion (v3)…» (faltan,
sobran o hay criterios de la ficha), «El criterio del apartado 1 es «…», de 8 puntos y de
juicio de valor…», «Falta «tramo» en el apartado 1…», «El tramo 6 no está en la escala del
apartado 2 (0, 3, 5 o 7).», «En el apartado 3, la puntuación (6) pasa de su tramo (5)…»,
«Estos «genericos» no están tal cual en la memoria v3: …».

```json
{
  "id": "p-12345678",
  "documento": "Salidas/Licitaciones/101-2026 (p-12345678)/memoria-v3.docx",
  "resumen": "Memoria concreta en organización y asesoramiento; los indicadores no tienen meta y las mejoras no dicen qué gana la entidad.",
  "puntuacion_total": 19, "puntuacion_maxima": 25,
  "criterios": [
    { "apartado": 1, "criterio": "Organización y metodología del servicio", "peso": 8, "tipo": "juicio_valor", "tramo": 8, "puntuacion": 8, "justificacion": "Tramo de 8: roles con nombre, procedimiento de consultas con plazos y coordinación mensual con la Asesoría Jurídica.", "referencia": "1. Organización y metodología del servicio, págs. 3-8" },
    { "apartado": 2, "criterio": "Gestión de incidencias y control de calidad", "peso": 7, "tipo": "juicio_valor", "tramo": 3, "puntuacion": 3, "justificacion": "Tramo de 3: hay procedimiento, pero los indicadores no tienen meta ni frecuencia; para el de 5 faltan metas medibles.", "referencia": "2. Gestión de incidencias y control de calidad, pág. 9" },
    { "apartado": 3, "criterio": "Asesoramiento y acompañamiento", "peso": 6, "tipo": "juicio_valor", "tramo": 6, "puntuacion": 6, "justificacion": "Tramo de 6: plan de formación con calendario, destinatarios y materiales.", "referencia": "3. Asesoramiento y acompañamiento, págs. 12-15" },
    { "apartado": 4, "criterio": "Mejoras vinculadas al objeto del contrato", "peso": 4, "tipo": "juicio_valor", "tramo": 2, "puntuacion": 2, "justificacion": "Tramo de 2: las mejoras se enumeran sin decir su utilidad para la entidad.", "referencia": "4. Mejoras vinculadas al objeto del contrato, pág. 16" }
  ],
  "genericos": [
    { "referencia": "2. Gestión de incidencias y control de calidad, pág. 9", "texto": "Analítica Ejemplo garantiza un servicio de máxima calidad orientado a la mejora continua.", "por_que": "Declarativo: no dice quién mide la calidad, cuándo ni con qué indicador." }
  ],
  "eliminar": [],
  "modificar": [{ "referencia": "2. Gestión de incidencias y control de calidad — Indicadores", "que": "Poner meta numérica y frecuencia a cada indicador y quién lo revisa." }],
  "reforzar": [{ "referencia": "4. Mejoras vinculadas al objeto del contrato", "que": "Decir qué gana la entidad con cada mejora y cómo se mide." }],
  "comparables": [{ "tipo": "documento", "referencia": "Conocimiento/Licitaciones/Presentadas/Candelaria 2025/DOCUMENTACION PRESENTADA/Memoria.pdf", "resultado": "perdida", "parecido": "Mismo servicio; la mesa le dio 31 de 40 por indicadores sin metas." }],
  "riesgos": [{ "descripcion": "Los párrafos genéricos del apartado 2 pueden dejarlo en el tramo de 0.", "gravedad": "media" }]
}
```

## Aprender de un acta de mesa

Llega como tarea automática, una por carpeta de `Licitaciones/Presentadas` o carpeta única
(`Licitaciones/Ofertas/<carpeta>`, en `Resolución/` o, si la PLACSP la publicó, en `Pliegos/`) donde
está el acta de la mesa, el informe de valoración o la resolución de adjudicación (el código
la detecta por el nombre; también se pide con «Leer actas pendientes» en la web). La tarea
trae la `carpeta` y el `documento`; no los cambies. Lo que envías queda pendiente: una
persona lo acepta o lo descarta, y **solo lo aceptado** llega después a la redacción de la
memoria («lo que dijeron las mesas en apartados parecidos») y a `licitaciones_propuestas`
(`aprendizajes`). No modificas nada.

1. Lee el documento entero con `biblioteca_leer` (ruta con o sin `Conocimiento/`), por páginas y
   hasta la última. La empresa del perfil (`plataforma_empresa`: nombre y
   NIF) es la nuestra; en las actas podemos salir en mayúsculas, sin la forma jurídica o solo por el NIF.
2. Localiza la valoración de **nuestra** oferta y la del adjudicatario (o la mejor
   valorada), criterio a criterio: puntos máximos, los nuestros, los del ganador, la página
   y lo que dice la mesa de nuestra oferta **copiado literal**: sin resumir, corregir ni
   cambiar el orden. Si te sobra texto, copia tramos literales unidos con «…». Si la mesa no
   comenta un criterio, `comentario_mesa` va vacío (`""`). Si el documento es una resolución
   sin puntos por criterio, `criterios` va vacío y pones lo que sepas (resultado, ganador,
   totales).
3. Lee nuestra memoria presentada (`DOCUMENTACION PRESENTADA/<versión>/` o, en la carpeta única,
   `Presentada/`, si se presentó desde
   un paquete; en las presentadas fuera de la plataforma, `PLIEGOS/Sobre 1/`; la tarea da las rutas) y
   compara lo que la mesa valoró o echó en falta con lo que escribimos.
4. Hasta 10 `lecciones` concretas para la próxima memoria: qué puntuó y qué no, y por qué.
   Nada genérico («mejorar la memoria» no sirve; «la mesa quiere cifras: no dimos el volumen
   de registros ni la frecuencia de actualización» sí). **Sin nombres de personas**: escribe el
   rol. Cada lección entra en el libro de lecciones (pantalla Aprendizaje), con el criterio que
   más se le parece como evidencia.
5. `licitaciones_aprendizaje` con todo de una vez.

Qué comprueba el servidor:

| Comprobación | Qué pasa |
|---|---|
| Carpeta y documento | La carpeta es una de `Conocimiento/Licitaciones/Presentadas/` o `Conocimiento/Licitaciones/Ofertas/` y el documento existe dentro de ella |
| Nombres | Una lección que nombra a alguien de Colaboradores se rechaza siempre |
| Puntos | `nuestros` y `ganador` ≤ `puntos_max` en cada criterio; si no, se rechaza siempre |
| Literalidad | Cada `comentario_mesa` está en el documento (sin contar tildes, mayúsculas, puntuación ni saltos de línea), por tramos de ocho palabras; si no, se rechaza con la frase exacta. Tras dos rechazos entra con aviso para el equipo |
| Ya aceptado | Si una persona ya aceptó lo de esa carpeta, no se sustituye |

`resultado` es `ganada`, `perdida`, `excluida`, `desierta` o `desconocido`.

```json
{
  "carpeta": "Conocimiento/Licitaciones/Presentadas/2026-03 - 2036-2026 - Candelaria - Big Data flujos turísticos",
  "documento": "Conocimiento/Licitaciones/Presentadas/2026-03 - 2036-2026 - Candelaria - Big Data flujos turísticos/Candelaria_2036-2026_Acta_Mesa_2026-06-22.pdf",
  "resultado": "perdida", "ganador": "TURISMO ANALÍTICO SL", "puntos_nuestros": 31, "puntos_ganador": 39,
  "criterios": [
    { "criterio": "Metodología de análisis de los flujos turísticos", "puntos_max": 20, "nuestros": 14, "ganador": 19,
      "comentario_mesa": "La propuesta describe las fuentes de datos de telefonía y tarjetas, si bien presenta aspectos que la memoria no cuantifica, como el volumen de registros y la frecuencia de actualización.", "pagina": 2 },
    { "criterio": "Plan de trabajo y cronograma", "puntos_max": 20, "nuestros": 17, "ganador": 20, "comentario_mesa": "", "pagina": 2 }
  ],
  "lecciones": [
    "La mesa quiere cifras: la memoria no daba el volumen de registros ni la frecuencia de actualización de cada fuente.",
    "El ganador sacó 20 en el plan de trabajo con hitos semanales; el nuestro iba por fases sin fechas."
  ]
}
```

## Leer el acta de un expediente ajeno

Tarea `licitaciones.leer_acta_mercado`: una licitación de nuestro mercado, adjudicada con dos o
más ofertas, en la que **no** participamos. El código ya intentó leer su acta y no le bastó (faltan
licitadores o hay varios lotes). Lo que devuelvas alimenta los índices de competencia y los
licitadores probables: un dato inventado los estropea.

1. `licitaciones_acta_mercado` con el `id`: lotes adjudicados (adjudicatario y nº de ofertas) y
   el texto del documento. Si `siguiente_desde` no es null, sigue leyendo con `desde`.
2. `licitaciones_acta_mercado_guardar`: un elemento por empresa **y lote** en `licitadores`:
   - `nif` tal como sale en el texto (la plataforma comprueba que esté y que su control cuadre);
   - `lote`: uno de la lista (`""` si no hay lotes);
   - `rol`: `licitadora`, `excluida` (con `motivo_exclusion`) o `adjudicataria`;
   - `importe_ofertado` sin IVA, `puntos_tecnicos` y `puntos_economicos` solo si el acta los da.
3. Si el documento no dice quién se presentó (solo el adjudicatario, o es otra cosa), `sin_datos: true`.

De una persona física (un autónomo) basta el NIF: no copies su nombre.

