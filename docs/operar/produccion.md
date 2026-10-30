# La instalación en producción

Para quien tiene la plataforma instalada en su servidor y la mantiene: qué servicios y volúmenes hay, qué se publica a
Internet y qué atajos usan los comandos de esta sección.

Cómo se instala está en [Instalación](../empezar/instalacion.md); qué hace cada pantalla, en la
[Guía de uso](../guia/README.md); cómo está hecha, en [Arquitectura](../como-esta-hecho/arquitectura.md). Las variables
están en [Variables de entorno](../referencia/variables-de-entorno.md) y, con su valor por defecto, en `.env.example`:
en estas páginas solo se nombran las imprescindibles. Los ejemplos usan `plataforma.example.com` como dominio de la web.

## Atajos de los comandos

El Compose **autónomo** de la raíz (`docker-compose.yml`) es el que instala `install.sh`: descarga las imágenes
de GHCR, con red propia y puerto en `127.0.0.1`. Los paneles usan su plantilla de `deploy/` (en Dokploy,
`deploy/dokploy/docker-compose.yml`), con los mismos servicios. Los comandos de la sección Operar se lanzan
desde la carpeta de la instalación con tres atajos:

```bash
DC="docker compose"                               # el Compose autónomo (en Dokploy: -f deploy/dokploy/docker-compose.yml)
MON=monitor                                       # el servicio del monitor
HB=/opt/hermes/.venv/bin/hermes                   # la orden hermes en su contenedor (no está en el PATH)
```

El servicio del monitor se llama `monitor`, con el alias `hermes-monitor` en la red, que es el nombre que usan los
perfiles de Hermes. Donde una orden de `$DC` dice `hermes-monitor`, el servicio es `monitor`.

## Arquitectura en producción

Una sola aplicación Docker Compose (`docker-compose.yml`), con `docker compose` a mano, con `install.sh` o
desde un panel (Dokploy, Coolify, Easypanel; ver [deploy/](../../deploy/README.md)).

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
