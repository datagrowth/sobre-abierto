// Análisis guardado de los modelos de anexo en PDF: un PDF con formulario queda «campos»;
// uno sin campos, «transcrito» a un .docx si el tramo del modelo tiene huecos (no la entrada del
// índice) y como mucho 6 páginas; si no, «a_mano» con su motivo. La vuelta analiza como mucho 5
// por vez, no repite un PDF que no cambió y la checklist solo lee. Con los PDF sintéticos de CASO_B y
// CASO_D (fixtures/documentos) y otros de pdf-lib. Sin LibreOffice.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CARPETA_PLIEGOS, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';
import { pdfConFormulario } from '../nucleo/fixtures/formularioPdf.js';
import { pdfDeLineas, pdfEscaneado } from '../nucleo/fixtures/pdfSinCampos.js';
import { ARCHIVO_PCAP_CASO_B, pcapModelosCasoB } from './fixtures/documentos/pcapCasoB.js';
import { anexoCasoD } from './fixtures/documentos/anexosCasoD.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-modelos-pdf-'));
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

const { iniciarNucleo, cerrarNucleo } = await import('../../src/nucleo/contexto.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { documentoDelGuion } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { documentosOferta } = await import('../../src/dominios/licitaciones/oferta/anexosChecklist.js');
const { FUERA_DE_PREPARACION, LEYENDO_PDF } = await import('../../src/dominios/licitaciones/oferta/anexosModeloPdf.js');
const { modeloDe } = await import('../../src/dominios/licitaciones/oferta/anexosModelo.js');
const {
  analizarModeloPdf,
  huellaDeArchivo,
  huellaRecordada,
  localizarModelo,
  MAX_ANALISIS_POR_VUELTA,
  modeloPdfGuardado,
  prepararModelosPdf,
  REINTENTO_MS,
  VERSION_ANALISIS_MODELOS,
} = await import('../../src/dominios/licitaciones/oferta/modelosPdf.js');
const { localizarHuecos } = await import('../../src/nucleo/documentos/rellenar.js');

iniciarNucleo();
const db = dbLicitaciones();
const raices = { salidas, conocimiento };
const ahora = new Date().toISOString();

const ponerPliego = (nombre: string, contenido: Buffer) => {
  fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, CARPETA_PLIEGOS, nombre), contenido);
};
const registrarPliego = (nombre: string) =>
  db
    .prepare(
      "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', ?, 'descargado', ?, ?)",
    )
    .run(
      ID,
      `https://contrataciondelestado.es/${encodeURIComponent(nombre)}`,
      nombre,
      `${CARPETA_PLIEGOS}/${nombre}`,
      ahora,
    );

const CASO_B = ARCHIVO_PCAP_CASO_B;
const CASO_D = ['Anexo I.pdf', 'Anexo V.pdf', 'Anexo VI.pdf', 'Anexo VII.pdf'];
// Un modelo sin un solo hueco: solo texto.
const SIN_HUECOS = [
  [
    'ANEXO XI. DECLARACIÓN SOBRE PROTECCIÓN DE DATOS',
    'La empresa declara que cumple la normativa vigente.',
    'Firmado electrónicamente.',
  ],
];
// Dos tramos con huecos del mismo anexo: el de la página 1 (que cita el guion) y el de la 3, con más huecos.
const DOS_TRAMOS = [
  ['ANEXO II. DECLARACIÓN DEL LOTE 1', 'D./Dña. ........................ con NIF ..............'],
  ['ANEXO III. OTRO MODELO', 'Texto sin huecos.'],
  [
    'ANEXO II. DECLARACIÓN DEL LOTE 2',
    'D./Dña. ........................ con NIF ..............',
    'en nombre de ........................ con domicilio en ............',
  ],
];
// Un modelo con huecos que ocupa 8 páginas.
const LARGO = Array.from({ length: 8 }, (_, i) =>
  i === 0
    ? ['ANEXO XII. CUESTIONARIO', 'D./Dña. ........................ con NIF ..............']
    : [`Pregunta ${i}: requisito de seguridad número ${i}.`],
);

