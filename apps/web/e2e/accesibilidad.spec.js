// Accesibilidad básica de las pantallas principales: axe-core no debe encontrar violaciones graves
// (serious o critical) y lo esencial se maneja con el teclado. Va sobre e2e/datos (banco de fixtures).
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { servirFixture } from './api.js';
import { abrirBiblioteca } from './biblioteca-datos.js';

const CASO_E = 'p-91000080';

const PANTALLAS = [
  ['pipeline', '/#/pipeline'],
  ['oportunidades', '/#/oportunidades'],
  ['ficha-resumen', `/#/licitacion/${CASO_E}/resumen`],
  ['ficha-requisitos', `/#/licitacion/${CASO_E}/requisitos`],
  ['oferta', `/#/licitacion/${CASO_E}/oferta`],
  ['revision', `/#/licitacion/${CASO_E}/revision`],
  ['mercado', '/#/mercado'],
  ['aprendizaje', '/#/aprendizaje'],
  ['equipo', '/#/equipo'],
  ['ajustes-marca', '/#/ajustes/marca'],
  ['ajustes-usuarios', '/#/ajustes/usuarios'],
  ['ajustes-avisos', '/#/ajustes/avisos'],
  ['ajustes-fuentes', '/#/ajustes/fuentes'],
  ['ajustes-integraciones', '/#/ajustes/integraciones'],
  ['ajustes-acerca', '/#/ajustes/acerca'],
  ['no-encontrada', '/#/no-existe'],
];

const GRAVES = ['serious', 'critical'];

async function violacionesGraves(page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return violations
    .filter((v) => GRAVES.includes(v.impact))
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
}

for (const [nombre, ruta] of PANTALLAS) {
  test(`should_have_no_serious_accessibility_violations_in_${nombre}`, async ({ page }) => {
    // Arrange
    await servirFixture(page, 'casoE');
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();

    // Act
    const graves = await violacionesGraves(page);

    // Assert
    expect(graves).toEqual([]);
  });
}

// La Biblioteca con el motor de la bóveda simulado (e2e/biblioteca-datos.js): sus cuatro vistas.
for (const [nombre, vista] of [
  ['explorar', ''],
  ['propuestas', '/propuestas'],
  ['sin-nota', '/sin-nota'],
  ['huecos', '/huecos'],
]) {
  test(`should_have_no_serious_accessibility_violations_in_biblioteca_${nombre}`, async ({ page }) => {
    // Arrange
    await abrirBiblioteca(page, vista);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main')).toBeVisible();

    // Act
    const graves = await violacionesGraves(page);

    // Assert
    expect(graves).toEqual([]);
  });
}

// El inicio de sesión: sin sesión, GuardiaAcceso muestra el formulario en vez de la aplicación.
test('should_have_no_serious_accessibility_violations_in_the_login', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.route('**/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: true, authenticated: false }),
    }),
  );
  await page.goto('/');
  await expect(page.locator('input[type="password"]')).toBeVisible();

  // Act
  const graves = await violacionesGraves(page);

  // Assert
  expect(graves).toEqual([]);
});

test('should_show_the_not_found_page_for_an_unknown_address', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');

  // Act
  await page.goto('/#/no-existe');

  // Assert
  await expect(page.getByTestId('no-encontrada')).toContainText('No encontramos esta página');
  await page.getByTestId('no-encontrada-inicio').click();
  await expect(page).toHaveURL(/#\/pipeline/);
  await expect(page.getByTestId('no-encontrada')).toHaveCount(0);
});

test('should_reach_the_menu_and_open_a_section_with_the_keyboard', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/pipeline');
  await page.waitForLoadState('networkidle');

  // Act: Tab recorre la barra lateral hasta una sección y Enter la abre.
  const destino = page.getByRole('button', { name: /Oportunidades/ }).first();
  for (let i = 0; i < 30 && !(await destino.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(destino).toBeFocused();
  await page.keyboard.press('Enter');

  // Assert
  await expect(page).toHaveURL(/#\/oportunidades/);
});

test('should_show_a_visible_focus_ring_on_the_focused_control', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/pipeline');
  await page.waitForLoadState('networkidle');

  // Act
  await page.keyboard.press('Tab');

  // Assert
  const contorno = await page.evaluate(() => {
    const el = document.activeElement;
    const e = getComputedStyle(el);
    return { hay: el !== document.body, ancho: e.outlineWidth, estilo: e.outlineStyle, sombra: e.boxShadow };
  });
  expect(contorno.hay).toBe(true);
  expect(contorno.estilo !== 'none' || contorno.sombra !== 'none').toBe(true);
});
