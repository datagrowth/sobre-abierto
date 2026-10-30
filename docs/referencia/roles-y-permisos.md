# Roles y permisos

Qué puede hacer cada persona según su rol y qué puede ver cada agente de IA. Sirve para decidir qué rol dar a cada
usuario y qué permisos tocar en `permisos.json`.

## Personas

Cada usuario tiene uno de tres roles, que un `admin` cambia en **Ajustes › Usuarios y permisos**. Tiene que quedar
siempre un `admin` activo.

| Rol | Puede |
|---|---|
| `admin` | Todo: también decidir el precio, Empresa y costes internos, usuarios, avisos, Drive y la Consola de Hermes |
| `editor` | Aplicar oportunidades, preparar ofertas, decisiones salvo el precio, memoria y lecciones |
| `lector` | Ver (los botones que guardan salen desactivados), salvo Colaboradores (los CV) y la actividad en vivo de Hermes, que son de `editor` |

Algunas acciones concretas:

| Acción | Quién |
|---|---|
| Marca, Empresa, Usuarios, Avisos (resumen semanal), Drive, Hermes e Integraciones en Ajustes | `admin` ([Configuración](../empezar/configuracion.md#en-la-web-ajustes)) |
| Fuentes y filtros en Ajustes | `editor` y `admin` |
| Abrir la Consola de Hermes | `admin` ([La instalación en producción](../operar/produccion.md#dominios)) |
| Crear tokens de la API de lectura para BI | `admin` ([Administración](../guia/administracion.md#api-de-lectura-para-bi)) |
| Dar una oferta a otra persona del equipo | `editor` y `admin` ([Pipeline](../guia/pipeline.md#responsable-e-hitos)) |
| Comentar y mencionar | Todos, también un `lector` ([Pipeline](../guia/pipeline.md#comentarios-con-menciones)) |
| Dar un comentario por resuelto | Quien lo escribió o un `editor` |
| Ver la tarjeta de Primeros pasos | `admin` ([Primeros pasos](../empezar/primeros-pasos.md)) |
| Elegir sus propios avisos y cambiar su contraseña | Cada persona |

Lo que alguien guarda (decisiones, descartes, bloqueos de las comprobaciones, lecciones, revisiones, pliegos subidos)
queda con su nombre: lo pone el servidor desde la sesión, no lo que mande el navegador. Con `MONITOR_AUTH=off` no hay
login y todos son `admin`: solo vale en un ordenador personal ([Seguridad del servidor](../operar/seguridad.md)).

## Agentes

Los agentes (Hermes, sus perfiles, Claude Code u otro cliente MCP) no tienen rol de persona: cada uno entra con su
token y tiene, por dominio, `leer`, `proponer` (que incluye leer) o nada. Ningún agente aprueba: lo que propone lo
revisa una persona o lo valida el código.

- Por defecto, un agente nuevo lee Licitaciones y la empresa y propone notas, pero **no ve Colaboradores (los CV)**.
- El crítico de la memoria (`critico-licitaciones`) solo ve Licitaciones: no lee la Biblioteca ni los CV.
- Los datos de los CV solo van a Hermes en el perfil que prepara la oferta.

La tabla de permisos por agente y dominio está en [Servidor MCP](mcp.md#permisos), y cómo cambiarlos con
`permisos.json`, en [Agentes y tokens MCP](../operar/agentes-mcp.md#tokens-de-agente).
