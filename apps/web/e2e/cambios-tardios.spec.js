// Cambios tardíos en el cajón Decisiones: sobre CASO_E con los
// lotes 2, 6 y 4, cambiar el precio del lote 2 abre «Qué cambia» con solo su Anexo VI y el
// paquete (0 runs, la memoria se mantiene); quitar el lote 6 enseña lo que se poda antes de
// guardar; «Deshacer» vuelve a 2, 6 y 4 sin encolar nada; y el precio se guarda aunque el equipo
// tenga un problema. La API es la frontera: se responde como lo haría el servidor (las formas de
// dependencias.ts y decisionesSecciones.ts), porque la captura de CASO_E aún no trae anexos rellenos.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const CASO_E = 'p-91000080';
const API = `/api/licitaciones/licitaciones/${CASO_E}`;
const RUTA = `/#/licitaciones/oportunidades/${CASO_E}/oferta`;
const DATOS = leerDatos('casoE');
const PERSONA_LOTE_6 = {
  persona_id: 6,
  rol_en_la_oferta: 'Docente principal del lote 6',
  dedicacion: 'Parcial',
  lotes: ['6'],
};

const af = (pieza, clave, nombre, accion, extra = {}) => ({
  pieza,
  clave,
  nombre,
  accion,
  por: [],
  coste: { min: 0, runs: 0 },
  pierde: [],
  ...extra,
});
const IMPACTO_PRECIO = {
  afectadas: [
    af('anexo', 'a1-d6', 'Anexo VI del lote 2', 'regenerar', { por: ['decision.precio[2]'] }),
    af('paquete', 'v1', 'El paquete', 'regenerar', { por: ['Anexo VI del lote 2'] }),
  ],
  se_mantiene: ['la memoria: no puede mencionar el precio'],
  resumen: 'Cambia el Anexo VI del lote 2 y el paquete; la memoria se mantiene. Se hace en segundos, sin runs.',
};
const IMPACTO_QUITAR_6 = {
  afectadas: [
    af('decisiones', 'lote-6', 'Las decisiones del lote 6', 'podar', {
      por: ['ambito.lotes: quita 6'],
      pierde: ['el precio del lote 6', 'los criterios por fórmula del lote 6', 'Persona G (solo va en el lote 6)'],
    }),
    af('documento', 'a1-d7', 'Anexo VI del lote 6', 'ocultar', { por: ['ambito.lotes: quita 6'] }),
    af('apartado', 'v1-1', 'Apartado 1 · Propuesta formativa', 'rehacer', {
      por: ['ambito.lotes: quita 6'],
      coste: { min: 12, runs: 1 },
    }),
  ],
  se_mantiene: ['la ficha: sigue valiendo', 'el guion: sigue valiendo'],
  resumen: 'Se podan las decisiones del lote 6 y se rehace el apartado 1, que lo nombra.',
};
const IMPACTO_DESHACER = {
  afectadas: [af('decisiones', 'lote-6', 'Las decisiones del lote 6', 'revisar', { por: ['ambito.lotes: añade 6'] })],
  se_mantiene: ['la memoria: se mantiene'],
  resumen: 'Vuelve el lote 6; nada se encola.',
};

const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

// La ficha con estos lotes de interés (el ámbito de las decisiones).
function ficha(lotes) {
  const f = DATOS[`GET ${API}`].body;
  const de = (id) => f.lotes.find((l) => l.id === id);
  const ambito = {
    ...f.go_no_go.ambito,
    lotes: lotes.map((id) => ({
      id,
      nombre: de(id).nombre,
      presupuesto_sin_iva: de(id).presupuesto_sin_iva,
      cpvs: de(id).cpvs,
      motivo: 'criba',
    })),
    descripcion: `Lotes ${lotes.join(', ')}`,
  };
  return {
    ...f,
    lotes: f.lotes.map((l) => ({ ...l, interes: lotes.includes(l.id) })),
    go_no_go: { ...f.go_no_go, ambito },
  };
}

