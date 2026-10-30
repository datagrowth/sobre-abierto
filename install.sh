#!/usr/bin/env bash
# Instala Sobre Abierto en un servidor con Docker: genera el .env con sus claves, arranca la
# plataforma, crea los perfiles de Hermes y espera a que responda. Léelo antes de ejecutarlo.
#
#   curl -fsSLO https://raw.githubusercontent.com/datagrowth/sobre-abierto/main/install.sh
#   less install.sh && bash install.sh
#
# Se puede ejecutar otra vez: nunca sobrescribe un valor que ya esté en el .env.
#
# Variables (todas opcionales; si falta alguna y hay terminal, las pregunta):
#   ADMIN_EMAIL           correo del primer administrador (es su usuario)
#   DOMINIO               dominio con HTTPS automático (Caddy); sin él, solo http://localhost
#   LLM_PROVEEDOR         anthropic | openai | openrouter | local | ninguno
#   LLM_API_KEY           clave del proveedor (no hace falta con local)
#   LLM_URL               servidor compatible con OpenAI (solo con local)
#   MODELO_LICITACIONES, MODELO_OFERTA, MODELO_CRITICO   modelo de cada perfil de Hermes
#   SOBRE_ABIERTO_VERSION versión de las imágenes (latest por defecto)
#   DRIVE=1               arranca también drive-sync (Google Drive)
# Opciones:
#   --actualizar  vuelve a bajar los archivos de la instalación (Compose, .env.example, este script) de la
#                 versión que diga SOBRE_ABIERTO_VERSION y sigue como siempre. No toca el .env.
#   --solo-env    genera el .env y termina, sin tocar Docker.
#   --ayuda       esta ayuda.
set -euo pipefail

# Git Bash en Windows convierte «/opt/hermes/…» en una ruta de Windows y rompe las órdenes dentro de los contenedores.
export MSYS_NO_PATHCONV=1

RAW_BASE="${SOBRE_ABIERTO_RAW:-https://raw.githubusercontent.com/datagrowth/sobre-abierto}"
API_BASE="${SOBRE_ABIERTO_API:-https://api.github.com/repos/datagrowth/sobre-abierto}"
RELEASES_BASE="${SOBRE_ABIERTO_RELEASES:-https://github.com/datagrowth/sobre-abierto/releases/download}"
ARCHIVOS="docker-compose.yml deploy/docker-compose.caddy.yml deploy/docker-compose.llm-local.yml .env.example infra/perfiles.sh install.sh"

msg() { printf '%s\n' "$*"; }
aviso() { printf 'AVISO: %s\n' "$*" >&2; }
fallo() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

SOLO_ENV=0
ACTUALIZAR=0
for arg in "$@"; do
  case "$arg" in
    --solo-env) SOLO_ENV=1 ;;
    --actualizar) ACTUALIZAR=1 ;;
    --ayuda | -h) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) fallo "opción desconocida: $arg (prueba --ayuda)" ;;
  esac
done

# ─── Dónde se instala ────────────────────────────────────────────────────────
# Junto al script si ya están los archivos (clon del repo); si no, descargados en ./sobre-abierto.
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$AQUI/docker-compose.yml" ] && [ -f "$AQUI/.env.example" ]; then
  RAIZ="$AQUI"
else
  RAIZ="$PWD/sobre-abierto"
fi

# Etiqueta de la última release («v0.1.0»), o vacío si no hay ninguna o no se llega a GitHub.
ultima_release() {
  curl -fsSL "$API_BASE/releases/latest" 2> /dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1 || true
}

hay_todos_los_archivos() {
  local f
  for f in $ARCHIVOS; do [ -f "$RAIZ/$f" ] || return 1; done
}

