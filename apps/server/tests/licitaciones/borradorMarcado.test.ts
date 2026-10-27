// El PATCH /borradores/:n de siempre no se salta «Dar por buena»: una memoria con
// párrafos marcados solo se acepta con motivo, que queda en el cierre de su tarjeta; la bandeja
// enseña quién la cerró y por qué. Sobre la memoria v3 de Villaejemplo del 14/10/2026
// (fixtures/comprobaciones/casoC.json, sintética) y una copia sin nada marcado.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { comoPersona, de } from '../helpers/persona.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'borrador-marcado-'));
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

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { tarjetasDe } = await import('../../src/dominios/licitaciones/oferta/revisionHermes.js');
const { MOTIVO_OBLIGATORIO } = await import('../../src/dominios/licitaciones/oferta/resumenMemoria.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type FixtureComprobaciones = import('../helpers/comprobacionesFixtures.js').FixtureComprobaciones;

iniciarNucleo();
const db = dbLicitaciones();
const casoC = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, casoC);

// Una copia de Villaejemplo con otro id y sin nada marcado (ni compromisos ni avisos).
const LIMPIA = 'p-vil-limpia';
const BLANDO =
  'La empresa impartirá los cursos con una metodología práctica, con guías de estudio y prácticas corregidas para cada participante.';
function limpia(id = LIMPIA, desplazamiento = 2000): FixtureComprobaciones {
  const f = leerFixtureComprobaciones('casoC');
  const g = (n: number) => n + desplazamiento;
  return {
    ...f,
    id,
    perfil: null,
    personas: [],
    ficha: f.ficha && { ...f.ficha, id: g(f.ficha.id) },
    guiones: f.guiones.map((x) => ({ ...x, id: g(x.id), ficha_id: x.ficha_id === null ? null : g(x.ficha_id) })),
    decisiones: f.decisiones && { ...f.decisiones, guion_id: g(f.decisiones.guion_id) },
    propuesta: f.propuesta && { ...f.propuesta, guion_id: g(f.propuesta.guion_id) },
    memorias: [f.memorias[0]!].map((m) => ({
      ...m,
      id: g(m.id),
      guion_id: g(m.guion_id),
      borrador_id: m.borrador_id === null ? null : g(m.borrador_id),
      apartados: m.apartados.map((a) => ({ ...a, compromisos: [], avisos: [], texto: BLANDO })),
    })),
  };
}
const copiaLimpia = limpia();
sembrarFixture(db, nucleo().db, copiaLimpia);
// Otra copia sin nada marcado, pero con el apartado 2 sin redactar.
const copiaSinApartado = limpia('p-vil-sin-apartado', 4000);
sembrarFixture(db, nucleo().db, copiaSinApartado);
db.prepare('DELETE FROM memoria_apartados WHERE memoria_id = ? AND apartado = 2').run(copiaSinApartado.memorias[0]!.id);
// Y otra cuyo guion ya no tiene la sección de la memoria: su resumen no se puede calcular.
const copiaSinGuion = limpia('p-vil-sin-guion', 6000);
sembrarFixture(db, nucleo().db, copiaSinGuion);
for (const g of copiaSinGuion.guiones) {
  const datos = JSON.parse(
    (db.prepare('SELECT datos FROM guiones WHERE id = ?').get(g.id) as { datos: string }).datos,
  ) as Record<string, unknown>;
  delete datos['memoria'];
  db.prepare('UPDATE guiones SET datos = ? WHERE id = ?').run(JSON.stringify(datos), g.id);
}

let server: http.Server;
let base = '';

