// Una ficha «No go» de Hermes deja en Descartadas la oportunidad que sigue por decidir
// (nueva o «Ficha por revisar»), tipificada y reversible; el arreglo 11 hace lo mismo al arrancar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { ultimosEventos } from '../../src/nucleo/eventos.js';
import { abrirLicitaciones, guardarLicitacion, type Db } from '../../src/dominios/licitaciones/store.js';
import {
  Cambio,
  cambiarOportunidad,
  detalle,
  historialDescartes,
  listarOportunidades,
  Filtro,
  sinCifrasDelPerfil,
} from '../../src/dominios/licitaciones/oportunidades.js';
import { proponerFicha } from '../../src/dominios/licitaciones/ficha.js';
import { CATEGORIA_NO_GO, EVENTO_DESCARTE, motivoNoGo } from '../../src/dominios/licitaciones/gonogo.js';
import { licitacion } from '../helpers/sinteticas.js';

process.env.NODE_ENV = 'test';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-nogo-'));
const abiertas: Db[] = [];
after(() => {
  abiertas.forEach((d) => {
    if (d.open) d.close();
  });
  fs.rmSync(tmp, { recursive: true, force: true });
});

const MOTIVO_HERMES = 'El objeto es obra civil y no tenemos la clasificación exigida.';
const FICHA_BASE = {
  resumen: 'Servicio de consultoría para la transformación digital del Cabildo durante dos años.',
  requisitos: [],
  criterios: [],
  documentacion: [],
  hitos: [],
  garantias: [],
  penalizaciones: [],
  riesgos: [],
};
const fichaCon = (id: string, decision: 'go' | 'no_go' | 'revisar') => ({
  ...FICHA_BASE,
  id,
  recomendacion: { decision, motivo: MOTIVO_HERMES },
});
// Como se guarda en la base: sin el id de la entrada.
const datosGuardados = (decision: 'go' | 'no_go' | 'revisar') => ({
  ...FICHA_BASE,
  recomendacion: { decision, motivo: MOTIVO_HERMES },
});

let n = 0;
function directorio(): string {
  n += 1;
  const dir = path.join(tmp, String(n));
  abrirNucleo(dir).close();
  return dir;
}

function abrir(dir: string): Db {
  const db = abrirLicitaciones(dir);
  abiertas.push(db);
  return db;
}

function conOportunidad(db: Db, estado: string, aMano = 0): string {
  const l = licitacion({ titulo: 'Consultoría digital', publicada: '2026-09-24', limite: '2099-12-15T08:00:00' });
  guardarLicitacion(db, l);
  db.prepare(
    'INSERT INTO oportunidades (licitacion_id, estado, cambiada_a_mano, creada_en, actualizada_en) VALUES (?, ?, ?, ?, ?)',
  ).run(l.id, estado, aMano, 'x', 'x');
  return l.id;
}

const fila = (db: Db, id: string) =>
  db
    .prepare('SELECT estado, motivo_descarte, descarte_automatico FROM oportunidades WHERE licitacion_id = ?')
    .get(id) as { estado: string; motivo_descarte: string | null; descarte_automatico: number };

test('should_discard_automatically_when_hermes_ficha_says_no_go_and_the_offer_is_in_the_filter', async () => {
  const db = abrir(directorio());
  const nueva = conOportunidad(db, 'nueva');
  const porRevisar = conOportunidad(db, 'nueva');
  assert.equal((await proponerFicha(db, fichaCon(porRevisar, 'revisar'), 'hermes')).error, null);

  const r1 = await proponerFicha(db, fichaCon(nueva, 'no_go'), 'hermes');
  const r2 = await proponerFicha(db, fichaCon(porRevisar, 'no_go'), 'hermes');

  assert.equal(r1.data?.descartada, true);
  assert.equal(r2.data?.descartada, true, 'la que estaba en «Ficha por revisar» también');
  for (const id of [nueva, porRevisar]) {
    assert.deepEqual(fila(db, id), {
      estado: 'descartada',
      motivo_descarte: `Hermes: no go — ${MOTIVO_HERMES}`,
      descarte_automatico: 1,
    });
    assert.equal(detalle(db, id).data?.categoria_descarte, CATEGORIA_NO_GO);
  }
  const evento = ultimosEventos(db, 10).find((e) => e.tipo === EVENTO_DESCARTE && e.recurso === nueva);
  assert.deepEqual([evento?.datos['origen'], evento?.datos['categoria']], ['no_go', CATEGORIA_NO_GO]);
});

