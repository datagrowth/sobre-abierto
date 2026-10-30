// Datos de anexo como decisiones: qué datos pide el anexo (subcontratar servidores,
// orden de los lotes, impuesto), la fila «tú» de las comprobaciones con su cita y la hoja de datos con lo
// decidido. Sobre los fixtures seudonimizados de Villaejemplo y CASO_E (captura del 14/10/2026).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'datos-anexo-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { comprobacionesDe, reglaDatosAnexo } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { datoDecidido, datosQuePide } = await import('../../src/dominios/licitaciones/oferta/datosAnexo.js');
const { hojaDeDatos } = await import('../../src/dominios/licitaciones/oferta/hojaDatos.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type EntradasComprobaciones =
  import('../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js').EntradasComprobaciones;
type GuionBaseData = import('../../src/dominios/licitaciones/oferta/guion.js').GuionBaseData;
type TextoModelo = import('../../src/dominios/licitaciones/oferta/datosAnexo.js').TextoModelo;

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CASO_C = leerFixtureComprobaciones('casoC');
const CASO_E = leerFixtureComprobaciones('casoE');
const guionDe = (f: typeof CASO_C): GuionBaseData => f.guiones.at(-1)!.datos as GuionBaseData;

// Los dos párrafos del Anexo V de Villaejemplo (lote 3) que piden lo que el pliego no fija.
const SUBCONTRATA =
  'SUBCONTRATACIÓN SERVIDORES O SERVICIOS ASOCIADOS. El licitador NO tiene la previsión de subcontratar el/los servidor/es o los servicios asociados a los mismos.';
const ORDEN = 'Orden de preferencia de adjudicación de los lotes: indique el orden en que desea que se le adjudiquen.';
const ANEXO_V: TextoModelo[] = [
  { clave: 'a3-d1', documento: 'ANEXO V.docx', pagina: null, texto: SUBCONTRATA },
  { clave: 'a3-d1', documento: 'ANEXO V.docx', pagina: null, texto: ORDEN },
];
// El plan con que se rellenó el Anexo V (anexoPlan.ts): cada párrafo tocado con su texto original.
const PLAN_ANEXO_V = JSON.stringify({
  formato: 'docx',
  lote: '3',
  desde: 0,
  hasta: 40,
  items: [SUBCONTRATA, ORDEN].map((original, i) => ({
    parrafo: 10 + i,
    original,
    nuevo: original,
    dato: 'Lote',
    valor: null,
  })),
});

function entradas(
  f: typeof CASO_C,
  cambios: Partial<{ ahora: string; datos_anexo: Record<string, unknown> }> = {},
): EntradasComprobaciones {
  const decisiones = f.decisiones
    ? {
        ...f.decisiones,
        datos: {
          ...f.decisiones.datos,
          datos_anexo: { subcontratacion_servidores: null, orden_lotes: null, impuesto: null, ...cambios.datos_anexo },
        },
      }
    : null;
  return {
    ahoraMs: Date.parse(cambios.ahora ?? f.ahora),
    licitacion: { fecha_limite: f.licitacion.fecha_limite },
    guion: { id: f.guiones.at(-1)!.id, datos: guionDe(f) },
    decisiones,
    documentos: { filas: [{ clave: 'a3-d1', nombre: 'ANEXO V.docx', sustituciones: PLAN_ANEXO_V }], del_guion: [] },
  } as unknown as EntradasComprobaciones;
}

// La oferta sembrada en la base, con el plan del Anexo V y lo decidido en datos_anexo.
function sembrar(f: typeof CASO_C, datosAnexo: Record<string, unknown> | null = null): void {
  nucleo().db.prepare('DELETE FROM personas').run();
  sembrarFixture(db, nucleo().db, f);
  db.prepare('UPDATE oferta_documentos SET sustituciones = ? WHERE licitacion_id = ? AND clave = ?').run(
    PLAN_ANEXO_V,
    f.id,
    'a3-d1',
  );
  if (datosAnexo) decidir(f.id, datosAnexo);
}

function decidir(id: string, datosAnexo: Record<string, unknown>): void {
  const fila = db.prepare('SELECT datos FROM decisiones_oferta WHERE licitacion_id = ?').get(id) as { datos: string };
  const datos = {
    ...JSON.parse(fila.datos),
    datos_anexo: { subcontratacion_servidores: null, orden_lotes: null, impuesto: null, ...datosAnexo },
  };
  db.prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run(JSON.stringify(datos), id);
}

test('should_detect_server_subcontracting_and_lot_order_in_casoC_annex_v', () => {
  const pedidos = datosQuePide(guionDe(CASO_C), ANEXO_V);

  assert.deepEqual(
    pedidos.map((p) => p.dato),
    ['subcontratacion_servidores', 'orden_lotes'],
  );
  assert.equal(pedidos[0]!.cita.documento, 'ANEXO V.docx');
  assert.equal(
    pedidos[0]!.cita.texto,
    'SUBCONTRATACIÓN SERVIDORES O SERVICIOS ASOCIADOS.',
    'la primera frase del párrafo que lo pide',
  );
  assert.match(pedidos[1]!.cita.texto, /^Orden de preferencia de adjudicación de los lotes/);
});

test('should_ask_for_tax_type_in_casoE_training', () => {
  const pedidos = datosQuePide(guionDe(CASO_E), []);

  const impuesto = pedidos.find((p) => p.dato === 'impuesto');
  assert.ok(impuesto, 'CASO_E: IGIC aparte, sin tipo fijado');
  assert.match(impuesto.cita.texto, /IGIC aparte/);
  assert.equal(
    pedidos.some((p) => p.dato !== 'impuesto'),
    false,
    'CASO_E no pide servidores ni orden de lotes',
  );
});

test('should_not_ask_for_tax_when_the_tender_says_exempt', () => {
  const pedidos = datosQuePide(guionDe(CASO_C), []);

  assert.equal(guionDe(CASO_C).oferta_economica?.impuesto_aparte, 'exento');
  assert.deepEqual(pedidos, []);
});

// El guion de CASO_E con otro impuesto aparte (CASO_F, CASO_B: IVA sin mención de exención).
const conImpuestoAparte = (g: GuionBaseData, impuesto: 'IVA' | null): GuionBaseData =>
  JSON.parse(
    JSON.stringify(g).replaceAll('"impuesto_aparte":"IGIC"', `"impuesto_aparte":${JSON.stringify(impuesto)}`),
  ) as GuionBaseData;

test('should_not_ask_for_tax_when_the_outline_says_vat_and_nothing_mentions_exemption', () => {
  // Act
  const pedidos = datosQuePide(conImpuestoAparte(guionDe(CASO_E), 'IVA'), []);

  // Assert
  assert.equal(
    pedidos.some((p) => p.dato === 'impuesto'),
    false,
    'el 21 % no se pregunta',
  );
});

test('should_ask_for_tax_when_vat_is_declared_but_a_text_mentions_exemption', () => {
  // Arrange
  const exencion: TextoModelo[] = [
    {
      clave: 'a1-d1',
      documento: 'ANEXO I.docx',
      texto: 'La formación profesional para el empleo puede estar exenta del impuesto.',
    },
  ];

  // Act
  const pedidos = datosQuePide(conImpuestoAparte(guionDe(CASO_E), 'IVA'), exencion);

  // Assert
  assert.match(pedidos.find((p) => p.dato === 'impuesto')?.cita.texto ?? '', /exenta/);
});

test('should_ask_for_tax_when_the_outline_does_not_say_which_one', () => {
  // Act
  const pedidos = datosQuePide(conImpuestoAparte(guionDe(CASO_E), null), []);

  // Assert
  assert.match(pedidos.find((p) => p.dato === 'impuesto')?.cita.texto ?? '', /no dice qué impuesto/);
});

test('should_treat_a_lot_order_with_lots_no_longer_decided_as_undecided', () => {
  // Arrange: orden [1, 2, 3] y luego se quitó el lote 3 (CASO_B).
  const d = {
    lotes: ['1', '2'],
    datos_anexo: { subcontratacion_servidores: null, orden_lotes: ['1', '2', '3'], impuesto: null },
  };

  // Act
  const decidido = datoDecidido(d, 'orden_lotes');
  const vale = datoDecidido({ ...d, datos_anexo: { ...d.datos_anexo, orden_lotes: ['2', '1'] } }, 'orden_lotes');

  // Assert
  assert.equal(decidido, false);
  assert.equal(vale, true);
});

test('should_add_a_you_row_to_the_comprobaciones_with_its_quote', () => {
  const filas = reglaDatosAnexo(entradas(CASO_C, { ahora: '2027-09-30T10:00:00Z' }));

  const fila = filas.find((b) => b.clave === 'dato_anexo:-:subcontratacion_servidores');
  assert.ok(fila);
  assert.equal(fila.actor, 'tu');
  assert.equal(fila.categoria, 'decisiones');
  assert.equal(fila.gravedad, 'riesgo');
  assert.deepEqual(fila.accion, { tipo: 'campo', destino: 'decisiones.datos_anexo.subcontratacion_servidores' });
  assert.equal(fila.cita?.documento, 'ANEXO V.docx');
  assert.match(fila.cita?.texto ?? '', /SUBCONTRATACIÓN SERVIDORES/);
  assert.deepEqual(
    filas.map((b) => b.clave),
    ['dato_anexo:-:subcontratacion_servidores', 'dato_anexo:-:orden_lotes'],
  );
});

test('should_turn_the_row_into_blocking_within_5_days', () => {
  const lejos = reglaDatosAnexo(entradas(CASO_C, { ahora: '2027-10-09T08:00:00Z' }));
  const cerca = reglaDatosAnexo(entradas(CASO_C, { ahora: '2027-10-10T08:00:00Z' }));

  assert.deepEqual(
    lejos.map((b) => b.gravedad),
    ['riesgo', 'riesgo'],
    'a 5 días del plazo (14/10)',
  );
  assert.deepEqual(
    cerca.map((b) => b.gravedad),
    ['impide', 'impide'],
    'a 4 días',
  );
});

test('should_drop_the_row_once_the_data_is_decided', () => {
  const filas = reglaDatosAnexo(
    entradas(CASO_C, { datos_anexo: { subcontratacion_servidores: false, orden_lotes: ['3'] } }),
  );

  assert.deepEqual(filas, []);
});

test('should_leave_casoC_annex_v_without_undecided_data_and_show_it_in_the_sheet', () => {
  sembrar(CASO_C);
  const antes = comprobacionesDe(db, nucleo().db, CASO_C.id, Date.parse(CASO_C.ahora)).data!;
  decidir(CASO_C.id, { subcontratacion_servidores: false, orden_lotes: ['3'] });

  const despues = comprobacionesDe(db, nucleo().db, CASO_C.id, Date.parse(CASO_C.ahora)).data!;
  const hoja = hojaDeDatos(db, nucleo().db, CASO_C.id).data!;

  const deDatos = (c: typeof antes) => c.bloqueos.filter((b) => b.clave.startsWith('dato_anexo:')).map((b) => b.clave);
  assert.deepEqual(deDatos(antes), ['dato_anexo:-:subcontratacion_servidores', 'dato_anexo:-:orden_lotes']);
  assert.deepEqual(deDatos(despues), []);
  const valor = (etiqueta: string) => hoja.campos.find((c) => c.grupo === 'Oferta' && c.etiqueta === etiqueta)?.valor;
  assert.equal(valor('Subcontratación de servidores'), 'No');
  assert.equal(valor('Orden de preferencia de lotes'), 'Lote 3');
});

test('should_drop_the_confirm_tax_warning_once_decided', () => {
  sembrar(CASO_E);
  const antes = hojaDeDatos(db, nucleo().db, CASO_E.id).data!;
  decidir(CASO_E.id, { impuesto: { tipo: 'IGIC', porcentaje: 0 } });

  const despues = hojaDeDatos(db, nucleo().db, CASO_E.id).data!;
  const comprobaciones = comprobacionesDe(db, nucleo().db, CASO_E.id, Date.parse(CASO_E.ahora)).data!;

  assert.equal(
    antes.avisos.some((a) => /confirma el tipo/.test(a)),
    true,
  );
  assert.equal(
    despues.avisos.some((a) => /confirma el tipo|confírmalo en el pliego/.test(a)),
    false,
  );
  assert.deepEqual(
    [...new Set(despues.campos.filter((c) => c.etiqueta === 'Impuesto').map((c) => c.valor))],
    ['IGIC 0 %'],
  );
  assert.equal(
    comprobaciones.bloqueos.some((b) => b.clave === 'dato_anexo:-:impuesto'),
    false,
  );
});

test('should_keep_the_sheet_without_annex_fields_when_nothing_asks_for_them', () => {
  const hoja = hojaDeDatos(db, nucleo().db, CASO_E.id).data!;

  assert.equal(
    hoja.campos.some(
      (c) => c.etiqueta === 'Subcontratación de servidores' || c.etiqueta === 'Orden de preferencia de lotes',
    ),
    false,
  );
});
