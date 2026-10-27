// El DEUC de la oferta preparado por código: de la petición de Villaejemplo (sintética,
// fixtures/documentos/deuc.ts, ESPDRequest como los de la PLACSP) y del perfil sale DEUC-vN.xml
// en Salidas/…/anexos, con la fila en «borrador» y lo que queda por responder. Sin runs, sin
// precio y solo con versión nueva si cambia lo que lleva. Empresa ficticia (Persona A).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { licitacion } from '../helpers/sinteticas.js';
import { CARPETA_PLIEGOS, decisionesCasoA, FICHA_CASO_A, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';
import { peticionDeucCasoC } from './fixtures/documentos/deuc.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-deuc-'));
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
process.env.LICITACIONES_DEUC_XML = '1';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { GuionEntrada, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { cambiarDocumento, documentosDe, filaDocumento } =
  await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { documentosOferta } = await import('../../src/dominios/licitaciones/oferta/anexosChecklist.js');
const { conDeucParaAgente, datosEspdDe, deucAuto, deucXmlActivo, huellaDeuc, infoDeuc, prepararDeuc } =
  await import('../../src/dominios/licitaciones/oferta/deuc.js');
const { ofertaParaAgente } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
const { textoInstrucciones } = await import('../../src/dominios/licitaciones/oferta/paqueteTextos.js');

iniciarNucleo();
const db = dbLicitaciones();
const dbNucleo = nucleo().db;
const raices = { salidas, conocimiento };
const ctx = { db, dbNucleo, raices };
const AHORA_MS = Date.parse('2026-10-15T10:00:00Z');
const ahora = new Date(AHORA_MS).toISOString();
const DEUC = 'a1-d1';
const PRECIO = 12_345;

const peticion = peticionDeucCasoC();
fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
fs.writeFileSync(path.join(conocimiento, CARPETA_PLIEGOS, 'Deuc.xml'), peticion);
db.prepare(
  "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, tipo, actualizado_en) VALUES (?, ?, 'anexo', 'Deuc.xml', 'descargado', ?, 'deuc', ?)",
).run(ID, 'https://contrataciondelestado.es/Deuc.xml', `${CARPETA_PLIEGOS}/Deuc.xml`, ahora);

guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ahora, ahora);
const { id: _id, ...FICHA_BASE } = FICHA_CASO_A;
db.prepare(
  "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en) VALUES (?, 'aprobada', ?, 'licitaciones', ?, ?, ?)",
).run(ID, JSON.stringify(FICHA_BASE), ahora, ahora, ahora);
assert.equal((await proponerGuion(db, GuionEntrada.parse(guionCon(() => {})), 'licitaciones')).error, null);

const PERFIL = {
  nif: 'B00000000',
  nombre: 'Empresa Ejemplo, S.L.',
  domicilio: 'Calle Ejemplo 1, 38001 Puerto de Ejemplo',
  tamano: 'pequena',
  representante: { nombre: 'Persona A', nif: '00000000T', cargo: 'Administradora única' },
  contacto: { email: 'licitaciones@ejemplo.test' },
  volumen_negocio: [
    { anio: 2024, importe: 150_000 },
    { anio: 2025, importe: 180_000 },
  ],
};
const PERSONA = crearPersona(dbNucleo, { nombre: 'Persona A', tipo: 'interno', rol: 'Consultora' }).data!.id;
const decidir = (cambio: object = {}) =>
  assert.equal(
    guardarDecisiones(db, dbNucleo, ID, {
      ...decisionesCasoA([PERSONA]),
      precio: { importe: PRECIO, pendiente: false },
      ...cambio,
    }).error,
    null,
  );

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const carpeta = () =>
  path.join(salidas, 'Licitaciones', fs.readdirSync(path.join(salidas, 'Licitaciones'))[0]!, 'anexos');
const xmls = () =>
  fs.existsSync(path.join(salidas, 'Licitaciones'))
    ? fs
        .readdirSync(carpeta())
        .filter((n) => n.endsWith('.xml'))
        .sort()
    : [];
