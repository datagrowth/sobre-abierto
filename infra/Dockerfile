# Sobre Abierto: web (Vite) + server (Express/Socket.io, con la Biblioteca, el núcleo de
# la plataforma y sus dominios), en un solo contenedor que escucha en APP_PORT.
# Contexto de build: la raíz del repo (ver docker-compose.yml).

# ── Dependencias de todo el monorepo (un solo lockfile) ─────────────────────
# better-sqlite3 se compila/descarga para Linux: necesita python3, make y g++.
# Versión exacta de Node, no la etiqueta flotante: un build que reutiliza la
# imagen base en caché se quedaría sin los parches de seguridad.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

# ── Build: web (Vite → dist) y server (TypeScript → dist) ───────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/ apps/
RUN npm run build

# ── Dependencias de producción del server ───────────────────────────────────
FROM deps AS prod-deps
RUN npm ci --omit=dev --no-audit --no-fund -w @sobre-abierto/server

# ── Imagen final ────────────────────────────────────────────────────────────
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

# Etiquetas OCI. El release sustituye `version` por la del tag (metadata-action).
ARG VERSION=dev
LABEL org.opencontainers.image.title="Sobre Abierto" \
      org.opencontainers.image.description="Plataforma de licitaciones públicas y conocimiento de empresa sobre Hermes Agent" \
      org.opencontainers.image.source="https://github.com/datagrowth/sobre-abierto" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later" \
      org.opencontainers.image.version="$VERSION"

# LibreOffice Writer sin interfaz: convierte los .doc de la PLACSP a .docx para leerlos y
# las memorias .docx a PDF para contar páginas reales (≈ +330 MB). Las fuentes Liberation
# y Carlito/Caladea tienen las métricas de Arial/Times y Calibri/Cambria: pagina como Word.
# Tesseract (español) y poppler-utils (pdftoppm): OCR de los pliegos escaneados al indexarlos
# (nucleo/documentos/ocr.ts, ≈ +40 MB). OCR_ACTIVO=0 lo apaga sin quitarlo de la imagen.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-writer-nogui fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core \
      tesseract-ocr tesseract-ocr-spa poppler-utils \
 && rm -rf /var/lib/apt/lists/* \
 && /usr/lib/libreoffice/program/soffice.bin --version \
 && tesseract --list-langs | grep -qx spa

# El monitor corre con un uid sin home (MONITOR_USER): las cachés y el perfil de
# LibreOffice van a /tmp. SAL_USE_VCLPLUGIN=svp: sin pantalla ni GTK.
ENV XDG_CACHE_HOME=/tmp/.cache \
    HOME=/tmp \
    SAL_USE_VCLPLUGIN=svp \
    LIBREOFFICE_BIN=/usr/lib/libreoffice/program/soffice.bin \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    APP_PORT=3110 \
    HERMES_HOME=/opt/data \
    HERMES_VAULT_CONFIG_PATH=/vault/hermes-vault.config.json \
    PLATAFORMA_DATA_DIR=/datos
WORKDIR /app
# node_modules de la raíz y los package.json de cada app (el del server declara
# "type": "module", necesario para ejecutar su dist).
COPY --from=prod-deps /app ./
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist
# Escribibles para cualquier MONITOR_USER (el volumen hereda estos permisos).
# /drive-state es el volumen que comparte con drive-sync (conexión con Drive);
# /datos, el de las bases de datos de la plataforma.
RUN mkdir -p /vault /drive-state /datos && chmod 1777 /vault /drive-state /datos
# Sin privilegios: el Compose lo sobrescribe con MONITOR_USER, pero una imagen lanzada a pelo
# tampoco corre como root.
USER 10000:10000
EXPOSE 3110
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||3110)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
