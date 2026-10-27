// Recorridos de los cambios tardíos: la persona revisa lo que hizo Hermes desde la Revisión sin
// abrir el Word ni el pliego. Sobre las capturas de CASO_D, Villaejemplo y CASO_E (e2e/datos) y, para las
// rutas nuevas de los cambios tardíos que aún no genera `npm run e2e:datos`, con respuestas de la forma que da el
// servidor (revisionHermes, diffPropuesta, matrizEquipo, vistaAnexo, resumenMemoria,
// apartadosAfectados), sacadas de las mismas capturas sembradas. Nunca hay servidor detrás.
import { test, expect } from '@playwright/test';
import { leerDatos, servirFixture } from './api.js';

const ID = { casoD: 'p-91000880', casoC: 'p-91000770', casoE: 'p-91000080' };
const api = (oferta, resto = '') => `/api/licitaciones/licitaciones/${ID[oferta]}${resto}`;
const rutaFicha = (oferta, seccion) => `/#/licitaciones/oportunidades/${ID[oferta]}/${seccion}`;
const json = (route, body, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const tarjeta = (clave, tipo, titulo, resumen, extra = {}) => ({
  clave,
  tipo,
  titulo,
  resumen,
  lote: null,
  creada_en: '2027-10-13T11:11:11.444Z',
  huella: 'h',
  estado: 'pendiente',
  nueva_para_ti: true,
  acreditacion: false,
  ...extra,
});

// Lo que la página escribe en las rutas que cada spec atiende: método, ruta y cuerpo.
function apuntador() {
  const escrituras = [];
  const apuntar = (route) => {
    const url = new URL(route.request().url());
    escrituras.push({
      metodo: route.request().method(),
      ruta: `${url.pathname}${url.search}`,
      cuerpo: route.request().postDataJSON(),
    });
  };
  return { escrituras, apuntar };
}

const esRuta = (ruta) => (url) => url.pathname === ruta;

// La bandeja «Revisar lo que hizo Hermes» con estas tarjetas; «vista» y descartar no cambian nada aquí.
async function servirBandeja(page, oferta, tarjetas, a) {
  await page.route(esRuta(api(oferta, '/oferta/revision')), (route) =>
    json(route, { tarjetas, nuevas: tarjetas.length }),
  );
  await page.route(
    (url) => url.pathname.startsWith(api(oferta, '/oferta/revision/')),
    (route) => {
      a.apuntar(route);
      return json(route, { ok: true });
    },
  );
}

// «Revisar lo que hizo Hermes» está en la Revisión; los apartados del detalle, en la Oferta.
async function abrirComprobaciones(page, oferta, seccion = 'revision') {
  await page.goto(rutaFicha(oferta, seccion));
  await expect(page.getByTestId('veredicto')).toBeVisible();
  if (seccion === 'revision') await expect(page.getByTestId('revision-hermes')).toBeVisible();
}

// ── 1) CASO_D: aplicar solo el plazo del mantenimiento adicional ──

const SOPORTE = 'automatico:mantenimiento adicional del campus virtual|';
const CRITERIO_SOPORTE = 'Mantenimiento adicional del campus virtual';
const SOPORTE_GUARDADO = {
  criterio: CRITERIO_SOPORTE,
  lote: null,
  nos_acogemos: true,
  tramo: CRITERIO_SOPORTE,
  evidencia: null,
  nota: 'Ocho meses de mantenimiento desde la puesta en marcha',
};
const SOPORTE_PROPUESTO = {
  criterio: CRITERIO_SOPORTE,
  lote: null,
  nos_acogemos: true,
  tramo: CRITERIO_SOPORTE,
  evidencia: null,
  nivel: 'Periodo de mantenimiento de ocho (8) meses, a contar desde el 28 de diciembre de 2027',
};
const MOTIVO_SOPORTE =
  'Tramo máximo de 16 puntos (PCAP.pdf, pág. 23; Anexo V, pág. 1). Exige prestación real posterior al mantenimiento obligatorio hasta 27/12/2027.';

function diffCasoD(aplicado) {
  const soporte = {
    campo: SOPORTE,
    seccion: 'automaticos',
    guardado: aplicado ? SOPORTE_PROPUESTO : SOPORTE_GUARDADO,
    propuesto: SOPORTE_PROPUESTO,
    motivo_hermes: MOTIVO_SOPORTE,
    acreditacion: false,
    igual: aplicado,
  };
  return {
    guion_version: 3,
    guion_vigente: 3,
    propuesta_creada_en: '2027-10-13T11:11:11.444Z',
    campos: [
      {
        campo: 'lotes',
        seccion: 'lotes',
        guardado: ['2'],
        propuesto: ['2'],
        motivo_hermes: null,
        acreditacion: false,
        igual: true,
      },
      soporte,
      {
        campo: 'herramientas',
        seccion: 'herramientas',
        guardado: ['Chamilo'],
        propuesto: ['Chamilo', 'Jitsi'],
        motivo_hermes: null,
        acreditacion: false,
        igual: false,
      },
    ],
  };
}

test('should_fold_the_casoD_term_row_into_unchanged_after_applying_only_that_row', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoD');
  const a = apuntador();
  const s = { aplicado: false };
  await servirBandeja(
    page,
    'casoD',
    [
      tarjeta(
        'propuesta:17:2027-10-13T11:11:11.444Z',
        'propuesta',
        'Propuesta de decisiones (guion v3)',
        'Sin aplicar: automaticos, herramientas.',
      ),
    ],
    a,
  );
  await page.route(esRuta(api('casoD', '/oferta/decisiones/propuesta/diff')), (route) =>
    json(route, diffCasoD(s.aplicado)),
  );
  await page.route(esRuta(api('casoD', '/oferta/decisiones/propuesta/aplicar')), (route) => {
    a.apuntar(route);
    s.aplicado = true;
    return json(route, { version: 2, avisos: [] });
  });
  await abrirComprobaciones(page, 'casoD');
  const t = page.getByTestId('tarjeta-revision-propuesta:17:2027-10-13T11:11:11.444Z');
  await t.getByTestId('abrir-propuesta:17:2027-10-13T11:11:11.444Z').click();
  const diff = t.getByTestId('diff-propuesta');
  await expect(diff.getByTestId(`diff-fila-${SOPORTE}`)).toContainText('puesta en marcha');
  await expect(diff.getByTestId(`diff-fila-${SOPORTE}`)).toContainText('28 de diciembre de 2027');

  // Act
  await diff.getByTestId(`aplicar-fila-${SOPORTE}`).click();

  // Assert: solo ese campo, y la fila pasa a «Sin cambios»; herramientas sigue por aplicar.
  const sinCambios = diff.getByTestId('diff-sin-cambios');
  const plegado = sinCambios.locator(':scope > summary');
  await expect(plegado).toHaveText('Sin cambios (2)');
  await plegado.click();
  await expect(sinCambios.getByTestId(`diff-fila-${SOPORTE}`)).toBeVisible();
  await expect(diff.getByTestId('aplicar-fila-herramientas')).toBeVisible();
  expect(a.escrituras.filter((e) => e.ruta.endsWith('/aplicar'))).toEqual([
    { metodo: 'POST', ruta: api('casoD', '/oferta/decisiones/propuesta/aplicar'), cuerpo: { campos: [SOPORTE] } },
  ]);
  expect(page.__escrituras).toEqual([]);
});

