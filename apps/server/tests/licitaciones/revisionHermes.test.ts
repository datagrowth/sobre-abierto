// Bandeja «Revisar lo que hizo Hermes» sobre las ofertas reales de CASO_E y Villaejemplo del
// 14/10/2026 (fixtures/comprobaciones/, seudonimizadas): qué tarjetas salen, para quién son nuevas y cómo
// se cierran para la oferta. Los borradores de anexo se simulan como los deja la cadena tras las
// decisiones, porque en la captura aún no había ninguno.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { escucharLocal } from '../helpers/servidorLocal.js';
import { comoPersona, de } from '../helpers/persona.js';
import type { Bandeja } from '../../src/dominios/licitaciones/oferta/revisionHermes.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'revision-hermes-'));
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
const { ultimosEventos } = await import('../../src/nucleo/eventos.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { rutasLicitaciones } = await import('../../src/dominios/licitaciones/rutas.js');
const { cerrarTarjetas, seccionesSinAplicar, tarjetasDe, TIPO_EVENTO_REVISION } =
  await import('../../src/dominios/licitaciones/oferta/revisionHermes.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type Tarjeta = import('../../src/dominios/licitaciones/oferta/revisionHermes.js').Tarjeta;

iniciarNucleo();
const db = dbLicitaciones();
const casoE = leerFixtureComprobaciones('casoE');
const casoC = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, casoE);
sembrarFixture(db, nucleo().db, casoC);

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

const urlBandeja = (id: string) => `${base}/api/licitaciones/licitaciones/${id}/oferta/revision`;

async function bandeja(id: string, usuario?: string): Promise<Bandeja> {
  // El servidor ignora «?usuario=»: quién mira lo dice la sesión.
  const r = await fetch(urlBandeja(id), { headers: usuario ? de(usuario) : {} });
  assert.equal(r.status, 200);
  return (await r.json()) as Bandeja;
}

async function actuar(
  id: string,
  clave: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${base}/api/licitaciones/licitaciones/${id}/oferta/revision/${encodeURIComponent(clave)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
}

// Como los deja la cadena tras guardar las decisiones: borrador con su ruta y la hora del relleno.
function anexoEnBorrador(id: string, clave: string, en: string): void {
  db.prepare(
    "UPDATE oferta_documentos SET estado = 'borrador', anexo_en = ?, ruta = ?, actualizado_en = ? WHERE licitacion_id = ? AND clave = ?",
  ).run(en, `Salidas/Licitaciones/${id}/anexos/${clave}.docx`, en, id, clave);
}

const delTipo = (b: Bandeja, tipo: Tarjeta['tipo']) => b.tarjetas.filter((t) => t.tipo === tipo);

test('should_list_a_proposal_card_when_the_proposal_is_newer_than_saved_decisions', async () => {
  // Arrange: en CASO_E la propuesta (14:50) llegó después de guardar las decisiones (14:48).
  assert.ok(casoE.propuesta!.creada_en > casoE.decisiones!.actualizada_en);

  // Act
  const b = await bandeja(casoE.id);

  // Assert
  const [p] = delTipo(b, 'propuesta');
  assert.equal(p?.clave, `propuesta:${casoE.propuesta!.guion_id}:${casoE.propuesta!.creada_en}`);
  assert.equal(p?.estado, 'pendiente');
  assert.equal(p?.nueva_para_ti, true);
});

test('should_not_list_a_proposal_card_when_everything_it_proposes_is_already_saved', () => {
  // Arrange: unas decisiones que son la propuesta tal cual.
  const propuesta = {
    lotes: ['1'],
    equipo: [{ persona_id: 1, rol_en_la_oferta: 'Docente', lotes: [] }],
    automaticos: [],
    herramientas: ['Aula Abierta'],
    enfoque: 'Formación práctica.',
    ofertas: [],
  };

  // Act
  const sin = seccionesSinAplicar({ ...propuesta, herramientas: ['aula abierta'] }, propuesta);

  // Assert
  assert.deepEqual(sin, []);
  assert.deepEqual(seccionesSinAplicar(null, propuesta), ['lotes', 'equipo', 'herramientas', 'enfoque']);
});

test('should_list_the_proposal_and_annex_drafts_as_pending_for_casoC_and_casoE', async () => {
  // Arrange: la cadena rellenó el Anexo V de Villaejemplo y el Anexo VI de CASO_E.
  anexoEnBorrador(casoC.id, 'a3-d1', '2027-10-13T21:00:00.000Z');
  anexoEnBorrador(casoE.id, 'a1-d6', '2026-10-14T21:00:00.000Z');

  // Act
  const [a, g] = [await bandeja(casoC.id), await bandeja(casoE.id)];

  // Assert
  for (const b of [a, g]) {
    assert.equal(delTipo(b, 'propuesta')[0]?.estado, 'pendiente');
    assert.equal(delTipo(b, 'memoria')[0]?.estado, 'pendiente');
  }
  assert.deepEqual(
    delTipo(a, 'anexo').map((t) => [t.clave, t.estado]),
    [['anexo:a3-d1:2027-10-13T21:00:00.000Z', 'pendiente']],
  );
  assert.deepEqual(
    delTipo(g, 'anexo').map((t) => [t.clave, t.estado]),
    [['anexo:a1-d6:2026-10-14T21:00:00.000Z', 'pendiente']],
  );
  assert.equal(a.nuevas, a.tarjetas.length);
  // La de Villaejemplo es de un guion anterior: sale, pero marcada.
  assert.match(delTipo(a, 'propuesta')[0]!.titulo, /guion anterior/);
});

test('should_mark_a_card_new_only_for_the_user_who_has_not_seen_it', async () => {
  // Arrange
  const clave = delTipo(await bandeja(casoC.id, 'Persona A'), 'memoria')[0]!.clave;

  // Act
  const r = await actuar(casoC.id, clave, { accion: 'vista' }, de('Persona A'));

  // Assert
  assert.equal(r.status, 200);
  assert.equal(delTipo(await bandeja(casoC.id, 'Persona A'), 'memoria')[0]?.nueva_para_ti, false);
  assert.equal(delTipo(await bandeja(casoC.id, 'Persona B'), 'memoria')[0]?.nueva_para_ti, true);
  // El anexo llegó después de la memoria: para Persona A sigue siendo nuevo.
  assert.equal(delTipo(await bandeja(casoC.id, 'Persona A'), 'anexo')[0]?.nueva_para_ti, true);
});

test('should_close_a_card_for_both_users_when_one_accepts_it', async () => {
  // Arrange
  const clave = delTipo(await bandeja(casoE.id), 'propuesta')[0]!.clave;

  // Act
  const r = await actuar(casoE.id, clave, { accion: 'aceptar' }, de('Persona A'));
  const otra = await actuar(casoE.id, clave, { accion: 'aceptar' }, de('Persona B'));

  // Assert
  assert.equal(r.status, 200);
  const paraB = delTipo(await bandeja(casoE.id, 'Persona B'), 'propuesta')[0];
  assert.equal(paraB?.estado, 'aceptada');
  assert.equal(paraB?.nueva_para_ti, false);
  assert.equal(otra.status, 409);
  const evento = ultimosEventos(nucleo().db, 20).find((e) => e.tipo === TIPO_EVENTO_REVISION && e.recurso === casoE.id);
  assert.deepEqual(evento?.datos, { clave, accion: 'aceptar' });
});

test('should_reopen_a_closed_card_when_its_fingerprint_changes', async () => {
  // Arrange: la memoria de CASO_E aceptada en la bandeja.
  const clave = delTipo(await bandeja(casoE.id), 'memoria')[0]!.clave;
  assert.equal((await actuar(casoE.id, clave, { accion: 'aceptar' }, de('Persona A'))).status, 200);
  assert.equal(delTipo(await bandeja(casoE.id), 'memoria')[0]?.estado, 'aceptada');

  // Act: se vuelve a montar la misma versión y el Word cambia.
  db.prepare('UPDATE borradores SET sha256 = ? WHERE licitacion_id = ? AND version = ?').run(
    'otra',
    casoE.id,
    casoE.memorias[0]!.version,
  );

  // Assert
  assert.equal(delTipo(await bandeja(casoE.id), 'memoria')[0]?.estado, 'pendiente');
});

test('should_require_a_reason_to_discard', async () => {
  // Arrange
  const clave = delTipo(await bandeja(casoC.id), 'anexo')[0]!.clave;

  // Act
  const sinMotivo = await actuar(casoC.id, clave, { accion: 'descartar' });
  const corto = await actuar(casoC.id, clave, { accion: 'descartar', motivo: 'no' });
  const conMotivo = await actuar(casoC.id, clave, { accion: 'descartar', motivo: 'El precio no es el decidido' });

  // Assert
  assert.equal(sinMotivo.status, 400);
  assert.equal(corto.status, 400);
  assert.equal(conMotivo.status, 200);
  assert.equal(delTipo(await bandeja(casoC.id), 'anexo')[0]?.estado, 'descartada');
});

test('should_not_list_accepted_annexes_as_pending', async () => {
  // Arrange: dos anexos en borrador; uno se acepta en la bandeja y el otro ya está preparado.
  anexoEnBorrador(casoE.id, 'a1-d2', '2026-10-14T21:05:00.000Z');
  anexoEnBorrador(casoE.id, 'a1-d4', '2026-10-14T21:05:00.000Z');
  const clave = 'anexo:a1-d2:2026-10-14T21:05:00.000Z';
  assert.equal((await actuar(casoE.id, clave, { accion: 'aceptar' })).status, 200);
  db.prepare("UPDATE oferta_documentos SET estado = 'preparado' WHERE licitacion_id = ? AND clave = 'a1-d4'").run(
    casoE.id,
  );

  // Act
  const anexos = delTipo(await bandeja(casoE.id), 'anexo');

  // Assert
  assert.equal(anexos.find((t) => t.clave === clave)?.estado, 'aceptada');
  assert.equal(
    anexos.some((t) => t.clave.startsWith('anexo:a1-d4:')),
    false,
  );
  assert.deepEqual(
    anexos.filter((t) => t.estado === 'pendiente').map((t) => t.clave),
    ['anexo:a1-d6:2026-10-14T21:00:00.000Z'],
  );
});

test('should_not_close_accreditation_cards_in_bulk', () => {
  // Arrange: la copia de la titulación de CASO_E es un documento de acreditación del guion.
  anexoEnBorrador(casoE.id, 'a1-d8', '2026-10-14T21:10:00.000Z');
  const tarjetas = tarjetasDe(db, casoE.id, 'Persona A').filter((t) => t.tipo === 'anexo' && t.estado === 'pendiente');
  assert.equal(tarjetas.find((t) => t.clave.startsWith('anexo:a1-d8:'))?.acreditacion, true);

  // Act
  const r = cerrarTarjetas(
    db,
    casoE.id,
    tarjetas.map((t) => t.clave),
    { accion: 'aceptar', quien: 'Persona A' },
  );

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(
    tarjetasDe(db, casoE.id, 'Persona A').filter((t) => t.tipo === 'anexo' && t.estado === 'pendiente').length,
    tarjetas.length,
  );
});

test('should_list_the_latest_finished_pre_submission_review', async () => {
  // Arrange
  const ins = db.prepare(
    'INSERT INTO revisiones_previas (licitacion_id, paquete_version, estado, resumen, pedida_en, terminada_en) VALUES (?, ?, ?, ?, ?, ?)',
  );
  ins.run(
    casoC.id,
    1,
    'terminada',
    'Dos avisos en el Anexo V.',
    '2027-10-13T22:00:00.000Z',
    '2027-10-13T22:30:00.000Z',
  );
  ins.run(casoC.id, 2, 'pedida', null, '2027-10-13T23:00:00.000Z', null);

  // Act
  const [r] = delTipo(await bandeja(casoC.id), 'revision_previa');

  // Assert
  assert.equal(r?.clave, 'revision_previa:v1');
  assert.equal(r?.resumen, 'Dos avisos en el Anexo V.');
});

test('should_list_the_deuc_guide_as_its_own_card_and_not_as_an_annex', async () => {
  // Arrange: la guía del DEUC queda en la fila del DEUC (a1-d1 de Villaejemplo).
  db.prepare(
    "UPDATE oferta_documentos SET estado = 'borrador', anexo_en = ?, ruta = ?, actualizado_en = ? WHERE licitacion_id = ? AND clave = 'a1-d1'",
  ).run(
    '2027-10-13T21:20:00.000Z',
    `Salidas/Licitaciones/${casoC.id}/DEUC_GUIA-v2.md`,
    '2027-10-13T21:20:00.000Z',
    casoC.id,
  );

  // Act
  const b = await bandeja(casoC.id);

  // Assert
  assert.deepEqual(
    delTipo(b, 'deuc').map((t) => t.clave),
    [`deuc:Salidas/Licitaciones/${casoC.id}/DEUC_GUIA-v2.md`],
  );
  assert.equal(
    delTipo(b, 'anexo').some((t) => t.clave.startsWith('anexo:a1-d1:')),
    false,
  );
});

test('should_reject_an_unknown_action', async () => {
  // Act
  const r = await actuar(casoE.id, 'memoria:v1', { accion: 'aplicar' });

  // Assert
  assert.equal(r.status, 400);
});

test('should_not_list_hidden_annex_drafts_from_a_removed_lot', async () => {
  // Arrange: el anexo del lote 6 de CASO_E, relleno por Hermes, queda oculto al quitar el lote.
  anexoEnBorrador(casoE.id, 'a1-d6', '2026-10-14T23:30:00.000Z');
  const antes = await bandeja(casoE.id, 'Persona B');
  db.prepare("UPDATE oferta_documentos SET oculto = 1 WHERE licitacion_id = ? AND clave = 'a1-d6'").run(casoE.id);

  // Act
  const b = await bandeja(casoE.id, 'Persona B');

  // Assert
  db.prepare("UPDATE oferta_documentos SET oculto = 0 WHERE licitacion_id = ? AND clave = 'a1-d6'").run(casoE.id);
  assert.equal(
    delTipo(antes, 'anexo').some((t) => t.clave === 'anexo:a1-d6:2026-10-14T23:30:00.000Z'),
    true,
  );
  assert.equal(
    delTipo(b, 'anexo').some((t) => t.clave.startsWith('anexo:a1-d6:')),
    false,
  );
  assert.equal(b.nuevas, antes.nuevas - 1);
});

test('should_not_count_the_approach_as_unapplied_when_it_only_lost_the_pliego_citations_on_saving', () => {
  // Arrange: al guardar, el enfoque pierde las citas del pliego (sinCitasInternas), como en diffPropuesta.
  const guardadas = casoE.decisiones!.datos as Parameters<typeof seccionesSinAplicar>[1];
  const ENFOQUE = 'Formación práctica con hojas de cálculo en cada lote y tutoría semanal.';
  const conCita = { ...guardadas, enfoque: `${ENFOQUE} (PPT.pdf, pág. 4)` };
  const otro = { ...guardadas, enfoque: 'Formación teórica en aula.' };

  // Act
  const sinAplicar = seccionesSinAplicar({ ...guardadas, enfoque: ENFOQUE }, conCita);
  const distinto = seccionesSinAplicar({ ...guardadas, enfoque: ENFOQUE }, otro);

  // Assert
  assert.equal(sinAplicar.includes('enfoque'), false, JSON.stringify(sinAplicar));
  assert.equal(distinto.includes('enfoque'), true);
});

// Una versión de la memoria de un lote de CASO_E, montada, con su borrador en ese estado.
function memoriaDelLote(version: number, lote: string, revision: string, presentada = 0): number {
  const guion = Math.max(...casoE.guiones.map((g) => g.id));
  const en = '2026-10-14T22:00:00.000Z';
  const m = Number(
    db
      .prepare(
        `INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, ensamblada_en, lote, presentada)
    VALUES (?, ?, ?, 'ensamblada', ?, ?, ?, ?)`,
      )
      .run(casoE.id, guion, version, en, en, lote, presentada).lastInsertRowid,
  );
  const b = Number(
    db
      .prepare(
        `INSERT INTO borradores (licitacion_id, ruta, sha256, bytes, agente, registrado_en, estado, origen, guion_id, version, memoria_id)
    VALUES (?, ?, ?, 1, 'plataforma', ?, ?, 'ensamblado', ?, ?, ?)`,
      )
      .run(casoE.id, `Salidas/casoE/memoria-v${version}.docx`, `sha-${version}`, en, revision, guion, version, m)
      .lastInsertRowid,
  );
  db.prepare('UPDATE memorias SET borrador_id = ? WHERE id = ?').run(b, m);
  return m;
}

test('should_list_the_pending_memory_of_each_lot_even_after_another_lot_was_submitted', async () => {
  // Arrange: la v5 del lote 2, pendiente; luego la presentada del lote 4 como v6, ya aceptada.
  const ids = [memoriaDelLote(5, '2', 'pendiente'), memoriaDelLote(6, '4', 'aceptada', 1)];

  // Act
  const b = await bandeja(casoE.id);

  // Assert
  for (const m of ids) db.prepare('DELETE FROM borradores WHERE memoria_id = ?').run(m);
  db.prepare(`DELETE FROM memorias WHERE id IN (${ids.map(() => '?').join(', ')})`).run(...ids);
  assert.deepEqual(
    delTipo(b, 'memoria').map((t) => [t.clave, t.lote, t.estado]),
    [['memoria:v5', '2', 'pendiente']],
  );
});
