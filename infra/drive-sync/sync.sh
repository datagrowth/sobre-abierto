#!/bin/sh
# Sincroniza carpetas del VPS con Google Drive (rclone bisync, en ambos sentidos)
# y sube una copia de seguridad diaria de los datos de Hermes.
#
# La conexión (token y carpeta) la hace el monitor desde su interfaz y la deja en
# $STATE/drive.json; este script la aplica en cuanto cambia.
#
# Variables:
#   GDRIVE_CLIENT_ID/SECRET cliente OAuth de Google Cloud (el mismo que usa el monitor)
#   GDRIVE_SYNC             pares "NombreEnDrive=/ruta/local" separados por ';'. Un
#                           nombre puede ser subcarpeta de otro ("A/b"): esa parte se
#                           sincroniza con su propia ruta y el par "A" la ignora.
#   GDRIVE_SYNC_INTERVAL    segundos máximos entre sincronizaciones (default: 60); un
#                           cambio local adelanta la siguiente
#   GDRIVE_BACKUP           1 = copia de seguridad diaria a Drive; 0 = ninguna (default: 1).
#                           También true/si/yes/on y false/no/off; otro valor = sin copias
#   GDRIVE_BACKUP_PLATAFORMA bases de datos de la plataforma en la copia: diaria, semanal o
#                           no (default: semanal)
#   GDRIVE_BACKUP_SOURCE    carpeta a respaldar (default: /opt/data; vacío = sin copias)
#   GDRIVE_BACKUP_HOUR      hora (0-23, TZ del contenedor) a partir de la que se hace la
#                           copia del día (default: 4); fuera de 0-23 = sin copias
#   GDRIVE_BACKUP_KEEP_DAYS días que se conservan las copias en Drive (1 o más; default: 30)
set -u

INTERVAL="${GDRIVE_SYNC_INTERVAL:-60}"
BACKUP_SOURCE="${GDRIVE_BACKUP_SOURCE-/opt/data}"
BACKUP_HOUR="${GDRIVE_BACKUP_HOUR:-4}"
STATE="${DRIVE_SYNC_STATE:-/state}"
CONFIG="$STATE/drive.json"
STATUS="$STATE/status.json"
# Carpeta de Drive con la que se creó el estado de bisync guardado.
ACTIVE="$STATE/active-folder"
# Fin de la última vuelta: lo local más nuevo que esto adelanta la siguiente.
LAST_ROUND="$STATE/last-round"
# Cada cuánto se mira si el monitor cambió la conexión o si hubo cambios locales.
POLL=10
TAB="$(printf '\t')"
export RCLONE_CONFIG="$STATE/rclone.conf"
export XDG_CACHE_HOME="$STATE/cache"

log() { echo "[drive-sync] $(date '+%F %T') $*"; }
trap 'log "parando"; exit 0' TERM INT

. "$(dirname "$0")/copia.sh"
. "$(dirname "$0")/rutas.sh"
PLATAFORMA_MODO="$(copia_modo_plataforma "${GDRIVE_BACKUP_PLATAFORMA:-}")" \
  || log "GDRIVE_BACKUP_PLATAFORMA=${GDRIVE_BACKUP_PLATAFORMA:-} no es diaria, semanal ni no: se usa semanal"
KEEP_DAYS="$(copia_dias_validos "${GDRIVE_BACKUP_KEEP_DAYS:-}")" \
  || log "GDRIVE_BACKUP_KEEP_DAYS=${GDRIVE_BACKUP_KEEP_DAYS:-} no es un número de días de 1 o más: se usa 30"
# Vacío si la copia está activa; si no, el motivo, que va al log y a status.json.
BACKUP_OFF="$(copia_motivo_off "${GDRIVE_BACKUP:-}" "$BACKUP_HOUR" "$BACKUP_SOURCE")"
# Hora y epoch de la última copia subida y de la última con las bases de la plataforma.
LAST_BACKUP="$STATE/copia-ultima"
LAST_PLATAFORMA="$STATE/copia-plataforma"

if [ -z "${GDRIVE_CLIENT_ID:-}" ] || [ -z "${GDRIVE_CLIENT_SECRET:-}" ]; then
  log "Faltan GDRIVE_CLIENT_ID/GDRIVE_CLIENT_SECRET: sincronización con Google Drive desactivada."
  while :; do sleep 3600 & wait $!; done
fi

applied=""  # cksum del drive.json aplicado
ready=""    # 1 = conectado y con carpeta elegida
next=0      # epoch de la próxima vuelta de sincronización

# rclone guarda aquí el token de acceso renovado mientras drive.json no cambie.
write_rclone_conf() {
  (
    umask 077
    printf '[gdrive]\ntype = drive\nscope = drive\n'
    printf 'client_id = %s\nclient_secret = %s\n' "$GDRIVE_CLIENT_ID" "$GDRIVE_CLIENT_SECRET"
    printf 'root_folder_id = %s\ntoken = %s\n' "$2" "$1"
  ) > "$RCLONE_CONFIG"
  chmod 600 "$RCLONE_CONFIG"
}

