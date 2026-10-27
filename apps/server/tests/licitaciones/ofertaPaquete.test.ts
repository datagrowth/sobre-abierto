// Paquete de presentación con el caso de Villaejemplo (lote 3, sobres A, B y C), que el 14/10/2026
// se montó a mano: anexos de la checklist, índice numerado del Sobre B, memoria aceptada,
// reparto por sobre y lote, la comprobación de fugas C→B y la regla de que lo tecleado en la
// PLACSP prevalece. Salidas en un directorio temporal, sin LibreOffice.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-paquete-'));
const salidas = path.join(tmp, 'salidas');
fs.mkdirSync(salidas, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { textoDe } = await import('../../src/nucleo/salidas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { elegirLotesInteres } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { GuionEntrada, guionVigente, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { cambiarDocumento, documentosDe } = await import('../../src/dominios/licitaciones/oferta/documentos.js');
const {
  comprobacionesDelPaquete,
  estadoPaquete,
  generarPaquete,
  Manifiesto,
  paqueteParaAgente,
  paqueteVigente,
  planDePaquete,
  conteoPorLote,
} = await import('../../src/dominios/licitaciones/oferta/paquete.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { faltaDePreparacion } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { NuevaPropuesta, borrarPropuesta, registrarPropuesta } =
  await import('../../src/dominios/licitaciones/propuestas/registro.js');
const { copiarPaquetesPresentados } = await import('../../src/dominios/licitaciones/presentadas.js');
const { comprobadoDelPaquete, textoInstrucciones, valoresATeclear } =
  await import('../../src/dominios/licitaciones/oferta/paqueteTextos.js');

iniciarNucleo();
const db = dbLicitaciones();
const c = () => ({ db, dbNucleo: nucleo().db, raices: raicesActuales() });
assert.equal(
  guardarPerfilEmpresa(nucleo().db, {
    nif: 'B12345678',
    nombre: 'Analítica Ejemplo SL',
    domicilio: 'Calle Ejemplo 7, 38001 Puerto de Ejemplo',
  }).error,
  null,
);

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SOBRE_A = 'Sobre A - Documentacion administrativa';
const SOBRE_B = 'Sobre B - Criterios de juicio de valor';
const SOBRE_C = 'Sobre C - Criterios cuantificables';
const doc = (tipo: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  tipo,
  nombre,
  obligatorio: true,
  produce: tipo === 'memoria' ? 'hermes' : 'persona',
  ...extra,
});
const GUION = {
  archivos: [
    {
      nombre: SOBRE_A,
      contenido: 'Documentación administrativa.',
      documentos: [
        doc('deuc', 'DEUC'),
        doc('declaracion', 'Anexo VI declaracion responsable'),
        doc('declaracion', 'Anexo VII adscripcion de medios'),
      ],
    },
    {
      nombre: SOBRE_B,
      contenido: 'Propuesta académica.',
      indice: true,
      firma: 'Firma electrónica del representante',
      documentos: [
        doc('memoria', 'Propuesta academica'),
        doc('otro', 'Certificados de calidad', { obligatorio: false }),
      ],
    },
    {
      nombre: SOBRE_C,
      contenido: 'Oferta económica y criterios automáticos.',
      documentos: [doc('oferta_economica', 'Anexo V proposicion')],
    },
  ],
  memoria: {
    archivo: SOBRE_B,
    titulo_documento: 'Propuesta académica',
    limite_paginas: 20,
    apartados: [
      {
        titulo: 'Metodología y planificación',
        puntos: 30,
        se_valorara: ['Metodología de las sesiones'],
        escala: [],
        documento: 'PCAP.pdf',
        pagina: 12,
      },
    ],
  },
  automaticos: [
    {
      criterio: 'Herramienta de control remoto del aula',
      puntos: 10,
      como_se_acredita: 'Declaración en el Anexo V',
      casilla_en: 'Anexo V, apartado 2',
      archivo: SOBRE_C,
      marcas: ['RustDesk', 'control remoto del aula'],
      tipo: 'compromiso',
      documento: 'PCAP.pdf',
      pagina: 14,
    },
  ],
  ofertas_economicas: [
    {
      lotes: ['3'],
      formula: 'P = 60 × (Om / O)',
      presupuesto_base: 20_000,
      impuesto_aparte: 'IVA',
      precios_unitarios: [],
      umbral_anormalidad: null,
      modelo: 'Anexo V',
      archivo: SOBRE_C,
    },
  ],
  plazo: { fecha_limite: '2026-10-20T14:00', canal: 'PLACSP' },
  lotes: ['3'],
};
const LIMITE = Date.parse('2026-10-20T12:00:00Z');
const AHORA = Date.parse('2026-10-14T16:00:00Z');

async function docx(parrafos: string[]): Promise<Buffer> {
  return Buffer.from(
    await Packer.toBuffer(
      new Document({ sections: [{ children: parrafos.map((t) => new Paragraph({ children: [new TextRun(t)] })) }] }),
    ),
  );
}

// El primer trozo de texto queda resaltado en amarillo, como lo dejó quien revisaba.
function conAmarillo(bytes: Buffer): Buffer {
  const z = unzipSync(new Uint8Array(bytes));
  z['word/document.xml'] = strToU8(
    strFromU8(z['word/document.xml']!).replace('<w:r>', '<w:r><w:rPr><w:highlight w:val="yellow"/></w:rPr>'),
  );
  return Buffer.from(zipSync(z));
}

function escribir(id: string, nombre: string, bytes: Buffer): string {
  const rel = `Salidas/Licitaciones/docs (${id})/${nombre}`;
  const abs = path.join(salidas, 'Licitaciones', `docs (${id})`, nombre);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  return rel;
}

const MEMORIA_BUENA = [
  'Las sesiones combinan teoría breve y práctica guiada con casos del propio centro.',
  'Cada semana se revisa el avance con la coordinadora.',
];

/** Villaejemplo con otro id: lote 3, guion, decisiones, la checklist con sus archivos y la memoria aceptada. */
async function casoC(id: string, memoria: Buffer | null = null): Promise<void> {
  const l = licitacion({
    titulo: 'Formación en competencias digitales (4 lotes)',
    publicada: '2026-09-30',
    presupuesto: 80_000,
    limite: '2026-10-20T14:00:00',
    lotes: ['1', '2', '3', '4'].map((x) => ({ id: x, nombre: `Lote ${x}`, importe: 20_000 })),
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}` });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?)",
  ).run(id, ts, ts);
  assert.equal(elegirLotesInteres(db, id, { lotes: ['3'] }).error, null);
  assert.equal((await proponerGuion(db, GuionEntrada.parse({ ...GUION, id }), 'licitaciones')).error, null);
  const decisiones = {
    lotes: ['3'],
    equipo: [],
    herramientas: [],
    enfoque: 'Sesiones prácticas con casos del centro.',
    automaticos: [{ criterio: 'Herramienta de control remoto del aula', nos_acogemos: true }],
    ofertas: [{ lote: '3', pendiente: false, importe: 18_000 }],
  };
  assert.equal(guardarDecisiones(db, nucleo().db, id, decisiones).error, null);
  const memoriaRuta = escribir(id, 'memoria-v1.docx', memoria ?? (await docx(MEMORIA_BUENA)));
  const borrador = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, version)
    VALUES (?, ?, 'h', 10, 'plataforma', ?, 'aceptada', 'ensamblado', 1)`,
      )
      .run(id, memoriaRuta, ts).lastInsertRowid,
  );
  const memoriaId = db
    .prepare(
      "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, borrador_id) VALUES (?, ?, 1, 'ensamblada', ?, ?)",
    )
    .run(id, guionVigente(db, id)!.id, ts, borrador).lastInsertRowid;
  // Como lo deja el ensamblado (registrarBorrador): el borrador apunta a su memoria.
  db.prepare('UPDATE borradores SET memoria_id = ? WHERE id = ?').run(memoriaId, borrador);
  for (const d of documentosDe(db, id).documentos.filter((x) => x.tipo !== 'memoria')) {
    if (!d.obligatorio) {
      assert.equal(
        cambiarDocumento(db, id, d.clave, { estado: 'no_aplica', nota: 'No aplica a esta oferta.' }).error,
        null,
      );
      continue;
    }
    const ruta = escribir(id, `${d.nombre}.pdf`, Buffer.from(`%PDF-1.4 ${d.nombre}`));
    assert.equal(cambiarDocumento(db, id, d.clave, { estado: 'preparado', ruta }).error, null);
  }
  // Lo preparado queda antes de AHORA (la hora fija con que se genera el paquete): con la hora
  // real, pasadas las 16:00 UTC del 14 oct las decisiones parecían posteriores al paquete.
  const antes = new Date(AHORA - 3_600_000).toISOString();
  db.prepare('UPDATE decisiones_oferta SET actualizada_en = ? WHERE licitacion_id = ?').run(antes, id);
  db.prepare('UPDATE oferta_documentos SET actualizado_en = ? WHERE licitacion_id = ?').run(antes, id);
}

const listar = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listar(path.join(dir, e.name)).map((x) => `${e.name}/${x}`) : [e.name]))
    .sort();