ponerPliego(CASO_B, await pcapModelosCasoB());
for (const g of CASO_D) ponerPliego(g, await anexoCasoD(g));
ponerPliego('Formulario.pdf', await pdfConFormulario());
ponerPliego('Escaneado.pdf', await pdfEscaneado());
ponerPliego('SinHuecos.pdf', await pdfDeLineas(SIN_HUECOS));
ponerPliego('DosTramos.pdf', await pdfDeLineas(DOS_TRAMOS));
ponerPliego('Largo.pdf', await pdfDeLineas(LARGO));
for (const n of [CASO_B, ...CASO_D, 'Formulario.pdf', 'Escaneado.pdf', 'SinHuecos.pdf', 'DosTramos.pdf', 'Largo.pdf'])
  registrarPliego(n);

const anexo = (modelo: string, documento: string, pagina?: number) => ({
  tipo: 'declaracion',
  nombre: modelo,
  obligatorio: true,
  produce: 'persona',
  origen: { modelo, documento, ...(pagina ? { pagina } : {}) },
});
const DEL_CASO_B = ['Anexo II', 'Anexo III', 'Anexo III Bis', 'Anexo V', 'Anexo VI', 'Anexo IX', 'Anexo XIV'];
const DEL_CASO_D = ['Anexo I', 'Anexo V', 'Anexo VI', 'Anexo VII'];
// 14 modelos PDF: los 7 de CASO_B, los 4 de CASO_D, un formulario, un escaneado y uno sin huecos (claves a1-d3 … a1-d16).
const guion = guionCon((g) => {
  g.archivos[0]!.documentos = [
    g.archivos[0]!.documentos[0]!,
    g.archivos[0]!.documentos[1]!,
    ...DEL_CASO_B.map((m) => anexo(m, CASO_B)),
    ...DEL_CASO_D.map((m, i) => anexo(m, CASO_D[i]!)),
    anexo('Anexo VIII', 'Formulario.pdf'),
    anexo('Anexo X', 'Escaneado.pdf'),
    anexo('Anexo XI', 'SinHuecos.pdf'),
  ] as never;
});
const clave = (n: number) => `a1-d${n + 3}`;
const CLAVE_CASO_B = (m: string) => clave(DEL_CASO_B.indexOf(m));
const CLAVE_CASO_D = (m: string) => clave(DEL_CASO_B.length + DEL_CASO_D.indexOf(m));
const [FORMULARIO, ESCANEADO, SIN] = [clave(11), clave(12), clave(13)];

guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ahora, ahora);
assert.equal((await proponerGuion(db, GuionEntrada.parse(guion), 'licitaciones')).error, null);

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const documento = (c: string) => {
  const g = db.prepare('SELECT datos FROM guiones WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1').get(ID) as {
    datos: string;
  };
  return documentoDelGuion(JSON.parse(g.datos), c)!;
};
// El documento del guion (o el mismo con otro origen) con su modelo, su ruta y su sha256, como los da la vuelta.
async function analizar(c: string, origen?: { modelo: string; documento: string; pagina?: number }) {
  const base = documento(c);
  const d = origen ? { ...base, doc: { ...base.doc, origen } } : base;
  const m = modeloDe(db, raices, ID, d);
  assert.equal(m.error, null, m.error?.message);
  const sha256 = (await huellaDeArchivo(m.data!.abs)).data!;
  const r = await analizarModeloPdf(db, { id: ID, d, abs: m.data!.abs, ruta: m.data!.ruta, sha256 });
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
}
const filas = () => (db.prepare('SELECT COUNT(*) AS n FROM modelos_pdf').get() as { n: number }).n;
const vaciar = () => db.prepare('DELETE FROM modelos_pdf').run();

