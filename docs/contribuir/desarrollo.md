# Desarrollo

Cómo trabajar en el código: requisitos, comprobaciones, datos de prueba y recorridos e2e. Los
comandos de uso diario están también en `CLAUDE.md` y en la tabla de «Todos los comandos», abajo.

## Requisitos

- Node 22 o posterior. El repo es un workspace de npm con dos apps: `apps/server` (Node +
  TypeScript) y `apps/web` (React + Vite).
- `npm ci` en la raíz instala las dos.
- Docker solo hace falta para probar la imagen. En Windows, Docker no construye desde una carpeta
  sincronizada en la nube: usa un clon fuera de ella o el CI.

## Antes de abrir un PR

Desde la raíz, todo en verde:

```sh
npm test            # server (tsx --test) y web (node --test)
npm run typecheck   # server
npm run lint        # server y web, sin avisos
npm run format:check # Prettier (npm run format lo arregla)
npm run licencias   # ninguna dependencia con licencia incompatible con la AGPL
npx knip            # sin archivos, exports ni dependencias sin uso
npm run build
```

Es lo mismo que comprueba el CI. Los recorridos e2e no van en el CI: córrelos en local antes de
cerrar una rama (ver abajo).

## Datos de prueba

El repo no lleva datos reales de ninguna empresa, persona, cliente ni oferta:

- **Empresa:** `apps/server/tests/fixtures/empresaEjemplo.ts` (y `apps/web/tests/fixtures/empresaEjemplo.mjs`
  para la web) es «Analítica Ejemplo, S.L.», con un NIF de control válido y provincia 00, que no
  puede ser de nadie.
- **Personas:** nombres ficticios en los tests («Ana García Pérez», «Luis Prueba»…) y «Persona A»,
  «Persona B»… en los fixtures, con perfiles genéricos.
- **Licitaciones:** los fixtures de `apps/server/tests/licitaciones/fixtures/` (`comprobaciones/`, `cambios/`,
  `ofertas/`, `costes/`, `casoA.ts`, `casoB.ts`, `eval/casoG/`…) son casos inventados (casoA…casoG)
  con la forma de una oferta de verdad. Los PDF de pliego, los DEUC y la página del expediente se
  generan en el propio test (`fixtures/documentos/*.ts`, con `pdf-lib`); solo los `.atom` de la
  PLACSP y el ejemplo oficial de la UE (`fixtures/documentos/espd-referencia/`) son documentos
  públicos.
- `fixtures/perfilesGenericos.mjs` quita lo que identifica a alguien (cargo exacto, titulaciones,
  certificaciones raras, años exactos, empresa, sedes y lugares) y
  `node tests/licitaciones/fixtures/generalizarFixtures.mjs` (desde `apps/server`) lo aplica a los
  fixtures. Es idempotente: en un árbol limpio no cambia nada.

Si añades un fixture, invéntalo; no copies una oferta, un pliego anotado ni un CV. La estructura de los tests y de sus
fixtures está en [apps/server/tests/README.md](../../apps/server/tests/README.md).

## Recorridos e2e (Playwright)

```sh
npm run e2e -w @sobre-abierto/web
```

Hay dos bancos:

- **fixtures** (`apps/web/e2e/*.spec.js`): la web responde desde `apps/web/e2e/datos/<caso>.json`,
  sin servidor. Esos JSON se generan con las rutas del servidor sobre los fixtures de las comprobaciones:
  `npm run e2e:datos -w @sobre-abierto/server`. Regenéralos cuando cambien los fixtures o lo que
  devuelve una ruta.
- **servidor** (`apps/web/e2e/*.spec.mjs`): compila la web y arranca un servidor propio.

### Accesibilidad

`e2e/accesibilidad.spec.js` pasa `@axe-core/playwright` (reglas WCAG 2 A y AA) por las pantallas principales, el login,
la Biblioteca y las pestañas de Ajustes con datos en los fixtures, y
exige cero violaciones graves (`serious` y `critical`). También comprueba que la barra lateral se maneja con el
teclado y que el foco se ve. Si añades una pantalla importante, añádela a la lista `PANTALLAS`.

