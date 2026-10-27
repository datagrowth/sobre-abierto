// La pestaña Oferta, el asistente que pregunta, sobre las respuestas reales de
// GET …/oferta/preguntas, /hilo y /generar (e2e/datos) de CASO_E, en preparación: la primera pregunta
// pendiente con su cita y respuestas rápidas, «Lo que hay que decidir» con lo hecho, una respuesta
// con importe y un texto libre mandados como POST …/oferta/respuestas, confirmar lo que entendió
// Hermes, «OK, generar» apagado mientras falte algo y las comprobaciones a un clic. Una oferta descartada
// sigue enseñando las comprobaciones en Oferta.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const CASO_E = 'p-91000080';
const CASO_F = 'p-91000780';
const API = `/api/licitaciones/licitaciones/${CASO_E}`;
const ruta = (id, resto = '') => `/#/licitacion/${id}${resto}`;
const respuestas = (page) =>
  page.__escrituras.filter((e) => e.ruta.endsWith('/oferta/respuestas')).map((e) => e.cuerpo);

test('should_ask_the_first_pending_decision_with_its_quote_and_quick_answers', async ({ page }) => {
  // Arrange
  const preguntas = leerDatos('casoE')[`GET ${API}/oferta/preguntas`].body;
  const primera = preguntas.preguntas.find((p) => p.estado === 'pendiente');
  await servirFixture(page, 'casoE');

  // Act
  await page.goto(ruta(CASO_E));

  // Assert
  await expect(page.getByTestId('ficha-pestana-oferta')).toHaveAttribute('data-estado', 'activa');
  const pregunta = page.getByTestId('asistente-pregunta');
  await expect(pregunta).toContainText(primera.titulo);
  if (primera.citas.length) await expect(pregunta).toContainText(primera.citas[0].documento);
  for (const o of primera.opciones) await expect(page.getByTestId(`opcion-${o.clave}`)).toBeVisible();
  await expect(page.getByTestId('asistente-decidir')).toContainText(`${preguntas.hechas} de ${preguntas.total}`);
  await expect(page.getByTestId('asistente-generar')).toBeDisabled();
});

test('should_send_an_amount_and_a_written_answer', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto(ruta(CASO_E));
  await expect(page.getByTestId('asistente-pregunta')).toContainText('Precio del lote 2');

  // Act: «Otro precio» pide el importe; luego, escrito en la caja
  await page.getByTestId('opcion-otro').click();
  await page.getByLabel('Importe sin impuestos').fill('1,25');
  await page.getByTestId('asistente-dato-enviar').click();
  await page.getByTestId('asistente-texto').fill('1,20 € por alumno');
  await page.getByTestId('asistente-enviar').click();

  // Assert
  await expect.poll(() => respuestas(page).length).toBe(2);
  const [importe, texto] = respuestas(page);
  expect(importe).toMatchObject({ pregunta: 'precio:2', opcion: 'otro', importe: 1.25 });
  expect(texto).toMatchObject({ pregunta: 'precio:2', texto: '1,20 € por alumno' });
});

test('should_confirm_what_hermes_understood', async ({ page }) => {
  // Arrange: el hilo trae una interpretación por confirmar
  await servirFixture(page, 'casoE');
  const pregunta = 'automatico:formatos de descarga de los registros de actividad:-';
  const hilo = {
    mensajes: [
      {
        id: 7,
        pregunta,
        autor: 'persona',
        tipo: 'libre',
        texto: 'Sí, exporta a CSV, está en su ficha técnica',
        datos: { titulo: 'Formatos de descarga de los registros de actividad' },
        estado: 'interpretada',
        creado_en: 'x',
      },
      {
        id: 8,
        pregunta,
        autor: 'hermes',
        tipo: 'interpretacion',
        texto: 'Nos acogemos a «Formatos de descarga de los registros de actividad»',
        datos: {
          titulo: 'Formatos de descarga de los registros de actividad',
          explicacion: 'Dice que sí y con qué se acredita',
        },
        estado: 'por_confirmar',
        creado_en: 'x',
      },
    ],
  };
  await page.route(`**${API}/oferta/hilo`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hilo) }),
  );
  await page.goto(ruta(CASO_E));

  // Act
  await expect(page.getByTestId('asistente-interpretacion')).toContainText(
    'Nos acogemos a «Formatos de descarga de los registros de actividad»',
  );
  await page.getByTestId('asistente-confirmar').click();

  // Assert
  await expect.poll(() => respuestas(page)[0]).toMatchObject({ pregunta, interpretacion: 8 });
});