test('should_classify_a_pdf_with_fillable_fields_as_campos', async () => {
  const m = await analizar(FORMULARIO);
  assert.deepEqual(
    [m.tipo, m.motivo, m.docx, m.modelo, m.ruta],
    ['campos', null, null, 'anexo viii', `Conocimiento/${CARPETA_PLIEGOS}/Formulario.pdf`],
  );
  assert.deepEqual(
    modeloPdfGuardado(db, m.ruta, m.sha256, 'Anexo VIII'),
    m,
    'se guarda y se lee por el nombre del modelo',
  );
});

test('should_transcribe_the_model_range_with_holes_and_not_the_index_entry', async () => {
  // El Anexo II sale en el índice (pág. 1, «…… 98») y de verdad en la pág. 3 del PDF.
  const m = await analizar(CLAVE_CASO_B('Anexo II'));
  assert.deepEqual([m.tipo, m.desde_pagina, m.hasta_pagina], ['transcrito', 3, 3]);
  assert.ok(m.docx?.startsWith(path.join(conversiones, 'transcritos', m.sha256.slice(0, 16))), m.docx ?? '');
  const h = localizarHuecos(fs.readFileSync(m.docx!));
  assert.equal(h.error, null);
  assert.ok(
    h.data!.parrafos.some((p) => p.texto.includes('D/Dª ………') && p.huecos.length > 0),
    'los «……» del original siguen en el .docx',
  );
  assert.equal(
    h.data!.parrafos.some((p) => /ANEXO III/.test(p.texto)),
    false,
    'solo el tramo del Anexo II',
  );
  assert.equal(localizarModelo(h.data!.parrafos, 'Anexo II')?.desde, 1, 'el .docx empieza por el título del modelo');
  const iii = await analizar(CLAVE_CASO_B('Anexo III'));
  assert.deepEqual(
    [iii.tipo, iii.desde_pagina, iii.hasta_pagina],
    ['transcrito', 4, 5],
    'el Anexo III no se come el III Bis',
  );
});

test('should_prefer_the_range_on_the_page_the_guion_cites', async () => {
  vaciar();
  const sinPagina = await analizar(CLAVE_CASO_B('Anexo II'), { modelo: 'Anexo II', documento: 'DosTramos.pdf' });
  assert.deepEqual([sinPagina.desde_pagina, sinPagina.hasta_pagina], [3, 3], 'sin página, el de más huecos');
  vaciar();
  const citado = await analizar(CLAVE_CASO_B('Anexo II'), {
    modelo: 'Anexo II',
    documento: 'DosTramos.pdf',
    pagina: 1,
  });
  assert.deepEqual([citado.tipo, citado.desde_pagina, citado.hasta_pagina], ['transcrito', 1, 1]);
});

test('should_take_the_range_with_holes_when_the_guion_cites_the_index_page', async () => {
  // La pág. 1 de CASO_B es la del índice («ANEXO II DECLARACIÓN …… 98»): su entrada no tiene huecos.
  vaciar();
  const m = await analizar(CLAVE_CASO_B('Anexo II'), { modelo: 'Anexo II', documento: CASO_B, pagina: 1 });
  assert.deepEqual([m.tipo, m.desde_pagina, m.hasta_pagina], ['transcrito', 3, 3]);
});

test('should_mark_a_scanned_pdf_or_a_model_without_holes_as_a_mano_with_its_reason', async () => {
  const motivo = async (c: string, origen?: { modelo: string; documento: string }) => {
    const m = await analizar(c, origen);
    assert.equal(m.tipo, 'a_mano');
    assert.equal(m.docx, null);
    return m.motivo;
  };
  assert.equal(await motivo(ESCANEADO), 'El PDF es una imagen escaneada: rellénalo a mano.');
  assert.equal(await motivo(SIN), 'No encuentro «Anexo XI» con huecos en «SinHuecos.pdf»: rellénalo a mano.');
  assert.equal(
    await motivo(SIN, { modelo: 'Anexo XII', documento: 'Largo.pdf' }),
    'El tramo de «Anexo XII» ocupa más de 6 páginas: rellénalo a mano.',
  );
  // El Anexo XIV de CASO_B (tabla de requisitos sin huecos y de 11 páginas) ya no va a mano: se
  // rehace como .docx propio (ofertaTablaRequisitos.test.ts).
  assert.equal((await analizar(CLAVE_CASO_B('Anexo XIV'))).tipo, 'transcrito');
});

