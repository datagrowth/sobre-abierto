# Cómo contribuir

Gracias por querer mejorar Sobre Abierto. Este archivo cubre lo mínimo para que tu primer PR llegue a buen
puerto. Si algo no queda claro, abre una [discusión](https://github.com/datagrowth/sobre-abierto/discussions).

## Antes de empezar

- **Un bug o una mejora pequeña:** abre el PR directamente, enlazando la issue si la hay.
- **Algo grande** (una pantalla nueva, otro dominio, cambiar cómo funciona la cola de IA): abre antes una issue de
  «Propuesta de mejora» para ponernos de acuerdo en el enfoque. Así no pierdes una semana.
- **Una vulnerabilidad:** no abras una issue pública. Sigue [SECURITY.md](SECURITY.md).

## Entorno de desarrollo

Necesitas Node 22 o posterior. Es un workspace de npm con dos apps: `apps/server` (Node + TypeScript) y
`apps/web` (React + Vite).

```bash
git clone https://github.com/datagrowth/sobre-abierto.git && cd sobre-abierto
npm ci
cp .env.dev.example .env      # en local basta con lo que trae
npm run dev:server            # servidor en :3110
npm run dev:web               # Vite en :5173, con proxy al servidor
```

Sin un Hermes al lado el radar descarga y filtra, y la IA queda en espera: para tocar la web o el radar no lo
necesitas. Para probar la instalación completa:

```bash
docker compose -f docker-compose.yml -f deploy/docker-compose.build.yml up -d --build
```

En Windows, Docker no construye desde una carpeta sincronizada en la nube: usa un clon fuera de ella.

## Comandos

Desde la raíz. **Todo en verde antes de abrir el PR**: es lo mismo que comprueba el CI.

| Comando | Qué hace |
|---|---|
| `npm test` | Tests del servidor (`tsx --test`) y de la web (`node --test`) |
| `npm run typecheck` | Typecheck del servidor |
| `npm run lint` | ESLint de servidor y web, sin avisos |
| `npm run format:check` | Comprueba el formato con Prettier; `npm run format` lo arregla |
| `npm run licencias` | Falla si una dependencia trae una licencia incompatible con la AGPL |
| `npx knip` | Archivos, exports y dependencias sin uso; debe salir limpio |
| `npm run build` | Compila servidor y web |
| `npm run e2e -w @sobre-abierto/web` | Recorridos con Playwright. Solo en local, antes de cerrar una rama; no van en el CI |

Un test suelto: `cd apps/server && npx tsx --test tests/<ruta>.test.ts`. Más detalle (datos de prueba, e2e,
capturas) en [docs/desarrollo.md](../docs/desarrollo.md).

## Reglas del código

- **El idioma del código de dominio es el español** (nombres, mensajes, comentarios, commits y documentación); la
  interfaz también. Si ves inglés en un nombre técnico genérico (`request`, `handler`), está bien.
- **Los tests son obligatorios.** Un módulo nuevo lleva su archivo de test; un bug arreglado, el test que lo
  habría cogido. Nombres como especificaciones (`should_return_error_when_api_key_is_invalid`), Arrange-Act-Assert,
  y dobles solo en la frontera (APIs externas, base de datos), nunca para comprobar el propio doble.
- **Errores como valor** entre módulos (`{ data, error }`): no se lanzan excepciones a través de una frontera.
- **Toda entrada externa se valida** (zod) antes de tocar la lógica.
- **Nada de secretos ni datos reales en el repo**: claves, NIF, correos, clientes, ofertas presentadas o CV. Los
  tests usan la empresa ficticia de `apps/server/tests/fixtures/empresaEjemplo.ts` y fixtures inventados.
  `.gitleaks.toml` lo vigila en el CI.
- **Toda la IA corre en Hermes.** El monitor no tiene claves de ningún modelo.
- Un cambio de comportamiento visible actualiza [docs/especificacion.md](../docs/especificacion.md) y, si cambia el
  diseño, [docs/arquitectura.md](../docs/arquitectura.md), en el mismo PR.

## Commits y PR

- Una línea de resumen de hasta 72 caracteres, en español y en presente («Añade el filtro por región al
  radar»), y, si hace falta, una línea en blanco y el **porqué** del cambio.
- Un PR por cambio, desde una rama tuya (`fix/…`, `feat/…`). Descríbelo con la plantilla.
- **Sin CLA. Firma tus commits con DCO**: añade `Signed-off-by: Tu Nombre <tu@correo>` con `git commit -s`. Con ello
  certificas lo que dice el [Developer Certificate of Origin](https://developercertificate.org/): que el código es
  tuyo, o que puedes aportarlo con la licencia del proyecto (AGPL-3.0-or-later). El CI lo comprueba; si olvidaste
  firmar, `git rebase --signoff main` lo arregla.

## Licencia

Al contribuir aceptas que tu aportación se distribuya bajo la [AGPL-3.0-or-later](../LICENSE).
