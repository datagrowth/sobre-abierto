# Variables de entorno

Las variables del `.env` que hay que poner y las que más se cambian. Las de cada tema (correo, Drive, perfiles de
Hermes, cola de IA) se explican también en su página de la sección [Operar](../operar/README.md).

`install.sh` genera el `.env` con las claves necesarias. Las demás variables están comentadas en
[`.env.example`](../../.env.example) con su valor por defecto; un test comprueba que ese archivo y el Compose nombran las
mismas variables. Descomenta solo lo que necesites cambiar y aplica con `docker compose up -d`.

## Obligatorias

| Variable | Para qué |
|---|---|
| `API_SERVER_KEY` | Clave de la API de Hermes (`openssl rand -hex 32`). |
| `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` y `_PASSWORD` | Acceso al dashboard de Hermes; la contraseña, distinta de la del monitor. |
| `MONITOR_BASIC_AUTH_USERNAME` y `_PASSWORD` | Primer administrador: su correo y una contraseña inicial de 20 caracteres o más. En cuanto un administrador elige la suya en la web, esta deja de entrar; para recuperar el acceso, el comando de [Usuarios y recuperación de acceso](../operar/usuarios-y-acceso.md). |
| `MONITOR_SESSION_SECRET` | Firma las sesiones; 32 caracteres o más. Cambiarlo cierra todas las sesiones. |
| `HERMES_LICITACIONES_KEY`, `HERMES_OFERTA_LICITACIONES_KEY`, `HERMES_OFERTA_CRITICO_KEY` | Clave de cada perfil de Hermes. Vacías, la IA queda en espera y el radar sigue funcionando. |

## Las más habituales

| Variable | Por defecto | Para qué |
|---|---|---|
| `SOBRE_ABIERTO_VERSION` | `latest` | Versión de las imágenes. Fíjala (`0.1.0`) en producción. |
| `DOMINIO` | — | Dominio con HTTPS automático por Caddy. |
| `APP_URL` | — | Dirección pública; sin ella, los correos y el calendario no llevan enlaces. |
| `MONITOR_BIND`, `MONITOR_PUERTO` | `127.0.0.1`, `3110` | Dónde escucha el monitor. No abras `0.0.0.0` en Internet sin HTTPS. |
| `HERMES_RUNS_A_LA_VEZ` | `3` en la plantilla (`2` si no se pone) | Trabajos de IA simultáneos (1–8). Más es más rápido, pero agota antes el cupo de tu proveedor. |
| `LICITACIONES_SYNC_MINUTES` | `15` | Cada cuánto se consulta la PLACSP. |
| `LICITACIONES_CRIBAS_DIA` | `2` | Cribas automáticas al día; `0` las desactiva (se pueden lanzar a mano). |
| `LICITACIONES_FICHA_AUTO` | `1` | Prepara la ficha de lo que encaja sin esperar a que alguien la pida. |
| `LICITACIONES_HISTORICO_DESDE` | `2018` | Desde qué año se carga el histórico de adjudicaciones. |
| `SMTP_HOST`, `SMTP_PUERTO`, `SMTP_USUARIO`, `SMTP_CONTRASENA`, `SMTP_REMITENTE` | — | Correo de salida. Sin `SMTP_HOST` y `SMTP_REMITENTE` no sale ningún aviso. |
| `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET` | — | Cliente OAuth propio de Google (ver [Google Drive](../operar/drive.md)). |
| `GDRIVE_BACKUP` | `0` | `1` sube una copia diaria a Drive. |
| `TZ` | `Europe/Madrid` | Zona horaria de los contenedores. |
| `LIBREOFFICE_ACTIVO`, `OCR_ACTIVO` | `1` | Apagan la conversión de `.doc` y el OCR de los PDF escaneados. |

Los plazos de la PLACSP son siempre en hora peninsular; la web añade la hora local de la empresa cuando su zona
horaria (Ajustes › Empresa) es distinta.
