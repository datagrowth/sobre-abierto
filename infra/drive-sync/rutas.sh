# Rutas del volumen que drive-sync comparte con Hermes. Hermes crea, borra y puede sustituir
# por enlaces simbólicos lo que hay en /opt/data: si drive-sync siguiera un enlace, escribiría
# o borraría fuera (p. ej. en /datos, las bases de la plataforma). Nada aquí hace «cd» ni
# sigue enlaces: find va con -P (no los sigue, tampoco el punto de partida; busybox lo
# acepta). sync.sh las carga con «.»; rutas.test.sh las prueba sin red. export_gdocs usa
# $STATE, log, rclone y jq: la prueba sustituye log y rclone por funciones.

# Imprime la primera parte de la ruta absoluta $1 (ella misma o una carpeta por encima) que
# es un enlace simbólico y devuelve 0; devuelve 1 si no hay ninguna.
enlace_en_ruta() {
  resto="${1#/}"
  actual=""
  while [ -n "$resto" ]; do
    parte="${resto%%/*}"
    case "$resto" in */*) resto="${resto#*/}" ;; *) resto="" ;; esac
    [ -n "$parte" ] || continue
    actual="$actual/$parte"
    if [ -L "$actual" ]; then
      printf '%s\n' "$actual"
      return 0
    fi
  done
  return 1
}

# Imprime el primer enlace simbólico que haría a bisync leer o escribir fuera de la carpeta
# $1 y devuelve 0; devuelve 1 si no hay. Cuenta la propia ruta y, dentro, los enlaces a
# carpetas: los de archivos no se siguen (rclone los salta y, al bajar, sustituye el enlace
# por el archivo). .gdocs no cuenta: export_gdocs lo rehace y bisync no entra (filtros).
enlace_que_saca() {
  enlace_en_ruta "$1" && return 0
  [ -d "$1" ] || return 1
  primero="$(find -P "$1" -mindepth 1 -name .gdocs -prune -o -type l -print 2>/dev/null \
    | while IFS= read -r enlace; do
        if [ -d "$enlace" ]; then printf '%s\n' "$enlace"; break; fi
      done)"
  [ -n "$primero" ] || return 1
  printf '%s\n' "$primero"
}

# Deja $1 como carpeta real en la que solo escribe drive-sync: un enlace en su lugar se
# borra (el enlace, no aquello a lo que apunta) y la carpeta se crea; los enlaces de dentro
# también se borran, porque rclone escribiría a través de ellos. Devuelve 1 si una carpeta
# por encima es un enlace o si no se pudo crear.
carpeta_propia() {
  enlace_en_ruta "$(dirname "$1")" > /dev/null && return 1
  if [ -L "$1" ]; then rm -f "$1" || return 1; fi
  mkdir -p "$1" || return 1
  find -P "$1" -mindepth 1 -type l -exec rm -f {} + 2>/dev/null
  return 0
}

# Borra de la carpeta $1 los archivos que no están en la lista $2 (rutas relativas a $1, una
# por línea) y las subcarpetas que queden vacías. Si $1 deja de ser una carpeta real a
# mitad, no borra nada más.
borrar_sobrantes() {
  [ -L "$1" ] && return 0
  [ -d "$1" ] || return 0
  find -P "$1" -type f | while IFS= read -r ruta; do printf '%s\n' "${ruta#"$1"/}"; done \
    | grep -vxF -f "$2" | while IFS= read -r sobra; do
        [ -L "$1" ] && exit 0
        rm -f "$1/$sobra"
      done
  [ -L "$1" ] || find -P "$1" -mindepth 1 -type d -empty -delete 2>/dev/null
  return 0
}

# Nombre de un par apto para nombres de archivo del estado.
slug() { printf '%s' "$1" | tr -c 'A-Za-z0-9' '_'; }

# Los Google Docs, Hojas y Presentaciones bajan (solo bajan) convertidos a
# docx/xlsx/pptx a <carpeta>/.gdocs/, para que la Biblioteca y Hermes los lean.
# rclone los lista con tamaño -1, que es como se distinguen del resto.
export_gdocs() {
  dest="$2/.gdocs"
  list="$STATE/gdocs-$(slug "$1").txt"
  if ! rclone lsjson -R --files-only --filter-from "$3" "gdrive:$1" < /dev/null 2>/dev/null \
      | jq -r '.[] | select(.Size < 0) | .Path' > "$list"; then
    log "$1: no se pudo listar los Google Docs"
    return 0
  fi
  if [ ! -s "$list" ]; then
    # Con -r, rm borra un enlace, no aquello a lo que apunta.
    rm -rf "$dest"
    return 0
  fi
  # Hermes puede escribir en .gdocs: si lo cambia por un enlace (p. ej. a /datos), la
  # descarga y la limpieza actuarían fuera. Antes de usarla, carpeta real y sin enlaces.
  if ! carpeta_propia "$dest"; then
    log "$1: Google Docs sin bajar: $dest no es una carpeta segura"
    return 0
  fi
  rclone copy "gdrive:$1" "$dest" --files-from "$list" --log-level ERROR < /dev/null \
    || log "$1: no se pudieron bajar todos los Google Docs"
  # Fuera las copias de Docs que ya no están en Drive.
  borrar_sobrantes "$dest" "$list"
  return 0
}
