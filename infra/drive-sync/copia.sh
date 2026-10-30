# Copia de seguridad a Drive: decisiones (funciones puras) y subida, para que copia.test.sh
# las pruebe sin red. sync.sh las carga con «.». subir_copia y las marcas usan $STATE,
# $KEEP_DAYS, $LAST_BACKUP, log y rclone, que la prueba sustituye por funciones.

# Margen de la copia semanal: 6,5 días y no 7, porque la copia diaria no sale cada día
# a la misma hora exacta (reintentos, segundos de diferencia) y con 7 días justos una
# semana se saltaría al día siguiente.
COPIA_SEMANA_S=561600

# GDRIVE_BACKUP normalizado a 0 o 1 (vacío = 1), sin mayúsculas ni espacios y con los
# sinónimos habituales. Un valor desconocido no imprime nada y devuelve 1.
copia_interruptor() {
  case "$(printf '%s' "$1" | tr -d ' \t' | tr 'A-Z' 'a-z')" in
    0|false|no|off) echo 0 ;;
    1|true|si|sí|yes|on|'') echo 1 ;;
    *) return 1 ;;
  esac
}

# GDRIVE_BACKUP_PLATAFORMA normalizado (vacío = semanal). Devuelve 1 si no era válido.
copia_modo_plataforma() {
  case "$1" in
    diaria|semanal|no) echo "$1" ;;
    '') echo semanal ;;
    *) echo semanal; return 1 ;;
  esac
}

# GDRIVE_BACKUP_KEEP_DAYS como entero de 1 o más, sin ceros a la izquierda (vacío = 30).
# Con 0, «rclone delete --min-age 0d» borraría también la copia recién subida. Devuelve 1
# si no era válido (y usa 30).
copia_dias_validos() {
  [ -n "$1" ] || { echo 30; return 0; }
  case "$1" in *[!0-9]*) echo 30; return 1 ;; esac
  dias_sin_ceros="${1#"${1%%[!0]*}"}"
  [ -n "$dias_sin_ceros" ] || { echo 30; return 1; }
  echo "$dias_sin_ceros"
}

# Más de dos cifras no es hora, y así «test» no se queja de números enormes.
copia_hora_valida() {
  case "$1" in ''|*[!0-9]*|???*) return 1 ;; esac
  [ "$1" -le 23 ]
}

# Por qué no hay copia; vacío si está activa. Un GDRIVE_BACKUP desconocido la apaga: quien
# escribe «apagado» quiere ahorrar espacio en Drive, y así el panel lo dice en vez de
# seguir subiendo copias. Una hora fuera de 0-23 la desactiva, como el antiguo truco 99.
# $1 GDRIVE_BACKUP tal cual, $2 GDRIVE_BACKUP_HOUR, $3 GDRIVE_BACKUP_SOURCE
copia_motivo_off() {
  if ! interruptor="$(copia_interruptor "$1")"; then
    echo "GDRIVE_BACKUP=$1 no válido (usa 0 o 1)"
  elif [ "$interruptor" = 0 ]; then
    echo "GDRIVE_BACKUP=$1"
  elif ! copia_hora_valida "$2"; then
    echo "GDRIVE_BACKUP_HOUR=$2, fuera de 0-23"
  elif [ -z "$3" ]; then
    echo "GDRIVE_BACKUP_SOURCE vacío"
  fi
}

# ¿Toca subir la copia del día? $1 hora actual (0-23), $2 hora de la copia, $3 1 si ya se hizo hoy.
copia_toca() {
  [ "$3" != 1 ] && [ "$1" -ge "$2" ]
}

# ¿Entran en esta copia las bases de datos de la plataforma?
# $1 modo (diaria|semanal|no), $2 ahora (epoch s), $3 última vez que entraron (epoch s; vacío = nunca)
copia_plataforma_toca() {
  case "$1" in
    diaria) return 0 ;;
    no) return 1 ;;
  esac
  case "$3" in ''|*[!0-9]*) return 0 ;; esac
  [ $(( $2 - $3 )) -ge "$COPIA_SEMANA_S" ]
}

# Sube $1 como la copia del día $2 y borra en Drive las de más de KEEP_DAYS días. Devuelve
# el resultado de la subida: si solo falla la limpieza, la copia ya está en Drive y debe
# constar como hecha; la limpieza se reintenta con la copia de mañana.
subir_copia() {
  if ! rclone copy "$1" "gdrive:Copias de seguridad/$2" --log-level NOTICE; then
    log "copia: falló la subida a Drive (se reintenta en la siguiente vuelta)"
    return 1
  fi
  touch "$STATE/backup-$2"
  find "$STATE" -name 'backup-*' ! -name "backup-$2" -delete
  { rclone delete "gdrive:Copias de seguridad" --min-age "${KEEP_DAYS}d" --log-level NOTICE \
      && rclone rmdirs "gdrive:Copias de seguridad" --leave-root --log-level NOTICE; } \
    || log "copia: no se pudieron borrar las copias antiguas de Drive (se reintenta mañana)"
  return 0
}

# Marca de tiempo «epoch iso» que lee status.json.
marcar() { printf '%s %s\n' "$(date +%s)" "$(date -u +%FT%TZ)" > "$1"; }
marca_epoch() { [ -s "$1" ] && cut -d' ' -f1 "$1"; }
marca_iso() { [ -s "$1" ] && cut -d' ' -f2 "$1"; }

# drive-sync anterior a copia-ultima solo dejaba la marca backup-<día>: su fecha vale como
# última copia, para que tras actualizar el panel no diga que no hay ninguna.
copia_heredar_ultima() {
  [ -s "$LAST_BACKUP" ] && return 0
  for previa in "$STATE"/backup-*; do
    [ -f "$previa" ] || continue
    printf '%s %s\n' "$(date -r "$previa" +%s)" "$(date -u -r "$previa" +%FT%TZ)" > "$LAST_BACKUP"
  done
}