const runs = () => (dbNucleo.prepare('SELECT COUNT(*) AS n FROM trabajos_ia').get() as { n: number }).n;

test('should_refuse_when_nif_or_address_are_missing_and_name_them', async () => {
  const sinPerfil = await prepararDeuc(ctx, ID, DEUC);
  assert.equal(sinPerfil.error?.code, 'conflicto');
  assert.match(
    sinPerfil.error!.message,
    /Faltan datos de la empresa para el DEUC: NIF, domicilio\. Complétalos en Ajustes › Empresa\./,
  );
  assert.equal(guardarPerfilEmpresa(dbNucleo, { ...PERFIL, domicilio: null }).error, null);
  const sinDomicilio = datosEspdDe(dbNucleo, db, ID);
  assert.equal(sinDomicilio.error?.code, 'conflicto');
  assert.match(sinDomicilio.error!.message, /: domicilio\./);
  assert.deepEqual(xmls(), [], 'no se escribe nada');
});

test('should_prepare_the_deuc_from_the_request_and_the_company_profile_as_a_draft', async () => {
  assert.equal(guardarPerfilEmpresa(dbNucleo, PERFIL).error, null);
  decidir();
  const antes = runs();
  const r = await prepararDeuc(ctx, ID, DEUC);
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.version, 1);
  assert.match(r.data!.ruta, /^Salidas\/Licitaciones\/.+\/anexos\/DEUC-v1\.xml$/);
  assert.ok((r.data!.sin_responder ?? 0) > 0, 'los motivos de exclusión quedan por responder');
  const xml = fs.readFileSync(path.join(carpeta(), 'DEUC-v1.xml'), 'utf8');
  assert.ok(new XMLParser().parse(xml), 'se vuelve a leer');
  assert.match(xml, /B00000000/);
  assert.match(xml, /Persona A/);
  assert.match(xml, /38001/);
  const f = filaDocumento(db, ID, DEUC)!;
  assert.equal(f.estado, 'borrador');
  assert.equal(f.ruta, r.data!.ruta);
  assert.deepEqual(JSON.parse(f.avisos), [
    `Quedan ${r.data!.sin_responder} preguntas por responder en el servicio DEUC (motivos de exclusión…).`,
  ]);
  assert.equal(runs(), antes, 'Hermes no gasta ningún run');
  const fila = (await documentosOferta(db, raices, ID)).data!.documentos.find((d) => d.clave === DEUC)!;
  assert.equal(fila.anexo.deuc?.version, 1);
  assert.equal(fila.anexo.deuc?.respuesta, r.data!.ruta);
  assert.equal(fila.anexo.deuc?.peticion, `Conocimiento/${CARPETA_PLIEGOS}/Deuc.xml`);
  assert.equal(fila.anexo.deuc?.sin_responder?.length, r.data!.sin_responder);
});

test('should_never_put_a_price_in_the_deuc', () => {
  const xml = fs.readFileSync(path.join(carpeta(), 'DEUC-v1.xml'), 'utf8');
  for (const forma of ['12345', '12.345', '12 345'])
    assert.ok(!xml.includes(forma), `sin el importe ofertado (${forma})`);
});

test('should_not_create_a_new_version_when_nothing_it_uses_changed', async () => {
  decidir({ enfoque: 'Otro enfoque: respuestas en 24 horas y una persona de referencia por sede.' });
  const antes = runs();
  assert.equal(deucAuto(dbNucleo, db, raices, AHORA_MS), 0);
  assert.equal((await prepararDeuc(ctx, ID, DEUC)).data?.version, 1, 'a mano devuelve la que hay');
  assert.deepEqual(xmls(), ['DEUC-v1.xml'], '0 archivos nuevos');
  assert.equal(runs(), antes, '0 runs');
});

