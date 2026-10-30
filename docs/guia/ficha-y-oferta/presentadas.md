# Propuesta y Presentadas

Qué pasa cuando la oferta ya está presentada: el registro de lo que se entregó, el resultado que llega de la PLACSP,
la evaluación con Hermes y el histórico de la vista Presentadas.

<!-- captura: presentadas · La vista Presentadas con el resultado de cada oferta y la tasa de éxito -->

## Propuesta y vista Presentadas

**Propuesta** (en el detalle de cada licitación) y vista **Presentadas**.

- **Registro de lo presentado:** por licitación y lote, la fecha, el importe ofertado
  sin IVA (con la baja calculada contra el presupuesto del lote o de la licitación), los
  documentos presentados (rutas en `Salidas/…` o `Conocimiento/…`, elegidos de la
  carpeta de la licitación o escritos) y notas. Al registrarla, la oportunidad pasa a
  **Presentada** y se crea su carpeta en `Conocimiento/Licitaciones/Presentadas/` (ver
  **Carpetas**, en el Radar de licitaciones), que el bloque muestra. Después se apuntan el resultado (pendiente, ganada, perdida,
  excluida, desierta o retirada), las puntuaciones técnica, económica y total, la
  posición, la puntuación del ganador y las **lecciones aprendidas**. Si la criba eligió
  un único lote de interés, el formulario lo trae puesto.
- **Lotes de interés en borrador, evaluación y parecidas:** el borrador y la evaluación
  de Hermes se hacen para esos lotes (o para el contrato si hay que ir a todos) y las
  propuestas parecidas se buscan con su importe y su CPV.
- **Resultado automático:** cuando la PLACSP publica la adjudicación del lote (o del
  contrato), lo presentado pasa solo a **ganada** si el adjudicatario es el NIF del
  perfil de la empresa, a **perdida** si es otro (con quién ganó, por cuánto y con qué
  baja) o a **desierta**. Si la PLACSP cambia luego la adjudicación, el resultado
  automático cambia con ella. No decide si ganó una UTE (podemos estar en ella) ni pisa
  un resultado puesto a mano («Pendiente» se lo devuelve a la PLACSP); guardar solo
  puntos o notas no lo convierte en manual. Una propuesta al contrato entero en una
  licitación por lotes espera a que todos los lotes estén adjudicados o desiertos.
- **Estado de la oportunidad:** sale de todo lo presentado: **ganada** si algún lote
  está ganado, **perdida** si todo está decidido y algo perdido o excluido, y si no,
  **presentada** (también al reabrir un resultado). Da igual en qué orden se resuelvan
  los lotes. Si una persona movió la oportunidad a otro estado, no se toca.
- **Corregir lo registrado:** «Editar» deja cambiar la fecha, el importe (recalcula la
  baja) y los documentos, además del resultado, los puntos, las notas y las lecciones.

- **Evaluar una propuesta con Hermes** (con ficha): se elige un documento
  (de la carpeta de la licitación en Salidas o su carpeta de presentada en Conocimiento
  —o, sin ella, la de sus pliegos—, o con su ruta; no hay
  ninguno elegido de entrada para no evaluar un pliego por error) y
  Hermes lo lee entero y da una puntuación estimada total y por criterio de la ficha con
  su justificación, qué **eliminar, modificar y reforzar** (con sección o página), las
  propuestas (primero las de Presentadas) y adjudicaciones parecidas con las que comparó y los riesgos. Solo se
  admite con los criterios de la ficha (los mismos, con la misma suma de
  pesos). Es una opinión orientativa, pendiente de revisar como la memoria (aceptar o
  descartar): el documento no se toca.
- **Propuestas anteriores parecidas:** mismo órgano, clase o división CPV, tipo de
  contrato y presupuesto parecido (de un tercio al triple), las ganadas primero, con
  su carpeta de presentada, sus documentos y lecciones.
- **Vista Presentadas:** histórico filtrable por resultado y texto (abre el detalle de
  la licitación) y estadísticas: tasa de éxito (ganadas entre ganadas, perdidas y
  excluidas) total, por sector (división CPV), por órgano y por banda de importe;
  importe ganado; nuestra baja frente a la ganadora (en lo que ganamos y en lo que
  perdimos, con la diferencia); y puntuaciones medias frente al ganador.
  **Aprendido de las actas:** en cada carpeta de `Presentadas/` donde el equipo deja el
  acta de la mesa, el informe de valoración o la resolución de adjudicación (se
  reconoce por el nombre, en la carpeta o sus subcarpetas, sin contar `PLIEGOS` ni
  `DOCUMENTACION PRESENTADA`), Hermes la lee sola (dos por minuto, una vez por carpeta)
  o al pulsar «Leer actas pendientes (N)»: puntos por criterio nuestros y del ganador,
  lo que dijo la mesa de nuestra oferta copiado literal (el servidor lo comprueba con el
  documento) y lecciones concretas comparando con nuestra memoria presentada. Entra
  pendiente; una persona lo acepta o lo descarta. Solo lo aceptado se usa: al redactar
  cada apartado de la memoria (lo que dijeron las mesas en criterios parecidos) y en las
  propuestas parecidas (mismo órgano o CPV).
