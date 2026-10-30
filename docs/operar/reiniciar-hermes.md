# Reiniciar Hermes

Cuándo hay que reiniciar Hermes y cómo hacerlo sin cortar trabajos a medias. Los comandos usan los atajos `$DC`,
`$MON` y `$HB` de [La instalación en producción](produccion.md#atajos-de-los-comandos).

Hermes carga sus skills y la lista de herramientas del MCP solo al arrancar. Reinícialo tras
actualizar a una versión que cambie herramientas o skills, tras crear un perfil o cambiar su
modelo, `config.yaml` o `.env`, y tras cambiar sus permisos. Si no, los trabajos de los perfiles
afectados esperan con «Hermes tiene la lista de herramientas de antes del despliegue»
(`herramientas_desfasadas`), sin gastar intentos ni cupo. Cambiar solo variables del monitor no
lo pide: basta `$DC up -d $MON`.

1. **Con la cola quieta.** Cada reinicio mata los runs en curso de todos los perfiles: comprueba
   en la pastilla **Hermes** o en **Ajustes › Hermes** que no haya nada en marcha, y no lo hagas
   cerca de un plazo de presentación.
2. Reinicia: `$DC restart hermes` y mira `$DC logs --tail 50 hermes`.
3. Lo que esperaba sale solo en la siguiente vuelta de la cola (30 s).

No lo sustituyas por `hermes -p <perfil> mcp test`: pide la lista con el mismo token y la cola la
da por cargada aunque el gateway siga con la vieja. Un run cortado por el reinicio se reintenta a
los 10 minutos.
