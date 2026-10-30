# Usuarios y recuperación de acceso

Cómo entra el primer administrador, cómo se da de alta al resto y qué hacer si nadie recuerda una contraseña. Lo que
puede hacer cada rol está en [Roles y permisos](../referencia/roles-y-permisos.md). Los comandos usan los atajos
`$DC`, `$MON` y `$HB` de [La instalación en producción](produccion.md#atajos-de-los-comandos).

Entra con `MONITOR_BASIC_AUTH_USERNAME` en el campo Email y `MONITOR_BASIC_AUTH_PASSWORD`: eres
el primer `admin` y la web te pide una contraseña tuya (12 caracteres o más). En **Ajustes ›
Usuarios y permisos**, edita tu fila con tu email y tu nombre, que firma lo que guardas. Da de
alta a cada persona con la contraseña temporal que propone la web y pásasela por un canal
distinto del email; la cambia al entrar. Roles: `admin` (todo, también precio, Empresa,
usuarios, Drive y Consola), `editor` (preparar ofertas, salvo el precio) y `lector` (ver).
Siempre queda al menos un `admin` activo.

**Contraseña del `.env`.** `MONITOR_BASIC_AUTH_*` solo sirve para el primer acceso. En cuanto algún
admin activo tiene contraseña propia (la que eligió él, no una temporal), la del `.env` deja de
entrar, también en las sesiones que hubiera abiertas con ella. Solo mientras ningún admin tenga la
suya (p. ej. si renombraste al primero antes de cambiarla) entra como «Acceso de emergencia», con
aviso en el log. Guardar el `.env` ya no es guardar una llave maestra.

**Recuperar el acceso.** Si nadie recuerda la contraseña de un admin, ejecuta dentro del contenedor
del monitor (hace falta acceso al servidor, no a la web):

```bash
$DC exec $MON node apps/server/dist/recuperarAcceso.js admin@example.com
```

Escribe una contraseña temporal por la terminal (no por el log). La web la pide cambiar al entrar y
las sesiones que ese admin tuviera se cierran. Solo vale para un admin activo; con cualquier otro
email falla sin tocar nada. Para un editor o un lector, entra con un admin y restablece su
contraseña en Ajustes › Usuarios. Si el `.env` se ha filtrado, cambia `MONITOR_BASIC_AUTH_PASSWORD`
y recrea el monitor (`$DC up -d $MON`): se cierran todas las sesiones.

```bash
$DC logs $MON | grep 'acceso de emergencia' | tail -5   # intentos con el login del .env
```

**Sesiones.** Se cierran tras 12 h sin uso o 7 días desde el login. Un despliegue no las cierra
mientras `MONITOR_SESSION_SECRET` no cambie: no lo regeneres. La línea del log con
`huella_secreto` debe repetir valor de un arranque a otro. El login se frena tras 10 fallos
desde una IP o 30 por minuto entre todas.
