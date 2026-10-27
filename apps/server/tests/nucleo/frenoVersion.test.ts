// Freno de la cola y versión del servidor: tres fallos seguidos frenan un tipo 6 h, pero al
// arrancar una versión nueva (otro código desplegado) solo cuentan los fallos posteriores; un
// reinicio sin cambio de versión mantiene el freno. Estado y Programado dicen qué se levantó.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freno-version-'));

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { estadoCola, resumenCola } = await import('../../src/nucleo/colaConsultas.js');
const { frenadoHasta, frenosLevantadosPorVersion } = await import('../../src/nucleo/colaFrenos.js');
const { registrarTipoTrabajo } = await import('../../src/nucleo/colaTipos.js');
const { anotarVersionServidor, huellaCodigo, huellaVersion } = await import('../../src/nucleo/versionServidor.js');

const abiertas: { close: () => void }[] = [];
const base = (nombre: string) => {
  const d = abrirNucleo(path.join(tmp, nombre));
  abiertas.push(d);
  return d;
};
after(() => {
  for (const d of abiertas) d.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const MIN = 60_000;
const hace = (min: number) => new Date(Date.now() - min * MIN).toISOString();
registrarTipoTrabajo('memoria_critica', { destino: () => null, instrucciones: () => 'nada', hecho: () => false });

function fallos(db: ReturnType<typeof abrirNucleo>, minutos: number[]): void {
  const insertar =
    db.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, intentos, creado_en, actualizado_en)
    VALUES ('memoria_critica', 'test', ?, '{}', 'fallido', 3, ?, ?)`);
  for (const m of minutos) insertar.run(`f-${m}-${Math.random()}`, hace(m), hace(m));
}

function carpetaDeCodigo(archivos: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmp, 'codigo-'));
  for (const [ruta, texto] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(dir, ruta)), { recursive: true });
    fs.writeFileSync(path.join(dir, ruta), texto);
  }
  return dir;
}

test('should_fingerprint_the_server_code_and_change_only_when_the_code_changes', () => {
  const a = carpetaDeCodigo({ 'index.js': 'uno', 'nucleo/trabajos.js': 'dos', 'leeme.txt': 'x' });
  const b = carpetaDeCodigo({ 'index.js': 'uno', 'nucleo/trabajos.js': 'dos', 'leeme.txt': 'otro texto' });
  const c = carpetaDeCodigo({ 'index.js': 'uno', 'nucleo/trabajos.js': 'dos arreglado' });
  assert.equal(huellaCodigo(a).data, huellaCodigo(b).data, 'lo que no es código no cuenta');
  assert.notEqual(huellaCodigo(a).data, huellaCodigo(c).data, 'un arreglo del servidor es otra versión');
  assert.equal(huellaCodigo(carpetaDeCodigo({ 'leeme.txt': 'x' })).error?.code, 'sin_codigo');
  assert.equal(huellaCodigo(path.join(tmp, 'no-existe')).error?.code, 'huella_ilegible');
  assert.notEqual(
    huellaVersion('abc', 'index-1.js'),
    huellaVersion('abc', 'index-2.js'),
    'un despliegue solo de la web también',
  );
});

test('should_keep_the_start_of_a_version_across_restarts_and_reset_it_on_a_new_one', () => {
  const db = base('versiones');
  const t0 = hace(60);
  assert.deepEqual(
    anotarVersionServidor(db, 'A', t0),
    { huella: 'A', desde: t0, nueva: true, anterior: null },
    'sin anterior: versión nueva',
  );
  assert.deepEqual(
    anotarVersionServidor(db, 'A', hace(10)),
    { huella: 'A', desde: t0, nueva: false, anterior: null },
    'reinicio sin despliegue',
  );
  const t1 = hace(5);
  assert.deepEqual(anotarVersionServidor(db, 'B', t1), { huella: 'B', desde: t1, nueva: true, anterior: 'A' });
});

test('should_lift_the_brake_when_a_new_version_starts_after_the_failures', () => {
  const db = base('levanta');
  anotarVersionServidor(db, 'vieja', hace(120));
  fallos(db, [30, 20, 10]);
  assert.ok(frenadoHasta(db, 'memoria_critica'), 'tres fallos de la versión vieja frenan');
  const desde = hace(1);
  anotarVersionServidor(db, 'arreglada', desde);
  assert.equal(frenadoHasta(db, 'memoria_critica'), null, 'el arreglo desplegado levanta el freno sin esperar 6 h');
  assert.deepEqual(frenosLevantadosPorVersion(db), { desde, tipos: ['memoria_critica'] });
  assert.deepEqual(
    resumenCola(db).levantados_por_version,
    { desde, tipos: ['memoria_critica'] },
    'Programado dice qué se levantó y desde cuándo',
  );
  assert.deepEqual(estadoCola(db).frenos_levantados_por_version, { desde, tipos: ['memoria_critica'] });
  assert.deepEqual(resumenCola(db).frenados, []);
});

test('should_keep_the_brake_after_a_restart_of_the_same_version', () => {
  const db = base('mismo-reinicio');
  anotarVersionServidor(db, 'actual', hace(120));
  fallos(db, [30, 20, 10]);
  assert.ok(frenadoHasta(db, 'memoria_critica'));
  anotarVersionServidor(db, 'actual', hace(1));
  assert.ok(frenadoHasta(db, 'memoria_critica'), 'mismo código: los fallos siguen diciendo algo');
  assert.equal(frenosLevantadosPorVersion(db), null);
});

test('should_brake_again_with_three_failures_of_the_new_version', () => {
  const db = base('vuelve-a-frenar');
  anotarVersionServidor(db, 'vieja', hace(240));
  fallos(db, [200, 190, 180]);
  anotarVersionServidor(db, 'nueva', hace(100));
  assert.equal(frenadoHasta(db, 'memoria_critica'), null);
  fallos(db, [30, 20]);
  assert.equal(frenadoHasta(db, 'memoria_critica'), null, 'dos fallos de la nueva no bastan');
  fallos(db, [10]);
  assert.ok(frenadoHasta(db, 'memoria_critica'), 'tres fallos de la nueva frenan: el arreglo no arregló');
  assert.equal(frenosLevantadosPorVersion(db), null, 'ya no hay nada levantado que contar');
});

test('should_consider_a_brake_overcome_only_when_its_last_failure_predates_the_new_version_start', async () => {
  const { frenoSuperadoPorArranque } = await import('../../src/nucleo/colaFrenos.js');
  assert.equal(frenoSuperadoPorArranque({ desde: 1_000, ultimoFallo: 2_000 }, 3_000), true);
  assert.equal(frenoSuperadoPorArranque({ desde: 1_000, ultimoFallo: 4_000 }, 3_000), false);
});

// Los frenos persistentes de la cola (cola_marcas): el de una oferta y el del tipo entero por fallos
// en varias ofertas siguen la misma regla que el de antes.
function fallosDe(db: ReturnType<typeof abrirNucleo>, recurso: string, minutos: number[]): void {
  const insertar =
    db.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, intentos, creado_en, actualizado_en)
    VALUES ('memoria_critica', 'test', ?, ?, 'fallido', 3, ?, ?)`);
  for (const m of minutos)
    insertar.run(`f-${recurso}-${m}-${Math.random()}`, JSON.stringify({ id: recurso }), hace(m), hace(m));
}

