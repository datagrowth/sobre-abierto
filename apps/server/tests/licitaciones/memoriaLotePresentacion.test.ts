// Memoria por lote III: con CASO_E (lotes 2 y 4, «una Memoria Técnica específica para
// cada lote» en un archivo electrónico único) cada lote revisa, descarta y presenta su propia memoria:
// la checklist lleva una fila por lote con la aceptada de su lote, el paquete y las comprobaciones dejan de
// bloquear cuando cada lote tiene la suya, y una subida dice de qué lote es. Villaejemplo (un lote) sigue
// con una memoria común. Fixtures de las comprobaciones (captura del 14/10/2026, seudonimizada).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-lote-presentacion-'));
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
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { descartarVersionesSinRevisar, revisarIa } =
  await import('../../src/dominios/licitaciones/propuestas/revision.js');
const { documentosDe, documentosDelGuion, sincronizarDocumentos } =
  await import('../../src/dominios/licitaciones/oferta/documentos.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { faltaMemoria } = await import('../../src/dominios/licitaciones/oferta/preparacion.js');
const { memoriaPorLoteDe, planDePaquete } = await import('../../src/dominios/licitaciones/oferta/paquete.js');
const { comprobarPaquete } = await import('../../src/dominios/licitaciones/oferta/paqueteComprobaciones.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { subirMemoria } = await import('../../src/dominios/licitaciones/oferta/subida.js');
const { generarDocx } = await import('../../src/nucleo/documentos/docx.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CASO_E = leerFixtureComprobaciones('casoE');
const CASO_C = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, CASO_E);
sembrarFixture(db, nucleo().db, CASO_C);
const AHORA = Date.parse(CASO_E.ahora);
const guion = () => guionVigente(db, CASO_E.id)!;

type Version = { memoria: number; borrador: number; version: number; ruta: string };

// Una versión ensamblada y sin revisar, como la deja el ensamblado (memoria + su borrador).
function versionEnsamblada(id: string, lote: string | null): Version {
  const ts = new Date().toISOString();
  const version =
    ((db.prepare('SELECT MAX(version) AS v FROM memorias WHERE licitacion_id = ?').get(id) as { v: number | null }).v ??
      0) + 1;
  const g = guionVigente(db, id)!;
  const memoria = Number(
    db
      .prepare(
        `INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, lote)
    VALUES (?, ?, ?, 'ensamblada', ?, ?, ?)`,
      )
      .run(id, g.id, version, ts, ts, lote).lastInsertRowid,
  );
  const ruta = `Salidas/Licitaciones/${id}/memoria-v${version}.docx`;
  const borrador = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en, origen, guion_id, version, memoria_id)
    VALUES (?, ?, 'x', 1, 'Memoria', 'licitaciones', ?, 'ensamblado', ?, ?, ?)`,
      )
      .run(id, ruta, ts, g.id, version, memoria).lastInsertRowid,
  );
  db.prepare('UPDATE memorias SET borrador_id = ? WHERE id = ?').run(borrador, memoria);
  return { memoria, borrador, version, ruta };
}

const aceptar = (v: Version) =>
  assert.equal(revisarIa(db, 'borradores', v.borrador, { decision: 'aceptar' }).error, null);
const estadoBorrador = (v: Version) =>
  (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(v.borrador) as { estado: string }).estado;
function filasMemoria(id: string): { clave: string; lote: string | null; estado: string; ruta: string | null }[] {
  sincronizarDocumentos(db, id, guionVigente(db, id)!);
  return documentosDe(db, id)
    .documentos.filter((d) => d.tipo === 'memoria')
    .map(({ clave, lote, estado, ruta }) => ({ clave, lote, estado, ruta }));
}
const comprobacionesMemoria = () => {
  const plan = planDePaquete(db, CASO_E.id).data!;
  return comprobarPaquete(plan.carpetas, {
    plazo: null,
    coherencia: [],
    memoria: [],
    precios: [],
    pendientes: [],
    lecturas: new Map(),
    fugas: () => [],
    importes: () => [],
    anuladas: null,
    memoria_por_lote: memoriaPorLoteDe(db, plan),
  })
    .filter((c) => c.tipo === 'memoria_por_lote')
    .map((c) => `${c.gravedad}:${c.mensaje}`);
};
const bloqueoMemoriaPorLote = () =>
  comprobacionesDe(db, nucleo().db, CASO_E.id, AHORA).data!.bloqueos.some((b) =>
    b.clave.startsWith('memoria_por_lote:'),
  );

const comun = versionEnsamblada(CASO_E.id, null);
const lote2a = versionEnsamblada(CASO_E.id, '2');
const lote4a = versionEnsamblada(CASO_E.id, '4');

test('should_split_the_memoria_row_per_lote_only_when_the_pliego_asks_one_per_lote', () => {
  // Act
  const casoE = documentosDelGuion(guion().datos, ['2', '4'])
    .filter((d) => d.doc.tipo === 'memoria')
    .map((d) => d.clave);
  const unLote = documentosDelGuion(guion().datos, ['2'])
    .filter((d) => d.doc.tipo === 'memoria')
    .map((d) => d.clave);

  // Assert
  assert.deepEqual(casoE, ['a1-d7-l2', 'a1-d7-l4']);
  assert.deepEqual(unLote, ['a1-d7'], 'con un solo lote, una memoria común');
});

test('should_list_the_memoria_of_each_lote_in_what_is_missing', () => {
  // Act
  const falta = faltaMemoria(db, CASO_E.id, guion());
  const casoC = faltaMemoria(db, CASO_C.id, guionVigente(db, CASO_C.id)!);

  // Assert
  assert.deepEqual(falta, [
    `Memoria técnica del lote 2: revisa la v${lote2a.version} y dala por buena`,
    `Memoria técnica del lote 4: revisa la v${lote4a.version} y dala por buena`,
  ]);
  assert.equal(casoC.length, 1);
  assert.match(casoC[0]!, /^Memoria técnica: /, 'Villaejemplo sigue con una línea común');
});

test('should_fall_back_to_common_memoria_when_lote_has_none', () => {
  // Arrange
  aceptar(comun);

  // Act
  const filas = filasMemoria(CASO_E.id);

  // Assert
  assert.deepEqual(
    filas.map((f) => [f.clave, f.estado, f.ruta]),
    [
      ['a1-d7-l2', 'preparado', comun.ruta],
      ['a1-d7-l4', 'preparado', comun.ruta],
    ],
  );
  assert.equal(estadoBorrador(lote2a), 'pendiente', 'aceptar la común no descarta las de los lotes');
  assert.equal(estadoBorrador(lote4a), 'pendiente');
});

test('should_still_block_when_the_same_memoria_goes_in_two_lotes', () => {
  // Act
  const paquete = comprobacionesMemoria();

  // Assert
  assert.deepEqual(paquete, [
    'bloquea:La misma memoria va en los lotes 2, 4 y el pliego pide una por lote: redáctalas en Memoria («Redactar las memorias, una por lote») o sube la de cada lote.',
  ]);
  assert.equal(bloqueoMemoriaPorLote(), true, 'las comprobaciones siguen bloqueando');
});

// Se crea en su prueba: lo de fuera de las pruebas corre antes que todas.
let lote2b: Version;

test('should_discard_only_versions_of_the_same_lote_when_accepting_a_memoria', () => {
  // Arrange
  lote2b = versionEnsamblada(CASO_E.id, '2');

  // Act
  aceptar(lote2b);

  // Assert
  assert.deepEqual(
    [estadoBorrador(lote2a), estadoBorrador(lote4a), estadoBorrador(comun)],
    ['descartada', 'pendiente', 'aceptada'],
  );
});

test('should_keep_blocking_when_one_lote_has_its_own_memoria_and_the_other_the_common_one', () => {
  // Act: la común (aceptada) ocupa la fila del lote 4, que aún no tiene la suya.
  const filas = filasMemoria(CASO_E.id);
  const paquete = comprobacionesMemoria();

  // Assert
  assert.deepEqual(
    filas.map((f) => [f.clave, f.ruta]),
    [
      ['a1-d7-l2', lote2b.ruta],
      ['a1-d7-l4', comun.ruta],
    ],
  );
  assert.equal(bloqueoMemoriaPorLote(), true, 'rutas distintas no bastan: el lote 4 lleva la común');
  assert.deepEqual(paquete, [
    'bloquea:La memoria común va en el lote 4 y el pliego pide una por lote: redáctalas en Memoria («Redactar las memorias, una por lote») o sube la de cada lote.',
  ]);
});

test('should_discard_unreviewed_versions_only_of_its_lote_when_a_new_one_arrives', () => {
  // Arrange
  const lote4b = versionEnsamblada(CASO_E.id, '4');

  // Act
  const descartadas = descartarVersionesSinRevisar(db, CASO_E.id, lote4b.borrador, lote4b.version);

  // Assert
  assert.deepEqual(descartadas, [lote4a.version]);
  assert.equal(estadoBorrador(lote2b), 'aceptada');
  aceptar(lote4b);
  assert.deepEqual(faltaMemoria(db, CASO_E.id, guion()), [], 'cada lote tiene la suya aceptada');
});

test('should_put_each_lote_memoria_in_its_own_checklist_row', () => {
  // Act
  const filas = filasMemoria(CASO_E.id);

  // Assert
  const ruta4 = (
    db
      .prepare(
        "SELECT b.ruta FROM borradores b JOIN memorias m ON m.id = b.memoria_id WHERE m.licitacion_id = ? AND m.lote = '4' AND b.estado = 'aceptada'",
      )
      .get(CASO_E.id) as { ruta: string }
  ).ruta;
  assert.deepEqual(
    filas.map((f) => [f.clave, f.estado, f.ruta]),
    [
      ['a1-d7-l2', 'preparado', lote2b.ruta],
      ['a1-d7-l4', 'preparado', ruta4],
    ],
  );
});

test('should_not_block_package_when_each_lote_has_its_own_memoria', () => {
  // Act
  const paquete = comprobacionesMemoria();

  // Assert
  assert.deepEqual(paquete, []);
});

test('should_clear_memoria_por_lote_rule_when_every_lote_has_an_accepted_memoria', () => {
  // Act
  const bloquea = bloqueoMemoriaPorLote();

  // Assert
  assert.equal(bloquea, false);
});

test('should_keep_a_single_common_memoria_row_for_casoC', () => {
  // Arrange
  const v = versionEnsamblada(CASO_C.id, null);
  aceptar(v);

  // Act
  const filas = filasMemoria(CASO_C.id);

  // Assert
  assert.ok(filas.length >= 1);
  assert.ok(
    filas.every((f) => f.lote === null && f.ruta === v.ruta && f.estado === 'preparado'),
    JSON.stringify(filas),
  );
});

async function wordDe(id: string): Promise<Buffer> {
  const titulos = guionVigente(db, id)!.datos.memoria!.apartados.map((a) => a.titulo);
  return generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'x',
      organo: 'Organismo',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '15 de octubre de 2026',
    },
    apartados: titulos.map((t, i) => ({
      numero: String(i + 1),
      titulo: t,
      bloques: [{ parrafos: ['Persona A coordina el servicio y revisa el calendario cada semana con el cliente.'] }],
    })),
    pie: { texto: '', numeracion: true },
  });
}
const subir = async (
  id: string,
  campos: Record<string, string>,
  datos: Buffer = Buffer.from('no es un word'),
  nombre = 'memoria.docx',
) => subirMemoria(db, id, { nombre, datos, campos }, raicesActuales());

test('should_ask_which_lote_an_uploaded_memoria_is_for', async () => {
  // Act
  const sinLote = await subir(CASO_E.id, {});
  const ajeno = await subir(CASO_E.id, { lote: '3' });
  const casoC = await subir(CASO_C.id, { lote: '3' });

  // Assert
  assert.deepEqual(sinLote.error, { code: 'invalid_input', message: 'Di de qué lote es esta memoria: 2 o 4.' });
  assert.equal(ajeno.error?.message, 'El lote «3» no es de esta oferta: las memorias son de los lotes 2, 4.');
  assert.match(casoC.error?.message ?? '', /^El pliego pide una sola memoria para toda la oferta: súbela sin lote/);
});

test('should_upload_a_memoria_as_a_version_of_its_lote', async () => {
  // Arrange
  const docx = await wordDe(CASO_E.id);

  // Act
  const r = await subir(CASO_E.id, { lote: '4' }, docx);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.lote, '4');
  const fila = db.prepare('SELECT lote FROM memorias WHERE id = ?').get(r.data!.memoria) as { lote: string | null };
  assert.equal(fila.lote, '4');
  assert.equal(estadoBorrador(lote2b), 'aceptada', 'la subida del lote 4 no toca la del lote 2');
});

test('should_deduce_the_lote_when_only_one_lote_has_a_version_pending_review', async () => {
  // Arrange: la web aún no manda «lote»; la subida anterior dejó pendiente la del lote 4.
  const docx = await wordDe(CASO_E.id);

  // Act
  const r = await subir(CASO_E.id, {}, docx);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.lote, '4');
});

test('should_deduce_the_lote_from_the_downloaded_version_in_the_file_name', async () => {
  // Arrange
  const docx = await wordDe(CASO_E.id);

  // Act
  const r = await subir(CASO_E.id, {}, docx, `memoria-v${lote2b.version} revisada.docx`);

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.lote, '2');
});

test('should_check_the_pages_of_each_lote_memoria_not_only_the_last_one', () => {
  // Arrange: límite de 30 páginas; la aceptada del lote 4 (no la última versión de la oferta) ocupa 64.
  const g = guion();
  db.prepare("UPDATE guiones SET datos = json_set(datos, '$.memoria.limite_paginas', 30) WHERE id = ?").run(g.id);
  const del4 = db
    .prepare(
      "SELECT b.id FROM borradores b JOIN memorias m ON m.id = b.memoria_id WHERE m.licitacion_id = ? AND m.lote = '4' AND b.estado = 'aceptada'",
    )
    .get(CASO_E.id) as { id: number };
  db.prepare('UPDATE borradores SET paginas = 64 WHERE id = ?').run(del4.id);
  db.prepare("UPDATE borradores SET paginas = 20 WHERE licitacion_id = ? AND id <> ? AND origen = 'ensamblado'").run(
    CASO_E.id,
    del4.id,
  );

  // Act
  const claves = comprobacionesDe(db, nucleo().db, CASO_E.id, AHORA)
    .data!.bloqueos.filter((b) => b.clave.startsWith('memoria_paginas'))
    .map((b) => [b.clave, b.lote]);
  db.prepare("UPDATE guiones SET datos = json_set(datos, '$.memoria.limite_paginas', NULL) WHERE id = ?").run(g.id);

  // Assert
  assert.deepEqual(claves, [['memoria_paginas-l4', '4']]);
});

test('should_store_a_whole_upload_as_a_version_of_its_lote_and_discard_only_that_lote', async () => {
  // Arrange: un Word hecho fuera, sin ningún título del guion (subidaFlexible.ts).
  const ajeno = await generarDocx({
    portada: {
      titulo: 'Memoria técnica',
      expediente: 'x',
      organo: 'Organismo',
      licitadora: { nombre: 'Analítica Ejemplo', nif: 'B12345678' },
      fecha: '16 de octubre de 2026',
    },
    apartados: [
      {
        numero: '1',
        titulo: 'Relación de documentos aportados',
        bloques: [{ parrafos: ['Persona A coordina el servicio del lote 4.'] }],
      },
    ],
    pie: { texto: '', numeracion: true },
  });
  const pendientes = (lote: string) =>
    (
      db
        .prepare(
          `SELECT m.version FROM borradores b JOIN memorias m ON m.id = b.memoria_id
    WHERE m.licitacion_id = ? AND m.lote = ? AND b.estado = 'pendiente' ORDER BY m.version`,
        )
        .all(CASO_E.id, lote) as { version: number }[]
    ).map((f) => f.version);
  const del4 = pendientes('4');
  const del2 = pendientes('2');

  // Act
  const r = await subir(CASO_E.id, { lote: '4' }, ajeno, 'memoria lote 4 hecha en local.docx');

  // Assert
  assert.equal(r.error, null, r.error?.message);
  const s = r.data as typeof r.data & { sin_repartir: boolean };
  assert.deepEqual([s.sin_repartir, s.lote, s.descartadas], [true, '4', del4]);
  const fila = db.prepare('SELECT lote, sin_repartir FROM memorias WHERE id = ?').get(s.memoria) as {
    lote: string | null;
    sin_repartir: number;
  };
  assert.deepEqual(fila, { lote: '4', sin_repartir: 1 });
  assert.deepEqual(pendientes('2'), del2, 'la del lote 2 sigue pendiente');
  const md = db.prepare('SELECT ruta_md FROM borradores WHERE id = ?').get(s.borrador) as { ruta_md: string };
  assert.match(
    fs.readFileSync(path.join(tmp, 'salidas', md.ruta_md.replace(/^Salidas\//, '')), 'utf8'),
    /^# Memoria técnica v\d+ · lote 4\n/,
  );
});
