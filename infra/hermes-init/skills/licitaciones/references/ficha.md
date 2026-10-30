<!-- Referencia de la skill «licitaciones». Se carga bajo demanda desde SKILL.md. -->

# La ficha de una oportunidad

**Cuándo leer esto.** En una tarea de ficha («prepara la ficha de la licitación…», sección «Preparar la ficha»): llega al descargar los pliegos o cuando alguien pulsa «Generar ficha». También para explicar por qué la ficha dice que cumplimos o no un requisito.

## Preparar la ficha de una oportunidad

Llega como tarea automática cuando se descargan los pliegos o cuando alguien pulsa
«Generar ficha» (o «Volver a generar la ficha»). Es lo que el equipo mira para decidir si
va o no, así que tiene que ser **completa** (todo lo que el pliego exige), **citada**
(documento y página) y decir **con nuestros datos** si cumplimos. Una persona que revise el
pliego a mano no debería encontrar requisitos que la ficha no trae.

1. **La licitación.** `licitaciones_ver`: `go_no_go.requisitos` es lo que el código ya
   comparó con el perfil (clasificación, volumen de negocio, seguro, plantilla); lo que quedó
   `desconocido` hay que leerlo del pliego (la plataforma comprueba que la ficha lo trae).
   `go_no_go.ambito` dice contra qué se evalúa: los lotes de interés (con su importe) o el
   contrato entero; mide la solvencia contra ese importe. Si
   `go_no_go.presentacion.sin_confirmar` es `true`, busca en el PCAP a cuántos lotes se puede
   presentar y envíalo en `presentacion_lotes`. `pliegos` dice qué documentos se pueden leer
   (`estado_indice`).
2. **Nuestros datos.** `plataforma_empresa` y `biblioteca_leer` de
   `Empresa/perfil-licitaciones.md`. Las `notas` del perfil son hechos de la empresa: «subcontrata
   siempre el alojamiento» decide subcontratación y UTE; «certificada en ISO 27001, sin ENS» decide certificaciones;
   «empresa de nueva creación» dice si nos vale esa excepción. Los importes, como en
   `importes_en_texto`.
3. **Los pliegos, por temas.** `licitaciones_pliegos` con el `id` da, por cada tema
   (solvencia, medios, certificaciones, subcontratación, idioma, lugar, criterios, sobres,
   garantías, penalidades, plazos, lotes…), los pasajes con su ruta y página. **No leas los
   pliegos desde el principio**: si un pasaje se corta o necesitas la cláusula entera,
   `biblioteca_leer` con esa ruta y `pagina_desde`/`pagina_hasta` (hasta 15 páginas). Lee
   entero, por páginas, el cuadro de características (anexo I) del PCAP: ahí suelen estar
   solvencia, subcontratación, garantías y criterios.
4. **Medios personales.** Por cada perfil que exige el pliego, `colaboradores_buscar` con el
   texto del requisito y los CPV de la licitación. En `fuente` di cuántos cumplen los mínimos.
5. **`licitaciones_ficha`** con todo de una vez:
   - **resumen**: de qué va, en tres frases como mucho, para quien no ha leído el pliego:
     qué se contrata y para qué; qué incluye (entregables, formación, soporte); y lotes,
     importe sin IVA, duración y, si hay soporte o garantía, **cuántos meses** (también el
     mínimo y el máximo si se puede ampliar con la oferta). Al final, entre paréntesis, de
     dónde sale (documento y página).
   - **requisitos**: uno por cada cosa que el pliego exige para presentarse o para ejecutar,
     con `tipo`, `descripcion` (qué pide, concreto y comprobable), `excluyente`,
     `valor_exigido`, `cumple`, `fuente`, `justificacion`, `documento`, `pagina`, `cita` y `lote`
     si es solo de un lote. `cita` es la frase del pliego que lo exige, **copiada literal** (sin
     resumirla; «…» para saltar un trozo largo): la plataforma la busca en el pliego y, si no está
     tal cual, el requisito sale como «cita no localizada» en la ficha y en las comprobaciones. Ponla
     siempre en los excluyentes. Tipos: `solvencia_economica`, `solvencia_tecnica`, `experiencia`
     (trabajos similares), `clasificacion`, `medios_personales`, `medios_materiales`,
     `certificacion`, `habilitacion`, `subcontratacion`, `idioma`, `seguro`, `visita`,
     `lugar_ejecucion`, `ute` u `otro`.
   - **cobertura**: un elemento por cada tema de la lista (`solvencia_economica`,
     `solvencia_tecnica`, `clasificacion`, `medios_personales`, `medios_materiales`,
     `certificaciones`, `habilitacion`, `subcontratacion`, `idioma`, `seguro`,
     `visita_obligatoria`, `lugar_ejecucion`): `en_requisitos`, `no_lo_pide` (con documento y
     página donde lo dice) o `no_encontrado` (no aparece en los pliegos).
   - criterios (peso, tipo `formula` o `juicio_valor`, subcriterios), documentación por sobre,
     hitos con fecha, garantías, penalizaciones, riesgos con gravedad, recomendación y, si las
     hay, `senales_pliego`.
   - **titulo_corto** (60 caracteres como mucho): el título que se lee en la tarjeta del Pipeline.
     Qué se contrata y para quién, sin «Contratación de los servicios de…», sin el expediente y
     sin el órgano si no hace falta: «Formación en IA generativa para personal técnico».
