// El detalle de la Oferta: un apartado se
// abre desde su botón o desde una fila de la Revisión con el foco en el campo, lo tecleado sigue al
// cerrar y volver, y no se pierde nada sin preguntar. Sobre las respuestas de CASO_E
// (e2e/datos/casoE.json): lotes 2 y 4, con su precio sin fijar.
import { test, expect } from '@playwright/test';
import { desbordeHorizontal, leerDatos, servirFixture } from './api.js';

const CASO_E = 'p-91000080';
const RUTA = `/#/licitaciones/oportunidades/${CASO_E}/oferta`;

async function abrirComprobaciones(page, ruta = RUTA) {
  await servirFixture(page, 'casoE');
  await page.goto(ruta);
  await expect(page.getByTestId('veredicto')).toBeVisible();
}

const cajon = (page, nombre) => page.getByTestId(`cajon-${nombre}`);
const precio = (page, lote) => cajon(page, 'decisiones').locator(`[data-foco="precio.${lote}"]`);

async function teclearPrecioLote2(page, valor) {
  await page.getByTestId('abrir-cajon-decisiones').click();
  await precio(page, 2).fill(valor);
}

test('should_ask_before_switching_drawer_with_unsaved_changes', async ({ page }) => {
  // Arrange
  await abrirComprobaciones(page);
  await teclearPrecioLote2(page, '5.000');

  // Act
  await page.getByTestId('abrir-cajon-memoria').click();

  // Assert
  const aviso = page.getByTestId('cambios-sin-guardar');
  await expect(aviso).toContainText('Tienes cambios sin guardar en Decisiones. ¿Salir sin guardarlos?');
  await aviso.getByTestId('confirmacion-no').click();
  await expect(cajon(page, 'decisiones')).toBeVisible();
  await expect(precio(page, 2)).toHaveValue('5.000');
  await page.getByTestId('abrir-cajon-memoria').click();
  await page.getByTestId('cambios-sin-guardar').getByTestId('confirmacion-si').click();
  await expect(cajon(page, 'memoria')).toBeVisible();
  await expect(cajon(page, 'decisiones')).toBeHidden();
  await page.getByTestId('abrir-cajon-decisiones').click();
  await expect(precio(page, 2)).toHaveValue('');
  expect(page.__escrituras).toEqual([]);
});

test('should_keep_typed_values_after_closing_and_reopening_a_drawer', async ({ page }) => {
  // Arrange
  await abrirComprobaciones(page);
  await teclearPrecioLote2(page, '5.000');

  // Act
  await cajon(page, 'decisiones').getByTestId('cajon-cerrar').click();
  await expect(cajon(page, 'decisiones')).toBeHidden();
  await page.getByTestId('abrir-cajon-decisiones').click();

  // Assert
  await expect(page.getByTestId('cambios-sin-guardar')).toHaveCount(0);
  await expect(precio(page, 2)).toHaveValue('5.000');
});

test('should_open_the_detail_in_the_offer_with_focus_on_the_field_from_a_review_row', async ({ page }) => {
  // Arrange
  await abrirComprobaciones(page, RUTA.replace(/oferta$/, 'revision'));

  // Act
  await page.getByTestId('bloqueo-precio:4').getByTestId('bloqueo-accion').click();

  // Assert
  await expect(page.getByTestId('ficha-pestana-oferta')).toHaveAttribute('data-estado', 'activa');
  await expect(cajon(page, 'decisiones')).toBeVisible();
  await expect(precio(page, 4)).toBeFocused();
});

