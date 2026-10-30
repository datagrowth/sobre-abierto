<!-- Referencia de la skill «licitaciones». Se carga bajo demanda desde SKILL.md. -->

# Precios, antecedentes y competidores

**Cuándo leer esto.** Cuando pregunten qué baja ofertar, cuánta competencia habrá, quién se presentará, quién gana contratos parecidos, si una licitación «ya tiene nombre», quién es un competidor o qué órganos nos interesan, y en la tarea «Resumen con Hermes» de un competidor. Las cifras las calcula el código: tú las explicas.

## Precios y bajas

Cuando te pregunten qué baja ofertar, cuánto suele bajarse o quién gana contratos
parecidos. Los números los calcula el código con el histórico de la PLACSP: tú los
explicas, no los inventes ni los recalcules.

1. `licitaciones_precios` con el `id` (o, sin licitación, con `cpv` de 8 cifras, `importe`
   sin IVA y `tipo`: `1` suministros, `2` servicios, `3` obras). Las bajas van como
   fracción: `bajas: [0.12]` es un 12 %. Opcionales: `ofertas` (número esperado),
   `mismo_organo`, `filtrar_ofertas`, `importe` y `lote`. Con `id`, se calcula para el
   primer lote de interés de la criba (su presupuesto y su CPV) o el `lote` que pidas;
   `lote` y `lotes_interes` de la respuesta dicen para cuál. Sin lotes de interés, para el
   contrato entero.
2. Di siempre con qué se compara: `segmento.descripcion` y `segmento.n`. Si
   `segmento.suficiente` es `false`, avisa de que la muestra es pequeña (falta cargar
   histórico en **Licitaciones › Ajustes › Estado**) y no des cifras como seguras.
3. Rango razonable: entre `p25` y `p75` de `estadistica.percentiles`; la mediana es `p50`.
   `tendencia_anual` es el cambio medio por año (en tanto por uno) y `por_ofertas`, la
   mediana según la competencia: a más ofertas, más baja.
4. Escenarios: en cada fila de `escenarios.filas`, `importe` sin IVA, `ganadas_con_menos`
   (proporción de adjudicaciones parecidas cuyo ganador ofertó esa baja o menos) y
   `anormal` (posible oferta anormalmente baja por el art. 85 del RGLCAP con
   `ofertas_esperadas`, suponiendo que el resto oferta la mediana). `umbral_anormal` es la
   baja a partir de la cual salta. Recuerda que es orientativo y que **manda el pliego**:
   si la ficha o el PCAP fijan otro criterio de anormalidad, usa ese.
5. Para ejemplos concretos, `licitaciones_comparables` (mismo órgano primero, luego objeto
   parecido; con `mismo_organo: true` y `id`, solo las de ese órgano) con el adjudicatario
   y su baja. Para lo que pasó en esta misma licitación otros años (quién la ganó, con qué
   baja y cuántas ofertas), `licitaciones_antecedentes`.

## Antecedentes de una licitación

Cuando pregunten si una licitación «ya tiene nombre», si salió otros años o quién la ganó.
Lo calcula el código con el histórico de la PLACSP: tú lo explicas.

1. `licitaciones_antecedentes` con el `id` (y `lote` si preguntan por uno). `ediciones` es
   la línea de tiempo del contrato y `lotes[].ediciones` la de cada lote; `similitud` (0–1)
   dice cuánto se parece el título.
2. Cuenta qué ediciones hay (año, quién ganó, importe, baja, ofertas, fechas) y el nivel
   (`nivel`, con `indicios[].dato` y `explicacion`). `reglas` dice cómo se puntúa;
   `sin_datos`, lo que no se pudo mirar (p. ej. sin fecha de anuncio).
3. Sin ediciones, dilo: puede que no haya años cargados en el histórico o que sea nueva.
4. Son indicios, no pruebas: la PLACSP solo publica quién ganó, no quién se presentó. No
   digas que está amañada ni acuses a nadie; di qué patrón se ve y qué habría que mirar en
   el pliego.

