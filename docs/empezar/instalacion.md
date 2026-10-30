# Instalación

Sobre Abierto corre en un servidor tuyo con Docker. Esta guía cubre los requisitos, las tres formas de instalarlo, el
primer acceso y la elección del proveedor de IA. Cuando la web abra, sigue con [Primeros pasos](primeros-pasos.md); para
ajustarla, [Configuración](configuracion.md), y para mantenerla después, la sección [Operar](../operar/README.md).

## Requisitos

- Un servidor Linux (amd64 o arm64) con **Docker 24 o posterior y Compose v2**. Mínimo 6 GB de memoria (se
  recomiendan 8 GB), 2 CPU y 20 GB de disco. La Biblioteca calcula sus embeddings en el propio servidor, lo que
  explica gran parte de la memoria.
- Una cuenta de un proveedor de IA (Anthropic, OpenAI, OpenRouter…) o un modelo local. Es lo único que cuesta dinero.
- Opcional: un dominio apuntando al servidor, para HTTPS, y una cuenta de Google, para sincronizar con Drive.
- Opcional: un servidor SMTP, para los avisos por correo.

## Con el script (10–15 minutos)

Descárgalo, léelo y ejecútalo:

```bash
curl -fsSLO https://raw.githubusercontent.com/datagrowth/sobre-abierto/main/install.sh
less install.sh
bash install.sh
```

El script:

1. Comprueba Docker, Compose v2, la arquitectura y que los puertos estén libres.
2. Pregunta el correo del administrador, el dominio (opcional) y el proveedor de IA.
3. Genera el `.env` desde `.env.example` con claves aleatorias.
4. Arranca los servicios y espera a que el monitor responda.
5. Crea los tres perfiles de Hermes (`licitaciones`, `oferta-licitaciones` y `critico-licitaciones`) y los conecta con
   el servidor MCP de la plataforma.
6. Enseña la dirección, el usuario y una contraseña inicial que la web te pide cambiar al entrar.

Sin terminal interactiva, pásale las respuestas por variables:

```bash
ADMIN_EMAIL=tu@correo.es DOMINIO=licitaciones.tuempresa.es \
LLM_PROVEEDOR=anthropic LLM_API_KEY=sk-ant-... bash install.sh
```

Puedes ejecutarlo otra vez cuando quieras: **no cambia ningún valor que ya esté en el `.env`** y solo reinicia Hermes si
algo de los perfiles cambió. Si no llega a GHCR, sigue con las imágenes que ya tenga. `bash install.sh --ayuda` lista
todas las variables y opciones; para pasar a otra versión, ver [Actualizar](actualizar.md).

## Con Compose a mano

```bash
git clone https://github.com/datagrowth/sobre-abierto.git && cd sobre-abierto
cp .env.example .env            # rellena las variables sin valor (claves: openssl rand -hex 32)
docker compose up -d
```

- Con HTTPS automático (Caddy) y un `DOMINIO` en el `.env`:
  `docker compose -f docker-compose.yml -f deploy/docker-compose.caddy.yml up -d`. Los puertos 80 y 443 deben estar libres.
- Con Google Drive: añade `--profile drive`.
- Para compilar las imágenes en vez de descargarlas: `-f deploy/docker-compose.build.yml`.

Los perfiles de Hermes los crea `install.sh`. Si instalas a mano, créalos como indica
[Perfiles de Hermes](../operar/perfiles-de-hermes.md).

## Con un panel (Dokploy, Coolify, Easypanel)

Las plantillas y los pasos de cada panel están en [deploy/](../../deploy/README.md).

## Primer acceso

Entra con el correo y la contraseña que enseñó el script. Por defecto la web escucha en `http://localhost:3110`; en un
servidor remoto, abre un túnel con `ssh -L 3110:127.0.0.1:3110 usuario@servidor` o usa tu dominio. Nunca publiques el
puerto sin HTTPS: lleva contraseñas. Antes de abrirlo a Internet, repasa
[Seguridad del servidor](../operar/seguridad.md).

**Si pierdes el acceso.** La contraseña del `.env` (`MONITOR_BASIC_AUTH_PASSWORD`) es solo la inicial: en cuanto un
administrador elige la suya, deja de entrar. Para recuperarla, desde el servidor:
`docker compose exec monitor node apps/server/dist/recuperarAcceso.js tu@correo` escribe una contraseña temporal que la
web te obliga a cambiar al entrar. Más en [Usuarios y recuperación de acceso](../operar/usuarios-y-acceso.md).

