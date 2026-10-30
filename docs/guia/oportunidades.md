# Oportunidades

Oportunidades es la bandeja de lo que ha encontrado el radar y aún no está en el Pipeline. Aquí se decide qué se
prepara y qué se descarta, con los filtros, el encaje y la opinión de Hermes a la vista.

<!-- captura: oportunidades · Oportunidades por revisar con los filtros a la izquierda y la opinión de Hermes en cada fila -->

**Oportunidades**: lo que puede encajar y aún no está en el Pipeline, para decidir
**Aplicar** (pasa al Pipeline, en preparación) o **Descartar** con su motivo tipificado, desde
la propia fila. Por fecha de cierre, la más cercana primero. Pestañas **Por revisar**, **Sin
cribar**, **Errores** y **Descartadas**. Lo que descartó Hermes (la criba o una ficha «No go»)
va a Descartadas **apagado**, con su motivo, junto a lo que descartó una persona, y se puede
aplicar igual. Pasadas las 50 primeras, **Ver más**. En un procedimiento en dos fases, el cierre
que se ve (y por el que se ordena) es el de la solicitud de participación mientras siga abierta.
A la izquierda, los filtros del prefiltro a la vista: opinión de Hermes (con sus cuentas),
comunidades autónomas (casillas; ninguna marcada, todas), importe por lote, prefijos CPV, palabras clave, palabras que descartan, tipo
de contrato y lenguas a descartar. Mientras nadie guarde los filtros del radar, que son de ejemplo,
un aviso pide «Ajusta tus CPV» y lleva a Fuentes y filtros (`de_ejemplo` en
`GET /api/licitaciones/filtros`). Empiezan como en Ajustes › Fuentes y filtros y se afinan en la
lista sin cambiar la ingesta («Volver a los del prefiltro»); se recuerdan durante la sesión. Los
prefijos CPV llevan su descripción oficial y se añaden con un buscador del vocabulario CPV: «72»
ofrece la división 72 y sus grupos, y una palabra («estadístic») los códigos que la dicen. El buscador encuentra por título, órgano, expediente o
título de un lote, sin acentos y por el principio de cada palabra («form ia» encuentra «Formación
en IA»); con **Buscar también en los pliegos descargados**, también lo que solo dice el pliego, y
la fila enseña dónde («En el PPT, pág. 12: «…»»). Cada fila lleva su **encaje** (0-100, con el
desglose al pasar el ratón); el orden sigue por fecha de cierre hasta que la calibración diga que
el encaje ordena como decidimos (entonces la lista va por encaje y lo dice). **Guardar búsqueda** guarda lo buscado y los filtros con un
nombre y cada cuánto avisar (cada día o cada semana) de las nuevas que entren en Por revisar y la
cumplan; cada persona ve las suyas en **Ajustes › Avisos** (con cuántas nuevas trajo esta semana,
pausar, borrar y «Ver en Oportunidades», que abre la lista con esa búsqueda). Una fila abre la ficha
en su página.

## Oportunidades por estado

**Oportunidades**: lista por estado con cuántas hay en cada uno, una pestaña por estado:
**Mi mesa** (en preparación), **Por decidir** (Hermes ya dejó la ficha y no se descartó
sola), **Nuevas** (cribadas, a la espera de que Hermes lea los pliegos), **Errores**,
**Descartadas (en plazo)** y, solo si las hay, **Sin cribar**. **Errores** son las nuevas
en plazo que el proceso automático ya no saca adelante solas, con el motivo en la fila y en
la ficha: ningún pliego se pudo bajar (ni queda ninguno por bajar), la Biblioteca no puede
leer los pliegos (escaneados o dañados) o Hermes no hizo la ficha en sus tres rondas. La
marca se recalcula en cada vuelta del radar, así que sale sola de Errores cuando se arregla
(y no tapa una ficha ya hecha). **Reintentar** vuelve a poner en cola los pliegos con error o
pide otra ficha; con pliegos ilegibles no sirve y la ficha propone subir uno legible o
descartar. Al registrar la presentación sale de aquí y pasa a la vista
**Presentadas**, que filtra por resultado (pendiente, ganada, perdida…). Por defecto se
ven Nuevas, Ficha por revisar y En preparación. La ficha no se aprueba: vale desde que llega. Con
búsqueda, comunidad autónoma (por su NUTS; por defecto, todas) y orden por plazo, importe o llegada. El orden por plazo es por el **próximo plazo**: en los
procedimientos en dos fases, la solicitud de participación mientras siga abierta (cierra antes
que la oferta) y, si no, la oferta; lo vencido va al final. Cada fila enseña lo que hace falta para
decidir sin abrirla: importe, plazo con su fecha y su hora, que no es la misma en todas
(«en 2 días · mié 7 oct · 14:00», y «(13:00 Canarias)» si la empresa está allí: la PLACSP publica la hora peninsular), semáforo de
requisitos, opinión de Hermes («Encaja», «Encaja con dudas» o «No encaja»; si la licitación ya tiene ficha,
la opinión de la ficha, con los pliegos leídos, manda sobre la de la criba, en la lista y en la
cabecera de la ficha) y su motivo a la vista, lotes de interés, si ya tiene
ficha por revisar y si es nueva desde la última visita. Si la lista sale vacía
pero hay candidatas sin cribar, lo dice y ofrece verlas o cribarlas. En «Sin cribar»
solo hay licitaciones abiertas con fecha límite: la que cierra (plazo vencido, adjudicada o anulada)
antes de que la IA la vea sale sola, y si un lote de criba falla sus candidatas vuelven
a la cola.

## Encaje

**Encaje**: de 0 a 100, siempre con su desglose («Encaje 82 · cómo sale» en el Resumen de
la ficha y delante de «¿Merece la pena?»). Seis componentes con su peso: **temática** 0,30 (la
opinión de Hermes mezclada con lo que se parece el CPV al del perfil y al de nuestras presentadas;
barra lavanda), **solvencia y medios** 0,20 (requisitos cumplidos 1, por confirmar 0,5, no
cumplidos 0), **competencia** 0,15 (ofertas esperadas por las adjudicaciones de CPV parecido; menos
si el órgano lo gana casi siempre otra empresa), **economía** 0,15 (el importe frente al de las
que ganamos), **capacidad** 0,10 (ofertas en preparación que cierran a ±7 días) e **historial**
0,10 (lo que ganamos con ese órgano, acercado a la tasa global si son pocas). Un excluyente que no
cumplimos deja el encaje en 20 como mucho («no elegible»). Lo que no tiene datos no cuenta (su peso
se reparte) y lo dice. `GET /api/licitaciones/encaje/calibracion` da su AUC frente a lo que decidimos (cada oferta, sin contar su propia propuesta, y con 20
preparadas y 20 descartadas como mínimo): hasta 0,75 no ordena. Hermes no ve el
encaje (saldría de su propia opinión).
