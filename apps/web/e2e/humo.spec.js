// Humo del banco de fixtures: la web compilada (vite preview) arranca en el Pipeline con las respuestas
// de las 5 ofertas, sin servidor ni Socket.io, y sin un solo error en la consola.
import { test, expect } from '@playwright/test';
import { servirFixture } from './api.js';

// Sin servidor, el socket no conecta: su fallo de red es lo esperado, no un error de la web.
const esDelSocket = (msg) => msg.location()?.url?.includes('/socket.io/') || msg.text().includes('/socket.io/');

test('should_load_the_app_with_fixtures_and_no_console_errors', async ({ page }) => {
  // Arrange
  const errores = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !esDelSocket(msg)) errores.push(msg.text());
  });
  page.on('pageerror', (e) => errores.push(e.message));
  await servirFixture(page, 'casoE');

  // Act
  await page.goto('/');

  // Assert
  await expect(page.getByTestId('pipeline')).toBeVisible();
  await page.waitForLoadState('networkidle');
  // Antes que los errores: un 404 por una ruta sin fixture también sale en la consola.
  expect(page.__sinFixture).toEqual([]);
  expect(errores).toEqual([]);
  expect(page.__escrituras).toEqual([]);
});
