#!/usr/bin/env bash
# Pruebas de install.sh sin arrancar nada (--solo-env): genera el .env, es idempotente y no pisa lo
# que ya existe. Una prueba usa `docker compose config` para ver que el .env generado basta al
# Compose. Uso: bash infra/install.test.sh
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"

fallos=0
pasa() { printf 'ok   %s\n' "$1"; }
falla() { printf 'FALLA %s\n' "$1"; fallos=$((fallos + 1)); }
cierto() { n="$1"; shift; if "$@"; then pasa "$n"; else falla "$n"; fi; }
falso() { n="$1"; shift; if "$@"; then falla "$n"; else pasa "$n"; fi; }

RAIZ="$(mktemp -d)"
trap 'rm -rf "$RAIZ"' EXIT

# Una instalación nueva con la forma de un clon: el script junto a sus archivos.
nueva() {
  d="$RAIZ/$1"
  mkdir -p "$d/infra" "$d/deploy"
  cp "$REPO/install.sh" "$REPO/docker-compose.yml" "$REPO/.env.example" "$d/"
  cp "$REPO/deploy/docker-compose.caddy.yml" "$REPO/deploy/docker-compose.llm-local.yml" "$d/deploy/"
  cp "$REPO/infra/perfiles.sh" "$d/infra/"
  echo "$d"
}
valor() { sed -n "s/^$2=//p" "$1/.env" | head -n 1; }

I="$(nueva basica)"
ADMIN_EMAIL=ana@example.com bash "$I/install.sh" --solo-env > "$RAIZ/s1.txt" 2>&1 < /dev/null
cierto should_create_the_env_file test -f "$I/.env"
for v in API_SERVER_KEY HERMES_LICITACIONES_KEY HERMES_OFERTA_LICITACIONES_KEY HERMES_OFERTA_CRITICO_KEY MONITOR_SESSION_SECRET MONITOR_BASIC_AUTH_PASSWORD HERMES_DASHBOARD_BASIC_AUTH_PASSWORD; do
  cierto "should_generate_${v}" test "$(valor "$I" $v | wc -c)" -ge 25
done
cierto should_use_the_admin_email_as_the_login test "$(valor "$I" MONITOR_BASIC_AUTH_USERNAME)" = ana@example.com
# Los permisos de Unix no existen en el Git Bash de Windows.
case "$(uname -s)" in MINGW* | MSYS*) ;; *) cierto should_keep_the_env_private test "$(stat -c %a "$I/.env")" = 600 ;; esac
falso should_not_add_the_caddy_override_without_a_domain grep -q '^COMPOSE_FILE=' "$I/.env"
cierto should_not_reuse_one_secret_for_two_variables test "$(grep -E '_KEY=|SECRET=|PASSWORD=' "$I/.env" | sed 's/^[^=]*=//' | grep -v '^$' | sort | uniq -d | wc -l)" -eq 0

# Segunda ejecución: ni un byte distinto, aunque se le den otros valores.
antes="$(cat "$I/.env")"
ADMIN_EMAIL=otra@example.com DOMINIO= bash "$I/install.sh" --solo-env > /dev/null 2>&1 < /dev/null
cierto should_not_change_the_env_when_run_again test "$antes" = "$(cat "$I/.env")"
cierto should_keep_the_first_admin_when_run_again test "$(valor "$I" MONITOR_BASIC_AUTH_USERNAME)" = ana@example.com

# Un valor que ya existe se conserva aunque falten los demás.
I="$(nueva previo)"
printf 'MONITOR_SESSION_SECRET=el-que-ya-tenia-0123456789abcdef0123456789abcdef\nAPI_SERVER_KEY=clave-previa\n' > "$I/.env"
ADMIN_EMAIL=ana@example.com bash "$I/install.sh" --solo-env > /dev/null 2>&1 < /dev/null
cierto should_keep_an_existing_secret test "$(valor "$I" MONITOR_SESSION_SECRET)" = el-que-ya-tenia-0123456789abcdef0123456789abcdef
cierto should_keep_an_existing_api_key test "$(valor "$I" API_SERVER_KEY)" = clave-previa
cierto should_fill_in_the_missing_ones test "$(valor "$I" HERMES_LICITACIONES_KEY | wc -c)" -ge 25
cierto should_point_each_profile_to_its_hermes_url test "$(valor "$I" HERMES_LICITACIONES_URL),$(valor "$I" HERMES_OFERTA_LICITACIONES_URL),$(valor "$I" HERMES_OFERTA_CRITICO_URL)" = "http://hermes:8642/p/licitaciones,http://hermes:8642/p/oferta-licitaciones,http://hermes:8642/p/critico-licitaciones"
cierto should_not_duplicate_a_variable test "$(grep -c '^API_SERVER_KEY=' "$I/.env")" -eq 1

