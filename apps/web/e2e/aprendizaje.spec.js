// La pantalla Aprendizaje sobre e2e/datos de CASO_E, con un libro sembrado en la
// respuesta de GET /aprendizaje: la lección por revisar con su evidencia y sus tres acciones, el
// porqué de un cambio de la presentada, el libro con su uso y «Retirar», la comparación y el efecto.
// Ninguna acción escribe: las escrituras quedan en page.__escrituras.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const API = '/api/licitaciones';
const CASO_E = 'p-91000080';
const base = () => leerDatos('casoE')[`GET ${API}/aprendizaje`].body;

const evidencia = {
  licitacion_id: CASO_E,
  memoria_id: 4,
  documento: 'memoria-presentada.docx',
  ubicacion: 'cambio 3 · apartado 2 · Planificación',
  texto: '+ el 3 de marzo se constituye el equipo',
};
const pendiente = {
  id: 7,
  licitacion_id: CASO_E,
  origen: 'edicion',
  alcance: 'general',
  alcance_valor: null,
  tema: 'planificacion',
  fuerza: 2,
  estado: 'pendiente',
  texto: 'Pon un cronograma con fechas reales, no «semana 1, semana 2».',
  evidencias: [evidencia],
  titulo_licitacion: 'Formación en competencias digitales',
  opciones_alcance: {
    organo: 'Gestión de Servicios para la Salud',
    cpv: '8053',
    tipo_contrato: '2',
    tipo_contrato_nombre: 'Servicios',
  },
  uso: { aplicaciones: 0, ofertas: 0, cumplidas: 0, comprobadas: 0, nota_critico: null },
};
const aceptada = {
  ...pendiente,
  id: 9,
  estado: 'aceptada',
  origen: 'mesa',
  tema: 'calidad',
  fuerza: 1,
  texto: 'Cuantifica los indicadores de seguimiento con su meta.',
  uso: { aplicaciones: 3, ofertas: 2, cumplidas: 2, comprobadas: 3, nota_critico: 78 },
};
const porque = {
  n: 5,
  comparacion: 2,
  licitacion_id: CASO_E,
  titulo: 'Formación en competencias digitales',
  pregunta: '¿Por qué se quitó el soporte de 20 horas?',
  opciones: ['No lo pedía el pliego', 'Lo pidió el cliente', 'Por extensión'],
  respuesta: null,
  respondida_en: null,
  antes: 'La empresa dará 20 horas de soporte sin coste.',
  despues: null,
};
const comparacion = {
  id: 2,
  licitacion_id: CASO_E,
  lote: null,
  titulo: 'Formación en competencias digitales',
  version_hermes: 3,
  version_presentada: 4,
  por_apartado: true,
  creada_en: '2026-10-20T10:00:00Z',
  resumen: { total: 32, por_tipo: { especificidad: 12, estructura: 8, recorte: 6, correccion_dato: 4, compromiso: 2 } },
  preguntas: [porque],
  cambios: [
    {
      n: 3,
      apartado: 2,
      apartado_titulo: 'Planificación',
      accion: 'modificado',
      antes: 'En la semana 1 se constituye el equipo.',
      despues: 'El 3 de marzo se constituye el equipo.',
      a_apartado: null,
      tamano: 30,
      tipo: 'correccion_dato',
      por: 'codigo',
    },
  ],
};
const efecto = {
  ofertas: [
    { licitacion_id: 'a', titulo: 'A', fecha: '2026-03-01', pct: 62, lecciones_aceptadas: 0, nuevas_lecciones: false },
    { licitacion_id: 'b', titulo: 'B', fecha: '2026-06-01', pct: 80, lecciones_aceptadas: 1, nuevas_lecciones: true },
  ],
  trimestres: [{ trimestre: '2026-T3', ganadas: 1, perdidas: 1, tasa: 50 }],
  nota: 'Es una tendencia, no una prueba.',
};

