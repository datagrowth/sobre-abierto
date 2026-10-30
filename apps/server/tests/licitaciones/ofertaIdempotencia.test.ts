// Lo que pide una persona es idempotente: un doble clic (dos peticiones casi a la vez) deja un
// solo trabajo; pedirlo de nuevo cuando el anterior terminó crea otro; y lo automático de la
// cadena (las lecciones de una versión subida) no levanta el freno de su tipo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CARPETA_PLIEGOS, FICHA_CASO_A, guionCon, ID, licitacionCasoA } from './fixtures/casoA.js';
import { modelosAnexos } from '../nucleo/fixtures/modelosAnexos.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-idem-'));
const salidas = path.join(tmp, 'salidas');
const conocimiento = path.join(tmp, 'conocimiento');
for (const d of [salidas, conocimiento]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { cerrarIndiceLectura } = await import('../../src/biblioteca/motor/documentos/servicioIndice.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { FichaEntrada, proponerFicha } = await import('../../src/dominios/licitaciones/ficha.js');
const { GuionEntrada, pedirGuion, proponerGuion, TIPO_GUION } =
  await import('../../src/dominios/licitaciones/oferta/guion.js');
const { pedirAnexo } = await import('../../src/dominios/licitaciones/oferta/anexosPedir.js');
const { TIPO_ANEXO } = await import('../../src/dominios/licitaciones/oferta/anexosTrabajo.js');
const { pedirLecciones, TIPO_LECCIONES } = await import('../../src/dominios/licitaciones/oferta/lecciones.js');
const { frenadoHasta } = await import('../../src/nucleo/colaFrenos.js');

iniciarNucleo();
const db = dbLicitaciones();
const MODELOS = await modelosAnexos();
const ANEXO_VII = 'a2-d1';

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  cerrarIndiceLectura();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function pliego(nombre: string, contenido: Buffer): void {
  const ruta = `${CARPETA_PLIEGOS}/${nombre}`;
  fs.mkdirSync(path.join(conocimiento, CARPETA_PLIEGOS), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, ruta), contenido);
  db.prepare(
    `INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'anexo', ?, 'descargado', ?, ?)`,
  ).run(ID, `https://contrataciondelestado.es/${encodeURIComponent(nombre)}`, nombre, ruta, new Date().toISOString());
}

const ts = new Date().toISOString();
guardarLicitacion(db, licitacionCasoA());
db.prepare(
  "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 79', ?, ?)",
).run(ID, ts, ts);
pliego('Anexos PCAP.docx', MODELOS);
assert.equal((await proponerFicha(db, FichaEntrada.parse({ ...FICHA_CASO_A, id: ID }), 'licitaciones')).error, null);
const guion = guionCon((g) => {
  (g.archivos[1]!.documentos[0] as { origen?: unknown }).origen = {
    modelo: 'Anexo VII',
    documento: 'Anexos PCAP.docx',
    pagina: 20,
  };
});
assert.equal((await proponerGuion(db, GuionEntrada.parse(guion), 'licitaciones')).error, null);

const filas = (tipo: string) =>
  nucleo().db.prepare('SELECT id, clave, estado FROM trabajos_ia WHERE tipo = ? ORDER BY id').all(tipo) as {
    id: number;
    clave: string;
    estado: string;
  }[];
const ctx = () => ({ db, dbNucleo: nucleo().db, raices: { salidas, conocimiento } });

test('should_enqueue_a_single_annex_job_when_two_requests_arrive_together', async () => {
  const [a, b] = await Promise.all([pedirAnexo(ctx(), ID, ANEXO_VII), pedirAnexo(ctx(), ID, ANEXO_VII)]);
  assert.equal(a.error, null, a.error?.message);
  assert.equal(b.error, null, b.error?.message);
  assert.equal(a.data!.trabajo, b.data!.trabajo);
  assert.equal(filas(TIPO_ANEXO).length, 1);
});

test('should_enqueue_a_new_guion_after_the_previous_one_completed', () => {
  const primero = pedirGuion(nucleo().db, db, ID);
  assert.equal(primero.error, null, primero.error?.message);
  assert.equal(
    pedirGuion(nucleo().db, db, ID).data!.trabajo,
    primero.data!.trabajo,
    'mientras está en curso, el mismo',
  );
  nucleo().db.prepare("UPDATE trabajos_ia SET estado = 'completado' WHERE id = ?").run(primero.data!.trabajo);
  const segundo = pedirGuion(nucleo().db, db, ID);
  assert.notEqual(segundo.data!.trabajo, primero.data!.trabajo);
  assert.deepEqual(
    filas(TIPO_GUION).map((f) => f.clave),
    [`guion-${ID}#1`, `guion-${ID}#2`],
  );
});

test('should_not_lift_the_brake_of_lessons_when_a_word_is_uploaded', () => {
  const ahora = new Date().toISOString();
  const insertar = nucleo().db
    .prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en)
    VALUES (?, 'licitaciones', ?, ?, 'fallido', ?, ?)`);
  for (const n of [1, 2, 3])
    insertar.run(TIPO_LECCIONES, `lecciones-previa-${n}`, JSON.stringify({ id: null }), ahora, ahora);
  assert.notEqual(frenadoHasta(nucleo().db, TIPO_LECCIONES), null, 'el tipo está frenado');
  pedirLecciones(nucleo().db, { id: 1, licitacion_id: ID, version: 1 }, null);
  assert.notEqual(frenadoHasta(nucleo().db, TIPO_LECCIONES), null, 'lo automático no quita el freno');
});
