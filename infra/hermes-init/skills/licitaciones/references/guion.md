<!-- Referencia de la skill «licitaciones». Se carga bajo demanda desde SKILL.md. -->

# Guion de la oferta

**Cuándo leer esto.** En una tarea de guion («prepara el guion de la oferta…», sección «Guion de la oferta»): llega al pasar a «En preparación», con una ficha nueva o al pulsar «Extraer del pliego». También para responder qué hay que entregar, en qué sobre y cómo se puntúa.

Antes de trabajar en una oferta, lee `licitaciones_oferta` con `secciones` = `["estado", "bloqueos"]` (regla del núcleo de la skill).

## Guion de la oferta

Llega como tarea automática cuando una oportunidad pasa a «En preparación» (o le llega una
ficha nueva) o cuando alguien pulsa «Extraer del pliego». Es el mapa de lo que hay que
entregar y de cómo se puntúa: con él el equipo decide equipo, mejoras y precio, y la
plataforma redacta la memoria técnica siguiendo sus apartados. **Todo literal del pliego, con
documento y página**: nada resumido ni reescrito.

1. `licitaciones_ver`: `go_no_go.ficha.aprobada.datos.criterios` son los criterios que leyó
   la ficha; **los de juicio de valor son los apartados de la memoria** (mismo número, mismos
   puntos; si la ficha trae un solo criterio de juicio de valor con subcriterios con peso,
   los apartados son los subcriterios). Si la ficha **no** tiene criterios de juicio de valor
   pero el pliego exige igualmente una memoria técnica («no valorable», «no objeto de
   valoración», con un contenido mínimo), la memoria va con `valorable` = `false`: un apartado
   por cada bloque de contenido que exige el pliego, con `puntos` = 0, `escala` vacía y en
   `se_valorara` lo que debe contener, literal. `memoria` = `null` solo si el pliego no pide
   ninguna. `pliegos` da las rutas; `go_no_go.ambito`, los lotes.
2. `licitaciones_pliegos` con `temas` = `criterios_adjudicacion`, `sobres_documentacion`,
   `garantias`, `plazos_hitos` y `max_por_tema` = 6: localiza la cláusula de criterios, la del
   contenido de los sobres o archivos electrónicos y el plazo. No leas los pliegos desde el
   principio.
3. Lee **enteras**, por páginas (`biblioteca_leer` con `pagina_desde`/`pagina_hasta`): la
   cláusula de criterios (con la escala de cada apartado y lo que se valora y lo que no), la
   del contenido de cada archivo (con lo que está prohibido meter en cada uno) y el cuadro de
   características. Si hay un documento de anexos (los `.doc` llegan convertidos), léelo para
   saber qué modelo es cada anexo y en cuál se marcan los criterios automáticos.