// ── 2) Villaejemplo: la matriz del equipo con el ✗ de topografia ──

const REQUISITO_CASO_C =
  'Cada tutor debe cumplir título o experiencia mínima: marketing 1 año, transformación digital 1, IA administrativa 1, topografia 1, limpieza/mantenimiento 2.';
const celda = (materia, estado, fuente = null) => ({ materia, estado, fuente });
const MATRIZ_CASO_C = {
  filas: [
    {
      rol: 'Coordinador/a',
      lote: '3',
      materias: [],
      requisito: REQUISITO_CASO_C,
      pagina: 3,
      excluyente: true,
      asignados: [{ persona_id: 1, nombre: 'Persona F', celdas: [] }],
      incompatibles: [],
    },
    {
      rol: 'Tutor',
      lote: '3',
      materias: ['marketing', 'transformación digital', 'IA administrativa', 'topografia', 'limpieza/mantenimiento'],
      requisito: REQUISITO_CASO_C,
      pagina: 3,
      excluyente: true,
      asignados: [
        {
          persona_id: 1,
          nombre: 'Persona F',
          celdas: [
            celda('marketing', 'no'),
            celda('transformación digital', 'no'),
            celda('IA administrativa', 'si', 'colaboradores'),
            celda('topografia', 'no'),
            celda('limpieza/mantenimiento', 'no'),
          ],
        },
      ],
      incompatibles: [],
    },
  ],
};

