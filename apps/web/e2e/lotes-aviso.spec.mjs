// «Guardar lotes» dice qué rehace Hermes: ese aviso debe seguir a la vista cuando la ficha se
// recarga con los lotes nuevos (antes la key del bloque cambiaba con ellos y se perdía). Y la
// cabecera se puede leer sin depender del texto: indicadores con testid y estado, y los botones
// que escriben marcados con data-escribe. En preparación, el bloque Lotes vive en Expediente y la
// cabecera enseña el veredicto de las comprobaciones en vez de la opinión de Hermes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { arrancarServidor, ejecutarConTsx, entorno, pararServidor, puertoLibre, WEB_DIR } from './servidor-prueba.mjs';

const ID = 'p-20602952';
let tmp;
let servidor;
let base;

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-lotes-'));
  await build({ root: WEB_DIR, logLevel: 'error', build: { outDir: path.join(tmp, 'web'), emptyOutDir: true } });
  await ejecutarConTsx(path.join(WEB_DIR, 'e2e', 'sembrar-lotes.mjs'), entorno(tmp, path.join(tmp, 'web'), 0));
  const puerto = await puertoLibre();
  servidor = await arrancarServidor(tmp, path.join(tmp, 'web'), puerto);
  base = `http://127.0.0.1:${puerto}/#/licitaciones/oportunidades/${ID}`;
});

test.afterAll(async () => {
  await pararServidor(servidor);
  // Windows tarda en soltar los ficheros de SQLite del proceso recién parado.
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('should_keep_the_saved_lots_notice_after_the_tender_reloads', async ({ page }) => {
  // Arrange
  await page.goto(`${base}/resumen`);
  const lote1 = page.getByRole('checkbox', { name: 'Vamos al lote 1' });
  await expect(lote1).not.toBeChecked();

  // Act
  await lote1.check();
  const guardar = page.getByTestId('lotes-guardar');
  await expect(guardar).toHaveAttribute('data-escribe', 'true');
  await guardar.click();
  // Añadir un lote a una oferta en preparación rehace la ficha y el guion: «Qué cambia» lo dice antes.
  await page.getByTestId('impacto-rehacer').click();

  // Assert: la recarga ya trae los dos lotes de interés (el botón desaparece) y el aviso sigue.
  await expect(page.getByText('de interés', { exact: true })).toHaveCount(2);
  await expect(page.getByTestId('lotes-guardar')).toHaveCount(0);
  await expect(page.getByTestId('lotes-aviso')).toContainText('Vamos a los lotes');
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId('lotes-aviso')).toBeVisible();
});

test('should_expose_header_verdicts_and_writing_buttons_by_test_id', async ({ page }) => {
  // Arrange
  await page.goto(base);
  // Act
  await page.getByTestId('accion-descartar').click();
  // Assert
  await expect(page.getByTestId('ficha-indicador-estado')).toHaveAttribute('data-estado', 'en_preparacion');
  await expect(page.getByTestId('veredicto-cabecera')).toHaveAttribute(
    'data-estado',
    /^(no_presentable|faltan_decisiones|hermes_trabajando|presentable_con_riesgos|lista_para_firmar)$/,
  );
  await expect(page.getByTestId('ficha-indicador-hermes')).toHaveCount(0);
  await expect(page.getByTestId('ficha-indicador-plazo')).toHaveAttribute('data-estado', /^(pasada|alta|media|baja)$/);
  await expect(page.getByTestId('descarte-confirmar')).toHaveAttribute('data-escribe', 'true');
});