4. `licitaciones_guion` con todo de una vez:
   - **archivos** (1 a 5, uno por archivo electrónico o sobre): `nombre` literal, `contenido`,
     `prohibiciones` literales, `firma`, `documentos` (cada uno con `tipo` —`memoria`, `deuc`,
     `declaracion`, `oferta_economica`, `acreditacion` u `otro`—, `nombre` literal,
     `obligatorio`, `produce` —`hermes` **solo** la memoria técnica, `persona` el resto— y
     `origen` con el modelo, documento y página; `lotes` si solo se exige en algunos),
     `documento` y `pagina`. Con lotes, `ambito` = `por_lote` si en la sede se sube una copia
     por lote (la memoria o la oferta de cada lote) y `indice` = `true` si el pliego exige un
     índice o relación numerada del contenido del archivo.
   - **memoria** (o `null` si el pliego no pide memoria): `archivo` (el nombre exacto de uno de
     `archivos`), `titulo_documento`, `valorable` (`false` si el pliego la exige sin puntuarla;
     si se puntúa, omítelo), `limite_paginas` (`null` solo si el pliego no fija
     ninguno; si lo fija para otro lote, explícalo en `limite_detalle`), `formato` si lo fija
     (fuente, `tamano_letra`, `interlineado`, `otros` —literal; si el modelo acaba en «Lugar,
     fecha y firma del proponente», cítalo ahí y la plataforma pone ese cierre—), `apartados` en el orden del pliego
     (`titulo` literal sin numerar, `puntos`, `se_valorara` —una cosa por elemento, literal—,
     `puntos_se_valorara` —si el pliego da puntos a cada cosa, en el mismo orden; deben sumar
     los del apartado—, `escala` —cada tramo con `puntos` y `descripcion` literal—, `documento`, `pagina`) y
     `advertencias` literales; `por_lote` = `true` si el pliego exige una memoria específica para
     cada lote («una Memoria Técnica específica para cada lote», «tantas … como lotes»).
   - **automaticos**: cada criterio evaluable con fórmula o automáticamente que no sea el
     precio, con `puntos`, `como_se_acredita`, `casilla_en` (modelo y casilla), `archivo` y
     `marcas`: de 1 a 8 palabras que lo delatarían si aparecieran en la memoria (la plataforma
     rechaza cualquier apartado que las contenga si el criterio va en otro archivo). Solo
     palabras que saldrían al hablar de ese criterio («ISO 14001», «tutores adicionales»):
     nunca cifras sueltas («30 horas», «329 alumnas»), frases que diría cualquier mejora («sin
     coste adicional») ni nada que el pliego pida tratar en la memoria. Un criterio con tramos
     excluyentes (1-3 años o más de 3) es uno solo, con sus puntos máximos y sus `tramos`
     literales (`descripcion`, `puntos` y el `valor` que se teclea o marca), de menos a más;
     el último vale los puntos del criterio. Además: `lotes` si no puntúa en todos los lotes
     del guion (un criterio distinto por lote es un automático por lote), `tipo` (`compromiso`
     si se promete hacer algo, `acreditacion` si se demuestra algo que ya se tiene),
     `exige_documento` si el pliego exige un documento para acreditarlo (literal: «Dossier
     Técnico Homologado del fabricante») y `penalizacion` literal si incumplir lo ofertado se
     penaliza.
   - **ofertas_economicas**: **una por lote**, para **todos** los lotes de `go_no_go.ambito`
     (no solo el primero), o una sola con `lotes` = `[]` si no hay lotes. Cada una con `lotes`,
     `formula` literal, `presupuesto_base` (el del lote), `impuesto_aparte` (`IVA`, `IGIC`,
     `exento` si el pliego dice que la prestación está exenta, o `null`), `precios_unitarios`
     —una línea por cada precio que se oferta por unidad (€/alumno, €/edición, €/informe), con
     `concepto`, `unidad`, `maximo` y `cantidad` prevista si el pliego la da; vacío si se oferta
     un importe total—, `umbral_anormalidad` literal (o `null` si remite al art. 85 RGLCAP),
     `umbral_baja` (0,15) si el pliego la fija sobre el presupuesto o el máximo, `redondeo`
     literal si fija decimales, `modelo` y `archivo`. Si la fórmula puntúa un precio por
     unidad, `precios_unitarios` no puede ir vacío. `oferta_economica` (en singular) no se usa:
     emite siempre `ofertas_economicas`.
   - **plazo**: `fecha_limite` (hora peninsular) y `canal`; `lotes` si va por lotes. No
     comentes si el plazo ya ha pasado: la plataforma lo calcula.
5. Qué comprueba el servidor: nombres de archivo sin repetir, archivos citados que existen y
   una sola memoria (siempre); apartados que casan con los criterios de juicio de valor de la
   ficha (mismo número y mismos puntos), cada apartado con documento y página, cada archivo
   con al menos un documento, cada automático con marcas que no sean genéricas ni salgan en lo
   que se valora en la memoria, los `puntos_se_valorara` que sumen los del apartado y, si los pasajes del pliego hablan
   de un límite de páginas, que `limite_paginas` lo traiga; con lotes, que cada lote tenga su
   oferta económica, que los `lotes` citados sean del guion y que los tramos vayan de menos a
   más; y que una fórmula que puntúa un precio por unidad traiga `precios_unitarios`. Si responde con un error, corrige
   exactamente lo que dice y reenvía el guion entero; tras dos rechazos se acepta con avisos.
   Cada envío es una versión nueva.