test('should_analyse_at_most_five_models_per_round', async () => {
  vaciar();
  assert.equal(MAX_ANALISIS_POR_VUELTA, 5);
  assert.deepEqual([await prepararModelosPdf(db, raices), filas()], [5, 5]);
  assert.deepEqual([await prepararModelosPdf(db, raices), filas()], [5, 10]);
  assert.deepEqual(
    [await prepararModelosPdf(db, raices), filas()],
    [4, 14],
    'los 14 modelos PDF del guion, ni el DEUC ni la memoria',
  );
  const tipo = (c: string) => {
    const d = documento(c);
    const m = modeloDe(db, raices, ID, d).data!;
    return db.prepare('SELECT tipo, motivo FROM modelos_pdf WHERE ruta = ?').get(m.ruta) as {
      tipo: string;
      motivo: string | null;
    };
  };
  for (const m of DEL_CASO_B) {
    const t = db
      .prepare('SELECT tipo, motivo FROM modelos_pdf WHERE modelo = ? AND ruta LIKE ?')
      .get(m.toLowerCase(), `%${CASO_B}`) as { tipo: string; motivo: string | null };
    assert.ok(t.tipo === 'transcrito' || (t.tipo === 'a_mano' && t.motivo), `${m}: ${t.tipo}`);
  }
  for (const m of DEL_CASO_D) assert.equal(tipo(CLAVE_CASO_D(m)).tipo, 'transcrito', `CASO_D ${m}`);
  assert.equal(tipo(FORMULARIO).tipo, 'campos');
});

test('should_not_reanalyse_a_pdf_whose_sha256_did_not_change', async () => {
  while ((await prepararModelosPdf(db, raices)) > 0);
  const antes = db.prepare('SELECT ruta, analizado_en FROM modelos_pdf ORDER BY ruta, modelo').all();
  assert.equal(await prepararModelosPdf(db, raices), 0, 'una vuelta sin cambios no analiza nada');
  assert.deepEqual(db.prepare('SELECT ruta, analizado_en FROM modelos_pdf ORDER BY ruta, modelo').all(), antes);
  ponerPliego('Formulario.pdf', await pdfConFormulario({ texto: 'Modelo corregido por el órgano' }));
  assert.equal(await prepararModelosPdf(db, raices), 1, 'el PDF que cambió se analiza otra vez');
  assert.equal(await prepararModelosPdf(db, raices), 0);
});

test('should_reanalyse_a_row_saved_with_an_older_analysis_version_without_deleting_it', async () => {
  // Arrange: filas de antes del versionado (columna por defecto = 1); la del sha256 actual es la más reciente
  while ((await prepararModelosPdf(db, raices)) > 0);
  const viejo = '2000-01-01T00:00:00.000Z';
  db.prepare("UPDATE modelos_pdf SET version_analisis = 1, analizado_en = ? WHERE ruta LIKE '%Formulario.pdf'").run(
    viejo,
  );
  const filasAntes = filas();

  // Act
  const analizados = await prepararModelosPdf(db, raices);

  // Assert
  const f = db
    .prepare(
      "SELECT version_analisis, analizado_en FROM modelos_pdf WHERE ruta LIKE '%Formulario.pdf' ORDER BY analizado_en DESC LIMIT 1",
    )
    .get() as { version_analisis: number; analizado_en: string };
  assert.equal(analizados, 1);
  assert.equal(f.version_analisis, VERSION_ANALISIS_MODELOS);
  assert.notEqual(f.analizado_en, viejo);
  assert.equal(filas(), filasAntes, 'se actualiza la fila, no se borra ni se duplica');
  assert.equal(await prepararModelosPdf(db, raices), 0, 'con la versión al día no se repite');
});