before(() => {
  const app = express();
  app.use(express.json());
  app.use(comoPersona);
  app.use('/api/licitaciones', rutasLicitaciones());
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function patch(
  borrador: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${base}/api/licitaciones/borradores/${borrador}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

const estadoBorrador = (id: number) =>
  (db.prepare('SELECT estado FROM borradores WHERE id = ?').get(id) as { estado: string }).estado;

test('should_reject_accepting_a_marked_memoria_by_patch_without_reason', async () => {
  // Arrange
  const borrador = casoC.memorias[0]!.borrador_id!;

  // Act
  const r = await patch(borrador, { decision: 'aceptar' });

  // Assert
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.ok(String(r.json['message']).startsWith(MOTIVO_OBLIGATORIO), String(r.json['message']));
  assert.match(String(r.json['message']), /párrafos? marcados?/);
  assert.equal(estadoBorrador(borrador), 'pendiente');
});

test('should_reject_a_too_short_reason_by_patch', async () => {
  const r = await patch(casoC.memorias[0]!.borrador_id!, { decision: 'aceptar', motivo: 'ok' });

  assert.equal(r.status, 400);
});

test('should_accept_a_marked_memoria_by_patch_with_reason_and_close_its_card_with_it', async () => {
  // Arrange
  const borrador = casoC.memorias[0]!.borrador_id!;
  const MOTIVO = 'El calendario arranca en la semana 1, dentro de los 15 días.';

  // Act
  const r = await patch(borrador, { decision: 'aceptar', motivo: MOTIVO }, de('Persona A'));

  // Assert
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json, { id: borrador, estado: 'aceptada' });
  assert.equal(estadoBorrador(borrador), 'aceptada');
  const tarjeta = tarjetasDe(db, casoC.id, 'web').find((t) => t.clave === 'memoria:v3');
  assert.equal(tarjeta, undefined, 'dada por buena, la memoria ya no está en la bandeja');
  const cierre = db
    .prepare("SELECT estado, quien, motivo FROM revision_tarjetas WHERE licitacion_id = ? AND clave = 'memoria:v3'")
    .get(casoC.id);
  assert.deepEqual({ ...(cierre as object) }, { estado: 'aceptada', quien: 'Persona A', motivo: MOTIVO });
});

test('should_accept_an_unmarked_memoria_by_patch_without_reason', async () => {
  // Arrange
  const borrador = copiaLimpia.memorias[0]!.borrador_id!;

  // Act
  const r = await patch(borrador, { decision: 'aceptar' });

  // Assert
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(estadoBorrador(borrador), 'aceptada');
});

test('should_reject_accept_without_motivo_when_summary_fails', async () => {
  // Arrange
  const borrador = copiaSinGuion.memorias[0]!.borrador_id!;

  // Act
  const r = await patch(borrador, { decision: 'aceptar' });

  // Assert
  assert.ok(r.status >= 400, JSON.stringify(r.json));
  assert.equal(estadoBorrador(borrador), 'pendiente', 'sin resumen no se da por buena por el atajo');
});

test('should_ask_for_a_reason_by_patch_when_an_apartado_is_not_written', async () => {
  // Arrange
  const borrador = copiaSinApartado.memorias[0]!.borrador_id!;

  // Act
  const sin = await patch(borrador, { decision: 'aceptar' });

  // Assert
  assert.equal(sin.status, 400, JSON.stringify(sin.json));
  assert.equal(sin.json['message'], `${MOTIVO_OBLIGATORIO} (queda 1 apartado sin redactar).`);
  assert.equal(estadoBorrador(borrador), 'pendiente');
});

test('should_show_who_closed_a_card_why_and_when_in_the_tray', () => {
  // Arrange: la propuesta de decisiones de Villaejemplo, descartada desde la bandeja.
  const propuesta = tarjetasDe(db, casoC.id, 'web').find((t) => t.tipo === 'propuesta');
  assert.ok(propuesta, 'Villaejemplo trae propuesta de decisiones');
  assert.equal(propuesta.cierre, null);
  db.prepare(
    `INSERT OR REPLACE INTO revision_tarjetas (licitacion_id, clave, tipo, huella, estado, quien, motivo, creada_en, cerrada_en)
    VALUES (?, ?, 'propuesta', ?, 'descartada', 'Persona B', 'El equipo ya está decidido con Elisa', ?, '2026-10-14T12:00:00Z')`,
  ).run(casoC.id, propuesta.clave, propuesta.huella, propuesta.creada_en);

  // Act
  const t = tarjetasDe(db, casoC.id, 'web').find((x) => x.clave === propuesta.clave)!;

  // Assert
  assert.equal(t.estado, 'descartada');
  assert.deepEqual(t.cierre, {
    quien: 'Persona B',
    motivo: 'El equipo ya está decidido con Elisa',
    en: '2026-10-14T12:00:00Z',
  });
});

test('should_hide_an_old_closure_when_the_card_changed_since', () => {
  // Arrange: un cierre con otra huella (la propuesta cambió después de descartarla).
  const propuesta = tarjetasDe(db, casoC.id, 'web').find((t) => t.tipo === 'propuesta')!;
  db.prepare('UPDATE revision_tarjetas SET huella = ? WHERE licitacion_id = ? AND clave = ?').run(
    'otra',
    casoC.id,
    propuesta.clave,
  );

  // Act
  const t = tarjetasDe(db, casoC.id, 'web').find((x) => x.clave === propuesta.clave)!;

  // Assert
  assert.deepEqual([t.estado, t.cierre], ['pendiente', null]);
});
