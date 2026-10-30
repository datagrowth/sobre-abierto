// Precio en línea por lote: el precio del lote 3 de Villaejemplo se fija en su
// fila de las comprobaciones, con la baja y el umbral a la vista, y se guarda solo la sección «precio» de
// las decisiones aunque el equipo tenga un problema abierto. Sobre e2e/datos/casoC.json: guion
// con el precio por hora (máximo 1,54 €), sin precio sugerido y con un tutor sin cubrir.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const CASO_C = 'p-91000770';
const API = `/api/licitaciones/licitaciones/${CASO_C}`;
const RUTA = `/#/licitaciones/oportunidades/${CASO_C}/revision`;
const PROBLEMA_EQUIPO = 'Tutor de topografía (lote 3): nadie del equipo lo tiene registrado.';
const PRECIO_GUARDADO = { lote: '3', pendiente: false, importe: null, unitarios: [{ concepto: 'hora', precio: 1.45 }] };

const json = (route, body) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

// Lo que respondería el servidor: el impacto de un precio (nada que rehacer), el PATCH con la
// versión nueva y lo pendiente de otras secciones, y la oferta ya con el precio tras guardarlo.
async function servirCasoC(page) {
  await servirFixture(page, 'casoC');
  const oferta = leerDatos('casoC')[`GET ${API}/oferta`].body;
  const escrituras = [];
  let guardado = false;
  await page.route(`**${API}/oferta/impacto`, (route) => {
    escrituras.push({ metodo: 'POST', ruta: `${API}/oferta/impacto`, cuerpo: route.request().postDataJSON() });
    return json(route, {
      afectadas: [],
      se_mantiene: ['la memoria: no puede mencionar el precio'],
      resumen: 'No cambia nada de lo hecho.',
    });
  });
  // Por el pathname: así casa aunque la ruta lleve consulta.
  await page.route(
    (url) => url.pathname === `${API}/oferta/decisiones/precio`,
    (route) => {
      const url = new URL(route.request().url());
      escrituras.push({
        metodo: route.request().method(),
        ruta: `${url.pathname}${url.search}`,
        cuerpo: route.request().postDataJSON(),
      });
      guardado = true;
      return json(route, {
        version: 2,
        datos: { ...oferta.decisiones.datos, ofertas: [PRECIO_GUARDADO] },
        avisos: [],
        problemas_otras: [PROBLEMA_EQUIPO],
      });
    },
  );
  await page.route(`**${API}/oferta`, (route) =>
    json(
      route,
      guardado
        ? {
            ...oferta,
            decisiones: {
              ...oferta.decisiones,
              version: 2,
              datos: { ...oferta.decisiones.datos, ofertas: [PRECIO_GUARDADO] },
            },
          }
        : oferta,
    ),
  );
  return escrituras;
}

async function abrirComprobaciones(page) {
  const escrituras = await servirCasoC(page);
  await page.goto(RUTA);
  await expect(page.getByTestId('veredicto')).toBeVisible();
  return escrituras;
}

const fila = (page) => page.getByTestId('bloqueo-precio:3');

test('should_show_threshold_live_and_decided_state_after_fixing_precio_lote_3_in_casoC', async ({ page }) => {
  // Arrange
  const escrituras = await abrirComprobaciones(page);
  const campo = fila(page).getByTestId('precio-lote-3');
  await expect(fila(page).getByTestId('precio-lote-3-estado')).toHaveAttribute('data-estado', 'pendiente');
  await expect(fila(page).getByTestId('precio-lote-3-sin-sugerencia')).toContainText('no hay adjudicaciones parecidas');

  // Act
  await campo.fill('1,45');

  // Assert
  await expect(fila(page).getByTestId('precio-lote-3-baja')).toContainText('Baja del 5,84 % sobre 1,54');
  await expect(fila(page).getByTestId('precio-lote-3-umbral')).toContainText('PCAP.pdf pág. 73');
  await expect(fila(page).getByTestId('precio-lote-3-estado')).toHaveAttribute('data-estado', 'pendiente');
  expect(escrituras).toEqual([]);
  expect(page.__escrituras).toEqual([]);
  await fila(page).getByTestId('precio-lote-3-guardar').click();
  await expect(fila(page).getByTestId('precio-lote-3-estado')).toHaveAttribute('data-estado', 'decidido');
  await expect(fila(page).getByTestId('precio-lote-3-estado')).toHaveText('Decidido');
  await expect(campo).toHaveValue('1,45');
});

test('should_save_only_the_price_section_while_the_team_has_a_problem', async ({ page }) => {
  // Arrange
  const escrituras = await abrirComprobaciones(page);
  await expect(page.getByTestId('bloqueo-medios:3:topografia')).toHaveAttribute('data-estado', 'impide');
  await fila(page).getByTestId('precio-lote-3').fill('1,45');

  // Act
  await fila(page).getByTestId('precio-lote-3-guardar').click();

  // Assert
  await expect(fila(page).getByTestId('precio-lote-3-estado')).toHaveAttribute('data-estado', 'decidido');
  expect(escrituras).toEqual([
    { metodo: 'POST', ruta: `${API}/oferta/impacto`, cuerpo: { cambio: { decisiones: { precio: { lote: '3' } } } } },
    // El coste estimado que ya tenía el lote (null en la captura) se conserva al guardar el precio.
    {
      metodo: 'PATCH',
      ruta: `${API}/oferta/decisiones/precio`,
      cuerpo: { version: 1, valor: [{ ...PRECIO_GUARDADO, coste_estimado: null }] },
    },
  ]);
  expect(page.__escrituras).toEqual([]);
  await expect(fila(page)).toContainText(PROBLEMA_EQUIPO);
});

test('should_reject_a_price_above_the_lot_maximum_without_writing', async ({ page }) => {
  // Arrange
  const escrituras = await abrirComprobaciones(page);
  await fila(page).getByTestId('precio-lote-3').fill('1,70');

  // Act
  await fila(page).getByTestId('precio-lote-3-guardar').click();

  // Assert
  await expect(fila(page)).toContainText('pasa del máximo por hora del lote');
  await expect(fila(page).getByTestId('precio-lote-3-estado')).toHaveAttribute('data-estado', 'pendiente');
  expect(escrituras).toEqual([]);
});