apply_config() {
  ready=""
  token="$(jq -c '.token // empty' "$CONFIG" 2>/dev/null)"
  folder="$(jq -r '.folder.id // empty' "$CONFIG" 2>/dev/null)"
  folder_name="$(jq -r '.folder.path // .folder.name // empty' "$CONFIG" 2>/dev/null)"
  if [ -z "$token" ] || [ -z "$folder" ]; then
    log "Drive conectado; falta elegir la carpeta en el monitor"
    return
  fi
  write_rclone_conf "$token" "$folder"
  if [ "$(cat "$ACTIVE" 2>/dev/null)" != "$folder" ]; then
    # Carpeta nueva: el estado de bisync de la anterior no vale y la primera
    # vuelta une ambos lados con --resync.
    rm -rf "$STATE/bisync" "$STATE"/bisync-ready-*
    echo "$folder" > "$ACTIVE"
  fi
  log "Drive: carpeta \"$folder_name\", cada ${INTERVAL}s como mucho"
  ready=1
  next=0
}

# Devuelve 0 cuando hay conexión y carpeta.
load_config() {
  if [ ! -s "$CONFIG" ]; then
    if [ -n "$applied" ]; then
      log "Drive desconectado desde el monitor"
      rm -f "$RCLONE_CONFIG" "$STATUS"
      applied=""
    fi
    ready=""
    return 1
  fi
  sum="$(cksum < "$CONFIG")"
  if [ "$sum" != "$applied" ]; then
    applied="$sum"
    apply_config
  fi
  [ -n "$ready" ]
}

# Pares de GDRIVE_SYNC, uno por línea: "nombre<TAB>ruta".
pairs() {
  printf '%s\n' "${GDRIVE_SYNC:-}" | tr ';' '\n' | while IFS= read -r pair; do
    name="${pair%%=*}"
    dir="${pair#*=}"
    [ -n "$name" ] && [ -n "$dir" ] && [ "$name" != "$pair" ] && printf '%s\t%s\n' "$name" "$dir"
  done
}

