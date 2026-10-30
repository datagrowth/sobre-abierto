// Las filas de las comprobaciones del servidor sobre sus respuestas reales (e2e/datos, generadas con comprobacionesDe
// sobre las 5 ofertas capturadas): la web pinta el veredicto y las filas tal como llegan, sin
// recalcular. En preparación van en la Revisión; descartada o por decidir, en la Oferta. Los
// enlaces antiguos (#/…/comprobaciones#bloqueo=…) llevan a la Revisión con la fila.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const ID = { casoE: 'p-91000080', casoB: 'p-91000740', casoF: 'p-91000780', casoD: 'p-91000880', casoC: 'p-91000770' };
const DIR_ESPERADO = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../server/tests/licitaciones/fixtures/comprobaciones',
);
// Lo que el servidor fija para cada oferta (veredicto y primer bloqueo): la web debe enseñar lo mismo.
const esperadoDe = (oferta) => JSON.parse(fs.readFileSync(path.join(DIR_ESPERADO, `${oferta}.esperado.json`), 'utf8'));

const rutaComprobaciones = (id, clave = null) =>
  `/#/licitaciones/oportunidades/${encodeURIComponent(id)}/${clave ? `comprobaciones#bloqueo=${encodeURIComponent(clave)}` : 'revision'}`;

async function abrirComprobaciones(page, oferta, clave = null) {
  await servirFixture(page, oferta);
  await page.goto(rutaComprobaciones(ID[oferta], clave));
  await expect(page.getByTestId('veredicto')).toBeVisible();
}

test('should_show_casoE_as_not_presentable_with_the_ens_quote_expandable', async ({ page }) => {
  // Arrange
  await abrirComprobaciones(page, 'casoE');
  const fila = page.getByTestId('bloqueo-excluyente_vs_perfil:-:ens');

  // Act
  await fila.getByText('Ver la cita del pliego').click();

  // Assert
  await expect(page.getByTestId('veredicto')).toHaveAttribute('data-estado', 'no_presentable');
  await expect(page.getByTestId('veredicto')).toContainText('ENS BÁSICA');
  await expect(fila).toHaveAttribute('data-estado', 'impide');
  await expect(fila.getByTestId('bloqueo-cita')).toHaveAttribute('open', '');
  await expect(fila.getByTestId('bloqueo-cita')).toContainText('pág. 1');
  await expect(fila.getByTestId('bloqueo-cita')).toContainText('(cita sin comprobar)');
  const abrir = fila.getByTestId('bloqueo-cita-abrir');
  await expect(abrir).toHaveAttribute('href', /files\/raw\?path=.*Rectificaci%C3%B3n.*#page=1$/);
  await expect(abrir).toHaveAttribute('target', '_blank');
});

for (const oferta of Object.keys(ID)) {
  test(`should_show_the_same_verdict_and_first_blocker_as_the_server_and_each_row_once (${oferta})`, async ({
    page,
  }) => {
    // Arrange
    const esperado = esperadoDe(oferta);
    const comprobaciones = leerDatos(oferta)[`GET /api/licitaciones/licitaciones/${ID[oferta]}/comprobaciones`].body;

    // Act
    await abrirComprobaciones(page, oferta);

    // Assert
    const filas = page.locator('[data-testid="bloqueos"] li[data-testid^="bloqueo-"]');
    const claves = await filas.evaluateAll((els) => els.map((e) => e.dataset.testid));
    expect(new Set(claves).size).toBe(claves.length);
    expect(claves.length).toBe(
      comprobaciones.bloqueos.filter((b) => b.gravedad === 'impide' || b.gravedad === 'riesgo').length,
    );
    expect(claves[0]).toBe(`bloqueo-${esperado.primer_bloqueo}`);
    await expect(page.getByTestId('veredicto')).toHaveAttribute('data-estado', esperado.veredicto);
  });
}

test('should_show_casoF_read_only_with_only_recuperar', async ({ page }) => {
  // Arrange
  await abrirComprobaciones(page, 'casoF');

  // Act
  const escriben = page.locator('[data-testid="oferta-sin-preparar"] [data-escribe="true"]');

  // Assert
  await expect(page.getByTestId('veredicto')).toHaveAttribute('data-estado', 'descartada');
  await expect(page.getByTestId('comprobaciones-solo-lectura')).toContainText('Sin solvencia técnica mínima');
  await expect(escriben).toHaveCount(1);
  await expect(escriben.first()).toHaveAttribute('data-testid', 'recuperar');
  await page.getByTestId('recuperar').click();
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({
      metodo: 'PATCH',
      ruta: `/api/licitaciones/oportunidades/${ID.casoF}`,
      cuerpo: { estado: 'nueva' },
    });
});

test('should_ask_for_a_typed_motive_when_discarding_from_the_decide_offer', async ({ page }) => {
  // Arrange: CASO_B como ficha por revisar con la solicitud de participación mañana (la Oferta
  // reducida de «decidir» sale con el próximo plazo a 3 días o menos).
  await servirFixture(page, 'casoB');
  const ruta = `/api/licitaciones/licitaciones/${ID.casoB}`;
  const detalle = leerDatos('casoB')[`GET ${ruta}`].body;
  await page.route(
    (url) => url.pathname === ruta,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ...detalle, estado: 'ficha_por_revisar', fecha_solicitud: '2027-10-14T23:59:00' }),
          })
        : route.fallback(),
  );
  await page.goto(rutaComprobaciones(ID.casoB));
  await expect(page.getByTestId('comprobaciones-decidir')).toBeVisible();

  // Act
  await page.getByTestId('descartar-oferta').click();
  const form = page.getByTestId('comprobaciones-descarte');
  await form.getByTestId('descarte-motivo').fill('no llegamos');
  await form.getByTestId('descarte-confirmar').click();
  await expect(form).toContainText('Elige el motivo del descarte.');
  await form.getByTestId('descarte-tipo').selectOption('plazo');
  await form.getByTestId('descarte-confirmar').click();

  // Assert: sin tipo no sale nada; con él, el PATCH lleva la categoría.
  await expect
    .poll(() => page.__escrituras)
    .toEqual([
      {
        metodo: 'PATCH',
        ruta: `/api/licitaciones/oportunidades/${ID.casoB}`,
        cuerpo: { estado: 'descartada', motivo_descarte: 'no llegamos', categoria_descarte: 'plazo' },
      },
    ]);
});

