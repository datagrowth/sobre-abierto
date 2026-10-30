// Catálogo de componentes (#/diseno): arranca sin errores, la tabla ordena
// por columna con aria-sort, el cajón se cierra con Escape y devuelve el foco, y un indicador con
// confianza baja no enseña la cifra.
import { test, expect } from '@playwright/test';
import { servirFixture } from './api.js';

const esDelSocket = (msg) => msg.location()?.url?.includes('/socket.io/') || msg.text().includes('/socket.io/');

test('should_show_the_component_catalog_without_console_errors', async ({ page }) => {
  // Arrange
  const errores = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !esDelSocket(msg)) errores.push(msg.text());
  });
  page.on('pageerror', (e) => errores.push(e.message));
  await servirFixture(page, 'casoE');

  // Act
  await page.goto('/#/diseno');

  // Assert
  await expect(page.getByTestId('catalogo-diseno')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Secciones' }).getByText('Catálogo')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  expect(errores).toEqual([]);
});

test('should_sort_the_table_by_the_clicked_column', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/diseno');
  const importe = page.getByRole('columnheader', { name: 'Importe' });

  // Act
  await importe.getByRole('button').click();
  await importe.getByRole('button').click();

  // Assert
  await expect(importe).toHaveAttribute('aria-sort', 'descending');
  await expect(page.locator('tbody tr').first()).toContainText('118.450');
});

test('should_close_the_drawer_with_escape_and_return_focus', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/diseno');
  const abrir = page.getByRole('button', { name: 'Abrir cajón' });

  // Act
  await abrir.click();
  await expect(page.getByRole('dialog', { name: 'Decisiones' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Assert
  await expect(page.getByRole('dialog', { name: 'Decisiones' })).toHaveCount(0);
  await expect(abrir).toBeFocused();
});

test('should_not_show_the_figure_of_a_low_confidence_index', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');

  // Act
  await page.goto('/#/diseno');

  // Assert
  const baja = page.locator('[data-confianza="baja"]');
  await expect(baja).toContainText('pocos datos (n = 7)');
  await expect(baja).not.toContainText('1 de cada 4');
});