const enDisco = (ruta: string) => path.join(salidas, ...ruta.replace(/^Salidas\//, '').split('/'));
const tipos = (cs: { tipo: string; gravedad: string }[]) => cs.map((x) => `${x.gravedad}:${x.tipo}`);

test('should_lay_out_one_folder_per_lot_and_envelope_with_files_numbered_in_upload_order', async () => {
  await casoC('p-casoC-1');
  const r = await generarPaquete(c(), 'p-casoC-1', AHORA);
  assert.equal(r.error, null, r.error?.message);
  assert.match(r.data!.ruta, /^Salidas\/Licitaciones\/.+ \(p-casoC-1\)\/PRESENTACION\/v1 2026-10-14 1800$/);
  assert.deepEqual(listar(enDisco(r.data!.ruta)), [
    'DEUC_GUIA.md',
    'INSTRUCCIONES.md',
    'Lote 3/1 Sobre A - Documentacion administrativa/01 DEUC.pdf',
    'Lote 3/1 Sobre A - Documentacion administrativa/02 Anexo VI declaracion responsable.pdf',
    'Lote 3/1 Sobre A - Documentacion administrativa/03 Anexo VII adscripcion de medios.pdf',
    'Lote 3/2 Sobre B - Criterios de juicio de valor/00 Indice del sobre.docx',
    'Lote 3/2 Sobre B - Criterios de juicio de valor/01 Propuesta academica.docx',
    'Lote 3/3 Sobre C - Criterios cuantificables/01 Anexo V proposicion.pdf',
    'MANIFIESTO.json',
    'VALORES_A_TECLEAR.md',
    'memoria-v1-compromisos.md',
  ]);
  assert.equal(r.data!.bloqueos, 0, JSON.stringify(r.data!.manifiesto.comprobaciones));
  const instrucciones = fs.readFileSync(path.join(enDisco(r.data!.ruta), 'INSTRUCCIONES.md'), 'utf8');
  assert.doesNotMatch(instrucciones, /NO PRESENTABLE/);
  assert.match(instrucciones, /el 20\/10\/2026 a las 14:00 hora peninsular · PLACSP/);
  assert.match(instrucciones, /Lo tecleado en la sede prevalece sobre los documentos/);
});

test('should_write_a_manifest_with_the_sha256_of_every_copied_file', async () => {
  await casoC('p-casoC-2');
  const r = (await generarPaquete(c(), 'p-casoC-2', AHORA)).data!;
  const m = Manifiesto.parse(JSON.parse(fs.readFileSync(path.join(enDisco(r.ruta), 'MANIFIESTO.json'), 'utf8')));
  const docs = m.carpetas.flatMap((x) => x.documentos.map((d) => ({ ...d, carpeta: x.ruta })));
  assert.equal(docs.length, 6);
  for (const d of docs) {
    const bytes = fs.readFileSync(path.join(enDisco(r.ruta), ...d.carpeta.split('/'), d.archivo));
    assert.equal(d.sha256, crypto.createHash('sha256').update(bytes).digest('hex'), d.archivo);
    assert.equal(d.firma, 'pendiente');
  }
  assert.deepEqual(paqueteVigente(db, 'p-casoC-2')?.version, 1);
});

test('should_generate_the_envelope_index_from_the_files_actually_in_the_folder', async () => {
  await casoC('p-casoC-3');
  const r = (await generarPaquete(c(), 'p-casoC-3', AHORA)).data!;
  const indice = path.join(
    enDisco(r.ruta),
    'Lote 3',
    '2 Sobre B - Criterios de juicio de valor',
    '00 Indice del sobre.docx',
  );
  const texto = (await textoDe(indice)).data!;
  assert.match(texto, /Índice del Sobre B - Criterios de juicio de valor/);
  assert.match(texto, /Lote 3/);
  assert.match(texto, /1\s*\n*\s*Propuesta academica/);
  assert.doesNotMatch(texto, /Certificados de calidad/, 'no cita lo que no va dentro');
  assert.match(texto, /En Puerto de Ejemplo, a la fecha de la firma electrónica\./);
});

test('should_never_overwrite_a_previous_package_version', async () => {
  await casoC('p-casoC-4');
  const v1 = (await generarPaquete(c(), 'p-casoC-4', AHORA)).data!;
  const manifiesto1 = fs.readFileSync(path.join(enDisco(v1.ruta), 'MANIFIESTO.json'), 'utf8');
  const v2 = (await generarPaquete(c(), 'p-casoC-4', AHORA)).data!;
  assert.equal(v2.version, 2);
  assert.notEqual(v2.ruta, v1.ruta);
  assert.equal(
    fs.readFileSync(path.join(enDisco(v1.ruta), 'MANIFIESTO.json'), 'utf8'),
    manifiesto1,
    'la v1 sigue intacta',
  );
  assert.equal(paqueteVigente(db, 'p-casoC-4')?.version, 2);
});

test('should_block_when_a_mandatory_document_is_missing_or_the_deadline_has_passed', async () => {
  await casoC('p-casoC-5');
  const anexo = documentosDe(db, 'p-casoC-5').documentos.find((d) => d.nombre === 'Anexo VII adscripcion de medios')!;
  assert.equal(cambiarDocumento(db, 'p-casoC-5', anexo.clave, { ruta: null, estado: 'pendiente' }).error, null);
  const plan = planDePaquete(db, 'p-casoC-5').data!;
  const cs = await comprobacionesDelPaquete(db, raicesActuales(), plan, LIMITE + 3_600_000);
  assert.deepEqual(
    tipos(cs).filter((x) => x.startsWith('bloquea')),
    ['bloquea:plazo', 'bloquea:obligatorio'],
  );
  assert.match(cs[1]!.mensaje, /^Falta «Anexo VII adscripcion de medios» \(obligatorio\) en Lote 3\/1 Sobre A/);
  const r = (await generarPaquete(c(), 'p-casoC-5', LIMITE + 3_600_000)).data!;
  assert.equal(r.bloqueos, 2, 'se genera igual');
  assert.match(fs.readFileSync(path.join(enDisco(r.ruta), 'INSTRUCCIONES.md'), 'utf8'), /^# NO PRESENTABLE TODAVÍA/);
});

test('should_block_when_a_non_economic_document_leaks_the_price_or_an_automatic_criterion', async () => {
  await casoC(
    'p-casoC-6',
    await docx([...MEMORIA_BUENA, 'El aula se gestiona con RustDesk para dar soporte a cada alumna.']),
  );
  const cs = await comprobacionesDelPaquete(db, raicesActuales(), planDePaquete(db, 'p-casoC-6').data!, AHORA);
  const fuga = cs.find((x) => x.tipo === 'fuga')!;
  assert.equal(fuga.gravedad, 'bloquea');
  assert.match(fuga.mensaje, /«Propuesta academica» delata lo que va en otro sobre \(«RustDesk»\)/);
});

test('should_block_when_a_document_still_has_yellow_highlights_or_A_CONFIRMAR_marks', async () => {
  await casoC(
    'p-casoC-7',
    conAmarillo(await docx([...MEMORIA_BUENA, 'La coordinación la lleva [A CONFIRMAR: nombre].'])),
  );
  const cs = (await comprobacionesDelPaquete(db, raicesActuales(), planDePaquete(db, 'p-casoC-7').data!, AHORA)).filter(
    (x) => x.tipo === 'sin_cerrar',
  );
  assert.deepEqual(
    cs.map((x) => x.gravedad),
    ['bloquea', 'bloquea'],
  );
  assert.match(cs[0]!.mensaje, /texto sin cerrar: «\[A CONFIRMAR: nombre\]»/);
  assert.match(cs[1]!.mensaje, /resaltado en amarillo/);
});

test('should_warn_when_a_lot_folder_contains_a_document_naming_another_lot', async () => {
  await casoC('p-casoC-8', await docx([...MEMORIA_BUENA, 'Esta propuesta es para el lote 2 marcado en el Anexo VI.']));
  const cs = await comprobacionesDelPaquete(db, raicesActuales(), planDePaquete(db, 'p-casoC-8').data!, AHORA);
  const ajeno = cs.find((x) => x.tipo === 'lote_ajeno')!;
  assert.equal(ajeno.gravedad, 'aviso');
  assert.match(ajeno.mensaje, /está en la carpeta del lote 3 y habla del lote 2/);
});

test('should_mark_the_package_outdated_when_decisions_change_after_it', async () => {
  await casoC('p-casoC-9');
  await generarPaquete(c(), 'p-casoC-9', AHORA);
  assert.equal(paqueteVigente(db, 'p-casoC-9')?.desfasado, false);
  db.prepare(
    "UPDATE decisiones_oferta SET actualizada_en = '2999-01-01T00:00:00.000Z' WHERE licitacion_id = 'p-casoC-9'",
  ).run();
  assert.equal(paqueteVigente(db, 'p-casoC-9')?.desfasado, true);
});

test('should_write_the_values_to_type_per_lot_in_figures_and_words', async () => {
  await casoC('p-casoC-10');
  const plan = planDePaquete(db, 'p-casoC-10').data!;
  const valores = valoresATeclear(plan.decisiones!.datos, plan.guion.datos).map((v) => [
    v.lote,
    v.concepto,
    v.valor.replace(/\s/g, ' '),
  ]);
  assert.deepEqual(valores.slice(0, 2), [
    ['3', 'Importe total sin impuestos', '18.000,00 € (dieciocho mil euros)'],
    ['3', 'Impuesto', 'IVA 21 % (tipo general: confírmalo en el pliego)'],
  ]);
  assert.deepEqual(
    valores.find((v) => v[1] === 'Total con IVA'),
    ['3', 'Total con IVA', '21.780,00 € (veintiún mil setecientos ochenta euros)'],
  );
  assert.deepEqual(
    valores.at(-1),
    [null, 'Herramienta de control remoto del aula', 'Sí'],
    'un criterio común: sin lote',
  );
  const r = (await generarPaquete(c(), 'p-casoC-10', AHORA)).data!;
  assert.match(
    fs.readFileSync(path.join(enDisco(r.ruta), 'VALORES_A_TECLEAR.md'), 'utf8'),
    /## Lote 3\n\n- \*\*Importe total sin impuestos\*\*: 18\.000,00 € \(dieciocho mil euros\)/,
  );
});

test('should_list_the_current_package_without_amounts_for_agents', async () => {
  await casoC('p-casoC-11');
  const antes = (await paqueteParaAgente(db, raicesActuales(), 'p-casoC-11')).data as { vigente: null; nota: string };
  assert.equal(antes.vigente, null);
  await generarPaquete(c(), 'p-casoC-11', AHORA);
  const r = (await paqueteParaAgente(db, raicesActuales(), 'p-casoC-11')).data as {
    vigente: { manifiesto: { valores: { valor: string; economico: boolean }[] } };
    instrucciones: string;
  };
  const json = JSON.stringify(r);
  assert.doesNotMatch(json, /18\.000|dieciocho|21\.780/, 'ningún importe');
  assert.ok(
    r.vigente.manifiesto.valores.filter((v) => v.economico).every((v) => v.valor === 'ver VALORES_A_TECLEAR.md'),
  );
  assert.match(r.instrucciones, /## 3\. Carpetas, en orden/);
});

test('should_recompute_checks_without_writing_on_get', async () => {
  await casoC('p-casoC-12', await docx([...MEMORIA_BUENA, 'Con RustDesk.']));
  const r = (await estadoPaquete(db, raicesActuales(), 'p-casoC-12', AHORA)).data!;
  assert.equal(r.vigente, null);
  assert.deepEqual(
    tipos(r.comprobaciones).filter((x) => x.startsWith('bloquea')),
    ['bloquea:fuga'],
  );
  assert.ok(
    !fs
      .readdirSync(path.join(salidas, 'Licitaciones'))
      .some((n) => n.includes('p-casoC-12') && fs.existsSync(path.join(salidas, 'Licitaciones', n, 'PRESENTACION'))),
    'nada escrito',
  );
  assert.equal(
    (
      db.prepare("SELECT COUNT(*) AS n FROM paquetes_presentacion WHERE licitacion_id = 'p-casoC-12'").get() as {
        n: number;
      }
    ).n,
    0,
  );
});

test('should_ask_for_the_package_in_today_when_it_is_missing_or_outdated', async () => {
  // El caso no tiene ficha ni perfil completo: las comprobaciones tienen filas abiertas, y el paquete sin
  // hacer solo se pide cuando no queda nada más; uno desfasado se dice siempre.
  const paquete = () => faltaDePreparacion(db, 'p-casoC-13').filter((f) => f.startsWith('Paquete'));
  await casoC('p-casoC-13');
  assert.deepEqual(paquete(), []);
  await generarPaquete(c(), 'p-casoC-13', AHORA);
  assert.deepEqual(paquete(), []);
  db.prepare(
    "UPDATE decisiones_oferta SET actualizada_en = '2999-01-01T00:00:00.000Z' WHERE licitacion_id = 'p-casoC-13'",
  ).run();
  assert.deepEqual(paquete(), ['Paquete: la v1 está desfasada; vuelve a prepararlo']);
});

const conocimiento = path.join(tmp, 'conocimiento');
// El caso de Villaejemplo no trae ficha ni representante: las comprobaciones lo frenan con filas «impide».
// Aquí se prueba la copia del paquete, no esa guardia (la cubre propuestas.test.ts).
const FORZAR = 'Prueba de la copia del paquete presentado';

// La carpeta de lo presentado ya creada en el disco (la crea presentadas.ts; aquí, a mano).
function carpetaPresentadaLista(id: string): string {
  const ruta = `Presentadas/2026-10 - ${id}`;
  fs.mkdirSync(path.join(conocimiento, ...ruta.split('/'), 'PLIEGOS'), { recursive: true });
  db.prepare("UPDATE carpetas_presentadas SET estado = 'hecha', ruta = ? WHERE licitacion_id = ?").run(ruta, id);
  return ruta;
}

test('should_prefill_one_registration_per_lot_from_the_current_package', async () => {
  await casoC('p-casoC-14');
  await generarPaquete(c(), 'p-casoC-14', AHORA);
  const e = (await estadoPaquete(db, raicesActuales(), 'p-casoC-14', AHORA)).data!;
  assert.deepEqual(e.registro, [
    { lote: '3', importe_ofertado: 18_000, presupuesto: 20_000, unidad: null, precio_unitario: null },
  ]);
  const r = registrarPropuesta(
    db,
    'p-casoC-14',
    NuevaPropuesta.parse({
      ...e.registro[0],
      unidad: undefined,
      precio_unitario: undefined,
      paquete_version: e.vigente!.version,
      forzar_motivo: FORZAR,
    }),
  );
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    [r.data!.lote, r.data!.importe_ofertado, r.data!.baja_ofertada, r.data!.paquete_version],
    ['3', 18_000, 0.1, 1],
  );
  assert.equal(paqueteVigente(db, 'p-casoC-14')?.copia?.estado, 'pendiente', 'la copia queda pedida');
  assert.deepEqual(
    (await estadoPaquete(db, raicesActuales(), 'p-casoC-14', AHORA)).data!.registro,
    [],
    'el lote ya registrado no se vuelve a ofrecer',
  );
});

test('should_compute_the_discount_from_the_unit_price_when_registering_a_unit_price_offer', async () => {
  await casoC('p-casoC-15');
  const r = registrarPropuesta(
    db,
    'p-casoC-15',
    NuevaPropuesta.parse({
      lote: '3',
      importe_ofertado: null,
      precio_unitario: 1_375.5,
      unidad: 'informe',
      presupuesto: 1_513.05,
    }),
  );
  assert.equal(r.error, null, r.error?.message);
  assert.deepEqual(
    [r.data!.precio_unitario, r.data!.unidad, r.data!.baja_ofertada],
    [1_375.5, 'informe', 0.0909],
    'CASO_F: sobre los 1.513,05 € por informe, no sobre el total',
  );
  assert.equal(
    NuevaPropuesta.safeParse({ lote: '3', precio_unitario: 1_500 }).success,
    false,
    'el precio unitario va con su unidad',
  );
});

test('should_copy_the_whole_package_version_including_signed_files_once_the_folder_is_ready', async () => {
  await casoC('p-casoC-16');
  const v = (await generarPaquete(c(), 'p-casoC-16', AHORA)).data!;
  assert.equal(
    registrarPropuesta(
      db,
      'p-casoC-16',
      NuevaPropuesta.parse({ lote: '3', importe_ofertado: 18_000, paquete_version: v.version, forzar_motivo: FORZAR }),
    ).error,
    null,
  );
  assert.equal(copiarPaquetesPresentados(db, conocimiento, salidas), 0, 'espera a que la carpeta esté en el disco');
  const firmado = path.join(
    enDisco(v.ruta),
    'Lote 3',
    '3 Sobre C - Criterios cuantificables',
    '01 Anexo V proposicion_firmado.pdf',
  );
  fs.writeFileSync(firmado, '%PDF-1.4 firmado');
  const carpeta = carpetaPresentadaLista('p-casoC-16');
  assert.equal(copiarPaquetesPresentados(db, conocimiento, salidas), 1);
  const copia = paqueteVigente(db, 'p-casoC-16')!.copia!;
  assert.deepEqual([copia.estado, copia.ruta], ['hecha', `${carpeta}/DOCUMENTACION PRESENTADA/v1 2026-10-14 1800`]);
  const destino = path.join(conocimiento, ...copia.ruta!.split('/'));
  assert.ok(
    fs.existsSync(
      path.join(destino, 'Lote 3', '3 Sobre C - Criterios cuantificables', '01 Anexo V proposicion_firmado.pdf'),
    ),
  );
  const registro = JSON.parse(fs.readFileSync(path.join(destino, 'COPIA.json'), 'utf8')) as {
    fuera_del_manifiesto: string[];
    archivos: { ruta: string; sha256: string }[];
  };
  // Los textos del paquete (guía del DEUC, compromisos) van en «textos» del manifiesto: solo el firmado queda fuera.
  assert.deepEqual(registro.fuera_del_manifiesto, [
    'Lote 3/3 Sobre C - Criterios cuantificables/01 Anexo V proposicion_firmado.pdf',
  ]);
  assert.deepEqual(
    paqueteVigente(db, 'p-casoC-16')!.manifiesto.textos?.map((x) => x.archivo),
    v.manifiesto.textos.map((x) => x.archivo),
    'la API y la tool también los ven',
  );
  assert.equal(registro.archivos.length, 12, '6 documentos, 1 índice, 5 textos y el firmado');
  assert.equal(copiarPaquetesPresentados(db, conocimiento, salidas), 0, 'una vez');
});

test('should_not_overwrite_an_existing_copy_and_report_the_error', async () => {
  await casoC('p-casoC-17');
  const v = (await generarPaquete(c(), 'p-casoC-17', AHORA)).data!;
  assert.equal(
    registrarPropuesta(
      db,
      'p-casoC-17',
      NuevaPropuesta.parse({ lote: '3', importe_ofertado: 18_000, paquete_version: v.version, forzar_motivo: FORZAR }),
    ).error,
    null,
  );
  const carpeta = carpetaPresentadaLista('p-casoC-17');
  const destino = path.join(
    conocimiento,
    ...carpeta.split('/'),
    'DOCUMENTACION PRESENTADA',
    path.posix.basename(v.ruta),
  );
  fs.mkdirSync(destino, { recursive: true });
  fs.writeFileSync(path.join(destino, 'nota.txt'), 'subida a mano');
  copiarPaquetesPresentados(db, conocimiento, salidas);
  const copia = paqueteVigente(db, 'p-casoC-17')!.copia!;
  assert.equal(copia.estado, 'error');
  assert.match(copia.error ?? '', /Ya existe v1 2026-10-14 1800 en DOCUMENTACION PRESENTADA: no se pisa\./);
  assert.deepEqual(fs.readdirSync(destino), ['nota.txt'], 'lo que había sigue igual');
});

test('should_not_copy_the_package_to_a_null_folder_when_the_proposal_is_deleted_before_the_folder_exists', async () => {
  await casoC('p-casoC-18');
  const v = (await generarPaquete(c(), 'p-casoC-18', AHORA)).data!;
  const r = registrarPropuesta(
    db,
    'p-casoC-18',
    NuevaPropuesta.parse({ lote: '3', importe_ofertado: 18_000, paquete_version: v.version, forzar_motivo: FORZAR }),
  );
  assert.equal(r.error, null);
  assert.equal(borrarPropuesta(db, r.data!.id).error, null);
  assert.equal(paqueteVigente(db, 'p-casoC-18')?.copia, null, 'sin propuesta no hay copia pedida');
  db.prepare("UPDATE paquetes_presentacion SET copia_estado = 'pendiente' WHERE licitacion_id = 'p-casoC-18'").run();
  assert.equal(
    copiarPaquetesPresentados(db, conocimiento, salidas),
    0,
    'sin carpeta de lo presentado no hay dónde copiar',
  );
  assert.equal(fs.existsSync(path.join(conocimiento, 'null')), false);
  assert.equal(paqueteVigente(db, 'p-casoC-18')!.copia!.estado, 'pendiente');
});

test('should_retry_a_failed_copy_after_a_wait_and_leave_no_half_copy_behind', async () => {
  await casoC('p-casoC-19');
  const v = (await generarPaquete(c(), 'p-casoC-19', AHORA)).data!;
  assert.equal(
    registrarPropuesta(
      db,
      'p-casoC-19',
      NuevaPropuesta.parse({ lote: '3', importe_ofertado: 18_000, paquete_version: v.version, forzar_motivo: FORZAR }),
    ).error,
    null,
  );
  const carpeta = carpetaPresentadaLista('p-casoC-19');
  const destino = path.join(
    conocimiento,
    ...carpeta.split('/'),
    'DOCUMENTACION PRESENTADA',
    path.posix.basename(v.ruta),
  );
  const manifiestoBueno = (
    db.prepare('SELECT manifiesto FROM paquetes_presentacion WHERE licitacion_id = ?').get('p-casoC-19') as {
      manifiesto: string;
    }
  ).manifiesto;
  db.prepare('UPDATE paquetes_presentacion SET manifiesto = ? WHERE licitacion_id = ?').run(
    '{"carpetas":5}',
    'p-casoC-19',
  );
  const t0 = Date.now();
  assert.equal(copiarPaquetesPresentados(db, conocimiento, salidas, t0), 1);
  const estadoCopia = () =>
    (
      db.prepare('SELECT copia_estado AS e FROM paquetes_presentacion WHERE licitacion_id = ?').get('p-casoC-19') as {
        e: string;
      }
    ).e;
  assert.equal(estadoCopia(), 'error');
  assert.equal(fs.existsSync(destino), false, 'la copia a medias se borra');
  db.prepare('UPDATE paquetes_presentacion SET manifiesto = ? WHERE licitacion_id = ?').run(
    manifiestoBueno,
    'p-casoC-19',
  );
  assert.equal(copiarPaquetesPresentados(db, conocimiento, salidas, t0 + 60_000), 0, 'antes de la espera no reintenta');
  assert.ok(copiarPaquetesPresentados(db, conocimiento, salidas, t0 + 16 * 60_000) >= 1, 'pasada la espera reintenta');
  assert.equal(paqueteVigente(db, 'p-casoC-19')!.copia!.estado, 'hecha');
});

test('should_block_the_package_when_the_docx_was_edited_after_its_pdf_was_exported', async () => {
  await casoC('p-casoC-20');
  const anexo = documentosDe(db, 'p-casoC-20').documentos.find((d) => d.nombre === 'Anexo VII adscripcion de medios')!;
  const rutaDocx = escribir('p-casoC-20', 'Anexo VII.docx', await docx(['Anexo VII', 'Adscripción de medios']));
  const rutaPdf = escribir('p-casoC-20', 'Anexo VII.pdf', Buffer.from('%PDF-1.4 anexo VII antiguo'));
  assert.equal(cambiarDocumento(db, 'p-casoC-20', anexo.clave, { estado: 'preparado', ruta: rutaDocx }).error, null);
  db.prepare('UPDATE oferta_documentos SET ruta_pdf = ? WHERE licitacion_id = ? AND clave = ?').run(
    rutaPdf,
    'p-casoC-20',
    anexo.clave,
  );
  const plan = () => planDePaquete(db, 'p-casoC-20').data!;
  assert.deepEqual(
    tipos(await comprobacionesDelPaquete(db, raicesActuales(), plan(), AHORA)).filter((x) => x === 'bloquea:pdf'),
    [],
    'recién exportado: al día',
  );
  const tarde = new Date(Date.now() + 60_000);
  fs.utimesSync(enDisco(rutaDocx), tarde, tarde);
  const cs = (await comprobacionesDelPaquete(db, raicesActuales(), plan(), AHORA)).filter(
    (x) => x.tipo === 'pdf' && x.gravedad === 'bloquea',
  );
  assert.equal(cs.length, 1);
  assert.match(cs[0]!.mensaje, /PDF de «Anexo VII adscripcion de medios» es anterior a su \.docx/);
});

test('should_not_block_the_package_on_leaks_annulled_when_the_memory_was_accepted', async () => {
  await casoC(
    'p-casoC-21',
    await docx([...MEMORIA_BUENA, 'El aula se gestiona con RustDesk para dar soporte a cada alumna.']),
  );
  const bloqueos = async () =>
    tipos(await comprobacionesDelPaquete(db, raicesActuales(), planDePaquete(db, 'p-casoC-21').data!, AHORA)).filter(
      (x) => x.endsWith(':fuga'),
    );
  assert.deepEqual(await bloqueos(), ['bloquea:fuga']);
  const memoria = db.prepare("SELECT id FROM memorias WHERE licitacion_id = 'p-casoC-21'").get() as { id: number };
  db.prepare("UPDATE borradores SET memoria_id = ? WHERE licitacion_id = 'p-casoC-21'").run(memoria.id);
  const anulacion = {
    motivo: 'RustDesk es el nombre de un producto del propio centro, no lo ofertado',
    en: AHORA,
    fugas: [
      {
        apartado: 1,
        tipo: 'marca',
        marca: 'RustDesk',
        criterio: 'Herramienta de control remoto del aula',
        cita: 'RustDesk',
      },
    ],
  };
  db.prepare('UPDATE memorias SET anulacion_fugas = ? WHERE id = ?').run(JSON.stringify(anulacion), memoria.id);
  assert.deepEqual(await bloqueos(), ['aviso:fuga'], 'queda como aviso con el motivo');
});

test('should_give_the_comprobaciones_verdict_with_the_package', async () => {
  await casoC('p-casoC-41');
  const antes = (await paqueteParaAgente(db, raicesActuales(), 'p-casoC-41')).data as {
    veredicto: { tipo: string; texto: string };
  };
  assert.ok(antes.veredicto.tipo && antes.veredicto.texto, 'también sin paquete');
  await generarPaquete(c(), 'p-casoC-41', AHORA);
  const r = (await paqueteParaAgente(db, raicesActuales(), 'p-casoC-41')).data as {
    veredicto: { tipo: string; texto: string };
  };
  assert.equal(r.veredicto.tipo, comprobacionesDe(db, nucleo().db, 'p-casoC-41').data!.veredicto.tipo);
  assert.doesNotMatch(JSON.stringify(r.veredicto), /\d\.\d{3},\d{2}/, 'sin importes');
});

test('should_count_blockers_and_warnings_per_lot', () => {
  const cs = [
    { tipo: 'fuga', gravedad: 'bloquea', mensaje: 'a', donde: 'Lote 3/Sobre B/x.pdf' },
    { tipo: 'pdf', gravedad: 'aviso', mensaje: 'b', donde: 'Lote 3/Sobre B/y.docx' },
    { tipo: 'precio', gravedad: 'bloquea', mensaje: 'c', donde: 'decisiones' },
    { tipo: 'plazo', gravedad: 'bloquea', mensaje: 'd', donde: null },
    { tipo: 'pdf', gravedad: 'aviso', mensaje: 'e', donde: 'Comun/Sobre A' },
  ] as Parameters<typeof conteoPorLote>[0];
  assert.deepEqual(conteoPorLote(cs), { '3': { bloquea: 1, avisos: 1 }, comun: { bloquea: 2, avisos: 1 } });
  assert.deepEqual(conteoPorLote([]), {});
});

// ── Kit de firma: INSTRUCCIONES con «Comprobado», compromisos y guía del DEUC ──

const leer = (ruta: string, archivo: string) => fs.readFileSync(path.join(enDisco(ruta), archivo), 'utf8');

// Un apartado de la memoria con sus compromisos, como lo guarda la redacción.
function conCompromisos(id: string, compromisos: { que: string; quien: string; cuando_o_medida: string }[]): void {
  const m = db.prepare('SELECT id FROM memorias WHERE licitacion_id = ?').get(id) as { id: number };
  const datos = {
    titulo: 'Metodología y planificación',
    bloques: [{ parrafos: MEMORIA_BUENA }],
    cubre: [],
    compromisos,
  };
  db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos) VALUES (?, 1, 'recibido', ?)").run(
    m.id,
    JSON.stringify(datos),
  );
}

test('should_say_sign_all_files_at_once_in_instructions', async () => {
  await casoC('p-casoC-42');
  const r = (await generarPaquete(c(), 'p-casoC-42', AHORA)).data!;
  const texto = leer(r.ruta, 'INSTRUCCIONES.md');
  assert.match(
    texto,
    /## 3\. Carpetas, en orden\n\nFirma todos los archivos de una vez con AutoFirma \(Firma por lotes: selecciona la carpeta\) y súbelos en este orden:/,
  );
  assert.doesNotMatch(texto, /Firma cada PDF/, 'una sola vez, no por carpeta');
});

test('should_list_checked_items_in_a_comprobado_block', async () => {
  await casoC('p-casoC-43');
  const r = (await generarPaquete(c(), 'p-casoC-43', AHORA)).data!;
  const texto = leer(r.ruta, 'INSTRUCCIONES.md');
  const comprobado = texto.split('## Comprobado\n\n')[1]?.split('\n\n')[0] ?? '';
  assert.match(comprobado, /^- 0 fugas contra 1 criterio$/m);
  assert.match(comprobado, /^- 0 huecos sin rellenar$/m);
  assert.match(comprobado, /^- Firma en blanco en 6 archivos$/m);
  assert.match(texto, /## No comprobado\n\n- La veracidad de las declaraciones/);
});

test('should_not_say_zero_leaks_when_the_memory_leaks', async () => {
  await casoC('p-casoC-44', await docx([...MEMORIA_BUENA, 'El aula se gestiona con RustDesk.']));
  const r = (await generarPaquete(c(), 'p-casoC-44', AHORA)).data!;
  assert.doesNotMatch(leer(r.ruta, 'INSTRUCCIONES.md'), /0 fugas contra/);
});

test('should_write_commitments_and_deuc_guide_in_the_package_folder_without_overwriting', async () => {
  await casoC('p-casoC-45');
  conCompromisos('p-casoC-45', [
    { que: 'Revisión semanal del avance', quien: 'Coordinación', cuando_o_medida: 'cada lunes' },
  ]);
  const r = (await generarPaquete(c(), 'p-casoC-45', AHORA)).data!;
  const hoja = leer(r.ruta, 'memoria-v1-compromisos.md');
  assert.match(hoja, /^# Compromisos de la memoria v1/);
  assert.match(hoja, /## Lote 3\n\n- \*\*Revisión semanal del avance\*\*: cada lunes · Coordinación \(apartado 1\)/);
  assert.match(leer(r.ruta, 'DEUC_GUIA.md'), /DEUC/);
  const otra = (await generarPaquete(c(), 'p-casoC-45', AHORA)).data!;
  assert.notEqual(otra.ruta, r.ruta, 'otra versión, otra carpeta');
  assert.equal(leer(r.ruta, 'memoria-v1-compromisos.md'), hoja, 'la anterior sigue intacta');
});

test('should_include_new_files_in_the_manifest', async () => {
  await casoC('p-casoC-46');
  const r = (await generarPaquete(c(), 'p-casoC-46', AHORA)).data!;
  const m = JSON.parse(leer(r.ruta, 'MANIFIESTO.json')) as {
    textos: { archivo: string; sha256: string; bytes: number }[];
  };
  assert.deepEqual(
    m.textos.map((x) => x.archivo),
    ['INSTRUCCIONES.md', 'VALORES_A_TECLEAR.md', 'memoria-v1-compromisos.md', 'DEUC_GUIA.md'],
  );
  for (const t of m.textos) {
    const bytes = fs.readFileSync(path.join(enDisco(r.ruta), t.archivo));
    assert.equal(t.sha256, crypto.createHash('sha256').update(bytes).digest('hex'), t.archivo);
    assert.equal(t.bytes, bytes.length);
  }
});

test('should_include_no_amount_in_commitments', async () => {
  await casoC('p-casoC-47');
  conCompromisos('p-casoC-47', [
    { que: 'Bolsa de horas de soporte por 1.500 €', quien: 'Soporte', cuando_o_medida: 'hasta 2.000,50 euros al año' },
  ]);
  const r = (await generarPaquete(c(), 'p-casoC-47', AHORA)).data!;
  const hoja = leer(r.ruta, 'memoria-v1-compromisos.md');
  assert.match(hoja, /Bolsa de horas de soporte/);
  assert.doesNotMatch(hoja, /1\.500|2\.000|18\.000|€|euros/, 'ningún importe');
});

// Una versión nueva montada y sin revisar: no es la memoria que se sube.
function conMejoraSinRevisar(id: string): void {
  const ts = new Date().toISOString();
  const ruta = escribir(id, 'memoria-v2.docx', Buffer.from('v2'));
  const borrador = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, version)
    VALUES (?, ?, 'h2', 10, 'plataforma', ?, 'pendiente', 'ensamblado', 2)`,
      )
      .run(id, ruta, ts).lastInsertRowid,
  );
  const m = db
    .prepare(
      "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, borrador_id) VALUES (?, ?, 2, 'ensamblada', ?, ?)",
    )
    .run(id, guionVigente(db, id)!.id, ts, borrador).lastInsertRowid;
  db.prepare('UPDATE borradores SET memoria_id = ? WHERE id = ?').run(m, borrador);
}

test('should_write_the_commitments_of_the_accepted_memory_not_of_a_newer_unreviewed_one', async () => {
  // Arrange
  await casoC('p-casoC-48');
  conMejoraSinRevisar('p-casoC-48');

  // Act
  const r = (await generarPaquete(c(), 'p-casoC-48', AHORA)).data!;

  // Assert
  const archivos = r.manifiesto.textos.map((x) => x.archivo);
  assert.ok(archivos.includes('memoria-v1-compromisos.md'), 'la v1 aceptada es la que se sube');
  assert.ok(!archivos.includes('memoria-v2-compromisos.md'));
});

test('should_write_no_commitments_sheet_without_an_accepted_memory', async () => {
  // Arrange
  await casoC('p-casoC-49');
  db.prepare("UPDATE borradores SET estado = 'pendiente' WHERE licitacion_id = ?").run('p-casoC-49');

  // Act
  const r = (await generarPaquete(c(), 'p-casoC-49', AHORA)).data!;

  // Assert
  assert.equal(
    r.manifiesto.textos.some((x) => /compromisos/.test(x.archivo)),
    false,
  );
});

test('should_leave_out_empty_check_blocks_and_count_a_single_file', () => {
  const lineas = textoInstrucciones({
    licitacion: { expediente: 'E', titulo: 'T', organo: 'O' },
    version: 1,
    plazo: null,
    canal: null,
    carpetas: [],
    comprobaciones: [],
    comprobado: [],
    no_comprobado: [],
  });
  assert.doesNotMatch(lineas, /## Comprobado|## No comprobado/, 'sin nada que decir, sin bloque');
  assert.deepEqual(
    comprobadoDelPaquete([{ tipo: 'huecos', gravedad: 'bloquea', mensaje: 'h', donde: null }], {
      criterios: 0,
      archivos: 1,
    }),
    ['Firma en blanco en 1 archivo'],
  );
});