function oferta(s) {
  const o = DATOS[`GET ${API}/oferta`].body;
  const equipo = s.lotes.includes('6') ? [...o.decisiones.datos.equipo, PERSONA_LOTE_6] : o.decisiones.datos.equipo;
  const ofertas = s.lotes.map(
    (lote) => s.precios.find((x) => x.lote === lote) ?? { lote, pendiente: true, importe: null, unitarios: [] },
  );
  return {
    ...o,
    decisiones: {
      ...o.decisiones,
      version: s.version,
      datos: { ...o.decisiones.datos, lotes: s.lotes, equipo, ofertas },
    },
  };
}

const historial = (s) =>
  Array.from({ length: s.version }, (_, i) => ({
    version: s.version - i,
    secciones: ['lotes'],
    autor: 'web',
    motivo: null,
    creada_en: '2026-10-14T15:00:00.000Z',
  }));

function impactoDe(cuerpo) {
  if (cuerpo?.deshacer) return IMPACTO_DESHACER;
  if (cuerpo?.cambio?.lotes) return IMPACTO_QUITAR_6;
  return IMPACTO_PRECIO;
}

// PATCH de una sección y deshacer, como el servidor: versión nueva y, con lotes, la poda.
function escribir(s, ruta, cuerpo) {
  if (ruta.endsWith('/oferta/decisiones/deshacer')) {
    s.lotes = s.previos.pop();
    s.version += 1;
    return {
      version: s.version,
      restaurada: s.version - 2,
      secciones: ['lotes'],
      datos: oferta(s).decisiones.datos,
      avisos: [],
      problemas: [],
    };
  }
  if (ruta.endsWith('/oferta/decisiones/lotes')) {
    s.previos.push(s.lotes);
    s.lotes = cuerpo.valor;
  }
  if (ruta.endsWith('/oferta/decisiones/precio')) s.precios = cuerpo.valor;
  s.version += 1;
  return { version: s.version, datos: oferta(s).decisiones.datos, avisos: [], problemas_otras: s.problemasOtras };
}

async function servirCasoE(page, { problemasOtras = [] } = {}) {
  await servirFixture(page, 'casoE');
  const s = { lotes: ['2', '6', '4'], previos: [], precios: [], version: 1, problemasOtras, escrituras: [] };
  const apuntar = (route) => {
    const url = new URL(route.request().url());
    const e = {
      metodo: route.request().method(),
      ruta: `${url.pathname}${url.search}`,
      cuerpo: route.request().postDataJSON(),
    };
    s.escrituras.push(e);
    return e;
  };
  await page.route(
    (url) => url.pathname === API,
    (route) => json(route, ficha(s.lotes)),
  );
  await page.route(
    (url) => url.pathname === `${API}/oferta`,
    (route) => json(route, oferta(s)),
  );
  await page.route(
    (url) => url.pathname === `${API}/oferta/decisiones/historial`,
    (route) => json(route, historial(s)),
  );
  await page.route(
    (url) => url.pathname === `${API}/oferta/impacto`,
    (route) => json(route, impactoDe(apuntar(route).cuerpo)),
  );
  await page.route(
    (url) => /\/oferta\/decisiones\/(lotes|precio|equipo|deshacer)$/.test(url.pathname),
    (route) => {
      const e = apuntar(route);
      return json(route, escribir(s, e.ruta.split('?')[0], e.cuerpo));
    },
  );
  return s;
}

const cajon = (page) => page.getByTestId('cajon-decisiones');

async function abrirDecisiones(page, opciones) {
  const s = await servirCasoE(page, opciones);
  await page.goto(RUTA);
  await expect(page.getByTestId('veredicto')).toBeVisible();
  await page.getByTestId('abrir-cajon-decisiones').click();
  await expect(cajon(page).getByTestId('seccion-lotes')).toBeVisible();
  return s;
}

async function quitarLote6(page) {
  await cajon(page).getByTestId('decision-lote-6').uncheck();
  await cajon(page).getByTestId('guardar-lotes').click();
}

