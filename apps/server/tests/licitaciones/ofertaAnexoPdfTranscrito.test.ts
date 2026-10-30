// Anexos cuyo modelo es un PDF sin campos pero con huecos: con el análisis guardado
// (modelosPdf.ts) quedan «transcrito» a un .docx y se rellenan como un Word —el run lee los
// párrafos numerados de la transcripción con sus páginas, el borrador avisa de cotejarlo con el
// original y se rechazan la firma y el precio sin decidir—, entran en la cadena tras las
// decisiones como los PDF con campos, y hasta que se analizan la checklist dice que Hermes los
// está leyendo. Con los 4 PDF sintéticos de CASO_D (fixtures/documentos/anexosCasoD.ts) y otros de
// pdf-lib; datos de empresa ficticios (Persona A) y ningún importe real. Sin LibreOffice.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CARPETA_PLIEGOS, decisionesCasoA, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';
import { anexoCasoD } from './fixtures/documentos/anexosCasoD.js';
import { pdfConFormulario } from '../nucleo/fixtures/formularioPdf.js';
import { MODELO_ANEXO, pdfDeLineas } from '../nucleo/fixtures/pdfSinCampos.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-pdf-transcrito-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
const conversiones = path.join(tmp, 'conversiones');
for (const d of [salidas, conocimiento]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.CONVERSIONES_DIR = conversiones;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { documentoDelGuion, filaDocumento } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { analisisDe, LEYENDO_PDF } = await import('../../src/dominios/licitaciones/oferta/anexosModeloPdf.js');
const { AnexoEntrada } = await import('../../src/dominios/licitaciones/oferta/anexosGuardado.js');
const { documentosOferta } = await import('../../src/dominios/licitaciones/oferta/anexosChecklist.js');
const { encolarAnexosAuto } = await import('../../src/dominios/licitaciones/oferta/anexosAuto.js');
const { instruccionesDeAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosInstrucciones.js');
const { modeloDe } = await import('../../src/dominios/licitaciones/oferta/anexosModelo.js');
const { pedirAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosPedir.js');
const { recibirAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosRecibir.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { prepararModelosPdf } = await import('../../src/dominios/licitaciones/oferta/modelosPdf.js');
const { localizarHuecos } = await import('../../src/nucleo/documentos/rellenar.js');

iniciarNucleo();
const db = dbLicitaciones();
const raices = { salidas, conocimiento };
const ctx = { db, dbNucleo: nucleo().db, raices };
const CARPETA_SALIDAS = `Salidas/Licitaciones/EXP-2026-0412 (${ID})`;
const ahora = new Date().toISOString();

const ponerPliego = (nombre: string, contenido: Buffer) => {
  fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, CARPETA_PLIEGOS, nombre), contenido);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', ?, 'descargado', ?, ?)",
  ).run(
    ID,
    `https://contrataciondelestado.es/${encodeURIComponent(nombre)}`,
    nombre,
    `${CARPETA_PLIEGOS}/${nombre}`,
    ahora,
  );
};

const CASO_D = {
  'Anexo I': 'Anexo I.pdf',
  'Anexo V': 'Anexo V.pdf',
  'Anexo VI': 'Anexo VI.pdf',
  'Anexo VII': 'Anexo VII.pdf',
};
for (const archivo of Object.values(CASO_D)) ponerPliego(archivo, await anexoCasoD(archivo));
ponerPliego('Declaracion.pdf', await pdfDeLineas(MODELO_ANEXO));
ponerPliego('Formulario.pdf', await pdfConFormulario());
// Cifras que no son precios junto a «total» o «IVA», y un importe de verdad.
ponerPliego(
  'Datos.pdf',
  await pdfDeLineas([
    [
      'ANEXO IV. DATOS DE LA EMPRESA',
      'Número total de trabajadores en plantilla: ..........',
      'Plazo total de ejecución: .......... meses',
      'NIF/IVA intracomunitario: ..............',
      'Importe de la oferta: ..........',
    ],
  ]),
);

const anexo = (tipo: string, modelo: string, documento: string) => ({
  tipo,
  nombre: modelo,
  obligatorio: true,
  produce: 'persona',
  origen: { modelo, documento, pagina: 1 },
});
// a1-d3 … a1-d6: los 4 de CASO_D (el I es la oferta económica); a1-d7: con firma; a1-d8: un formulario; a1-d9: datos sin precio.
const guion = guionCon((g) => {
  g.archivos[0]!.documentos = [
    g.archivos[0]!.documentos[0]!,
    g.archivos[0]!.documentos[1]!,
    anexo('oferta_economica', 'Anexo I', CASO_D['Anexo I']),
    ...(['Anexo V', 'Anexo VI', 'Anexo VII'] as const).map((m) => anexo('declaracion', m, CASO_D[m])),
    anexo('declaracion', 'Anexo II', 'Declaracion.pdf'),
    anexo('declaracion', 'Anexo VIII', 'Formulario.pdf'),
    anexo('declaracion', 'Anexo IV', 'Datos.pdf'),
  ] as never;
});
const [ANEXO_I, ANEXO_V, ANEXO_VI, ANEXO_VII, CON_FIRMA, FORMULARIO, DATOS] = [
  'a1-d3',
  'a1-d4',
  'a1-d5',
  'a1-d6',
  'a1-d7',
  'a1-d8',
  'a1-d9',
];
const DE_CASO_D = [ANEXO_I, ANEXO_V, ANEXO_VI, ANEXO_VII];

guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ahora, ahora);
assert.equal((await proponerGuion(db, GuionEntrada.parse(guion), 'licitaciones')).error, null);
assert.equal(
  guardarPerfilEmpresa(nucleo().db, {
    nif: 'B00000000',
    nombre: 'Empresa Ejemplo, S.L.',
    domicilio: 'Calle Ejemplo 1, 38001 Puerto de Ejemplo',
    representante: { nombre: 'Persona A', nif: '00000000T', cargo: 'Administradora única' },
    contacto: { email: 'licitaciones@ejemplo.test' },
  }).error,
  null,
);
const PERSONA = crearPersona(nucleo().db, { nombre: 'Persona A', tipo: 'interno', rol: 'Consultora' }).data!.id;