test('should_create_a_new_version_when_the_lots_or_the_profile_change_unless_it_was_marked_ready', () => {
  const datos = datosEspdDe(dbNucleo, db, ID).data!;
  assert.notEqual(
    huellaDeuc('a'.repeat(64), datos),
    huellaDeuc('a'.repeat(64), { ...datos, lotes: ['3'] }),
    'otros lotes, otra huella',
  );
  assert.equal(
    guardarPerfilEmpresa(dbNucleo, { ...PERFIL, domicilio: 'Calle Nueva 2, 38002 Puerto de Ejemplo' }).error,
    null,
  );
  assert.equal(deucAuto(dbNucleo, db, raices, AHORA_MS), 1);
  assert.deepEqual(xmls(), ['DEUC-v1.xml', 'DEUC-v2.xml']);
  assert.match(fs.readFileSync(path.join(carpeta(), 'DEUC-v2.xml'), 'utf8'), /38002/);
  assert.equal(cambiarDocumento(db, ID, DEUC, { estado: 'preparado' }).error, null);
  assert.equal(
    guardarPerfilEmpresa(dbNucleo, { ...PERFIL, domicilio: 'Calle Tercera 3, 38003 Puerto de Ejemplo' }).error,
    null,
  );
  assert.equal(deucAuto(dbNucleo, db, raices, AHORA_MS), 0, 'el preparado no se rehace');
  assert.deepEqual(xmls(), ['DEUC-v1.xml', 'DEUC-v2.xml']);
  assert.ok(
    (JSON.parse(filaDocumento(db, ID, DEUC)!.avisos) as string[]).includes(
      'El DEUC es anterior a los cambios en los datos de la empresa: vuelve a importarlo.',
    ),
  );
});

test('should_remove_the_outdated_warning_when_the_deuc_matches_again', () => {
  // Arrange: se deja el domicilio de la v2 (el DEUC preparado vuelve a estar al día).
  assert.equal(
    guardarPerfilEmpresa(dbNucleo, { ...PERFIL, domicilio: 'Calle Nueva 2, 38002 Puerto de Ejemplo' }).error,
    null,
  );
  // Act
  const n = deucAuto(dbNucleo, db, raices, AHORA_MS);
  // Assert
  assert.equal(n, 0, 'nada que rehacer');
  const avisos = JSON.parse(filaDocumento(db, ID, DEUC)!.avisos) as string[];
  assert.ok(!avisos.some((a) => a.startsWith('El DEUC es anterior a')), avisos.join(' | '));
  assert.equal(filaDocumento(db, ID, DEUC)!.estado, 'preparado', 'lo preparado sigue preparado');
  assert.deepEqual(xmls(), ['DEUC-v1.xml', 'DEUC-v2.xml']);
});

test('should_report_unanswered_questions_in_licitaciones_oferta', () => {
  const r = conDeucParaAgente(db, ofertaParaAgente(db, dbNucleo, { id: ID, secciones: ['estado'] }, false, AHORA_MS));
  assert.equal(r.error, null);
  const deuc = r.data!['deuc'] as { version: number; sin_responder: { codigo: string; nombre: string }[] };
  assert.equal(deuc.version, 2);
  assert.ok(deuc.sin_responder.length > 0);
  assert.ok(deuc.sin_responder.every((p) => p.codigo && p.nombre));
  assert.ok(!JSON.stringify(deuc).includes('Salidas/'), 'sin rutas');
  const sinEstado = conDeucParaAgente(
    db,
    ofertaParaAgente(db, dbNucleo, { id: ID, secciones: ['guion'] }, false, AHORA_MS),
  );
  assert.equal(sinEstado.data!['deuc'], undefined);
});

