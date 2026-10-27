# Actualizar

Cómo pasar a una versión nueva y volver atrás si hace falta. Antes de empezar, lee las notas de la versión en el
[CHANGELOG](../CHANGELOG.md): avisa cuando hay que reiniciar Hermes o cambiar algo en el `.env`.

**No actualices con trabajos de IA en marcha ni cerca de un plazo de presentación.** El monitor se reinicia y puede
tocar reiniciar Hermes, lo que corta los runs en curso. Mira la pastilla *Hermes* de la barra lateral: debe estar
quieta.

## Pasos

1. **Haz una copia.** Con todo parado, para que SQLite quede consistente. Lo que no se puede reconstruir está en los
   volúmenes `plataforma_data` (usuarios, equipo, ofertas, memorias) y `hermes_data` (sesiones, perfiles y las claves de
   tu proveedor de IA), y en el `.env`:

   ```bash
   P=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$(docker compose ps -q monitor)")
   docker compose stop
   for v in plataforma_data hermes_data; do
     docker run --rm -v "${P}_$v:/v:ro" -v "$PWD:/copia" alpine tar czf "/copia/$v-$(date +%F).tgz" -C /v .
   done
   docker compose start
   ```

   Guarda las copias, y una del `.env`, fuera del servidor (el `.env` lleva claves: cifrado o en un gestor de secretos).

   Qué se guarda y cómo restaurarlo, con todas las variantes, está en
   [operacion.md](operacion.md#copias-de-seguridad-y-restauración).

2. **Elige la versión.** En el `.env`, `SOBRE_ABIERTO_VERSION=1.1.0`. Los archivos Compose y las imágenes de una
   versión van juntos: si instalaste con el script, `--actualizar` baja los de esa versión; si instalaste con un clon
   del repositorio, haz `git checkout v1.1.0` (o `git pull`).

3. **Despliega.**

   ```bash
   bash install.sh --actualizar          # con un clon: docker compose pull && docker compose up -d
   docker compose logs --tail 100 monitor
   ```

   `--actualizar` vuelve a bajar los Compose, `.env.example` y el propio script de esa versión (el `.env` no se toca),
   descarga las imágenes y arranca.

   Compose recrea solo lo que cambia, y `hermes-init` vuelve a correr para instalar las skills nuevas.

4. **Comprueba.** Entra en la web. Si estaba abierta, avisará «Hay una versión nueva de la plataforma» y pedirá
   recargar. Las sesiones siguen abiertas.

5. **Reinicia Hermes si hace falta.** Hermes carga sus skills y la lista de herramientas solo al arrancar. Si la
   versión las cambia, los trabajos de IA esperarán con «herramientas desfasadas» hasta que lo reinicies, con la cola
   quieta: `docker compose restart hermes` (ver [operacion.md](operacion.md#reiniciar-hermes)).

## Qué pasa con los datos

Las migraciones de las bases son automáticas al arrancar el monitor y solo añaden columnas, tablas e índices. Algunas
rellenan datos una vez y el monitor tarda en responder (segundos, o minutos con bases grandes). La Biblioteca puede
reindexarse.

## Volver atrás

1. Pon la versión anterior en `SOBRE_ABIERTO_VERSION` y ejecuta `bash install.sh --actualizar` (con un clon: `git checkout` de esa versión y `docker compose pull && docker compose up -d`).
2. Si no arranca con las bases ya migradas, restaura la copia del paso 1.

Si compilas desde el código (`deploy/docker-compose.build.yml`), usa `git checkout <versión anterior>` y
`docker compose -f docker-compose.yml -f deploy/docker-compose.build.yml up -d --build`.

## Actualizar Hermes

La imagen de Hermes es la oficial de NousResearch, con la versión fijada en `HERMES_IMAGE_TAG`. El valor por defecto
del Compose es el que se probó con cada versión de Sobre Abierto: cámbialo solo si lo necesitas, y reinicia Hermes con
la cola quieta.