function decidir(importe: number | null): void {
  const d = decisionesCasoA([PERSONA]);
  const r = guardarDecisiones(db, nucleo().db, ID, {
    ...d,
    precio: importe === null ? { importe: null, pendiente: true } : { importe, pendiente: false },
  });
  assert.equal(r.error, null, r.error?.message);
}

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const analizarTodo = async () => {
  while ((await prepararModelosPdf(db, raices)) > 0);
};
const fila = async (clave: string) =>
  (await documentosOferta(db, raices, ID)).data!.documentos.find((d) => d.clave === clave)!;
const trabajos = (clave: string) =>
  nucleo()
    .db.prepare("SELECT id FROM trabajos_ia WHERE tipo = ? AND json_extract(payload, '$.clave') = ?")
    .all(TIPO_ANEXO, clave);
// Los párrafos de la transcripción guardada del modelo del documento, como los ve el run.
const transcripcion = (clave: string) => {
  const d = documentoDelGuion(guionVigente(db, ID)!.datos, clave)!;
  const a = analisisDe(db, modeloDe(db, raices, ID, d).data!, d).data!;
  return localizarHuecos(fs.readFileSync(a.docx!)).data!.parrafos;
};
// El párrafo de la transcripción que empieza por `inicio` (el `n`-ésimo) y el trozo literal con su hueco.
function hueco(clave: string, inicio: RegExp, trozo: RegExp, n = 0) {
  const p = transcripcion(clave).filter((x) => inicio.test(x.texto))[n]!;
  return { parrafo: p.indice, original: trozo.exec(p.texto)![0] };
}
const DON = /^Don\/Doña/;
const NOMBRE = /Don\/Doña …+/u;
const representante = (clave: string) => {
  const h = hueco(clave, DON, NOMBRE);
  return { ...h, nuevo: 'Don/Doña Persona A', dato: 'Representante' };
};
const rango = (clave: string) => ({ desde_parrafo: 1, hasta_parrafo: transcripcion(clave).length });
const enviar = (clave: string, sustituciones: unknown[]) =>
  recibirAnexo(ctx, AnexoEntrada.parse({ id: ID, clave, ...rango(clave), sustituciones }), { revisar: true });

test('should_say_hermes_is_reading_the_model_until_it_is_analysed', async () => {
  decidir(10_000);
  const f = await fila(ANEXO_V);
  assert.deepEqual([f.anexo.rellenable, f.anexo.motivo, f.anexo.modelo], [false, LEYENDO_PDF, null]);
  const pedido = await pedirAnexo(ctx, ID, ANEXO_V);
  assert.equal(pedido.error?.message, LEYENDO_PDF);
  encolarAnexosAuto(nucleo().db, db);
  for (const c of [...DE_CASO_D, FORMULARIO])
    assert.equal(trabajos(c).length, 0, `${c}: un PDF sin analizar no entra en la cadena`);
  await analizarTodo();
  assert.equal((await fila(ANEXO_V)).anexo.motivo, null, 'tras la vuelta, ya se puede rellenar');
});