## Índices de mercado y licitadores

Cuando te pregunten cuánta competencia habrá, qué baja se espera o quién se presentará. Son los
mismos números que ve la persona en la ficha: cítalos tal cual, no los recalcules.

1. `licitaciones_indices` (`id`, `lote` opcional): `resumen` es la línea de la ficha («3 ofertas
   esperadas (2-5) · 1 de cada 4 con un solo licitador · n = 41, CPV 4 dígitos, confianza media»).
   `competencia.ofertas` y su `rango`; `competencia.p_un_licitador` (fracción); `baja.esperada` y
   `baja.rango` (fracciones: 0.085 = 8,5 %); `baja.umbral_anormal` (art. 85 con esas ofertas: manda
   el del pliego si lo hay, que está en `licitaciones_precios`).
2. Con `confianza: "baja"` (menos de 10 comparables o CPV a 2 cifras) di «pocos datos (n = …)» y no
   des la cifra como buena. Di siempre la muestra (`muestra.n`, `muestra.descripcion`) y, si hay
   `acierto`, cuánto se desvía el índice (`acierto.baja.texto`).
3. «La oferta más barata» no es «ganar»: los juicios de valor también puntúan.
4. `licitaciones_licitadores` (`id`, `lote` opcional): `probables`, con su `evidencia`, y
   `presentados` si ya se resolvió (la adjudicataria es de la PLACSP; los demás, de su acta, con
   `fuente` y `confianza`). Una persona física sale como «persona física»: no la nombres.

## Competidores y organismos

Cuando te pregunten quién gana en lo nuestro, cómo oferta un competidor o qué órganos nos
interesan. Las cifras las calcula el código con las adjudicaciones de la PLACSP: tú las
explicas y las cruzas, no las recalcules ni completes con suposiciones.

- **Solo hay datos de ganadores.** La PLACSP publica quién gana cada contrato o lote, no
  la lista de licitadores ni sus ofertas: no sabemos en cuántos concursos participa una
  empresa sin ganar ni su tasa de éxito. Dilo cuando importe.
- `competidores_ranking`: `meses` (0 = todo el histórico), `orden` (`importe`,
  `contratos` o `coincidencias`), `cpv` (prefijos, si quieres otro sector) y `texto`.
  `coincidencias` cuenta sus contratos en órganos donde tenemos oportunidades abiertas o
  en su misma clase de CPV (4 cifras): son los que más nos conviene vigilar. `seguido`
  dice si el equipo lo marcó a mano.
- `competidores_ver` (`nif`, `solo_sector` opcional): rango de baja en
  `bajas.percentiles` (como fracción: 0.18 = 18 %), número de ofertas de los contratos que
  gana en `ofertas` (muchas ofertas y baja alta = compite en precio), y `coincidencias`
  con nuestras oportunidades. `seguido.notas` son las notas del equipo.
- `organismos_ranking`: `interes.puntos` combina volumen licitado (45 %), meses con
  licitaciones del sector (35 %) y baja moderada (20 %); es una forma de ordenar, no una
  predicción. `organismos_ver`: `adjudicaciones.concentracion` es la parte de contratos
  que se lleva el que más gana (alta = cliente con proveedor habitual).

### Resumen de un competidor

Llega como tarea automática cuando alguien pulsa «Resumen con Hermes» en la ficha de un
competidor:

1. `competidores_ver` con su `nif`.
2. Si te ayuda, `biblioteca_buscar` en la carpeta `Competidores` por si ya hay notas.
3. `biblioteca_proponer` con `titulo` «Competidor <nombre> (<NIF>)», `carpeta`
   `Competidores` y **sin** `fuente`: quién es, en qué gana (CPV), dónde (órganos y
   territorios), cómo (baja típica y frente a cuántas ofertas), cómo evoluciona, dónde
   coincide con lo nuestro y qué vigilar. Cita las cifras tal cual; recuerda que solo hay
   datos de ganadores. La nota queda pendiente de aprobar.
