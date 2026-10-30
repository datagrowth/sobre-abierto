# Qué es Sobre Abierto

Sobre Abierto es una plataforma de código abierto para preparar licitaciones públicas españolas. Vigila la Plataforma
de Contratación del Sector Público (PLACSP), criba con IA lo que encaja con tu empresa y ayuda a montar la oferta. Se
instala en un servidor tuyo, con tus datos y el proveedor de IA que elijas.

## Qué hace

- **Radar.** Descarga la PLACSP cada 15 minutos, la filtra por CPV, importe y región y deja en *Oportunidades* lo que
  puede encajar ([Radar de licitaciones](../guia/radar.md)).
- **Criba y fichas.** [Hermes Agent](https://github.com/NousResearch/hermes-agent) compara cada licitación con el
  perfil de tu empresa y prepara una ficha con requisitos, criterios y riesgos, cada uno con la página del pliego que
  lo respalda ([La ficha de la licitación](../guia/ficha-y-oferta/ficha.md)).
- **Oferta.** Guion del pliego, decisiones, memoria técnica por fases con un crítico independiente, anexos, DEUC y
  unas comprobaciones que dicen qué falta antes de presentar
  ([Los cuatro pasos de la oferta](../guia/ficha-y-oferta/preparar-la-oferta.md)).
- **Mercado y aprendizaje.** Quién gana en tu sector, qué órganos compran, qué bajas se ven y qué se aprendió de cada
  oferta ([Mercado](../guia/mercado.md), [Aprendizaje](../guia/aprendizaje.md)).
- **Biblioteca de Conocimiento.** Las notas y documentos de la empresa, en el disco o sincronizados con Google Drive,
  con búsqueda por significado ([Biblioteca de Conocimiento](../guia/biblioteca.md)).
- **Equipo.** Usuarios con roles, las personas que se proponen en cada oferta, avisos por correo y calendario de
  plazos ([Equipo](../guia/equipo.md), [Plazos y avisos](../guia/plazos-y-avisos.md)).

## Qué no hace

No presenta la oferta por ti. Genera los documentos, y una persona los firma y los sube a la plataforma del órgano de
contratación. Tampoco decide: la IA lee pliegos, propone fichas, redacta borradores y critica, pero si se presenta, a
qué precio y con qué equipo lo decide una persona.

## Cómo funciona

El código descarga y normaliza la PLACSP, calcula plazos, importes y antecedentes, y comprueba que la oferta está
completa. La IA lee los pliegos, redacta y critica, y **solo propone**: lo que sale de un modelo queda como propuesta
hasta que alguien lo aprueba.

Toda la IA corre en Hermes. La plataforma no guarda claves de ningún modelo: pide los trabajos a Hermes y Hermes
consulta la plataforma por MCP. Por eso puedes cambiar de proveedor, o usar un modelo local, sin tocar el código. Los
documentos viven en carpetas que el equipo ya conoce (Drive o el disco del servidor), y las bases de datos guardan los
hechos y el estado. El diseño completo, con diagramas, está en [Arquitectura](../como-esta-hecho/arquitectura.md).

## Para quién es

Para empresas que se presentan a concursos públicos en España y quieren un sitio donde vigilar lo que sale, decidir
rápido a qué ir y preparar la oferta con ayuda. La interfaz y los textos que genera la IA están en español, y todo
está pensado para la contratación pública española: PLACSP, códigos CPV, DEUC, clasificación de contratistas y la
LCSP. Fuera de España no sirve.

Hace falta alguien que mantenga un servidor Linux con Docker. Lo que cuesta dinero es el proveedor de IA; la plataforma
es software libre con licencia AGPL-3.0-or-later.

## Estado y privacidad

Está en **beta**: la usan equipos reales, pero todavía hay aristas. Haz una copia de seguridad antes de actualizar y
lee el [CHANGELOG](../../CHANGELOG.md).

**No hay telemetría.** Sobre Abierto no envía datos de uso a nadie. Las únicas conexiones de salida son las que
configuras: la PLACSP, tu proveedor de IA, tu SMTP y, si lo activas, Google Drive. Los datos de los CV solo llegan a
Hermes en el perfil que prepara la oferta, nunca a los demás agentes.

## Siguiente paso

[Instala Sobre Abierto](instalacion.md) en tu servidor y sigue con los [Primeros pasos](primeros-pasos.md).