test('should_ask_again_about_a_price_below_the_abnormal_threshold', async ({ page }) => {
  // Arrange: el hilo trae el aviso del umbral tras guardar el precio del lote 4
  await servirFixture(page, 'casoE');
  const hilo = {
    mensajes: [
      {
        id: 9,
        pregunta: 'precio:4',
        autor: 'persona',
        tipo: 'respuesta',
        texto: '1 € por alumno',
        datos: { titulo: 'Precio del lote 4' },
        estado: null,
        creado_en: 'x',
      },
      {
        id: 10,
        pregunta: 'precio:4',
        autor: 'hermes',
        tipo: 'aviso',
        texto:
          'El precio del lote 4 está por debajo del umbral de anormalidad que fija el pliego. ¿Lo mantienes o lo cambias?',
        datos: { titulo: 'Precio del lote 4' },
        estado: null,
        creado_en: 'x',
      },
    ],
  };
  await page.route(`**${API}/oferta/hilo`, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hilo) }),
  );
  await page.goto(ruta(CASO_E));

  // Act
  await expect(page.getByTestId('asistente-aviso')).toContainText('umbral de anormalidad');
  await page.getByTestId('asistente-aviso-cambiar').click();

  // Assert
  await expect(page.getByTestId('asistente-pregunta')).toContainText('Precio del lote 4');
});

test('should_show_answered_decisions_and_open_one_again', async ({ page }) => {
  // Arrange
  const preguntas = leerDatos('casoE')[`GET ${API}/oferta/preguntas`].body;
  const hecha = preguntas.preguntas.find((p) => p.estado === 'hecha' && p.respuesta);
  await servirFixture(page, 'casoE');
  await page.goto(ruta(CASO_E));

  // Act
  const paso = page.getByTestId(`decidir-${hecha.clave}`);
  await expect(paso).toHaveAttribute('data-estado', 'hecha');
  await paso.click();

  // Assert
  await expect(page.getByTestId('asistente-pregunta')).toContainText(hecha.titulo);
  await expect(page.getByTestId('asistente-pregunta')).toContainText(`Ahora: ${hecha.respuesta}`);
});

test('should_list_the_documents_by_envelope_and_open_the_detail_below', async ({ page }) => {
  // Arrange
  const plan = leerDatos('casoE')[`GET ${API}/oferta/generar`].body;
  await servirFixture(page, 'casoE');
  await page.goto(ruta(CASO_E));

  // Assert
  for (const s of plan.sobres) await expect(page.getByTestId('asistente-sobres')).toContainText(s.archivo);
  await expect(page.getByTestId('asistente-generar')).toBeDisabled();

  // Act
  await page.getByTestId('abrir-cajon-guion').click();

  // Assert: el detalle (antes, las comprobaciones) se abre en la misma pestaña, debajo del asistente.
  await expect(page.getByTestId('veredicto')).toBeVisible();
  await expect(page.getByTestId('cajon-guion')).toBeVisible();
  await expect(page.getByTestId('ficha-pestana-oferta')).toHaveAttribute('data-estado', 'activa');
  expect(page.__escrituras).toEqual([]);
});

test('should_show_only_what_to_decide_in_oferta_for_a_discarded_offer', async ({ page }) => {
  await servirFixture(page, 'casoF');
  await page.goto(ruta(CASO_F));
  await expect(page.getByTestId('ficha-pestana-oferta')).toHaveText('Oferta');
  await expect(page.getByTestId('ficha-pestana-revision')).toHaveCount(0);
  await expect(page.getByTestId('oferta-sin-preparar')).toBeVisible();
  await expect(page.getByTestId('asistente-oferta')).toHaveCount(0);
});
