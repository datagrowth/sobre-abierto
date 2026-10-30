// Capturas de la documentación y de la web del producto (npm run capturas -w @sobre-abierto/web).
// No es un recorrido de prueba: va aparte de `npm run e2e` y de `npm test`. Reutiliza el webServer
// del banco de fixtures (el build servido con vite preview, sin API detrás) y escribe los PNG en
// CAPTURAS_DIR. CAPTURAS_CHROME apunta a otro Chromium si el de Playwright no está instalado.
import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  testMatch: '**/*.captura.js',
  timeout: 120_000,
  reporter: [['list']],
  use: { trace: 'off' },
  projects: [
    {
      name: 'capturas',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: base.webServer.url,
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        launchOptions: process.env.CAPTURAS_CHROME ? { executablePath: process.env.CAPTURAS_CHROME } : {},
      },
    },
  ],
});
