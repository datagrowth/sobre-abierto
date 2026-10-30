// Paquete regenerado por código sobre las ofertas de fixtures/comprobaciones/ (seudonimizadas): solo
// rehace un paquete que ya existía y quedó desfasado, no si la oferta está frenada o tiene un
// «impide» abierto de otra causa, y como mucho una vez cada 10 minutos. Salidas temporales.
// La base es CASO_D (lote 2) con domicilio y precio puestos: sin ningún «impide» abierto.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oferta-paquete-auto-'));
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
const { generarPaquete, paqueteVigente } = await import('../../src/dominios/licitaciones/oferta/paquete.js');
const { regenerarPaquetesAuto } = await import('../../src/dominios/licitaciones/oferta/paqueteAuto.js');
const { guardarPerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { frenoDeElegibilidad } = await import('../../src/dominios/licitaciones/oferta/frenoElegibilidad.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
const db = dbLicitaciones();
const CASO_D = leerFixtureComprobaciones('casoD');
const CASO_E = leerFixtureComprobaciones('casoE');
const AHORA = Date.parse(CASO_D.ahora);
const MINUTO = 60_000;
const DOMICILIO = 'Calle Ejemplo 7, 38001 Puerto de Ejemplo';
const c = () => ({ db, dbNucleo: nucleo().db, raices: raicesActuales() });

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function vaciar(): void {
  db.pragma('foreign_keys = OFF');
  const tablas = db
    .prepare(
      "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB 'busca_texto_*'",
    )
    .all() as { name: string }[];
  for (const { name } of tablas) db.prepare(`DELETE FROM main."${name}"`).run();
  db.pragma('foreign_keys = ON');
  for (const t of ['trabajos_ia', 'personas']) nucleo().db.prepare(`DELETE FROM ${t}`).run();
}

beforeEach(vaciar);

// CASO_D con domicilio y el precio del lote 2: las comprobaciones no tienen ningún «impide».
function sembrar(): string {
  const ofertas = [{ lote: '2', pendiente: false, importe: null, unitarios: [{ concepto: 'alumno', precio: 30 }] }];
  const perfil = { ...CASO_D.perfil, domicilio: DOMICILIO };
  sembrarFixture(db, nucleo().db, {
    ...CASO_D,
    perfil,
    decisiones: CASO_D.decisiones && { ...CASO_D.decisiones, datos: { ...CASO_D.decisiones.datos, ofertas } },
  });
  return CASO_D.id;
}

// CASO_E sin el ENS en el perfil: el freno de elegibilidad la detiene.
function sembrarFrenada(): string {
  sembrarFixture(db, nucleo().db, { ...CASO_E, perfil: { ...CASO_E.perfil, domicilio: DOMICILIO, certificados: [] } });
  return CASO_E.id;
}

// Un paquete v1 hecho en `ahora` y una checklist cambiada después: desfasado.
async function conPaqueteDesfasado(id: string, ahora: number): Promise<void> {
  const r = await generarPaquete(c(), id, ahora);
  assert.equal(r.error, null, r.error?.message);
  db.prepare('UPDATE oferta_documentos SET actualizado_en = ? WHERE licitacion_id = ?').run(
    new Date(ahora + 1_000).toISOString(),
    id,
  );
  assert.equal(paqueteVigente(db, id)?.desfasado, true);
}

const versiones = (id: string) =>
  (db.prepare('SELECT COUNT(*) AS n FROM paquetes_presentacion WHERE licitacion_id = ?').get(id) as { n: number }).n;

test('should_regenerate_an_outdated_package_by_code_when_nothing_blocks', async () => {
  const id = sembrar();
  await conPaqueteDesfasado(id, AHORA);
  assert.equal(frenoDeElegibilidad(db, nucleo().db, id, AHORA + 11 * MINUTO).frenada, false);

  const n = await regenerarPaquetesAuto(c(), AHORA + 11 * MINUTO);

  assert.equal(n, 1);
  assert.equal(versiones(id), 2);
});

test('should_not_create_the_first_package_on_its_own', async () => {
  const id = sembrar();

  const n = await regenerarPaquetesAuto(c(), AHORA);

  assert.equal(n, 0);
  assert.equal(versiones(id), 0);
});

test('should_not_regenerate_while_a_blocking_row_is_open', async () => {
  const id = sembrar();
  await conPaqueteDesfasado(id, AHORA);
  // Sin domicilio las comprobaciones abren un «impide» de empresa, ajeno al paquete.
  assert.equal(guardarPerfilEmpresa(nucleo().db, { ...CASO_D.perfil, domicilio: null }).error, null);
  const abiertos = comprobacionesDe(db, nucleo().db, id, AHORA + 11 * MINUTO).data!.bloqueos.filter(
    (b) => b.gravedad === 'impide' && b.categoria !== 'firma',
  );
  assert.ok(abiertos.length > 0, 'precondición: hay un impide abierto');

  const n = await regenerarPaquetesAuto(c(), AHORA + 11 * MINUTO);

  assert.equal(n, 0);
  assert.equal(versiones(id), 1);
});

test('should_not_regenerate_more_than_once_every_ten_minutes', async () => {
  const id = sembrar();
  await conPaqueteDesfasado(id, AHORA);

  const pronto = await regenerarPaquetesAuto(c(), AHORA + 5 * MINUTO);
  assert.deepEqual([pronto, versiones(id)], [0, 1]);
  const despues = await regenerarPaquetesAuto(c(), AHORA + 11 * MINUTO);
  db.prepare('UPDATE oferta_documentos SET actualizado_en = ? WHERE licitacion_id = ?').run(
    new Date(AHORA + 12 * MINUTO).toISOString(),
    id,
  );
  const otra = await regenerarPaquetesAuto(c(), AHORA + 14 * MINUTO);

  assert.deepEqual([despues, otra, versiones(id)], [1, 0, 2]);
});

test('should_not_regenerate_a_package_of_a_braked_offer', async () => {
  const id = sembrarFrenada();
  await conPaqueteDesfasado(id, AHORA);
  assert.equal(frenoDeElegibilidad(db, nucleo().db, id, AHORA + 11 * MINUTO).frenada, true);

  const n = await regenerarPaquetesAuto(c(), AHORA + 11 * MINUTO);

  assert.equal(n, 0);
  assert.equal(versiones(id), 1);
});

test('should_wait_ten_minutes_after_a_failed_regeneration_too', async () => {
  const id = sembrar();
  await conPaqueteDesfasado(id, AHORA);
  const fallo = AHORA + 60 * MINUTO;

  const sinSalidas = await regenerarPaquetesAuto({ ...c(), raices: { ...raicesActuales(), salidas: null } }, fallo);
  const pronto = await regenerarPaquetesAuto(c(), fallo + 5 * MINUTO);
  const despues = await regenerarPaquetesAuto(c(), fallo + 11 * MINUTO);

  assert.deepEqual(
    [sinSalidas, pronto, despues, versiones(id)],
    [0, 0, 1, 2],
    'el reintento espera también tras un fallo',
  );
});