test('should_show_the_casoC_composting_cross_with_a_link_to_the_person', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoC');
  await servirBandeja(page, 'casoC', [], apuntador());
  await page.route(esRuta(api('casoC', '/oferta/equipo/matriz')), (route) => json(route, MATRIZ_CASO_C));
  await abrirComprobaciones(page, 'casoC', 'oferta');

  // Act
  await page.getByTestId('abrir-cajon-decisiones').click();

  // Assert
  const matriz = page.getByTestId('cajon-decisiones').getByTestId('matriz-equipo');
  await expect(matriz.getByTestId('matriz-fila-tutor-3')).toContainText('(pág. 3)');
  const topografia = matriz.getByTestId('matriz-materia-tutor-1-topografia');
  await expect(topografia).toHaveAttribute('data-estado', 'no');
  await expect(topografia).toContainText('✗');
  await expect(topografia.getByRole('link')).toHaveAttribute('href', '#/equipo/1#campo=topografia');
  await expect(matriz.getByTestId('matriz-materia-tutor-1-ia-administrativa')).toHaveAttribute('data-estado', 'si');
});

// ── 3) Villaejemplo: el Anexo V con sus valores resaltados, aceptado sin abrir el Word ──

const ANEXO_V = 'anexo:a3-d1:2026-10-14T10:30:00.000Z';
const P1 = 'Se compromete a la asistencia remota al ordenador personal de las alumnas: Sí.';
const P2 = 'Número de alumnas por curso: 30. Tutores adicionales: 3.';
const VISTA_ANEXO_V = {
  clave: 'a3-d1',
  nombre:
    'ANEXO V.- PROPOSICIÓN ECONÓMICA Y OFERTA RELATIVA A LOS CRITERIOS DE ADJUDICACIÓN EVALUABLES MEDIANTE FÓRMULAS',
  version: 1,
  formato: 'docx',
  acreditacion: false,
  avisos: ['Quedan huecos sin rellenar: el importe lo pone la persona en la fila del precio.'],
  campos: null,
  parrafos: [
    {
      n: 1,
      texto: P1,
      valores: [
        {
          desde: P1.indexOf('Sí'),
          hasta: P1.indexOf('Sí') + 2,
          dato: 'Asistencia remota · lote 3',
          valor: 'Sí',
          cambiado: false,
        },
      ],
    },
    {
      n: 2,
      texto: P2,
      valores: [
        {
          desde: P2.indexOf('30'),
          hasta: P2.indexOf('30') + 2,
          dato: 'Alumnas por curso · lote 3',
          valor: '30',
          cambiado: true,
        },
        {
          desde: P2.lastIndexOf('3'),
          hasta: P2.lastIndexOf('3') + 1,
          dato: 'Tutores adicionales · lote 3',
          valor: '3',
          cambiado: false,
        },
      ],
    },
  ],
};

test('should_accept_the_casoC_annex_v_from_its_highlighted_view', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoC');
  const a = apuntador();
  await servirBandeja(
    page,
    'casoC',
    [tarjeta(ANEXO_V, 'anexo', 'Anexo V del lote 3', 'Hermes rellenó el Anexo V: revísalo.')],
    a,
  );
  await page.route(esRuta(api('casoC', '/oferta/documentos/a3-d1/vista')), (route) => json(route, VISTA_ANEXO_V));
  await page.route(esRuta(api('casoC', '/oferta/documentos/aceptar')), (route) => {
    a.apuntar(route);
    return json(route, { documentos: [] });
  });
  await abrirComprobaciones(page, 'casoC');
  const vista = page.getByTestId(`vista-anexo-${ANEXO_V}`);
  await expect(vista.locator('mark')).toHaveCount(3);
  await expect(vista.locator('mark').nth(1)).toHaveAttribute(
    'title',
    'Alumnas por curso · lote 3 · cambió frente a la versión anterior',
  );
  await expect(vista).toContainText('Quedan huecos sin rellenar');

  // Act
  await vista.getByTestId(`aceptar-anexo-${ANEXO_V}`).click();

  // Assert
  await expect.poll(() => a.escrituras.length).toBe(1);
  expect(a.escrituras).toEqual([
    { metodo: 'POST', ruta: api('casoC', '/oferta/documentos/aceptar'), cuerpo: { claves: ['a3-d1'] } },
  ]);
  expect(page.__escrituras).toEqual([]);
});

