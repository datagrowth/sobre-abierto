#!/bin/sh
# Pruebas de las decisiones de la copia de seguridad (copia.sh), sin red ni rclone.
# Uso: sh infra/drive-sync/copia.test.sh (también con dash o el ash de busybox).
set -u
. "$(dirname "$0")/copia.sh"

fallos=0
pasa() { printf 'ok   %s\n' "$1"; }
falla() { printf 'FALLA %s\n' "$1"; fallos=$((fallos + 1)); }

# igual <nombre> <esperado> <obtenido>
igual() {
  if [ "$2" = "$3" ]; then pasa "$1"; else falla "$1: esperaba «$2», salió «$3»"; fi
}
# cierto <nombre> <comando...>: el comando devuelve 0.
cierto() { n="$1"; shift; if "$@"; then pasa "$n"; else falla "$n"; fi; }
# falso <nombre> <comando...>: el comando devuelve distinto de 0.
falso() { n="$1"; shift; if "$@"; then falla "$n"; else pasa "$n"; fi; }
# calla <comando...>: el comando sin su salida, para mirar solo lo que devuelve.
calla() { "$@" > /dev/null; }

DIA=86400
AHORA=1790000000

igual should_enable_backup_by_default "1" "$(copia_interruptor '')"
igual should_disable_backup_when_switch_is_0 "0" "$(copia_interruptor 0)"
igual should_accept_false_as_off "0" "$(copia_interruptor false)"
igual should_accept_off_in_capitals "0" "$(copia_interruptor OFF)"
igual should_ignore_spaces_around_switch "0" "$(copia_interruptor '0 ')"
igual should_accept_yes_synonyms "1 1 1" "$(copia_interruptor true) $(copia_interruptor Si) $(copia_interruptor sí)"
falso should_flag_invalid_switch copia_interruptor quizá
igual should_print_nothing_when_switch_is_invalid "" "$(copia_interruptor quizá)"

igual should_default_keep_days_to_30 "30" "$(copia_dias_validos '')"
igual should_keep_valid_keep_days "1" "$(copia_dias_validos 1)"
igual should_drop_leading_zeros_from_keep_days "7" "$(copia_dias_validos 007)"
falso should_flag_zero_keep_days calla copia_dias_validos 0
igual should_never_keep_zero_days_which_would_delete_todays_copy "30" "$(copia_dias_validos 000)"
falso should_flag_non_integer_keep_days calla copia_dias_validos 7.5
igual should_fall_back_to_30_when_keep_days_is_not_a_number "30" "$(copia_dias_validos x)"

igual should_default_platform_to_weekly "semanal" "$(copia_modo_plataforma '')"
igual should_keep_valid_platform_mode "diaria" "$(copia_modo_plataforma diaria)"
falso should_flag_invalid_platform_mode calla copia_modo_plataforma mensual
igual should_fall_back_to_weekly_when_mode_is_invalid "semanal" "$(copia_modo_plataforma mensual)"

igual should_be_active_with_defaults "" "$(copia_motivo_off '' 4 /opt/data)"
igual should_say_why_when_switch_is_0 "GDRIVE_BACKUP=0" "$(copia_motivo_off 0 4 /opt/data)"
igual should_stay_off_with_the_old_hour_99_trick "GDRIVE_BACKUP_HOUR=99, fuera de 0-23" "$(copia_motivo_off 1 99 /opt/data)"
igual should_be_off_when_hour_is_not_a_number "GDRIVE_BACKUP_HOUR=x, fuera de 0-23" "$(copia_motivo_off 1 x /opt/data)"
igual should_be_off_when_hour_is_empty "GDRIVE_BACKUP_HOUR=, fuera de 0-23" "$(copia_motivo_off 1 '' /opt/data)"
igual should_accept_hour_with_leading_zero "" "$(copia_motivo_off 1 08 /opt/data)"
igual should_accept_last_hour_of_the_day "" "$(copia_motivo_off 1 23 /opt/data)"
igual should_be_off_without_source "GDRIVE_BACKUP_SOURCE vacío" "$(copia_motivo_off 1 4 '')"
igual should_prefer_explicit_switch_over_other_reasons "GDRIVE_BACKUP=0" "$(copia_motivo_off 0 99 '')"
igual should_say_switch_value_when_turned_off_with_a_synonym "GDRIVE_BACKUP=false" "$(copia_motivo_off false 4 /opt/data)"
igual should_turn_off_and_say_why_when_switch_is_invalid "GDRIVE_BACKUP=quizá no válido (usa 0 o 1)" "$(copia_motivo_off quizá 4 /opt/data)"
igual should_be_off_when_hour_has_too_many_digits "GDRIVE_BACKUP_HOUR=0004, fuera de 0-23" "$(copia_motivo_off 1 0004 /opt/data 2>&1)"
igual should_be_off_when_hour_is_not_an_integer "GDRIVE_BACKUP_HOUR=4.5, fuera de 0-23" "$(copia_motivo_off 1 4.5 /opt/data)"

