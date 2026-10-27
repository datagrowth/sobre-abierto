# Guía de operación

Para quien tiene la plataforma instalada en su servidor y la mantiene. Cómo se instala está en
[instalacion.md](instalacion.md); qué hace cada pantalla, en [especificacion.md](especificacion.md); cómo está
hecha, en [arquitectura.md](arquitectura.md). Las variables están en [configuracion.md](configuracion.md) y, con su
valor por defecto, en `.env.example`: aquí solo se nombran las
imprescindibles.
Los ejemplos usan `plataforma.example.com` como dominio de la web.

El Compose **autónomo** de la raíz (`docker-compose.yml`) es el que instala `install.sh`: descarga las imágenes
de GHCR, con red propia y puerto en `127.0.0.1`. Los paneles usan su plantilla de `deploy/` (en Dokploy,
`deploy/dokploy/docker-compose.yml`), con los mismos servicios. Los comandos se lanzan
desde la carpeta de la instalación con dos atajos:

```bash
DC="docker compose"                               # el Compose autónomo (en Dokploy: -f deploy/dokploy/docker-compose.yml)
HB=/opt/hermes/.venv/bin/hermes                   # la orden hermes en su contenedor (no está en el PATH)
```

El servicio del monitor se llama `monitor`, con el alias `hermes-monitor` en la red, que es el nombre que usan los
perfiles de Hermes. Donde esta guía dice `hermes-monitor` en una orden de `$DC`, el servicio es `monitor`.

## Arquitectura en producción

Una sola aplicación Docker Compose (`docker-compose.yml`), con `docker compose` a mano, con `install.sh` o
desde un panel (Dokploy, Coolify, Easypanel; ver [deploy/](../deploy/README.md)).

```
navegador y agentes MCP ─HTTPS─► proxy ─► hermes-monitor:3110 ─red interna─► hermes:9119 (dashboard), :8642 (API de runs)
Google Drive ◄─ rclone ─► drive-sync ─► /opt/data/conocimiento, agent-studio, salidas (volumen hermes_data)
```

| Servicio | Qué hace |
|---|---|
| `hermes-init` | Corre y termina antes de cada arranque (queda «exited (0)»). Instala las skills de la plataforma en Hermes y en cada perfil, crea un token por agente en `/opt/data/.agentes/` y devuelve el volumen al uid 10000 |
| `hermes` | Hermes Agent, imagen oficial (`HERMES_IMAGE_TAG`). Toda la IA corre aquí |
| `hermes-monitor` | La plataforma: web, API, MCP (`/mcp`), cola de IA, radar y Biblioteca. Imagen propia con LibreOffice y OCR. No tiene claves de modelos: pide los trabajos a Hermes |
| `drive-sync` | rclone: sincroniza las carpetas de Drive en ambos sentidos y sube la copia diaria. Opcional: en el Compose autónomo solo arranca con `--profile drive` |

| Volumen | Qué guarda | ¿Copiar? |
|---|---|---|
| `hermes_data` (`/opt/data`) | Sesiones de Hermes (`state.db`), perfiles, memoria, skills, sus `.env` con las claves de los modelos, tokens de agentes y las carpetas de Drive | Sí |
| `plataforma_data` (`/datos`) | `nucleo.db` (usuarios, cola de IA, equipo, perfil de empresa) y `licitaciones.db` (radar, histórico, ofertas, memorias) | Sí |
| `drive_sync_state` | Conexión con Drive y estado de rclone | Opcional: se reconecta |
| `vault_data` (`/vault`) | Índice de la Biblioteca, modelo de embeddings, caché de conversiones | No: se regenera |

Límites del Compose: Hermes 4 GB, monitor 3 GB, drive-sync 512 MB; cuenta con unos 8 GB de RAM
y con disco para el histórico y los pliegos. Los logs de Docker rotan (3 × 50 MB). Monitor,
Hermes y drive-sync comparten el uid `10000:10000` (`MONITOR_USER`): no lo cambies. Las seis
variables obligatorias (sin ellas Compose no arranca) son las que van sin comentar en
`.env.example`; genera sus claves con `openssl rand -hex 32` y no las cambies sin motivo.
`MONITOR_BASIC_AUTH_*` debe ser distinto del login del dashboard de Hermes: Hermes lee su propio
entorno y no recibe el del monitor.

## Dominios

Publica solo `hermes-monitor`, puerto `3110`, con HTTPS (`https://plataforma.example.com`). Por
ahí van la web, el MCP (`/mcp`), la API de lectura (`/api/v1`), el calendario (`/cal/…`) y la
vuelta del OAuth de Google (`/api/drive/callback`).

