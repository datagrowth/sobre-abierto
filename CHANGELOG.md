# Registro de cambios

Todos los cambios importantes de Sobre Abierto se anotan aquí. El formato sigue
[Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el proyecto usa
[versionado semántico](https://semver.org/lang/es/).

## [0.1.2] - 2026-11-03

### Corregido

- **Hermes se quedaba sin las herramientas de la plataforma en Dokploy** (despliegue aislado): el panel pasa Hermes a
  una red sin el alias `hermes-monitor` y el perfil no resolvía la URL del MCP. Los perfiles usan ahora
  `http://monitor:3110/mcp`, el nombre del servicio, y `hermes-init` cambia la URL vieja en cada arranque, sin tocar
  ninguna otra.
- **Un trabajo que esperaba una herramienta no se volvía a ejecutar**: al relanzarlo con la misma clave, Hermes
  devolvía el run que dijo no tenerla. Ahora sale con clave nueva.
- **«Cribar ahora» no sacaba de la espera a la criba** que esperaba una herramienta; ahora la relanza y quita los
  avisos de la criba, que vuelven si falla otra vez (el de «más del 20 % de lotes fallidos» cuenta desde el último
  «Cribar ahora»).

### Cambiado

- Los trabajos que esperan una herramienta **salen solos** en cuanto el perfil de Hermes vuelve a cargar la lista
  (al reiniciarlo), sin esperar 24 h ni pedirlos a mano: las actas de expedientes ajenos no tienen botón.
- Si el perfil sí usó el MCP durante el run, un «la herramienta no está disponible» es un error del modelo (la llamó
  mal) y cuenta como un fallo normal, en vez de parar el tipo entero 24 h. La espera guarda lo que respondió Hermes.
- El aviso de **perfiles de contratante sin novedades** sale a las 24 h, no a las 6 h: la PLACSP tiene parones de una
  tarde a la mañana siguiente que no son una caída.

### Para actualizar

- Con Dokploy en despliegue aislado, basta desplegar: `hermes-init` corrige la URL del MCP al arrancar. Después,
  reinicia Hermes con la cola quieta para que cargue las herramientas.

## [0.1.1] - 2026-11-03

### Cambiado

- **`install.sh` reinicia Hermes tras actualizar** cuando la versión nueva cambia sus herramientas: espera a que no
  haya runs de IA en marcha (hasta 15 minutos, `REINICIO_ESPERA_MIN`) y, si no se quedan quietos, avisa sin cortar
  nada. Ya no hace falta reiniciarlo a mano después de `install.sh --actualizar`.
- `reinicioHermes.js`, dentro del monitor, dice qué perfiles de Hermes tienen herramientas viejas y cuántos runs
  cortaría un reinicio.
- El aviso «falta una herramienta en Hermes» nombra la herramienta y ya no repite el mismo consejo dos veces.
- Dependencias al día: imagen base `node:26.13.0-bookworm-slim`, dependencias menores del server y la web, y las
  actions `checkout` 7, `setup-qemu-action` 4, `metadata-action` 6 y `attest-build-provenance` 4.

### Corregido

- Tras actualizar, la comprobación final del instalador (`hermes mcp test`) daba por cargada la lista nueva de
  herramientas aunque Hermes siguiera con la vieja: los trabajos dejaban de esperar y fallaban por falta de
  herramienta. Ahora no se hace mientras el reinicio esté pendiente.

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

[0.1.2]: https://github.com/datagrowth/sobre-abierto/releases/tag/v0.1.2
[0.1.1]: https://github.com/datagrowth/sobre-abierto/releases/tag/v0.1.1
[0.1.0]: https://github.com/datagrowth/sobre-abierto/releases/tag/v0.1.0