test('should_add_the_import_step_to_the_package_instructions', () => {
  const base = {
    licitacion: { expediente: 'EXP-2026-0412', titulo: 'Servicio', organo: 'Órgano' },
    version: 1,
    plazo: null,
    canal: null,
    comprobaciones: [],
  };
  const con = textoInstrucciones({
    ...base,
    deuc: { sin_responder: 7 },
    carpetas: [{ ruta: '1 Archivo', firma: null, documentos: [{ archivo: '01 DEUC.xml', nombre: 'DEUC' }] }],
  });
  assert.match(
    con,
    /DEUC: importa «01 DEUC\.xml» en el servicio DEUC \(https:\/\/visor\.registrodelicitadores\.gob\.es\/espd-web\/filter\?lang=es\), responde las 7 preguntas que quedan \(motivos de exclusión\), descarga el PDF y fírmalo con el resto\./,
  );
  const sin = textoInstrucciones({
    ...base,
    carpetas: [{ ruta: '1 Archivo', firma: null, documentos: [{ archivo: '01 DEUC.pdf', nombre: 'DEUC' }] }],
  });
  assert.ok(!sin.includes('importa'), 'sin XML no hay paso de importar');
  const noSe = textoInstrucciones({
    ...base,
    deuc: { sin_responder: null },
    carpetas: [{ ruta: '1 Archivo', firma: null, documentos: [{ archivo: '01 DEUC.xml', nombre: 'DEUC' }] }],
  });
  assert.match(
    noSe,
    /responde las preguntas que quedan \(motivos de exclusión\)/,
    'sin saber cuántas, no inventa un número',
  );
});

test('should_stay_off_unless_the_switch_is_on', async () => {
  assert.equal(deucXmlActivo({}), false);
  assert.equal(deucXmlActivo({ LICITACIONES_DEUC_XML: '0' }), false);
  process.env.LICITACIONES_DEUC_XML = '0';
  try {
    assert.equal((await prepararDeuc(ctx, ID, DEUC)).error?.code, 'no_configurado');
    assert.equal(deucAuto(dbNucleo, db, raices, AHORA_MS), 0);
  } finally {
    process.env.LICITACIONES_DEUC_XML = '1';
  }
});

test('should_not_prepare_the_deuc_alone_while_an_eligibility_block_is_open', async () => {
  const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
  const ens = {
    tipo: 'certificacion',
    descripcion: 'Certificado de conformidad con el ENS de categoría MEDIA',
    excluyente: true,
    valor_exigido: 'ENS MEDIA',
    cumple: 'no',
    fuente: 'perfil.certificaciones',
    justificacion: 'No tenemos ENS.',
    documento: 'PCAP.pdf',
    pagina: 18,
  };
  db.prepare('UPDATE fichas SET datos = ? WHERE licitacion_id = ?').run(
    JSON.stringify({ ...FICHA_BASE, requisitos: [ens] }),
    ID,
  );
  assert.equal(cambiarDocumento(db, ID, DEUC, { estado: 'borrador' }).error, null);
  // Sin ENS declarado («no tenemos ninguno») y con otro domicilio: sin el freno saldría la v3.
  assert.equal(
    guardarPerfilEmpresa(dbNucleo, {
      ...PERFIL,
      certificados: [],
      domicilio: 'Calle Cuarta 4, 38004 Puerto de Ejemplo',
    }).error,
    null,
  );
  const bloqueos = comprobacionesDe(db, dbNucleo, ID, AHORA_MS).data!.bloqueos;
  assert.ok(
    bloqueos.some((b) => b.categoria === 'elegibilidad' && b.gravedad === 'impide' && b.estado === 'abierto'),
    'el ENS frena',
  );
  assert.equal(deucAuto(dbNucleo, db, raices, AHORA_MS), 0, 'el DEUC declara la solvencia: espera al «Vamos»');
  assert.deepEqual(xmls(), ['DEUC-v1.xml', 'DEUC-v2.xml']);
});

// ── Por lotes: la petición de Villaejemplo en una licitación con cuatro lotes y el DEUC en un archivo por lote ──

