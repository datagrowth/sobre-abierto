// Recorridos e2e de la web (npm run e2e -w @sobre-abierto/web). Fuera de `npm test` porque
// necesitan Chromium (npx playwright install chromium), que no está en todos los entornos.
// Dos bancos: «servidor» (*.spec.mjs) arranca el servidor real con datos temporales; «fixtures»
// (*.spec.js) sirve el build con vite preview y responde la API desde e2e/datos (api.js).
import { defineConfig, devices } from '@playwright/test';

const PREVIEW = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  // Cada prueba compila la web y arranca su propio servidor: en serie para no pelearse por CPU.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
  // Solo lo usa el banco de fixtures: el build de ahora, servido sin API detrás.
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: PREVIEW,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      // Servidor real (tsx src/index.ts) con datos temporales y un build propio de la web.
      name: 'servidor',
      testMatch: '**/*.spec.mjs',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'fixtures',
      testMatch: '**/*.spec.js',
      use: { ...devices['Desktop Chrome'], baseURL: PREVIEW },
    },
    {
      // El recorrido en el móvil (390×844): solo los tests marcados con @movil.
      name: 'fixtures-movil',
      testMatch: '**/*.spec.js',
      grep: /@movil/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: PREVIEW,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
