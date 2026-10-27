// Oportunidades con una lista sintética de GET /revision sobre el resto de respuestas
// reales (e2e/datos): las cuatro pestañas con sus cuentas, lo que descartó Hermes apagado en Descartadas, Aplicar
// y Descartar con motivo desde la fila, los filtros del prefiltro en la consulta y la ficha en su
// propia página con migas para volver, y «Ver más» pasadas las 50 primeras.
import { test, expect } from '@playwright/test';
import { servirFixture } from './api.js';

const CASO_E = 'p-91000080';
const LISTA = '/#/oportunidades';

const fila = (id, extra = {}) => ({
  id,
  expediente: `EXP-${id}`,
  titulo: `Título largo de ${id}`,
  titulo_corto: `Oportunidad ${id}`,
  organo: 'Cabildo',
  procedimiento: 'Abierto',
  estado_placsp: 'En plazo',
  importe: 40000,
  fecha_limite: '2026-10-30T14:00:00',
  fecha_solicitud: null,
  estado: 'nueva',
  opinion: 'interesa',
  motivo: null,
  apagada: false,
  con_ficha: false,
  lotes_interes: [],
  error_proceso: null,
  creada_en: null,
  ...extra,
});
const ITEMS = [
  fila('p-1', {
    opinion: 'descartar',
    apagada: true,
    motivo: 'No es de tu sector',
    estado: 'descartada',
    fecha_limite: '2026-10-27T23:59:00',
  }),
  fila(CASO_E, { titulo_corto: 'Formación FFI' }),
  fila('p-3', { opinion: 'revisar' }),
];
const CUENTAS = { por_revisar: 3, sin_cribar: 2, errores: 1, descartadas: 31 };

async function servirLista(page) {
  await servirFixture(page, 'casoE');
  const consultas = [];
  await page.route(
    (url) => url.pathname === '/api/licitaciones/revision',
    (route) => {
      consultas.push(new URL(route.request().url()).searchParams);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: ITEMS.length,
          items: ITEMS,
          cuentas: CUENTAS,
          opiniones: { interesa: 1, revisar: 1, descartar: 1 },
        }),
      });
    },
  );
  return consultas;
}

test('should_show_the_four_tabs_and_dim_what_hermes_discarded', async ({ page }) => {
  // Arrange
  await servirLista(page);

  // Act
  await page.goto(LISTA);

  // Assert
  for (const [k, n] of Object.entries(CUENTAS))
    await expect(page.getByTestId(`oportunidades-pestana-${k}`)).toContainText(String(n));
  await expect(page.locator('tr[data-fila="p-1"]')).toHaveAttribute('data-apagada', 'true');
  await expect(page.locator('tr[data-fila="p-1"]')).toContainText('No es de tu sector');
  await expect(page.locator(`tr[data-fila="${CASO_E}"]`)).not.toHaveAttribute('data-apagada', 'true');
  await expect(page.getByTestId('aplicar-p-1')).toBeVisible();
  await expect(page.getByTestId('lista-pie')).toHaveText('3 oportunidades');
});

test('should_apply_an_opportunity_and_send_it_to_the_pipeline', async ({ page }) => {
  // Arrange
  await servirLista(page);
  await page.goto(LISTA);

  // Act
  await page.getByTestId('aplicar-p-3').click();

  // Assert
  await expect(page.getByText('«Oportunidad p-3» está en el Pipeline, en preparación.')).toBeVisible();
  expect(page.__escrituras).toEqual([
    { metodo: 'PATCH', ruta: '/api/licitaciones/oportunidades/p-3', cuerpo: { estado: 'en_preparacion' } },
  ]);
  await expect(page).toHaveURL(/#\/oportunidades$/, 'aplicar no saca de la lista');
});

test('should_discard_with_a_typed_reason_from_the_row', async ({ page }) => {
  // Arrange
  await servirLista(page);
  await page.goto(LISTA);

  // Act
  await page.getByTestId('descartar-p-3').click();
  const dialogo = page.getByRole('dialog', { name: 'Descartar «Oportunidad p-3»' });
  await dialogo.getByTestId('descarte-tipo').selectOption('encaje');
  await dialogo.getByTestId('descarte-motivo').fill('Es un suministro');
  await dialogo.getByTestId('descarte-confirmar').click();

  // Assert
  await expect(dialogo).toHaveCount(0);
  expect(page.__escrituras).toEqual([
    {
      metodo: 'PATCH',
      ruta: '/api/licitaciones/oportunidades/p-3',
      cuerpo: { estado: 'descartada', motivo_descarte: 'Es un suministro', categoria_descarte: 'encaje' },
    },
  ]);
});

test('should_send_the_prefilter_filters_and_refine_them_without_saving', async ({ page }) => {
  // Arrange
  const consultas = await servirLista(page);
  await page.goto(LISTA);
  await expect(page.getByTestId('tabla-oportunidades')).toBeVisible();

  // Act
  await page.getByRole('group', { name: 'Tipo de contrato' }).getByLabel('Obras').check();
  const comunidades = page.getByTestId('filtro-comunidades');
  await comunidades.getByLabel('Canarias').check();
  await comunidades.getByLabel('Madrid').check();

  // Assert
  await expect.poll(() => consultas.at(-1)?.get('tipos')).toContain('3');
  await expect.poll(() => consultas.at(-1)?.get('comunidad')).toBe('ES70,ES30');
  expect(consultas[0].get('cpv')).toBeTruthy();
  expect(page.__escrituras).toEqual([], 'afinar la lista no toca el prefiltro');
});

test('should_open_the_ficha_in_its_own_page_and_go_back_with_the_breadcrumb', async ({ page }) => {
  // Arrange: la ficha ya no va al lado de la lista; tiene su página con migas.
  await servirLista(page);
  await page.goto(LISTA);

  // Act
  await page.locator(`tr[data-fila="${CASO_E}"]`).click();

  // Assert
  await expect(page).toHaveURL(new RegExp(`#/licitacion/${CASO_E}$`));
  await expect(page.getByTestId('ficha-licitacion')).toBeVisible();
  await expect(page.getByTestId('lista-oportunidades')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Migas' }).getByRole('button', { name: 'Pipeline' }).click();
  await expect(page).toHaveURL(/#\/pipeline$/);
});

test('should_load_more_than_fifty_with_see_more', async ({ page }) => {
  // Arrange: 120 por revisar, servidas de 50 en 50 como hace el servidor.
  await servirFixture(page, 'casoE');
  const todas = Array.from({ length: 120 }, (_, i) => fila(`p-${1000 + i}`));
  await page.route(
    (url) => url.pathname === '/api/licitaciones/revision',
    (route) => {
      const q = new URL(route.request().url()).searchParams;
      const desde = (Number(q.get('pagina')) - 1) * Number(q.get('limite'));
      const items = todas.slice(desde, desde + Number(q.get('limite')));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          total: todas.length,
          items,
          cuentas: { ...CUENTAS, por_revisar: 120 },
          opiniones: { interesa: 120 },
        }),
      });
    },
  );
  await page.goto(LISTA);
  await expect(page.getByTestId('lista-pie')).toHaveText('50 de 120 oportunidades');

  // Act
  await page.getByTestId('lista-ver-mas').click();
  await expect(page.getByTestId('lista-pie')).toHaveText('100 de 120 oportunidades');
  await page.getByTestId('lista-ver-mas').click();

  // Assert
  await expect(page.getByTestId('lista-pie')).toHaveText('120 oportunidades');
  await expect(page.locator('tr[data-fila="p-1119"]')).toBeVisible();
  await expect(page.getByTestId('lista-ver-mas')).toHaveCount(0);
});
