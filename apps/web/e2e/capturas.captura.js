// Capturas de la documentación y de la web del producto: `npm run capturas -w @sobre-abierto/web` con
// CAPTURAS_DIR apuntando a la carpeta de salida. Escribe <CAPTURAS_DIR>/docs/<id>.png (los huecos
// «captura: id» de docs/) y <CAPTURAS_DIR>/web/<id>.png (las de la home). Sirve el banco de fixtures
// (e2e/datos) con los datos sintéticos de capturas-datos.js encima: nunca hay datos reales detrás.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { test, expect } from '@playwright/test';
// Las mismas piezas que usa el servidor: el email de la vista previa y cómo se describe cada acción de Hermes.
import { montarCorreo } from '../../server/src/nucleo/correoPlantillas.ts';
import { describeResult, describeToolCall } from '../../server/src/nucleo/hermes/actividadHerramientas.ts';
import { entrarComo, leerDatos, persona, USUARIOS } from './api.js';
import {
  BUSQUEDA_BIBLIOTECA,
  CASO_C,
  CASO_D,
  COLA_EN_MARCHA,
  EQUIPO,
  ESTADO_INDEXADOR,
  FICHA_PERSONA_A,
  NOTAS,
  PANORAMA,
  PRESENTADAS,
  LLAMADAS_HERMES,
  PLANTILLA_RESUMEN,
  REVISION,
  SESION,
  USOS,
  aprendizaje,
  empresaFicticia,
  indicesCasoD,
  instalacionEnMarcha,
  memoriaEvaluada,
  pipeline,
  responder,
} from './capturas-datos.js';

const DESTINO = process.env.CAPTURAS_DIR;
const VAULT = '/hermes-vault/api/v1';
// Por encima de esto, la captura se guarda a 1x: la documentación no necesita más.
const PESO_MAXIMO = 400 * 1024;

test.beforeAll(() => {
  if (!DESTINO) throw new Error('Falta CAPTURAS_DIR: la carpeta donde escribir las capturas.');
});

/**
 * Guarda la pantalla (o `clip`, en px CSS) en cada `nombre` («docs/pipeline»). Antes espera a las
 * fuentes y a la red, y comprueba que no quede nada cargando ni una ruta sin datos.
 */
async function guardar(page, nombres, { clip, escala = 'device' } = {}) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByText('Sin fixture para esta ruta')).toHaveCount(0);
  await expect(page.getByText(/^Cargando/)).toHaveCount(0);
  await page.mouse.move(0, 0);
  const opciones = { clip, animations: 'disabled', caret: 'hide', scale: escala };
  let png = await page.screenshot(opciones);
  if (png.length > PESO_MAXIMO) png = await page.screenshot({ ...opciones, scale: 'css' });
  for (const nombre of nombres) {
    const archivo = path.join(DESTINO, `${nombre}.png`);
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, png);
  }
}

/** La caja de un elemento con un margen, para recortar a la zona que importa. */
async function caja(locator, margen = 16) {
  const b = await locator.boundingBox();
  return { x: b.x - margen, y: b.y - margen, width: b.width + 2 * margen, height: b.height + 2 * margen };
}

/** El contenido de la ficha (sin la barra lateral), de las pestañas hasta `y`. */
async function fichaHasta(page, y) {
  const pestanas = await page.getByRole('tablist').first().boundingBox();
  const x = Math.floor(pestanas.x - 20);
  const desde = Math.floor(pestanas.y - 12);
  return { x, y: desde, width: page.viewportSize().width - x, height: Math.ceil(y - desde) };
}

async function finDe(locator, margen = 16) {
  const b = await locator.boundingBox();
  return b.y + b.height + margen;
}

/** La ficha del caso D con sus índices de mercado (los mismos en la cabecera y en la pestaña Mercado). */
async function fichaCasoD(page) {
  await instalacionEnMarcha(page, 'casoD');
  const indices = indicesCasoD();
  await responder(page, `/licitaciones/${CASO_D}/indices`, indices);
  await responder(page, `/licitaciones/${CASO_D}/comparables`, indices.comparables);
}

/** De arriba de la página hasta el final de `locator`, a lo ancho. */
async function hasta(page, locator, margen = 24) {
  const b = await locator.boundingBox();
  return { x: 0, y: 0, width: page.viewportSize().width, height: Math.ceil(b.y + b.height + margen) };
}

test('pipeline', async ({ page }) => {
  await instalacionEnMarcha(page);
  await responder(page, '/api/licitaciones/pipeline', pipeline());
  await page.goto('/#/pipeline');
  await expect(page.getByTestId('tarjeta-p-91001060')).toBeVisible();
  await guardar(page, ['web/pipeline', 'docs/pipeline']);
});

