# Carpetas de las licitaciones

Dónde guarda la plataforma los documentos de cada licitación: los pliegos, lo que prepara para la oferta, lo
presentado y la resolución. Sirve para saber qué hay en cada carpeta de Drive (o del disco), qué puede tocar Hermes y
cómo se pasa a la carpeta única desde una instalación que guardaba las cosas de otra forma.

## Carpeta única por licitación

Cada licitación del Pipeline tiene una sola carpeta en Conocimiento, y la Biblioteca la indexa entera, borradores
e importes incluidos: de ahí aprende Hermes de las ofertas pasadas.

```
Conocimiento/Licitaciones/Ofertas/<expediente> · <título corto> (<id>)/
  Pliegos/       los pliegos bajados de la PLACSP y los que subes a mano
  Oferta/        lo que monta la plataforma: memorias, anexos/, documentos/, dossier, DEUC
  Sobres/        los paquetes de presentación, por versión, lote y sobre
  Presentada/    DOCUMENTACION PRESENTADA, Otros documentos/ y la copia del paquete presentado
  Resolución/    actas y adjudicación
```

El nombre acaba en el id de la licitación y no pasa de 100 caracteres. Se fija al crear la carpeta y no se
recalcula: si la PLACSP cambia el título, la carpeta es la misma. **Aplicar** una oportunidad crea su carpeta, y la
ficha enseña un solo botón, **Carpeta en Drive**. Lo que no está en el Pipeline (el histórico del radar) se queda en
`Licitaciones/Radar/<año>/`.

- **Hermes no escribe ahí.** Manda el contenido por MCP y la plataforma monta y guarda los archivos; tampoco crea ni
  mueve carpetas.
- **Las copias de CV** (`Oferta/documentos/Colaboradores/`) se indexan, pero `biblioteca_buscar` y `biblioteca_leer`
  no las enseñan a un agente sin permiso de colaboradores.
- **La oferta en curso** se consulta con `salidas_listar` y `salidas_leer`, que aceptan estas rutas y no enseñan
  los importes de la oferta, que teclea una persona.
- **Drive sigue siendo la fuente de verdad.** Las carpetas se mueven con la API de Drive (enteras, con sus Google
  Docs) y drive-sync las baja al disco; sin Drive, se mueven en el disco.

## Sin carpeta única: Radar y Presentadas

Lo que baja el radar (`Licitaciones/Radar/`) y lo que hemos presentado
(`Licitaciones/Presentadas/`) van separados dentro de Conocimiento (rutas configurables). Es como se guarda una licitación mientras no tiene su carpeta única.
Al registrar una presentación se crea
`Presentadas/<AAAA-MM - expediente - órgano abreviado - tema>/` (mes de presentación y
tema sacado del título, sin caracteres que Drive o Windows no admitan; si ya existe,
con `-1`) con `PLIEGOS`, `DOCUMENTACION PRESENTADA` y `OTROS DOCUMENTOS`, y los pliegos
de la licitación (todas sus carpetas) pasan de Radar a `PLIEGOS` (con Drive conectado,
por su API, con sus Google Docs; si no, en el disco, y la sincronización lo sube). Si
en Presentadas ya hay una carpeta de ese expediente (`AAAA-MM - <expediente> - …`, como
las que el equipo haya creado a mano), se usa esa en vez de crear otra; las propuestas
ya registradas también reciben (o enlazan) la suya. Al borrar la última propuesta de
una licitación, su carpeta se cancela si aún no se había creado (nunca se borra nada de
Drive). Lo que se baje después de esa licitación va a `PLIEGOS`; sin carpeta de
presentada, junto a los pliegos que ya tenga (así nunca queda partida en dos carpetas).
Una **reorganización única** adapta las carpetas que una instalación tuviera con
otra distribución: al
arrancar, si no está hecha, mueve en Drive las carpetas de primer nivel de
`Licitaciones` que empiezan por `AAAA-MM - ` a `Presentadas/` y las de
`Licitaciones/<año>/` que acaban en `(p-…)` o `(a-…)` a `Radar/<año>/`; nada más, sin
borrar ni sobrescribir (destino ocupado: `-1`), y actualiza las rutas guardadas para que
la Biblioteca, Hermes y la web sigan encontrando todo (también el `fuente` de las
propuestas de nota pendientes). Una carpeta con archivos que la sincronización aún no ha
subido a Drive no se mueve hasta el siguiente intento. Con Drive desconectado no hace
nada (y lo dice); mientras mueve y hasta que el cambio llega al disco, la descarga de
pliegos espera. Si alguna carpeta falla, se queda en su sitio, se reintenta cada 15
minutos y lo demás (descarga de pliegos, carpetas de presentadas) sigue. Funciona
también con la ingesta desactivada.

## Pasar a la carpeta única

Una instalación que guardaba cada licitación en dos raíces (los pliegos en `Licitaciones/Radar/` o
`Licitaciones/Presentadas/` y lo generado en `Salidas/Licitaciones/`) pasa a la carpeta única desde
**Ajustes › Drive › Carpeta única por licitación**. Hasta que una licitación tiene su carpeta, todo sigue donde
estaba.

1. **Hacer el ensayo** (`GET /api/licitaciones/carpeta-unica/ensayo`) solo lee el disco y la base. Para cada
   licitación en preparación, presentada, ganada o perdida lista los movimientos `de → a` con archivos y bytes,
   cuántas rutas guardadas apuntan dentro y los avisos. Aparte, enseña las carpetas de `Salidas/Licitaciones/` que no
   son de ninguna licitación, que se quedan donde están.
2. **Migrar a la carpeta única** (`POST /api/licitaciones/carpeta-unica/migracion`, con confirmación) trabaja en
   segundo plano. Se niega si hay trabajos de Hermes en marcha, porque escriben en las carpetas que se mueven. Antes
   copia `licitaciones.db` y `nucleo.db` en `<datos>/copias/carpeta-unica-<fecha>/` y, al acabar, escribe un
   `manifiesto.json` con cada movimiento (`de`, `a` y el id de Drive): con él se deshace moviendo al revés y
   restaurando las bases.
3. Cada carpeta va a su sitio sin pisar nada. Si el destino está ocupado, esa licitación se queda como estaba y se
   reintenta al repetir. Tras cada carpeta movida se reescriben las rutas guardadas que apuntaban dentro, en todas
   las tablas y en las propuestas de nota pendientes.
4. Se puede repetir: lo migrado no se toca y el ensayo, repetido, sale vacío.

Hazla lejos de un plazo de presentación y sin trabajos de IA en curso, como cualquier actualización
([Actualizar](../empezar/actualizar.md)).
