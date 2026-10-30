# Biblioteca y documentos

Qué necesita el servidor para que la Biblioteca lea e indexe los documentos, y cómo comprobarlo: el índice,
LibreOffice para los Word antiguos y el OCR de los pliegos escaneados. Los comandos usan los atajos `$DC`, `$MON` y
`$HB` de [La instalación en producción](produccion.md#atajos-de-los-comandos).

Es la carpeta **Conocimiento** de Drive, que drive-sync mantiene en `/opt/data/conocimiento`
(`HERMES_VAULT_PATH`). El monitor extrae el texto de cada documento nuevo o cambiado y lo indexa
por palabras y por significado con un modelo pequeño que corre en él; el modelo (unos 120 MB) se
descarga la primera vez, así que el monitor necesita salida a internet. El texto tarda segundos
por documento; los vectores, del orden de una hora por cada 500 pliegos grandes, en segundo
plano. Si una versión cambia cómo se trocean los documentos, al arrancar se rehace el índice:
las palabras vuelven en minutos y el significado tarda horas.

Hermes la usa con la skill `biblioteca` y solo **propone** notas: quedan en
`Conocimiento/_Propuestas` hasta que una persona las aprueba. Nunca escribe en ella por su cuenta.

## Documentos: LibreOffice

La imagen del monitor lleva LibreOffice Writer sin interfaz y las fuentes Liberation, Carlito y
Caladea. Lo usa para convertir a `.docx` los `.doc` y `.rtf` (muchos anexos de la PLACSP) y para
pasar a PDF las memorias y numerar su índice. Sin él todo funciona, pero los `.doc` salen como
pliegos que no se pueden leer y las memorias llevan el índice sin páginas.

```bash
$DC exec $MON /usr/lib/libreoffice/program/soffice.bin --headless --version
$DC exec $MON sh -c 'fc-list | grep -ci liberation'    # más de 0
$DC logs $MON | grep 'conversor de documentos'          # estado ok | ausente | apagado
```

La herramienta MCP `plataforma_estado` da lo mismo en `biblioteca.conversor`, con conversiones
hechas, fallidas y en cola.

- `LIBREOFFICE_ACTIVO=0` lo apaga sin cambiar la imagen (salida de emergencia si falta memoria).
  La caché de convertidos (`CONVERSIONES_DIR`) se poda sola (60 días o 2 GB).
- Un solo soffice a la vez, con un cerrojo en `/tmp/lo/lock`; 120 s por conversión. Un cerrojo
  de más de 4 minutos se quita solo.
- `sin_salida` repetido en el log: perfil de LibreOffice corrupto;
  `$DC exec $MON rm -rf /tmp/lo` y reintenta.
- El monitor se reinicia mientras convierte: falta memoria (3 GB en el Compose). Compruébalo con
  `docker inspect -f '{{.State.OOMKilled}}' $($DC ps -q $MON)`; sube el límite o apágalo.
- `conversion_timeout`: un `.doc` enorme o soffice colgado; el siguiente intento empieza de cero.

Cuando el conversor pasa de `ausente` a `ok`, el indexador relee solo los `.doc` que fallaron.

## OCR de los pliegos escaneados

La imagen trae `tesseract-ocr` con español y `poppler-utils`. Al indexar, un PDF sin texto o con
el texto codificado (sale como símbolos) se lee con OCR a 200 ppp, página a página, hasta 150
páginas. Si sale texto legible, entra en el índice y su ficha ya puede pedirse; si no, sigue
marcado como escaneado. Un pliego de 100 páginas tarda unos minutos, sin frenar la web.
Comprueba que `$DC exec $MON tesseract --list-langs` incluye `spa`.

`OCR_ACTIVO=0` lo apaga si se come la CPU. El OCR puede leer mal alguna palabra: una cita de la
ficha que no aparece literal en el pliego sale «no localizada».
