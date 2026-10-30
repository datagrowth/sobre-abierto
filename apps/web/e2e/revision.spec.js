// La pestaña Revisión sobre la respuesta real de GET …/oferta/sobres (e2e/datos) de
// Villaejemplo: el veredicto de las comprobaciones con «Registrar la presentación» apagado mientras algo impide,
// una tarjeta por sobre con sus documentos y comprobaciones, y cada acción llevando a su fila, aquí
// mismo (o al paquete con el kit de firma, o a la memoria en la Oferta), sin escribir nada.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const CASO_C = 'p-91000770';
const revision = () => leerDatos('casoC')[`GET /api/licitaciones/licitaciones/${CASO_C}/oferta/sobres`].body;
const ruta = (resto = '') => `/#/licitacion/${CASO_C}${resto}`;

test('should_show_the_comprobaciones_verdict_and_keep_register_off_while_something_blocks', async ({ page }) => {
  // Arrange
  const r = revision();
  await servirFixture(page, 'casoC');

  // Act
  await page.goto(ruta('/revision'));

  // Assert
  await expect(page.getByTestId('ficha-pestana-revision')).toHaveAttribute('data-estado', 'activa');
  await expect(page.getByTestId('estado-oferta')).toContainText(r.veredicto.texto);
  expect(r.puede_registrar).toBe(false);
  await expect(page.getByTestId('revision-registrar')).toBeDisabled();
});

test('should_show_one_card_per_envelope_with_its_documents_and_checks', async ({ page }) => {
  // Arrange
  const r = revision();
  await servirFixture(page, 'casoC');

  // Act
  await page.goto(ruta('/revision'));

  // Assert
  await expect(page.getByTestId('revision-sobre')).toHaveCount(r.sobres.length);
  const precio = page.getByTestId('comprobacion-precio:3');
  await expect(precio).toHaveAttribute('data-estado', 'impide');
  const oferta = r.sobres
    .flatMap((s) => s.documentos)
    .find((d) => d.comprobaciones.some((c) => c.clave === 'precio:3'));
  await expect(page.getByTestId(`revision-doc-${oferta.clave}`)).toContainText('Impide');
  for (const s of r.sobres) await expect(page.getByTestId('revision-oferta')).toContainText(s.archivo);
});

test('should_take_each_action_to_its_row_in_the_review', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoC');
  await page.goto(ruta('/revision'));

  // Act
  await page.getByTestId('accion-precio:3').click();

  // Assert
  await expect(page.getByTestId('veredicto')).toBeVisible();
  await expect(page.getByTestId('bloqueo-precio:3')).toBeFocused();
  expect(page.__escrituras).toEqual([]);
});

test('should_show_the_lessons_applied_to_each_memoria_with_what_the_critic_says', async ({ page }) => {
  // Arrange: la respuesta de Villaejemplo con dos lecciones del libro pasadas a su memoria.
  const r = revision();
  const lecciones = [
    { id: 7, texto: 'Pon el calendario en una tabla con semana, hito y responsable.', apartados: [2], cumplida: true },
    { id: 9, texto: 'Cuantifica el volumen de alumnas y las horas por curso.', apartados: [1, 3], cumplida: false },
  ];
  const sobres = r.sobres.map((s) => ({
    ...s,
    documentos: s.documentos.map((d) => (d.tipo === 'memoria' ? { ...d, lecciones } : d)),
  }));
  await servirFixture(page, 'casoC');
  await page.route(`**/api/licitaciones/licitaciones/${CASO_C}/oferta/sobres`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...r, sobres }) }),
  );

  // Act
  await page.goto(ruta('/revision'));
  const aplicadas = page.getByTestId('lecciones-aplicadas').first();
  await aplicadas.getByText('Lecciones aplicadas (2)').click();

  // Assert
  await expect(aplicadas).toContainText('apartado 2 · el crítico la ve cumplida');
  await expect(aplicadas).toContainText('apartados 1 y 3 · el crítico no la ve cumplida');
});
