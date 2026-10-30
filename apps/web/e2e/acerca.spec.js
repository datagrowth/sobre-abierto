// Ajustes › Acerca de: versión, licencia AGPL y enlace al código fuente (lo exige la licencia, sección 13).
import { test, expect } from '@playwright/test';
import { servirFixture } from './api.js';

test('should_show_version_license_and_source_link_in_about', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.route('**/api/config', (ruta) =>
    ruta.fulfill({
      json: {
        nombre: 'Sobre Abierto',
        logo: null,
        fuente: 'https://github.com/datagrowth/sobre-abierto',
        version: '0.1.0',
        zona_horaria: 'Europe/Madrid',
      },
    }),
  );

  // Act
  await page.goto('/#/ajustes/acerca');

  // Assert
  await expect(page.getByTestId('acerca-version')).toContainText('0.1.0');
  await expect(page.getByTestId('acerca')).toContainText('AGPL-3.0');
  await expect(page.getByTestId('acerca-codigo-fuente')).toHaveAttribute(
    'href',
    'https://github.com/datagrowth/sobre-abierto',
  );
});
