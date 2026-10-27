# Política de seguridad

## Cómo avisar de una vulnerabilidad

**No abras una issue pública.** Avísanos en privado con el
[aviso privado de vulnerabilidades de GitHub](https://github.com/datagrowth/sobre-abierto/security/advisories/new)
(«Report a vulnerability» en la pestaña Security del repositorio).

Incluye lo que puedas: la versión (Ajustes › Acerca de), cómo reproducirlo y qué impacto crees que tiene. No
pegues claves ni datos de personas reales.

## Qué esperar

| Plazo | Qué hacemos |
|---|---|
| 3 días laborables | Acusamos recibo y te decimos quién lo lleva |
| 10 días laborables | Confirmamos si es una vulnerabilidad y su gravedad |
| 90 días como máximo | Publicamos el arreglo y el aviso, de acuerdo contigo; antes si es grave |

Te citamos en el aviso si quieres. Pedimos que no lo hagas público hasta que haya arreglo o pasen los 90 días.

## Qué versiones reciben arreglos

La última versión publicada. Mientras el proyecto esté en beta no se mantienen ramas anteriores: la corrección sale
en una versión nueva y se avisa en el [CHANGELOG](../CHANGELOG.md).

## Qué cuenta

Cuenta, por ejemplo: saltarse el login o los roles, leer o escribir datos de otra persona o empresa, ejecutar código
en el servidor, filtrar secretos o datos de CV, una inyección, o que un agente de IA haga algo que su perfil no
permite. No cuenta: la falta de una cabecera sin impacto demostrable, un fallo que exige ya tener acceso de
administrador, o la ausencia de HTTPS en una instalación que el propio operador dejó abierta sin él.

## Modelo de amenaza

Hermes lee documentos que no controlamos (pliegos, anexos, notas, web) y tiene terminal y red, así que una
inyección de prompt es el riesgo principal. Se mitiga con permisos mínimos por agente (los CV no van por defecto a
ninguno), herramientas que solo proponen, decisiones de personas y auditoría de cada llamada MCP. **Los perfiles de
Hermes no son una frontera de seguridad mientras compartan contenedor**, y su red de salida no está restringida:
si te importa, pon un cortafuegos de salida o un proxy en el servidor. Más en
[docs/arquitectura.md](../docs/arquitectura.md#seguridad).

Con `MONITOR_AUTH=off` no hay login y todo el que llegue al puerto es administrador (y usa la terminal de Hermes):
solo para un ordenador personal, nunca expuesto.

## Para quien instala

El instalador deja el monitor escuchando solo en `127.0.0.1` y genera claves aleatorias. Si lo abres a Internet,
hazlo con HTTPS (el override de Caddy lo trae), cambia la contraseña inicial en el primer acceso y no publiques el
puerto de Hermes (`9119`, `8642`): nunca hace falta fuera del Compose. Desde el primer cambio, la contraseña del
`.env` deja de entrar; si pierdes el acceso, el comando de
[docs/operacion.md](../docs/operacion.md#usuarios-y-recuperación-de-acceso) pone una temporal desde dentro del contenedor.
