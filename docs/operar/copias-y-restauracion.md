# Copias de seguridad y restauración

Qué copiar para no perder nada, cómo hacerlo en caliente o en frío y cómo restaurar desde los volúmenes o desde la
copia de Drive. Los comandos usan los atajos `$DC`, `$MON` y `$HB` de [La instalación en
producción](produccion.md#atajos-de-los-comandos).

Imprescindible: `nucleo.db` y `licitaciones.db` (volumen `plataforma_data`), los datos de Hermes
(volumen `hermes_data`) y las variables del Compose, guardadas fuera del servidor. El histórico
de adjudicaciones se puede recargar desde la PLACSP; las ofertas, decisiones, memorias y el
equipo, no. Conocimiento, Salidas y Agent Studio ya están en Drive; `drive_sync_state` y
`vault_data` son prescindibles (ver la tabla de volúmenes en
[Arquitectura en producción](produccion.md#arquitectura-en-producción)).

Hay dos formas, compatibles: la copia a Drive de drive-sync (ver [Copia de seguridad](drive.md#copia-de-seguridad) en
Google Drive), consistente pero sin secretos, y la copia de los volúmenes en tu servidor. Una
instantánea del disco es consistente; copiar archivos en caliente puede pillar una base SQLite a
medias. Copia las bases en caliente con `sqlite3` (viene en la imagen de drive-sync), o todo con
la plataforma parada. La copia en caliente usa el contenedor `drive-sync`: sin Drive (sin ese servicio) haz
la copia en frío. Compose antepone el nombre del proyecto a los volúmenes
(`docker volume ls | grep _hermes_data`).

```bash
F=$(date +%F)
for db in nucleo licitaciones; do              # en caliente, solo las bases
  $DC exec drive-sync sqlite3 /datos/$db.db ".backup '/tmp/$db-$F.db'"
  $DC cp drive-sync:/tmp/$db-$F.db ./ && $DC exec drive-sync rm /tmp/$db-$F.db
done

P=<proyecto>; $DC stop                          # en frío, todo (con la cola quieta)
for v in hermes_data plataforma_data drive_sync_state; do
  docker run --rm -v "${P}_$v:/v:ro" -v "$PWD:/copia" alpine tar czf "/copia/$v-$F.tgz" -C /v .
done
$DC up -d
```

**Restaurar los volúmenes:** con `$DC stop`, vacía cada volumen y vuelca su `.tgz`; al arrancar,
`hermes-init` corrige dueños y permisos.

```bash
docker run --rm -v "${P}_hermes_data:/v" -v "$PWD:/copia" alpine \
  sh -c 'rm -rf /v/* /v/.[!.]* && tar xzf /copia/hermes_data-<fecha>.tgz -C /v'
```

**Restaurar desde Drive:** descarga `Copias de seguridad/<fecha>/` (las bases están en la última
que tenga `plataforma/`), descomprime los `.gz` y, con la plataforma parada, quita los `-wal` y
`-shm` antiguos antes de copiar cada base:

```bash
$DC stop hermes $MON drive-sync
docker run --rm -v "${P}_plataforma_data:/datos" -v "$PWD:/copia" alpine sh -c \
  'rm -f /datos/*.db-wal /datos/*.db-shm && cp /copia/nucleo.db /copia/licitaciones.db /datos/ && chown 10000:10000 /datos/*.db'
docker run --rm -v "${P}_hermes_data:/v" -v "$PWD:/copia" alpine sh -c \
  'tar xzf /copia/hermes-data.tar.gz -C /v && rm -f /v/state.db-wal /v/state.db-shm && cp /copia/state.db /v/'
$DC up -d
```

En un servidor nuevo, antes del `up`, crea otra vez los `.env` de Hermes (`/opt/data/.env`) y de
cada perfil (`/opt/data/profiles/<perfil>/.env`) con las claves de los modelos y la
`API_SERVER_KEY` de cada perfil, la misma que su `HERMES_*_KEY`; `hermes-init` crea tokens nuevos.
Si se perdió `drive_sync_state`, conecta Drive en **Ajustes › Drive** con la misma carpeta:
Conocimiento, Salidas y Agent Studio vuelven sin borrar nada y la Biblioteca se reindexa sola.

Al cambiar de servidor, para el antiguo antes de arrancar el nuevo: dos Hermes con las mismas
cuentas de mensajería responderían dos veces. Después, entra en la web y comprueba que están los
usuarios y las ofertas.
