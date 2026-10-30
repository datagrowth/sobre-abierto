// La memoria de la Oferta en la web: una memoria que se quedó atrás dice qué cambió y
// ofrece «Actualizar los apartados afectados» en su propia pantalla, y un lote ya entregado no
// ofrece redactar otra memoria. Sobre las capturas de Villaejemplo y CASO_E (e2e/datos), con la memoria
// cambiada a la forma que da el servidor para una con desfase y para una presentada por lote.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const ID = { casoC: 'p-91000770', casoE: 'p-91000080' };
const api = (oferta, resto = '') => `/api/licitaciones/licitaciones/${ID[oferta]}${resto}`;
const json = (route, body) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const ofertaDe = (oferta) => leerDatos(oferta)[`GET ${api(oferta, '/oferta')}`].body;

// Una memoria ensamblada, sin crítica todavía, cuyas herramientas cambiaron después (apartados 2 y 3).
const PROGRESO_CON_DESFASE = {
  fase: 'fin',
  ronda: 0,
  max_rondas: 2,
  criticas: [],
  restaurados: [],
  dossier: null,
  estrategia: null,
  coherencia: [],
  ficha: null,
  desfase: { secciones: ['herramientas'], apartados: [2, 3] },
};

async function abrirMemoria(page, oferta, cambiar) {
  await servirFixture(page, oferta);
  const o = cambiar(ofertaDe(oferta));
  await page.route(
    (url) => url.pathname === api(oferta, '/oferta'),
    (route) => json(route, o),
  );
  await page.goto(`/#/licitaciones/oportunidades/${ID[oferta]}/oferta`);
  await expect(page.getByTestId('veredicto')).toBeVisible();
  await page.getByTestId('abrir-cajon-memoria').click();
  await expect(page.getByTestId('cajon-memoria')).toBeVisible();
}

test('should_show_what_changed_since_a_memoria_and_offer_to_update_its_sections', async ({ page }) => {
  // Arrange
  await abrirMemoria(page, 'casoC', (o) => ({
    ...o,
    memorias: o.memorias.map((m, i) => (i === 0 ? { ...m, progreso: PROGRESO_CON_DESFASE } : m)),
  }));
  const desfase = page.getByTestId('cajon-memoria').getByTestId('memoria-desfase');
  await expect(desfase).toContainText('Cambió desde esta versión: las herramientas. Afecta a los apartados 2 y 3');
  page.once('dialog', (d) => d.accept());

  // Act
  await desfase.getByTestId('memoria-actualizar').click();

  // Assert
  await expect
    .poll(() => page.__escrituras.map((e) => [e.metodo, e.ruta, e.cuerpo]))
    .toContainEqual(['POST', api('casoC', '/oferta/memoria/3/actualizar-afectados'), { apartados: [2, 3] }]);
});

test('should_not_offer_to_redact_a_lote_already_delivered_with_its_presentada', async ({ page }) => {
  // Arrange: el lote 2 entregado (su presentada) y el lote 4 con una versión de trabajo.
  await abrirMemoria(page, 'casoE', (o) => {
    const base = o.memorias[0];
    const presentada = {
      ...base,
      id: 9101,
      version: 2,
      lote: '2',
      presentada: true,
      borrador: { ...base.borrador, estado: 'aceptada' },
    };
    const trabajo = { ...base, id: 9102, version: 3, lote: '4' };
    return { ...o, memorias: [trabajo, presentada] };
  });
  const cajon = page.getByTestId('cajon-memoria');

  // Act
  const lote2 = cajon.getByTestId('memoria-lote-2');

  // Assert
  await expect(lote2.getByTestId('memoria-presentada-lote-2')).toBeVisible();
  await expect(lote2.getByTestId('redactar-memoria-lote-2')).toHaveCount(0);
  await expect(cajon.getByTestId('memoria-lote-2-opciones')).toHaveCount(0);
  await expect(cajon.getByTestId('memoria-lote-4-opciones')).toHaveCount(1);
});
