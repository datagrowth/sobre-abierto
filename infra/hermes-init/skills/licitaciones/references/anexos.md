<!-- Referencia de la skill «licitaciones». Se carga bajo demanda desde SKILL.md. -->

# Anexos y DEUC

**Cuándo leer esto.** En una tarea «rellena el modelo» (sección «Rellenar un anexo»), sea Word, PDF transcrito, tabla de requisitos o PDF con formulario, y cuando pregunten por el DEUC.

Antes de trabajar en una oferta, lee `licitaciones_oferta` con `secciones` = `["estado", "bloqueos"]` (regla del núcleo de la skill).

## Rellenar un anexo

Llega sola al guardar las decisiones (un anexo por documento de la checklist con modelo
Word; el de la oferta económica de un lote, cuando su precio está decidido) o cuando una
persona pulsa «Rellenar con Hermes» (los `.doc` llegan convertidos). Al guardar las
decisiones solo llega si cambió lo que lleva el anexo (el precio o los criterios de su lote en
el económico; el equipo, los criterios o los lotes en los demás). Si entre los pliegos hay un
Word suelto con el mismo anexo («ANEXO V.docx»), el modelo es ese y no el PDF del pliego. Si la tarea es de un
lote, la hoja de datos es la de ese lote: si el modelo trae un bloque por lote, rellena solo
el de tu lote y deja los demás intactos. La tarea trae:
el nombre del modelo y dónde está, la **hoja de datos** (empresa y representante, licitación
y lotes, importe con su impuesto, criterios automáticos a los que nos acogemos con su
casilla; lo que falta va marcado «falta») y los **párrafos numerados** del documento de
modelos, con «⟵» en los que tienen huecos y «|» en los de una tabla. Si el documento trae
varios anexos, la tarea dice dónde parece empezar y acabar el tuyo.

1. Elige el rango: `desde_parrafo` = el párrafo con el título del modelo («ANEXO VII»),
   `hasta_parrafo` = el último antes del siguiente anexo. Usa la numeración de la tarea.
2. Una sustitución por cada hueco que la hoja permita rellenar: `parrafo`; `original` = el
   trozo literal del párrafo **con su etiqueta y el hueco**, copiado tal cual con sus puntos
   (así no hay duda de qué hueco es: «con NIF ……», no solo «……»); `nuevo` = el mismo trozo con
   el dato en lugar del hueco; `dato` = la etiqueta de la hoja de la que sale. Si un mismo
   `original` aparece dos veces en el párrafo, cada sustitución rellena la primera que queda.
3. Casillas: «☐» → «☒» solo en los criterios automáticos a los que la hoja dice «Sí, nos
   acogemos». Las demás se quedan como están.
4. El texto del modelo no se toca: ni se reescribe, ni se resume, ni se quitan opciones
   («en nombre propio o en representación de» se queda entero). Lugar y fecha, de la hoja
   («Empresa · Lugar» y «Firma · Fecha»: «a la fecha de la firma electrónica»). La firma,
   **nunca**: su hueco («Fdo.: ……») se queda en blanco; la pone una persona con su
   certificado. El importe, solo si la hoja lo trae.
5. `licitaciones_anexo` con `id`, `clave` (la de la tarea), el rango y las sustituciones.

Qué comprueba la plataforma (con la frase exacta del error):
- **Siempre** se rechaza: un cambio en el texto del modelo («… cambia el texto del modelo
  «en representación de»: solo se rellenan los huecos…»), un `original` que no es un hueco,
  sustituciones fuera del rango, un rango imposible, un importe cuando el precio no está
  decidido («El precio aún no está decidido…: deja vacío el hueco del importe…») y
  cualquier texto en la firma («La firma se deja en blanco: la pone una persona con su
  certificado…»).
- Se rechaza hasta el tercer envío (luego entra con avisos): un `original` que no está en su
  párrafo, un rango que no empieza por el título del modelo, un dato distinto del de la hoja
  (««NIF» es «B12345678» en la hoja de datos y el párrafo 8 pone…») o inventado cuando la
  hoja dice «falta».
- Con el plan aceptado, rellena el modelo (el dato hereda el formato del texto del hueco),
  lo saca a su propio `.docx` (+ PDF si hay LibreOffice) en
  `anexos/` de la carpeta de la oferta (`Oferta/anexos/` de su carpeta única o, sin ella, `Salidas/Licitaciones/<expediente> (<id>)/anexos/`) y lo deja como **borrador**: una persona
  lo revisa, completa lo que queda (los avisos dicen qué párrafos) y lo firma.

```json
{
  "id": "p-12345678",
  "clave": "a2-d1",
  "desde_parrafo": 6,
  "hasta_parrafo": 14,
  "sustituciones": [
    { "parrafo": 8, "original": "D./Dña. ……………………", "nuevo": "D./Dña. Ana García Pérez", "dato": "Representante" },
    { "parrafo": 8, "original": "con NIF ……………", "nuevo": "con NIF 12345678Z", "dato": "NIF del representante" },
    { "parrafo": 8, "original": "en representación de ………………………", "nuevo": "en representación de Analítica Ejemplo, S.L.", "dato": "Nombre o razón social" },
    { "parrafo": 8, "original": "con domicilio en ………………………", "nuevo": "con domicilio en Calle La Marina 7, Santa Cruz de Tenerife", "dato": "Domicilio" },
    { "parrafo": 9, "original": "importe de …………………", "nuevo": "importe de 40.000,00", "dato": "Importe sin impuestos" },
    { "parrafo": 9, "original": "IGIC de …………", "nuevo": "IGIC de 2.800,00", "dato": "Cuota de IGIC" },
    { "parrafo": 10, "original": "☐", "nuevo": "☒", "dato": "Certificado ISO 14001" }
  ]
}
```

