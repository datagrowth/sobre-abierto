<!-- Referencia de la skill «licitaciones». Se carga bajo demanda desde SKILL.md. -->

# Decisiones de la oferta y equipo

**Cuándo leer esto.** En una tarea «propón las decisiones» (sección «Proponer las decisiones de la oferta»), en una tarea de lectura de CV (sección «Leer un CV») y cuando pregunten quién puede cubrir los medios personales de una licitación (sección «Proponer un equipo»).

Antes de trabajar en una oferta, lee `licitaciones_oferta` con `secciones` = `["estado", "bloqueos"]` (regla del núcleo de la skill).

## Proponer las decisiones de la oferta

Llega como tarea automática en cuanto hay guion (o cuando alguien pulsa «Proponer de nuevo»).
Es una **propuesta**: la web rellena con ella el formulario de Decisiones, con tu motivo al
lado de cada cosa, y quien lleva la oferta la revisa y la guarda. El precio no lo propones:
la plataforma lo calcula con las adjudicaciones parecidas.

1. `licitaciones_oferta` (`id`): el guion, con su `guion.id` (va en `guion_id`).
   `licitaciones_ver`: la ficha y `go_no_go.ambito` (lotes de interés). `lotes` son
   exactamente los de `go_no_go.ambito.lotes` (vacío si se mide con el contrato entero): la
   plataforma rechaza otros; si crees que hay que ir a otros, dilo en el resumen.
2. **Equipo.** `licitaciones_equipo` da candidatos por requisito; `colaboradores_ver` y su CV
   con `biblioteca_leer`. Cubre cada perfil que pide el pliego con quien mejor lo acredita y,
   si hay criterios automáticos de experiencia o certificaciones del equipo, elige a quien
   da el tramo más alto, una persona por categoría salvo que el pliego diga otra cosa (mira
   `anios_experiencia`, tecnologías y **notas** de cada colaborador, y su CV). Solo puntúa lo
   que pasa del mínimo. `rol_en_la_oferta` con el nombre del pliego; `motivo` con lo que lo
   acredita (años, proyectos, certificaciones).
3. **Criterios automáticos**, uno por cada criterio del guion y, si el criterio trae
   `lotes`, uno por cada lote nuestro de esos (con `lote`). La regla es **el tramo más alto
   con capacidad demostrada**; lo que exige un documento que no tenemos va a 0 y explicado:
   - `tramo`: la `descripcion` literal de uno de `guion.automaticos[].tramos` (sin tramos,
     el propio criterio). Un tramo por debajo del máximo está bien si es el que podemos
     demostrar: el `motivo` dice por qué no se va al siguiente.
   - `capacidad`: `demostrada` solo si hoy consta que lo cumplimos (perfil de la empresa con
     `plataforma_empresa`, ficha o CV del colaborador, documento de la Biblioteca); con
     `parcial` o `no`, `nos_acogemos: false` y en `motivo` lo que falta para poder subir.
   - `evidencia`: dónde consta (perfil, CV de quién, ruta del documento).
   - Si el guion trae `exige_documento`, búscalo en la Biblioteca: si no está,
     `documento_en_mano: false`, `nos_acogemos: false` (0 puntos) y el `motivo` nombra el
     documento. La plataforma rechaza un criterio así marcado, y también un compromiso o una acreditación
     sin `cumple` o con `nos_acogemos` que no casa.
   - `tipo`: `compromiso` (algo que ofrecemos hacer: formación, soporte, horas, mejoras) o
     `acreditacion` (certificados, experiencia, plantilla), que lleva además `cumple` (`si`,
     `no` o `falta_dato`; con `no` o `falta_dato`, `nos_acogemos: false`). Un compromiso con
     coste real (ediciones sin coste, horas adicionales) va al tramo que podemos sostener.
     Si el guion dice que un compromiso se acredita con un documento o un hecho (dossier
     homologado del fabricante, certificado, plataforma ya en marcha), trátalo como una
     acreditación: lleva `cumple` y `nos_acogemos: true` solo con la evidencia; marcarlo sin
     ella es una declaración inexacta. En una acreditación, `cumple: si` vale si consta en
     `plataforma_empresa`, en la ficha del colaborador (también sus notas) o en su CV, aunque
     haya que preparar el documento para presentarlo; con `no` o `falta_dato`, di en
     `motivo` qué dato falta y dónde ponerlo.