**No publiques Hermes.** Su dashboard (`9119`) se abre desde la **Consola** de la web, que inicia
sesión por ti y solo deja entrar a un `admin`: es una terminal con las claves de Hermes. Su API
de runs (`8642`) la usa el monitor por la red interna: quien llegue a ella lanza trabajos con tu
modelo. El Compose ya lo deja así: ningún servicio usa `ports` y Hermes solo está en la red
`default`. El monitor está además en la red externa del proxy, que en el Compose se llama
`dokploy-network` (la de Traefik en Dokploy). Con otro proxy en Docker, cambia esa red por la
suya o créala (`docker network create dokploy-network`); con un proxy en el host, añade al
monitor `ports: ["127.0.0.1:3110:3110"]`.

El proxy debe dejar pasar WebSockets (web en vivo y Consola) y cuerpos de 100 MB (subidas a la
Biblioteca), y cerrar las conexiones inactivas antes de 95 s, o habrá `502` sueltos en el MCP.
`MONITOR_PROXIES_DE_CONFIANZA` es el número de proxies que añaden `X-Forwarded-For` (1): de ahí
sale la IP del freno del login. Si el proxy reescribe el `Host`, añade el origen público a
`FRONTEND_URL`: la web rechaza cambios y WebSockets de otro `Origin`.

## Marca y empresa de la instalación

Nada de una empresa concreta va en el código ni en el entorno. Un `admin` lo pone en la web:

- **Ajustes › Marca**: el nombre de la app (pestaña, acceso, emails y calendario), los colores
  (no se guarda un color que deje un texto sin contraste AA) y el logo (SVG, PNG o WebP de hasta
  200 KB). Va en `nucleo.db`, así que sale en la copia de las bases y se cambia sin redesplegar.
- **Ajustes › Empresa**: el nombre comercial (el de las tareas de Hermes y la memoria) y la zona
  horaria (península o Canarias: la de los avisos y la segunda hora de los plazos).
- **Ajustes › Fuentes y filtros › Escala de los rankings**: el territorio y la banda de importe
  con que se abren Competidores y Organismos.

Del entorno solo salen `APP_URL` (la dirección pública) y `APP_SOURCE_URL` (el enlace «Código
fuente», que pide la AGPL si has cambiado el código; vacío, el repositorio público). Comprueba
lo que recibe la web con `curl -s https://plataforma.example.com/api/config`.

## Usuarios y recuperación de acceso

Entra con `MONITOR_BASIC_AUTH_USERNAME` en el campo Email y `MONITOR_BASIC_AUTH_PASSWORD`: eres
el primer `admin` y la web te pide una contraseña tuya (12 caracteres o más). En **Ajustes ›
Usuarios y permisos**, edita tu fila con tu email y tu nombre, que firma lo que guardas. Da de
alta a cada persona con la contraseña temporal que propone la web y pásasela por un canal
distinto del email; la cambia al entrar. Roles: `admin` (todo, también precio, Empresa,
usuarios, Drive y Consola), `editor` (preparar ofertas, salvo el precio) y `lector` (ver).
Siempre queda al menos un `admin` activo.

**Contraseña del `.env`.** `MONITOR_BASIC_AUTH_*` solo sirve para el primer acceso. En cuanto algún
admin activo tiene contraseña propia (la que eligió él, no una temporal), la del `.env` deja de
entrar, también en las sesiones que hubiera abiertas con ella. Solo mientras ningún admin tenga la
suya (p. ej. si renombraste al primero antes de cambiarla) entra como «Acceso de emergencia», con
aviso en el log. Guardar el `.env` ya no es guardar una llave maestra.

**Recuperar el acceso.** Si nadie recuerda la contraseña de un admin, ejecuta dentro del contenedor
del monitor (hace falta acceso al servidor, no a la web):

```bash
$DC exec $MON node apps/server/dist/recuperarAcceso.js admin@example.com
```

Escribe una contraseña temporal por la terminal (no por el log). La web la pide cambiar al entrar y
las sesiones que ese admin tuviera se cierran. Solo vale para un admin activo; con cualquier otro
email falla sin tocar nada. Para un editor o un lector, entra con un admin y restablece su
contraseña en Ajustes › Usuarios. Si el `.env` se ha filtrado, cambia `MONITOR_BASIC_AUTH_PASSWORD`
y recrea el monitor (`$DC up -d $MON`): se cierran todas las sesiones.

```bash
$DC logs $MON | grep 'acceso de emergencia' | tail -5   # intentos con el login del .env
```