async function abrir(page, vista = '') {
  await servirFixture(page, 'casoE');
  const datos = {
    ...base(),
    por_revisar: { lecciones: [pendiente], porques: [porque], actas: [] },
    libro: [aceptada],
    comparaciones: [comparacion],
    efecto,
  };
  await page.route(`**${API}/aprendizaje`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(datos) }),
  );
  await page.goto(`/#/aprendizaje${vista}`);
}

test('should_open_from_the_sidebar_with_what_waits_for_review', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  await page.goto('/#/pipeline');

  // Act
  await page.getByTestId('nav-aprendizaje').click();

  // Assert
  await expect(page).toHaveURL(/#\/aprendizaje$/);
  await expect(page.getByTestId('aprendizaje-vacio')).toBeVisible();
});

test('should_accept_a_lesson_seeing_its_evidence', async ({ page }) => {
  // Arrange
  await abrir(page);

  // Act
  await expect(page.getByTestId('evidencia-7')).toContainText(
    'cambio 3 · apartado 2 · Planificación · memoria-presentada.docx: + el 3 de marzo',
  );
  await page.getByTestId('aceptar-7').click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({ metodo: 'PATCH', ruta: `${API}/lecciones/7`, cuerpo: { decision: 'aceptar' } });
});

test('should_adjust_the_scope_to_the_body_of_its_tender_without_typing', async ({ page }) => {
  // Arrange
  await abrir(page);

  // Act
  await page.getByTestId('alcance-7').click();
  const ajuste = page.getByTestId('ajustar-7');
  await ajuste.getByLabel('Alcance').selectOption('organo');
  await page.getByTestId('guardar-alcance-7').click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({
      metodo: 'PATCH',
      ruta: `${API}/lecciones/7/alcance`,
      cuerpo: { alcance: 'organo', alcance_valor: 'Gestión de Servicios para la Salud', tema: 'planificacion' },
    });
});

test('should_answer_why_a_change_was_made_with_one_click', async ({ page }) => {
  await abrir(page);
  await page.getByTestId('porque-2-5').getByRole('button', { name: 'No lo pedía el pliego' }).click();
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({
      metodo: 'POST',
      ruta: `${API}/licitaciones/${CASO_E}/oferta/comparaciones/2/porque`,
      cuerpo: { n: 5, respuesta: 'No lo pedía el pliego' },
    });
});

test('should_show_the_book_with_where_each_lesson_was_used_and_retire_one_with_a_reason', async ({ page }) => {
  // Arrange
  await abrir(page, '/libro');

  // Act
  await expect(page.getByTestId('uso-9')).toHaveText('En 3 apartados de 2 ofertas · cumplida 2 de 3 · crítico 78 %');
  await page.getByLabel('Origen').selectOption('edicion');
  await expect(page.getByTestId('leccion-9')).toHaveCount(0);
  await page.getByLabel('Origen').selectOption('');
  await page.getByTestId('retirar-9').click();
  await page.getByLabel('Por qué se retira').fill('Contradice la lección del cronograma.');
  await page.getByTestId('leccion-9').getByRole('button', { name: 'Retirar' }).click();

  // Assert
  await expect
    .poll(() => page.__escrituras)
    .toContainEqual({
      metodo: 'POST',
      ruta: `${API}/lecciones/9/retirar`,
      cuerpo: { motivo: 'Contradice la lección del cronograma.' },
    });
});

test('should_compare_hermes_with_the_presentada_and_show_the_effect_as_a_trend', async ({ page }) => {
  await abrir(page, '/comparar');
  await expect(page.getByTestId('comparacion-2')).toContainText(
    '32 cambios: 12 de especificidad · 8 de estructura · 6 recortes · 4 de datos · 2 compromisos',
  );
  await page.getByText('Ver los 1 cambios').click();
  await expect(page.getByTestId('comparacion-2')).toContainText('El 3 de marzo se constituye el equipo.');
  await page.getByTestId('pestana-efecto').click();
  await expect(page.getByTestId('grafico-efecto')).toContainText('tendencia, no una prueba');
  await expect(page.getByTestId('marca-lecciones')).toHaveCount(1);
  await expect(page.getByTestId('tasa-trimestre')).toContainText('50 %');
});
