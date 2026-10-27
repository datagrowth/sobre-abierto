// La Biblioteca con el motor de la bóveda simulado: Explorar con tipos, uso y
// «Revisar»; las propuestas de Hermes con su origen y «Editar antes»; los documentos sin nota con
// «Pedir nota» (el escaneado no se pide) y los huecos con «Pedir borrador a Hermes». Nada escribe.
import { test, expect } from '@playwright/test';
import { VAULT, PROPUESTA, abrirBiblioteca as abrir } from './biblioteca-datos.js';

test('should_explore_notes_by_type_with_their_use_and_what_needs_review', async ({ page }) => {
  // Arrange
  await abrir(page);
  const tabla = page.getByTestId('biblioteca-notas');

  // Act + Assert
  await expect(page.getByTestId('biblioteca-indexador')).toContainText(
    'Búsqueda al día: 1.284 documentos y 312 notas leídos. 3 PDF escaneados sin texto.',
  );
  await expect(tabla.locator('tbody tr').first()).toContainText('Metodología de formación en IA generativa', {
    message: 'la más usada primero',
  });
  await expect(tabla).toContainText('6 ofertas');
  await expect(tabla.locator('tr', { hasText: 'Gobierno del dato' })).toContainText('Revisar');
  await page.getByLabel('Caso de éxito').check();
  await expect(tabla.locator('tbody tr')).toHaveCount(1);
  await tabla.locator('tbody tr').first().click();
  await expect(page).toHaveURL(/#\/biblioteca\/notas\/Casos/);
});

test('should_show_where_a_proposal_comes_from_and_edit_it_before_approving', async ({ page }) => {
  // Arrange
  await abrir(page, '/propuestas');

  // Act
  await expect(page.getByText('Desde un documento')).toBeVisible();
  await page.getByTestId(`editar-antes-${PROPUESTA.path}`).click();
  await page.getByLabel('Contenido de la nota').fill('Texto corregido por una persona.');
  await page.getByRole('button', { name: 'Guardar los cambios' }).click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({
      metodo: 'PUT',
      ruta: `${VAULT}/inbox/${encodeURIComponent(PROPUESTA.path)}`,
      cuerpo: { title: PROPUESTA.title, body: 'Texto corregido por una persona.' },
    });
});

test('should_ask_hermes_for_the_notes_that_can_be_read_and_mark_the_scanned_one', async ({ page }) => {
  // Arrange
  await abrir(page, '/sin-nota');

  // Act
  await expect(page.getByTestId('biblioteca-sin-nota')).toContainText('PDF escaneado sin texto: necesita OCR');
  await expect(page.getByTestId('biblioteca-sin-nota')).toContainText('No se puede leer');
  await page.getByTestId('pedir-todas').click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({
      metodo: 'POST',
      ruta: '/api/plataforma/biblioteca/pedir-nota',
      cuerpo: { rutas: ['Licitaciones/AIR-2026-0057/Informe final.pdf'] },
    });
});

test('should_list_the_gaps_and_ask_for_a_draft_or_review_the_old_note', async ({ page }) => {
  // Arrange
  await abrir(page, '/huecos');
  const huecos = page.getByTestId('biblioteca-huecos');

  // Act
  await expect(huecos).toContainText('2 de 9 temas');
  await huecos
    .locator('tr', { hasText: 'Casos de IA en el sector salud' })
    .getByRole('button', { name: 'Pedir borrador a Hermes' })
    .click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({
      metodo: 'POST',
      ruta: '/api/plataforma/biblioteca/pedir-nota',
      cuerpo: { tema: 'Casos de IA en el sector salud' },
    });
  await huecos.locator('tr', { hasText: 'WCAG' }).getByRole('button', { name: 'Revisar nota' }).click();
  await expect(page).toHaveURL(/#\/biblioteca\/notas\/Servicios/);
});