# Baja los archivos de la instalación si faltan (o con --actualizar). Con «latest» usa los de la última
# release, que son los que casan con las imágenes `latest`; main solo si aún no hay ninguna. Descarga
# todo a archivos .nuevo y los coloca al final: un fallo a medias no deja una instalación a medias.
descargar_archivos() {
  if [ "$ACTUALIZAR" = 0 ] && hay_todos_los_archivos; then return 0; fi
  [ ! -d "$RAIZ/.git" ] || fallo "$RAIZ es un clon de git: actualiza con «git pull»."
  command -v curl > /dev/null || fallo "hace falta curl para descargar los archivos de la instalación"
  local version ref f
  version="${SOBRE_ABIERTO_VERSION:-$(valor_env SOBRE_ABIERTO_VERSION)}"
  version="${version:-latest}"
  if [ "$version" = latest ]; then
    ref="$(ultima_release)"
    if [ -n "$ref" ]; then VERSION_FIJADA="${ref#v}"
    else ref="main"; aviso "Aún no hay ninguna release publicada: uso la rama main (puede no casar con las imágenes latest)."; fi
  else
    ref="v${version#v}"
    VERSION_FIJADA="${version#v}"
  fi
  msg "Descargando los archivos de la instalación ($ref) en $RAIZ…"
  for f in $ARCHIVOS; do
    mkdir -p "$RAIZ/$(dirname "$f")"
    # Ruta relativa: el curl de Git Bash en Windows no entiende las rutas /tmp o /home de MSYS.
    (cd "$RAIZ" && curl -fsSL "$RAW_BASE/$ref/$f" -o "$f.nuevo") || { rm -f "$RAIZ"/*.nuevo "$RAIZ"/infra/*.nuevo "$RAIZ"/deploy/*.nuevo; fallo "no se pudo descargar $f de $RAW_BASE/$ref"; }
  done
  verificar_sumas "$ref"
  for f in $ARCHIVOS; do mv -f "$RAIZ/$f.nuevo" "$RAIZ/$f"; done
}

# Compara los archivos descargados con el SHA256SUMS que la release publica como asset (otro canal que
# la rama): un archivo cambiado después de publicarla no pasa. Una release anterior a este control, o
# main, no lo trae: se avisa y se sigue.
verificar_sumas() {
  local ref="$1" sumas="$RAIZ/SHA256SUMS.nuevo" f esperado real
  if [ "$ref" = main ] || ! (cd "$RAIZ" && curl -fsSL "$RELEASES_BASE/$ref/SHA256SUMS" -o SHA256SUMS.nuevo) 2> /dev/null; then
    rm -f "$sumas"
    aviso "No hay SHA256SUMS para $ref: no se pudo verificar lo descargado."
    return 0
  fi
  for f in $ARCHIVOS; do
    esperado="$(awk -v f="$f" '$2 == f || $2 == "*" f {print $1}' "$sumas")"
    real="$(sha256sum "$RAIZ/$f.nuevo" 2> /dev/null | awk '{print $1}')"
    [ -n "$real" ] || real="$(shasum -a 256 "$RAIZ/$f.nuevo" | awk '{print $1}')"
    if [ -z "$esperado" ] || [ "$esperado" != "$real" ]; then
      rm -f "$RAIZ"/*.nuevo "$RAIZ"/infra/*.nuevo "$RAIZ"/deploy/*.nuevo
      fallo "$f no coincide con el SHA256SUMS de la release $ref: no se instala."
    fi
  done
  rm -f "$sumas"
}

# ─── Requisitos ──────────────────────────────────────────────────────────────
puerto_ocupado() { (exec 3<> "/dev/tcp/127.0.0.1/$1") 2> /dev/null; }

comprobar_requisitos() {
  command -v docker > /dev/null || fallo "Docker no está instalado. Instálalo: https://docs.docker.com/engine/install/"
  docker info > /dev/null 2>&1 || fallo "Docker está instalado pero no responde: ¿el servicio está arrancado y tu usuario está en el grupo docker (o usas sudo)?"
  docker compose version > /dev/null 2>&1 || fallo "Hace falta Docker Compose v2 (la orden «docker compose», no «docker-compose»)."
  case "$(uname -m)" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) fallo "Arquitectura no soportada: $(uname -m). Las imágenes son amd64 y arm64." ;;
  esac
  if [ -r /proc/meminfo ]; then
    local kb
    kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
    [ "${kb:-0}" -ge 6000000 ] || aviso "Tiene menos de 6 GB de memoria; se recomiendan 8 GB (Hermes y el monitor reservan hasta 7 GB entre los dos)."
  fi
}

comprobar_puertos() {
  # Con la plataforma ya arrancada los puertos son suyos: solo se comprueban en una instalación nueva.
  if [ -n "$(compose ps -q 2> /dev/null)" ]; then return 0; fi
  local p puerto
  # El puerto que usará el Compose: el del entorno, si no el del .env y, si no, el de fábrica.
  puerto="${MONITOR_PUERTO:-$(valor_env MONITOR_PUERTO)}"
  for p in "${puerto:-3110}" $([ -n "${DOMINIO:-}" ] && echo "80 443"); do
    if puerto_ocupado "$p"; then fallo "El puerto $p ya está en uso. Libéralo o cambia MONITOR_PUERTO en el .env."; fi
  done
}

# ─── .env ────────────────────────────────────────────────────────────────────
ENV_FILE="$RAIZ/.env"

secreto() {
  if command -v openssl > /dev/null; then openssl rand -hex "$1"
  else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# Valor actual de una variable del .env ("" si no está o está vacía).
valor_env() { [ -f "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | head -n 1 || true; }

# Pone VAR=valor solo si la variable no tiene ya un valor: rellena «VAR=» vacía, sustituye «# VAR=»
# comentada o la añade al final; una que ya tiene valor no se toca nunca.
poner_si_falta() {
  local var="$1" valor="$2"
  [ -n "$(valor_env "$var")" ] && return 0
  local tmp="$ENV_FILE.tmp"
  VAR="$var" VALOR="$valor" awk '
    BEGIN { v = ENVIRON["VAR"]; val = ENVIRON["VALOR"]; hecho = 0 }
    !hecho && ($0 == v "=" || index($0, "# " v "=") == 1) { print v "=" val; hecho = 1; next }
    { print }
    END { if (!hecho) print v "=" val }
  ' "$ENV_FILE" > "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# Pregunta por la terminal si la hay; si no, usa el valor por defecto (que puede ser vacío).
INTERACTIVO=0
[ -t 0 ] && [ -t 1 ] && INTERACTIVO=1
preguntar() {
  local texto="$1" defecto="${2:-}" r=""
  if [ "$INTERACTIVO" = 1 ]; then
    read -r -p "$texto${defecto:+ [$defecto]}: " r || true
  fi
  printf '%s' "${r:-$defecto}"
}

correo_valido() { [[ "$1" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; }

preparar_env() {
  local nuevo=0
  if [ ! -f "$ENV_FILE" ]; then
    (umask 077 && cp "$RAIZ/.env.example" "$ENV_FILE")
    nuevo=1
  fi
  chmod 600 "$ENV_FILE"

  # Lo que ya está en el .env manda sobre la variable: el administrador no cambia al repetir la instalación.
  local indicado="${ADMIN_EMAIL:-}"
  ADMIN_EMAIL="$(valor_env MONITOR_BASIC_AUTH_USERNAME)"
  [ -n "$ADMIN_EMAIL" ] || ADMIN_EMAIL="$indicado"
  if [ -z "$ADMIN_EMAIL" ]; then ADMIN_EMAIL="$(preguntar 'Correo del primer administrador')"; fi
  correo_valido "$ADMIN_EMAIL" || fallo "Falta un correo válido para el administrador: ADMIN_EMAIL=tu@correo.es bash install.sh"

  DOMINIO="${DOMINIO:-$(valor_env DOMINIO)}"
  if [ "$nuevo" = 1 ] && [ -z "$DOMINIO" ]; then DOMINIO="$(preguntar 'Dominio con HTTPS (vacío = solo en este servidor, sin HTTPS)')"; fi
  [[ -z "$DOMINIO" || "$DOMINIO" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || fallo "DOMINIO no válido: $DOMINIO"

  # Las contraseñas generadas se enseñan al final solo si son de esta ejecución.
  CONTRASENA_NUEVA=""
  if [ -z "$(valor_env MONITOR_BASIC_AUTH_PASSWORD)" ]; then CONTRASENA_NUEVA="$(secreto 12)"; fi

  poner_si_falta HERMES_DASHBOARD_BASIC_AUTH_USERNAME hermes
  poner_si_falta HERMES_DASHBOARD_BASIC_AUTH_PASSWORD "$(secreto 16)"
  poner_si_falta HERMES_DASHBOARD_BASIC_AUTH_SECRET "$(secreto 32)"
  poner_si_falta API_SERVER_KEY "$(secreto 32)"
  poner_si_falta HERMES_LICITACIONES_URL "http://hermes:8642/p/licitaciones"
  poner_si_falta HERMES_LICITACIONES_KEY "$(secreto 32)"
  poner_si_falta HERMES_OFERTA_LICITACIONES_URL "http://hermes:8642/p/oferta-licitaciones"
  poner_si_falta HERMES_OFERTA_LICITACIONES_KEY "$(secreto 32)"
  poner_si_falta HERMES_OFERTA_CRITICO_URL "http://hermes:8642/p/critico-licitaciones"
  poner_si_falta HERMES_OFERTA_CRITICO_KEY "$(secreto 32)"
  poner_si_falta MONITOR_BASIC_AUTH_USERNAME "$ADMIN_EMAIL"
  [ -n "$CONTRASENA_NUEVA" ] && poner_si_falta MONITOR_BASIC_AUTH_PASSWORD "$CONTRASENA_NUEVA"
  poner_si_falta MONITOR_SESSION_SECRET "$(secreto 32)"
  # Las imágenes se quedan en la versión de los archivos descargados: «latest» las movería sin avisar.
  if [ -n "${VERSION_FIJADA:-}" ]; then poner_si_falta SOBRE_ABIERTO_VERSION "$VERSION_FIJADA"; fi
  if [ -n "$DOMINIO" ]; then
    poner_si_falta DOMINIO "$DOMINIO"
    # Para que `docker compose up -d` a secas siga usando Caddy; el separador explícito evita
    # que Docker en Windows espere «;».
    poner_si_falta COMPOSE_PATH_SEPARATOR ":"
    poner_si_falta COMPOSE_FILE "docker-compose.yml:deploy/docker-compose.caddy.yml"
  fi
  if [ "${DRIVE:-0}" = 1 ]; then poner_si_falta COMPOSE_PROFILES drive; fi
  return 0
}

# ─── Docker ──────────────────────────────────────────────────────────────────
# Siempre desde la carpeta de la instalación y con el .env que acabamos de preparar.
compose() { (cd "$RAIZ" && docker compose "$@"); }

esperar_monitor() {
  local id estado i
  msg "Esperando a que el monitor responda (la primera vez puede tardar un par de minutos)…"
  for i in $(seq 1 90); do
    id="$(compose ps -q monitor 2> /dev/null || true)"
    estado=""
    [ -n "$id" ] && estado="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2> /dev/null || true)"
    [ "$estado" = healthy ] && return 0
    sleep 2
  done
  compose logs --tail 40 monitor >&2 || true
  fallo "El monitor no llegó a estar sano en 3 minutos. Los últimos registros están arriba."
}

esperar_hermes() {
  local i
  for i in $(seq 1 60); do
    compose exec -T hermes true > /dev/null 2>&1 && return 0
    sleep 2
  done
  fallo "El contenedor de Hermes no arrancó. Mira: docker compose logs hermes"
}

# Perfiles de Hermes (licitaciones, oferta-licitaciones y critico-licitaciones) con su clave, el
# proveedor de LLM y el MCP de la plataforma. Las claves salen del .env.
crear_perfiles() {
  local proveedor="${LLM_PROVEEDOR:-}" modelo_por_defecto=""
  if [ -z "$proveedor" ]; then
    proveedor="$(preguntar 'Proveedor de IA para Hermes (anthropic, openai, openrouter, local o ninguno)' ninguno)"
  fi
  case "$proveedor" in
    anthropic | openai | openrouter | local | ninguno) ;;
    *) fallo "LLM_PROVEEDOR no válido: $proveedor (anthropic, openai, openrouter, local o ninguno)" ;;
  esac

  if [ "$proveedor" != ninguno ]; then
    [ "$proveedor" = anthropic ] && modelo_por_defecto="claude-sonnet-5-5"
    if [ "$proveedor" != local ] && [ -z "${LLM_API_KEY:-}" ]; then
      if [ "$INTERACTIVO" = 1 ]; then read -r -s -p "Clave de API de $proveedor (no se ve al escribir): " LLM_API_KEY || true; echo; fi
      [ -n "${LLM_API_KEY:-}" ] || fallo "Falta la clave de $proveedor: LLM_API_KEY=… bash install.sh (o LLM_PROVEEDOR=ninguno para ponerla luego en Hermes)"
    fi
    MODELO_LICITACIONES="${MODELO_LICITACIONES:-$(preguntar 'Modelo para la criba y las fichas' "$modelo_por_defecto")}"
    [ -n "$MODELO_LICITACIONES" ] || fallo "Falta el modelo: MODELO_LICITACIONES=… bash install.sh"
    # Oferta y crítico: el de la criba si no se indica otro, aunque lo ideal es un modelo mejor para la oferta y
    # uno de otra familia para el crítico (docs/empezar/instalacion.md, «Proveedor de IA»): con terminal se preguntan.
    MODELO_OFERTA="${MODELO_OFERTA:-$(preguntar 'Modelo para la memoria de la oferta (el mejor que puedas pagar)' "$MODELO_LICITACIONES")}"
    MODELO_CRITICO="${MODELO_CRITICO:-$(preguntar 'Modelo del crítico (de otra familia que el de la oferta)' "$MODELO_OFERTA")}"
    if [ "$proveedor" = local ]; then
      LLM_URL="${LLM_URL:-$(preguntar 'URL del servidor local compatible con OpenAI' 'http://host.docker.internal:11434/v1')}"
      aviso "Para que Hermes alcance un modelo del propio servidor, suma deploy/docker-compose.llm-local.yml (ver ese archivo): deja a Hermes llegar a los servicios del host."
    fi
  fi

  esperar_hermes
  msg "Creando los perfiles de Hermes…"
  local cambios
  cambios="$(
    export HERMES_LICITACIONES_KEY="$(valor_env HERMES_LICITACIONES_KEY)"
    export HERMES_OFERTA_LICITACIONES_KEY="$(valor_env HERMES_OFERTA_LICITACIONES_KEY)"
    export HERMES_OFERTA_CRITICO_KEY="$(valor_env HERMES_OFERTA_CRITICO_KEY)"
    export LLM_PROVEEDOR="$proveedor" LLM_API_KEY="${LLM_API_KEY:-}" LLM_URL="${LLM_URL:-}"
    export MODELO_LICITACIONES="${MODELO_LICITACIONES:-}" MODELO_OFERTA="${MODELO_OFERTA:-}" MODELO_CRITICO="${MODELO_CRITICO:-}"
    compose exec -T -u hermes \
      -e HERMES_LICITACIONES_KEY -e HERMES_OFERTA_LICITACIONES_KEY -e HERMES_OFERTA_CRITICO_KEY \
      -e LLM_PROVEEDOR -e LLM_API_KEY -e LLM_URL -e MODELO_LICITACIONES -e MODELO_OFERTA -e MODELO_CRITICO \
      hermes sh -s < "$RAIZ/infra/perfiles.sh"
  )"
  [ -n "$cambios" ] && msg "$cambios"

  # Token de cada perfil nuevo, permisos, y Hermes reiniciado para servir los perfiles. Solo si algo
  # cambió: reiniciar Hermes mata los runs en curso y una instalación repetida no debe hacerlo.
  if [ -n "$cambios" ]; then
    compose run --rm hermes-init > /dev/null
    compose restart hermes > /dev/null
  fi
  PROVEEDOR_ELEGIDO="$proveedor"
}

# Hermes (ya reiniciado) llega al MCP del monitor con el token de un perfil. Un fallo aquí no
# deshace nada: se avisa y se sigue, porque Hermes puede tardar en estar listo.
comprobar_mcp() {
  local i
  msg "Comprobando que Hermes llega a la plataforma…"
  for i in $(seq 1 15); do
    if compose exec -T -u hermes hermes /opt/hermes/.venv/bin/hermes -p licitaciones mcp test plataforma > /dev/null 2>&1; then
      msg "  Hermes conectado."; return 0
    fi
    sleep 4
  done
  aviso "Hermes aún no llega al MCP de la plataforma. Revisa: docker compose exec hermes /opt/hermes/.venv/bin/hermes -p licitaciones mcp test plataforma"
}

resumen() {
  local url puerto
  puerto="$(valor_env MONITOR_PUERTO)"
  if [ -n "$DOMINIO" ]; then url="https://$DOMINIO"; else url="http://localhost:${puerto:-3110}"; fi
  msg ""
  msg "Sobre Abierto está en marcha."
  msg "  Dirección:   $url"
  [ -z "$DOMINIO" ] && msg "  (Solo escucha en este servidor. Desde tu ordenador: ssh -L ${puerto:-3110}:127.0.0.1:${puerto:-3110} usuario@servidor)"
  msg "  Usuario:     $ADMIN_EMAIL"
  if [ -n "$CONTRASENA_NUEVA" ]; then
    msg "  Contraseña:  la inicial está en MONITOR_BASIC_AUTH_PASSWORD de $ENV_FILE (te pedirá cambiarla al entrar)"
    msg "               Es solo la inicial: cuando un administrador elija la suya, la de $ENV_FILE deja de entrar."
    msg "               Si luego pierdes el acceso: docker compose exec monitor node apps/server/dist/recuperarAcceso.js $ADMIN_EMAIL"
  else
    msg "  Contraseña:  la que ya tenías (si nunca la cambiaste, MONITOR_BASIC_AUTH_PASSWORD en $ENV_FILE; si ya la cambiaste, la tuya)"
  fi
  if [ "${PROVEEDOR_ELEGIDO:-ninguno}" = ninguno ]; then
    msg ""
    msg "Falta elegir el modelo de IA: abre Ajustes › Hermes, o vuelve a ejecutar con LLM_PROVEEDOR=… (docs/empezar/instalacion.md, «Proveedor de IA»)."
  elif [ -n "${MODELO_CRITICO:-}" ] && [ "${MODELO_CRITICO:-}" = "${MODELO_OFERTA:-}" ]; then
    msg ""
    msg "El crítico usa el mismo modelo que la oferta y tiende a darse buena nota: pon otro, de otra familia, en"
    msg "Ajustes › Hermes (docs/empezar/instalacion.md, «Proveedor de IA»)."
  fi
  msg ""
  msg "Guarda el archivo $ENV_FILE: lleva las claves. Siguiente paso: completa el perfil de tu empresa en Ajustes › Empresa."
}

main() {
  descargar_archivos
  [ -f "$RAIZ/.env.example" ] || fallo "No encuentro .env.example en $RAIZ"
  if [ "$SOLO_ENV" = 0 ]; then comprobar_requisitos; fi
  preparar_env
  if [ "$SOLO_ENV" = 1 ]; then msg "Archivo $ENV_FILE listo."; return 0; fi
  comprobar_puertos
  msg "Descargando las imágenes…"
  # Sin red o con GHCR caído, repetir la instalación sigue funcionando con las imágenes que ya hay.
  compose pull --ignore-buildable || aviso "No pude descargar las imágenes; sigo con las que ya hay en este servidor."
  msg "Arrancando la plataforma…"
  compose up -d || fallo "No se pudo arrancar. Si dice «denied» o «not found» al bajar las imágenes, aún no están publicadas: usa «docker compose -f docker-compose.yml -f deploy/docker-compose.build.yml up -d» (compila en este servidor)."
  esperar_monitor
  crear_perfiles
  comprobar_mcp
  resumen
}

main
