// Capturas de referencia de la interfaz: las 8 pantallas clave sobre e2e/datos, con
// el reloj de la captura. Un cambio que mueva más de un 0,2 % de píxeles falla; si es a propósito, se
// regeneran con `npx playwright test e2e/visual.spec.js --project=fixtures --update-snapshots=all` y se
// revisan. Va en .spec.js (banco de fixtures), no en .mjs (servidor real). Las referencias no van en
// el repo: dependen del sistema y de sus fuentes, y cada máquina genera las suyas (docs/contribuir/desarrollo.md).
// Y a 400 px: Oportunidades, la ficha, Aprendizaje, la Oferta y la Revisión sin desplazamiento horizontal.
import { test, expect } from '@playwright/test';
import { desbordeHorizontal, servirFixture } from './api.js';

const CASO_E = 'p-91000080';

const PANTALLAS = [
  ['pipeline', '/#/pipeline'],
  ['oportunidades', '/#/oportunidades'],
  ['ficha-resumen', `/#/licitacion/${CASO_E}/resumen`],
  ['ficha-requisitos', `/#/licitacion/${CASO_E}/requisitos`],
  ['ficha-criterios', `/#/licitacion/${CASO_E}/criterios`],
  ['ficha-mercado', `/#/licitacion/${CASO_E}/mercado`],
  ['oferta', `/#/licitacion/${CASO_E}/oferta`],
  ['revision', `/#/licitacion/${CASO_E}/revision`],
  ['ajustes-fuentes', '/#/ajustes/fuentes'],
  ['aprendizaje', '/#/aprendizaje'],
];

async function abrir(page, ruta, ancho) {
  await page.setViewportSize({ width: ancho, height: 900 });
  await servirFixture(page, 'casoE');
  await page.goto(ruta);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1, [data-testid="ficha-cabecera"]').first()).toBeVisible();
}

for (const [nombre, ruta] of PANTALLAS) {
  test(`should_look_like_the_reference_${nombre}`, async ({ page }) => {
    await abrir(page, ruta, 1440);
    await expect(page).toHaveScreenshot(`${nombre}.png`, { maxDiffPixelRatio: 0.002, animations: 'disabled' });
  });
}

for (const [nombre, ruta] of PANTALLAS.filter(([n]) => ['oportunidades', 'ficha-resumen', 'aprendizaje'].includes(n))) {
  test(`should_not_scroll_sideways_at_400px_${nombre}`, async ({ page }) => {
    await abrir(page, ruta, 400);
    const sobra = await desbordeHorizontal(page);
    expect(sobra).toBeLessThanOrEqual(0);
  });
}

// La Oferta (el asistente y el detalle) y la Revisión tampoco se desplazan en horizontal a 400 px.
for (const [nombre, ruta] of [
  ['oferta', `/#/licitacion/${CASO_E}/oferta`],
  ['revision', `/#/licitacion/${CASO_E}/revision`],
]) {
  test(`should_not_scroll_sideways_at_400px_${nombre}`, async ({ page }) => {
    await abrir(page, ruta, 400);
    await expect(page.getByTestId(`${nombre === 'oferta' ? 'asistente' : 'revision'}-oferta`)).toBeVisible();
    const sobra = await desbordeHorizontal(page);
    expect(sobra).toBeLessThanOrEqual(0);
  });
}
