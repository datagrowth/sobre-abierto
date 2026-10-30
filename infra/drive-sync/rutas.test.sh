#!/bin/sh
# Pruebas de rutas.sh: drive-sync no escribe ni borra fuera del volumen compartido aunque
# Hermes cambie carpetas por enlaces simbólicos. Sin red: rclone y log son funciones falsas;
# hace falta jq (lo trae la imagen de drive-sync y el runner de CI).
# Uso: sh infra/drive-sync/rutas.test.sh (también con dash o el ash de busybox).
set -u
. "$(dirname "$0")/rutas.sh"

fallos=0
pasa() { printf 'ok   %s\n' "$1"; }
falla() { printf 'FALLA %s\n' "$1"; fallos=$((fallos + 1)); }
igual() { if [ "$2" = "$3" ]; then pasa "$1"; else falla "$1: esperaba «$2», salió «$3»"; fi; }
cierto() { n="$1"; shift; if "$@"; then pasa "$n"; else falla "$n"; fi; }
falso() { n="$1"; shift; if "$@"; then falla "$n"; else pasa "$n"; fi; }
calla() { "$@" > /dev/null 2>&1; }

# Ruta física: en algunos sistemas el directorio temporal cuelga de un enlace (/var en macOS).
RAIZ="$(cd "$(mktemp -d)" && pwd -P)"
trap 'rm -rf "$RAIZ"' EXIT
STATE="$RAIZ/state"
DATOS="$RAIZ/datos"
CONO="$RAIZ/opt-data/conocimiento"

# Lo que hay en «Drive»: rutas de Google Docs (tamaño -1), una por línea, y un PDF normal.
GDOCS=""
rclone() {
  case "$1" in
    lsjson)
      printf '%s\n' "$GDOCS" | jq -R . | jq -s 'map(select(. != "") | {Path: ., Size: -1}) + [{Path: "normal.pdf", Size: 100}]' ;;
    # Como rclone: escribe en la ruta destino tal cual (el sistema seguiría un enlace).
    copy)
      while IFS= read -r doc; do
        mkdir -p "$(dirname "$3/$doc")" && echo "doc" > "$3/$doc"
      done < "$5" ;;
  esac
}
log() { :; }

preparar() {
  rm -rf "$RAIZ/opt-data" "$DATOS" "$STATE"
  mkdir -p "$CONO" "$DATOS/licitaciones" "$STATE"
  echo base > "$DATOS/nucleo.db"
  echo base > "$DATOS/licitaciones/licitaciones.db"
  : > "$STATE/filtros.txt"
}
datos_intactos() {
  [ "$(find -P "$DATOS" | sort | tr '\n' ' ')" = "$DATOS $DATOS/licitaciones $DATOS/licitaciones/licitaciones.db $DATOS/nucleo.db " ] \
    && [ "$(cat "$DATOS/nucleo.db")" = base ]
}
exportar() { GDOCS="$1"; export_gdocs Conocimiento "$CONO" "$STATE/filtros.txt"; }

# ─── El fallo original: .gdocs cambiado por un enlace a /datos ──────────────
preparar
ln -s "$DATOS" "$CONO/.gdocs"
exportar "Informe.docx"
cierto should_not_delete_outside_when_gdocs_is_a_symlink datos_intactos
falso should_not_download_docs_into_the_symlink_target test -e "$DATOS/Informe.docx"
falso should_replace_the_gdocs_symlink test -L "$CONO/.gdocs"
cierto should_download_docs_into_a_real_gdocs_folder test -f "$CONO/.gdocs/Informe.docx"

preparar
ln -s "$DATOS" "$CONO/.gdocs"
exportar ""
cierto should_not_delete_outside_when_drive_has_no_docs_and_gdocs_is_a_symlink datos_intactos
falso should_drop_the_gdocs_symlink_when_drive_has_no_docs test -e "$CONO/.gdocs"