test('should_open_impacto_with_only_lot_2_annex_vi_and_package_at_0_runs_when_changing_precio_lote_2_from_the_annex_row_in_casoE', async ({
  page,
}) => {
  // Arrange: desde la fila del precio del lote 2 en la Revisión (la que rellena su Anexo VI) se abren
  // las decisiones de la Oferta en ese precio.
  const s = await servirCasoE(page);
  await page.goto(RUTA.replace(/oferta$/, 'revision'));
  await page.getByTestId('bloqueo-precio:2').getByTestId('bloqueo-accion').click();
  const campo = cajon(page).locator('[data-foco="precio.2"]');
  await expect(campo).toBeFocused();
  await campo.fill('98,50');

  // Act
  await cajon(page).getByTestId('precio-lote-2-guardar').click();

  // Assert
  const panel = cajon(page).getByTestId('impacto');
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId('impacto-se-rehace').locator('li')).toHaveCount(2);
  await expect(panel.getByTestId('impacto-se-rehace-a1-d6')).toContainText('Anexo VI del lote 2');
  await expect(panel.getByTestId('impacto-se-rehace-v1')).toContainText('El paquete');
  await expect(panel.getByTestId('impacto-se-marca')).toHaveCount(0);
  await expect(panel.getByTestId('impacto-rehacer')).toContainText('0 runs');
  await expect(panel.getByTestId('impacto-resumen')).toContainText('la memoria se mantiene');
  await panel.getByTestId('impacto-mantiene').locator('summary').click();
  await expect(panel.getByTestId('impacto-mantiene')).toContainText('la memoria');
  expect(s.escrituras).toEqual([
    { metodo: 'POST', ruta: `${API}/oferta/impacto`, cuerpo: { cambio: { decisiones: { precio: { lote: '2' } } } } },
  ]);
  expect(page.__escrituras).toEqual([]);
});

test('should_list_what_lot_6_loses_and_the_sections_that_name_it_when_removing_lot_6_in_casoE', async ({ page }) => {
  // Arrange
  const s = await abrirDecisiones(page);
  await expect(cajon(page).getByTestId('decision-lote-6')).toBeChecked();

  // Act
  await quitarLote6(page);

  // Assert: antes de guardar, lo que se poda y el apartado que nombra el lote 6.
  const panel = cajon(page).getByTestId('seccion-lotes').getByTestId('impacto');
  await expect(panel.getByTestId('impacto-pierde')).toContainText('el precio del lote 6');
  await expect(panel.getByTestId('impacto-pierde')).toContainText('los criterios por fórmula del lote 6');
  await expect(panel.getByTestId('impacto-pierde')).toContainText('Persona G (solo va en el lote 6)');
  await expect(panel.getByTestId('impacto-se-rehace-v1-1')).toContainText('Apartado 1 · Propuesta formativa');
  await expect(panel.getByTestId('impacto-se-rehace-a1-d7')).toContainText('Anexo VI del lote 6');
  expect(s.escrituras).toEqual([
    { metodo: 'POST', ruta: `${API}/oferta/impacto`, cuerpo: { cambio: { lotes: ['2', '4'] } } },
  ]);
  await panel.getByTestId('impacto-rehacer').click();
  await expect(cajon(page).getByTestId('decision-lote-6')).not.toBeChecked();
  expect(s.escrituras.at(-1)).toEqual({
    metodo: 'PATCH',
    ruta: `${API}/oferta/decisiones/lotes`,
    cuerpo: { version: 1, valor: ['2', '4'] },
  });
});

test('should_undo_back_to_lots_2_6_4_without_queueing_anything', async ({ page }) => {
  // Arrange: quitado el lote 6 y guardado (v2).
  const s = await abrirDecisiones(page);
  await quitarLote6(page);
  await cajon(page).getByTestId('seccion-lotes').getByTestId('impacto-rehacer').click();
  await expect(cajon(page).getByTestId('deshacer')).toBeVisible();
  // Guardar con «rehacer» pide solo los apartados que nombraban el lote 6; deshacer no pide nada más.
  const afectados = {
    metodo: 'POST',
    ruta: `${API}/oferta/memoria/1/actualizar-afectados`,
    cuerpo: { cambio: { lotes: ['2', '4'] } },
  };
  await expect.poll(() => page.__escrituras).toEqual([afectados]);
  const antes = s.escrituras.length;

  // Act
  await cajon(page).getByTestId('deshacer').click();
  await cajon(page).getByTestId('impacto-rehacer').click();

  // Assert
  await expect(cajon(page).getByTestId('deshacer-aviso')).toContainText('vuelven las decisiones de la v1');
  for (const lote of ['2', '6', '4']) await expect(cajon(page).getByTestId(`decision-lote-${lote}`)).toBeChecked();
  expect(s.escrituras.slice(antes)).toEqual([
    { metodo: 'POST', ruta: `${API}/oferta/impacto`, cuerpo: { deshacer: true } },
    { metodo: 'POST', ruta: `${API}/oferta/decisiones/deshacer`, cuerpo: { version: 2 } },
  ]);
  expect(page.__escrituras).toEqual([afectados]);
});