# Con dominio: Caddy y el dominio en el .env.
I="$(nueva dominio)"
ADMIN_EMAIL=ana@example.com DOMINIO=licitaciones.example.com bash "$I/install.sh" --solo-env > /dev/null 2>&1 < /dev/null
cierto should_store_the_domain test "$(valor "$I" DOMINIO)" = licitaciones.example.com
cierto should_add_the_caddy_override_with_a_domain test "$(valor "$I" COMPOSE_FILE)" = docker-compose.yml:deploy/docker-compose.caddy.yml
cierto should_not_leave_the_commented_domain_line test "$(grep -c 'DOMINIO=' "$I/.env")" -eq 1

# Entradas inválidas: fallan sin dejar un .env a medias.
I="$(nueva invalida)"
ADMIN_EMAIL=no-es-un-correo bash "$I/install.sh" --solo-env > /dev/null 2>&1 < /dev/null
falso should_reject_an_invalid_email test $? -eq 0
bash "$I/install.sh" --solo-env > /dev/null 2>&1 < /dev/null
falso should_require_the_admin_email_without_a_terminal test $? -eq 0
ADMIN_EMAIL=ana@example.com DOMINIO='a b;rm' bash "$I/install.sh" --solo-env > /dev/null 2>&1 < /dev/null
falso should_reject_an_invalid_domain test $? -eq 0

# Sin Docker usable no sigue: dice qué falta.
I="$(nueva sindocker)"
mkdir -p "$RAIZ/bin"
printf '#!/bin/sh\nexit 1\n' > "$RAIZ/bin/docker"; chmod +x "$RAIZ/bin/docker"
salida="$(PATH="$RAIZ/bin:$PATH" ADMIN_EMAIL=ana@example.com bash "$I/install.sh" < /dev/null 2>&1)"
cierto should_stop_when_docker_does_not_respond sh -c "printf '%s' '$salida' | grep -q 'Docker está instalado pero no responde'"
falso should_not_create_the_env_when_docker_fails test -f "$I/.env"

# El .env generado le basta al Compose (si Docker está disponible aquí).
if docker compose version > /dev/null 2>&1; then
  I="$(nueva compose)"
  ADMIN_EMAIL=ana@example.com DOMINIO=licitaciones.example.com bash "$I/install.sh" --solo-env > /dev/null 2>&1 < /dev/null
  (cd "$I" && docker compose config --quiet > "$RAIZ/c.txt" 2>&1); cierto should_satisfy_the_compose_required_variables test $? -eq 0
else
  echo "salto should_satisfy_the_compose_required_variables: sin Docker"
fi

# --ayuda enseña solo la cabecera de comentarios, sin código.
ayuda="$(bash "$REPO/install.sh" --ayuda 2>&1)"
falso should_not_print_code_in_the_help sh -c "printf '%s' '$ayuda' | grep -qE 'set -euo|RAW_BASE'"
cierto should_list_the_options_in_the_help sh -c "printf '%s' '$ayuda' | grep -q -- '--actualizar'"

# Descarga de los archivos de la instalación (curl contra archivos locales: sin red).
# main y la release 1.2.3 se distinguen por una marca en el Compose.
RAW="$RAIZ/raw"
# curl de Windows no entiende las rutas /tmp de Git Bash: se le pasa la ruta de Windows.
url_local() { if p="$(cygpath -m "$1" 2> /dev/null)"; then echo "file:///$p"; else echo "file://$1"; fi; }
for ref in main v1.2.3 v9.9.9; do
  mkdir -p "$RAW/$ref/infra" "$RAW/$ref/deploy"
  cp "$REPO/docker-compose.yml" "$REPO/.env.example" "$REPO/install.sh" "$RAW/$ref/"
  cp "$REPO/deploy/docker-compose.caddy.yml" "$REPO/deploy/docker-compose.llm-local.yml" "$RAW/$ref/deploy/"
  cp "$REPO/infra/perfiles.sh" "$RAW/$ref/infra/"
  echo "# version $ref" >> "$RAW/$ref/docker-compose.yml"
done
rm "$RAW/v9.9.9/infra/perfiles.sh"
mkdir -p "$RAIZ/api/releases"
printf '{
  "tag_name": "v1.2.3",
  "name": "v1.2.3"
}
' > "$RAIZ/api/releases/latest"
descarga() {
  d="$RAIZ/$1"; mkdir -p "$d"; cp "$REPO/install.sh" "$d/"; shift
  (cd "$d" && env SOBRE_ABIERTO_RAW="$(url_local "$RAW")" ADMIN_EMAIL=ana@example.com "$@" bash ./install.sh --solo-env > "$d/salida.txt" 2>&1 < /dev/null)
}

