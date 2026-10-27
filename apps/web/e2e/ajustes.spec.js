// Ajustes en nueve pestañas: Avisos con el resumen semanal (sus recorridos, en usuarios-avisos.spec.js),
// Fuentes y filtros reúne el estado de la ingesta, la auditoría de cobertura y el prefiltro, las
// direcciones antiguas llevan a su pestaña actual; en Drive, el ensayo de la carpeta única no escribe.
import { test, expect } from '@playwright/test';
import { servirFixture } from './api.js';

test('should_show_the_nine_settings_tabs', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');

  // Act
  await page.goto('/#/ajustes');

  // Assert
  const pestanas = page.getByRole('tablist', { name: 'Vistas de Ajustes' }).getByRole('tab');
  await expect(pestanas).toHaveText([
    'Empresa',
    'Marca',
    'Usuarios y permisos',
    'Avisos',
    'Fuentes y filtros',
    'Drive',
    'Hermes',
    'Integraciones',
    'Acerca de',
  ]);
  await page.getByRole('tab', { name: 'Avisos' }).click();
  await expect(page.getByTestId('resumen-semanal')).toContainText('Los lunes a las 08:00 (hora de Canarias)');
  expect(
    page.__sinFixture.filter((r) => /avisos|busquedas/.test(r)),
    'Avisos tiene sus fixtures',
  ).toEqual([]);
});

test('should_gather_ingestion_coverage_and_prefilter_in_sources', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');

  // Act: la dirección antigua de Licitaciones › Ajustes › Estado.
  await page.goto('/#/licitaciones/ajustes/estado');

  // Assert
  await expect(page.getByRole('tab', { name: 'Fuentes y filtros' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('estado-ingesta')).toBeVisible();
  await expect(page.getByTestId('cobertura')).toBeVisible();
  await expect(page.getByTestId('calidad-fuera')).toContainText('quedan fuera de los índices');
  await expect(page.getByTestId('calidad-actas')).toContainText('Actas de expedientes ajenos');
  await expect(page.getByTestId('prefiltro')).toBeVisible();
});

test('should_run_the_single_folder_dry_run_from_drive_without_writing', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/ajustes/drive');

  // Act
  await page.getByTestId('carpeta-unica-ensayar').click();

  // Assert
  await expect(page.getByTestId('carpeta-unica-resumen')).toContainText('4 licitaciones');
  await expect(page.getByTestId('ensayo-p-91000080')).toContainText('archivos');
  expect(page.__escrituras).toEqual([]);
});

test('should_launch_the_migration_only_after_confirming', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/ajustes/drive');
  await expect(page.getByTestId('carpeta-unica-estado')).toContainText('Aún no se ha migrado');
  await page.getByTestId('carpeta-unica-ensayar').click();

  // Act
  await page.getByTestId('carpeta-unica-migrar').click();
  expect(page.__escrituras).toEqual([], 'abrir el diálogo no lanza nada');
  await page.getByTestId('carpeta-unica-confirmar').click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toEqual([{ metodo: 'POST', ruta: '/api/licitaciones/carpeta-unica/migracion', cuerpo: null }]);
});
