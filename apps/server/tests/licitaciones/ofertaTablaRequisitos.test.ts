// Anexo XIV de CASO_B: un modelo PDF que es una tabla de requisitos sin huecos (11 págs.)
// se rehace como .docx propio, una fila por requisito con su texto literal y su página y dos
// huecos («Cumplimiento» y «Evidencia/fuente»). Ese .docx es el modelo «transcrito» y se rellena
// por el camino Word, con el aviso de compararlo con el original. Lo que no es claramente una
// tabla sigue «a mano». Con el PDF sintético de CASO_B (fixtures/documentos/pcapCasoB.ts).
// Datos de empresa ficticios (Persona A) y ningún importe.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CARPETA_PLIEGOS, decisionesCasoA, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';
import { ARCHIVO_PCAP_CASO_B, EXPEDIENTE_CASO_B, pcapModelosCasoB } from './fixtures/documentos/pcapCasoB.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-tabla-requisitos-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
for (const d of [salidas, conocimiento]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.CONVERSIONES_DIR = path.join(tmp, 'conversiones');
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
const { GuionEntrada, guionVigente, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { documentoDelGuion, filaDocumento } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { AnexoEntrada } = await import('../../src/dominios/licitaciones/oferta/anexosGuardado.js');
const { instruccionesDeAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosInstrucciones.js');
const { modeloDe } = await import('../../src/dominios/licitaciones/oferta/anexosModelo.js');
const { pedirAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosPedir.js');
const { recibirAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosRecibir.js');
const { analizarModeloPdf, huellaDeArchivo, localizarModelo, modeloPdfGuardado, prepararModelosPdf } =
  await import('../../src/dominios/licitaciones/oferta/modelosPdf.js');
const { AVISO_TABLA, COLUMNA_EVIDENCIA, HUECO_CELDA, tablaDeRequisitos } =
  await import('../../src/dominios/licitaciones/oferta/tablaRequisitos.js');
const { paginasDePdf, parrafosDePaginas } = await import('../../src/nucleo/documentos/modeloPdf.js');
const { localizarHuecos } = await import('../../src/nucleo/documentos/rellenar.js');

iniciarNucleo();
const db = dbLicitaciones();
const raices = { salidas, conocimiento };
const ctx = { db, dbNucleo: nucleo().db, raices };
const ahora = new Date().toISOString();
const PDF = await pcapModelosCasoB();
const CASO_B = ARCHIVO_PCAP_CASO_B;

fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
fs.writeFileSync(path.join(conocimiento, CARPETA_PLIEGOS, CASO_B), PDF);
db.prepare(
  "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', ?, 'descargado', ?, ?)",
).run(ID, `https://contrataciondelestado.es/${CASO_B}`, CASO_B, `${CARPETA_PLIEGOS}/${CASO_B}`, ahora);
const guion = guionCon((g) => {
  g.archivos[0]!.documentos = [
    g.archivos[0]!.documentos[0]!,
    g.archivos[0]!.documentos[1]!,
    {
      tipo: 'acreditacion',
      nombre: 'Anexo XIV',
      obligatorio: true,
      produce: 'persona',
      origen: { modelo: 'Anexo XIV', documento: CASO_B },
    },
  ] as never;
});
const XIV = 'a1-d3';
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
assert.equal(guardarDecisiones(db, nucleo().db, ID, decisionesCasoA([PERSONA])).error, null);

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Las 11 páginas del Anexo XIV (12-22 del PDF del fixture), como párrafos del PDF.
async function parrafosXiv() {
  const paginas = await paginasDePdf(new Uint8Array(PDF));
  assert.equal(paginas.error, null);
  const ps = parrafosDePaginas(paginas.data!);
  // El título de la pág. 12, no la entrada del índice («ANEXO XIV. … 146», pág. 1).
  const inicio = ps.findIndex((p) => p.pagina === 12 && p.texto.startsWith('ANEXO XIV.'));
  return ps.slice(inicio);
}
async function analizarXiv() {
  const d = documentoDelGuion(guionVigente(db, ID)!.datos, XIV)!;
  const m = modeloDe(db, raices, ID, d);
  assert.equal(m.error, null, m.error?.message);
  const sha256 = (await huellaDeArchivo(m.data!.abs)).data!;
  const r = await analizarModeloPdf(db, { id: ID, d, abs: m.data!.abs, ruta: m.data!.ruta, sha256 });
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
}
const p = (pagina: number, texto: string, indice = 1) => ({ indice, pagina, texto });

// Va primero: simula el proceso recién desplegado, que aún no ha analizado nada.
test('should_reanalyse_once_an_casoB_annex_xiv_saved_as_a_mano_before_tables_were_tried', async () => {
  // Arrange: la fila que guardó la versión anterior (sin tablas de requisitos), con el mismo sha256.
  const d = documentoDelGuion(guionVigente(db, ID)!.datos, XIV)!;
  const m = modeloDe(db, raices, ID, d);
  assert.equal(m.error, null, m.error?.message);
  const sha256 = (await huellaDeArchivo(m.data!.abs)).data!;
  db.prepare(
    "INSERT INTO modelos_pdf (ruta, sha256, modelo, tipo, motivo, desde_pagina, hasta_pagina, docx, analizado_en) VALUES (?, ?, 'anexo xiv', 'a_mano', ?, NULL, NULL, NULL, ?)",
  ).run(
    m.data!.ruta,
    sha256,
    `El tramo de «Anexo XIV» ocupa más de 6 páginas: rellénalo a mano.`,
    '2026-10-14T09:00:00.000Z',
  );
  assert.equal(modeloPdfGuardado(db, m.data!.ruta, sha256, 'Anexo XIV')?.tipo, 'a_mano');
  // Act
  const primera = await prepararModelosPdf(db, raices);
  const segunda = await prepararModelosPdf(db, raices);
  // Assert
  assert.equal(primera, 1, 'se vuelve a analizar sola, sin borrar la fila a mano');
  const ahoraGuardado = modeloPdfGuardado(db, m.data!.ruta, sha256, 'Anexo XIV')!;
  assert.deepEqual(
    [ahoraGuardado.tipo, ahoraGuardado.motivo, ahoraGuardado.desde_pagina, ahoraGuardado.hasta_pagina],
    ['transcrito', AVISO_TABLA, 12, 22],
  );
  assert.equal(segunda, 0, 'una sola vez');
});

test('should_read_one_row_per_requirement_with_its_literal_text_and_page_from_the_casoB_annex_xiv', async () => {
  // Arrange
  const ps = await parrafosXiv();
  // Act
  const t = tablaDeRequisitos(ps);
  // Assert
  assert.ok(t, 'el Anexo XIV es una tabla de requisitos');
  const requisitos = t.filas.flatMap((f) => (f.tipo === 'requisito' ? [f] : []));
  const secciones = t.filas.flatMap((f) => (f.tipo === 'seccion' ? [f.texto] : []));
  assert.equal(requisitos.length, 31);
  assert.equal(secciones.length, 12);
  assert.deepEqual(
    [requisitos[0]!.id, requisitos[0]!.pagina, requisitos.at(-1)!.id, requisitos.at(-1)!.pagina],
    ['1.1', 12, '12.3', 22],
  );
  assert.equal(secciones[0], '1. ORGANIZACIÓN DE LA SEGURIDAD DE LA INFORMACIÓN');
  assert.equal(t.columna, 'Cumplimiento (Sí / No / Parcialmente implantado / No Aplica)');
  assert.equal(t.antes[0], 'ANEXO XIV. EVALUACIÓN DEL CUMPLIMIENTO ENS', 'empieza por el título del modelo');
  assert.deepEqual(t.despues, ['Fdo y sellado']);
  const r43 = requisitos.find((r) => r.id === '4.3')!.lineas.join(' ');
  assert.match(
    r43,
    /no disminuye la eficacia de las funciones necesarias para el trabajo diario\.$/,
    'la fila sigue tras el salto de página',
  );
  const r122 = requisitos.find((r) => r.id === '12.2')!.lineas;
  assert.ok(
    r122.includes('3. Prevenir ataques de cross site scripting.'),
    'una lista numerada dentro de la fila no es una sección',
  );
  const todo = requisitos.flatMap((r) => r.lineas).join('\n');
  assert.doesNotMatch(
    todo,
    new RegExp(`Expediente ${EXPEDIENTE_CASO_B}|^- \\d+ -$|^ID Requisito|^Cumplimiento|^\\(Sí \\/ No`, 'm'),
    'sin las cabeceras de página ni de tabla',
  );
});

test('should_not_take_as_a_requirements_table_what_lacks_the_header_or_numbered_rows', () => {
  // Arrange
  const sinCabecera = [p(1, 'ANEXO XII. CUESTIONARIO'), p(1, '1.1 Uno'), p(1, '1.2 Dos'), p(1, '1.3 Tres')];
  const sinCumplimiento = [
    p(1, 'ANEXO XII. CUESTIONARIO'),
    p(1, 'ID Requisito Descripción'),
    p(1, '1.1 Uno'),
    p(1, '1.2 Dos'),
    p(1, '1.3 Tres'),
  ];
  const pocasFilas = [p(1, 'ANEXO XII'), p(1, 'Requisito'), p(1, 'Cumplimiento'), p(1, '1.1 Uno'), p(1, '1.2 Dos')];
  const repetidas = [
    p(1, 'ANEXO XII'),
    p(1, 'Requisito'),
    p(1, 'Cumplimiento'),
    p(1, '1.1 Uno'),
    p(1, '1.1 Uno'),
    p(1, '1.2 Dos'),
  ];
  const textoSuelto = [
    p(1, 'ANEXO XII'),
    p(1, 'Requisito'),
    p(1, 'Cumplimiento'),
    p(1, 'Texto que no es fila'),
    p(1, '1.1 Uno'),
    p(1, '1.2 Dos'),
    p(1, '1.3 Tres'),
  ];
  const parentesisAbierto = [
    p(1, 'ANEXO XII'),
    p(1, 'Requisito'),
    p(1, 'Cumplimiento (Sí / No'),
    p(2, '1.1 Uno'),
    p(2, '1.2 Dos'),
    p(2, '1.3 Tres'),
  ];
  // Act
  const tablas = [[], sinCabecera, sinCumplimiento, pocasFilas, repetidas, textoSuelto, parentesisAbierto].map((ps) =>
    tablaDeRequisitos(ps),
  );
  // Assert
  assert.deepEqual(tablas, [null, null, null, null, null, null, null]);
});

test('should_turn_the_casoB_annex_xiv_into_a_transcribed_docx_with_one_row_per_requirement', async () => {
  // Act
  const m = await analizarXiv();
  // Assert
  assert.deepEqual([m.tipo, m.motivo, m.desde_pagina, m.hasta_pagina], ['transcrito', AVISO_TABLA, 12, 22]);
  const h = localizarHuecos(fs.readFileSync(m.docx!));
  assert.equal(h.error, null);
  const conHueco = h.data!.parrafos.filter((x) => x.huecos.length > 0);
  assert.equal(conHueco.length, 62, 'Cumplimiento y Evidencia/fuente de los 31 requisitos');
  assert.ok(conHueco.every((x) => x.en_tabla && x.texto === HUECO_CELDA));
  const textos = h.data!.parrafos.map((x) => x.texto);
  assert.ok(
    ['Requisito', 'Cumplimiento (Sí / No / Parcialmente implantado / No Aplica)', COLUMNA_EVIDENCIA].every((c) =>
      textos.includes(c),
    ),
    'la cabecera de la tabla',
  );
  assert.ok(
    textos.includes('1.1 Política de Seguridad de la Información') && textos.includes('(pág. 12)'),
    'el texto literal y su página',
  );
  assert.equal(localizarModelo(h.data!.parrafos, 'Anexo XIV')?.desde, 1, 'el .docx empieza por el título del modelo');
});

test('should_fill_the_generated_table_by_the_word_path_and_warn_to_check_it_against_the_original', async () => {
  // Arrange
  const m = await analizarXiv();
  const h = localizarHuecos(fs.readFileSync(m.docx!)).data!;
  const cumplimiento11 = h.parrafos.find((x) => x.huecos.length > 0)!.indice;
  const entrada = AnexoEntrada.parse({
    id: ID,
    clave: XIV,
    desde_parrafo: 1,
    hasta_parrafo: h.parrafos.at(-1)!.indice,
    sustituciones: [{ parrafo: cumplimiento11, original: HUECO_CELDA, nuevo: 'Sí', dato: 'Cumplimiento' }],
  });
  // Act
  const pedido = await pedirAnexo(ctx, ID, XIV);
  const ins = await instruccionesDeAnexo(db, nucleo().db, { id: ID, clave: XIV, pedida_en: ahora });
  const r = await recibirAnexo(ctx, entrada);
  // Assert
  assert.equal(pedido.error, null, pedido.error?.message);
  assert.match(ins, /GENERADO A PARTIR DE LA TABLA DE REQUISITOS DEL PDF «pcap-modelos\.pdf» \(págs\. 12-22\)/);
  assert.equal(r.error, null, r.error?.message);
  assert.ok(r.data!.avisos.includes(AVISO_TABLA), r.data!.avisos.join(' | '));
  assert.equal(
    r.data!.avisos.some((a) => a.startsWith('Transcrito del PDF')),
    false,
    'no es una transcripción del texto',
  );
  const f = filaDocumento(db, ID, XIV)!;
  assert.equal(f.estado, 'borrador');
  assert.ok((JSON.parse(f.avisos) as string[]).includes(AVISO_TABLA), 'el aviso queda en la fila');
});

test('should_keep_reading_rows_when_a_continuation_line_looks_like_place_and_date', () => {
  // Arrange: «En …, a través de …» es texto de una fila; el cierre lleva forma de fecha y va tras la última fila.
  const ps = [
    p(1, 'ANEXO XIV'),
    p(1, 'Requisito'),
    p(1, 'Cumplimiento'),
    p(1, '1.1 Uso de servicios en la nube'),
    p(1, 'En el caso de servicios en la nube, a través de proveedores certificados.'),
    p(1, '1.2 Firma de los responsables'),
    p(1, 'Fdo.: el responsable de seguridad de cada sistema.'),
    p(2, '1.3 Copias de seguridad'),
    p(2, 'En los sistemas de categoría MEDIA, a 3 de ellos se les exige cifrado.'),
    p(2, 'En ……………, a …… de …………… de 20……'),
    p(2, 'Fdo y sellado'),
  ];
  const conFecha = [...ps.slice(0, -2), p(2, 'En Madrid, a 12 de octubre de 2026'), p(2, 'Fdo y sellado')];
  // Act
  const t = tablaDeRequisitos(ps);
  const t2 = tablaDeRequisitos(conFecha);
  // Assert
  assert.ok(t && t2);
  const requisitos = t.filas.flatMap((f) => (f.tipo === 'requisito' ? [f] : []));
  assert.deepEqual(
    requisitos.map((r) => r.id),
    ['1.1', '1.2', '1.3'],
    'ninguna fila se pierde en «después»',
  );
  assert.equal(requisitos[0]!.lineas[1], 'En el caso de servicios en la nube, a través de proveedores certificados.');
  assert.equal(
    requisitos[1]!.lineas[1],
    'Fdo.: el responsable de seguridad de cada sistema.',
    'una «firma» antes de la última fila es texto de la fila',
  );
  assert.equal(requisitos[2]!.lineas.length, 2);
  assert.deepEqual(t.despues, ['En ……………, a …… de …………… de 20……', 'Fdo y sellado']);
  assert.deepEqual(t2.despues, ['En Madrid, a 12 de octubre de 2026', 'Fdo y sellado']);
});
