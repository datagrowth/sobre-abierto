# Sobre Abierto (hermes-agent)

Plataforma de código abierto para licitaciones públicas sobre Hermes Agent: núcleo (agentes, MCP,
cola de IA, colaboradores), el dominio Licitaciones y la Biblioteca de Conocimiento. Este archivo
da a quien contribuya con un agente (Claude Code u otro) los comandos, la estructura y las reglas
técnicas del repo.

Idioma: todo en español (nombres de dominio, commits, docs y comentarios).

## Fuentes de verdad

La documentación vive en `docs/`, una carpeta por sección y una página por tema; el índice de cada carpeta
(`README.md`) da el orden del menú del portal de documentación. Una página nueva se añade a ese índice.

- Qué hace y cómo se usa (la especificación funcional) → `docs/guia/`, una página por módulo (el `README.md` de la
  raíz es la portada)
- Cómo está hecho → `docs/como-esta-hecho/arquitectura.md`; memoria técnica → `docs/como-esta-hecho/memoria-tecnica.md`
- Instalar, configurar y actualizar → `docs/empezar/`; operar una instalación → `docs/operar/`
- Variables, roles y FAQ → `docs/referencia/`; herramientas MCP y permisos → `docs/referencia/mcp.md` (generado:
  `npm run docs:mcp -w @sobre-abierto/server`)
- Desarrollo y pruebas → `docs/contribuir/desarrollo.md`

Busca la sección con Grep en vez de leer las páginas enteras.

## Comandos

Node 22+, npm workspaces (`apps/server`, `apps/web`). Desde la raíz:

| Comando | Qué hace |
|---|---|
| `npm test` | Tests de todas las apps (server: `tsx --test`, web: `node --test`) |
| `npm run typecheck` | Typecheck del server |
| `npm run lint` | ESLint de server y web, sin avisos (lo exige el CI) |
| `npm run format:check` | Comprueba el formato con Prettier (lo exige el CI); `npm run format` lo arregla |
| `npm run licencias` | Falla si una dependencia trae una licencia incompatible con la AGPL (lo exige el CI) |
| `npx knip` | Archivos, exports y dependencias sin uso; debe salir limpio |
| `npm run build` | Compila server y web |
| `npm run dev:server` / `npm run dev:web` | Server en `:3110` / Vite en `:5173` |
| `npm run e2e -w @sobre-abierto/web` | Playwright (fixtures, servidor y móvil). Solo en local, antes de cerrar una rama; no va en el CI de GitHub |
| `npm run e2e:datos -w @sobre-abierto/server` | Regenera los datos de los e2e (`apps/web/e2e/datos`) desde los fixtures de las comprobaciones |

Un test suelto: `cd apps/server && npx tsx --test tests/<ruta>.test.ts`.
Docker no construye desde una carpeta sincronizada (OneDrive, Dropbox) en Windows: usa un clon
fuera de ella o el CI.

## Mapa rápido

- `apps/server/src/nucleo/` — agentes, MCP, cola de IA, usuarios, avisos, colaboradores y el cliente de Hermes
- `apps/server/src/dominios/licitaciones/` — radar, ficha, propuestas, oferta y memoria técnica
- `apps/server/src/biblioteca/` — motor de la Biblioteca de Conocimiento
- `apps/web/` — React + Vite
- `infra/` — Dockerfile, `drive-sync`, `hermes-init` y las
  skills de Hermes que instala (`infra/hermes-init/skills/`)

## Reglas técnicas

- **Toda la IA corre en Hermes.** El monitor no tiene claves de LLM; pide trabajos a Hermes
  por la cola y las tools MCP.
- **Drive es la única fuente de verdad del conocimiento.** Hermes solo propone notas; no
  escribe en la Biblioteca por su cuenta.
- **Los datos de CV solo van a Hermes en el run del perfil de oferta**, nunca en Salidas ni
  en paquetes del crítico o del juez.
- Plazos de PLACSP en hora peninsular; la UI añade la hora local de la empresa cuando su zona no
  es la peninsular.
- **Sin datos reales en el repo.** Los tests usan la empresa ficticia de
  `apps/server/tests/fixtures/empresaEjemplo.ts`, personas como «Persona A» y fixtures sintéticos
  (`apps/server/tests/licitaciones/fixtures/`; `perfilesGenericos.mjs` y `generalizarFixtures.mjs`
  quitan lo que identifica a alguien). Nada de clientes, ofertas presentadas, NIF ni correos reales.
- Trabaja en rama + PR. Un cambio de comportamiento visible actualiza su página de `docs/guia/` /
  `docs/como-esta-hecho/arquitectura.md` en el mismo PR.

## Convenciones

- **Errores como valor** al cruzar fronteras de módulo (`Result` en `nucleo/result.ts`), no excepciones.
- **Validación con zod** de toda entrada externa (peticiones, entorno, respuestas de la PLACSP y de
  Hermes) antes de tocar la lógica.
- **Logger estructurado** (`nucleo/log.ts`), nunca `console.log`; nada de PII, tokens ni secretos en el log.
- **Un dominio no importa a otro**: comparten el núcleo y se enganchan con funciones de registro.
- Comentarios que explican el porqué, sin referencias a tickets ni fases. Un `TODO` lleva su issue:
  `// TODO(#12): …`.
- Tests con nombre de especificación (`should_return_error_when_…`), sin `.only` ni `.skip` sin motivo,
  y mocks solo en la frontera (red, base de datos).
- Dependencias nuevas solo con justificación, y con licencia compatible con la AGPL
  (`npm run licencias`).
