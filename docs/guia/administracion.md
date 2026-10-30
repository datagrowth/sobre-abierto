# Administración

Lo que configura un administrador en la web: las pestañas de Ajustes, el login y los usuarios, la API de lectura para
BI y lo que identifica a la instalación (marca, empresa y versión).

<!-- captura: ajustes · Ajustes con sus pestañas, abierto en Empresa -->

## Ajustes

**Ajustes**, al pie de la barra lateral, en nueve pestañas:
**Empresa** (el perfil, con el nombre comercial y la zona horaria, y la carpeta Empresa),
**Marca** (nombre de la app, colores con su contraste AA comprobado y logo; solo admin),
**Usuarios y permisos**, **Avisos**, **Fuentes y filtros** (el estado del radar: cuentas,
ingesta, histórico de adjudicaciones, oportunidades, pliegos y fichas; la **auditoría de
cobertura** por comunidad con el formulario para apuntar la cifra autonómica; la **calidad del
dato**: adjudicaciones con importe por encima de 1,2 veces el presupuesto, baja de más del 70 %,
0 ofertas, NIF no válido o lote sin importe, con ejemplos y cuántas quedan fuera de los índices,
los pliegos que no se pueden leer, cuánto aciertan los índices y las actas ajenas leídas; y el
**prefiltro de entrada** y la **escala de los rankings** de competencia: territorio y banda), **Drive** (la conexión, las carpetas de Conocimiento, la **carpeta
única por licitación** —el ensayo, que dice qué se movería a `Licitaciones/Ofertas/` sin tocar
nada, y la migración, con confirmación y copia previa de las bases—, y la carpeta de notas de
la Biblioteca; ver [Carpeta única por licitación](../como-esta-hecho/carpetas.md#carpeta-única-por-licitación)), **Hermes** (lo operativo: perfiles de oferta, tareas programadas, trabajos por oferta y fichas de Hermes) e
**Integraciones** y **Acerca de** (la versión, la licencia y el enlace al código fuente). Las direcciones alternativas (`#/ajustes/filtros-licitaciones`,
`…/estado-licitaciones`, `…/biblioteca`) llevan a su pestaña.

## Login y usuarios

Cada persona entra con su **email** y su contraseña (12
caracteres como mínimo, guardada con scrypt). Un `admin` da de alta en **Ajustes › Usuarios
y permisos** con una contraseña temporal que la persona cambia en su primer acceso (hasta
entonces la web solo le deja cambiarla). Ahí mismo cambia roles, da de baja (la sesión se
cierra al momento) y pone otra contraseña temporal; cada persona cambia la suya en la misma
pestaña, y al cambiarla se cierran sus otras sesiones. Tiene que quedar siempre un admin
activo. Hay tres roles, `admin`, `editor` y `lector`; lo que puede cada uno está en
[Roles y permisos](../referencia/roles-y-permisos.md).

Lo que alguien guarda (decisiones, descartes, bloqueos de las comprobaciones, lecciones, revisiones,
pliegos subidos) queda con su nombre: lo pone el servidor desde la sesión, no lo que mande
el navegador. El login por variables de entorno (`MONITOR_BASIC_AUTH_*`, distinto del del dashboard de
Hermes, que no lo recibe) crea el primer `admin` al arrancar sin usuarios, y en cuanto ese
admin elige su contraseña deja de entrar: solo mientras ningún admin activo tenga la suya
sirve como **acceso de emergencia** (entra como admin, firma «Acceso de emergencia» y deja
aviso en el log), y las sesiones de emergencia abiertas caen al instante. Quien pierda el
acceso ejecuta dentro del contenedor del monitor `recuperarAcceso.js <email>`, que pone una
contraseña temporal al admin y le obliga a cambiarla al entrar. En Dokploy es obligatorio (y el secreto de
sesión `MONITOR_SESSION_SECRET`); en local, sin él el monitor queda abierto (uso de
escritorio, sin personas). La sesión se renueva sola mientras se usa (se cierra tras 12 h
sin usar el monitor o 7 días desde el login; un despliegue no la cierra) y **Salir** la
invalida. Si caduca con la web abierta, vuelve la pantalla de login. Tras 10 fallos desde una
IP, o 30 por minuto en total, el login se frena un rato. Solo se aceptan cambios y WebSockets
que vengan de la propia web (cabecera `Origin`).

## API de lectura para BI

**API de lectura para BI** (Ajustes › Integraciones, solo `admin`): un token por
integración (Power BI, una hoja de cálculo…), que se ve una sola vez al crearlo y se revoca al
momento. `GET /api/v1/pipeline`, `/presentadas` (con resultado, puntos y ganador), `/indices`
(los índices de mercado de cada segmento) y `/lecciones` (las aceptadas), con la cabecera
`Authorization: Bearer <token>`; solo lectura, por páginas (`desde` y `limite`, hasta 5.000) y
sin datos de personas, costes, notas ni documentos. Al lado, el estado del **MCP**: agentes con
acceso, última llamada y llamadas en 24 horas.

## La instalación

Nada de una empresa concreta está en el código. La marca (nombre de la app,
colores y logo) la cambia un admin en **Ajustes › Marca** y va en `nucleo.db`; sin ella, el
sobre y los colores neutros de Sobre Abierto. La web la lee de `GET /api/config` y el logo de
`GET /api/marca/logo`. Lo de la empresa va en su perfil: el nombre comercial con que la nombran
las tareas de Hermes y la memoria, la zona horaria y las áreas de formación. Del entorno solo salen `APP_URL` (la
dirección pública) y `APP_SOURCE_URL`: el enlace al **código fuente** del pie de la barra
lateral y de Ajustes › Acerca de, que pide la AGPL.

## Instalación y actualización

Se instala con `install.sh` (o con el Compose de la raíz, o desde un panel) y
se actualiza cambiando `SOBRE_ABIERTO_VERSION`; el primer administrador es el correo y la contraseña inicial que
enseña el instalador, y cambia la contraseña en su primer acceso (desde entonces la del `.env` deja de entrar; el acceso se recupera con un comando dentro del contenedor). Ver [Instalación](../empezar/instalacion.md), [Actualizar](../empezar/actualizar.md) y
[Usuarios y recuperación de acceso](../operar/usuarios-y-acceso.md).
