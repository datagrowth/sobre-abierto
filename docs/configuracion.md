# Configuración

Sobre Abierto se configura en dos sitios. Lo que cambia el comportamiento del servidor (claves, frecuencias, límites)
va en el archivo `.env`; lo que describe a tu empresa y a tu equipo se edita en la web, en **Ajustes**, sin reiniciar
nada.

## En la web (Ajustes)

| Pestaña | Qué se configura | Quién puede |
|---|---|---|
| Empresa | Nombre comercial, zona horaria y perfil (solvencia, certificaciones, trabajos hechos, personas, costes). La primera vez la guían los *Primeros pasos*. | Administrador |
| Marca | Nombre de la instalación, colores y logo (SVG, PNG o WebP de hasta 200 KB). Se aplican sin recargar y en los correos. | Administrador |
| Usuarios y permisos | Personas, roles (`admin`, `editor`, `lector`) y contraseñas provisionales. | Administrador |
| Avisos | Resumen semanal (día, hora, destinatarios, secciones). Cada persona elige sus avisos personales. Necesita SMTP. | Administrador |
| Fuentes y filtros | Qué se descarga de la PLACSP y qué entra en Oportunidades: CPV, importes, regiones y escala de los rankings. | Editor |
| Drive | Conexión con tu cuenta de Google, carpeta raíz y estado de la sincronización. | Administrador |
| Hermes | Estado de los perfiles, modelo de cada uno y cola de IA. | Administrador |
| Integraciones | Tokens de la API de lectura (para Power BI u otras herramientas de BI), estado del servidor MCP y calendario ICS personal. | Administrador |
| Acerca de | Versión, licencia y enlace al código fuente. | Todos |

## En el `.env`

`install.sh` genera el `.env` con las claves necesarias. Las demás variables están comentadas en
[`.env.example`](../.env.example) con su valor por defecto; un test comprueba que ese archivo y el Compose nombran las
mismas variables. Descomenta solo lo que necesites cambiar y aplica con `docker compose up -d`.

### Obligatorias

| Variable | Para qué |
|---|---|
| `API_SERVER_KEY` | Clave de la API de Hermes (`openssl rand -hex 32`). |
| `HERMES_DASHBOARD_BASIC_AUTH_USERNAME` y `_PASSWORD` | Acceso al dashboard de Hermes; la contraseña, distinta de la del monitor. |
| `MONITOR_BASIC_AUTH_USERNAME` y `_PASSWORD` | Primer administrador: su correo y una contraseña inicial de 20 caracteres o más. En cuanto un administrador elige la suya en la web, esta deja de entrar; para recuperar el acceso, el comando de [operacion.md](operacion.md#usuarios-y-recuperación-de-acceso). |
| `MONITOR_SESSION_SECRET` | Firma las sesiones; 32 caracteres o más. Cambiarlo cierra todas las sesiones. |
| `HERMES_LICITACIONES_KEY`, `HERMES_OFERTA_LICITACIONES_KEY`, `HERMES_OFERTA_CRITICO_KEY` | Clave de cada perfil de Hermes. Vacías, la IA queda en espera y el radar sigue funcionando. |

### Las más habituales

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
| `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET` | — | Cliente OAuth propio de Google (ver [operacion.md](operacion.md#google-drive)). |
| `GDRIVE_BACKUP` | `0` | `1` sube una copia diaria a Drive. |
| `TZ` | `Europe/Madrid` | Zona horaria de los contenedores. |
| `LIBREOFFICE_ACTIVO`, `OCR_ACTIVO` | `1` | Apagan la conversión de `.doc` y el OCR de los PDF escaneados. |

Los plazos de la PLACSP son siempre en hora peninsular; la web añade la hora local de la empresa cuando su zona
horaria (Ajustes › Empresa) es distinta.

## Perfiles de Hermes y permisos de los agentes

Un agente nuevo lee Licitaciones y la empresa y propone notas, pero **no ve Colaboradores (los CV)**: concédelo en
`permisos.json` solo a quien lo necesite. Los perfiles comparten contenedor y no son una frontera de seguridad
entre sí ([arquitectura.md](arquitectura.md#seguridad)). Si usas un modelo local en el propio servidor, suma
`deploy/docker-compose.llm-local.yml` (deja a Hermes alcanzar `host.docker.internal`).

Los tres perfiles, su modelo y su clave se explican en [instalacion.md](instalacion.md#proveedor-de-ia), y su operación,
en [operacion.md](operacion.md#perfiles-de-hermes). Qué puede hacer cada agente por MCP se ajusta con un
`permisos.json` opcional; el formato y los permisos por defecto están en [mcp.md](mcp.md#permisos).

## Qué no se configura

- **El idioma.** La interfaz y los textos que genera la IA están en español, pensados para la contratación pública
  española.
- **La telemetría.** No existe: no hay nada que apagar.