descarga d1 SOBRE_ABIERTO_API="$(url_local "$RAIZ/api")"
cierto should_download_the_files_of_the_latest_release grep -q '# version v1.2.3' "$RAIZ/d1/sobre-abierto/docker-compose.yml"
cierto should_pin_the_images_to_the_downloaded_release test "$(valor "$RAIZ/d1/sobre-abierto" SOBRE_ABIERTO_VERSION)" = 1.2.3
cierto should_download_the_script_itself test -f "$RAIZ/d1/sobre-abierto/install.sh"

descarga d2 SOBRE_ABIERTO_API="$(url_local "$RAIZ/sin-api")"
cierto should_fall_back_to_main_without_a_release grep -q '# version main' "$RAIZ/d2/sobre-abierto/docker-compose.yml"
cierto should_warn_when_there_is_no_release grep -q 'Aún no hay ninguna release' "$RAIZ/d2/salida.txt"
falso should_not_pin_a_version_when_falling_back_to_main grep -q '^SOBRE_ABIERTO_VERSION=' "$RAIZ/d2/sobre-abierto/.env"

descarga d3 SOBRE_ABIERTO_VERSION=9.9.9
falso should_not_leave_half_an_installation_when_a_download_fails test -e "$RAIZ/d3/sobre-abierto/docker-compose.yml"
falso should_not_leave_download_leftovers sh -c "ls $RAIZ/d3/sobre-abierto/*.nuevo $RAIZ/d3/sobre-abierto/infra/*.nuevo $RAIZ/d3/sobre-abierto/deploy/*.nuevo 2> /dev/null | grep -q ."

# SHA256SUMS de la release: con las sumas buenas se instala; con una que no casa, no queda nada.
REL="$RAIZ/releases"
mkdir -p "$REL/v1.2.3"
(cd "$RAW/v1.2.3" && sha256sum docker-compose.yml deploy/docker-compose.caddy.yml deploy/docker-compose.llm-local.yml .env.example infra/perfiles.sh install.sh > "$REL/v1.2.3/SHA256SUMS")
descarga d4 SOBRE_ABIERTO_VERSION=1.2.3 SOBRE_ABIERTO_RELEASES="$(url_local "$REL")"
cierto should_install_when_the_sums_match test -f "$RAIZ/d4/sobre-abierto/docker-compose.yml"
awk '$2 ~ /^[*]?docker-compose[.]yml$/ {$1 = "0000000000000000000000000000000000000000000000000000000000000000"} {print}' "$REL/v1.2.3/SHA256SUMS" > "$REL/v1.2.3/malas" && mv "$REL/v1.2.3/malas" "$REL/v1.2.3/SHA256SUMS"
descarga d5 SOBRE_ABIERTO_VERSION=1.2.3 SOBRE_ABIERTO_RELEASES="$(url_local "$REL")"
falso should_not_install_when_a_sum_does_not_match test -e "$RAIZ/d5/sobre-abierto/docker-compose.yml"
cierto should_say_which_file_does_not_match grep -q 'docker-compose.yml no coincide' "$RAIZ/d5/salida.txt"

# --actualizar: baja otra vez los archivos de la versión del .env y no toca el .env.
U="$RAIZ/d1/sobre-abierto"
echo '# version vieja' >> "$U/docker-compose.yml"
antes="$(cat "$U/.env")"
(cd "$U" && env SOBRE_ABIERTO_RAW="$(url_local "$RAW")" bash ./install.sh --solo-env --actualizar > "$RAIZ/act.txt" 2>&1 < /dev/null)
falso should_replace_the_old_compose_when_updating grep -q '# version vieja' "$U/docker-compose.yml"
cierto should_use_the_version_of_the_env_when_updating grep -q '# version v1.2.3' "$U/docker-compose.yml"
cierto should_not_touch_the_env_when_updating test "$antes" = "$(cat "$U/.env")"
mkdir -p "$U/.git"
(cd "$U" && env SOBRE_ABIERTO_RAW="$(url_local "$RAW")" bash ./install.sh --solo-env --actualizar > "$RAIZ/act.txt" 2>&1 < /dev/null)
falso should_refuse_to_update_a_git_clone test $? -eq 0

[ "$fallos" -eq 0 ] && echo "todas las pruebas pasan" || { echo "$fallos pruebas fallidas"; exit 1; }