Con lotes (cinco lotes con criterios distintos en el 1 y el 2 y dos precios en el 2),
`lotes` = `["1","2","3","4","5"]`, cada automático con sus `lotes` y una oferta por lote:
`{ "lotes": ["2"], …, "precios_unitarios": [{ "concepto": "Edición nivel básico", "unidad": "edición", "maximo": 4200, "cantidad": 6 }, { "concepto": "Edición nivel avanzado", "unidad": "edición", "maximo": 5100, "cantidad": 4 }] }`.

Ejemplo (exp. 101/2026, p-12345678):

```json
{
  "id": "p-12345678",
  "archivos": [
    {
      "nombre": "Archivo electrónico nº 1",
      "contenido": "Documentación administrativa y memoria técnica (criterios sujetos a juicio de valor).",
      "prohibiciones": ["No podrá incluirse en este archivo ninguna información relativa a la oferta económica ni a los criterios evaluables automáticamente, so pena de exclusión."],
      "firma": "Firma electrónica del representante",
      "documentos": [
        { "tipo": "deuc", "nombre": "DEUC", "obligatorio": true, "produce": "persona" },
        { "tipo": "memoria", "nombre": "Memoria técnica", "obligatorio": true, "produce": "hermes" },
        { "tipo": "declaracion", "nombre": "Anexo XIII. Declaración responsable", "obligatorio": true, "produce": "persona",
          "origen": { "modelo": "Anexo XIII", "documento": "Anexos PCAP_PLACSP_180626.doc", "pagina": 12 } },
        { "tipo": "declaracion", "nombre": "Anexo II. Compromiso de UTE", "obligatorio": false, "produce": "persona" },
        { "tipo": "declaracion", "nombre": "Anexo X", "obligatorio": true, "produce": "persona" },
        { "tipo": "declaracion", "nombre": "Anexo VI", "obligatorio": true, "produce": "persona" }
      ],
      "documento": "PCAP.pdf", "pagina": 41
    },
    {
      "nombre": "Archivo electrónico nº 2",
      "contenido": "Oferta económica y criterios evaluables automáticamente.",
      "documentos": [{ "tipo": "oferta_economica", "nombre": "Anexo VII. Proposición económica", "obligatorio": true, "produce": "persona",
        "origen": { "modelo": "Anexo VII", "documento": "Anexos PCAP_PLACSP_180626.doc", "pagina": 20 } }],
      "documento": "PCAP.pdf", "pagina": 44
    }
  ],
  "memoria": {
    "archivo": "Archivo electrónico nº 1", "titulo_documento": "Memoria técnica", "limite_paginas": 25,
    "formato": { "fuente": "Arial", "tamano_letra": 11, "interlineado": 1 },
    "apartados": [
      { "titulo": "Organización y metodología del servicio", "puntos": 8,
        "se_valorara": ["Modelo organizativo propuesto", "Definición de roles y responsabilidades", "Procedimiento de atención de consultas", "Coordinación con la Asesoría Jurídica", "Viabilidad de la propuesta"],
        "escala": [{ "puntos": 0, "descripcion": "No aporta contenido operativo." }, { "puntos": 4, "descripcion": "Propuesta genérica." }, { "puntos": 6, "descripcion": "Propuesta adecuada." }, { "puntos": 8, "descripcion": "Propuesta detallada y plenamente viable." }],
        "documento": "PCAP.pdf", "pagina": 31 },
      { "titulo": "Gestión de incidencias y control de calidad", "puntos": 7,
        "se_valorara": ["Procedimiento de gestión de incidencias", "Indicadores de calidad del servicio", "Mecanismos de control y seguimiento"],
        "escala": [{ "puntos": 0, "descripcion": "No aporta contenido operativo." }, { "puntos": 3, "descripcion": "Propuesta genérica." }, { "puntos": 5, "descripcion": "Propuesta adecuada." }, { "puntos": 7, "descripcion": "Propuesta detallada y plenamente viable." }],
        "documento": "PCAP.pdf", "pagina": 32 },
      { "titulo": "Asesoramiento y acompañamiento", "puntos": 6,
        "se_valorara": ["Plan de asesoramiento a los órganos de la entidad", "Acompañamiento en la implantación", "Formación al personal"],
        "escala": [{ "puntos": 0, "descripcion": "No aporta contenido operativo." }, { "puntos": 3, "descripcion": "Propuesta genérica." }, { "puntos": 5, "descripcion": "Propuesta adecuada." }, { "puntos": 6, "descripcion": "Propuesta detallada y plenamente viable." }],
        "documento": "PCAP.pdf", "pagina": 33 },
      { "titulo": "Mejoras vinculadas al objeto del contrato", "puntos": 4,
        "se_valorara": ["Mejoras relacionadas con el objeto del contrato", "Utilidad de las mejoras para la entidad"],
        "escala": [{ "puntos": 0, "descripcion": "No aporta contenido operativo." }, { "puntos": 2, "descripcion": "Propuesta genérica." }, { "puntos": 4, "descripcion": "Propuesta detallada y plenamente viable." }],
        "documento": "PCAP.pdf", "pagina": 34 }
    ],
    "advertencias": ["No se valorarán las manifestaciones genéricas, meramente declarativas o carentes de contenido operativo."],
    "documento": "PCAP.pdf", "pagina": 31
  },
  "automaticos": [
    { "criterio": "Certificado ISO 14001", "puntos": 10, "como_se_acredita": "Certificado en vigor", "casilla_en": "Anexo VII", "archivo": "Archivo electrónico nº 2", "marcas": ["ISO 14001", "gestión ambiental certificada"], "tipo": "acreditacion", "exige_documento": "Certificado ISO 14001 en vigor", "documento": "PCAP.pdf", "pagina": 36 },
    { "criterio": "Plantilla con discapacidad igual o superior al 10 %", "puntos": 15, "como_se_acredita": "Certificado de la plantilla", "casilla_en": "Anexo VII", "archivo": "Archivo electrónico nº 2", "marcas": ["trabajadores con discapacidad", "plantilla con discapacidad"], "documento": "PCAP.pdf", "pagina": 36 },
    { "criterio": "Mejora 1: bolsa de horas adicionales", "puntos": 7, "como_se_acredita": "Casilla marcada", "casilla_en": "Anexo VII", "archivo": "Archivo electrónico nº 2", "marcas": ["bolsa de horas"], "tipo": "compromiso",
      "tramos": [{ "descripcion": "Hasta 20 horas adicionales", "puntos": 3, "valor": "20" }, { "descripcion": "Más de 20 horas adicionales", "puntos": 7, "valor": "40" }], "documento": "PCAP.pdf", "pagina": 36 },
    { "criterio": "Mejora 2: formación adicional", "puntos": 6, "como_se_acredita": "Casilla marcada", "casilla_en": "Anexo VII", "archivo": "Archivo electrónico nº 2", "marcas": ["formación adicional"], "documento": "PCAP.pdf", "pagina": 36 },
    { "criterio": "Mejora 3: ampliación del horario de atención", "puntos": 7, "como_se_acredita": "Casilla marcada", "casilla_en": "Anexo VII", "archivo": "Archivo electrónico nº 2", "marcas": ["ampliación del horario"], "documento": "PCAP.pdf", "pagina": 36 }
  ],
  "ofertas_economicas": [{ "lotes": [], "formula": "P = 30 × (oferta más baja / oferta a valorar)", "presupuesto_base": 48000, "impuesto_aparte": "IGIC", "precios_unitarios": [], "umbral_anormalidad": null, "modelo": "Anexo VII", "archivo": "Archivo electrónico nº 2", "documento": "PCAP.pdf", "pagina": 35 }],
  "plazo": { "fecha_limite": "2026-10-20T14:00", "canal": "Presentación electrónica en la PLACSP" }
}
```
