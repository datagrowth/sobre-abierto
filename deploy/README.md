# Instalar con un panel (Dokploy, Coolify, Easypanel)

Un panel (PaaS autoalojado) se encarga del dominio, del HTTPS y de los despliegues. Sobre Abierto es una aplicación
Docker Compose, así que cualquiera que sepa desplegar un Compose sirve. Cada carpeta trae lo que cambia en ese panel:

| Panel | Carpeta | Estado |
|---|---|---|
| [Dokploy](dokploy/README.md) | `deploy/dokploy/` | Compose validado con `docker compose config`; **sin probar dentro del panel** |
| [Coolify](coolify/docker-compose.yml) | `deploy/coolify/` | Compose validado con `docker compose config`; **sin probar dentro del panel** |
| [Easypanel](easypanel/docker-compose.yml) | `deploy/easypanel/` | Compose validado con `docker compose config`; **sin probar dentro del panel** |

Si lo pruebas en un panel y algo falla (o funciona), cuéntalo en una issue: arreglaremos la plantilla.

Sin panel, el `docker-compose.yml` de la raíz se combina con estas variantes (`-f docker-compose.yml -f deploy/…`):

| Variante | Para qué |
|---|---|
| `docker-compose.caddy.yml` | HTTPS automático con Caddy; `install.sh` la usa cuando hay `DOMINIO` |
| `docker-compose.llm-local.yml` | Un modelo en el propio servidor (Ollama, LM Studio) |
| `docker-compose.build.yml` | Compilar las imágenes desde el código en vez de descargarlas |

## Lo común a los tres

1. **Origen:** el repositorio `https://github.com/datagrowth/sobre-abierto`, rama `main` (o una etiqueta `vX.Y.Z`),
   como aplicación *Docker Compose* con el archivo de su carpeta. Las imágenes se descargan de GHCR: no se compila
   nada en el servidor del panel.
2. **Variables de entorno:** las del [.env.example](../.env.example) de la raíz. Las
   obligatorias son las que no tienen valor y no están comentadas; genera cada clave con `openssl rand -hex 32`. Los
   valores de `HERMES_LICITACIONES_URL`, `HERMES_OFERTA_LICITACIONES_URL` y `HERMES_OFERTA_CRITICO_URL` ya vienen en la
   plantilla.
3. **Dominio:** asígnalo al servicio **monitor**, puerto **3110**. Hermes (`9119` y `8642`) no se publica nunca.
4. **Perfiles de Hermes:** el panel no ejecuta `install.sh`, así que crea los perfiles una vez desplegado, desde el
   terminal del contenedor `hermes` del panel (o con `docker compose exec`):

   ```bash
   HERMES_LICITACIONES_KEY=… HERMES_OFERTA_LICITACIONES_KEY=… HERMES_OFERTA_CRITICO_KEY=… \
   LLM_PROVEEDOR=anthropic LLM_API_KEY=… MODELO_LICITACIONES=claude-sonnet-5-5 \
   sh -c "$(curl -fsSL https://raw.githubusercontent.com/datagrowth/sobre-abierto/main/infra/perfiles.sh)"
   ```

   Las tres `HERMES_*_KEY` son las mismas que pusiste en las variables del panel. Después, **vuelve a desplegar**
   (para que `hermes-init` cree el token de cada perfil y deje bien los permisos) y reinicia el servicio `hermes`.
   Es idempotente: si el perfil existe, no lo pisa. Lo detalla
   [Perfiles de Hermes](../docs/operar/perfiles-de-hermes.md).
5. **Primer acceso:** con `MONITOR_BASIC_AUTH_USERNAME` (un correo) y `MONITOR_BASIC_AUTH_PASSWORD`; la web pide
   cambiar la contraseña al entrar y, desde ese momento, la del panel deja de entrar. Si luego se pierde el acceso,
   abre una terminal en el contenedor del monitor y ejecuta
   `node apps/server/dist/recuperarAcceso.js correo-del-admin`
   (más en [Usuarios y recuperación de acceso](../docs/operar/usuarios-y-acceso.md)).

## Detrás de un proxy

`MONITOR_PROXIES_DE_CONFIANZA` indica cuántos proxies hay delante del monitor: con 1, el bloqueo de login usa la IP
real de quien entra. Las tres plantillas lo ponen a 1.
