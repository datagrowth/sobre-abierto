# Seguridad del servidor

Lo que conviene hacer en el servidor para que la instalación no quede expuesta: qué puertos publicar, cómo mantenerla
al día, cómo tratar los secretos y qué hacer si sospechas una intrusión.

- **Cortafuegos.** Docker publica sus puertos saltándose UFW: deja publicados solo el 80 y el 443 (con Caddy) o
  ninguno (monitor en `127.0.0.1` y acceso por túnel). Hermes (`9119`, `8642`) no se publica nunca. Si puedes,
  limita también la salida de red del servidor a lo que usa (PLACSP, tu proveedor de IA, SMTP, Google).
- **Actualizaciones.** Actualiza el sistema operativo y Docker, y la plataforma con `bash install.sh --actualizar`
  (verifica los archivos contra el `SHA256SUMS` de la release) seguido de `docker compose pull && docker compose up -d`.
  Fija `SOBRE_ABIERTO_VERSION` a una versión en el `.env` en vez de `latest`. Puedes comprobar una imagen con
  `gh attestation verify oci://ghcr.io/datagrowth/sobre-abierto-monitor:<versión> --repo datagrowth/sobre-abierto`.
- **Docker 26 o superior.** El Compose monta Conocimiento en solo lectura para Hermes con una subruta del volumen.
- **Secretos.** Están en el `.env` (modo 600). Rótalos cada cierto tiempo y siempre que alguien con acceso se vaya:
  cambia `MONITOR_SESSION_SECRET` (cierra todas las sesiones), `API_SERVER_KEY` y las claves de los proveedores.
- **Si sospechas una intrusión.** Para el Compose (`docker compose stop`), conserva los logs y una copia del volumen,
  rota todos los secretos y las contraseñas de los usuarios, revoca los tokens de Ajustes › Integraciones y el acceso
  de la aplicación en tu cuenta de Google, y restaura desde una copia anterior al incidente.
- **Sin login.** Con `MONITOR_AUTH=off` todos son administrador: solo en un ordenador personal.
