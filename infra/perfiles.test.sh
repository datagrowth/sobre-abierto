#!/bin/sh
# Pruebas de perfiles.sh con la imagen real de Hermes (la orden `hermes` de verdad, no un doble):
# crea los tres perfiles, es idempotente y no pisa lo que ya hay. Necesita Docker y descarga la
# imagen (~4 GB) la primera vez. Uso: sh infra/perfiles.test.sh  (HERMES_IMAGE_TAG elige la versión).
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"
IMAGEN="nousresearch/hermes-agent:${HERMES_IMAGE_TAG:-v2026.9.24}"
export MSYS_NO_PATHCONV=1

fallos=0
pasa() { printf 'ok   %s\n' "$1"; }
falla() { printf 'FALLA %s\n' "$1"; fallos=$((fallos + 1)); }
cierto() { n="$1"; shift; if "$@"; then pasa "$n"; else falla "$n"; fi; }
falso() { n="$1"; shift; if "$@"; then falla "$n"; else pasa "$n"; fi; }

# Corre perfiles.sh y una comprobación en la misma sesión del contenedor; la carpeta de datos
# vive en un volumen que se conserva entre las dos pasadas.
VOL="perfiles-test-$$"
docker volume create "$VOL" > /dev/null
trap 'docker volume rm -f "$VOL" > /dev/null 2>&1' EXIT

dentro() {
  # $1 = guion a ejecutar tras perfiles.sh; el resto, el entorno del script.
  guion="$1"; shift
  docker run --rm --user 10000:10000 --entrypoint sh -e HERMES_HOME=/data \
    -v "$VOL:/data" -v "$AQUI/perfiles.sh:/perfiles.sh:ro" "$@" "$IMAGEN" -c "$guion" 2>&1 | grep -v 'PID 1'
}

# El volumen nuevo es de root: se le da al uid de Hermes antes de empezar.
docker run --rm --entrypoint sh -v "$VOL:/data" "$IMAGEN" -c 'chown 10000:10000 /data' > /dev/null 2>&1

# Hermes de fábrica trae un modelo y un proveedor «auto» con la URL de OpenRouter, y el clon lo hereda:
# se reproduce aquí antes de cada instalación nueva para que la prueba sea la de verdad.
de_fabrica="(/opt/hermes/.venv/bin/hermes config set model.default anthropic/claude-opus-4.6 && /opt/hermes/.venv/bin/hermes config set model.provider auto && /opt/hermes/.venv/bin/hermes config set model.base_url https://openrouter.ai/api/v1) > /dev/null 2>&1"

ENTORNO="-e HERMES_LICITACIONES_KEY=clave-lic -e HERMES_OFERTA_LICITACIONES_KEY=clave-ofe -e HERMES_OFERTA_CRITICO_KEY=clave-cri
  -e LLM_PROVEEDOR=anthropic -e LLM_API_KEY=sk-prueba -e MODELO_LICITACIONES=modelo-a -e MODELO_OFERTA=modelo-b -e MODELO_CRITICO=modelo-c"

# shellcheck disable=SC2086
salida1="$(dentro "$de_fabrica; sh /perfiles.sh" $ENTORNO)"
printf '%s\n' "$salida1" | grep -q 'perfil critico-licitaciones creado'; cierto should_create_the_three_profiles test $? -eq 0

verificar='
for p in licitaciones oferta-licitaciones critico-licitaciones; do
  d=/data/profiles/$p
  echo "== $p"; grep -c "^API_SERVER_KEY=" $d/.env; grep "^ANTHROPIC_API_KEY=" $d/.env | sed "s/=.*/=…/"
  /opt/hermes/.venv/bin/hermes -p $p config get model.default
  /opt/hermes/.venv/bin/hermes -p $p config get mcp_servers.plataforma.url
  grep -c "PLATAFORMA_TOKEN" $d/config.yaml
