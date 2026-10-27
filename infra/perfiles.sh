#!/bin/sh
# Crea y configura los tres perfiles de Hermes de la plataforma (licitaciones, oferta-licitaciones y
# critico-licitaciones): cada uno con su API_SERVER_KEY, el proveedor de LLM y el MCP del monitor.
# Corre DENTRO del contenedor de Hermes, que es el que trae la orden `hermes`:
#   docker compose exec -T -u hermes -e VAR=… hermes sh -s < infra/perfiles.sh
# install.sh lo hace al instalar. Es idempotente y nunca pisa lo que ya hay: un perfil que existe
# conserva su modelo, su clave y su MCP; solo se completa lo que falta. Después de la primera vez
# hay que correr `docker compose run --rm hermes-init` (token de cada perfil) y reiniciar Hermes.
#
# Entorno (todo opcional salvo las claves, que son las HERMES_*_KEY del .env):
#   HERMES_LICITACIONES_KEY, HERMES_OFERTA_LICITACIONES_KEY, HERMES_OFERTA_CRITICO_KEY
#   LLM_PROVEEDOR  anthropic | openai | openrouter | local | ninguno (por defecto: ninguno)
#   LLM_API_KEY    la clave del proveedor (no hace falta con local)
#   LLM_URL        la dirección de un servidor compatible con OpenAI (solo con local)
#   MODELO_LICITACIONES, MODELO_OFERTA, MODELO_CRITICO   el modelo de cada perfil
#   MONITOR_MCP_URL  por defecto http://hermes-monitor:3110/mcp
set -eu

HB="${HB:-/opt/hermes/.venv/bin/hermes}"
DATA="${HERMES_HOME:-/opt/data}"
MCP_URL="${MONITOR_MCP_URL:-http://hermes-monitor:3110/mcp}"
PROVEEDOR="${LLM_PROVEEDOR:-ninguno}"
TOOLS='[licitaciones_*, biblioteca_*, salidas_leer, colaboradores_*, competidores_*, organismos_*, plataforma_estado, plataforma_empresa]'

# Nombre del proveedor en Hermes y la variable de su .env donde va la clave.
case "$PROVEEDOR" in
  anthropic)  HERMES_PROVEEDOR=anthropic;  VAR_CLAVE=ANTHROPIC_API_KEY ;;
  openai)     HERMES_PROVEEDOR=openai-api; VAR_CLAVE=OPENAI_API_KEY ;;
  openrouter) HERMES_PROVEEDOR=openrouter; VAR_CLAVE=OPENROUTER_API_KEY ;;
  local)      HERMES_PROVEEDOR=custom;     VAR_CLAVE= ;;
  ninguno)    HERMES_PROVEEDOR=;           VAR_CLAVE= ;;
  *) echo "LLM_PROVEEDOR no válido: $PROVEEDOR (anthropic, openai, openrouter, local o ninguno)" >&2; exit 2 ;;
esac

hermes() { "$HB" "$@"; }

# Valor de una clave de config.yaml del perfil, vacío si no está puesta.
valor() { hermes -p "$1" config get "$2" 2>/dev/null || true; }

# Añade VAR=valor al .env del perfil solo si no hay ya una línea para VAR.
poner_env() {
  env_file="$DATA/profiles/$1/.env"
  grep -q "^$2=" "$env_file" && return 0
  [ -s "$env_file" ] && [ "$(tail -c 1 "$env_file")" != "" ] && echo >> "$env_file"
  printf '%s=%s\n' "$2" "$3" >> "$env_file"
  chmod 600 "$env_file"
}

# El clon hereda el .env de Hermes, con su API_SERVER_KEY y su PLATAFORMA_TOKEN: son del principal.
quitar_heredado() {
  env_file="$DATA/profiles/$1/.env"
  grep -v -E '^(API_SERVER_KEY|PLATAFORMA_TOKEN)=' "$env_file" > "$env_file.tmp" || true
  cat "$env_file.tmp" > "$env_file"
  rm -f "$env_file.tmp"
}

perfil() {
  nombre="$1"; clave="$2"; modelo="$3"; descripcion="$4"
  if [ -z "$clave" ]; then
    echo "perfil $nombre: sin clave (define su HERMES_*_KEY); se salta" >&2
    return 0
  fi
  if [ ! -d "$DATA/profiles/$nombre" ]; then
    hermes profile create "$nombre" --clone --no-alias --description "$descripcion" > /dev/null
    quitar_heredado "$nombre"
    echo "perfil $nombre creado"
  fi
  poner_env "$nombre" API_SERVER_KEY "$clave"

  # Hermes trae un modelo por defecto (provider «auto»): solo se configura el proveedor mientras siga así,
  # para no pisar el que alguien eligiera luego en la Consola.
  sin_elegir=0
  case "$(valor "$nombre" model.provider)" in '' | auto) sin_elegir=1 ;; esac
  if [ -n "$HERMES_PROVEEDOR" ] && [ "$sin_elegir" = 1 ]; then
    [ -n "$modelo" ] || { echo "perfil $nombre: falta el modelo (MODELO_*)" >&2; return 1; }
    hermes -p "$nombre" config set model.provider "$HERMES_PROVEEDOR" > /dev/null
    hermes -p "$nombre" config set model.default "$modelo" > /dev/null
    [ "$PROVEEDOR" = local ] && hermes -p "$nombre" config set model.base_url "${LLM_URL:?Con local hace falta LLM_URL}" > /dev/null
    [ -n "$VAR_CLAVE" ] && [ -n "${LLM_API_KEY:-}" ] && poner_env "$nombre" "$VAR_CLAVE" "$LLM_API_KEY"
    echo "perfil $nombre: modelo $modelo ($PROVEEDOR)"
  fi

  if [ -z "$(valor "$nombre" mcp_servers.plataforma.url)" ]; then
    hermes -p "$nombre" config set mcp_servers.plataforma.url "$MCP_URL" > /dev/null
    # El token no se escribe aquí: Hermes lo toma del PLATAFORMA_TOKEN del .env del perfil.
    hermes -p "$nombre" config set mcp_servers.plataforma.headers.Authorization 'Bearer ${PLATAFORMA_TOKEN}' > /dev/null
    hermes -p "$nombre" config set mcp_servers.plataforma.tools.include "$TOOLS" > /dev/null
    echo "perfil $nombre: MCP de la plataforma conectado"
  fi
}

# El gateway principal sirve los perfiles en /p/<perfil> (la URL de HERMES_*_URL).
case "$(hermes config get multiplex_profiles 2>/dev/null || true)" in
  [Tt]rue) ;;
  *) hermes config set multiplex_profiles true > /dev/null; echo "multiplex_profiles activado" ;;
esac

perfil licitaciones "${HERMES_LICITACIONES_KEY:-}" "${MODELO_LICITACIONES:-}" "Criba y analiza licitaciones"
perfil oferta-licitaciones "${HERMES_OFERTA_LICITACIONES_KEY:-}" "${MODELO_OFERTA:-}" "Prepara ofertas: guion, memoria, anexos y evaluación"
perfil critico-licitaciones "${HERMES_OFERTA_CRITICO_KEY:-}" "${MODELO_CRITICO:-}" "Crítico ciego de la memoria técnica"