### Capturas de referencia

`e2e/visual.spec.js` compara las pantallas clave con capturas de referencia y comprueba que no
hay desplazamiento horizontal a 400 px. Las referencias **no están en el repo**
(`apps/web/e2e/*-snapshots/` está en `.gitignore`): dependen del sistema y de las fuentes de cada
máquina. La primera vez, genéralas en la tuya:

```sh
cd apps/web
npx playwright test e2e/visual.spec.js --project=fixtures --update-snapshots=all
```

Revísalas a ojo (están en `apps/web/e2e/visual.spec.js-snapshots/`). Desde entonces,
`npm run e2e -w @sobre-abierto/web` compara contra ellas: un cambio de más de un 0,2 % de
píxeles falla. Si el cambio es a propósito, vuelve a generarlas con la misma orden y revísalas.

### Capturas de la documentación y de la web

Las imágenes de esta documentación (los huecos `<!-- captura: id · descripción -->`) y las de la web del producto
salen de un script de Playwright aparte, que no entra en `npm test` ni en `npm run e2e`:

```sh
CAPTURAS_DIR=/ruta/de/salida npm run capturas -w @sobre-abierto/web
```

Reutiliza el banco de fixtures (el build servido con `vite preview`, sin API detrás) con los datos sintéticos de
`apps/web/e2e/capturas-datos.js` encima: la empresa ficticia, «Persona A…» y órganos «de Ejemplo». Escribe
`docs/<id>.png` y `web/<id>.png` en `CAPTURAS_DIR`, a 1440 px de ancho y a 2x (a 1x si una pasa de 400 KB). Cada
captura está en `apps/web/e2e/capturas.captura.js`: una pantalla nueva con hueco en la documentación lleva su
captura ahí. Si el Chromium de Playwright no está instalado, `CAPTURAS_CHROME` apunta a otro (p. ej. el Chrome del
sistema). Mira cada imagen antes de publicarla: que enseñe lo que dice su descripción y nada que parezca real.

## Estructura del repo

```
apps/
  server/   TypeScript, Express + Socket.io: API, login, proxy al dashboard de Hermes,
            el motor de la Biblioteca de Conocimiento (src/biblioteca), el núcleo de la
            plataforma (src/nucleo: agentes, MCP, cola de IA, colaboradores) y su dominio
            (src/dominios/licitaciones), todo en el mismo proceso
  web/      React + Vite: la interfaz
infra/
  Dockerfile           imagen del monitor (web + server con biblioteca, núcleo y dominios)
  drive-sync/          sincronizador con Google Drive (rclone)
  hermes-init/         prepara el volumen de Hermes: skills propias, token, permisos
docs/                 instalación, configuración, operación, arquitectura, MCP, memoria técnica y FAQ
```

Detalle técnico en [Arquitectura](../como-esta-hecho/arquitectura.md); operación de una instalación en
[Operar](../operar/README.md).

## Todos los comandos

Node 22+. Un solo `npm install` en la raíz instala todas las apps (npm workspaces).