test('should_save_price_while_team_section_has_a_problem', async ({ page }) => {
  // Arrange: un rol vacío en el equipo (no se puede guardar esa sección) y el servidor avisa de ello.
  const s = await abrirDecisiones(page, {
    problemasOtras: ['Docente principal del lote 2: falta el rol en la oferta.'],
  });
  const equipo = cajon(page).getByTestId('seccion-equipo');
  await equipo.locator('input[aria-label^="Rol de"]').first().fill('');
  await equipo.getByTestId('guardar-equipo').click();
  await expect(equipo).toContainText('Cada persona del equipo lleva su rol en la oferta');
  await cajon(page).getByTestId('precio-lote-2').fill('98,50');

  // Act
  await cajon(page).getByTestId('precio-lote-2-guardar').click();
  await cajon(page).getByTestId('impacto-confirmar').check();
  await cajon(page).getByTestId('impacto-rehacer').click();

  // Assert
  await expect(cajon(page).getByTestId('precio-lote-2-estado')).toHaveAttribute('data-estado', 'decidido');
  await expect(cajon(page).getByTestId('precio-lote-2-fila')).toContainText('falta el rol en la oferta');
  await expect(equipo.getByTestId('sin-guardar-equipo')).toBeVisible();
  const patch = s.escrituras.filter((e) => e.metodo === 'PATCH');
  expect(patch.map((e) => e.ruta)).toEqual([`${API}/oferta/decisiones/precio`]);
  expect(patch[0].cuerpo.valor.find((o) => o.lote === '2')).toMatchObject({ lote: '2', pendiente: false });
  expect(page.__escrituras).toEqual([]);
});

test('should_keep_the_just_saved_section_while_the_offer_reload_fails', async ({ page }) => {
  // Arrange: tras guardar, la recarga de la oferta falla por red.
  const s = await abrirDecisiones(page);
  let sinRed = false;
  await page.route(
    (url) => url.pathname === `${API}/oferta`,
    (route) => (sinRed ? route.abort('internetdisconnected') : route.fallback()),
  );
  // El enfoque no rehace nada por código: se guarda sin abrir «Qué cambia».
  await page.route(
    (url) => url.pathname === `${API}/oferta/impacto`,
    (route) => json(route, { afectadas: [], se_mantiene: ['la memoria: se mantiene'], resumen: 'Nada más cambia.' }),
  );
  await page.route(
    (url) => url.pathname === `${API}/oferta/decisiones/enfoque`,
    (route) => {
      sinRed = true;
      s.escrituras.push({
        metodo: route.request().method(),
        ruta: `${API}/oferta/decisiones/enfoque`,
        cuerpo: route.request().postDataJSON(),
      });
      return json(route, { version: s.version + 1, avisos: [], problemas_otras: [] });
    },
  );
  const enfoque = cajon(page).locator('[data-foco="enfoque"]');
  const nuevo = 'Enfoque nuevo: tutorización semanal y seguimiento de cada alumna.';

  // Act
  await enfoque.fill(nuevo);
  await cajon(page).getByTestId('guardar-enfoque').click();

  // Assert: lo guardado se queda en el campo, sin «● sin guardar», aunque la oferta no se recargue.
  await expect.poll(() => s.escrituras.some((e) => e.ruta.endsWith('/oferta/decisiones/enfoque'))).toBe(true);
  await expect(cajon(page).getByTestId('sin-guardar-enfoque')).toHaveCount(0);
  await expect(enfoque).toHaveValue(nuevo);
});