test('should_offer_fill_with_hermes_for_a_transcribed_pdf_model', async () => {
  for (const c of DE_CASO_D) {
    const f = await fila(c);
    assert.deepEqual(
      [f.anexo.rellenable, f.anexo.motivo, f.anexo.modelo?.tipo, f.anexo.modelo?.pagina],
      [true, null, 'transcrito', 1],
      c,
    );
  }
  assert.equal(
    (await fila(ANEXO_I)).anexo.modelo?.ruta,
    `Conocimiento/${CARPETA_PLIEGOS}/Anexo I.pdf`,
    'el enlace abre el pliego original',
  );
  assert.equal((await fila(FORMULARIO)).anexo.modelo?.tipo, 'campos');
});

test('should_give_hermes_numbered_paragraphs_of_the_transcription_with_the_pages', async () => {
  const r = await pedirAnexo(ctx, ID, ANEXO_I);
  assert.equal(r.error, null, r.error?.message);
  const abs = filaDocumento(db, ID, ANEXO_I)!.anexo_modelo!;
  assert.equal(path.dirname(abs), path.join(conversiones, 'transcritos'), 'el run lee la transcripción, no el PDF');
  assert.ok(abs.endsWith('.docx'));
  const ins = await instruccionesDeAnexo(db, nucleo().db, { id: ID, clave: ANEXO_I, pedida_en: ahora });
  assert.match(
    ins,
    /TRANSCRITO DEL PDF «Anexo I\.pdf» \(págs\. 1-3\): el texto puede tener saltos de línea distintos al original; rellena igual que un Word\./,
  );
  assert.match(ins, /«Anexo I» parece ir del párrafo 1 al \d+/);
  assert.match(ins, /\n\[17\] IMPORTE SIN IGIC: _+€ {2}⟵ 1 hueco/, 'los párrafos numerados con sus huecos');
  assert.match(ins, /desde_parrafo = el párrafo con el título del modelo/, 'el camino Word');
  assert.doesNotMatch(ins, /CAMPOS DEL FORMULARIO/);
});