// ── 4) CASO_E: quitar el lote 6 rehace solo los apartados que lo nombran ──

const af = (pieza, clave, nombre, accion, extra = {}) => ({
  pieza,
  clave,
  nombre,
  accion,
  por: ['ambito.lotes: quita 6'],
  coste: { min: 0, runs: 0 },
  pierde: [],
  ...extra,
});
// Lo que da apartadosARehacer sobre la primera memoria de CASO_E (aceptacionCambios.test.ts): el 1 y el 2 nombran el lote 6; el 3, no.
const IMPACTO_QUITAR_6 = {
  afectadas: [
    af('decisiones', 'lote-6', 'Las decisiones del lote 6', 'podar', { pierde: ['el precio del lote 6'] }),
    af('apartado', 'v1-1', 'Apartado 1 · Propuesta formativa', 'rehacer', { coste: { min: 30, runs: 1 } }),
    af('apartado', 'v1-2', 'Apartado 2 · Metodología', 'rehacer', { coste: { min: 30, runs: 1 } }),
  ],
  se_mantiene: ['el resto de la memoria: no nombra el lote 6'],
  resumen: 'Se podan las decisiones del lote 6 y se rehacen los apartados 1 y 2, que lo nombran.',
};

// La captura de CASO_E ya iba sin el lote 6: la ficha y la oferta vuelven a los lotes 2, 6 y 4, como
// en cambios-tardios.spec.js, para quitarlo desde el cajón.
function conLote6(datos) {
  const f = datos[`GET ${api('casoE')}`].body;
  const o = datos[`GET ${api('casoE', '/oferta')}`].body;
  const lotes = ['2', '6', '4'];
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
  };
  return {
    ficha: {
      ...f,
      lotes: f.lotes.map((l) => ({ ...l, interes: lotes.includes(l.id) })),
      go_no_go: { ...f.go_no_go, ambito },
    },
    oferta: { ...o, decisiones: { ...o.decisiones, datos: { ...o.decisiones.datos, lotes } } },
  };
}

async function quitarLote6(page) {
  await servirFixture(page, 'casoE');
  await servirBandeja(page, 'casoE', [], apuntador());
  const { ficha, oferta } = conLote6(leerDatos('casoE'));
  await page.route(esRuta(api('casoE')), (route) => json(route, ficha));
  await page.route(esRuta(api('casoE', '/oferta')), (route) => json(route, oferta));
  await page.route(esRuta(api('casoE', '/oferta/impacto')), (route) => json(route, IMPACTO_QUITAR_6));
  await abrirComprobaciones(page, 'casoE', 'oferta');
  await page.getByTestId('abrir-cajon-decisiones').click();
  const cajon = page.getByTestId('cajon-decisiones');
  await cajon.getByTestId('decision-lote-6').uncheck();
  await cajon.getByTestId('guardar-lotes').click();
  return cajon.getByTestId('seccion-lotes').getByTestId('impacto');
}

test('should_list_only_the_casoE_sections_naming_lot_6_when_removing_it', async ({ page }) => {
  // Arrange y Act
  const panel = await quitarLote6(page);

  // Assert
  await expect(panel.getByTestId('impacto-se-rehace-v1-1')).toBeVisible();
  await expect(panel.getByTestId('impacto-se-rehace-v1-2')).toBeVisible();
  await expect(panel.getByTestId('impacto-se-rehace-v1-3')).toHaveCount(0);
});

test('should_offer_updating_the_two_casoE_sections_with_their_cost_when_removing_lot_6', async ({ page }) => {
  // Arrange y Act
  const panel = await quitarLote6(page);

  // Assert
  await expect(panel.getByTestId('actualizar-afectados-lista')).toContainText('2 apartados · unos 60 min · 2 runs');
});

const APARTADOS_CASO_E = [
  {
    apartado: 1,
    titulo: 'Propuesta formativa',
    antes: 'Impartiremos los lotes 2 y 4 y también el lote 6 de Microsoft Azure con un docente principal por lote.',
    despues: 'Impartiremos los lotes 2 y 4 con un docente principal por lote.',
  },
  {
    apartado: 2,
    titulo: 'Metodología',
    antes: 'El curso de Microsoft Azure del lote 6 tendrá prácticas guiadas.',
    despues: 'Los cursos tendrán prácticas guiadas.',
  },
];