**El DEUC lo prepara la plataforma: no lo rellenes.** Lo genera por código como `DEUC-vN.xml`
(desde la petición del órgano y el perfil de empresa, sin precio) cuando `LICITACIONES_DEUC_XML`
está encendido, y una persona lo importa en el servicio DEUC. `licitaciones_oferta` con `estado`
trae `deuc: { version, sin_responder }`. Si faltan datos de la empresa (NIF, domicilio), dilo; los
motivos de exclusión los responde una persona en el servicio DEUC, nunca tú. No pidas un anexo
para el DEUC ni lo redactes a mano.

### Si el modelo es un PDF sin formulario o una tabla de requisitos

La plataforma analiza sola cada modelo PDF del guion. Si no tiene formulario pero localiza el
tramo del modelo (con huecos y 6 páginas como mucho), lo **transcribe a Word** y la tarea llega
como la de un Word: empieza por «TRANSCRITO DEL PDF «…» (páginas)», con los párrafos numerados de la
transcripción. Se rellena igual que un Word; el aviso de compararlo con el PDF original sale solo
en el borrador, no lo escribas tú. Si es
una **tabla de requisitos** sin huecos (cabecera «Requisito» y «Cumplimiento», filas «N.M …»,
como un anexo técnico de 31 requisitos), la plataforma genera un Word propio con una fila por requisito y
dos huecos por fila: «Cumplimiento» (una de las opciones literales de la cabecera del pliego) y
«Evidencia/fuente». Una sustitución por celda. Lo escaneado o sin tramo claro se queda «a mano»
y no llega a ti. El borrador avisa siempre de compararlo con el PDF original antes de firmar.

**Huecos de redacción.** Lo que no sale de la hoja (la evidencia de un requisito, una medida
equivalente) va con `dato` = «Redacción» y `fuentes`: 1-5 documentos de los que sale
(`{ "ruta": "Conocimiento/…" o "Salidas/…", "pagina": 12 }`), que existan. Sin fuentes, o con
una ruta que no existe, se rechaza. Búscalas con `biblioteca_buscar`; si no hay evidencia, deja
el hueco vacío y dilo en el aviso. Cada hueco redactado sale en los avisos del borrador para que
una persona lo compruebe. La firma y un importe sin decidir siguen sin poder rellenarse.

**Vía alternativa de un requisito excluyente** (p. ej. el Anexo XIV frente al ENS): la tarea lo
dice. Solo se prepara mientras el requisito siga abierto en las comprobaciones, y lo pide una persona (con
confirmación) o tú con `licitaciones_pedir`; la cadena automática no lo pide nunca.

Ejemplo de un hueco de redacción (Anexo XIV, una fuente):

```json
{
  "id": "p-12345678",
  "clave": "a4-d1",
  "desde_parrafo": 5,
  "hasta_parrafo": 9,
  "sustituciones": [
    {
      "parrafo": 8,
      "original": "medidas equivalentes ……………………",
      "nuevo": "medidas equivalentes según la política de seguridad de la información vigente",
      "dato": "Redacción",
      "fuentes": [{ "ruta": "Conocimiento/Empresa/Seguridad/Politica de seguridad.pdf", "pagina": 2 }]
    }
  ]
}
```

### Si el modelo es un PDF con formulario

Solo llega al pulsar «Rellenar con Hermes» (el relleno automático es solo de los `.docx`). La
tarea no trae párrafos numerados: lista los **campos del formulario** (nombre exacto, tipo,
opciones y página; marca los de firma y los de solo lectura) y el **texto de cada página**
para saber qué pide cada campo. Si el PDF no tiene campos o está dañado, la plataforma no
lanza la tarea y la checklist dice «El modelo es un PDF sin campos: rellénalo a mano.».

1. `licitaciones_anexo` con `id`, `clave` y `campos`: `[{ nombre, valor, dato }]`, sin
   `desde_parrafo`, `hasta_parrafo` ni `sustituciones` (la plataforma lo rechaza). `nombre` =
   el nombre exacto del campo; `valor` = texto en un campo de texto, `true` o `false` en una
   casilla, una de las opciones tal cual en un grupo de opciones o un desplegable; `dato` = la
   etiqueta de la hoja de la que sale.
2. Los campos de **firma** y los de **solo lectura**, **nunca**, ni el campo del nombre de
   quien firma («Fdo.», «Firma», «Nombre_firmante»…): la plataforma rechaza cualquier texto en
   ellos y no se rellenan. Lugar y fecha, de la hoja. El importe, solo si la hoja lo trae y el
   precio está decidido: mientras no lo esté, un importe en cualquier campo se rechaza.
3. La plataforma rellena el formulario sin aplanarlo y lo guarda en
   `anexos/<nombre>-vN.pdf` de la carpeta de la oferta como borrador: una persona
   lo corrige y lo firma.

```json
{
  "id": "p-12345678",
  "clave": "a3-d1",
  "campos": [
    { "nombre": "NIF", "valor": "B12345678", "dato": "NIF" },
    { "nombre": "Importe oferta", "valor": "40.000,00", "dato": "Importe sin impuestos" },
    { "nombre": "ISO 14001", "valor": true, "dato": "Certificado ISO 14001" }
  ]
}
```
