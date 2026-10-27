# Sincronizador con Google Drive (rclone): carpetas de contenido en ambos
# sentidos y copia de seguridad diaria (desactivable) de los datos de Hermes.
FROM rclone/rclone:1.75.1@sha256:45401ad7410db1d67ffdb58e19059ad20b0d8e0285a60e38bbec55cc1019c7a5

# Etiquetas OCI. El release sustituye `version` por la del tag (metadata-action).
ARG VERSION=dev
LABEL org.opencontainers.image.title="Sobre Abierto · drive-sync" \
      org.opencontainers.image.description="Sincronización con Google Drive (rclone) y copia de seguridad de los datos de Hermes" \
      org.opencontainers.image.source="https://github.com/datagrowth/sobre-abierto" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="$VERSION"

# sqlite: copia consistente de state.db (WAL) para la copia de seguridad.
# jq: leer drive.json (la conexión que guarda el monitor) y escribir status.json.
RUN apk add --no-cache sqlite tar jq \
 && mkdir -p /state \
 && chown 10000:10000 /state

# sync.sh carga copia.sh y rutas.sh de su misma carpeta.
COPY sync.sh copia.sh rutas.sh /usr/local/lib/drive-sync/
RUN chmod 755 /usr/local/lib/drive-sync/sync.sh

# El estado de /state es de este uid, el mismo con el que Hermes ejecuta el agente.
USER 10000:10000
# sync.sh es el proceso 1 y el contenedor se para si muere; esto detecta además un contenedor sin su script.
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD pgrep -f drive-sync/sync.sh >/dev/null || exit 1

ENTRYPOINT ["/usr/local/lib/drive-sync/sync.sh"]
