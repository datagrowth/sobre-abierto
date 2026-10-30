# Dokploy

Dokploy despliega [docker-compose.yml](docker-compose.yml) de esta carpeta con las variables del
[.env.example](../../.env.example) de la raíz. Como las plantillas de Coolify y Easypanel, se genera con
`node deploy/generar.mjs` a partir del Compose de la raíz, y el test de infra falla si se desfasa.

Diferencias con el Compose de la raíz:

- El monitor no publica ningún puerto: Traefik, el proxy de Dokploy, le lleva el tráfico del dominio.
- El monitor se une a `dokploy-network`, la red de Traefik.
- `MONITOR_PROXIES_DE_CONFIANZA` vale `1`, para que el bloqueo de login use la IP real y no la de Traefik.

Pasos:

1. Crea un servicio de tipo **Compose** apuntando al repositorio (rama `main` o una etiqueta `vX.Y.Z`), con
   _Compose Path_ `./deploy/dokploy/docker-compose.yml`.
2. Pega en **Environment** el contenido del `.env.example` de la raíz y rellena las variables obligatorias.
3. En **Domains**, asigna el dominio al servicio `monitor`, puerto `3110`, con HTTPS.
4. Despliega y crea los perfiles de Hermes como indica [deploy/README.md](../README.md#lo-común-a-los-tres).

La guía completa de operación (reinicios, copias, restauración) está en [docs/operacion.md](../../docs/operacion.md).