test('should_ask_before_leaving_the_offer_from_the_menu_with_unsaved_changes', async ({ page }) => {
  // Arrange
  await abrirComprobaciones(page);
  await teclearPrecioLote2(page, '5.000');
  await cajon(page, 'decisiones').getByTestId('cajon-cerrar').click();

  // Act
  await page.getByTestId('nav-pipeline').click();

  // Assert: pregunta y, si sigue editando, la Oferta y lo tecleado siguen ahí.
  const aviso = page.getByTestId('cambios-sin-guardar');
  await expect(aviso).toContainText('Tienes cambios sin guardar en Decisiones');
  await aviso.getByTestId('confirmacion-no').click();
  await expect(page).toHaveURL(new RegExp(`${CASO_E}/oferta$`));
  await expect(precio(page, 2)).toHaveValue('5.000');
  await page.getByTestId('ficha-pestana-requisitos').click();
  await expect(page.getByTestId('cambios-sin-guardar')).toBeVisible();
  await page.getByTestId('cambios-sin-guardar').getByTestId('confirmacion-no').click();
  await page.getByTestId('nav-pipeline').click();
  await page.getByTestId('cambios-sin-guardar').getByTestId('confirmacion-si').click();
  await expect(page).toHaveURL(/#\/pipeline$/);
  expect(page.__escrituras).toEqual([]);
});

test('should_not_offer_to_relaunch_a_running_proposal_inside_the_offer', async ({ page }) => {
  // Arrange: la propuesta de decisiones lleva un rato en marcha (lo normal: no está colgada).
  await servirFixture(page, 'casoE');
  const ruta = `/api/licitaciones/licitaciones/${CASO_E}/oferta`;
  const oferta = leerDatos('casoE')[`GET ${ruta}`].body;
  await page.route(
    (url) => url.pathname === ruta,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...oferta,
          propuesta_en_curso: { estado: 'generando', desde: oferta._ahora ?? '2026-10-14T10:00:00Z' },
        }),
      }),
  );
  await page.goto(RUTA);
  await expect(page.getByTestId('veredicto')).toBeVisible();

  // Act
  await page.getByTestId('abrir-cajon-decisiones').click();

  // Assert: el aviso sí; el «¿Colgado?», no (en la Oferta solo HermesEnVivo relanza, pasado el p90).
  await expect(cajon(page, 'decisiones')).toContainText('Hermes está preparando la propuesta');
  await expect(page.getByText('¿Colgado? Parar y relanzar')).toHaveCount(0);
});

// El navegador enseña su propio diálogo al cerrar la pestaña si la página cancela beforeunload:
// se comprueba eso, sin depender de que Chromium sin cabeza pinte el diálogo.
const cancelaSalida = (page) =>
  page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });

test('should_ask_before_closing_the_tab_with_unsaved_changes', async ({ page }) => {
  // Arrange
  await abrirComprobaciones(page);
  const antes = await cancelaSalida(page);

  // Act
  await teclearPrecioLote2(page, '5.000');

  // Assert
  expect(antes).toBe(false);
  await expect.poll(() => cancelaSalida(page)).toBe(true);
});

test('should_ask_before_the_browser_back_button_leaves_the_offer_with_unsaved_changes', async ({ page }) => {
  // Arrange: se llega a la Oferta desde la lista (hay a dónde volver) y se teclea un precio.
  await servirFixture(page, 'casoE');
  await page.goto('/#/licitaciones');
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, RUTA.slice(1));
  await expect(page.getByTestId('veredicto')).toBeVisible();
  await teclearPrecioLote2(page, '5.000');

  // Act
  await page.goBack();

  // Assert: pregunta; si sigue editando, la Oferta y lo tecleado siguen; si sale, vuelve a la lista.
  const aviso = page.getByTestId('cambios-sin-guardar');
  await expect(aviso).toContainText('Tienes cambios sin guardar en Decisiones');
  await aviso.getByTestId('confirmacion-no').click();
  await expect(page).toHaveURL(new RegExp(`${CASO_E}/oferta$`));
  await expect(precio(page, 2)).toHaveValue('5.000');
  await page.goBack();
  await page.getByTestId('cambios-sin-guardar').getByTestId('confirmacion-si').click();
  await expect(page).toHaveURL(/#\/licitaciones$/);
  expect(page.__escrituras).toEqual([]);
});

test('should_show_the_detail_inline_on_a_phone_without_horizontal_scroll @movil', async ({ page }) => {
  // Arrange
  await page.setViewportSize({ width: 390, height: 844 });
  await abrirComprobaciones(page);

  // Act
  await page.getByTestId('abrir-cajon-decisiones').click();

  // Assert
  const panel = cajon(page, 'decisiones');
  await expect(panel).toBeVisible();
  await expect(precio(page, 2)).toBeVisible();
  const desborde = await desbordeHorizontal(page);
  expect(desborde).toBeLessThanOrEqual(0);
  await panel.getByTestId('cajon-cerrar').click();
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('veredicto')).toBeVisible();
});
