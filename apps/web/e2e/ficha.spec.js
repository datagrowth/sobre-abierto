// La ficha de una licitación sobre las respuestas reales del servidor (e2e/datos): pestañas con
// las comprobaciones, enlace antiguo «p-…/preparacion», veredicto de la cabecera igual al de la barra,
// confirmación al preparar una ficha en rojo y descarte con el motivo tipificado.
import { test, expect } from '@playwright/test';
import { desbordeHorizontal, leerDatos, servirFixture } from './api.js';

const ID = { casoE: 'p-91000080', casoB: 'p-91000740', casoD: 'p-91000880', casoC: 'p-91000770' };
const rutaFicha = (id, resto = '') => `/#/licitaciones/oportunidades/${encodeURIComponent(id)}${resto}`;

// La ficha de CASO_E con otros campos (estado, plazo…): las demás respuestas, las del fixture.
async function servirCasoECon(page, cambios) {
  await servirFixture(page, 'casoE');
  const ficha = leerDatos('casoE')[`GET /api/licitaciones/licitaciones/${ID.casoE}`].body;
  const otra = { ...ficha, ...cambios(ficha) };
  await page.route(`**/api/licitaciones/licitaciones/${ID.casoE}`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(otra) })
      : route.fallback(),
  );
}

// La ficha de CASO_E como otra en «nueva» con la ficha en rojo y plazo lejano (fuera de las comprobaciones).
const servirFichaEnRojo = (page) =>
  servirCasoECon(page, (ficha) => ({
    estado: 'nueva',
    fecha_limite: '2026-11-30T14:00:00',
    fecha_solicitud: null,
    go_no_go: {
      ...ficha.go_no_go,
      semaforo: { ...ficha.go_no_go.semaforo, color: 'rojo', motivo: 'No cumplimos la solvencia.' },
    },
  }));

// Recorre las pestañas que tenga la ficha (no una lista fija) y, en cada una, mira los accesos a
// Drive de la cabecera: `oferta` dice si debe estar el de la carpeta de la oferta.
async function comprobarAccesosEnCadaPestana(page, { oferta }) {
  const pestanas = page.getByRole('tablist', { name: 'Secciones de la ficha' }).getByRole('tab');
  await expect(pestanas.first()).toBeVisible();
  const ids = await pestanas.evaluateAll((els) => els.map((el) => el.dataset.testid));
  expect(ids.length).toBeGreaterThan(1);
  for (const id of ids) {
    await page.getByTestId(id).click();
    await expect(page.getByTestId(id)).toHaveAttribute('data-estado', 'activa');
    await expect(page.getByTestId('drive-pliegos')).toHaveCount(1);
    await expect(page.getByTestId('ficha-cabecera').getByTestId('drive-pliegos')).toBeVisible();
    await expect(page.getByTestId('drive-oferta')).toHaveCount(oferta ? 1 : 0);
    if (oferta) await expect(page.getByTestId('ficha-cabecera').getByTestId('drive-oferta')).toBeVisible();
  }
  return ids;
}