La primera pantalla, el Pipeline, te lleva por los **primeros pasos**: el perfil de tu empresa, qué licitaciones
buscar, la IA y, si quieres, Google Drive y el correo. Están explicados uno a uno en [Primeros pasos](primeros-pasos.md).

## Proveedor de IA

Toda la IA corre en Hermes: la plataforma no tiene claves de ningún modelo. Hermes usa tres perfiles, cada uno con su
modelo, y se cambian en Ajustes › Hermes sin reinstalar.

| Perfil | Hace | Qué modelo poner |
|---|---|---|
| `licitaciones` | Criba, fichas, actas | Uno rápido y barato: es el que más trabajo hace. Con Anthropic, `claude-sonnet-5-5` (el que pone el instalador); `claude-haiku-5-5` gasta menos, pero no hemos medido su criba. |
| `oferta-licitaciones` | Guion, memoria técnica, anexos | El mejor que puedas pagar: de él depende la calidad de la oferta. Con Anthropic, `claude-opus-5-5`. |
| `critico-licitaciones` | Crítico ciego de la memoria | **De otra familia** que el de oferta. Con el mismo modelo tiende a darse buena nota; la web lo avisa. Con OpenRouter una clave da varias familias (oferta de Anthropic y crítico de OpenAI o Google); con una sola clave de Anthropic u OpenAI, ponlo cuando tengas una segunda. |

`install.sh` acepta `anthropic`, `openai`, `openrouter` y `local` (cualquier servidor compatible con OpenAI, como
Ollama o LM Studio, con `LLM_URL`). Con `MODELO_LICITACIONES`, `MODELO_OFERTA` y `MODELO_CRITICO` eliges el modelo de
cada perfil; sin ellos, con Anthropic se usa `claude-sonnet-5-5` y, con otro proveedor, el script te lo pregunta. Con
terminal también pregunta el modelo de la oferta y el del crítico; sin ella usan el de la criba y el script avisa de
que el crítico no es de otra familia. Con `LLM_PROVEEDOR=ninguno` lo dejas para después: el radar funciona sin IA, y los trabajos de IA esperan hasta que haya
un perfil configurado.

### Cuánto cuesta una licitación

Depende de los modelos y de sus precios, que cambian, y **no tenemos una cifra medida de la oferta completa**. Cada ficha y cada ejecución de Hermes guardan el modelo y los
tokens que gastaron (en *Detalles técnicos* de la ficha). Para ponerle cifra a tu caso, prepara cinco licitaciones,
suma los tokens por perfil y multiplica por el precio de tu proveedor. Como orden de magnitud, una ficha completa
gasta entre 0,4 y 1 millón de tokens (el orden de magnitud que da `.env.example`): a un precio medio de, por ejemplo,
3 € por millón de tokens (entrada y salida mezcladas; es un ejemplo, mira el de tu proveedor) saldría entre 1,2 y 3 €
por ficha. Si tu proveedor tiene cupo, limita la concurrencia con `HERMES_RUNS_A_LA_VEZ`.

## Google Drive (opcional)

Sin Drive, la Biblioteca y las carpetas de cada licitación están en el disco del servidor, y el radar, la ficha y la
oferta funcionan igual. Con Drive, esas carpetas se sincronizan en ambos sentidos con tu cuenta y, si pones
`GDRIVE_BACKUP=1` en el `.env`, se hace una copia de seguridad diaria. Arranca con `--profile drive` y conéctalo en Ajustes › Drive con tu propio cliente OAuth de
Google; los pasos están en [Google Drive](../operar/drive.md).

## Si algo falla

| Síntoma | Qué mirar |
|---|---|
| El script dice que falta Docker Compose v2 | `docker compose version` debe responder; el antiguo `docker-compose` no vale. |
| La web no abre | `docker compose ps` y `docker compose logs --tail 100 monitor`. Si hay un error de configuración, el monitor sale con la lista de variables inválidas. |
| Entras, pero la IA no responde | Ajustes › Hermes: ¿los tres perfiles tienen modelo y clave? Reinicia Hermes después de cambiarlos (ver [Reiniciar Hermes](../operar/reiniciar-hermes.md)). |
| No llegan oportunidades | Ajustes › Fuentes y filtros: ¿hay CPV propios y no los de ejemplo? La sincronización corre cada 15 minutos. |
| El puerto 3110 está ocupado | Cambia `MONITOR_PUERTO` en el `.env` y vuelve a ejecutar `docker compose up -d`. |

Más preguntas frecuentes en [Preguntas frecuentes](../referencia/faq.md).
