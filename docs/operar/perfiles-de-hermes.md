# Perfiles de Hermes

Los perfiles de Hermes que usa la plataforma, qué hace cada uno y cómo crearlos o rehacerlos sin `install.sh`. Los
comandos usan los atajos `$DC`, `$MON` y `$HB` de [La instalación en
producción](produccion.md#atajos-de-los-comandos).

La plataforma encola los trabajos y los lanza en perfiles de Hermes por su API de runs. El modelo
de cada perfil se elige en Hermes (**Consola** → perfil → Model, o su `config.yaml`); todos
comparten el cupo del proveedor.

| Perfil | Hace | Variables |
|---|---|---|
| `licitaciones` | Criba, fichas, actas, CV y notas | `HERMES_LICITACIONES_URL` y `_KEY`. Sin ellas el radar descarga y filtra, y la IA espera |
| `oferta-licitaciones` | Guion, memoria, anexos y evaluación, con un modelo mejor | `HERMES_OFERTA_LICITACIONES_URL` y `_KEY`. Opcional: si no, lo hace `licitaciones` |
| `critico-licitaciones` | Crítico ciego de la memoria técnica, con otro modelo | `HERMES_OFERTA_CRITICO_URL` y `_KEY`. Opcional: si no, critica el de oferta y la web avisa |

**`install.sh` crea los tres perfiles** con su clave, el proveedor de IA y la conexión al MCP, sin pasos
manuales (`infra/perfiles.sh`, que corre dentro del contenedor de Hermes). Para repetirlo, o en un panel, sin
`install.sh`:

```bash
set -a; . ./.env; set +a     # las HERMES_*_KEY del .env
$DC exec -T -u hermes \
  -e HERMES_LICITACIONES_KEY -e HERMES_OFERTA_LICITACIONES_KEY -e HERMES_OFERTA_CRITICO_KEY \
  -e LLM_PROVEEDOR=anthropic -e LLM_API_KEY=… -e MODELO_LICITACIONES=claude-sonnet-5-5 \
  hermes sh -s < infra/perfiles.sh
$DC run --rm hermes-init          # token del perfil nuevo y permisos
$DC restart hermes                # ver «Reiniciar Hermes»
$DC exec hermes $HB -p licitaciones mcp test plataforma
```

Es idempotente: crea el perfil si no existe (con `hermes profile create --clone`), pone su `API_SERVER_KEY` si falta,
configura el proveedor y el modelo **solo mientras el perfil siga con el de fábrica** (`provider: auto`), y conecta el
MCP si no lo está. Lo que ya hubiera, incluido un modelo elegido luego en la Consola, no se pisa. `LLM_PROVEEDOR` es
`anthropic`, `openai` (`openai-api` en Hermes), `openrouter`, `local` (con `LLM_URL`) o `ninguno`. Sin clave en
una variable `HERMES_*_KEY`, ese perfil se salta. Lo prueba `infra/perfiles.test.sh` con la imagen real de Hermes.

Para hacerlo a mano (un perfil, aquí `licitaciones`; los otros, igual):

```bash
P=/opt/data/profiles/licitaciones
$DC exec hermes $HB profile create licitaciones --clone --no-alias --description "Criba y analiza licitaciones"
$DC exec hermes sed -i -E '/^(API_SERVER_KEY|PLATAFORMA_TOKEN)=/d' $P/.env   # fuera lo heredado
KEY=$(openssl rand -hex 32); echo "$KEY"                                        # HERMES_LICITACIONES_KEY
$DC exec hermes sh -c "printf 'API_SERVER_KEY=%s\n' '$KEY' >> $P/.env"
$DC exec hermes $HB config set multiplex_profiles true                          # los perfiles en /p/<perfil>
$DC exec hermes $HB -p licitaciones config set model.provider anthropic
$DC exec hermes $HB -p licitaciones config set model.default claude-sonnet-5-5
$DC exec hermes $HB -p licitaciones config set mcp_servers.plataforma.url http://hermes-monitor:3110/mcp
$DC exec hermes $HB -p licitaciones config set mcp_servers.plataforma.headers.Authorization 'Bearer ${PLATAFORMA_TOKEN}'
$DC exec hermes $HB -p licitaciones config set mcp_servers.plataforma.tools.include '[licitaciones_*, biblioteca_*, salidas_leer, colaboradores_*, competidores_*, organismos_*, plataforma_estado, plataforma_empresa]'
```

La clave del proveedor (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` u `OPENROUTER_API_KEY`) va en el `.env` del perfil.
La URL `http://hermes:8642/p/licitaciones` funciona porque el gateway principal sirve los perfiles
(`multiplex_profiles: true`). Deja `${PLATAFORMA_TOKEN}` tal cual: Hermes lo toma del `.env` del perfil, donde
`hermes-init` lo escribe. Pon la URL y la clave del perfil en las variables `HERMES_*_URL` y `HERMES_*_KEY`, y
aplica:

```bash
$DC run --rm hermes-init          # token del perfil nuevo y skills
$DC up -d $MON                    # variables nuevas
$DC restart hermes                # ver «Reiniciar Hermes»
$DC exec hermes $HB -p licitaciones mcp test plataforma
```

La criba compara cada licitación con el perfil de la empresa (**Ajustes › Empresa**) y con
`Conocimiento/Empresa/perfil-licitaciones.md`: rellénalos antes de juzgar los resultados.
