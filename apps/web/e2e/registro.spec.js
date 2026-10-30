// El registro del paquete al pie de la Revisión: con Villaejemplo tal como la dejó la
// captura (filas que impiden abiertas), «Registrar presentación» está apagado y dice por qué;
// registrar igualmente exige un motivo y lo manda al servidor (forzar_motivo). Sin nada que impida,
// «Registrar la presentación» de arriba lleva al registro y registra sin motivo.
// La captura no traía paquete: el spec le pone uno de mentira, con un importe inventado.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const ID = 'p-91000770';
const API = `/api/licitaciones/licitaciones/${ID}`;
const PAQUETE = {
  version: 1,
  creado_en: '2026-10-14T10:30:00.000Z',
  bloqueos: 5,
  avisos: 0,
  ruta: `Salidas/Licitaciones/${ID}/PRESENTACION/v1`,
  desfasado: false,
  copia: null,
};
const REGISTRO = [{ lote: '3', importe_ofertado: 1000, presupuesto: 2000, unidad: null, precio_unitario: null }];
const MOTIVO = 'El órgano confirmó por correo que el anexo no hace falta';

const impidenDe = () =>
  leerDatos('casoC')[`GET ${API}/comprobaciones`].body.bloqueos.filter(
    (b) => b.gravedad === 'impide' && b.estado === 'abierto',
  );

async function abrirConPaquete(page, antes = null) {
  await servirFixture(page, 'casoC');
  if (antes) await antes();
  const oferta = leerDatos('casoC')[`GET ${API}/oferta`].body;
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(`**${API}/oferta`, (route) =>
    route.request().method() === 'GET' ? route.fulfill(json({ ...oferta, paquete: PAQUETE })) : route.fallback(),
  );
  await page.route(`**${API}/oferta/paquete`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(json({ vigente: null, comprobaciones: [], registro: REGISTRO }))
      : route.fallback(),
  );
  await page.goto(`/#/licitaciones/oportunidades/${encodeURIComponent(ID)}/revision`);
  await expect(page.getByTestId('pie-comprobaciones')).toBeVisible();
}

test('should_disable_registrar_paquete_while_casoC_has_an_impide', async ({ page }) => {
  // Arrange
  const impiden = impidenDe();
  const [primero] = impiden.map((b) => b.titulo);
  let dialogos = 0;
  page.on('dialog', (d) => {
    dialogos += 1;
    void d.dismiss();
  });

  // Act
  await abrirConPaquete(page);
  const boton = page.getByTestId('paquete-registrar').getByTestId('registrar-paquete');

  // Assert
  await expect(boton).toBeDisabled();
  await expect(boton).toContainText(`No se puede registrar: ${impiden.length} cosas impiden presentar (`);
  await expect(boton).toContainText(primero);
  await expect(page.getByTestId('revision-oferta').getByTestId('registrar-paquete')).toHaveCount(1);
  await expect(page.getByTestId('pie-comprobaciones').getByTestId('paquete-comprobaciones')).toHaveCount(0);
  await expect(page.getByTestId('pie-comprobaciones').getByTestId('paquete-generar-boton')).toHaveCount(1);
  expect(dialogos).toBe(0);
});

test('should_send_forzar_motivo_when_registering_anyway', async ({ page }) => {
  // Arrange
  await abrirConPaquete(page);
  await page.getByTestId('registrar-igualmente').click();

  // Act
  await page.getByTestId('confirmacion-motivo').fill('corto');
  await page.getByTestId('confirmacion-si').click();
  const sinMotivo = page.getByTestId('confirmacion').getByRole('alert');
  await expect(sinMotivo).toBeVisible();
  await page.getByTestId('confirmacion-motivo').fill(MOTIVO);
  await page.getByTestId('confirmacion-si').click();
  await page.getByTestId('paquete-registro-enviar').click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({
      metodo: 'POST',
      ruta: `${API}/propuestas`,
      cuerpo: { lote: '3', importe_ofertado: 1000, presupuesto: 2000, paquete_version: 1, forzar_motivo: MOTIVO },
    });
});

test('should_register_for_real_from_the_review_when_nothing_blocks', async ({ page }) => {
  // Arrange: las comprobaciones sin filas que impidan y la Revisión que lo dice.
  const datos = leerDatos('casoC');
  const comprobaciones = datos[`GET ${API}/comprobaciones`].body;
  const sobres = datos[`GET ${API}/oferta/sobres`].body;
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  await abrirConPaquete(page, async () => {
    await page.route(`**${API}/comprobaciones`, (route) =>
      route.fulfill(
        json({ ...comprobaciones, bloqueos: comprobaciones.bloqueos.filter((b) => b.gravedad !== 'impide') }),
      ),
    );
    await page.route(`**${API}/oferta/sobres`, (route) => route.fulfill(json({ ...sobres, puede_registrar: true })));
  });

  // Act
  await page.getByTestId('revision-registrar').click();
  const boton = page.getByTestId('paquete-registrar').getByTestId('registrar-paquete');
  await expect(boton).toBeInViewport();
  await boton.click();
  await page.getByTestId('paquete-registro-enviar').click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({
      metodo: 'POST',
      ruta: `${API}/propuestas`,
      cuerpo: { lote: '3', importe_ofertado: 1000, presupuesto: 2000, paquete_version: 1 },
    });
});
