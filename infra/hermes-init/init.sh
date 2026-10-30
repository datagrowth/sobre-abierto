#!/bin/sh
# Prepara /opt/data (el volumen de Hermes) antes de cada arranque:
#  1. instala las skills que trae el monitor (biblioteca, entorno, licitaciones),
#     siempre en su última versión, en Hermes y en cada perfil
#     (los perfiles no comparten skills);
#  2. crea un token por agente en /opt/data/.agentes (hermes y uno por perfil) y lo
#     deja como PLATAFORMA_TOKEN en el .env de cada uno si aún no lo tiene;
#  3. devuelve al usuario de Hermes (uid 10000) cualquier archivo que no sea suyo
#     o que no pueda escribir: Hermes solo corrige algunas rutas, y versiones
#     antiguas dejaron archivos de root o de solo lectura (p. ej. SOUL.md).
set -eu

DATA="${HERMES_DATA:-/opt/data}"
OWNER="${HERMES_OWNER:-10000:10000}"
LEGACY_TOKEN="$DATA/.biblioteca-token"
AGENTES="$DATA/.agentes"
SKILLS_SRC="${HERMES_INIT_SKILLS:-/opt/hermes-init/skills}"

# Lista de las skills que instaló la vez anterior: las que el monitor ya no trae se quitan. Las que
# no instaló él (las de la empresa, las que cree Hermes) no se tocan.
INSTALADAS=".skills-plataforma"

quitar_retiradas() {
  dest="$1"
  [ -f "$dest/$INSTALADAS" ] || return 0
  while IFS= read -r antigua; do
    case "$antigua" in '' | . | .. | */*) continue ;; esac
    [ -d "$SKILLS_SRC/$antigua" ] && continue
    rm -rf "${dest:?}/$antigua"
    echo "skill retirada: $antigua ($dest)"
  done < "$dest/$INSTALADAS"
}

# Hermes escribe en este volumen y hermes-init corre como root: un enlace simbólico puesto en una
# de estas rutas haría escribir o borrar fuera de donde toca. Si lo hay, esa ruta se salta.
es_enlace() {
  if [ -L "$1" ]; then
    echo "AVISO: $1 es un enlace simbólico: se salta"
    return 0
  fi
  return 1
}

install_skills() {
  dest="$1"
  es_enlace "$dest" && return 0
  mkdir -p "$dest"
  quitar_retiradas "$dest"
  : > "$dest/$INSTALADAS.new"
  for src in "$SKILLS_SRC"/*/; do
    [ -d "$src" ] || continue
    name="$(basename "$src")"
    rm -rf "$dest/$name.new"
    cp -R "$src" "$dest/$name.new"
    rm -rf "${dest:?}/$name"
    mv "$dest/$name.new" "$dest/$name"
    echo "$name" >> "$dest/$INSTALADAS.new"
  done
  mv "$dest/$INSTALADAS.new" "$dest/$INSTALADAS"
}

new_token() {
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

# Crea <agente>.token si falta. «hermes» hereda el token antiguo de la Biblioteca
# para que la skill que aún lo lee siga funcionando.
ensure_token() {
  file="$AGENTES/$1.token"
  [ -s "$file" ] && return 0
  if [ "$1" = "hermes" ] && [ -s "$LEGACY_TOKEN" ]; then
    (umask 077 && cp "$LEGACY_TOKEN" "$file")
  else
    (umask 077 && new_token > "$file")
  fi
  echo "token del agente $1 creado"
}

# Añade PLATAFORMA_TOKEN al .env si no lo tiene: nunca reescribe lo que ya hay.
ensure_env_token() {
  env_file="$1"
  token_file="$2"
  es_enlace "$env_file" && return 0
  touch "$env_file"
  grep -q '^PLATAFORMA_TOKEN=' "$env_file" && return 0
  [ -s "$env_file" ] && [ "$(tail -c 1 "$env_file")" != "" ] && echo >> "$env_file"
  printf 'PLATAFORMA_TOKEN=%s\n' "$(cat "$token_file")" >> "$env_file"
  chmod 600 "$env_file"
  echo "PLATAFORMA_TOKEN añadido a $env_file"
}

install_skills "$DATA/skills"
echo "skills instaladas en Hermes"

if [ ! -s "$LEGACY_TOKEN" ]; then
  (umask 077 && new_token > "$LEGACY_TOKEN")
  echo "token de la Biblioteca creado"
fi
chmod 600 "$LEGACY_TOKEN"

mkdir -p "$AGENTES"
chmod 700 "$AGENTES"
# El contenedor de Hermes ve Conocimiento en solo lectura (subruta del volumen): tiene que existir ya.
mkdir -p "$DATA/conocimiento"
ensure_token hermes
ensure_env_token "$DATA/.env" "$AGENTES/hermes.token"

for profile_dir in "$DATA"/profiles/*/; do
  [ -d "$profile_dir" ] || continue
  es_enlace "${profile_dir%/}" && continue
  profile="$(basename "$profile_dir")"
  case "$profile" in
    *[!a-z0-9_-]* | [!a-z0-9]*) echo "perfil $profile ignorado: nombre no válido para un token"; continue ;;
  esac
  install_skills "$profile_dir/skills"
  ensure_token "$profile"
  ensure_env_token "$profile_dir/.env" "$AGENTES/$profile.token"
  echo "perfil $profile preparado"
done
chmod 600 "$AGENTES"/*.token

# Solo root puede cambiar dueños (en el contenedor siempre lo es).
if [ "$(id -u)" != "0" ]; then
  echo "sin root: no se revisan dueños ni permisos"
  exit 0
fi
uid="${OWNER%%:*}"
gid="${OWNER#*:}"
find "$DATA" \( ! -user "$uid" -o ! -group "$gid" \) -exec chown -h "$OWNER" {} +
find "$DATA" -type d ! -perm -700 -exec chmod u+rwx {} +
find "$DATA" -type f ! -perm -600 -exec chmod u+rw {} +
echo "permisos de $DATA revisados"