**Sesiones.** Se cierran tras 12 h sin uso o 7 días desde el login. Un despliegue no las cierra
mientras `MONITOR_SESSION_SECRET` no cambie: no lo regeneres. La línea del log con
`huella_secreto` debe repetir valor de un arranque a otro. El login se frena tras 10 fallos
desde una IP o 30 por minuto entre todas.

## Correo (SMTP)

Los avisos por email (plazos, resoluciones, búsquedas guardadas, resumen semanal) salen por tu
SMTP. **Sin `SMTP_HOST` y `SMTP_REMITENTE` no sale ningún correo**; la plataforma funciona igual
y los avisos quedan apuntados como no enviados.

```env
SMTP_HOST=smtp.example.com
SMTP_PUERTO=587                 # 587 con STARTTLS (SMTP_TLS=0) o 465 con TLS (SMTP_TLS=1)
SMTP_TLS=0
SMTP_USUARIO=avisos@example.com
SMTP_CONTRASENA=...             # o una contraseña de aplicación si la cuenta tiene doble factor
SMTP_REMITENTE=Sobre Abierto <avisos@example.com>
APP_URL=https://plataforma.example.com   # enlaces de emails y calendario
```

Recrea el monitor. En **Ajustes › Avisos**, cada persona elige sus avisos y un `admin` configura
el resumen semanal con **Enviarme una prueba**. La contraseña no sale en la web ni en el log.

```bash
$DC logs $MON | grep -E 'aviso por email|email sin enviar' | tail -10
```

- `Invalid login` o `535`: usuario o contraseña mal (con doble factor, contraseña de aplicación).
- `wrong version number` o `self-signed certificate`: 465 va con `SMTP_TLS=1`, 587 con `0`.
- Emails sin botón: falta `APP_URL`. Alguien no recibe nada: su usuario no es un email de verdad
  o tiene el aviso apagado.

## Calendario de plazos (ICS)

Cada persona crea su enlace en **Ajustes › Integraciones › Calendario** y lo copia (solo se ve
esa vez; crear otro anula el anterior). En Google Calendar, **Otros calendarios › + › Desde
URL**. Necesita `APP_URL` para salir completo. Trae las ofertas en preparación. Los plazos de la
PLACSP van en hora peninsular con su zona (`TZID`): cada calendario los muestra en la suya.
Google refresca los calendarios suscritos cada pocas horas. Para probar un enlace:
`curl -s https://plataforma.example.com/cal/<token>.ics | head` empieza por `BEGIN:VCALENDAR`.

## API de lectura para BI

Un `admin` crea un token por integración en **Ajustes › Integraciones › API de lectura** (solo
se ve al crearlo). Solo lectura, por el dominio de la web y sin datos de personas, costes ni
documentos. `GET /api/v1` lista los recursos; cada respuesta trae `datos`, `total` y `siguiente`
(pásalo como `desde` hasta que sea `null`; `limite` hasta 5000). En Power BI: Obtener datos ›
**Web** › **Avanzada**, con el encabezado `Authorization: Bearer <token>`. El token va siempre en
la cabecera, nunca en la URL. `401 sin_token`: falta o se revocó; `405 solo_lectura`: intenta
escribir. Para probar: `curl -s -H "Authorization: Bearer $TOKEN" https://plataforma.example.com/api/v1`.

## Biblioteca de Conocimiento

Es la carpeta **Conocimiento** de Drive, que drive-sync mantiene en `/opt/data/conocimiento`
(`HERMES_VAULT_PATH`). El monitor extrae el texto de cada documento nuevo o cambiado y lo indexa
por palabras y por significado con un modelo pequeño que corre en él; el modelo (unos 120 MB) se
descarga la primera vez, así que el monitor necesita salida a internet. El texto tarda segundos
por documento; los vectores, del orden de una hora por cada 500 pliegos grandes, en segundo
plano. Si una versión cambia cómo se trocean los documentos, al arrancar se rehace el índice:
las palabras vuelven en minutos y el significado tarda horas.

Hermes la usa con la skill `biblioteca` y solo **propone** notas: quedan en
`Conocimiento/_Propuestas` hasta que una persona las aprueba. Nunca escribe en ella por su cuenta.

### Documentos: LibreOffice

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

### OCR de los pliegos escaneados

La imagen trae `tesseract-ocr` con español y `poppler-utils`. Al indexar, un PDF sin texto o con
el texto codificado (sale como símbolos) se lee con OCR a 200 ppp, página a página, hasta 150
páginas. Si sale texto legible, entra en el índice y su ficha ya puede pedirse; si no, sigue
marcado como escaneado. Un pliego de 100 páginas tarda unos minutos, sin frenar la web.
Comprueba que `$DC exec $MON tesseract --list-langs` incluye `spa`.

