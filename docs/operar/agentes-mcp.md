# Agentes y tokens MCP

Cómo dar acceso a la plataforma a un agente por MCP: los tokens de los perfiles de Hermes y de otros agentes, sus
permisos y cómo conectar Claude Code u otro cliente. Los comandos usan los atajos `$DC`, `$MON` y `$HB` de [La
instalación en producción](produccion.md#atajos-de-los-comandos).

## Tokens de agente

- **Perfiles de Hermes:** `hermes-init` crea `/opt/data/.agentes/<perfil>.token` (y
  `hermes.token`, el del perfil principal) y lo añade como `PLATAFORMA_TOKEN` a su `.env` si no lo
  tiene. Están en el volumen de Hermes: identifican y limitan, pero Hermes podría leerlos.
- **Claude Code:** `AGENTE_TOKEN_CLAUDE_CODE` (32 caracteres o más).
- **Otro agente:** crea su archivo; el monitor relee los tokens cada 10 s.

  ```bash
  $DC exec -u 10000:10000 hermes sh -c 'umask 077; f=/opt/data/.agentes/mi-agente.token; head -c 32 /dev/urandom | od -An -tx1 | tr -d " \n" > $f; cat $f'
  ```

Por defecto, cualquier agente lee todo y propone notas; `hermes` propone en todos los dominios;
`licitaciones` y `oferta-licitaciones` proponen en licitaciones, Biblioteca, equipo y empresa;
`critico-licitaciones` solo ve licitaciones. Ningún agente aprueba: eso lo hacen el código y las
personas. Para cambiarlo, crea `/opt/data/.agentes/permisos.json` (dominios `biblioteca`,
`licitaciones`, `plataforma`, `colaboradores`; valores `leer`, `proponer`, `ninguno`). Mal escrito
se ignora entero (log: `permisos.json ignorado`); un dominio que no existe se ignora solo y el resto
vale (log: `permisos.json: dominios que no existen, ignorados`). Se aplica en un minuto; un perfil de Hermes ve
sus herramientas nuevas al reiniciar Hermes.

```json
{ "claude-code": { "licitaciones": "proponer" }, "mi-agente": { "colaboradores": "ninguno" } }
```

Cada llamada queda en la auditoría (agente, herramienta, recurso y resultado; nunca el
contenido), que lee `plataforma_actividad`. **Rotar un token:** borra su `.token` y la línea
`PLATAFORMA_TOKEN` de su `.env`, ejecuta `$DC run --rm hermes-init` y reinicia Hermes. Para
Claude Code, cambia la variable y recrea el monitor.

## Conectar Claude Code u otro agente

El MCP es Streamable HTTP en `/mcp`, con el token en la cabecera. Sirve cualquier cliente MCP que
admita cabeceras; `AGENTES_PETICIONES_MINUTO` (120) frena a un agente en bucle.

```bash
claude mcp add --transport http plataforma https://plataforma.example.com/mcp \
  --header "Authorization: Bearer <token>"
```
