# Sobre Abierto

[![Licencia: AGPL-3.0](https://img.shields.io/github/license/datagrowth/sobre-abierto)](LICENSE)
[![Versión](https://img.shields.io/github/v/release/datagrowth/sobre-abierto?include_prereleases&label=versi%C3%B3n)](https://github.com/datagrowth/sobre-abierto/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/datagrowth/sobre-abierto/ci.yml?branch=main&label=CI)](https://github.com/datagrowth/sobre-abierto/actions/workflows/ci.yml)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-2496ED?logo=docker&logoColor=white)](https://github.com/orgs/datagrowth/packages?repo_name=sobre-abierto)

**Plataforma de código abierto para ganar licitaciones públicas.** Vigila la Plataforma de Contratación del Sector
Público, criba con IA lo que encaja con tu empresa y te ayuda a preparar la oferta: ficha, equipo, precio, memoria
técnica y anexos. Corre en tu servidor, con tus datos y tu proveedor de IA.

[English](README.en.md) · [Documentación](https://docs.sobreabierto.datagrowth.es) · [Instalación](docs/empezar/instalacion.md) · [Guía de uso](docs/guia/README.md) · [Arquitectura](docs/como-esta-hecho/arquitectura.md)

- **Radar.** Descarga la PLACSP cada 15 minutos, filtra por CPV, importe y región, y deja lo que puede encajar en
  *Oportunidades*.
- **Criba y fichas con IA.** [Hermes Agent](https://github.com/NousResearch/hermes-agent) compara cada licitación con
  el perfil de tu empresa y prepara una ficha con requisitos, criterios y riesgos, con la página del pliego que lo
  respalda.
- **Oferta.** Guion, memoria técnica por fases (dossier, estrategia, redacción y crítico independiente), anexos,
  DEUC y unas comprobaciones que dicen qué falta antes de presentar.
- **Mercado y aprendizaje.** Competidores, organismos, precios de adjudicaciones anteriores y lecciones de cada oferta.
- **Biblioteca de Conocimiento.** Tus notas y documentos, en disco o sincronizados con Google Drive.
- **Equipo.** Usuarios con roles, avisos por correo y calendario de plazos.

## Cómo funciona, en un minuto

El código descarga y normaliza la PLACSP, calcula plazos, importes y antecedentes, y comprueba que la oferta está
completa. La IA lee los pliegos, redacta y critica, pero **solo propone**: una persona decide. Toda la IA corre en
Hermes, así que la plataforma no lleva claves de ningún modelo y puedes cambiar de proveedor sin tocar el código.
El diseño, con diagramas, está en [Arquitectura](docs/como-esta-hecho/arquitectura.md).

## Estado

**Beta.** La usan equipos reales, pero todavía hay aristas: haz una copia de seguridad antes de actualizar y lee el
[CHANGELOG](CHANGELOG.md). La interfaz y los textos que genera la IA están en español, y está pensada para la
contratación pública española.

## Instalación rápida

Necesitas un servidor Linux con Docker 24 o posterior y Compose v2 (6 GB de memoria como mínimo) y una cuenta de un
proveedor de IA. Descarga el script, léelo y ejecútalo:

```bash
curl -fsSLO https://raw.githubusercontent.com/datagrowth/sobre-abierto/main/install.sh
less install.sh
bash install.sh
```

Te pregunta el correo del administrador, el dominio (opcional) y el proveedor de IA; genera las claves, arranca todo,
crea los perfiles de Hermes y, al terminar, te da la dirección y una contraseña inicial que la web te pide cambiar al
entrar y que después deja de valer (ver [Primer acceso](docs/empezar/instalacion.md#primer-acceso); si pierdes el acceso,
[recupéralo](docs/operar/usuarios-y-acceso.md)). La primera pantalla te lleva por los
[primeros pasos](docs/empezar/primeros-pasos.md): el perfil de tu empresa, qué licitaciones buscar y la IA.

Los requisitos, la instalación a mano con Compose o con un panel (Dokploy, Coolify, Easypanel) y la elección del
modelo de cada perfil están en [Instalación](docs/empezar/instalacion.md).

## Privacidad

**No hay telemetría.** Sobre Abierto no envía datos de uso a nadie. Las únicas conexiones de salida son las que
configuras: las fuentes públicas (PLACSP), tu proveedor de IA, tu SMTP y, si lo activas, Google Drive. Los datos de CV
de las personas solo llegan a Hermes en el perfil de oferta, nunca a los demás agentes.

## Documentación

Está en [docs/](docs/README.md), una carpeta por sección, y publicada en
[docs.sobreabierto.datagrowth.es](https://docs.sobreabierto.datagrowth.es).

| | |
|---|---|
| [Empezar](docs/empezar/README.md) | Qué es, instalación, primeros pasos, configuración y actualizaciones |
| [Guía de uso](docs/guia/README.md) | Qué hace, pantalla por pantalla: radar, oportunidades, pipeline, ficha y oferta, mercado… |
| [Operar](docs/operar/README.md) | Mantener una instalación: copias, reinicios, usuarios, Drive, correo y seguridad |
| [Referencia](docs/referencia/README.md) | Variables de entorno, herramientas MCP, roles y permisos, preguntas frecuentes |
| [Cómo está hecho](docs/como-esta-hecho/README.md) | Arquitectura, memoria técnica y carpetas de las licitaciones |
| [Contribuir](docs/contribuir/README.md) | Entorno de desarrollo, [CONTRIBUTING.md](.github/CONTRIBUTING.md) y [SECURITY.md](.github/SECURITY.md) |

## Licencia

[AGPL-3.0-or-later](LICENSE): puedes usarlo, modificarlo y desplegarlo, también dentro de tu empresa. Si ofreces una
versión modificada a otras personas por red, debes darles su código fuente (el enlace está en el pie de la
aplicación). Los componentes de terceros están en [NOTICE.md](NOTICE.md); el uso del nombre y del logo, en
[TRADEMARKS.md](TRADEMARKS.md).
