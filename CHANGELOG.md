# Registro de cambios

Todos los cambios importantes de Sobre Abierto se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[versionado semántico](https://semver.org/lang/es/).

## [0.1.0] - 2026-10-28

Primera versión pública, con licencia AGPL-3.0-or-later. Es una versión temprana: funciona, pero aún tiene detalles por pulir antes de una 1.0.

### Añadido

- **Radar de licitaciones** sobre la Plataforma de Contratación del Sector Público: sincronización cada 15 minutos,
  prefiltro por CPV, palabras, importe, tipo y región, histórico de adjudicaciones y precios.
- **Criba y fichas con IA** en Hermes Agent, con tres perfiles (`licitaciones`, `oferta-licitaciones` y
  `critico-licitaciones`), cola de trabajos, métricas por modelo y avisos cuando la IA falla.
- **Oferta**: guion, memoria técnica con dossier, estrategia, redacción entera, crítico ciego y rondas,
  anexos, DEUC, compromisos con coste y unas comprobaciones que dicen qué falta antes de presentar.
- **Pipeline** de ofertas en curso, **Mercado** (competidores, organismos, vencimientos), **Aprendizaje** y **Equipo**.
- **Biblioteca de Conocimiento** en disco o sincronizada con Google Drive, con índice de texto y vectores, OCR de
  pliegos escaneados y lectura de `.doc` con LibreOffice.
- **Usuarios y roles** (admin, editor y lector), avisos por correo, calendario de plazos (ICS) y API de lectura para BI.
- **Configuración de la empresa** desde la web, sin tocar el código: marca (nombre, colores y logo en
  Ajustes › Marca), perfil, zona horaria y escala de los rankings.
- **Instalación desde fuera**: imágenes multi-arquitectura en GHCR, `docker-compose.yml` autónomo con override de
  Caddy para HTTPS, `install.sh` idempotente que crea los perfiles de Hermes, y plantillas para Dokploy, Coolify y
  Easypanel.
- **Primeros pasos** en el Pipeline vacío: perfil de la empresa, filtros, IA y Drive (opcional).

[0.1.0]: https://github.com/datagrowth/sobre-abierto/releases/tag/v0.1.0