const LOTES = ['1', '2', '3', '4'].map((id) => ({ id, nombre: `Lote ${id}`, importe: 10_000 }));
const L2 = licitacion({
  titulo: 'Servicio por lotes',
  publicada: '2026-09-30',
  presupuesto: 40_000,
  lotes: LOTES,
  limite: `${new Date(AHORA_MS + 20 * 86_400_000).toISOString().slice(0, 10)}T08:00:00`,
});
const CARPETA_L2 = `Licitaciones/Radar/2026/lotes (${L2.id})`;
const ofertaLote = (lote: string) => ({
  lotes: [lote],
  formula: 'P = 40 × (Om / O)',
  presupuesto_base: 10_000,
  impuesto_aparte: 'IGIC',
  precios_unitarios: [],
  umbral_anormalidad: null,
  modelo: 'Anexo VI',
  archivo: 'Archivo electrónico único',
});
const enDisco = (ruta: string) => fs.readFileSync(path.join(salidas, ruta.replace(/^Salidas\//, '')), 'utf8');
const declaraLote = (xml: string, lote: string) => new RegExp(`ProcurementProjectLot><[^>]*ID[^>]*>${lote}<`).test(xml);
const avisosDe = (clave: string) => JSON.parse(filaDocumento(db, L2.id, clave)!.avisos) as string[];

const interes = (lotes: string[]) => lotes.map((id) => ({ id, motivo: 'criba' }));

async function prepararL2(): Promise<void> {
  guardarLicitacion(db, L2);
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?, ?)",
  ).run(L2.id, JSON.stringify(interes(['3'])), ahora, ahora);
  db.prepare(
    "INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en) VALUES (?, 'aprobada', ?, 'licitaciones', ?, ?, ?)",
  ).run(L2.id, JSON.stringify(FICHA_BASE), ahora, ahora, ahora);
  fs.mkdirSync(path.join(conocimiento, CARPETA_L2), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, CARPETA_L2, 'Deuc.xml'), peticion);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, tipo, actualizado_en) VALUES (?, ?, 'anexo', 'Deuc.xml', 'descargado', ?, 'deuc', ?)",
  ).run(L2.id, 'https://contrataciondelestado.es/lotes/Deuc.xml', `${CARPETA_L2}/Deuc.xml`, ahora);
  const guion = {
    id: L2.id,
    archivos: [
      {
        nombre: 'Archivo electrónico único',
        contenido: 'Documentación administrativa por lote.',
        ambito: 'por_lote',
        documentos: [{ tipo: 'deuc', nombre: 'DEUC', obligatorio: true, produce: 'persona' }],
      },
    ],
    memoria: null,
    automaticos: [],
    ofertas_economicas: [ofertaLote('3'), ofertaLote('4')],
    plazo: { fecha_limite: '2026-10-30T08:00', canal: 'PLACSP' },
    lotes: ['3', '4'],
  };
  const g = await proponerGuion(db, GuionEntrada.parse(guion), 'licitaciones');
  assert.equal(g.error, null, g.error?.message);
}

function decidirLotes(lotes: string[]): void {
  const r = guardarDecisiones(db, dbNucleo, L2.id, {
    lotes,
    equipo: [{ persona_id: PERSONA, rol_en_la_oferta: 'Consultora', dedicacion: '50 %', lotes: [] }],
    automaticos: [],
    herramientas: ['Gestor de tickets'],
    enfoque: 'Servicio cercano con una persona de referencia por lote.',
    ofertas: lotes.map((lote) => ({ lote, pendiente: false, importe: 9_000 })),
  });
  assert.equal(r.error, null, r.error?.message);
}

const filasL2 = () =>
  documentosDe(db, L2.id)
    .documentos.filter((d) => d.tipo === 'deuc')
    .map((d) => d.clave)
    .sort();

test('should_declare_the_decided_lot_in_the_deuc_of_a_tender_with_lots', async () => {
  // Arrange
  await prepararL2();
  decidirLotes(['3']);
  // Act
  const n = deucAuto(dbNucleo, db, raices, AHORA_MS);
  // Assert
  assert.equal(n, 1, 'solo la licitación por lotes (la otra sigue frenada por el ENS)');
  assert.deepEqual(filasL2(), ['a1-d1-l3']);
  const f = filaDocumento(db, L2.id, 'a1-d1-l3')!;
  assert.match(f.ruta ?? '', /\/anexos\/DEUC-v1\.xml$/);
  const xml = enDisco(f.ruta!);
  assert.ok(declaraLote(xml, '3'), 'declara el lote 3');
  assert.ok(!declaraLote(xml, '4') && !declaraLote(xml, '1'), 'y ningún otro');
});