test('should_not_touch_an_offer_in_preparation_or_changed_by_hand', async () => {
  const db = abrir(directorio());
  const preparacion = conOportunidad(db, 'en_preparacion');
  const presentada = conOportunidad(db, 'presentada');
  const aMano = conOportunidad(db, 'nueva', 1);
  const conGo = conOportunidad(db, 'nueva');

  for (const id of [preparacion, presentada, aMano])
    assert.equal((await proponerFicha(db, fichaCon(id, 'no_go'), 'hermes')).data?.descartada, false);
  await proponerFicha(db, fichaCon(conGo, 'go'), 'hermes');

  assert.deepEqual(
    [preparacion, presentada, aMano, conGo].map((id) => fila(db, id).estado),
    ['en_preparacion', 'presentada', 'nueva', 'nueva'],
  );
  assert.deepEqual(
    [preparacion, presentada, aMano, conGo].flatMap((id) => historialDescartes(db, id)),
    [],
  );
});

test('should_record_the_discard_as_hermes_no_go_in_history', async () => {
  const db = abrir(directorio());
  const id = conOportunidad(db, 'nueva');

  await proponerFicha(db, fichaCon(id, 'no_go'), 'hermes');

  const h = historialDescartes(db, id);
  assert.equal(h.length, 1);
  assert.deepEqual(
    [h[0]?.accion, h[0]?.categoria, h[0]?.automatico, h[0]?.quien],
    ['descartada', CATEGORIA_NO_GO, true, 'hermes'],
  );
  assert.equal(h[0]?.motivo, `Hermes: no go — ${MOTIVO_HERMES}`);
  const lista = listarOportunidades(db, Filtro.parse({ estados: ['descartada'] }));
  assert.equal(
    lista.items.find((x) => x.id === id)?.categoria_descarte,
    CATEGORIA_NO_GO,
    'Descartadas dice el tipo sin abrirla',
  );
});

test('should_not_rediscard_after_a_person_recovered_it', async () => {
  const db = abrir(directorio());
  const id = conOportunidad(db, 'nueva');
  await proponerFicha(db, fichaCon(id, 'no_go'), 'hermes');

  cambiarOportunidad(db, id, Cambio.parse({ estado: 'nueva' }), 'Persona A');
  const otra = await proponerFicha(db, fichaCon(id, 'no_go'), 'hermes');

  assert.equal(otra.data?.descartada, false);
  assert.equal(fila(db, id).estado, 'nueva', 'vuelve a «Ficha por revisar» y ahí se queda');
  assert.deepEqual(
    historialDescartes(db, id).map((e) => [e.accion, e.quien]),
    [
      ['descartada', 'hermes'],
      ['recuperada', 'Persona A'],
    ],
  );
});

test('should_recover_when_a_new_ficha_replaces_the_no_go', async () => {
  const db = abrir(directorio());
  const id = conOportunidad(db, 'nueva');
  const aMano = conOportunidad(db, 'nueva');
  cambiarOportunidad(
    db,
    aMano,
    Cambio.parse({ estado: 'descartada', motivo_descarte: 'Plazo imposible', categoria_descarte: 'plazo' }),
    'Persona A',
  );
  await proponerFicha(db, fichaCon(id, 'no_go'), 'hermes');
  await proponerFicha(db, fichaCon(aMano, 'no_go'), 'hermes');

  const r = await proponerFicha(
    db,
    { ...fichaCon(id, 'go'), recomendacion: { decision: 'go', motivo: 'Encaja y cumplimos solvencia' } },
    'hermes',
  );
  await proponerFicha(db, fichaCon(aMano, 'go'), 'hermes');

  assert.equal(r.data?.descartada, false);
  assert.deepEqual(fila(db, id), { estado: 'nueva', motivo_descarte: null, descarte_automatico: 0 });
  assert.equal(detalle(db, id).data?.categoria_descarte, null);
  assert.deepEqual(
    historialDescartes(db, id).map((e) => [e.accion, e.categoria, e.automatico, e.quien]),
    [
      ['descartada', CATEGORIA_NO_GO, true, 'hermes'],
      ['recuperada', CATEGORIA_NO_GO, true, 'hermes'],
    ],
  );
  assert.equal(fila(db, aMano).estado, 'descartada', 'lo que descartó una persona no se toca');
});

