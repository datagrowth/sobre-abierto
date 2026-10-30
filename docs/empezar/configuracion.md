# Configuración

Sobre Abierto se configura en dos sitios. Lo que cambia el comportamiento del servidor (claves, frecuencias, límites)
va en el archivo `.env`; lo que describe a tu empresa y a tu equipo se edita en la web, en **Ajustes**, sin reiniciar
nada. Aquí va lo que se ajusta en la web; las variables del `.env` están en
[Variables de entorno](../referencia/variables-de-entorno.md).

## En la web (Ajustes)

| Pestaña | Qué se configura | Quién puede |
|---|---|---|
| Empresa | Nombre comercial, zona horaria y perfil (solvencia, certificaciones, trabajos hechos, personas, costes). La primera vez la guían los [Primeros pasos](primeros-pasos.md). | Administrador |
| Marca | Nombre de la instalación, colores y logo (SVG, PNG o WebP de hasta 200 KB). Se aplican sin recargar y en los correos. | Administrador |
| Usuarios y permisos | Personas, roles (`admin`, `editor`, `lector`; ver [Roles y permisos](../referencia/roles-y-permisos.md)) y contraseñas provisionales. | Administrador |
| Avisos | Resumen semanal (día, hora, destinatarios, secciones). Cada persona elige sus avisos personales. Necesita SMTP. | Administrador |
| Fuentes y filtros | Qué se descarga de la PLACSP y qué entra en Oportunidades: CPV, importes, regiones y escala de los rankings. | Editor |
| Drive | Conexión con tu cuenta de Google, carpeta raíz y estado de la sincronización. | Administrador |
| Hermes | Estado de los perfiles, modelo de cada uno y cola de IA. | Administrador |
| Integraciones | Tokens de la API de lectura (para Power BI u otras herramientas de BI), estado del servidor MCP y calendario ICS personal. | Administrador |
| Acerca de | Versión, licencia y enlace al código fuente. | Todos |

## Marca y empresa de la instalación

Nada de una empresa concreta va en el código ni en el entorno. Un `admin` lo pone en la web:

- **Ajustes › Marca**: el nombre de la app (pestaña, acceso, emails y calendario), los colores
  (no se guarda un color que deje un texto sin contraste AA) y el logo (SVG, PNG o WebP de hasta
  200 KB). Va en `nucleo.db`, así que sale en la copia de las bases y se cambia sin redesplegar.
- **Ajustes › Empresa**: el nombre comercial (el de las tareas de Hermes y la memoria) y la zona
  horaria (península o Canarias: la de los avisos y la segunda hora de los plazos).
- **Ajustes › Fuentes y filtros › Escala de los rankings**: el territorio y la banda de importe
  con que se abren Competidores y Organismos.

Del entorno solo salen `APP_URL` (la dirección pública) y `APP_SOURCE_URL` (el enlace «Código
fuente», que pide la AGPL si has cambiado el código; vacío, el repositorio público). Comprueba
lo que recibe la web con `curl -s https://plataforma.example.com/api/config`.

## Perfiles de Hermes y permisos de los agentes

Un agente nuevo lee Licitaciones y la empresa y propone notas, pero **no ve Colaboradores (los CV)**: concédelo en
`permisos.json` solo a quien lo necesite. Los perfiles comparten contenedor y no son una frontera de seguridad
entre sí ([Seguridad](../como-esta-hecho/arquitectura.md#seguridad)). Si usas un modelo local en el propio servidor, suma
`deploy/docker-compose.llm-local.yml` (deja a Hermes alcanzar `host.docker.internal`).

Los tres perfiles, su modelo y su clave se explican en [Proveedor de IA](instalacion.md#proveedor-de-ia), y su operación,
en [Perfiles de Hermes](../operar/perfiles-de-hermes.md). Qué puede hacer cada agente por MCP se ajusta con un
`permisos.json` opcional; el formato y los permisos por defecto están en [Permisos](../referencia/mcp.md#permisos).

## Qué no se configura

- **El idioma.** La interfaz y los textos que genera la IA están en español, pensados para la contratación pública
  española.
- **La telemetría.** No existe: no hay nada que apagar.