test('oportunidades', async ({ page }) => {
  // A 1440 px la columna del título se queda en 130 px: más ancho para que se lea la lista.
  await page.setViewportSize({ width: 1680, height: 1000 });
  await instalacionEnMarcha(page);
  await responder(page, (url) => url.pathname === '/api/licitaciones/revision', REVISION);
  await page.goto('/#/oportunidades');
  await expect(page.locator('tr[data-fila="p-91001101"]')).toBeVisible();
  await guardar(page, ['web/radar', 'docs/oportunidades']);
});

test('ficha', async ({ page }) => {
  await fichaCasoD(page);
  await page.goto(`/#/licitacion/${CASO_D}/requisitos`);
  const fiabilidad = page.getByText(/^Fiabilidad de la ficha/);
  await expect(fiabilidad).toBeVisible();
  await guardar(page, ['web/ficha', 'docs/ficha'], { clip: await hasta(page, fiabilidad) });
});

test('ficha-mercado', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1300 });
  await fichaCasoD(page);
  await page.goto(`/#/licitacion/${CASO_D}/mercado`);
  const comparables = page.getByTestId('comparables-indice');
  await comparables.locator('summary').click();
  await expect(comparables.getByRole('table')).toBeVisible();
  await guardar(page, ['docs/ficha-mercado'], { clip: await fichaHasta(page, await finDe(comparables, 6)) });
});

test('oferta', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fichaCasoD(page);
  await page.goto(`/#/licitacion/${CASO_D}/oferta`);
  const generar = page.getByText('Al pulsar OK, Hermes genera');
  await expect(generar).toBeVisible();
  await guardar(page, ['docs/oferta']);
});

test('revision', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2800 });
  await fichaCasoD(page);
  await responder(page, '/oferta/precio/contexto', { organo: { n: 0 }, un_licitador: null, indicios: null });
  await responder(page, '/oferta/revision', { tarjetas: [], nuevas: 0 });
  await responder(page, '/oferta/paquete', { paquete: null });
  await page.goto(`/#/licitacion/${CASO_D}/revision`);
  await expect(page.getByText('Qué impide presentar')).toBeVisible();
  // Hasta la primera tarjeta por sobre: lo que viene después («Comprobado») ya no cuenta.
  const comprobado = await page.getByText(/^Comprobado \(/).boundingBox();
  await guardar(page, ['docs/revision'], { clip: await fichaHasta(page, comprobado.y - 8) });
});

test('mercado', async ({ page }) => {
  await instalacionEnMarcha(page);
  await responder(page, '/mercado/panorama', PANORAMA);
  await page.goto('/#/mercado');
  await expect(page.getByTestId('panorama-ganadores')).toContainText('Sistemas Ejemplo');
  await guardar(page, ['web/mercado', 'docs/mercado']);
});

test('aprendizaje', async ({ page }) => {
  await instalacionEnMarcha(page);
  await responder(page, '/api/licitaciones/aprendizaje', aprendizaje());
  await page.goto('/#/aprendizaje');
  await expect(page.getByTestId('aceptar-7')).toBeVisible();
  await guardar(page, ['docs/aprendizaje'], { clip: await hasta(page, page.getByTestId('aceptar-8'), 40) });
});

async function biblioteca(page) {
  await instalacionEnMarcha(page);
  await responder(page, `${VAULT}/vault/notes`, { items: NOTAS });
  await responder(page, `${VAULT}/documents/status`, ESTADO_INDEXADOR);
  await responder(page, `${VAULT}/inbox`, { items: [] });
  await responder(page, '/api/plataforma/biblioteca/usos', { usos: USOS });
  await responder(page, (url) => url.pathname === `${VAULT}/search`, BUSQUEDA_BIBLIOTECA);
}

test('biblioteca', async ({ page }) => {
  await biblioteca(page);
  await page.goto('/#/biblioteca');
  await expect(page.getByTestId('biblioteca-notas')).toContainText('9 ofertas');
  await guardar(page, ['docs/biblioteca']);
});

test('biblioteca-busqueda', async ({ page }) => {
  await biblioteca(page);
  await page.goto('/#/biblioteca');
  await expect(page.getByTestId('biblioteca-notas')).toBeVisible();
  await page.getByRole('button', { name: /^Buscar/ }).click();
  await page.getByRole('textbox', { name: 'Buscar en la Biblioteca' }).fill('cuadro de mando de calidad del aire');
  const resultados = page.getByRole('listbox', { name: 'Resultados' }).getByRole('option');
  await expect(resultados).toHaveCount(BUSQUEDA_BIBLIOTECA.items.length);
  await guardar(page, ['web/biblioteca']);
});

