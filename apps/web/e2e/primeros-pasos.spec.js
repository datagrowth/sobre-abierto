// Los primeros pasos de una instalación nueva (Pipeline vacío): perfil de la empresa, filtros, IA y
// Drive opcional. Cada paso abre su pestaña de Ajustes y la tarjeta desaparece cuando está todo.
import { test, expect } from '@playwright/test';
import { entrarComo, leerDatos, persona, servirFixture, USUARIOS } from './api.js';

const VACIO = {
  columnas: ['en_preparacion', 'lista_para_firmar', 'presentada', 'en_evaluacion', 'resuelta'].map((clave) => ({
    clave,
    titulo: clave,
    tarjetas: [],
  })),
  por_revisar: null,
};
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/** Una instalación sin nada hecho; `hechos` pone al día los pasos que se indiquen. */
async function instalacionNueva(page, { empresa = false, filtros = false, ia = false, usuario = USUARIOS[0] } = {}) {
  await servirFixture(page, 'casoE');
  await entrarComo(page, persona(usuario));
  await page.route('**/api/licitaciones/pipeline', (r) => r.fulfill(json(VACIO)));
  const estadoBase = leerDatos('casoE')['GET /api/licitaciones/estado'].body;
  await page.route('**/api/licitaciones/estado', (r) =>
    r.fulfill(
      json({
        ...estadoBase,
        hermes: ia ? 'configurado' : 'sin configurar (HERMES_LICITACIONES_URL y HERMES_LICITACIONES_KEY)',
      }),
    ),
  );
  await page.route('**/api/licitaciones/filtros', (r) =>
    r.fulfill(
      json({
        cpv_prefijos: ['72'],
        palabras: [],
        excluir_palabras: [],
        importe_min: null,
        importe_max: null,
        tipos_contrato: ['2'],
        nuts_prefijos: [],
        excluir_idiomas: [],
        de_ejemplo: !filtros,
      }),
    ),
  );
  await page.route('**/api/plataforma/empresa', (r) =>
    r.fulfill(
      json(
        empresa
          ? {
              perfil: { nombre: 'Analítica Ejemplo, S.L.' },
              actualizado_en: '2026-10-20T08:00:00.000Z',
              propuesta: null,
            }
          : { perfil: null, actualizado_en: null, propuesta: null },
      ),
    ),
  );
  await page.route('**/api/drive/status', (r) =>
    r.fulfill(
      json({
        data: {
          configured: false,
          connected: false,
          account: null,
          folder: null,
          sync: null,
          copia: null,
          redirectUri: '',
        },
      }),
    ),
  );
}

test('should_list_what_is_missing_on_a_fresh_install', async ({ page }) => {
  // Arrange
  await instalacionNueva(page);

  // Act
  await page.goto('/#/pipeline');

  // Assert
  const tarjeta = page.getByTestId('primeros-pasos');
  await expect(tarjeta).toBeVisible();
  for (const clave of ['empresa', 'filtros', 'ia', 'drive'])
    await expect(page.getByTestId(`paso-${clave}`)).toHaveAttribute('data-hecho', 'false');
  await expect(page.getByTestId('paso-drive')).toContainText('opcional');
});

test('should_open_the_settings_tab_of_a_step', async ({ page }) => {
  // Arrange
  await instalacionNueva(page);
  await page.goto('/#/pipeline');

  // Act
  await page.getByTestId('paso-empresa').getByRole('button', { name: 'Abrir' }).click();

  // Assert
  await expect(page).toHaveURL(/#\/ajustes\/empresa/);
});

test('should_mark_the_finished_steps_and_keep_asking_for_the_rest', async ({ page }) => {
  // Arrange
  await instalacionNueva(page, { empresa: true, ia: true });

  // Act
  await page.goto('/#/pipeline');

  // Assert
  await expect(page.getByTestId('paso-empresa')).toHaveAttribute('data-hecho', 'true');
  await expect(page.getByTestId('paso-ia')).toHaveAttribute('data-hecho', 'true');
  await expect(page.getByTestId('paso-filtros')).toHaveAttribute('data-hecho', 'false');
});

test('should_hide_the_card_when_everything_required_is_done', async ({ page }) => {
  // Arrange
  await instalacionNueva(page, { empresa: true, filtros: true, ia: true });

  // Act
  await page.goto('/#/pipeline');

  // Assert
  await expect(page.getByText('Ninguna oferta en curso')).toBeVisible();
  await expect(page.getByTestId('primeros-pasos')).toHaveCount(0);
});

test('should_not_show_the_card_to_someone_who_cannot_change_settings', async ({ page }) => {
  // Arrange
  await instalacionNueva(page, { usuario: USUARIOS[1] });

  // Act
  await page.goto('/#/pipeline');

  // Assert
  await expect(page.getByText('Ninguna oferta en curso')).toBeVisible();
  await expect(page.getByTestId('primeros-pasos')).toHaveCount(0);
});