`OCR_ACTIVO=0` lo apaga si se come la CPU. El OCR puede leer mal alguna palabra: una cita de la
ficha que no aparece literal en el pliego sale «no localizada».

## Sin Google Drive

Drive es opcional. Sin él, `/opt/data/conocimiento` (la Biblioteca), `/opt/data/salidas` y las carpetas de cada
licitación son directorios del volumen `hermes_data`, en el disco del servidor: el monitor los lee y los indexa igual,
y Hermes los usa con las mismas rutas. El radar, las fichas, la oferta y la memoria funcionan igual; lo que se pierde
es la sincronización con Drive (compartir esas carpetas con quien no entra en la web, abrir un documento en Drive) y la
copia diaria a Drive: haz tú la del volumen (ver «Copias de seguridad y restauración»). Para añadir documentos sin
Drive, súbelos en la Biblioteca, en la ficha de la licitación (pliegos) o copia los archivos al volumen. Para
activar Drive más tarde, `docker compose --profile drive up -d` y conéctalo en Ajustes › Drive.

## Google Drive

Drive es la única fuente de verdad del conocimiento cuando se usa. drive-sync sincroniza en ambos sentidos,
dentro de la carpeta que eliges al conectar, `Conocimiento` (la Biblioteca, con los pliegos y las
ofertas; en el servidor, `/opt/data/conocimiento`), `Skills` (cada subcarpeta con un `SKILL.md` es
una skill de Hermes de la empresa; `/opt/data/skills/empresa`) y `Salidas` (lo que genera Hermes;
`/opt/data/salidas`). Son los nombres por defecto: `DRIVE_CARPETA_CONOCIMIENTO`,
`DRIVE_CARPETA_SKILLS` y `DRIVE_CARPETA_SALIDAS` los cambian, y `DRIVE_SYNC_EXTRA` añade carpetas
(ver `.env.example`). La skill `entorno` le explica a Hermes estas rutas.

Sincroniza cada minuto como mucho (`GDRIVE_SYNC_INTERVAL`) y en segundos si algo cambia en el
servidor. Los Google Docs, Hojas y Presentaciones solo bajan, convertidos a Office, a una carpeta
oculta `.gdocs`. Un archivo cambiado a la vez en los dos lados guarda las dos versiones
(`.conflict1`, `.conflict2`). El archivo `.hermes-sync` de cada carpeta evita que rclone se pare
con carpetas vacías. El resto de `/opt/data` no se sincroniza: solo va en la copia diaria.

### Credenciales de Google