falso should_wait_until_backup_hour copia_toca 3 4 0
cierto should_run_at_backup_hour copia_toca 4 4 0
cierto should_run_later_in_the_day_if_missed copia_toca 22 4 0
falso should_not_repeat_when_already_done_today copia_toca 10 4 1
cierto should_run_at_midnight_when_hour_is_0 copia_toca 0 0 0

cierto should_copy_platform_every_day_when_daily copia_plataforma_toca diaria "$AHORA" "$((AHORA - DIA))"
falso should_never_copy_platform_when_no copia_plataforma_toca no "$AHORA" ""
cierto should_copy_platform_when_never_copied copia_plataforma_toca semanal "$AHORA" ""
cierto should_copy_platform_when_last_mark_is_malformed copia_plataforma_toca semanal "$AHORA" "basura"
falso should_skip_platform_within_the_week copia_plataforma_toca semanal "$AHORA" "$((AHORA - 6 * DIA))"
cierto should_copy_platform_after_a_week copia_plataforma_toca semanal "$AHORA" "$((AHORA - 7 * DIA))"
cierto should_copy_platform_a_week_later_even_some_minutes_earlier copia_plataforma_toca semanal "$AHORA" "$((AHORA - 7 * DIA + 1800))"

# subir_copia y las marcas, con rclone y log falsos (sin red) en una carpeta de estado temporal.
STATE="$(mktemp -d)"
trap 'rm -rf "$STATE"' EXIT
KEEP_DAYS=30
LAST_BACKUP="$STATE/copia-ultima"
FALLA=""   # subcomando de rclone que falla (copy, delete, rmdirs) o vacío
REGISTRO="$STATE/registro.txt"
rclone() { echo "rclone $1" >> "$REGISTRO"; [ "$1" != "$FALLA" ]; }
log() { echo "log $*" >> "$REGISTRO"; }
subir() { FALLA="$1"; : > "$REGISTRO"; rm -f "$STATE"/backup-*; subir_copia /tmp/copia 2026-10-03; }

cierto should_succeed_when_upload_and_cleanup_work subir ""
cierto should_mark_the_day_after_uploading test -f "$STATE/backup-2026-10-03"
cierto should_succeed_when_only_old_copies_cleanup_fails subir rmdirs
cierto should_mark_the_day_even_if_cleanup_fails test -f "$STATE/backup-2026-10-03"
cierto should_log_when_cleanup_fails grep -q 'no se pudieron borrar las copias antiguas' "$REGISTRO"
cierto should_succeed_when_delete_of_old_copies_fails subir delete
falso should_fail_when_upload_fails subir copy
falso should_not_mark_the_day_when_upload_fails test -f "$STATE/backup-2026-10-03"
falso should_not_clean_up_when_upload_fails grep -q 'rclone delete' "$REGISTRO"
touch "$STATE/backup-2026-10-02"
subir ""
falso should_drop_previous_day_markers test -f "$STATE/backup-2026-10-02"

rm -f "$STATE"/backup-* "$LAST_BACKUP"
copia_heredar_ultima
falso should_not_invent_a_last_copy_without_markers test -f "$LAST_BACKUP"
touch -d '2026-10-02 04:01:00' "$STATE/backup-2026-10-02"
copia_heredar_ultima
cierto should_take_last_copy_from_previous_version_marker grep -Eq '^[0-9]+ 2026-10-0[12]T[0-9:]+Z$' "$LAST_BACKUP"
igual should_read_epoch_of_inherited_mark "$(date -r "$STATE/backup-2026-10-02" +%s)" "$(marca_epoch "$LAST_BACKUP")"
marcar "$LAST_BACKUP"
antes="$(cat "$LAST_BACKUP")"
copia_heredar_ultima
igual should_keep_last_copy_mark_when_it_exists "$antes" "$(cat "$LAST_BACKUP")"
falso should_have_no_iso_without_mark marca_iso "$STATE/no-existe"

if [ "$fallos" -gt 0 ]; then
  echo "$fallos pruebas fallidas"
  exit 1
fi
echo "copia.sh: todas las pruebas pasan"