test('should_lift_a_per_offer_brake_when_a_new_version_starts_after_its_failures', () => {
  const db = base('oferta-levanta');
  anotarVersionServidor(db, 'vieja', hace(120));
  fallosDe(db, 'L-1', [30, 20, 10]);
  assert.ok(frenadoHasta(db, 'memoria_critica', Date.now(), 'L-1'), 'tres fallos de la oferta la frenan');
  assert.equal(frenadoHasta(db, 'memoria_critica'), null, 'una sola oferta no frena el tipo');
  const desde = hace(1);
  anotarVersionServidor(db, 'arreglada', desde);
  assert.equal(
    frenadoHasta(db, 'memoria_critica', Date.now(), 'L-1'),
    null,
    'el arreglo desplegado levanta el freno de la oferta',
  );
  assert.deepEqual(frenosLevantadosPorVersion(db), {
    desde,
    tipos: [],
    ofertas: [{ tipo: 'memoria_critica', recurso: 'L-1' }],
  });
  assert.deepEqual(resumenCola(db).frenados, []);
});

test('should_keep_a_per_offer_brake_after_a_restart_of_the_same_version_and_brake_again_with_new_failures', () => {
  const db = base('oferta-mismo-reinicio');
  anotarVersionServidor(db, 'actual', hace(240));
  fallosDe(db, 'L-2', [200, 190, 180]);
  anotarVersionServidor(db, 'actual', hace(100));
  assert.ok(frenadoHasta(db, 'memoria_critica', Date.now(), 'L-2'), 'mismo código: el freno de la oferta sigue');
  assert.equal(frenosLevantadosPorVersion(db), null);
  anotarVersionServidor(db, 'nueva', hace(90));
  fallosDe(db, 'L-2', [30, 20]);
  assert.equal(frenadoHasta(db, 'memoria_critica', Date.now(), 'L-2'), null, 'dos fallos de la nueva no bastan');
  fallosDe(db, 'L-2', [10]);
  assert.ok(
    frenadoHasta(db, 'memoria_critica', Date.now(), 'L-2'),
    'tres fallos de la nueva vuelven a frenar la oferta',
  );
  assert.deepEqual(
    resumenCola(db).frenados.map((f) => f.recurso),
    ['L-2'],
  );
});

test('should_lift_the_whole_type_brake_from_failures_in_several_offers_when_a_new_version_starts', () => {
  const db = base('tipo-varias-ofertas');
  anotarVersionServidor(db, 'vieja', hace(240));
  fallosDe(db, 'A', [60, 50]);
  fallosDe(db, 'B', [40, 30]);
  fallosDe(db, 'C', [20, 10]);
  assert.ok(frenadoHasta(db, 'memoria_critica'), 'seis fallos en tres ofertas frenan el tipo entero');
  const desde = hace(1);
  anotarVersionServidor(db, 'arreglada', desde);
  assert.equal(frenadoHasta(db, 'memoria_critica'), null);
  assert.deepEqual(frenosLevantadosPorVersion(db)?.tipos, ['memoria_critica']);
});