Google exige un cliente OAuth propio por aplicación. Se hace una vez, gratis, con la cuenta cuyo
Drive vas a usar, en [Google Cloud Console](https://console.cloud.google.com/):

1. Crea un proyecto (<https://console.cloud.google.com/projectcreate>). Con Google Workspace,
   dentro de tu organización: si no, no podrás marcar la app como *Interna*.
2. Habilita la API de Drive (<https://console.cloud.google.com/apis/library/drive.googleapis.com>).
3. Configura la pantalla de consentimiento (<https://console.cloud.google.com/auth/overview>):
   público **Interno** si puedes. Una app **Externa** en modo «Prueba» exige añadirte como
   usuario de prueba y caduca el permiso a los 7 días; para evitarlo, rellena *Información de la
   marca* (sin logotipo, que obliga a verificar la app) y pulsa **Publicar app** en *Público*.
   Publicar exige que la web tenga dominio propio con HTTPS.
4. Crea un cliente OAuth de tipo *Aplicación web*
   (<https://console.cloud.google.com/auth/clients/create>) con la URI de redirección
   `https://plataforma.example.com/api/drive/callback`, sin barra final. **Ajustes › Drive**
   enseña la URI exacta mientras falten las credenciales.
5. Copia el ID y el secreto al crearlo: Google no vuelve a enseñar el secreto (si lo pierdes,
   **Añadir secreto** en el cliente).
6. Ponlos en `GDRIVE_CLIENT_ID` y `GDRIVE_CLIENT_SECRET` y aplica con `$DC up -d`.

### Conectar

**Ajustes › Drive › Conectar Google Drive**, acepta con tu cuenta y elige o crea la carpeta. La
primera sincronización une los dos lados sin borrar nada. El mismo panel enseña la última
sincronización y deja cambiar de carpeta o desconectar (sin borrar). Log:
`$DC logs --tail 50 drive-sync`.

| Síntoma | Causa probable |
|---|---|
| «Google no ha verificado esta aplicación» | app externa: es la tuya. **Configuración avanzada** → **Ir a …** |
| `redirect_uri_mismatch` | la URI del cliente no es la de Ajustes › Drive (https, dominio exacto, sin barra final) |
| `access_denied`, o deja de sincronizar a la semana | app externa en «Prueba»: publícala (o añádete como usuario de prueba) y reconecta |
| drive-sync dice `Faltan GDRIVE_CLIENT_ID…` | falta alguna de las dos variables |
| «… es un enlace simbólico: no se sincroniza» | algo cambió esa carpeta por un enlace; quítalo (`$DC exec hermes rm <ruta>`, sin barra final) |

### Copia de seguridad

Con `GDRIVE_BACKUP=1`, drive-sync sube cada día, a partir de `GDRIVE_BACKUP_HOUR` (hora de `TZ`),
una carpeta `Copias de seguridad/<fecha>/` con `state.db.gz` (sesiones de Hermes),
`hermes-data.tar.gz` (el resto de `/opt/data`) y, con la frecuencia de
`GDRIVE_BACKUP_PLATAFORMA` (`diaria`, `semanal` o `no`; por defecto `semanal`),
`plataforma/nucleo.db.gz` y `plataforma/licitaciones.db.gz`. Las bases SQLite se copian con su
API de backup, nunca a medias. Borra en Drive las copias de más de `GDRIVE_BACKUP_KEEP_DAYS` días
(30).

Las copias van **en claro** y llevan CV, ofertas y el `.env` de cada perfil (con sus tokens): trátalas como
datos sensibles. Usa para Drive una cuenta o una unidad compartida dedicada a esto (el acceso de rclone es
`scope = drive`, toda la cuenta) y, si puedes, cifra antes de subir (`rclone crypt` o `age`/`gpg` sobre el archivo).
Los tokens de la conexión con Drive van a `DRIVE_STATE_DIR` (en el Compose, el volumen `drive_sync_state`): fuera de
Compose, define esa variable con un directorio persistente y privado, o irán a un directorio temporal.

La copia **no lleva secretos** (ni los `.env` de Hermes y sus perfiles ni los tokens), ni logs, ni
lo que ya está en Drive. Guarda fuera del servidor el `.env` del Compose y los `.env` de Hermes
(claves de los modelos y la `API_SERVER_KEY` de cada perfil).

`GDRIVE_BACKUP=0` la apaga, por ejemplo si ya copias los volúmenes o Drive va justo (una cuenta
gratuita tiene 15 GB); no borra las copias que ya hay. **Ajustes › Drive** dice si está activa y
cuándo fue la última, y avisa si pasan más de 26 horas: mira el log de drive-sync (lo habitual es
que Drive esté lleno).

### Carpeta de cada licitación

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

#### Instalaciones con la organización anterior

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
([actualizar.md](actualizar.md)).

## Hermes y los agentes (MCP)

### Perfiles de Hermes

La plataforma encola los trabajos y los lanza en perfiles de Hermes por su API de runs. El modelo
de cada perfil se elige en Hermes (**Consola** → perfil → Model, o su `config.yaml`); todos
comparten el cupo del proveedor.

| Perfil | Hace | Variables |
|---|---|---|
| `licitaciones` | Criba, fichas, actas, CV y notas | `HERMES_LICITACIONES_URL` y `_KEY`. Sin ellas el radar descarga y filtra, y la IA espera |
| `oferta-licitaciones` | Guion, memoria, anexos y evaluación, con un modelo mejor | `HERMES_OFERTA_LICITACIONES_URL` y `_KEY`. Opcional: si no, lo hace `licitaciones` |
| `critico-licitaciones` | Crítico ciego de la memoria técnica, con otro modelo | `HERMES_OFERTA_CRITICO_URL` y `_KEY`. Opcional: si no, critica el de oferta y la web avisa |

**`install.sh` crea los tres perfiles** con su clave, el proveedor de IA y la conexión al MCP, sin pasos
manuales (`infra/perfiles.sh`, que corre dentro del contenedor de Hermes). Para repetirlo, o en un panel, sin
`install.sh`:

```bash
set -a; . ./.env; set +a     # las HERMES_*_KEY del .env
$DC exec -T -u hermes \
  -e HERMES_LICITACIONES_KEY -e HERMES_OFERTA_LICITACIONES_KEY -e HERMES_OFERTA_CRITICO_KEY \
  -e LLM_PROVEEDOR=anthropic -e LLM_API_KEY=… -e MODELO_LICITACIONES=claude-sonnet-5-5 \
  hermes sh -s < infra/perfiles.sh
$DC run --rm hermes-init          # token del perfil nuevo y permisos
$DC restart hermes                # ver «Reiniciar Hermes»
$DC exec hermes $HB -p licitaciones mcp test plataforma
```

Es idempotente: crea el perfil si no existe (con `hermes profile create --clone`), pone su `API_SERVER_KEY` si falta,
configura el proveedor y el modelo **solo mientras el perfil siga con el de fábrica** (`provider: auto`), y conecta el
MCP si no lo está. Lo que ya hubiera, incluido un modelo elegido luego en la Consola, no se pisa. `LLM_PROVEEDOR` es
`anthropic`, `openai` (`openai-api` en Hermes), `openrouter`, `local` (con `LLM_URL`) o `ninguno`. Sin clave en
una variable `HERMES_*_KEY`, ese perfil se salta. Lo prueba `infra/perfiles.test.sh` con la imagen real de Hermes.

Para hacerlo a mano (un perfil, aquí `licitaciones`; los otros, igual):

```bash
P=/opt/data/profiles/licitaciones
$DC exec hermes $HB profile create licitaciones --clone --no-alias --description "Criba y analiza licitaciones"
$DC exec hermes sed -i -E '/^(API_SERVER_KEY|PLATAFORMA_TOKEN)=/d' $P/.env   # fuera lo heredado
KEY=$(openssl rand -hex 32); echo "$KEY"                                        # HERMES_LICITACIONES_KEY
$DC exec hermes sh -c "printf 'API_SERVER_KEY=%s\n' '$KEY' >> $P/.env"
$DC exec hermes $HB config set multiplex_profiles true                          # los perfiles en /p/<perfil>
$DC exec hermes $HB -p licitaciones config set model.provider anthropic
$DC exec hermes $HB -p licitaciones config set model.default claude-sonnet-5-5
$DC exec hermes $HB -p licitaciones config set mcp_servers.plataforma.url http://hermes-monitor:3110/mcp
$DC exec hermes $HB -p licitaciones config set mcp_servers.plataforma.headers.Authorization 'Bearer ${PLATAFORMA_TOKEN}'
$DC exec hermes $HB -p licitaciones config set mcp_servers.plataforma.tools.include '[licitaciones_*, biblioteca_*, salidas_leer, colaboradores_*, competidores_*, organismos_*, plataforma_estado, plataforma_empresa]'
```

La clave del proveedor (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` u `OPENROUTER_API_KEY`) va en el `.env` del perfil.
La URL `http://hermes:8642/p/licitaciones` funciona porque el gateway principal sirve los perfiles
(`multiplex_profiles: true`). Deja `${PLATAFORMA_TOKEN}` tal cual: Hermes lo toma del `.env` del perfil, donde
`hermes-init` lo escribe. Pon la URL y la clave del perfil en las variables `HERMES_*_URL` y `HERMES_*_KEY`, y
aplica:

```bash
$DC run --rm hermes-init          # token del perfil nuevo y skills
$DC up -d $MON                    # variables nuevas
$DC restart hermes                # ver «Reiniciar Hermes»
$DC exec hermes $HB -p licitaciones mcp test plataforma
```

La criba compara cada licitación con el perfil de la empresa (**Ajustes › Empresa**) y con
`Conocimiento/Empresa/perfil-licitaciones.md`: rellénalos antes de juzgar los resultados.

### Tokens de agente

- **Perfiles de Hermes:** `hermes-init` crea `/opt/data/.agentes/<perfil>.token` (y
  `hermes.token`, el del perfil principal) y lo añade como `PLATAFORMA_TOKEN` a su `.env` si no lo
  tiene. Están en el volumen de Hermes: identifican y limitan, pero Hermes podría leerlos.
- **Claude Code:** `AGENTE_TOKEN_CLAUDE_CODE` (32 caracteres o más).
- **Otro agente:** crea su archivo; el monitor relee los tokens cada 10 s.

  ```bash
  $DC exec -u 10000:10000 hermes sh -c 'umask 077; f=/opt/data/.agentes/mi-agente.token; head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n" > $f; cat $f'
  ```

Por defecto, cualquier agente lee todo y propone notas; `hermes` propone en todos los dominios;
`licitaciones` y `oferta-licitaciones` proponen en licitaciones, Biblioteca, equipo y empresa;
`critico-licitaciones` solo ve licitaciones. Ningún agente aprueba: eso lo hacen el código y las
personas. Para cambiarlo, crea `/opt/data/.agentes/permisos.json` (dominios `biblioteca`,
`licitaciones`, `plataforma`, `colaboradores`; valores `leer`, `proponer`, `ninguno`). Mal escrito
se ignora entero (log: `permisos.json ignorado`); un dominio que no existe se ignora solo y el resto
vale (log: `permisos.json: dominios que no existen, ignorados`). Se aplica en un minuto; un perfil de Hermes ve
sus herramientas nuevas al reiniciar Hermes.

```json
{ "claude-code": { "licitaciones": "proponer" }, "mi-agente": { "colaboradores": "ninguno" } }
```

Cada llamada queda en la auditoría (agente, herramienta, recurso y resultado; nunca el
contenido), que lee `plataforma_actividad`. **Rotar un token:** borra su `.token` y la línea
`PLATAFORMA_TOKEN` de su `.env`, ejecuta `$DC run --rm hermes-init` y reinicia Hermes. Para
Claude Code, cambia la variable y recrea el monitor.

### Conectar Claude Code u otro agente

El MCP es Streamable HTTP en `/mcp`, con el token en la cabecera. Sirve cualquier cliente MCP que
admita cabeceras; `AGENTES_PETICIONES_MINUTO` (120) frena a un agente en bucle.

```bash
claude mcp add --transport http plataforma https://plataforma.example.com/mcp \
  --header "Authorization: Bearer <token>"
```

### Cola de IA

Cada tarea de IA es un trabajo en la cola (`nucleo.db`). Se ve en la pastilla **Hermes** de la
barra lateral y en **Ajustes › Hermes**; un agente la lee con `plataforma_trabajos`.

- **Topes:** `HERMES_RUNS_A_LA_VEZ` (1-8; más es más rápido pero agota antes el cupo y la memoria
  de Hermes), `LICITACIONES_RUNS_OFERTA_DIA` (runs automáticos por oferta en 24 h, contra bucles;
  lo pedido a mano sale igual), `LICITACIONES_PROPUESTAS_DIA` y `LICITACIONES_ACTAS_MERCADO_DIA`.
- **Apagar lo automático:** `LICITACIONES_ACTIVO=0` (ingesta), `LICITACIONES_CRIBAS_DIA=0`
  (criba), `LICITACIONES_FICHA_AUTO=0` (fichas). No hay un botón que pare toda la cola.
- **Plazos:** no se pide a Hermes un trabajo que acabaría dentro de las
  `LICITACIONES_MARGEN_FIRMA_HORAS` (2) previas al plazo, reservadas para firmar y presentar.

| `motivo_espera` | Qué hacer |
|---|---|
| `pausa_limite` | el proveedor dio límite de uso (429); la cola sigue sola a la hora de `pausa_hasta` |
| `freno` | su tipo falló tres veces seguidas: arregla la causa y relanza a mano (una versión nueva del monitor también lo levanta; un reinicio, no) |
| `espera_herramienta` | Hermes tiene las herramientas de antes del despliegue: «Reiniciar Hermes» |
| `reintento` | espera su próximo intento (2, 4 y 8 minutos) |
| `tope_oferta` | la oferta agotó sus runs de 24 h: mira qué se repite o sube el tope |
| `sin_perfil` | falta el perfil de Hermes de ese tipo (`HERMES_*_URL` y `_KEY`) |
| `cola`, `plazo_cercano` | espera su turno; las ofertas en sus últimas horas van primero |

Pausas y frenos sobreviven a los reinicios. Un trabajo que pasa 10 minutos sin llamar a ninguna
herramienta se corta y se reintenta; **¿Colgado? Parar y relanzar** lo hace sin esperar.

### Memoria técnica

La memoria técnica se redacta por fases: dossier → estrategia → ficha de solución → redacción entera →
crítico ciego → corrección de hechos → rondas. Variables principales: `LICITACIONES_MEMORIA_UMBRAL`
(0.9) y `LICITACIONES_MEMORIA_RONDAS` (3, de 0 a 3): la memoria se ensambla cuando el crítico da esa
parte de los puntos o se acaban las rondas. El crítico (`HERMES_OFERTA_CRITICO_URL` y `_KEY`) debe usar
otro modelo que el que redacta. `LICITACIONES_PRECIO_HORA`, opcional, enseña a la persona los
euros de cada compromiso; nunca llega a los agentes. El diseño está en `docs/memoria-tecnica.md`.

## Reiniciar Hermes

Hermes carga sus skills y la lista de herramientas del MCP solo al arrancar. Reinícialo tras
actualizar a una versión que cambie herramientas o skills, tras crear un perfil o cambiar su
modelo, `config.yaml` o `.env`, y tras cambiar sus permisos. Si no, los trabajos de los perfiles
afectados esperan con «Hermes tiene la lista de herramientas de antes del despliegue»
(`herramientas_desfasadas`), sin gastar intentos ni cupo. Cambiar solo variables del monitor no
lo pide: basta `$DC up -d $MON`.

1. **Con la cola quieta.** Cada reinicio mata los runs en curso de todos los perfiles: comprueba
   en la pastilla **Hermes** o en **Ajustes › Hermes** que no haya nada en marcha, y no lo hagas
   cerca de un plazo de presentación.
2. Reinicia: `$DC restart hermes` y mira `$DC logs --tail 50 hermes`.
3. Lo que esperaba sale solo en la siguiente vuelta de la cola (30 s).

No lo sustituyas por `hermes -p <perfil> mcp test`: pide la lista con el mismo token y la cola la
da por cargada aunque el gateway siga con la vieja. Un run cortado por el reinicio se reintenta a
los 10 minutos.

## Actualizar a una versión nueva

Ver [actualizar.md](actualizar.md): pasos, qué pasa con las bases de datos y cómo volver atrás.

## Copias de seguridad y restauración

Imprescindible: `nucleo.db` y `licitaciones.db` (volumen `plataforma_data`), los datos de Hermes
(volumen `hermes_data`) y las variables del Compose, guardadas fuera del servidor. El histórico
de adjudicaciones se puede recargar desde la PLACSP; las ofertas, decisiones, memorias y el
equipo, no. Conocimiento, Salidas y Agent Studio ya están en Drive; `drive_sync_state` y
`vault_data` son prescindibles (ver la tabla de volúmenes en «Arquitectura en producción»).

Hay dos formas, compatibles: la copia a Drive de drive-sync (ver «Copia de seguridad» en «Google
Drive»), consistente pero sin secretos, y la copia de los volúmenes en tu servidor. Una
instantánea del disco es consistente; copiar archivos en caliente puede pillar una base SQLite a
medias. Copia las bases en caliente con `sqlite3` (viene en la imagen de drive-sync), o todo con
la plataforma parada. La copia en caliente usa el contenedor `drive-sync`: sin Drive (sin ese servicio) haz
la copia en frío. Compose antepone el nombre del proyecto a los volúmenes
(`docker volume ls | grep _hermes_data`).

```bash
F=$(date +%F)
for db in nucleo licitaciones; do              # en caliente, solo las bases
  $DC exec drive-sync sqlite3 /datos/$db.db ".backup '/tmp/$db-$F.db'"
  $DC cp drive-sync:/tmp/$db-$F.db ./ && $DC exec drive-sync rm /tmp/$db-$F.db
done

P=<proyecto>; $DC stop                          # en frío, todo (con la cola quieta)
for v in hermes_data plataforma_data drive_sync_state; do
  docker run --rm -v "${P}_$v:/v:ro" -v "$PWD:/copia" alpine tar czf "/copia/$v-$F.tgz" -C /v .
done
$DC up -d
```

**Restaurar los volúmenes:** con `$DC stop`, vacía cada volumen y vuelca su `.tgz`; al arrancar,
`hermes-init` corrige dueños y permisos.

```bash
docker run --rm -v "${P}_hermes_data:/v" -v "$PWD:/copia" alpine \
  sh -c 'rm -rf /v/* /v/.[!.]* && tar xzf /copia/hermes_data-<fecha>.tgz -C /v'
```

**Restaurar desde Drive:** descarga `Copias de seguridad/<fecha>/` (las bases están en la última
que tenga `plataforma/`), descomprime los `.gz` y, con la plataforma parada, quita los `-wal` y
`-shm` antiguos antes de copiar cada base:

```bash
$DC stop hermes $MON drive-sync
docker run --rm -v "${P}_plataforma_data:/datos" -v "$PWD:/copia" alpine sh -c \
  'rm -f /datos/*.db-wal /datos/*.db-shm && cp /copia/nucleo.db /copia/licitaciones.db /datos/ && chown 10000:10000 /datos/*.db'
docker run --rm -v "${P}_hermes_data:/v" -v "$PWD:/copia" alpine sh -c \
  'tar xzf /copia/hermes-data.tar.gz -C /v && rm -f /v/state.db-wal /v/state.db-shm && cp /copia/state.db /v/'
$DC up -d
```

En un servidor nuevo, antes del `up`, crea otra vez los `.env` de Hermes (`/opt/data/.env`) y de
cada perfil (`/opt/data/profiles/<perfil>/.env`) con las claves de los modelos y la
`API_SERVER_KEY` de cada perfil, la misma que su `HERMES_*_KEY`; `hermes-init` crea tokens nuevos.
Si se perdió `drive_sync_state`, conecta Drive en **Ajustes › Drive** con la misma carpeta:
Conocimiento, Salidas y Agent Studio vuelven sin borrar nada y la Biblioteca se reindexa sola.

Al cambiar de servidor, para el antiguo antes de arrancar el nuevo: dos Hermes con las mismas
cuentas de mensajería responderían dos veces. Después, entra en la web y comprueba que están los
usuarios y las ofertas.
