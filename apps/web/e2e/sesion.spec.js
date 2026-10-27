// Sesión caducada con la app abierta (despliegues sin cortes): un 401 de la API hace que GuardiaAcceso
// pregunte a /auth/session; si confirma que no hay sesión, vuelve al login con el aviso. Si la
// sesión sigue viva (un 401 suelto, un socket que no conecta en un despliegue), no echa a nadie.
import { test, expect } from '@playwright/test';
import { servirFixture } from './api.js';

const json = (route, status, body) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function abrirLicitaciones(page) {
  await servirFixture(page, 'casoE');
  await page.goto('/#/pipeline');
  await expect(page.getByTestId('pipeline')).toBeVisible();
}

// Desde ahora la API responde 401 y /auth/session dice `sesion`; luego se cambia de pestaña para que la web pida.
async function caducarYNavegar(page, sesion) {
  await page.route('**/api/**', (route) => json(route, 401, { error: 'unauthorized', message: 'Sesión requerida' }));
  await page.route('**/auth/session', (route) => json(route, 200, sesion));
  await page.evaluate(() => {
    window.location.hash = '#/equipo';
  });
}

test('should_return_to_login_with_a_notice_when_the_session_expires_with_the_app_open', async ({ page }) => {
  // Arrange
  await abrirLicitaciones(page);

  // Act
  await caducarYNavegar(page, { enabled: true, authenticated: false });

  // Assert
  await expect(page.getByTestId('aviso-sesion-caducada')).toBeVisible();
  await expect(page.getByTestId('aviso-sesion-caducada')).toContainText('Tu sesión ha caducado');
});

test('should_keep_the_app_open_when_a_401_comes_but_the_session_is_still_valid', async ({ page }) => {
  // Arrange
  await abrirLicitaciones(page);
  const comprobada = page.waitForRequest('**/auth/session');

  // Act
  await caducarYNavegar(page, { enabled: true, authenticated: true });
  await comprobada;

  // Assert
  await expect(page.getByTestId('aviso-sesion-caducada')).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