test('should_say_in_hermes_en_vivo_that_casoE_waits_for_vamos_on_the_ens_row', async ({ page }) => {
  // Arrange: el servidor dice que la cadena está frenada por el ENS.
  await servirFixture(page, 'casoE');
  const ruta = `/api/licitaciones/licitaciones/${ID.casoE}/oferta/hermes`;
  const hermes = leerDatos('casoE')[`GET ${ruta}`]?.body ?? {
    trabajos: [],
    ultimo_fallo: null,
    runs_hoy: 0,
    tope_runs: 5,
    propuestas_auto_hoy: 0,
    tope_propuestas: 2,
    frenos: [],
    pausa_hasta: null,
  };
  const ens = { clave: 'excluyente_vs_perfil:-:ens', titulo: 'Exigen ENS BÁSICA y el perfil no lo tiene' };
  await page.route(
    (url) => url.pathname === ruta,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...hermes, freno_elegibilidad: { frenada: true, bloqueos: [ens] } }),
      }),
  );
  await page.goto(rutaComprobaciones(ID.casoE));

  // Act
  const freno = page.getByTestId('hermes-freno-elegibilidad');
  await freno.getByText(ens.titulo).click();

  // Assert
  await expect(freno).toContainText('Hermes no redacta la memoria ni los anexos hasta que decidas:');
  await expect(page.getByTestId(`bloqueo-${ens.clave}`)).toBeFocused();
});

test('should_require_a_15_char_motive_before_accepting_a_risk', async ({ page }) => {
  // Arrange
  await abrirComprobaciones(page, 'casoE');
  const fila = page.getByTestId('bloqueo-propuesta_posterior:-');
  await fila.getByTestId('bloqueo-estado-aceptar_riesgo').click();

  // Act
  await fila.getByTestId('confirmacion-motivo').fill('vale así');
  await fila.getByTestId('confirmacion-si').click();

  // Assert
  await expect(fila.getByRole('alert')).toContainText('al menos 15 caracteres');
  expect(page.__escrituras).toEqual([]);
  await fila.getByTestId('confirmacion-motivo').fill('Lo revisamos con Elisa y no cambia nada');
  await fila.getByTestId('confirmacion-si').click();
  await expect
    .poll(() => page.__escrituras)
    .toEqual([
      {
        metodo: 'POST',
        ruta: `/api/licitaciones/licitaciones/${ID.casoE}/comprobaciones/bloqueos/${encodeURIComponent('propuesta_posterior:-')}`,
        cuerpo: { accion: 'aceptar_riesgo', motivo: 'Lo revisamos con Elisa y no cambia nada' },
      },
    ]);
});

test('should_focus_the_row_given_in_the_hash', async ({ page }) => {
  // Arrange / Act
  await abrirComprobaciones(page, 'casoE', 'precio:4');

  // Assert
  const fila = page.getByTestId('bloqueo-precio:4');
  await expect(fila).toBeFocused();
  await expect(fila).toBeInViewport();
  await expect(page.getByText('Eso ya está resuelto.')).toHaveCount(0);
});

test('should_warn_and_focus_the_first_row_when_the_hash_row_is_already_resolved', async ({ page }) => {
  // Arrange / Act
  await abrirComprobaciones(page, 'casoE', 'precio:9');

  // Assert
  await expect(page.getByText('Eso ya está resuelto.')).toBeVisible();
  await expect(page.getByTestId('bloqueo-excluyente_vs_perfil:-:ens')).toBeFocused();
});