6. Si responde con un error, corrige exactamente lo que dice y reenvía la ficha entera. Tras
   dos rechazos se acepta con lo que falte como aviso (se ve en la calidad de la ficha).

### Cómo decidir «cumple»

| Situación | cumple |
|---|---|
| Nuestros datos lo cumplen (perfil, notas, colaboradores, perfil-licitaciones.md) | `si`, con `fuente` |
| Nuestros datos dicen que no (volumen por debajo, certificación que no tenemos, lengua que el equipo no habla) | `no`, con `fuente` |
| El pliego lo pide, pero no nos afecta (requisitos solo para UTE, o solo para empresas extranjeras) | `no_aplica` |
| Falta un dato concreto nuestro o el pliego es ambiguo | `dudoso`, y di cuál en la justificación |

- Castellano es siempre `si`. Otra lengua: `si` si está en `idiomas`, `no` si no está.
- Una certificación (ENS, ISO…) que el perfil no lista y las notas dicen que no tenemos: `no`.
  Si el pliego admite «o equivalente», dilo y deja `dudoso`.
- Subcontratación prohibida o limitada y concurrimos en solitario: `si`.
- Excepción de empresas de nueva creación (art. 90.4 LCSP): `si` solo si el pliego la admite;
  cita su documento y página. Sin cita, el código la deja en `dudoso`.
- **Norma de nueva creación aparte.** Si una solvencia (técnica, económica o experiencia) da
  otra norma a las empresas de menos de cinco años, el requisito lleva la regla general en
  `valor_exigido` y la de nueva creación en `nueva_creacion` (`valor_exigido`, `documento`,
  `pagina`, obligatorios). `cumple` se decide con la norma que nos aplica según
  `fecha_constitucion`. La web enseña la de nueva creación como la norma mientras la empresa
  tenga menos de cinco años.
- **Nunca** «el perfil no indica…» si el dato está en el perfil o en las notas.
- `excluyente: true` solo si no cumplirlo deja fuera (solvencia mínima, clasificación
  exigida, habilitación, adscripción obligatoria de medios); con `documento` y `pagina`. El
  seguro de responsabilidad civil va como `seguro` y **nunca** es excluyente.
- Recomendación: `no_go` si un excluyente da `no`; `revisar` (en la web, «Con dudas») si
  alguno queda `dudoso`; `go` en otro caso.
- **Formaciones.** Si el contrato es una formación (cursos, plan de formación,
  capacitación…) y el perfil tiene `areas_formacion`, mira en el PPT de qué materia es: solo
  interesan las de esas áreas. Si es de otra materia, `no_go` con el motivo «Formación fuera
  de nuestras áreas: <materia>». Con `areas_formacion` vacío no hay regla aparte.

**Lo que hace la plataforma al llegar.** Comprueba con nuestros datos lo que puede (volumen
de negocio contra el importe exigido, idiomas, certificaciones del perfil y de las notas,
clasificación, seguro, subcontratación y UTE con las notas, colaboradores que cumplen los
mínimos, excepción de nueva creación) y **corrige** el `cumple` si no cuadra; la respuesta
dice qué corrigió. Después aplica la ficha sin que nadie la apruebe: un excluyente con
`cumple: "no"` descarta la oportunidad en el acto (si es de un lote, solo si no quedan otros
lotes en juego), y la recomendación `no_go` también, si sigue en `nueva` (o
`ficha_por_revisar`) y nadie la movió a mano: pasa a `descartada` con el motivo «Hermes: no
go — <tu motivo>». En preparación, presentada o recuperada por una persona, no se toca: por
eso el motivo de `no_go` tiene que bastar para descartar. Reenviar sustituye a la ficha anterior.

**Señales de pliego a medida** (`senales_pliego`, solo si las hay, con cita literal y
página): `experiencia_especifica` o `tecnologia_especifica` (una herramienta, un sistema o un
tipo de proyecto que casi nadie más tiene), `marca_o_compatibilidad` (marca o compatibilidad
obligatoria sin «o equivalente»), `juicio_valor_favorece` (criterios que premian conocer ya el
servicio: continuidad, conocimiento del sistema actual, plan de transición mínimo),
`solvencia_a_medida` (cifras o experiencias que encajan con una sola empresa) u `otra`. Si la
señal es solo de un lote, pon su `lote`. Para comparar, `licitaciones_antecedentes` da las
ediciones anteriores y quién las ganó. Describe lo que pide el pliego sin juzgar a nadie.