test('equipo', async ({ page }) => {
  await instalacionEnMarcha(page);
  await page.route(
    (url) => url.pathname.startsWith('/api/colaboradores'),
    (route) => {
      const ruta = new URL(route.request().url()).pathname;
      const cuerpo = {
        '/api/colaboradores': { items: EQUIPO, propuestas_pendientes: 0, a_incorporar: 0 },
        '/api/colaboradores/1': FICHA_PERSONA_A,
        '/api/colaboradores/a-incorporar': [],
        '/api/colaboradores/propuestas': [],
      }[ruta];
      return cuerpo ? route.fulfill({ json: cuerpo }) : route.fallback();
    },
  );
  await page.goto('/#/equipo/1');
  await expect(page.getByTestId('persona-donde')).toContainText('CP-0417/2027');
  await guardar(page, ['docs/equipo']);
});

/** Lo que Hermes hizo en la sesión, descrito como lo describe el servidor (actividadHerramientas). */
function actividad() {
  const inicio = Date.parse('2027-10-13T20:15:02Z');
  const turno = {
    id: `turn:${SESION.id}:1`,
    sessionId: SESION.id,
    actor: 'hermes',
    kind: 'turn',
    subject: 'Ficha de CP-0417/2027: lee los pliegos y rellena lotes, requisitos y criterios con su cita',
    status: 'ok',
    at: inicio,
  };
  const items = LLAMADAS_HERMES.map(([nombre, args, resultado], i) => {
    const d = describeToolCall(nombre, args, `c${i}`);
    const at = inicio + (i + 1) * 90_000;
    const fin = resultado === null ? {} : { ...describeResult(resultado), endedAt: at + 40_000 };
    return {
      id: `tool:${SESION.id}:c${i}`,
      sessionId: SESION.id,
      actor: 'hermes',
      kind: 'tool',
      category: d.category,
      tool: d.tool,
      subject: d.subject,
      at,
      status: 'running',
      ...fin,
    };
  });
  return { activity: [turno, ...items] };
}

test('actividad', async ({ page }) => {
  await instalacionEnMarcha(page);
  await responder(page, '/api/plataforma/cola/resumen', COLA_EN_MARCHA);
  await responder(page, (url) => url.pathname === '/api/sessions', { sessions: [SESION] });
  await responder(page, `/api/sessions/${SESION.id}/activity`, actividad());
  await page.goto('/#/actividad');
  await expect(page.getByText(/plataforma_biblioteca_buscar|formación en gestión documental/).first()).toBeVisible();
  await guardar(page, ['docs/actividad']);
});

test('navegacion', async ({ page }) => {
  await instalacionEnMarcha(page);
  await responder(page, '/api/plataforma/cola/resumen', COLA_EN_MARCHA);
  await responder(page, '/api/licitaciones/pipeline', pipeline());
  await page.goto('/#/pipeline');
  await expect(page.getByText('Servidor ✓ · Hermes ✓')).toBeVisible();
  const barra = page.getByRole('navigation').first();
  const b = await barra.boundingBox();
  await guardar(page, ['docs/navegacion'], { clip: { x: 0, y: 0, width: Math.ceil(b.x + b.width), height: 900 } });
});

test('ajustes', async ({ page }) => {
  await instalacionEnMarcha(page);
  await responder(page, '/api/plataforma/empresa', empresaFicticia());
  await responder(page, '/api/plataforma/empresa/documentos', { documentos: [] });
  await responder(page, '/api/plataforma/empresa/costes', { costes: null });
  await responder(page, (url) => url.pathname === '/api/colaboradores', { items: EQUIPO });
  await page.goto('/#/ajustes/empresa');
  await expect(page.getByRole('textbox', { name: 'NIF', exact: true })).toHaveValue('B00123455');
  await guardar(page, ['docs/ajustes']);
});

// El email tal como lo monta el servidor (montarCorreo), con la marca de la empresa ficticia.
const resumenSemanal = () =>
  montarCorreo(PLANTILLA_RESUMEN, 'https://sobre-abierto.ejemplo.es', { nombre: 'Analítica Ejemplo', tema: {} }).html;

test('resumen-semanal', async ({ page, context }) => {
  await instalacionEnMarcha(page);
  await entrarComo(page, persona(USUARIOS[0]));
  // La vista previa se abre en otra pestaña: se sirve en el contexto, no en la página.
  await context.route('**/api/plataforma/avisos/resumen/previa', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: resumenSemanal() }),
  );
  await page.goto('/#/ajustes/avisos');
  const [previa] = await Promise.all([context.waitForEvent('page'), page.getByTestId('resumen-previa').click()]);
  await previa.setViewportSize({ width: 760, height: 1600 });
  await previa.waitForLoadState('load');
  await expect(previa.getByText('Qué hacer esta semana')).toBeVisible();
  // La tarjeta del email, con un poco del fondo alrededor.
  await guardar(previa, ['docs/resumen-semanal'], { clip: await caja(previa.locator('table').nth(1), 20) });
});

