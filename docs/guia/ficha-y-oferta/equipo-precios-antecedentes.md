# Equipo, precios y antecedentes

Tres bloques del detalle de cada licitación que ayudan a decidir si se va y con qué: quién del equipo cumple los
perfiles que pide el pliego, qué bajas se han visto en contratos parecidos y si la licitación ya salió antes y quién
la ganó.

<!-- captura: ficha-mercado · La pestaña Mercado de la ficha con la baja esperada y las adjudicaciones parecidas -->

## Equipo de la licitación

**Equipo** (en el detalle de cada licitación). Por cada requisito de medios personales
de la ficha (con su página y si es excluyente), las personas del equipo y las
externas que mejor encajan, por separado, con una puntuación orientativa de 0 a 100,
si llegan a los mínimos y cada comprobación (experiencia, titulación, certificación,
idioma: cumple, en parte, no cumple o sin dato en el perfil) más la afinidad
(tecnologías y rol que cita el requisito, experiencia en el mismo CPV, CV que la
Biblioteca encuentra por significado). Sin ficha, o para otro requisito, se
busca escribiéndolo a mano. Sin IA: la decisión y la lectura de los CV son de una persona.
Con lotes de interés, la afinidad por CPV usa el de esos lotes.

## Precios

**Precios** (en el detalle de cada licitación). Con lotes de interés, se calcula para
el lote (su presupuesto y su CPV; con varios, se elige cuál) y no para el total. Con el
histórico de adjudicaciones,
la baja (`1 − importe adjudicado / presupuesto del lote`) de las adjudicaciones más
parecidas: mismo CPV de 8 cifras, tipo, procedimiento y banda de importe (de un tercio
al triple); si no hay al menos 20, se ensancha paso a paso (sin procedimiento, sin
banda, CPV de 5, 4, 3 y 2 cifras, todos los CPV) y dice qué segmento usó y cómo lo
eligió. Muestra los percentiles en barras (P10, P25, mediana, P75, P90), media,
dispersión, la evolución por año y la baja según el número de ofertas. Se descartan
las bajas imposibles (negativas, de más del 70 % o 0 con varias ofertas, que suelen ser
precios unitarios o el máximo de un acuerdo marco) y se dice cuántas.

- **Escenarios de oferta:** para cada percentil y para la baja que escribas, el importe
  sin IVA, en cuántas adjudicaciones parecidas ganó una baja igual o menor y si la
  oferta podría quedar como anormalmente baja según el art. 85 del RGLCAP con el número
  de ofertas esperado (por defecto, la mediana del segmento; se puede cambiar) y
  suponiendo que el resto oferta la baja mediana. Se puede limitar a «solo este órgano».
  Es orientativo: manda lo que diga el pliego.
- **Adjudicaciones parecidas:** adjudicaciones con la misma división CPV (2 primeras
  cifras), el mismo tipo de contrato y un presupuesto entre un tercio y el triple (con
  baja creíble); las del mismo órgano se buscan aparte para que no se queden fuera por
  antiguas, por NIF o, si la plataforma no lo publica, por código DIR3 o nombre del
  órgano. Orden: mismo órgano, **objeto parecido** (palabras del título sin años,
  números ni palabras vacías), CPV más largo en común y fecha. Cada una con
  adjudicatario, fecha, presupuesto, importe, baja, ofertas y enlace a la PLACSP; el
  bloque lo explica en «Cómo se eligen». «Solo este órgano» se aplica también a esta
  lista (y al segmento de bajas). No son las ediciones anteriores: esas están en
  **Antecedentes**.

## Antecedentes

**Antecedentes** (en el detalle de cada licitación). Muchas licitaciones «ya tienen
nombre»: aquí se ve si la misma licitación salió en años anteriores y quién la ganó.

- **Ediciones anteriores:** licitaciones del **mismo órgano** (por NIF; sin NIF, por
  DIR3 o por el nombre de la entidad: «Junta de Gobierno Local» o «Alcaldía» cuentan
  como su ayuntamiento) publicadas **al menos seis meses antes**, con un **objeto
  parecido** (palabras del título sin años, números de expediente ni palabras vacías;
  pesan más las que el órgano usa poco), CPV en común e importe parecido. Nunca cuentan
  el mismo servicio en otra provincia, ruta o sector, ni los contratos basados en un
  acuerdo marco. Con los umbrales elegidos, en una muestra revisada a mano de dos meses
  reales de la PLACSP (2023 y 2025) acertaban 9 de cada 10. Las adjudicaciones del mismo
  órgano con otro objeto van aparte y plegadas («No es una edición anterior: el objeto no se
  parece»): dicen qué más contrata el órgano, no quién ganó antes esta licitación, y son las
  mismas que Precios enseña con «Solo este órgano», para que las dos no se contradigan.
- **Línea de tiempo:** por edición (de la más reciente a la más antigua) el año, el
  expediente con enlace, el lote, quién ganó (nombre y NIF, con enlace a su ficha), el
  importe, la baja, el número de ofertas, la duración y el inicio y fin del contrato
  (el fin, estimado con inicio y duración si el órgano no lo publica) y el parecido. Con
  lotes, cada lote tiene la suya: se casa con el lote de nombre más parecido de cada
  edición, o con el contrato entero si antes no iba por lotes.
- **Indicios de licitación con nombre**, cada uno con su explicación y su dato, y un
  **nivel bajo, medio o alto** con reglas fijas (que el bloque enseña): mismo
  adjudicatario en las últimas ediciones seguidas, ediciones con una sola oferta o muy
  pocas (por lote: la mitad o más de sus lotes), bajas mínimas del adjudicatario anterior
  (menos del 2 %, sin contar las de una sola oferta, que ya cuentan como tales), el
  contrato nuevo empieza justo al acabar el anterior, plazo de presentación por debajo
  del mínimo legal de su procedimiento y tipo de contrato (días desde el anuncio: 15 en
  el abierto y 26 en obras y concesiones, 15 en el simplificado y 20 en obras, 10 o 5
  días hábiles en el sumario; el plazo en el mínimo, lo habitual, se enseña sin
  puntos), volumen de negocio por encima del tope legal de 1,5 veces el valor estimado
  (con un 10 % de margen) o trabajos similares de más del doble de su referencia (70 %
  de la anualidad media), y las señales del pliego de la ficha (las de un lote,
  solo en ese lote). En los lotes, la solvencia general se mide contra el contrato
  entero y la del lote contra el lote. Alto desde 5 puntos, medio desde 3. Son
  indicios, no pruebas, y se dice así; con lotes, cada lote tiene su nivel y el de la
  licitación es el mayor. Sin ediciones anteriores ni indicios, el bloque dice **Sin
  datos** (no «bajo») y por qué: órgano no identificable o histórico sin esos años.