function ofertaCasoEConVersionRehecha(base) {
  const primera = base.memorias.find((m) => m.version === 1) ?? base.memorias[0];
  const rehecha = {
    ...primera,
    id: 9002,
    version: 2,
    estado: 'ensamblada',
    ensayo: false,
    origen: { version_base: 1, apartados_rehechos: [1, 2] },
    apartados: APARTADOS_CASO_E.map((a) => ({ apartado: a.apartado, titulo: a.titulo, estado: 'recibido' })),
  };
  return { ...base, memorias: [rehecha, ...base.memorias] };
}

const RESUMEN_VERSION_REHECHA = {
  version: 2,
  compromisos: [],
  marcados: [],
  nota: null,
  comprobado: [],
  antes_de_aceptar: { paginas: 12, limite: 20, avisos: [], sin_redactar: [], se_descartan: [1] },
};

test('should_show_the_word_diff_of_each_redone_casoE_section_and_keep_the_previous_one', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoE');
  const a = apuntador();
  await servirBandeja(
    page,
    'casoE',
    [tarjeta('memoria:v2', 'memoria', 'Memoria técnica v2', 'Hermes rehízo los apartados 1 y 2 sin el lote 6.')],
    a,
  );
  const oferta = ofertaCasoEConVersionRehecha(leerDatos('casoE')[`GET ${api('casoE', '/oferta')}`].body);
  await page.route(esRuta(api('casoE', '/oferta')), (route) => json(route, oferta));
  await page.route(
    (url) => url.pathname.startsWith(api('casoE', '/oferta/memoria/2/resumen')),
    (route) => json(route, RESUMEN_VERSION_REHECHA),
  );
  for (const x of APARTADOS_CASO_E) {
    await page.route(esRuta(api('casoE', `/oferta/memoria/2/apartados/${x.apartado}/diff`)), (route) =>
      json(route, { antes: x.antes, despues: x.despues }),
    );
  }
  await page.route(esRuta(api('casoE', '/oferta/memoria/2/apartados/2/mantener')), (route) => {
    a.apuntar(route);
    return json(route, { version: 2 });
  });
  await abrirComprobaciones(page, 'casoE');
  await page.getByTestId('abrir-memoria:v2').click();
  const cambios = page.getByTestId('cambios-por-apartado');
  await expect(cambios.getByTestId('diff-apartado-1').locator('del', { hasText: 'lote 6' })).toHaveCount(1);
  await expect(cambios.getByTestId('diff-apartado-1').locator('ins')).toHaveCount(0);
  await expect(cambios.getByTestId('diff-apartado-3')).toHaveCount(0);

  // Act
  await cambios.getByTestId('mantener-anterior-2').click();

  // Assert
  await expect(cambios.getByTestId('anterior-mantenido-2')).toBeVisible();
  expect(a.escrituras.filter((e) => e.ruta.endsWith('/mantener'))).toEqual([
    { metodo: 'POST', ruta: api('casoE', '/oferta/memoria/2/apartados/2/mantener'), cuerpo: null },
  ]);
});

// ── 5) Villaejemplo: dar por buena con párrafos marcados exige motivo ──

const RESUMEN_CASO_C = {
  version: 3,
  nota: { total: 31.2, maximo: 40, margen: 3, fuente: 'critico_ciego' },
  comprobado: ['El calendario cabe en el plazo de ejecución.'],
  compromisos: [
    {
      apartado: 2,
      clave: 'alumnas',
      categoria: 'cifra',
      que: 'Alumnas por curso',
      quien: null,
      valor: '15',
      choca: 'el Anexo V (30)',
    },
  ],
  marcados: [
    {
      apartado: 2,
      origen: 'coherencia',
      cita: 'Cada curso tendrá 15 alumnas',
      motivo: 'El Anexo V ofrece 30 alumnas por curso.',
      arreglo: 'Pon 30 o cambia el Anexo V.',
      rondas: [],
      ahora: 'Cada curso tendrá 15 alumnas',
    },
  ],
  antes_de_aceptar: { paginas: 13, limite: 30, avisos: [], sin_redactar: [], se_descartan: [2, 1] },
};