# Lo que nunca va a Drive: copias internas de la Biblioteca, salida del antiguo grafo,
# la copia de los Google Docs (.gdocs, que solo baja) y temporales de escritura.
# Cambiar esta lista (o la versión) obliga a un --resync, que se hace solo.
BASE_FILTERS='# bisync v2: --drive-skip-gdocs
- .hermes-vault/**
- .gdocs/**
- graphify-out/**
- .trash/**
- *.tmp
- .DS_Store'

# Filtros de un par: los comunes más las subcarpetas que sincroniza otro par.
write_filters() {
  name="$1"
  file="$2"
  {
    printf '%s\n' "$BASE_FILTERS"
    pairs | while IFS="$TAB" read -r other _; do
      case "$other" in "$name"/*) printf '%s\n' "- /${other#"$name"/}/**" ;; esac
    done
  } > "$file.new"
  if ! cmp -s "$file.new" "$file"; then
    mv "$file.new" "$file"
    return 1
  fi
  rm -f "$file.new"
}

# rclone bisync se detiene si una carpeta queda vacía (lo toma por un fallo de
# montaje). Un archivo testigo en cada carpeta evita ese caso; si alguien lo
# borra, se vuelve a crear en la siguiente vuelta.
SENTINEL=".hermes-sync"

# Primer error de rclone (el que explica el fallo), sin colores ni fecha.
last_error() {
  tr -d '\033' < "$1" | sed 's/\[[0-9;]*m//g' | grep 'ERROR' | grep -v 'Bisync aborted' \
    | head -n 1 | sed 's/^[0-9/]* [0-9:]* ERROR : //'
}

sync_pair() {
  name="$1"
  local_dir="$2"
  remote="gdrive:$name"
  id="$(slug "$name")"
  marker="$STATE/bisync-ready-$id"
  filters="$STATE/filters-$id.txt"
  # Un enlace puesto por Hermes en la ruta o dentro haría a bisync subir o escribir lo de
  # fuera (p. ej. /datos). No se rehace la carpeta: vacía, bisync borraría Drive. El par
  # espera, y el panel de Drive dice por qué, hasta que alguien quite el enlace; sin la
  # marca, la vuelta siguiente es un --resync, que une ambos lados sin borrar nada.
  if enlace="$(enlace_que_saca "$local_dir")"; then
    rm -f "$marker"
    fail_pair "$name" "$enlace es un enlace simbólico: no se sincroniza hasta quitarlo"
    return 1
  fi
  mkdir -p "$local_dir" || { fail_pair "$name" "no se pudo crear $local_dir"; return 1; }
  rclone mkdir "$remote" < /dev/null || { fail_pair "$name" "no se pudo crear la carpeta en Drive"; return 1; }
  # Filtros nuevos o cambiados: bisync exige --resync, que une sin borrar nada.
  write_filters "$name" "$filters" || rm -f "$marker"

  [ -f "$local_dir/$SENTINEL" ] || echo "Hermes sincroniza esta carpeta con Google Drive. Si borras este archivo, se vuelve a crear." \
    > "$local_dir/$SENTINEL"

  resync=""
  # Primera vez, tras un fallo grave o si cambió la carpeta local del par (la marca guarda su ruta;
  # una marca vacía es de antes y vale): --resync une ambos lados sin borrar nada.
  hecha="$(cat "$marker" 2>/dev/null)" || resync="--resync"
  [ -z "$hecha" ] || [ "$hecha" = "$local_dir" ] || resync="--resync"
  out="$STATE/last-$id.log"
  # --max-delete 75 (y no --force): si un lado pierde más de tres cuartas partes de los archivos, bisync
  # se para en vez de propagar el borrado al otro (un agente o un error no vacían Drive en silencio).
  # --drive-skip-gdocs: los Google Docs no se pueden subir de vuelta como Docs; si
  # bisync los viera, borrar su copia local borraría el Doc. Van aparte (export_gdocs).
  if rclone bisync "$local_dir" "$remote" $resync \
      --workdir "$STATE/bisync" --filters-file "$filters" --drive-skip-gdocs \
      --create-empty-src-dirs --resilient --recover --max-lock 5m \
      --conflict-resolve none --conflict-loser num --max-delete 75 \
      --log-level NOTICE < /dev/null > "$out" 2>&1; then
    printf '%s\n' "$local_dir" > "$marker"
    [ -n "$resync" ] && log "$name: sincronizado (uniendo ambos lados)" || log "$name: sincronizado"
  else
    log "$name: la sincronización falló:"
    tail -n 5 "$out"
    # Estado perdido o carpeta vacía (sin testigo): --resync en la siguiente vuelta,
    # que une ambos lados sin borrar nada.
    grep -qiE 'must run --resync|empty (prior|current)' "$out" && rm -f "$marker"
    fail_pair "$name" "$(last_error "$out")"
    return 1
  fi
  export_gdocs "$name" "$local_dir" "$filters"
}

# 0 si algo de las carpetas locales cambió desde la última vuelta (sin contar lo
# que nunca se sube).
local_changes() {
  [ -f "$LAST_ROUND" ] || return 1
  pairs | while IFS="$TAB" read -r _ dir; do
    [ -d "$dir" ] || continue
    find "$dir" \( -name '.*' -o -name graphify-out \) -prune -o \
      -type f -newer "$LAST_ROUND" ! -name '*.tmp' -print 2>/dev/null | head -n 1
  done | grep -q .
}

# Copia consistente de una base SQLite (en modo WAL no vale copiarla a pelo), comprimida.
copiar_sqlite() {
  sqlite3 "$1" ".backup '$2'" && gzip "$2" && return 0
  # Una copia a medias no debe subir como si fuera buena.
  rm -f "$2" "$2.gz"
  log "copia: no se pudo copiar $(basename "$1")"
  return 1
}

# Bases de datos de la plataforma (núcleo y dominios) a $1. Devuelve 1 si falta alguna.
copiar_plataforma() {
  [ -n "${PLATAFORMA_BACKUP_DIR:-}" ] && [ -d "$PLATAFORMA_BACKUP_DIR" ] || return 1
  mkdir -p "$1"
  falta=0
  for db in "$PLATAFORMA_BACKUP_DIR"/*.db; do
    [ -f "$db" ] || continue
    copiar_sqlite "$db" "$1/$(basename "$db")" || falta=1
  done
  return "$falta"
}

# Lo que ya vive en Drive: las carpetas de GDRIVE_SYNC dentro de $BACKUP_SOURCE, como
# opciones --exclude de tar, una por línea.
excluir_sincronizadas() {
  pairs | while IFS="$(printf '\t')" read -r _ dir; do
    case "$dir" in "$BACKUP_SOURCE"/?*) printf -- '--exclude=./%s\n' "${dir#"$BACKUP_SOURCE"/}" ;; esac
  done
}

# El resto de $BACKUP_SOURCE, sin la base de datos, los logs, los secretos (.env de
# Hermes y de los perfiles, tokens de agentes), lo que ya vive en Drive (las carpetas
# sincronizadas y la antigua de documentos) ni las copias propias de Hermes.
empaquetar_datos() {
  destino="$1"
  set --
  while IFS= read -r excluir; do
    [ -n "$excluir" ] && set -- "$@" "$excluir"
  done <<SINCRONIZADAS
$(excluir_sincronizadas)
SINCRONIZADAS
  tar -czf "$destino/hermes-data.tar.gz" -C "$BACKUP_SOURCE" \
    --exclude='./state.db' --exclude='./state.db-wal' --exclude='./state.db-shm' \
    --exclude='./.env' --exclude='./profiles/*/.env' --exclude='./.biblioteca-token' --exclude='./.agentes' \
    --exclude='./logs' --exclude='./backups' --exclude='./documentos' "$@" . && return 0
  log "copia: no se pudo empaquetar $BACKUP_SOURCE"
  return 1
}

