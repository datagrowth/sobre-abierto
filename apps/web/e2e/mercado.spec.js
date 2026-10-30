// Mercado › Panorama y Vencimientos: Panorama es la vista por defecto, con el
// importe por trimestre y quién gana (tu empresa en verde); en Vencimientos, «Avisarme» pide seguir el
// contrato y la lista lo marca. Los fixtures no traen histórico: el mercado se sirve aquí.
import { test, expect } from '@playwright/test';
import { servirFixture } from './api.js';

const PANORAMA = {
  desde: '2024-10-14',
  hasta: '2026-10-14',
  n: 3,
  importe: 200000,
  cpvs: ['72'],
  trimestres: [
    { trimestre: '2026-T2', importe: 120000, adjudicaciones: 2 },
    { trimestre: '2026-T3', importe: 80000, adjudicaciones: 1 },
  ],
  tramos: [
    { tramo: '1', adjudicaciones: 1, baja_mediana: 0 },
    { tramo: '2-3', adjudicaciones: 2, baja_mediana: 0.12 },
  ],
  organos: [{ nif: 'P0000002F', nombre: 'Cabildo de Isla Ejemplo', importe: 200000, contratos: 3, cuota: 1 }],
  adjudicatarios: [
    { nif: 'B12345674', nombre: 'Sistemas Ejemplo', importe: 170000, contratos: 2, cuota: 0.85, nosotros: false },
  ],
  nuestra_cuota: {
    nif: 'A00000075',
    nombre: 'Analítica Ejemplo',
    importe: 30000,
    contratos: 1,
    cuota: 0.15,
    nosotros: true,
  },
  nota: 'Adjudicaciones de la PLACSP.',
};

const VENCIMIENTOS = {
  total: 1,
  desde: 0,
  siguiente: null,
  items: [
    {
      licitacion_id: 'p-1',
      lote: '',
      titulo: 'Formación TIC para personal municipal',
      expediente: 'E-1',
      url: null,
      organo: 'Ayuntamiento',
      organo_nif: 'P0000004B',
      adjudicatario_nif: 'B12345674',
      adjudicatario: 'Sistemas Ejemplo',
      importe: 74000,
      inicio: '2026-03-01',
      fin_estimado: '2027-02-28',
      prorrogas_max: null,
      prorrogas_usadas: null,
      salida_esperada: '2026-10-28',
      antelacion_meses: 4,
      ediciones: 0,
      confianza: 'baja',
      avisar: false,
    },
  ],
};

async function servirMercado(page) {
  await servirFixture(page, 'casoE');
  await page.route(
    (url) => url.pathname.endsWith('/mercado/panorama'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PANORAMA) }),
  );
  await page.route(
    (url) => url.pathname.endsWith('/mercado/vencimientos'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VENCIMIENTOS) }),
  );
}

test('should_open_mercado_on_the_panorama_with_quarters_and_our_share', async ({ page }) => {
  // Arrange
  await servirMercado(page);

  // Act
  await page.goto('/#/mercado');

  // Assert
  await expect(page.getByRole('tab', { name: 'Panorama' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('panorama-trimestres')).toContainText('T3 26');
  await expect(page.getByTestId('panorama-ganadores').locator('[data-nosotros]')).toContainText(
    'Analítica Ejemplo (tu empresa)',
  );
  await expect(page.getByTestId('panorama-organos')).toContainText('Cabildo de Isla Ejemplo');
  await expect(page.getByTestId('panorama-tramos')).toContainText('12,0 %');
});

test('should_ask_to_be_told_when_an_expiring_contract_is_tendered_again', async ({ page }) => {
  // Arrange
  await servirMercado(page);
  await page.goto('/#/mercado/vencimientos');

  // Act
  await expect(page.getByTestId('vencimientos')).toContainText('Formación TIC para personal municipal');
  await page.getByTestId('avisar-p-1-contrato').click();

  // Assert
  await expect(page.getByTestId('vencimientos')).toContainText('renovación que seguías');
  expect(page.__escrituras).toEqual([
    {
      metodo: 'POST',
      ruta: '/api/licitaciones/mercado/vencimientos/avisar',
      cuerpo: { licitacion_id: 'p-1', lote: '' },
    },
  ]);
  await expect(page.getByTestId('vencimientos')).toContainText('prórrogas sin publicar');
});
