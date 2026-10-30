// licitaciones_mesa sobre las 5 ofertas reales seudonimizadas del 14/10/2026
// (fixtures/comprobaciones): la herramienta da el mismo veredicto y el mismo primer bloqueo que las
// comprobaciones (y por tanto la Mesa web), por fecha límite para decidir, sin nombres ni importes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-mesa-'));
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
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { primerBloqueoAbierto } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
const { ConsultaMesa, mesaParaAgente, sanearTexto } =
  await import('../../src/dominios/licitaciones/oferta/toolsMesa.js');
const { OFERTAS_COMPROBACIONES, leerFixtureComprobaciones, sembrarFixture } =
  await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Todas a la hora de la captura; el perfil sin certificados, como en producción.
const AHORA = Date.parse('2026-10-14T20:34:57.000Z');
for (const o of OFERTAS_COMPROBACIONES) {
  const f = leerFixtureComprobaciones(o);
  nucleo().db.prepare('DELETE FROM personas').run();
  sembrarFixture(db, nucleo().db, { ...f, perfil: { ...f.perfil, certificados: [] } });
}

const consulta = (q: Record<string, unknown> = {}) => {
  const r = mesaParaAgente(db, nucleo().db, ConsultaMesa.parse(q), AHORA);
  assert.equal(r.error, null);
  return r.data!;
};

test('should_give_the_same_verdict_and_first_blocker_as_the_comprobaciones', () => {
  const m = consulta({ limite: 20 });

  assert.ok(m.ofertas.length >= 4, JSON.stringify(m.ofertas.map((o) => o.id)));
  for (const o of m.ofertas) {
    const c = comprobacionesDe(db, nucleo().db, o.id, AHORA).data!;
    const b = primerBloqueoAbierto(c.bloqueos);
    assert.deepEqual(o.veredicto, { tipo: c.veredicto.tipo, texto: c.veredicto.texto }, o.id);
    assert.equal(o.primer_bloqueo?.clave ?? null, b?.clave ?? null, o.id);
    assert.equal(o.primer_bloqueo?.categoria ?? null, b?.categoria ?? null, o.id);
    assert.equal(o.limite_decidir, c.limite_decidir, o.id);
  }
});

test('should_order_by_decision_deadline', () => {
  const limites = consulta({ limite: 20 }).ofertas.map((o) =>
    o.limite_decidir ? Date.parse(o.limite_decidir) : Number.POSITIVE_INFINITY,
  );

  assert.deepEqual(
    limites,
    [...limites].sort((a, b) => a - b),
  );
});

test('should_page_with_next_offset', () => {
  const todas = consulta({ limite: 20 });
  const primera = consulta({ limite: 2 });
  const segunda = consulta({ desde: primera.siguiente ?? 0, limite: 2 });

  assert.equal(primera.total, todas.total);
  assert.equal(primera.siguiente, 2);
  assert.deepEqual(
    [...primera.ofertas, ...segunda.ofertas].map((o) => o.id),
    todas.ofertas.slice(0, 4).map((o) => o.id),
  );
  assert.equal(consulta({ desde: todas.total - 1, limite: 5 }).siguiente, null);
});

test('should_reject_a_limit_over_20_or_unknown_keys', () => {
  assert.equal(ConsultaMesa.safeParse({ limite: 21 }).success, false);
  assert.equal(ConsultaMesa.safeParse({ otra: 1 }).success, false);
});

test('should_strip_team_names_from_blocker_titles', () => {
  const nombres = ['Ana García Pérez'];

  assert.equal(sanearTexto('Ana García Pérez debe firmar', nombres), 'una persona del equipo debe firmar');
  assert.equal(sanearTexto('Falta el rol de GARCÍA PÉREZ', nombres), 'Falta el rol de una persona del equipo');
  assert.equal(sanearTexto('Sin nombres', nombres), 'Sin nombres');
  assert.equal(sanearTexto('Sin nadie', []), 'Sin nadie');
});

test('should_include_no_amounts', () => {
  assert.equal(
    sanearTexto('Fija el precio: 72.500,50 € sin IVA y 1.000 euros', []),
    'Fija el precio: un importe sin IVA y un importe',
  );
  const texto = JSON.stringify(consulta({ limite: 20 }));
  assert.ok(!/€|\beuros?\b/i.test(texto), texto.match(/.{20}(€|euros?).{20}/i)?.[0]);
});

test('should_give_peninsular_text_for_the_decision_deadline_without_a_canary_profile', () => {
  const con = consulta({ limite: 20 }).ofertas.find((o) => o.limite_decidir);

  assert.ok(con);
  assert.match(con.limite_decidir_texto ?? '', /^el \d\d\/\d\d\/\d{4} a las \d\d:\d\d hora peninsular$/);
});