done
/opt/hermes/.venv/bin/hermes config get multiplex_profiles
grep "^API_SERVER_KEY=" /data/profiles/oferta-licitaciones/.env'
est1="$(dentro "$verificar")"
cierto should_give_each_profile_its_own_key sh -c "printf '%s\n' '$est1' | grep -q '^API_SERVER_KEY=clave-ofe$'"
cierto should_set_each_profile_its_model sh -c "printf '%s\n' '$est1' | grep -q '^modelo-a$' && printf '%s\n' '$est1' | grep -q '^modelo-b$' && printf '%s\n' '$est1' | grep -q '^modelo-c$'"
cierto should_write_the_provider_key_in_the_profile_env sh -c "printf '%s\n' '$est1' | grep -q '^ANTHROPIC_API_KEY=…$'"
cierto should_connect_the_monitor_mcp sh -c "printf '%s\n' '$est1' | grep -q 'http://hermes-monitor:3110/mcp'"
cierto should_serve_the_profiles_from_the_main_gateway sh -c "printf '%s\n' '$est1' | grep -qi '^true$'"
# Ni la clave del proveedor ni el token van a config.yaml: están en el .env del perfil.
fuga="$(dentro 'grep -l -E "sk-prueba|clave-lic" /data/profiles/*/config.yaml /data/config.yaml; true')"
cierto should_keep_secrets_out_of_config_yaml test -z "$fuga"

# Segunda pasada con otros valores: no cambia nada de lo que ya existía.
# shellcheck disable=SC2086
salida2="$(dentro 'sh /perfiles.sh' -e HERMES_LICITACIONES_KEY=otra -e HERMES_OFERTA_LICITACIONES_KEY=otra -e HERMES_OFERTA_CRITICO_KEY=otra \
  -e LLM_PROVEEDOR=anthropic -e LLM_API_KEY=otra -e MODELO_LICITACIONES=otro -e MODELO_OFERTA=otro -e MODELO_CRITICO=otro)"
falso should_not_recreate_existing_profiles sh -c "printf '%s\n' '$salida2' | grep -q 'creado'"
est2="$(dentro "$verificar")"
cierto should_not_overwrite_keys_or_models_on_a_second_run test "$est1" = "$est2"

# Un perfil cuyo proveedor se cambió luego a mano no se vuelve a tocar.
dentro '/opt/hermes/.venv/bin/hermes -p licitaciones config set model.provider openrouter > /dev/null; /opt/hermes/.venv/bin/hermes -p licitaciones config set model.default elegido-a-mano > /dev/null' > /dev/null
dentro 'sh /perfiles.sh' $ENTORNO > /dev/null
cierto should_not_overwrite_a_provider_chosen_in_the_console test "$(dentro '/opt/hermes/.venv/bin/hermes -p licitaciones config get model.default')" = elegido-a-mano

# Sin proveedor: crea los perfiles y el MCP, y deja el modelo para Hermes.
docker volume rm -f "$VOL" > /dev/null 2>&1; docker volume create "$VOL" > /dev/null
docker run --rm --entrypoint sh -v "$VOL:/data" "$IMAGEN" -c 'chown 10000:10000 /data' > /dev/null 2>&1
salida3="$(dentro "$de_fabrica; sh /perfiles.sh" -e HERMES_LICITACIONES_KEY=k)"
cierto should_create_a_profile_without_a_provider sh -c "printf '%s\n' '$salida3' | grep -q 'perfil licitaciones creado'"
falso should_not_set_a_model_without_a_provider sh -c "printf '%s\n' '$salida3' | grep -q 'modelo'"
cierto should_skip_profiles_without_a_key sh -c "printf '%s\n' '$salida3' | grep -q 'perfil oferta-licitaciones: sin clave'"

# Un proveedor que no existe falla antes de tocar nada.
salida4="$(dentro 'sh /perfiles.sh' -e LLM_PROVEEDOR=inventado)"
cierto should_reject_an_unknown_provider sh -c "printf '%s
' '$salida4' | grep -q 'LLM_PROVEEDOR no válido'"

[ "$fallos" -eq 0 ] && echo "todas las pruebas pasan" || { echo "$fallos pruebas fallidas"; exit 1; }