preparar
mkdir -p "$CONO/.gdocs"
ln -s "$DATOS/licitaciones" "$CONO/.gdocs/Licitaciones"
exportar "Licitaciones/Pliego.docx"
cierto should_not_write_through_a_symlink_inside_gdocs datos_intactos
cierto should_replace_symlinked_subfolder_with_a_real_one test -f "$CONO/.gdocs/Licitaciones/Pliego.docx"
falso should_leave_no_symlink_inside_gdocs test -L "$CONO/.gdocs/Licitaciones"

preparar
ln -s "$DATOS" "$RAIZ/opt-data/enlazada"
GDOCS="Informe.docx"
export_gdocs Conocimiento "$RAIZ/opt-data/enlazada" "$STATE/filtros.txt"
cierto should_not_touch_anything_when_the_synced_folder_is_a_symlink datos_intactos
falso should_not_create_gdocs_through_a_symlinked_parent calla carpeta_propia "$RAIZ/opt-data/enlazada/.gdocs"

# ─── Limpieza normal de .gdocs ─────────────────────────────────────────────
preparar
mkdir -p "$CONO/.gdocs/Viejos"
echo doc > "$CONO/.gdocs/Viejos/Borrado.docx"
echo doc > "$CONO/.gdocs/Informe.docx"
exportar "Informe.docx
Con espacio y ñ.xlsx"
cierto should_keep_docs_still_in_drive test -f "$CONO/.gdocs/Informe.docx"
cierto should_download_new_docs_with_spaces_and_accents test -f "$CONO/.gdocs/Con espacio y ñ.xlsx"
falso should_delete_docs_no_longer_in_drive test -e "$CONO/.gdocs/Viejos/Borrado.docx"
falso should_delete_folders_left_empty test -e "$CONO/.gdocs/Viejos"

preparar
ln -s "$DATOS" "$CONO/.gdocs"
echo "otro.docx" > "$STATE/lista.txt"
borrar_sobrantes "$CONO/.gdocs" "$STATE/lista.txt"
cierto should_not_clean_a_folder_that_is_a_symlink datos_intactos

# ─── Carpetas sincronizadas con enlaces (bisync no debe usarlas) ─────────────
preparar
cierto should_accept_a_folder_without_symlinks calla test -z "$(enlace_que_saca "$CONO")"
falso should_accept_a_folder_that_does_not_exist_yet calla enlace_que_saca "$RAIZ/opt-data/salidas"
ln -s "$DATOS" "$RAIZ/opt-data/salidas"
igual should_flag_a_synced_folder_that_is_a_symlink "$RAIZ/opt-data/salidas" "$(enlace_que_saca "$RAIZ/opt-data/salidas")"
ln -s "$DATOS" "$RAIZ/opt-data/skills"
igual should_flag_a_symlink_in_a_parent_folder "$RAIZ/opt-data/skills" "$(enlace_que_saca "$RAIZ/opt-data/skills/empresa")"
mkdir -p "$CONO/Licitaciones"
ln -s "$DATOS" "$CONO/Licitaciones/Bases"
igual should_flag_a_symlink_to_a_folder_inside "$CONO/Licitaciones/Bases" "$(enlace_que_saca "$CONO")"
rm "$CONO/Licitaciones/Bases"
ln -s "$DATOS/nucleo.db" "$CONO/Licitaciones/base.db"
falso should_ignore_symlinks_to_files_which_rclone_skips calla enlace_que_saca "$CONO"
ln -s "$DATOS" "$CONO/.gdocs"
falso should_ignore_gdocs_which_export_gdocs_repairs calla enlace_que_saca "$CONO"
cierto should_never_touch_the_symlink_targets_while_checking datos_intactos

if [ "$fallos" -gt 0 ]; then
  echo "$fallos pruebas fallidas"
  exit 1
fi
echo "rutas.sh: todas las pruebas pasan"
