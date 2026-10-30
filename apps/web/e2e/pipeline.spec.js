// El Pipeline sobre la respuesta real de GET /pipeline (e2e/datos): cinco columnas, la
// tarjeta mínima con su carpeta de Drive, abrir la ficha desde la tarjeta, la vista lista con su
// CSV y el aviso de lo que está por revisar.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const CASO_E = 'p-91000080';
const COLUMNAS = ['en_preparacion', 'lista_para_firmar', 'presentada', 'en_evaluacion', 'resuelta'];

test('should_show_the_five_columns_with_the_offers_in_preparation', async ({ page }) => {
  // Arrange
  const pipeline = leerDatos('casoE')['GET /api/licitaciones/pipeline'].body;
  await servirFixture(page, 'casoE');

  // Act
  await page.goto('/#/pipeline');

  // Assert
  for (const c of COLUMNAS) await expect(page.getByTestId(`columna-${c}`)).toBeVisible();
  const enPreparacion = pipeline.columnas.find((c) => c.clave === 'en_preparacion').tarjetas;
  await expect(page.getByTestId('columna-en_preparacion').locator('[data-testid^="tarjeta-p-"]')).toHaveCount(
    enPreparacion.length,
  );
  const tarjeta = page.getByTestId(`tarjeta-${CASO_E}`);
  await expect(tarjeta).toContainText(enPreparacion.find((t) => t.id === CASO_E).expediente);
  await expect(tarjeta.getByTestId('tarjeta-cierre')).toContainText('Canarias');
  await expect(page.getByTestId(`tarjeta-drive-${CASO_E}`)).toHaveAccessibleName(/Abrir en Drive la carpeta de/);
});

test('should_open_the_ficha_from_a_card', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/pipeline');

  // Act
  await page.getByTestId(`tarjeta-abrir-${CASO_E}`).click();

  // Assert
  await expect(page).toHaveURL(new RegExp(`#/licitacion/${CASO_E}$`));
  await expect(page.getByTestId('ficha-licitacion')).toBeVisible();
});

test('should_export_the_list_view_to_csv', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  // El CSV lo arma el servidor, que le pone el nombre con la fecha (exportar.test.ts). Una
  // navegación que acaba en descarga no pasa por page.route: aquí, el enlace y que descarga.
  await page.goto('/#/pipeline/lista');
  await expect(page.getByTestId('pipeline-lista')).toBeVisible();

  // Act
  const descarga = page.waitForEvent('download');
  await page.getByTestId('pipeline-csv').click();

  // Assert
  expect((await descarga).suggestedFilename()).toMatch(/^pipeline.*\.csv$/);
  await expect(page.getByTestId('pipeline-csv')).toHaveAttribute('href', '/api/licitaciones/pipeline.csv');
});

test('should_warn_of_opportunities_pending_review_and_go_to_them', async ({ page }) => {
  // Arrange: una respuesta con dos por revisar.
  await servirFixture(page, 'casoE');
  const base = leerDatos('casoE')['GET /api/licitaciones/pipeline'].body;
  const proximas = [
    {
      id: 'p-1',
      titulo_corto: 'Datos abiertos municipales',
      fecha_limite: '2026-10-30T14:00:00',
      importe: 64000,
      veredicto_ia: 'interesa',
    },
  ];
  await page.route('**/api/licitaciones/pipeline', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...base, por_revisar: { total: 2, proximas } }),
    }),
  );
  await page.goto('/#/pipeline');

  // Act
  await expect(page.getByTestId('pipeline-por-revisar')).toContainText(
    '2 oportunidades pueden encajar y están pendientes de revisión',
  );
  await page.getByTestId('pipeline-revisar').click();

  // Assert
  await expect(page).toHaveURL(/#\/oportunidades$/);
});

test('should_open_the_presentation_register_when_a_card_is_dragged_to_presented', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/pipeline');

  // Act
  await page.getByTestId(`tarjeta-${CASO_E}`).dragTo(page.getByTestId('columna-presentada'));

  // Assert: arrastrar es la acción real, no un cambio de columna sin propuesta detrás.
  await expect(page.getByTestId('mover-tarjeta')).toContainText('Registrar la presentación');
});

test('should_offer_only_the_real_moves_in_the_move_menu', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/pipeline');

  // Act
  await page.getByTestId(`tarjeta-mover-${CASO_E}`).click();

  // Assert: desde En preparación solo se registra la presentación; las columnas automáticas no salen.
  await expect(page.getByRole('menuitem')).toHaveText(['A Presentada: registrar la presentación']);
});