4. **Herramientas**: solo las que usamos de verdad y encajan con el pliego.
   **No prometer** (`no_prometer`, hasta 10): lo que la memoria no debe prometer porque no lo
   tenemos o no conviene (p. ej. «Moodle propio», «alojamiento en la UE», «chatbot 24/7»),
   cada uno con `que`, `motivo` y de 1 a 5 `marcas` (las palabras que lo delatarían en el
   enfoque o en la memoria: «Moodle 4.x», «centro de datos de la UE», «24 horas»). Va a la
   frontera del dossier y, si alguien escribe luego un enfoque que lo promete, la plataforma
   avisa al guardar las decisiones (sin impedirlo).
   **Enfoque**, opcional: solo lo que la estrategia no sacaría del pliego, en positivo: qué
   nos diferencia aquí y qué contar y cómo (mira «parecidas» y «aprendizajes» en
   `licitaciones_propuestas`). Sin nada que añadir, déjalo vacío. Lo que no se ofrece no se
   menciona en él: va en `no_prometer`. La plataforma lo rechaza si cita el pliego («Bases,
   pp. 12»), si está en negativo («no prometer…», «evitar…»), si habla de lotes a los que no
   vamos o si nombra un criterio automático o lo que se oferta en él (el redactor lo copiaría
   en la memoria y sería causa de exclusión: esto se rechaza siempre, también al guardar las
   decisiones). **Resumen**: lo que la persona debe confirmar.
5. `licitaciones_decisiones`. Si responde con un error, corrige exactamente lo que dice y
   reenvía la propuesta entera.

Otro caso (lotes 2 y 4): el 2.3 y el 2.4 exigen el «Dossier Técnico Homologado» del
fabricante, que no está en la Biblioteca: van con `nos_acogemos: false`, `documento_en_mano:
false` y un motivo que lo nombra («0 puntos: exige el Dossier Técnico Homologado del
fabricante, que no está en la Biblioteca»). El 2.1 va en el tramo de «2 h o menos» con la
evidencia de los turnos de tutoría, uno por lote (`"lote": "2"` y `"lote": "4"`).

Ejemplo (guion 7):

```json
{
  "id": "p-12345678",
  "guion_id": 7,
  "lotes": [],
  "equipo": [
    { "persona_id": 1, "rol_en_la_oferta": "Responsable del servicio", "dedicacion": "50 %", "motivo": "Coordina el servicio y la relación con la Asesoría Jurídica: 8 años de contratación pública y de la PLACSP en su CV." },
    { "persona_id": 2, "rol_en_la_oferta": "Consultor de soporte PLACSP", "motivo": "Atiende consultas e incidencias de la plataforma: 4 años de soporte a usuarios de licitación electrónica." }
  ],
  "automaticos": [
    { "criterio": "Certificado ISO 14001", "tipo": "acreditacion", "cumple": "no", "nos_acogemos": false, "tramo": null, "capacidad": "no", "documento_en_mano": false, "motivo": "0 puntos: exige el Certificado ISO 14001 en vigor y no está en la Biblioteca ni en el perfil de la empresa." },
    { "criterio": "Plantilla con discapacidad igual o superior al 10 %", "tipo": "acreditacion", "cumple": "falta_dato", "nos_acogemos": false, "tramo": null, "capacidad": "parcial", "motivo": "El perfil de la empresa no da el porcentaje de la plantilla: ponlo en Ajustes › Empresa y se podrá subir." },
    { "criterio": "Mejora 1: bolsa de horas adicionales", "tipo": "compromiso", "nos_acogemos": true, "tramo": "Hasta 20 horas adicionales", "capacidad": "demostrada", "evidencia": "Perfil de la empresa: dos consultores con horas libres; turnos de soporte de 2025 en Biblioteca/Operaciones.", "motivo": "Las 20 horas caben en los turnos actuales; más de 20 exigiría otra persona." },
    { "criterio": "Mejora 2: formación adicional", "tipo": "compromiso", "nos_acogemos": true, "tramo": "Mejora 2: formación adicional", "capacidad": "demostrada", "evidencia": "CV del responsable del servicio: imparte la formación de la PLACSP desde 2022.", "motivo": "La da el responsable del servicio con el material que ya tenemos." },
    { "criterio": "Mejora 3: ampliación del horario de atención", "tipo": "compromiso", "nos_acogemos": true, "tramo": "Mejora 3: ampliación del horario de atención", "capacidad": "demostrada", "evidencia": "Perfil de la empresa: horario de soporte de 8:00 a 19:00.", "motivo": "Nuestro horario de soporte ya cubre la ampliación." }
  ],
  "herramientas": ["PLACSP", "Microsoft Teams"],
  "no_prometer": [
    { "que": "atención presencial diaria", "motivo": "El servicio es remoto: no hay nadie para estar en la sede cada día.", "marcas": ["presencial", "en la sede"] }
  ],
  "enfoque": "Contar el servicio como un equipo fijo que responde en plazo: circuito de consultas con tiempos, coordinación semanal con la Asesoría Jurídica y formación práctica al personal, con un caso real de cada tipo de consulta.",
  "resumen": "Equipo de dos personas; la bolsa de horas en el tramo de hasta 20 horas, que es lo que cubren los turnos. ISO 14001 a 0 por falta del certificado. Confirma el porcentaje de plantilla con discapacidad: son 15 puntos."
}
```