test('should_require_a_reason_to_accept_the_casoC_report_with_marked_paragraphs', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoC');
  const a = apuntador();
  await servirBandeja(
    page,
    'casoC',
    [
      tarjeta(
        'memoria:v3',
        'memoria',
        'Memoria técnica v3',
        'Hermes montó la memoria v3 · 13 páginas: léela y dala por buena.',
      ),
    ],
    a,
  );
  await page.route(
    (url) => url.pathname.startsWith(api('casoC', '/oferta/memoria/3/resumen')),
    (route) => json(route, RESUMEN_CASO_C),
  );
  await page.route(esRuta(api('casoC', '/oferta/memoria/3/aceptar')), (route) => {
    a.apuntar(route);
    return json(route, { version: 3, estado: 'aceptada', descartadas: [2, 1] });
  });
  await abrirComprobaciones(page, 'casoC');
  await page.getByTestId('abrir-memoria:v3').click();
  const resumen = page.getByTestId('resumen-memoria');
  await expect(resumen.getByTestId('parrafo-marcado')).toHaveCount(1);
  await expect(resumen.getByTestId('nota-critico')).toHaveText('Nota del crítico ciego: 31,2 / 40 (± 3)');
  await resumen.getByTestId('dar-por-buena').click();
  const confirmacion = resumen.getByTestId('confirmacion');
  await expect(confirmacion).toContainText('13 de 30 páginas');
  await expect(confirmacion).toContainText('Se descartan: v2, v1');

  // Act: sin motivo no se acepta; con motivo, sí.
  await confirmacion.getByTestId('confirmacion-si').click();
  await expect(confirmacion.getByRole('alert')).toBeVisible();
  const sinMotivo = a.escrituras.filter((e) => e.ruta.endsWith('/aceptar')).length;
  await confirmacion.getByTestId('confirmacion-motivo').fill('El Anexo V se corrige a 15 alumnas antes de firmar.');
  await confirmacion.getByTestId('confirmacion-si').click();

  // Assert
  expect(sinMotivo).toBe(0);
  await expect.poll(() => a.escrituras.filter((e) => e.ruta.endsWith('/aceptar')).length).toBe(1);
  expect(a.escrituras.find((e) => e.ruta.endsWith('/aceptar')).cuerpo).toMatchObject({
    motivo: 'El Anexo V se corrige a 15 alumnas antes de firmar.',
  });
  expect(page.__escrituras).toEqual([]);
});

// ── 6) CASO_D: la fila de precio con el contexto del órgano y el coste estimado ──

// La forma de contextoPrecio (servidor) para el lote 2 de CASO_D: una adjudicación, sin baja.
const CONTEXTO_CASO_D = {
  organo: { ofertas_media: 1, baja_media: 0, ultima: { anio: 2022, ganador: 'Empresa A', baja: 0, ofertas: 1 }, n: 1 },
  un_licitador: {
    texto: 'Con un solo licitador cualquier baja da los 55 puntos: no hace falta bajar',
    baja_recomendada: 0,
  },
  indicios: null,
  nota: 'Orientativo.',
};

test('should_show_the_casoD_organ_context_and_save_the_estimated_cost_with_the_price', async ({ page }) => {
  // Arrange
  await servirFixture(page, 'casoD');
  await servirBandeja(page, 'casoD', [], apuntador());
  await page.route(esRuta(api('casoD', '/oferta/precio/contexto')), (route) => json(route, CONTEXTO_CASO_D));
  await abrirComprobaciones(page, 'casoD');
  const contexto = page.getByTestId('bloqueo-precio:2').getByTestId('contexto-precio-lote-2');
  await expect(contexto.getByTestId('contexto-precio-lote-2-organo')).toHaveText(
    'Este órgano: 1 oferta, 0,0 % de baja (2022) · ganó Empresa A',
  );
  await expect(contexto.getByTestId('contexto-precio-lote-2-un-licitador')).toContainText(
    'cualquier baja da los 55 puntos',
  );

  // Act
  await contexto.getByTestId('coste-lote-2').fill('50.000');
  await contexto.getByTestId('coste-lote-2-guardar').click();

  // Assert: el coste va con la sección «precio» de las decisiones, en la oferta del lote 2.
  await expect.poll(() => page.__escrituras.filter((e) => e.ruta.endsWith('/oferta/decisiones/precio')).length).toBe(1);
  const { cuerpo } = page.__escrituras.find((e) => e.ruta.endsWith('/oferta/decisiones/precio'));
  expect(cuerpo.valor.find((o) => o.lote === '2')).toMatchObject({ coste_estimado: 50000 });
});