test('presentadas', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1700 });
  await instalacionEnMarcha(page);
  await responder(page, (url) => url.pathname === '/api/licitaciones/propuestas', PRESENTADAS);
  await responder(page, '/api/licitaciones/aprendizajes', { items: [], pendientes_de_leer: 0 });
  await page.goto('/#/pipeline/presentadas');
  await expect(page.getByTestId('presentadas-kpis')).toContainText('75');
  // La columna de lo presentado: a la derecha solo dice «Elige una propuesta».
  const kpis = await page.getByTestId('presentadas-kpis').boundingBox();
  const fin = await finDe(page.getByTestId('presentada-7'));
  const pestanas = await page.getByRole('tablist').first().boundingBox();
  const x = Math.floor(kpis.x - 24);
  const y = Math.floor(pestanas.y - 12);
  // Es una columna larga y estrecha: a 1x se ve entera sin ocupar media página de la documentación.
  const clip = { x, y, width: kpis.width + 48, height: fin - y };
  await guardar(page, ['docs/presentadas'], { clip, escala: 'css' });
});

test('primeros-pasos', async ({ page }) => {
  const vacio = pipeline();
  await instalacionEnMarcha(page);
  await entrarComo(page, persona(USUARIOS[0]));
  await responder(page, '/api/licitaciones/pipeline', {
    ...vacio,
    columnas: vacio.columnas.map((c) => ({ ...c, tarjetas: [] })),
  });
  const estado = leerDatos('casoE')['GET /api/licitaciones/estado'].body;
  await responder(page, '/api/licitaciones/estado', { ...estado, activo: true, aviso_hermes: null });
  await responder(page, '/api/licitaciones/filtros', {
    ...leerDatos('casoE')['GET /api/licitaciones/filtros'].body,
    de_ejemplo: true,
  });
  await responder(page, '/api/plataforma/empresa', { perfil: null, actualizado_en: null, propuesta: null });
  await responder(page, '/api/drive/status', {
    data: {
      configured: false,
      connected: false,
      account: null,
      folder: null,
      sync: null,
      copia: null,
      redirectUri: '',
    },
  });
  await page.goto('/#/pipeline');
  await expect(page.getByTestId('primeros-pasos')).toBeVisible();
  await guardar(page, ['docs/primeros-pasos']);
});

async function memoriaCasoC(page) {
  const { oferta, memoria, propuesta } = memoriaEvaluada();
  await instalacionEnMarcha(page, 'casoC');
  await responder(page, `/licitaciones/${CASO_C}/oferta`, oferta);
  await responder(page, `/licitaciones/${CASO_C}/oferta/memoria`, memoria);
  await responder(page, `/licitaciones/${CASO_C}/propuesta`, propuesta);
  await responder(page, (url) => url.pathname === '/api/colaboradores', { items: EQUIPO });
  await page.goto(`/#/licitacion/${CASO_C}/oferta`);
  await page.getByRole('button', { name: 'Memoria', exact: true }).click();
  await expect(page.getByText(/^Memoria v3/)).toBeVisible();
}

test('oferta-pasos', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2600 });
  await memoriaCasoC(page);
  // El detalle de la oferta: guion, decisiones, equipo, memoria y documentos, con la memoria abierta.
  const desde = await page.getByText('Detalle de la oferta', { exact: true }).boundingBox();
  const fin = await finDe(page.getByText(/^Más opciones/), 24);
  const x = Math.floor(desde.x - 20);
  await guardar(page, ['docs/oferta-pasos'], {
    clip: { x, y: desde.y - 8, width: page.viewportSize().width - x, height: fin - desde.y + 8 },
  });
});

test('memoria', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 2800 });
  await memoriaCasoC(page);
  await page.getByText(/^Evaluación orientativa de Hermes/).click();
  await expect(page.getByText(/^crítico ciego ·/)).toBeVisible();
  // Dentro de la tarjeta de la memoria, sin sus bordes.
  const desde = await page.getByText(/^Memoria v3/).boundingBox();
  const descartar = await page.getByRole('button', { name: 'Descartar', exact: true }).boundingBox();
  const hastaY = await finDe(page.getByRole('button', { name: 'Volver a evaluar' }));
  const x = Math.floor(desde.x - 12);
  await guardar(page, ['web/oferta'], {
    clip: { x, y: desde.y - 12, width: descartar.x + descartar.width + 12 - x, height: hastaY - desde.y + 12 },
  });
});