## Colaboradores y equipos

Las personas del equipo (`interno`) y externas (`externo`) están en la plataforma con lo
que pueden acreditar; su CV, en `Colaboradores/` de la Biblioteca. Son datos personales:
úsalos solo para montar equipos y no los copies a notas ni a canales salvo que te lo pidan.
Nunca propongas una nota a partir de un CV: `biblioteca_proponer` lo rechaza.

### Interpretar una respuesta del asistente

Llega como tarea `licitaciones.interpretar_respuesta` cuando alguien contesta con texto libre a una
pregunta del asistente de la oferta (equipo de un rol, acogerse a un criterio automático…). La tarea
trae la pregunta, sus opciones con su clave y lo que escribió la persona.

1. Si lo que dice es una de las opciones, `licitaciones_oferta_interpretar` con `opcion` (su clave) y
   una `explicacion` corta.
2. Si es otra decisión de las que valen para esa pregunta (otra persona de Colaboradores, acogerse
   con la evidencia que dice), mándala en `accion` con la forma que da la tarea.
3. Si no se entiende o falta algo, `entendido: false` y una `repregunta` de una frase. No adivines:
   «eso lo veo mañana» o «¿cuánto cuesta?» no son una decisión.

No guardes decisiones ni toques el precio (no llega aquí: es de la persona). Lo que mandas queda
«por confirmar» y una persona lo confirma o lo rechaza.

### Leer un CV

Llega como tarea automática cuando alguien sube un CV en **Equipo** (también
«Subir CV nuevo» desde la ficha de una persona) o pulsa «Releer CV con Hermes»:

1. `biblioteca_leer` con la ruta del CV, por partes y hasta el final.
2. `colaboradores_proponer_perfil` con `cv_ruta` (la misma), `persona_id` si la tarea lo
   trae y `perfil`: `nombre`, `tipo` (`interno` si es de la empresa; ante la duda,
   `externo`), `rol`, `titulaciones` (con nivel y rama), `certificaciones`,
   `anios_experiencia` (profesional), `sectores`, `cpv` (solo si está claro; si no, `[]`),
   `tecnologias`, `idiomas` con `nivel` A1–C2, `nativo` o `null`, y `docencia`: una entrada por
   materia impartida con `materia`, `horas`, `desde` y `hasta` (años) y `evidencia` con la página
   del CV («CV, pág. 2»). Solo horas que el CV dé en cifra: no las estimes de los cursos.
3. **Nunca** datos de contacto, DNI, dirección, fecha de nacimiento ni foto: el esquema no
   los admite y no hacen falta. No inventes: lo que el CV no diga, vacío o `null`.
4. Si responde con error, corrige el campo que indica y reenvía. Queda pendiente hasta que
   una persona lo aprueba (y lo corrige si hace falta).

Ejemplo:

```json
{
  "cv_ruta": "Colaboradores/cv-ana-garcia.pdf",
  "perfil": {
    "nombre": "Ana García", "tipo": "interno", "rol": "Jefa de proyecto",
    "titulaciones": ["Grado en Ingeniería Informática", "Máster en Big Data"],
    "certificaciones": ["PMP"], "anios_experiencia": 9, "sectores": ["sanidad"], "cpv": [],
    "tecnologias": ["Python", "Power BI", "Scrum"], "idiomas": [{ "idioma": "Inglés", "nivel": "C1" }]
  }
}
```

### Proponer un equipo

Cuando te pregunten quién puede cubrir los medios personales de una licitación:
`licitaciones_equipo` con su `id` (sale de la ficha) o, sin ficha,
`colaboradores_buscar` con el texto de cada requisito y los `cpvs` de la licitación. La
puntuación es orientativa (70 puntos por lo comprobable: años, titulación, certificación,
idioma; 30 por afinidad). Explica por qué encaja cada persona con sus `reglas`; avisa de
lo que queda `desconocido` (el perfil no lo dice) y de quién no está disponible. Para
confirmar un dato, lee su CV (`cv_ruta`) con `biblioteca_leer`.