test('should_redirect_old_preparacion_link_to_the_offer', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');

  // Act
  await page.goto(rutaFicha(ID.casoE, '/preparacion'));

  // Assert
  await expect(page.getByTestId('veredicto')).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/${ID.casoE}/oferta$`));
  await expect(page.getByTestId('ficha-pestana-oferta')).toHaveAttribute('data-estado', 'activa');
  await expect(page.getByTestId('ficha-pestana-oferta')).toHaveText('Oferta');
  for (const k of ['resumen', 'requisitos', 'criterios', 'mercado'])
    await expect(page.getByTestId(`ficha-pestana-${k}`)).toBeVisible();
  await expect(page.getByTestId('ficha-pestana-expediente')).toHaveCount(0);
});

for (const oferta of Object.keys(ID)) {
  test(`should_show_the_same_verdict_in_header_and_bar (${oferta})`, async ({ page }) => {
    // Arrange
    await servirFixture(page, oferta);

    // Act: el enlace de las comprobaciones lleva a la Oferta, con el veredicto arriba
    await page.goto(rutaFicha(ID[oferta], '/comprobaciones'));

    // Assert
    const barra = page.getByTestId('veredicto');
    const cabecera = page.getByTestId('veredicto-cabecera');
    await expect(barra).toBeVisible();
    await expect(cabecera).toHaveAttribute('data-estado', await barra.getAttribute('data-estado'));
    await expect(cabecera).toContainText(await barra.innerText());
    await expect(page.getByTestId('ficha-cabecera')).not.toContainText('Registrar la presentación');
  });
}

test('should_take_the_header_button_from_the_first_blocker_and_go_to_its_row', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto(rutaFicha(ID.casoE, '/expediente'));
  const boton = page.getByTestId('ficha-cabecera').getByTestId('accion-principal');

  // Act
  await expect(boton).toHaveText('Fijar el precio del lote 2');
  await boton.click();

  // Assert: las filas están en la Revisión.
  await expect(page.getByTestId('ficha-pestana-revision')).toHaveAttribute('data-estado', 'activa');
  await expect(page.getByTestId('bloqueo-precio:2')).toBeFocused();
  expect(page.__escrituras).toEqual([]);
});

test('should_ask_to_confirm_preparing_a_red_light_ficha', async ({ page }) => {
  // Arrange
  await servirFichaEnRojo(page);
  await page.goto(rutaFicha(ID.casoE));
  await expect(page.getByTestId('ficha-pestana-resumen')).toBeVisible();

  // Act
  await page.getByTestId('ficha-cabecera').getByTestId('accion-principal').click();

  // Assert
  await expect(page.getByTestId('confirmacion')).toContainText('La ficha dice «No cumplimos»: ¿prepararla igualmente?');
  expect(page.__escrituras).toEqual([]);
  await page.getByTestId('confirmacion-si').click();
  await expect
    .poll(() => page.__escrituras)
    .toEqual([
      { metodo: 'PATCH', ruta: `/api/licitaciones/oportunidades/${ID.casoE}`, cuerpo: { estado: 'en_preparacion' } },
    ]);
});

test('should_require_the_typed_motive_to_discard', async ({ page }) => {
  // Arrange
  await servirFichaEnRojo(page);
  await page.goto(rutaFicha(ID.casoE));
  await page.getByTestId('accion-descartar').click();

  // Act
  await page.getByTestId('descarte-motivo').fill('Exigen ENS y no lo tenemos');

  // Assert
  await expect(page.getByTestId('descarte-confirmar')).toBeDisabled();
  await page.getByTestId('descarte-tipo').selectOption('certificacion');
  await page.getByTestId('descarte-confirmar').click();
  await expect
    .poll(() => page.__escrituras)
    .toEqual([
      {
        metodo: 'PATCH',
        ruta: `/api/licitaciones/oportunidades/${ID.casoE}`,
        cuerpo: {
          estado: 'descartada',
          motivo_descarte: 'Exigen ENS y no lo tenemos',
          categoria_descarte: 'certificacion',
        },
      },
    ]);
});

test('should_filter_the_expediente_by_text', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto(rutaFicha(ID.casoE, '/expediente'));

  // Act
  await page.getByTestId('expediente-buscar').fill('zzz sin coincidencias');

  // Assert
  await expect(page.getByTestId('expediente-resultados')).toHaveText('Nada en el expediente dice eso.');
  await expect(page.getByTestId('ficha-pestana-requisitos')).toHaveAttribute(
    'data-estado',
    'activa',
    'el Expediente de antes abre Requisitos',
  );
  await page.getByTestId('expediente-buscar').fill('');
  await expect(page.getByTestId('expediente-resultados')).toHaveCount(0);
});

test('should_show_drive_folders_in_every_tab', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto(rutaFicha(ID.casoE, '/comprobaciones'));

  // Act
  const ids = await comprobarAccesosEnCadaPestana(page, { oferta: true });

  // Assert
  expect(ids).toEqual(
    ['resumen', 'requisitos', 'criterios', 'mercado', 'oferta', 'revision'].map((k) => `ficha-pestana-${k}`),
  );
  await expect(page.getByTestId('drive-pliegos')).toHaveText('Drive: pliegos');
  await expect(page.getByTestId('drive-oferta')).toHaveText('Drive: oferta');
});

test('should_show_drive_folders_in_every_tab_of_a_submitted_offer', async ({ page }) => {
  // Arrange
  await servirCasoECon(page, () => ({ estado: 'presentada' }));
  await page.goto(rutaFicha(ID.casoE));

  // Act
  const ids = await comprobarAccesosEnCadaPestana(page, { oferta: true });

  // Assert
  expect(ids).toEqual(
    ['resumen', 'requisitos', 'criterios', 'mercado', 'preparacion'].map((k) => `ficha-pestana-${k}`),
  );
});

test('should_show_only_the_pliegos_folder_in_a_new_opportunity_with_pliegos', async ({ page }) => {
  // Arrange
  await servirCasoECon(page, () => ({ estado: 'nueva', fecha_limite: '2026-11-30T14:00:00', fecha_solicitud: null }));
  await page.goto(rutaFicha(ID.casoE));

  // Act
  const ids = await comprobarAccesosEnCadaPestana(page, { oferta: false });

  // Assert
  expect(ids).toEqual(['resumen', 'requisitos', 'criterios', 'mercado'].map((k) => `ficha-pestana-${k}`));
});

test('should_keep_the_drive_folders_in_the_header_on_a_phone_without_horizontal_scroll @movil', async ({ page }) => {
  // Arrange
  await page.setViewportSize({ width: 390, height: 844 });
  await servirFixture(page, 'casoE');

  // Act
  await page.goto(rutaFicha(ID.casoE, '/comprobaciones'));

  // Assert
  const cabecera = page.getByTestId('ficha-cabecera');
  await expect(cabecera.getByTestId('drive-pliegos')).toBeInViewport();
  await expect(cabecera.getByTestId('drive-oferta')).toBeInViewport();
  const desborde = await desbordeHorizontal(page);
  expect(desborde).toBeLessThanOrEqual(0);
});

test('should_answer_the_three_questions_with_market_indices_and_show_them_in_mercado', async ({ page }) => {
  // Arrange: 41 comparables a CPV de 4 cifras (confianza alta), como los devuelve GET …/indices.
  await servirFixture(page, 'casoE');
  const indices = {
    muestra: {
      n: 41,
      n_organo: 0,
      cifras_cpv: 4,
      cpv: '7226',
      descripcion: 'CPV 7226… · 5 años · procedimiento abierto',
    },
    confianza: 'alta',
    competencia: { ofertas: 3, rango: { p25: 2, p50: 3, p75: 5 }, p_un_licitador: 0.25 },
    baja: { esperada: 0.085, rango: { p25: 0.051, p50: 0.08, p75: 0.128 }, umbral_anormal: 0.25, tramos: [] },
    resumen: '3 ofertas esperadas (2-5) · 1 de cada 4 con un solo licitador · n = 41, CPV 4 dígitos, confianza alta',
    licitadores: [
      {
        nif: 'B00765438',
        nombre: 'Sistemas Ejemplo',
        persona_fisica: false,
        evidencia: 'ganó 4 parecidas (2 en este órgano)',
        baja_media: 0.079,
      },
    ],
    concentracion: {
      primero: { nif: 'B00765438', cuota: 0.38 },
      contratos: 12,
      nombre_primero: 'Sistemas Ejemplo',
      nivel: 'media',
      texto: null,
    },
    comparables: [
      {
        licitacion_id: 'p-900',
        lote: '',
        titulo: 'Formación en competencias digitales',
        organo: 'Cabildo',
        fecha: '2026-03-01',
        ofertas: 4,
        baja: 0.09,
        peso: 0.91,
        mismo_organo: true,
      },
    ],
  };
  await page.route(
    (url) => url.pathname.endsWith('/indices'),
    (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(indices) }),
  );

  // Act
  await page.goto(rutaFicha(ID.casoE, '/mercado'));

  // Assert
  await expect(page.getByTestId('ficha-merece')).toContainText('3 ofertas esperadas · baja 8,5 %');
  await expect(page.getByTestId('ficha-merece')).toContainText('n = 41 · confianza alta');
  await expect(page.getByTestId('veredicto-cabecera')).toBeVisible();
  await expect(page.getByTestId('ficha-indicador-plazo')).toContainText('Canarias');
  await expect(page.getByTestId('indice-baja')).toContainText('Rango 5,1 %-12,8 %');
  await expect(page.getByTestId('indice-ofertas')).toContainText('1 de cada 4 comparables tuvo un solo licitador');
  await expect(page.getByTestId('indice-organo')).toContainText('38,0 %');
  await expect(page.getByTestId('licitadores-probables')).toContainText('Ganó 4 parecidas (2 en este órgano)');
  // Una sola muestra en la pestaña: los comparables son los del índice y no hay otra lista de parecidas.
  await page.getByTestId('comparables-indice').locator('summary').click();
  await expect(page.getByTestId('comparables-indice')).toContainText('Formación en competencias digitales');
  await expect(page.getByText('Adjudicaciones parecidas', { exact: true })).toHaveCount(0);
});

// La caja «Preguntar al pliego» del Resumen envía la pregunta y enseña la respuesta de
// Hermes con su cita, «no comprobada» si no se encontró literal, y la consulta al órgano si no lo dice.
test('should_ask_the_tender_and_show_the_answer_with_its_quote', async ({ page }) => {
  await servirFixture(page, 'casoE');
  const respuestas = {
    preguntas: [
      {
        id: 2,
        pregunta: '¿Piden ENS?',
        quien: 'Ana',
        estado: 'respondida',
        dice: true,
        respuesta: 'Sí, categoría básica.',
        cita: {
          texto: 'deberá disponer del ENS de categoría básica',
          documento: 'Licitaciones/p/PCAP.pdf',
          pagina: 12,
          comprobada: true,
        },
        en_comprobaciones: false,
        creada_en: '2026-10-14T08:00:00.000Z',
        respondida_en: '2026-10-14T08:02:00.000Z',
      },
      {
        id: 1,
        pregunta: '¿Se puede subcontratar la formación?',
        quien: 'Ana',
        estado: 'respondida',
        dice: false,
        respuesta: 'El pliego no lo dice.',
        cita: null,
        en_comprobaciones: false,
        creada_en: '2026-10-14T07:00:00.000Z',
        respondida_en: '2026-10-14T07:02:00.000Z',
      },
    ],
  };
  await page.route(`**/api/licitaciones/licitaciones/${ID.casoE}/preguntas`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(respuestas) })
      : route.fallback(),
  );
  await page.goto(rutaFicha(ID.casoE, '/resumen'));
  const caja = page.getByTestId('preguntar-pliego');
  await expect(caja.getByTestId('pregunta-pliego')).toHaveCount(2);
  await expect(caja.getByText('Cita comprobada')).toBeVisible();
  await expect(caja.getByText('PCAP.pdf, pág. 12')).toBeVisible();
  await expect(caja.getByTestId('pregunta-pliego-consulta')).toHaveCount(1);
  await page.getByTestId('pregunta-pliego-texto').fill('¿Hay que firmar con certificado de representante?');
  await page.getByTestId('pregunta-pliego-enviar').click();
  await expect
    .poll(() => page.__escrituras.find((e) => e.ruta.endsWith('/preguntas'))?.cuerpo)
    .toEqual({ pregunta: '¿Hay que firmar con certificado de representante?' });
});