test('should_not_put_the_no_go_reason_in_the_discard_event', async () => {
  const db = abrir(directorio());
  const id = conOportunidad(db, 'nueva');

  await proponerFicha(db, fichaCon(id, 'no_go'), 'hermes');

  const evento = ultimosEventos(db, 10).find((e) => e.tipo === EVENTO_DESCARTE && e.recurso === id);
  assert.equal(evento?.datos['categoria'], CATEGORIA_NO_GO);
  assert.equal(
    evento?.datos['motivo'],
    undefined,
    'el motivo compara con el perfil: los eventos llegan a agentes sin él',
  );
});

test('should_skip_a_no_go_ficha_that_no_longer_validates_on_start', () => {
  const dir = directorio();
  const db = abrir(dir);
  const id = conOportunidad(db, 'nueva');
  const invalida = { ...datosGuardados('no_go'), resumen: 'corto' };
  db.prepare(
    `INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en) VALUES (?, 'aprobada', ?, 'hermes', 'x', 'x', 'x')`,
  ).run(id, JSON.stringify(invalida));
  db.pragma(`user_version = ${Number(db.pragma('user_version', { simple: true })) - 1}`);
  db.close();

  const reabierta = abrir(dir);

  assert.equal(fila(reabierta, id).estado, 'nueva', 'una ficha que la web no enseña no descarta');
  assert.deepEqual(historialDescartes(reabierta, id), []);
});

test('should_apply_the_rule_to_existing_no_go_fichas_once_on_start', () => {
  const dir = directorio();
  const db = abrir(dir);
  const ficha = (id: string, decision: string, revisada: string) =>
    db
      .prepare(
        `INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en, revisada_en)
    VALUES (?, 'aprobada', ?, 'hermes', ?, ?, ?)`,
      )
      .run(id, JSON.stringify(datosGuardados(decision as 'go')), revisada, revisada, revisada);
  const noGo = conOportunidad(db, 'nueva');
  const aMano = conOportunidad(db, 'nueva', 1);
  const preparacion = conOportunidad(db, 'en_preparacion');
  const ahoraGo = conOportunidad(db, 'nueva');
  for (const id of [noGo, aMano, preparacion]) ficha(id, 'no_go', '2026-10-10T10:00:00Z');
  ficha(ahoraGo, 'no_go', '2026-10-10T10:00:00Z');
  ficha(ahoraGo, 'go', '2026-10-11T10:00:00Z');
  const version = Number(db.pragma('user_version', { simple: true }));
  // El arreglo 11: los posteriores no tocan oportunidades.
  db.pragma('user_version = 10');
  db.close();

  const reabierta = abrir(dir);
  cambiarOportunidad(reabierta, noGo, Cambio.parse({ estado: 'nueva' }), 'Persona A');
  reabierta.prepare("UPDATE oportunidades SET cambiada_a_mano = 0, estado = 'nueva' WHERE licitacion_id = ?").run(noGo);
  reabierta.close();
  const otraVez = abrir(dir);

  assert.equal(Number(otraVez.pragma('user_version', { simple: true })), version);
  assert.equal(fila(otraVez, noGo).estado, 'nueva', 'el arreglo no se repite al volver a arrancar');
  assert.deepEqual(
    historialDescartes(otraVez, noGo).map((e) => [e.accion, e.categoria, e.automatico]),
    [
      ['descartada', CATEGORIA_NO_GO, true],
      ['recuperada', null, false],
    ],
    'se aplicó una vez, con su historial',
  );
  assert.deepEqual(
    [aMano, preparacion, ahoraGo].map((id) => fila(otraVez, id).estado),
    ['nueva', 'en_preparacion', 'nueva'],
    'solo la ficha vigente y lo que nadie movió',
  );
});

test('should_trim_a_long_no_go_reason_and_keep_the_prefix', () => {
  const largo = `${'Mucho que leer '.repeat(40)}fin`;

  const texto = motivoNoGo(`  ${largo}  `);

  assert.ok(texto.startsWith('Hermes: no go — Mucho que leer'));
  assert.ok(texto.endsWith('…'));
  assert.ok(texto.length <= 'Hermes: no go — '.length + 280);
});

test('should_reserve_the_no_go_reason_for_agents', async () => {
  const db = abrir(directorio());
  const id = conOportunidad(db, 'nueva');
  await proponerFicha(db, fichaCon(id, 'no_go'), 'hermes');

  const d = sinCifrasDelPerfil(detalle(db, id).data!);

  assert.match(d.motivo_descarte ?? '', /^Descartada sola: la ficha de Hermes dice «No go»\./);
  assert.ok(!(d.motivo_descarte ?? '').includes('clasificación'));
});