backup_once() {
  [ -z "$BACKUP_OFF" ] && [ -d "$BACKUP_SOURCE" ] || return 0
  day="$(date +%F)"
  hecha=0
  [ -f "$STATE/backup-$day" ] && hecha=1
  copia_toca "$(date +%H | sed 's/^0//')" "$BACKUP_HOUR" "$hecha" || return 0

  tmp="/tmp/hermes-backup/$day"
  rm -rf /tmp/hermes-backup && mkdir -p "$tmp"
  # Sin la base de Hermes la copia no sirve para restaurar: no se sube ni consta como
  # hecha (el panel avisa cuando la última pasa de 26 h) y se reintenta en la siguiente
  # vuelta, igual que una subida fallida.
  if [ -f "$BACKUP_SOURCE/state.db" ] && ! copiar_sqlite "$BACKUP_SOURCE/state.db" "$tmp/state.db"; then
    rm -rf /tmp/hermes-backup
    return 1
  fi
  plataforma=""
  if copia_plataforma_toca "$PLATAFORMA_MODO" "$(date +%s)" "$(marca_epoch "$LAST_PLATAFORMA")"; then
    copiar_plataforma "$tmp/plataforma" && plataforma=1
  fi
  if empaquetar_datos "$tmp" && subir_copia "$tmp" "$day"; then
    marcar "$LAST_BACKUP"
    [ -n "$plataforma" ] && marcar "$LAST_PLATAFORMA"
    log "copia de seguridad del $day subida a Drive${plataforma:+ (con las bases de datos de la plataforma)}"
  fi
  rm -rf /tmp/hermes-backup
}

# Estado de la copia para status.json (y el panel de Drive del monitor). Números solo si
# son enteros y motivo recortado: es lo que acepta el monitor, y así un valor raro de las
# variables no oculta en el panel por qué la copia está desactivada.
copia_json() {
  jq -n --arg motivo "$BACKUP_OFF" --arg hora "$BACKUP_HOUR" --arg dias "$KEEP_DAYS" \
    --arg plataforma "$PLATAFORMA_MODO" --arg ultima "$(marca_iso "$LAST_BACKUP")" \
    --arg ultimaPlataforma "$(marca_iso "$LAST_PLATAFORMA")" \
    'def nulo: if . == "" then null else . end;
     def entero: (tonumber? | select(. == floor)) // null;
     {activa: ($motivo == ""), motivo: ($motivo | .[0:200] | nulo), hora: ($hora | entero),
      conservarDias: ($dias | entero), plataforma: $plataforma,
      ultima: ($ultima | nulo), ultimaPlataforma: ($ultimaPlataforma | nulo)}'
}

ERRORS="$STATE/errors.tsv"

# Anota el fallo de una carpeta (nombre y motivo) para status.json.
fail_pair() {
  printf '%s\t%s\n' "$1" "${2:-error desconocido}" >> "$ERRORS"
}

# Resultado de la última vuelta, para el monitor.
write_status() {
  jq -Rn --arg at "$(date -u +%FT%TZ)" --argjson copia "$(copia_json)" \
    '[inputs | split("\t") | {(.[0]): (.[1] // "")}] | add // {} | {at: $at, failed: keys, errors: ., copia: $copia}' \
    "$ERRORS" > "$STATUS.tmp" && mv "$STATUS.tmp" "$STATUS"
}

run_round() {
  : > "$ERRORS"
  pairs | while IFS="$TAB" read -r name dir; do
    sync_pair "$name" "$dir"
  done
  backup_once
  write_status
  touch "$LAST_ROUND"
}

if [ -n "$BACKUP_OFF" ]; then
  log "copia de seguridad a Drive desactivada ($BACKUP_OFF)"
else
  log "copia de seguridad a Drive cada día desde las ${BACKUP_HOUR}:00, ${KEEP_DAYS} días; bases de datos de la plataforma: $PLATAFORMA_MODO"
fi
copia_heredar_ultima
log "esperando la conexión con Drive desde el monitor"
while :; do
  if load_config && { [ "$(date +%s)" -ge "$next" ] || local_changes; }; then
    run_round
    next=$(( $(date +%s) + INTERVAL ))
  fi
  sleep "$POLL" &
  wait $!
done