test('should_not_write_anything_when_listing_the_documents', async () => {
  vaciar();
  const r = await documentosOferta(db, raices, ID);
  assert.equal(r.error, null);
  assert.equal(r.data!.documentos.length, 17, 'los 16 del archivo 1 y la proposición económica del 2');
  assert.equal(filas(), 0);
});

test('should_only_give_the_checklist_a_hash_the_round_already_computed', async () => {
  // Arrange
  const abs = path.join(conocimiento, CARPETA_PLIEGOS, 'Hash.pdf');
  ponerPliego('Hash.pdf', await pdfDeLineas(SIN_HUECOS));
  // Act
  const antes = huellaRecordada(abs);
  const sha256 = (await huellaDeArchivo(abs)).data;
  const despues = huellaRecordada(abs);
  fs.appendFileSync(abs, ' %%cambio');
  // Assert
  assert.deepEqual([antes, despues], [null, sha256], 'sin leer el archivo: lo que dejó la vuelta');
  assert.equal(huellaRecordada(abs), null, 'si el archivo cambió, lo vuelve a mirar la vuelta');
});

test('should_say_why_a_pdf_outside_preparation_is_not_analysed', async () => {
  // Arrange
  vaciar();
  db.prepare("UPDATE oportunidades SET estado = 'presentada' WHERE licitacion_id = ?").run(ID);
  // Act
  const r = await documentosOferta(db, raices, ID);
  db.prepare("UPDATE oportunidades SET estado = 'en_preparacion' WHERE licitacion_id = ?").run(ID);
  // Assert
  const formulario = r.data!.documentos.find((d) => d.clave === FORMULARIO)!;
  assert.deepEqual([formulario.anexo.rellenable, formulario.anexo.motivo], [false, FUERA_DE_PREPARACION]);
  assert.equal(
    (await documentosOferta(db, raices, ID)).data!.documentos.find((d) => d.clave === FORMULARIO)!.anexo.motivo,
    LEYENDO_PDF,
    'en preparación, la vuelta lo leerá',
  );
});

test('should_move_on_to_the_next_models_when_one_keeps_failing', async () => {
  // Arrange: la carpeta de las transcripciones no se puede crear (un archivo con su nombre).
  vaciar();
  const transcritos = path.join(conversiones, 'transcritos');
  fs.rmSync(transcritos, { recursive: true, force: true });
  fs.writeFileSync(transcritos, 'no es una carpeta');
  const ahoraMs = Date.now();
  // Act
  let vueltas = 0;
  while ((await prepararModelosPdf(db, raices, ahoraMs)) > 0) vueltas += 1;
  const fallido = (await documentosOferta(db, raices, ID)).data!.documentos.find(
    (d) => d.clave === CLAVE_CASO_D('Anexo I'),
  )!;
  fs.rmSync(transcritos);
  const guardados = filas();
  let reintentos = 0;
  while ((await prepararModelosPdf(db, raices, ahoraMs + REINTENTO_MS + 1)) > 0) reintentos += 1;
  // Assert
  assert.ok(
    vueltas >= 3 && vueltas <= 4,
    `los 14 modelos pasan por la cola de 5 en 5 aunque fallen (${vueltas} vueltas)`,
  );
  assert.ok(guardados > 0 && guardados < 14, `los que no transcriben se guardan (${guardados})`);
  assert.match(
    fallido.anexo.motivo ?? '',
    /^Hermes no pudo leer el modelo PDF \(No se pudo guardar la transcripción del modelo: .+\): lo intenta de nuevo en unos minutos\.$/,
  );
  assert.ok(reintentos > 0, 'pasado el rato, se reintenta');
  assert.equal(filas(), 14, 'y ya se guardan todos');
});