test('should_write_a_new_version_and_warn_about_the_lots_when_the_lots_change', () => {
  // Arrange: el DEUC del lote 3 ya se importó; ahora se presenta también al 4.
  assert.equal(cambiarDocumento(db, L2.id, 'a1-d1-l3', { estado: 'preparado' }).error, null);
  db.prepare('UPDATE oportunidades SET lotes_interes = ? WHERE licitacion_id = ?').run(
    JSON.stringify(interes(['3', '4'])),
    L2.id,
  );
  decidirLotes(['3', '4']);
  // Act
  const n = deucAuto(dbNucleo, db, raices, AHORA_MS);
  // Assert
  assert.equal(n, 1);
  assert.deepEqual(filasL2(), ['a1-d1-l3', 'a1-d1-l4']);
  const l4 = filaDocumento(db, L2.id, 'a1-d1-l4')!;
  assert.match(l4.ruta ?? '', /\/anexos\/DEUC-v2\.xml$/);
  assert.equal(l4.estado, 'borrador');
  const xml = enDisco(l4.ruta!);
  assert.ok(declaraLote(xml, '3') && declaraLote(xml, '4'), 'la v2 declara los dos lotes');
  assert.match(filaDocumento(db, L2.id, 'a1-d1-l3')!.ruta ?? '', /DEUC-v1\.xml$/, 'lo preparado no se toca');
  assert.ok(
    avisosDe('a1-d1-l3').includes('El DEUC es anterior a los cambios en los lotes: vuelve a importarlo.'),
    avisosDe('a1-d1-l3').join(' | '),
  );
});

test('should_point_every_lot_row_to_the_current_deuc_when_it_is_prepared_or_its_path_was_lost', async () => {
  // Arrange: la fila del lote 4 perdió su ruta.
  db.prepare(
    "UPDATE oferta_documentos SET ruta = NULL, anexo_en = NULL, estado = 'pendiente' WHERE licitacion_id = ? AND clave = ?",
  ).run(L2.id, 'a1-d1-l4');
  // Act
  const n = deucAuto(dbNucleo, db, raices, AHORA_MS);
  const a3 = await prepararDeuc(ctx, L2.id, 'a1-d1-l3');
  // Assert
  assert.equal(n, 0, 'sin versión nueva');
  const l4 = filaDocumento(db, L2.id, 'a1-d1-l4')!;
  assert.match(l4.ruta ?? '', /DEUC-v2\.xml$/, 'la vuelta la apunta a la vigente');
  assert.equal(l4.estado, 'borrador');
  assert.equal(a3.error, null, a3.error?.message);
  assert.equal(a3.data!.version, 2);
  const l3 = filaDocumento(db, L2.id, 'a1-d1-l3')!;
  assert.deepEqual(
    [l3.ruta, l3.estado],
    [a3.data!.ruta, 'borrador'],
    'a mano, la fila pedida pasa a llevar la vigente',
  );
  assert.ok(!avisosDe('a1-d1-l3').some((a) => a.startsWith('El DEUC es anterior a')));
});

test('should_report_unknown_questions_when_the_saved_list_is_unreadable', () => {
  // Arrange
  db.prepare("UPDATE deuc_respuestas SET sin_responder = '{roto' WHERE licitacion_id = ? AND version = 2").run(ID);
  // Act
  const info = infoDeuc(db, ID);
  const agente = conDeucParaAgente(
    db,
    ofertaParaAgente(db, dbNucleo, { id: ID, secciones: ['estado'] }, false, AHORA_MS),
  );
  // Assert
  assert.equal(info.sin_responder, null, 'no se sabe: no es «nada que responder»');
  assert.equal((agente.data!['deuc'] as { sin_responder: unknown }).sin_responder, null);
});
