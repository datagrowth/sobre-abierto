# Google Drive

Cómo conectar Google Drive y qué cambia si no lo usas: las credenciales de Google, la conexión, la sincronización y la
copia diaria. Los comandos usan los atajos `$DC`, `$MON` y `$HB` de [La instalación en
producción](produccion.md#atajos-de-los-comandos).

## Sin Google Drive

Drive es opcional. Sin él, `/opt/data/conocimiento` (la Biblioteca), `/opt/data/salidas` y las carpetas de cada
licitación son directorios del volumen `hermes_data`, en el disco del servidor: el monitor los lee y los indexa igual,
y Hermes los usa con las mismas rutas. El radar, las fichas, la oferta y la memoria funcionan igual; lo que se pierde
es la sincronización con Drive (compartir esas carpetas con quien no entra en la web, abrir un documento en Drive) y la
copia diaria a Drive: haz tú la del volumen (ver [Copias de seguridad y restauración](copias-y-restauracion.md)). Para añadir documentos sin
Drive, súbelos en la Biblioteca, en la ficha de la licitación (pliegos) o copia los archivos al volumen. Para
activar Drive más tarde, `docker compose --profile drive up -d` y conéctalo en Ajustes › Drive.

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

## Credenciales de Google

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

## Conectar

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

## Copia de seguridad

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