| Comando | Qué hace |
|---|---|
| `npm install` | Instala las dependencias de todas las apps |
| `npm run build` | Compila el server (`apps/server/dist`) y la web (`apps/web/dist`) |
| `npm run dev:server` | Server en `:3110` con recarga (tsx); sirve la web compilada |
| `npm run dev:web` | Vite en `:5173` con proxy al server, para trabajar en la web |
| `npm test` | Tests de todas las apps |
| `npm run typecheck` | Typecheck del server |
| `npm run lint` | ESLint de server y web (sin avisos; lo exige el CI) |
| `npm run format:check` | Comprueba el formato con Prettier (lo exige el CI). `npm run format` formatea todo el repo |
| `npx knip` | Archivos, exports y dependencias sin uso (configuración en la clave `knip` de `package.json`; no es una dependencia del repo). Debe salir limpio |
| `npm run docs:mcp -w @sobre-abierto/server` | Regenera `docs/referencia/mcp.md` (tools MCP y permisos) a partir del registro de tools. Un test falla si el archivo está desfasado |
| `npm run licencias` | Revisa la licencia de cada dependencia del `package-lock.json` y falla si alguna es incompatible con la AGPL (SSPL, BUSL, Commons Clause, no comercial, GPL-2.0 sin «o posterior», sin licencia). Lo exige el CI |
| `npm run e2e -w @sobre-abierto/web` | Recorridos e2e con Playwright, en dos bancos: `servidor` (`*.spec.mjs`: aviso de versión, `409 version_antigua`, lotes) compila su propia web y arranca un servidor con datos temporales; `fixtures` (`*.spec.js`: lista, ficha, Comprobaciones) sirve el build con `vite preview` en `:4173` y responde la API desde `apps/web/e2e/datos` (`e2e/api.js`), sin servidor ni Socket.io. Uno solo: `npm run e2e -w @sobre-abierto/web -- --project fixtures`. La primera vez, `npx playwright install chromium`. No entra en `npm test` ni en el CI de GitHub (a propósito): se lanza en local antes de dar por cerrada una rama |
| `CAPTURAS_DIR=<carpeta> npm run capturas -w @sobre-abierto/web` | Saca las capturas de la documentación y de la web con datos sintéticos sobre el banco de fixtures (ver «Capturas de la documentación y de la web», arriba). Fuera de `npm test` y de `npm run e2e` |
| `npm run e2e:datos -w @sobre-abierto/server` | Regenera `apps/web/e2e/datos/<oferta>.json` (y los `casoE.impacto.*.json`) con las rutas reales sobre los fixtures de las comprobaciones de las 5 ofertas, en una base temporal y con el reloj en la hora de la captura. Falla sin escribir nada si una respuesta lleva un NIF de persona, un correo o un teléfono. Hay que lanzarlo cuando cambie una respuesta de la API que lean los recorridos |

### Scripts de `apps/server/scripts/`

Ninguno hace falta para ejecutar la plataforma; son herramientas de desarrollo y de calidad. Todos trabajan sobre
bases temporales y fixtures sintéticos, y ninguno lee un `.env` ni toca datos reales.

| Script | Para qué |
|---|---|
| `npm run e2e:datos -w @sobre-abierto/server` | Regenera los datos de los e2e (`respuestasE2E.ts`). |
| `npm run docs:mcp -w @sobre-abierto/server` | Regenera `docs/referencia/mcp.md` (`generarDocsMcp.ts`). |
| `npm run demo:base -w @sobre-abierto/server -- [destino]` | Crea una base local nueva con las cinco ofertas de ejemplo, para recorrer la web a mano (`baseDemo.ts`). |
| `npm run banco:respuestas -w @sobre-abierto/server -- preparar\|puntuar <dir>` | Banco de 30 respuestas libres del asistente de la oferta para medir un modelo; hacen falta 27 aciertos (`bancoRespuestas.ts`). |
| `npx tsx scripts/evalMemorias.ts --caso casoG` | Banco de pruebas de memorias: encola juicios ciegos por pares de un caso de `tests/licitaciones/fixtures/eval/` y compara el veredicto con el esperado (`evalMemorias.ts`). |
| `npx tsx scripts/generarCpv.ts <cpv_2008.xml>` | Regenera `src/datos/cpv.json` con el vocabulario CPV oficial de la UE; solo hace falta si la UE publica otra versión (`generarCpv.ts`). |

Para desarrollo local, copia `.env.dev.example` a `.env` en la raíz y ajústalo.

Imágenes de Docker, compilando desde el código:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.build.yml build
```

> En Windows con el repo dentro de OneDrive, Docker Desktop no puede leer los archivos
> que OneDrive guarda como marcadores ("unknown file mode"). Construye desde un clon
> fuera de OneDrive o deja que lo haga el CI.