`presentacion_lotes` (opcional) solo va en licitaciones **con lotes** cuya regla no publica
la PLACSP: `regla` (`un_lote`, `todos_los_lotes` o `uno_o_varios`) y, si el pliego los da,
`maximo_lotes`, `detalle`, `documento` y `pagina`. Si es `todos_los_lotes`, se mide el total
(y si se sale del rango de importe de los filtros, se descarta).

Ejemplo (no añadas campos que no estén aquí):

```json
{
  "id": "p-20435341",
  "resumen": "Servicio de analítica de datos y cuadros de mando para el Servicio de Salud durante 2 años, 450.000 € sin IVA, en remoto salvo reuniones mensuales.",
  "requisitos": [
    { "tipo": "solvencia_economica", "descripcion": "Volumen anual de negocios en el mejor de los tres últimos ejercicios", "excluyente": true, "valor_exigido": "≥ 450.000 €", "cumple": "no", "fuente": "perfil.volumen_negocio 2025: 186.420,35 €", "justificacion": "Nuestro mejor ejercicio no llega al mínimo.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/Anexo I.pdf", "pagina": 4 },
    { "tipo": "experiencia", "descripcion": "Servicios similares en los tres últimos años; importe anual acumulado del año de mayor ejecución", "excluyente": true, "valor_exigido": "≥ 105.000 €", "cumple": "si", "fuente": "perfil.mayor_contrato_similar: 193.876,48 €", "justificacion": "El mayor contrato similar supera el mínimo.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/Anexo I.pdf", "pagina": 5 },
    { "tipo": "medios_personales", "descripcion": "Jefe de proyecto con titulación universitaria y 5 años de experiencia en proyectos de datos", "excluyente": true, "valor_exigido": "1 persona, 5 años", "cumple": "si", "fuente": "colaboradores_buscar: 2 cumplen los mínimos", "justificacion": "Hay dos personas del equipo que cumplen.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/PPT.pdf", "pagina": 12 },
    { "tipo": "medios_personales", "descripcion": "Dos analistas con 3 años de experiencia en Power BI", "excluyente": true, "valor_exigido": "2 personas, 3 años", "cumple": "dudoso", "fuente": "colaboradores_buscar: 1 cumple los mínimos", "justificacion": "Solo una persona cumple: falta la segunda.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/PPT.pdf", "pagina": 12 },
    { "tipo": "medios_materiales", "descripcion": "Licencias de la herramienta de visualización a cargo del adjudicatario", "excluyente": false, "cumple": "si", "fuente": "perfil-licitaciones.md: licencias Power BI Pro", "justificacion": "Tenemos licencias propias.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/PPT.pdf", "pagina": 9 },
    { "tipo": "certificacion", "descripcion": "Esquema Nacional de Seguridad, categoría media", "excluyente": true, "valor_exigido": "ENS media", "cumple": "no", "fuente": "perfil.notas: certificada en ISO 27001, sin ENS", "justificacion": "No tenemos el ENS.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/PCAP.pdf", "pagina": 22 },
    { "tipo": "subcontratacion", "descripcion": "No se admite la subcontratación", "excluyente": false, "cumple": "dudoso", "fuente": "perfil.notas: subcontrata siempre el alojamiento", "justificacion": "Habría que pedir autorización para subcontratarlo.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/PCAP.pdf", "pagina": 31 },
    { "tipo": "idioma", "descripcion": "Atención a usuarios y documentación en castellano", "excluyente": true, "valor_exigido": "castellano", "cumple": "si", "fuente": "perfil.idiomas", "justificacion": "El equipo trabaja en castellano.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/PPT.pdf", "pagina": 15 },
    { "tipo": "seguro", "descripcion": "Seguro de responsabilidad civil profesional", "excluyente": false, "valor_exigido": "300.000 €", "cumple": "no", "fuente": "perfil.seguro_rc: sin seguro", "justificacion": "Se contrata si se decide concurrir.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/Anexo I.pdf", "pagina": 6 },
    { "tipo": "lugar_ejecucion", "descripcion": "Prestación en remoto salvo una reunión mensual presencial en Toledo", "excluyente": false, "cumple": "dudoso", "justificacion": "Hay que valorar el coste de los desplazamientos mensuales.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/PPT.pdf", "pagina": 16 },
    { "tipo": "ute", "descripcion": "Compromiso de constitución de UTE firmado por todas las empresas", "excluyente": false, "cumple": "si", "fuente": "perfil.notas: concurre en UTE con una empresa socia habitual", "justificacion": "Hay socia habitual para firmar el compromiso.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/PCAP.pdf", "pagina": 18 },
    { "tipo": "solvencia_tecnica", "descripcion": "Relación de los principales servicios similares de los últimos tres años", "excluyente": true, "valor_exigido": "≥ 70.000 € en el año de mayor ejecución", "cumple": "si", "fuente": "perfil.fecha_constitucion: 2023-09-29", "justificacion": "Tenemos menos de cinco años y el contrato no es SARA: nos vale la norma de nueva creación.", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/Anexo I.pdf", "pagina": 5, "nueva_creacion": { "valor_exigido": "Sin relación de servicios: declaración del equipo técnico y los medios con que se ejecutará", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/Anexo I.pdf", "pagina": 5 } }
  ],
  "cobertura": [
    { "tema": "solvencia_economica", "estado": "en_requisitos" }, { "tema": "solvencia_tecnica", "estado": "en_requisitos" },
    { "tema": "clasificacion", "estado": "no_lo_pide", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/Anexo I.pdf", "pagina": 4 },
    { "tema": "medios_personales", "estado": "en_requisitos" }, { "tema": "medios_materiales", "estado": "en_requisitos" },
    { "tema": "certificaciones", "estado": "en_requisitos" },
    { "tema": "habilitacion", "estado": "no_encontrado", "detalle": "Ningún pliego habla de habilitaciones." },
    { "tema": "subcontratacion", "estado": "en_requisitos" }, { "tema": "idioma", "estado": "en_requisitos" }, { "tema": "seguro", "estado": "en_requisitos" },
    { "tema": "visita_obligatoria", "estado": "no_lo_pide", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/Anexo I.pdf", "pagina": 7 },
    { "tema": "lugar_ejecucion", "estado": "en_requisitos" }
  ],
  "criterios": [
    { "descripcion": "Precio", "peso": 60, "tipo": "formula", "pagina": 30 },
    { "descripcion": "Memoria técnica", "peso": 40, "tipo": "juicio_valor", "subcriterios": [{ "descripcion": "Metodología", "peso": 25 }, { "descripcion": "Equipo", "peso": 15 }], "pagina": 31 }
  ],
  "documentacion": [
    { "sobre": "1", "documento": "DEUC y declaración responsable", "obligatorio": true, "pagina": 10 },
    { "sobre": "2", "documento": "Memoria técnica (máx. 30 páginas)", "obligatorio": true, "pagina": 31 }
  ],
  "hitos": [{ "hito": "Fin de presentación", "fecha": "2026-10-20T14:00" }, { "hito": "Inicio del servicio", "detalle": "al día siguiente de la formalización" }],
  "garantias": [{ "tipo": "definitiva", "porcentaje": 5, "pagina": 15 }],
  "penalizaciones": [{ "descripcion": "0,5 ‰ del precio por día de retraso en las entregas", "pagina": 40 }],
  "riesgos": [{ "descripcion": "Sin ENS categoría media, excluyente", "gravedad": "alta" }, { "descripcion": "Volumen de negocio por debajo del mínimo", "gravedad": "alta" }],
  "recomendacion": { "decision": "no_go", "motivo": "No llegamos al volumen de negocio exigido y no tenemos el ENS media, los dos excluyentes." },
  "titulo_corto": "Cuadro de mando del Servicio de Salud",
  "senales_pliego": [
    { "tipo": "juicio_valor_favorece", "descripcion": "Puntúa con 15 puntos conocer el cuadro de mando que ya usa el Servicio de Salud.", "cita": "se valorará el conocimiento de la plataforma de análisis actualmente implantada", "documento": "Licitaciones/Radar/2026/2026-123 (p-20435341)/PCAP.pdf", "pagina": 31 }
  ]
}
```

## Responder una pregunta al pliego

Tarea `licitaciones.preguntar_pliego`: una persona pregunta algo concreto desde la ficha («¿Piden
ENS?», «¿Se puede subcontratar la formación?») y espera delante de la pantalla.

- Responde solo con lo que dicen los pliegos de esa licitación: ni lo habitual en otros pliegos ni
  lo que harías tú. Busca con `licitaciones_pliegos` (los temas que toquen) o `biblioteca_buscar`
  en las rutas de sus pliegos, y lee las páginas con `biblioteca_leer`.
- Con lo que lo dice: `licitaciones_pliego_responder` con `dice=true`, una respuesta de una o dos
  frases y la `cita` copiada literal del pliego (con «…» si saltas un trozo) y su `documento`. La
  plataforma busca la cita en los pliegos: sin encontrarla, la respuesta sale «no comprobada».
- Si no lo dicen: `dice=false` y, en la respuesta, lo que sí dicen al respecto, si algo, o «El
  pliego no lo dice». La persona puede convertirla en una consulta al órgano.