test('should_fill_a_transcribed_model_as_a_word_draft_and_warn_to_compare_with_the_original', async () => {
  const r = await enviar(ANEXO_V, [representante(ANEXO_V)]);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.ruta, `${CARPETA_SALIDAS}/anexos/Anexo V-v${r.data!.version}.docx`);
  assert.ok(
    r.data!.avisos.includes(
      'Transcrito del PDF del pliego («Anexo V.pdf», pág. 1): compáralo con el original antes de firmar.',
    ),
    r.data!.avisos.join(' | '),
  );
  const f = filaDocumento(db, ID, ANEXO_V)!;
  assert.equal(f.estado, 'borrador');
  const escrito = localizarHuecos(fs.readFileSync(path.join(salidas, r.data!.ruta.replace(/^Salidas\//, '')))).data!
    .parrafos;
  assert.ok(
    escrito.some((p) => p.texto.startsWith('Don/Doña Persona A')),
    'el dato en su hueco',
  );
  assert.ok(
    escrito.some((p) => p.texto === 'A fecha de firma electrónica'),
    'el texto del modelo sigue literal',
  );
  assert.equal(JSON.parse(f.sustituciones!).formato, 'docx', 'el plan queda guardado para regenerarlo');
});

test('should_reject_text_in_the_signature_and_an_undecided_price_in_a_transcribed_model', async () => {
  const fdo = hueco(CON_FIRMA, /^Fdo\.:/, /Fdo\.:/);
  const firmado = await enviar(CON_FIRMA, [{ ...fdo, nuevo: 'Fdo.: Persona A', dato: 'Representante' }]);
  assert.match(firmado.error?.message ?? '', /La firma se deja en blanco: la pone una persona con su certificado/);
  decidir(null);
  const total = hueco(ANEXO_I, /^IMPORTE SIN IGIC/, /IMPORTE SIN IGIC: _+€/, 1);
  const sinPrecio = await enviar(ANEXO_I, [
    representante(ANEXO_I),
    { ...total, nuevo: 'IMPORTE SIN IGIC: 10.000,00€', dato: 'Importe sin impuestos' },
  ]);
  assert.match(
    sinPrecio.error?.message ?? '',
    /El precio aún no está decidido \(decisiones de la oferta\): deja vacío el hueco del importe del párrafo \d+/,
  );
  decidir(10_000);
});

test('should_not_take_a_total_or_tax_label_alone_as_an_undecided_price', async () => {
  // Arrange: el precio sin decidir, como antes de fijar la oferta.
  decidir(null);
  const dato = (inicio: RegExp, trozo: RegExp, valor: string, etiqueta: string) => {
    const h = hueco(DATOS, inicio, trozo);
    return { ...h, nuevo: h.original.replace(/\.+$/, valor), dato: etiqueta };
  };
  const datos = [
    dato(/^Número total/, /plantilla: \.+/, '45', 'Plantilla'),
    dato(/^Plazo total/, /ejecución: \.+/, '12', 'Plazo de ejecución'),
    dato(/^NIF\/IVA/, /intracomunitario: \.+/, 'ESB00000000', 'NIF-IVA'),
  ];
  const importe = dato(/^Importe de la oferta/, /oferta: \.+/, '10.000', 'Importe sin impuestos');
  const recibir = (sustituciones: unknown[]) =>
    recibirAnexo(ctx, AnexoEntrada.parse({ id: ID, clave: DATOS, ...rango(DATOS), sustituciones }));
  // Act
  const conImporte = await recibir([...datos, importe]);
  const sinImporte = await recibir(datos);
  // Assert
  const frenados = /deja vacío el hueco del importe del párrafo ([\d, ]+);/.exec(conImporte.error?.message ?? '')?.[1];
  assert.equal(frenados, String(importe.parrafo), 'el importe de verdad sigue frenado, y solo él');
  assert.equal(sinImporte.error, null, sinImporte.error?.message);
  decidir(10_000);
});

test('should_enqueue_pdf_models_with_fields_or_transcribed_after_the_decisions', async () => {
  encolarAnexosAuto(nucleo().db, db);
  for (const c of [ANEXO_VI, ANEXO_VII, FORMULARIO])
    assert.equal(trabajos(c).length, 1, `${c}: encolado sin pulsar ningún botón`);
  assert.equal(
    path.dirname(filaDocumento(db, ID, ANEXO_VI)!.anexo_modelo!),
    path.join(conversiones, 'transcritos'),
    'el transcrito, con su .docx',
  );
  assert.ok(filaDocumento(db, ID, FORMULARIO)!.anexo_modelo!.endsWith('Formulario.pdf'), 'el de campos, con el PDF');
  assert.equal(trabajos(ANEXO_V).length, 0, 'el ya rellenado con estas decisiones no se repite');
  const antes = nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number };
  encolarAnexosAuto(nucleo().db, db);
  assert.deepEqual(
    nucleo().db.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get(),
    antes,
    'una vuelta más no repite nada',
  );
});

test('should_fill_the_four_casoD_pdfs_as_drafts', async () => {
  // El plan que escribiría Hermes con la hoja de CASO_D: el representante en cada carta, el
  // precio del lote 2 en la oferta económica y la casilla del compromiso que se elige.
  const marca = (clave: string, inicio: RegExp) => ({
    ...hueco(clave, inicio, /\(….\)/u),
    nuevo: '(X)',
    dato: 'Criterios automáticos',
  });
  const planes: Record<string, unknown[]> = {
    [ANEXO_I]: [
      representante(ANEXO_I),
      {
        ...hueco(ANEXO_I, /^IMPORTE SIN IGIC/, /IMPORTE SIN IGIC: _+€/, 1),
        nuevo: 'IMPORTE SIN IGIC: 10.000,00€',
        dato: 'Importe sin impuestos',
      },
    ],
    [ANEXO_V]: [representante(ANEXO_V), marca(ANEXO_V, /^● .*ocho \(8\) meses/u)],
    [ANEXO_VI]: [representante(ANEXO_VI), marca(ANEXO_VI, /^● .*seis \(6\) itinerarios/u)],
    [ANEXO_VII]: [representante(ANEXO_VII), marca(ANEXO_VII, /^● .*ocho \(8\) horas/u)],
  };
  for (const c of DE_CASO_D) {
    const r = await enviar(c, planes[c]!);
    assert.equal(r.error, null, `${c}: ${r.error?.message}`);
    const f = filaDocumento(db, ID, c)!;
    assert.equal(f.estado, 'borrador', c);
    assert.ok(fs.existsSync(path.join(salidas, f.ruta!.replace(/^Salidas\//, ''))), `${c}: su archivo en Salidas`);
    assert.ok(
      (JSON.parse(f.avisos) as string[]).some((a) => a.startsWith('Transcrito del PDF del pliego')),
      `${c}: avisa de cotejarlo`,
    );
  }
});
