# Preparación del volumen de Hermes antes de cada arranque (ver init.sh): skills
# del monitor, token de la Biblioteca y permisos.
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a

# Etiquetas OCI. El release sustituye `version` por la del tag (metadata-action).
ARG VERSION=dev
LABEL org.opencontainers.image.title="Sobre Abierto · hermes-init" \
      org.opencontainers.image.description="Prepara el volumen de Hermes (skills, token de la Biblioteca y permisos) antes de cada arranque" \
      org.opencontainers.image.source="https://github.com/datagrowth/sobre-abierto" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="$VERSION"

COPY skills/ /opt/hermes-init/skills/
COPY init.sh /usr/local/bin/hermes-init
RUN chmod 755 /usr/local/bin/hermes-init \
 && chmod -R a+rX /opt/hermes-init

# Corre como root a propósito (el Compose fija user 0:0): su trabajo es devolver al uid 10000 los
# archivos del volumen que no sean suyos. Es un contenedor de un solo paso, sin HEALTHCHECK: termina y sale.
ENTRYPOINT ["/usr/local/bin/hermes-init"]
