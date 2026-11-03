#!/bin/sh
# Pruebas de init.sh: instala las skills del monitor en Hermes y en cada perfil, quita las que el
# monitor ya no trae y no toca las que no instaló él. Sin root (se salta los dueños) y en una
# carpeta temporal. Uso: sh infra/hermes-init/init.test.sh (también con dash o el ash de busybox).
set -u
INIT="$(cd "$(dirname "$0")" && pwd)/init.sh"

fallos=0
pasa() { printf 'ok   %s\n' "$1"; }
falla() { printf 'FALLA %s\n' "$1"; fallos=$((fallos + 1)); }
cierto() { n="$1"; shift; if "$@"; then pasa "$n"; else falla "$n"; fi; }
falso() { n="$1"; shift; if "$@"; then falla "$n"; else pasa "$n"; fi; }

RAIZ="$(mktemp -d)"
trap 'rm -rf "$RAIZ"' EXIT
FUENTE="$RAIZ/fuente"
DATA="$RAIZ/data"
mkdir -p "$FUENTE/licitaciones" "$FUENTE/vieja" "$DATA/profiles/licitaciones"
echo 'uno' > "$FUENTE/licitaciones/SKILL.md"
echo 'uno' > "$FUENTE/vieja/SKILL.md"
# Lo que no instala el monitor: una skill de la empresa y otra que creó Hermes.
mkdir -p "$DATA/skills/empresa/propia" "$DATA/profiles/licitaciones/skills/de-hermes"
echo 'mía' > "$DATA/skills/empresa/propia/SKILL.md"
echo 'mía' > "$DATA/profiles/licitaciones/skills/de-hermes/SKILL.md"

correr() { HERMES_DATA="$DATA" HERMES_INIT_SKILLS="$FUENTE" sh "$INIT" > "$RAIZ/salida.txt" 2>&1; }

correr
cierto should_install_the_skills_in_hermes_and_in_each_profile test -f "$DATA/skills/vieja/SKILL.md" -a -f "$DATA/profiles/licitaciones/skills/vieja/SKILL.md"

# La siguiente versión del monitor ya no trae «vieja» y cambia «licitaciones».
rm -r "$FUENTE/vieja"
echo 'dos' > "$FUENTE/licitaciones/SKILL.md"
correr
falso should_remove_a_skill_the_monitor_no_longer_ships test -e "$DATA/skills/vieja"
falso should_remove_it_from_each_profile_too test -e "$DATA/profiles/licitaciones/skills/vieja"
cierto should_update_the_skills_it_still_ships grep -q dos "$DATA/profiles/licitaciones/skills/licitaciones/SKILL.md"
cierto should_keep_the_company_skills test -f "$DATA/skills/empresa/propia/SKILL.md"
cierto should_keep_the_skills_hermes_created test -f "$DATA/profiles/licitaciones/skills/de-hermes/SKILL.md"
cierto should_say_what_it_removed grep -q 'skill retirada: vieja' "$RAIZ/salida.txt"

# Una lista manipulada no puede borrar fuera de la carpeta de skills.
mkdir -p "$DATA/fuera"
printf '%s\n' '../fuera' '..' '' >> "$DATA/skills/.skills-plataforma"
correr
cierto should_not_follow_paths_in_the_list test -d "$DATA/fuera"

# La URL del MCP por el alias «hermes-monitor» pasa al nombre del servicio; otra URL no se toca.
printf 'mcp_servers:\n  plataforma:\n    url: "http://hermes-monitor:3110/mcp"\n' > "$DATA/profiles/licitaciones/config.yaml"
printf 'mcp_servers:\n  plataforma:\n    url: "http://hermes-monitor:3110/mcp"\n' > "$DATA/config.yaml"
mkdir -p "$DATA/profiles/propio"
printf 'mcp_servers:\n  plataforma:\n    url: "https://plataforma.example.com/mcp"\n' > "$DATA/profiles/propio/config.yaml"
correr
cierto should_point_each_profile_mcp_to_the_monitor_service grep -q '"http://monitor:3110/mcp"' "$DATA/profiles/licitaciones/config.yaml"
cierto should_point_the_main_config_mcp_to_the_monitor_service grep -q '"http://monitor:3110/mcp"' "$DATA/config.yaml"
cierto should_keep_a_custom_mcp_url grep -q 'https://plataforma.example.com/mcp' "$DATA/profiles/propio/config.yaml"
cierto should_say_it_moved_the_mcp_url grep -q 'apunta ahora a http://monitor:3110/mcp' "$RAIZ/salida.txt"
correr
falso should_not_touch_it_again_on_the_next_start grep -q 'apunta ahora' "$RAIZ/salida.txt"

[ "$fallos" -eq 0 ] && echo "todas las pruebas pasan" || { echo "$fallos pruebas fallidas"; exit 1; }
