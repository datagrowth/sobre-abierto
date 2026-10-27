// Migración de licitaciones.db: una base creada con el esquema anterior gana las
// columnas nuevas sin perder datos, y abrirla otra vez no cambia nada.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { abrirLicitaciones, ARREGLOS_TOTALES, licitacionesFile } from '../../src/dominios/licitaciones/store.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'store-lic-'));

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('should_add_new_columns_and_mark_rescued_ones_as_human_changes_idempotently', () => {
  const vieja = new Database(licitacionesFile(tmp));
  vieja.exec(`CREATE TABLE oportunidades (
    licitacion_id TEXT PRIMARY KEY, estado TEXT NOT NULL, motivo_prefiltro TEXT, lote_criba INTEGER,
    veredicto_ia TEXT, motivo_ia TEXT, confianza_ia REAL, rescatada INTEGER NOT NULL DEFAULT 0,
    notas TEXT, creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL);
    INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES ('p-1', 'nueva', 'x', 'x');
    INSERT INTO oportunidades (licitacion_id, estado, rescatada, creada_en, actualizada_en) VALUES ('p-2', 'nueva', 1, 'x', 'x');`);
  vieja.close();

  abrirLicitaciones(tmp).close();
  const db = abrirLicitaciones(tmp);
  const columnas = (db.prepare('PRAGMA table_info(oportunidades)').all() as { name: string }[]).map((c) => c.name);
  const fila = db
    .prepare("SELECT estado, cambiada_a_mano, descarte_automatico FROM oportunidades WHERE licitacion_id = 'p-1'")
    .get();
  const aMano = db.prepare("SELECT cambiada_a_mano FROM oportunidades WHERE licitacion_id = 'p-2'").get();
  db.close();

  assert.ok(columnas.includes('cambiada_a_mano'));
  assert.ok(columnas.includes('descarte_automatico'));
  assert.ok(!columnas.includes('motivo_next'));
  assert.deepEqual(fila, { estado: 'nueva', cambiada_a_mano: 0, descarte_automatico: 0 });
  assert.deepEqual(
    aMano,
    { cambiada_a_mano: 1 },
    'seguida o rescatada a mano antes de la migración: el descarte automático no la toca',
  );
});

test('should_mark_existing_tenders_as_coming_from_the_live_feed', () => {
  const dir = path.join(tmp, 'origen');
  fs.mkdirSync(dir);
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`CREATE TABLE licitaciones (
    id TEXT PRIMARY KEY, atom_id TEXT NOT NULL UNIQUE, fuente TEXT NOT NULL, expediente TEXT NOT NULL,
    titulo TEXT NOT NULL, url TEXT, estado TEXT NOT NULL, actualizada_en TEXT NOT NULL,
    organo_nombre TEXT NOT NULL, organo_nif TEXT, tipo_contrato TEXT, procedimiento TEXT,
    presupuesto_sin_iva REAL, valor_estimado REAL, cpvs TEXT NOT NULL, nuts TEXT, lugar TEXT,
    fecha_limite TEXT, datos TEXT NOT NULL, borrada_en TEXT, borrada_motivo TEXT, vista_en TEXT NOT NULL);
    INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, estado, actualizada_en, organo_nombre, cpvs, datos, vista_en)
      VALUES ('p-1', 'a', 'perfiles', 'E', 'T', 'PUB', 'x', 'O', '', '{}', 'x');`);
  vieja.close();

  const db = abrirLicitaciones(dir);
  const fila = db.prepare("SELECT origen FROM licitaciones WHERE id = 'p-1'").get();
  db.close();

  assert.deepEqual(fila, { origen: 'feed' }, 'lo anterior al histórico llegó por el feed y sigue pasando el prefiltro');
});

test('should_fill_body_keys_and_title_words_when_migrating_and_keep_them_on_reopening', () => {
  const dir = path.join(tmp, 'antecedentes');
  fs.mkdirSync(dir);
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`CREATE TABLE licitaciones (
    id TEXT PRIMARY KEY, atom_id TEXT NOT NULL UNIQUE, fuente TEXT NOT NULL, expediente TEXT NOT NULL,
    titulo TEXT NOT NULL, url TEXT, estado TEXT NOT NULL, actualizada_en TEXT NOT NULL,
    organo_nombre TEXT NOT NULL, organo_nif TEXT, tipo_contrato TEXT, procedimiento TEXT,
    presupuesto_sin_iva REAL, valor_estimado REAL, cpvs TEXT NOT NULL, nuts TEXT, lugar TEXT,
    fecha_limite TEXT, datos TEXT NOT NULL, borrada_en TEXT, borrada_motivo TEXT, vista_en TEXT NOT NULL);`);
  const insertar =
    vieja.prepare(`INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, estado, actualizada_en, organo_nombre, cpvs, datos, vista_en)
    VALUES (?, ?, 'agregadas', 'E', ?, 'PUB', 'x', ?, '', ?, 'x')`);
  insertar.run(
    'a-1',
    'a',
    'Servicio de limpieza 2024-2025',
    'Junta de Gobierno Local',
    JSON.stringify({ organo: { dir3: 'L09999004', superior: 'Ayuntamiento de X' } }),
  );
  insertar.run(
    'a-2',
    'b',
    'Mantenimiento de jardines',
    'Consejo de Gobierno Foral',
    JSON.stringify({ organo: { dir3: null, superior: 'Diputación Foral de Álava' } }),
  );
  vieja.close();

  abrirLicitaciones(dir).close();
  const db = abrirLicitaciones(dir);
  const filas = db.prepare('SELECT id, organo_dir3, organo_norm, titulo_palabras FROM licitaciones ORDER BY id').all();
  db.close();

  assert.deepEqual(
    filas.map((f) => ({ ...(f as object) })),
    [
      { id: 'a-1', organo_dir3: 'L09999004', organo_norm: 'ayuntamiento de x', titulo_palabras: 'limpieza' },
      {
        id: 'a-2',
        organo_dir3: null,
        organo_norm: 'diputacion foral de alava',
        titulo_palabras: 'mantenimiento jardin',
      },
    ],
  );
});

test('should_recompute_body_keys_saved_with_the_previous_normalization_once', () => {
  const dir = path.join(tmp, 'clave-organo');
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, estado, actualizada_en, organo_nombre, cpvs, datos, vista_en, organo_norm)
      VALUES ('a-1', 'a', 'agregadas', 'E', 'T', 'PUB', 'x', 'Consejo de Gobierno Foral', '', '{"organo":{"superior":"Diputación Foral de Gipuzkoa"}}', 'x', 'consejo de gobierno foral');
    PRAGMA user_version = 1;`);
  vieja.close();

  const db = abrirLicitaciones(dir);
  const fila = db.prepare('SELECT organo_norm FROM licitaciones').get();
  const version = db.pragma('user_version', { simple: true });
  db.close();

  assert.deepEqual(
    { ...(fila as object) },
    { organo_norm: 'diputacion foral de gipuzkoa' },
    'la clave anterior juntaba las dos diputaciones',
  );
  assert.equal(version, ARREGLOS_TOTALES);
});

test('should_clean_double_encoded_entities_in_saved_titles_once', () => {
  const dir = path.join(tmp, 'entidades');
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, estado, actualizada_en, organo_nombre, cpvs, datos, vista_en)
      VALUES ('p-1', 'a', 'perfiles', 'E', 'Servicios&nbsp;de Inteligencia Artificial', 'PUB', 'x', 'Ayto. de Arg&uuml;ell&amp;nbsp;es', '', '{}', 'x');
    PRAGMA user_version = 2;`);
  vieja.close();

  const db = abrirLicitaciones(dir);
  const fila = db.prepare('SELECT titulo, organo_nombre, titulo_palabras FROM licitaciones').get() as {
    titulo: string;
    organo_nombre: string;
    titulo_palabras: string | null;
  };
  db.close();

  assert.equal(fila.titulo, 'Servicios de Inteligencia Artificial');
  assert.equal(fila.organo_nombre, 'Ayto. de Argüell es');
  assert.doesNotMatch(fila.titulo_palabras ?? '', /nbsp/);
});

test('should_move_opportunities_that_went_to_next_on_their_own_to_descartadas', () => {
  const dir = path.join(tmp, 'next');
  fs.mkdirSync(dir);
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`CREATE TABLE oportunidades (
    licitacion_id TEXT PRIMARY KEY, estado TEXT NOT NULL, motivo_prefiltro TEXT, lote_criba INTEGER,
    veredicto_ia TEXT, motivo_ia TEXT, confianza_ia REAL, rescatada INTEGER NOT NULL DEFAULT 0,
    notas TEXT, creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL,
    cambiada_a_mano INTEGER NOT NULL DEFAULT 0, motivo_next TEXT, motivo_descarte TEXT);
    INSERT INTO oportunidades (licitacion_id, estado, motivo_next, creada_en, actualizada_en) VALUES ('p-sola', 'next', 'Requisito excluyente no cumplido: ENS', 'x', 'x');
    INSERT INTO oportunidades (licitacion_id, estado, cambiada_a_mano, creada_en, actualizada_en) VALUES ('p-mano', 'next', 1, 'x', 'x');
    PRAGMA user_version = 3;`);
  vieja.close();

  const db = abrirLicitaciones(dir);
  const fila = (id: string) =>
    db
      .prepare('SELECT estado, motivo_descarte, descarte_automatico FROM oportunidades WHERE licitacion_id = ?')
      .get(id);
  const columnas = (db.prepare('PRAGMA table_info(oportunidades)').all() as { name: string }[]).map((c) => c.name);
  const sola = fila('p-sola');
  const aMano = fila('p-mano');
  db.close();

  assert.deepEqual(sola, {
    estado: 'descartada',
    motivo_descarte: 'Requisito excluyente no cumplido: ENS',
    descarte_automatico: 1,
  });
  assert.deepEqual(
    aMano,
    { estado: 'descartada', motivo_descarte: 'Estaba en «Más adelante», que ya no existe.', descarte_automatico: 0 },
    '«Más adelante» ya no existe: pasa a descartadas, rescatable',
  );
  assert.ok(!columnas.includes('motivo_next'));
});

test('should_bring_back_to_nuevas_what_was_discarded_only_for_the_liability_insurance', () => {
  const dir = path.join(tmp, 'seguro');
  fs.mkdirSync(dir);
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`CREATE TABLE oportunidades (
    licitacion_id TEXT PRIMARY KEY, estado TEXT NOT NULL, motivo_prefiltro TEXT, lote_criba INTEGER,
    veredicto_ia TEXT, motivo_ia TEXT, confianza_ia REAL, rescatada INTEGER NOT NULL DEFAULT 0,
    notas TEXT, creada_en TEXT NOT NULL, actualizada_en TEXT NOT NULL,
    cambiada_a_mano INTEGER NOT NULL DEFAULT 0, lotes_prefiltro TEXT, lotes_interes TEXT, motivo_descarte TEXT,
    descarte_automatico INTEGER NOT NULL DEFAULT 0);
    INSERT INTO oportunidades VALUES ('p-seguro', 'descartada', NULL, NULL, NULL, NULL, NULL, 0, NULL, 'x', 'x', 0, NULL, NULL,
      'Requisito excluyente no cumplido: Seguro de indemnización ≥ 300.000 €: El perfil no indica el seguro de responsabilidad civil.', 1);
    INSERT INTO oportunidades VALUES ('p-dos', 'descartada', NULL, NULL, NULL, NULL, NULL, 0, NULL, 'x', 'x', 0, NULL, NULL,
      'Requisito excluyente no cumplido: Seguro de indemnización ≥ 300.000 €: no · Volumen anual de negocio ≥ 2 M€: no', 1);
    PRAGMA user_version = 4;`);
  vieja.close();

  const db = abrirLicitaciones(dir);
  const estado = (id: string) =>
    (db.prepare('SELECT estado FROM oportunidades WHERE licitacion_id = ?').get(id) as { estado: string }).estado;
  const seguro = estado('p-seguro');
  const dos = estado('p-dos');
  db.close();

  assert.equal(seguro, 'nueva');
  assert.equal(dos, 'descartada', 'con otro excluyente sigue descartada');
});

test('should_send_back_to_triage_what_hermes_triaged_without_reading_the_profile', () => {
  const dir = path.join(tmp, 'sin-perfil');
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, motivo_ia, confianza_ia, lote_criba, creada_en, actualizada_en) VALUES
      ('p-ciega', 'nueva', 'revisar', 'falta el perfil de licitaciones', 1, 3, 'x', 'x'),
      ('p-ciega2', 'nueva', 'revisar', 'Falta el perfil de licitaciones de la empresa.', 1, 3, 'x', 'x'),
      ('p-mirada', 'nueva', 'revisar', 'Desarrollo de software afín, importe justo', 0.6, 4, 'x', 'x'),
      ('p-con-ficha', 'nueva', 'revisar', 'falta el perfil de licitaciones', 1, 3, 'x', 'x');
    INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, motivo_ia, cambiada_a_mano, creada_en, actualizada_en) VALUES
      ('p-a-mano', 'nueva', 'revisar', 'falta el perfil de licitaciones', 1, 'x', 'x');
    INSERT INTO fichas (licitacion_id, estado, datos, agente, creada_en, actualizada_en) VALUES ('p-con-ficha', 'aprobada', '{}', 'h', 'x', 'x');
    PRAGMA user_version = 6;`);
  vieja.close();

  const db = abrirLicitaciones(dir);
  const fila = (id: string) =>
    db.prepare('SELECT estado, veredicto_ia, motivo_ia, lote_criba FROM oportunidades WHERE licitacion_id = ?').get(id);
  const ciega = fila('p-ciega');
  const ciega2 = fila('p-ciega2');
  const resto = ['p-mirada', 'p-a-mano'].map((id) => (fila(id) as { estado: string }).estado);
  const conFicha = (fila('p-con-ficha') as { estado: string }).estado;
  const fichas = (
    db.prepare("SELECT COUNT(*) AS n FROM fichas WHERE licitacion_id = 'p-con-ficha'").get() as { n: number }
  ).n;
  db.close();

  assert.deepEqual(
    { ...(ciega as object) },
    { estado: 'candidata', veredicto_ia: null, motivo_ia: null, lote_criba: null },
  );
  assert.equal((ciega2 as { estado: string }).estado, 'candidata');
  assert.deepEqual(resto, ['nueva', 'nueva'], 'lo cribado de verdad y lo puesto a mano se quedan');
  assert.equal(conFicha, 'candidata', 'con ficha también vuelve: el encaje de sector lo juzga la criba');
  assert.equal(fichas, 1, 'y conserva su ficha');
});

function sembrarFix9(dir: string): void {
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`INSERT INTO oportunidades (licitacion_id, estado, veredicto_ia, motivo_ia, confianza_ia, cambiada_a_mano, motivo_descarte, lotes_interes, lote_criba, creada_en, actualizada_en) VALUES
      ('p-descartada', 'descartada', 'revisar', 'Hermes: falta el perfil de licitaciones', 1, 1, 'No encaja', '[2]', 2, 'x', 'x'),
      ('p-ruta', 'candidata', 'revisar', 'No se pudo leer perfil-licitaciones.md', 1, 0, NULL, NULL, NULL, 'x', 'x'),
      ('p-otra', 'descartada', 'descartar', 'Mantenimiento de ascensores, fuera de sector', 0.9, 0, 'Fuera de sector', NULL, 1, 'x', 'x');
    PRAGMA user_version = 8;`);
  vieja.close();
}

test('should_clear_missing_profile_reason_in_discarded_and_hand_changed_opportunities', () => {
  const dir = path.join(tmp, 'fix9-limpia');
  sembrarFix9(dir);

  const db = abrirLicitaciones(dir);
  const fila = (id: string) => ({
    ...(db
      .prepare(
        'SELECT estado, veredicto_ia, motivo_ia, confianza_ia, cambiada_a_mano, motivo_descarte, lotes_interes, lote_criba FROM oportunidades WHERE licitacion_id = ?',
      )
      .get(id) as Record<string, unknown>),
  });
  const descartada = fila('p-descartada');
  const ruta = fila('p-ruta');
  db.close();

  assert.deepEqual(descartada, {
    estado: 'descartada',
    veredicto_ia: null,
    motivo_ia: null,
    confianza_ia: null,
    cambiada_a_mano: 1,
    motivo_descarte: 'No encaja',
    lotes_interes: '[2]',
    lote_criba: 2,
  });
  assert.equal(ruta.motivo_ia, null);
  assert.equal(ruta.estado, 'candidata');
});

test('should_not_touch_other_criba_reasons', () => {
  const dir = path.join(tmp, 'fix9-otras');
  sembrarFix9(dir);

  const db = abrirLicitaciones(dir);
  const otra = db
    .prepare("SELECT veredicto_ia, motivo_ia, confianza_ia FROM oportunidades WHERE licitacion_id = 'p-otra'")
    .get();
  db.close();

  assert.deepEqual(
    { ...(otra as object) },
    { veredicto_ia: 'descartar', motivo_ia: 'Mantenimiento de ascensores, fuera de sector', confianza_ia: 0.9 },
  );
});

test('should_apply_fix_9_only_once', () => {
  const dir = path.join(tmp, 'fix9-una-vez');
  sembrarFix9(dir);
  abrirLicitaciones(dir).close();
  const sig = new Database(licitacionesFile(dir));
  sig.exec("UPDATE oportunidades SET motivo_ia = 'falta el perfil de licitaciones' WHERE licitacion_id = 'p-otra'");
  sig.close();

  const db = abrirLicitaciones(dir);
  const motivo = (
    db.prepare("SELECT motivo_ia FROM oportunidades WHERE licitacion_id = 'p-otra'").get() as { motivo_ia: string }
  ).motivo_ia;
  const version = db.pragma('user_version', { simple: true });
  db.close();

  assert.equal(version, ARREGLOS_TOTALES);
  assert.equal(motivo, 'falta el perfil de licitaciones', 'la segunda apertura no vuelve a ejecutar el arreglo');
});

test('should_create_the_comprobaciones_tables_and_columns_idempotently', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'comprobaciones-'));
  abrirLicitaciones(dir).close();
  const db = abrirLicitaciones(dir);
  const columnas = (t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  const tablas = [
    'oferta_bloqueos',
    'descartes_historial',
    'revisiones_usuario',
    'decisiones_historial',
    'lotes_interes_historial',
  ];
  const existentes = tablas.filter((t) => columnas(t).length > 0);
  const version = columnas('decisiones_oferta').includes('version');
  const identidad = columnas('oferta_documentos').includes('identidad');
  db.close();

  assert.deepEqual(existentes, tablas);
  assert.ok(version);
  assert.ok(identidad);
});

test('should_seed_version_1_history_for_decisions_saved_before_the_migration', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'comprobaciones-vieja-'));
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`CREATE TABLE decisiones_oferta (
    licitacion_id TEXT PRIMARY KEY, guion_id INTEGER NOT NULL, datos TEXT NOT NULL, actualizada_en TEXT NOT NULL);
    INSERT INTO decisiones_oferta VALUES ('d-1', 7, '{"a":1}', '2026-10-01T10:00:00Z');`);
  vieja.close();

  abrirLicitaciones(dir).close();
  const db = abrirLicitaciones(dir);
  const historial = db
    .prepare('SELECT licitacion_id, version, guion_id, datos, secciones, autor, creada_en FROM decisiones_historial')
    .all();
  const vigente = db.prepare("SELECT version FROM decisiones_oferta WHERE licitacion_id = 'd-1'").get();
  db.close();

  assert.deepEqual(historial, [
    {
      licitacion_id: 'd-1',
      version: 1,
      guion_id: 7,
      datos: '{"a":1}',
      secciones: '[]',
      autor: 'migración',
      creada_en: '2026-10-01T10:00:00Z',
    },
  ]);
  assert.deepEqual(vigente, { version: 1 });
});

// Las comprobaciones y la cola con los anexos regenerados llegaron por ramas distintas: las dos
// solo añaden columnas y tablas, sin arreglos numerados, así que user_version no se mueve.
test('should_create_the_comprobaciones_and_the_annex_plan_columns_on_an_empty_base', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'vacia-'));
  const db = abrirLicitaciones(dir);
  const columnas = (t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  const documentos = columnas('oferta_documentos');
  const guiones = columnas('guiones');
  const version = db.pragma('user_version', { simple: true });
  db.close();

  assert.deepEqual(
    ['anexo_dependencias', 'identidad', 'sustituciones', 'cambios_huecos'].filter((c) => !documentos.includes(c)),
    [],
  );
  assert.ok(guiones.includes('cambios'));
  assert.equal(version, ARREGLOS_TOTALES);
});

test('should_add_the_annex_plan_columns_to_a_base_already_migrated_with_the_comprobaciones_and_keep_its_rows', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'con-comprobaciones-'));
  const previa = abrirLicitaciones(dir);
  previa.exec(`ALTER TABLE oferta_documentos DROP COLUMN sustituciones; ALTER TABLE oferta_documentos DROP COLUMN cambios_huecos;
    ALTER TABLE guiones DROP COLUMN cambios;
    INSERT INTO oferta_documentos (licitacion_id, clave, nombre, estado, actualizado_en, identidad, anexo_dependencias)
      VALUES ('d-1', 'a1-d1', 'Anexo VI', 'borrador', 'x', 'anexo vi||', '{"precio":null}');
    INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en, version) VALUES ('d-1', 7, '{}', 'x', 3);`);
  previa.close();

  const db = abrirLicitaciones(dir);
  const fila = db
    .prepare(
      "SELECT identidad, anexo_dependencias, sustituciones, cambios_huecos FROM oferta_documentos WHERE clave = 'a1-d1'",
    )
    .get();
  const guiones = (db.prepare('PRAGMA table_info(guiones)').all() as { name: string }[]).map((c) => c.name);
  const decisiones = db.prepare("SELECT version FROM decisiones_oferta WHERE licitacion_id = 'd-1'").get();
  const historial = db.prepare('SELECT COUNT(*) AS n FROM decisiones_historial').get();
  const version = db.pragma('user_version', { simple: true });
  db.close();

  assert.deepEqual(fila, {
    identidad: 'anexo vi||',
    anexo_dependencias: '{"precio":null}',
    sustituciones: null,
    cambios_huecos: null,
  });
  assert.ok(guiones.includes('cambios'));
  assert.deepEqual(decisiones, { version: 3 }, 'la versión de las comprobaciones no se toca');
  assert.deepEqual(historial, { n: 0 }, 'el historial de las comprobaciones solo se siembra al crear su columna');
  assert.equal(version, ARREGLOS_TOTALES);
});

test('should_create_revision_tables_and_new_columns_on_an_existing_database', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'o4-'));
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`CREATE TABLE memoria_apartados (
      memoria_id INTEGER NOT NULL, apartado INTEGER NOT NULL, estado TEXT NOT NULL, PRIMARY KEY (memoria_id, apartado));
    INSERT INTO memoria_apartados VALUES (1, 1, 'pendiente');`);
  vieja.close();

  const db = abrirLicitaciones(dir);
  const columnas = (t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  const fila = db.prepare('SELECT dependencias, editado FROM memoria_apartados').get();
  const tablas = ['revision_tarjetas', 'revisiones_previas'].map((t) => columnas(t).length > 0);
  const pliegos = columnas('pliegos').includes('subido_por');
  db.close();

  assert.deepEqual(tablas, [true, true]);
  assert.ok(pliegos);
  assert.deepEqual(fila, { dependencias: '{}', editado: 0 });
});

test('should_keep_migration_idempotent_when_opened_twice', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'o4-bis-'));
  abrirLicitaciones(dir).close();

  const db = abrirLicitaciones(dir);
  db.prepare(
    "INSERT INTO revision_tarjetas (licitacion_id, clave, tipo, huella, creada_en) VALUES ('l', 'c', 'anexo', 'h', 'ahora')",
  ).run();
  const estado = db.prepare("SELECT estado FROM revision_tarjetas WHERE clave = 'c'").get();
  const falla = () =>
    db
      .prepare(
        "INSERT INTO revision_tarjetas (licitacion_id, clave, tipo, huella, creada_en) VALUES ('l', 'd', 'otro', 'h', 'ahora')",
      )
      .run();
  db.close();

  assert.deepEqual(estado, { estado: 'pendiente' });
  assert.throws(falla, /CHECK|closed|not open/);
});

// Fusión de la pista B en feat/experiencia: las tablas de las dos ramas conviven en una base vacía
// y una base ya migrada con feat/experiencia (f7341ef: telemetría, forzado_motivo) gana las de la
// pista B (O4s) sin perder filas.
const tablasDe = (db: Database.Database) =>
  new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name),
  );
const columnasDe = (db: Database.Database, t: string) =>
  (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
const DE_LA_PISTA_B = ['modelos_pdf', 'deuc_respuestas', 'revision_tarjetas', 'revisiones_previas'];

test('should_create_the_tables_of_both_tracks_on_an_empty_database', () => {
  // Arrange
  const dir = fs.mkdtempSync(path.join(tmp, 'vacia-'));

  // Act
  const db = abrirLicitaciones(dir);
  const tablas = tablasDe(db);
  const propuestas = columnasDe(db, 'propuestas');
  const apartados = columnasDe(db, 'memoria_apartados');
  const modelos = columnasDe(db, 'modelos_pdf');
  db.close();

  // Assert
  assert.deepEqual(
    ['telemetria_tareas', ...DE_LA_PISTA_B].filter((t) => !tablas.has(t)),
    [],
  );
  assert.ok(propuestas.includes('forzado_motivo'));
  assert.deepEqual(
    ['dependencias', 'editado'].filter((c) => !apartados.includes(c)),
    [],
  );
  assert.ok(modelos.includes('version_analisis'));
});

test('should_add_the_track_b_tables_to_a_database_migrated_at_f7341ef_and_keep_its_rows', () => {
  // Arrange: la base como la deja f7341ef, con filas de la telemetría, un registro forzado y un apartado.
  const dir = fs.mkdtempSync(path.join(tmp, 'f7341ef-'));
  const previa = abrirLicitaciones(dir);
  previa.exec(`${DE_LA_PISTA_B.map((t) => `DROP TABLE ${t};`).join(' ')}
    ALTER TABLE memoria_apartados DROP COLUMN dependencias; ALTER TABLE memoria_apartados DROP COLUMN editado;
    ALTER TABLE pliegos DROP COLUMN subido_por;
    INSERT INTO telemetria_tareas (licitacion_id, clave, tipo, persona, ms_foco, cerrada, creada_en) VALUES ('d-1', 'precio:2', 'fijar_precio', 'p1', 90000, 1, 'x');
    INSERT INTO propuestas (licitacion_id, presentada_en, forzado_motivo, creada_en, actualizada_en) VALUES ('d-1', '2026-10-10', 'El órgano amplió el plazo.', 'x', 'x');
    INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (1, 1, 'recibido');
    INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en) VALUES ('d-1', 'u', 'pcap', 'PCAP.pdf', 'descargado', 'x');`);
  const version = previa.pragma('user_version', { simple: true });
  previa.close();

  // Act
  const db = abrirLicitaciones(dir);
  const tablas = tablasDe(db);
  const telemetria = db.prepare('SELECT clave, ms_foco, cerrada FROM telemetria_tareas').all();
  const forzado = db.prepare('SELECT forzado_motivo FROM propuestas').get();
  const apartado = db.prepare('SELECT dependencias, editado FROM memoria_apartados').get();
  const pliego = db.prepare('SELECT subido_por FROM pliegos').get();
  const despues = db.pragma('user_version', { simple: true });
  db.close();
  const otraVez = abrirLicitaciones(dir);
  const filas = (otraVez.prepare('SELECT COUNT(*) AS n FROM telemetria_tareas').get() as { n: number }).n;
  otraVez.close();

  // Assert
  assert.deepEqual(
    DE_LA_PISTA_B.filter((t) => !tablas.has(t)),
    [],
  );
  assert.deepEqual(telemetria, [{ clave: 'precio:2', ms_foco: 90000, cerrada: 1 }]);
  assert.deepEqual(forzado, { forzado_motivo: 'El órgano amplió el plazo.' });
  assert.deepEqual(
    apartado,
    { dependencias: '{}', editado: 0 },
    'lo de antes queda sin dependencias: se mira el texto',
  );
  assert.deepEqual(pliego, { subido_por: null }, 'lo trajo la plataforma');
  assert.equal(despues, version, 'los arreglos de datos no se repiten');
  assert.equal(filas, 1, 'abrirla otra vez no cambia nada');
});

test('should_add_lote_column_to_memorias_idempotently', () => {
  // Arrange: una base de antes de la memoria por lote, con una memoria común.
  const dir = fs.mkdtempSync(path.join(tmp, 'memoria-lote-'));
  const previa = abrirLicitaciones(dir);
  previa.exec(`ALTER TABLE memorias DROP COLUMN lote;
    INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en) VALUES ('g-1', 1, 1, 'ensamblada', 'x');`);
  previa.close();

  // Act
  abrirLicitaciones(dir).close();
  const db = abrirLicitaciones(dir);
  const columnas = columnasDe(db, 'memorias');
  const antigua = db.prepare('SELECT version, lote FROM memorias').get();
  db.prepare(
    "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, lote) VALUES ('g-1', 1, 2, 'redactando', 'x', '4')",
  ).run();
  const repetida = () =>
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, lote) VALUES ('g-1', 1, 2, 'redactando', 'x', '2')",
      )
      .run();
  const falla = (() => {
    try {
      repetida();
      return null;
    } catch (err) {
      return err as Error;
    }
  })();
  db.close();

  // Assert
  assert.equal(columnas.filter((c) => c === 'lote').length, 1);
  assert.deepEqual(antigua, { version: 1, lote: null }, 'la memoria de antes es la común');
  assert.match(falla?.message ?? '', /UNIQUE/, 'la versión sigue siendo de la licitación, no del lote');
});

// El guion de CASO_E (pide una memoria por lote) y las decisiones de los lotes 2 y 4: de ahí sale qué
// lotes llevan memoria propia al migrar.
const GUION_POR_LOTE = JSON.stringify(
  (
    JSON.parse(fs.readFileSync(new URL('./fixtures/comprobaciones/casoE.json', import.meta.url), 'utf8')) as {
      guiones: { datos: unknown }[];
    }
  ).guiones.at(-1)!.datos,
);

function conMemoriaPorLote(db: InstanceType<typeof Database>, lic: string, lotes: string[]): void {
  db.prepare(
    "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, 'licitaciones', 1, 'x')",
  ).run(lic, GUION_POR_LOTE);
  db.prepare(
    "INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, 1, ?, 'x')",
  ).run(lic, JSON.stringify({ lotes }));
}

// Arreglo 10: las presentadas de antes guardaron el lote solo en el resumen del borrador.
function sembrarPresentadasSinLote(dir: string): void {
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  conMemoriaPorLote(vieja, 'casoE', ['2', '4']);
  conMemoriaPorLote(vieja, 'otra', ['2', '4']);
  const memoria = (id: number, lic: string, version: number, lote: string | null, presentada: number) =>
    `INSERT INTO memorias (id, licitacion_id, guion_id, version, estado, pedida_en, borrador_id, lote, presentada) VALUES (${id}, '${lic}', 1, ${version}, 'ensamblada', 'x', ${id}, ${lote === null ? 'NULL' : `'${lote}'`}, ${presentada});`;
  const borrador = (id: number, lic: string, resumen: string) =>
    `INSERT INTO borradores (id, licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en) VALUES (${id}, '${lic}', 'r${id}', 'x', 1, '${resumen}', 'persona', 'x');`;
  vieja.exec(
    [
      // CASO_E: memoria de trabajo de los lotes 2 y 4; la presentada del 4 subida sin lote.
      memoria(1, 'casoE', 1, '2', 0),
      borrador(1, 'casoE', 'Memoria'),
      memoria(2, 'casoE', 2, '4', 0),
      borrador(2, 'casoE', 'Memoria'),
      memoria(3, 'casoE', 3, null, 1),
      borrador(3, 'casoE', 'Memoria técnica v3 presentada («Memoria, lote 4.pdf»), lote 4.'),
      // Otra oferta que sube después la del lote 2 cuando ya se guarda por lote: la antigua sin lote queda sustituida.
      memoria(4, 'otra', 1, '2', 0),
      borrador(4, 'otra', 'Memoria'),
      memoria(5, 'otra', 2, null, 1),
      borrador(5, 'otra', 'Memoria técnica v2 presentada («M.pdf»), lote 2.'),
      memoria(6, 'otra', 3, '2', 1),
      borrador(6, 'otra', 'Memoria técnica v3 presentada («M2.pdf»), lote 2.'),
      // Villaejemplo: una memoria común; se dijo el lote al subirla, pero su guion no pide una por lote.
      memoria(7, 'casoC', 1, null, 1),
      borrador(7, 'casoC', 'Memoria técnica v1 presentada («A.pdf»), lote 1.'),
      'PRAGMA user_version = 9;',
    ].join('\n'),
  );
  vieja.close();
}

test('should_fill_the_lote_of_presentadas_uploaded_before_ff01_from_their_summary_once', () => {
  // Arrange
  const dir = path.join(tmp, 'fix10');
  sembrarPresentadasSinLote(dir);

  // Act
  const db = abrirLicitaciones(dir);
  const filas = db
    .prepare('SELECT id, lote, presentada FROM memorias WHERE id IN (3, 5, 6, 7) ORDER BY id')
    .all()
    .map((f) => ({ ...(f as object) }));
  const version = db.pragma('user_version', { simple: true });
  db.close();

  // Assert
  assert.deepEqual(filas, [
    { id: 3, lote: '4', presentada: 1 },
    { id: 5, lote: '2', presentada: 2 },
    { id: 6, lote: '2', presentada: 1 },
    { id: 7, lote: null, presentada: 1 },
  ]);
  assert.equal(version, ARREGLOS_TOTALES);
});

// Una base de main (user_version 8, sin memorias.lote): sustituir pasaba a 2 la presentada de
// cualquier otro lote, así que la del lote 4 quedó como sustituida al subir la del 2.
test('should_give_each_lot_its_submitted_memory_on_a_base_from_main', () => {
  // Arrange
  const dir = fs.mkdtempSync(path.join(tmp, 'fix10-main-'));
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  conMemoriaPorLote(vieja, 'casoE', ['2', '4']);
  const borrador = vieja.prepare(
    "INSERT INTO borradores (id, licitacion_id, ruta, sha256, bytes, resumen, agente, registrado_en) VALUES (?, 'casoE', ?, 'x', 1, ?, 'persona', 'x')",
  );
  const memoria = vieja.prepare(
    "INSERT INTO memorias (id, licitacion_id, guion_id, version, estado, pedida_en, borrador_id, presentada) VALUES (?, 'casoE', 1, ?, 'ensamblada', 'x', ?, ?)",
  );
  borrador.run(1, 'r1', 'Memoria técnica v1 presentada («Memoria lote 4.docx»), lote 4.');
  memoria.run(1, 1, 1, 2);
  borrador.run(2, 'r2', 'Memoria técnica v2 presentada («Memoria final.docx»), lote 2.');
  memoria.run(2, 2, 2, 1);
  vieja.exec('ALTER TABLE memorias DROP COLUMN lote; PRAGMA user_version = 8;');
  vieja.close();

  // Act
  const db = abrirLicitaciones(dir);
  const filas = db
    .prepare('SELECT id, lote, presentada FROM memorias ORDER BY id')
    .all()
    .map((f) => ({ ...(f as object) }));
  const version = db.pragma('user_version', { simple: true });
  db.close();

  // Assert
  assert.deepEqual(
    filas,
    [
      { id: 1, lote: '4', presentada: 1 },
      { id: 2, lote: '2', presentada: 1 },
    ],
    'cada lote con su presentada: ninguno cierra la oferta entera',
  );
  assert.equal(version, ARREGLOS_TOTALES);
});

// 12: las lecciones de antes (todas de una edición a mano) pasan al libro de lecciones con su
// evidencia en la lista, el Word del que salieron y el tema del apartado; los ids no cambian.
test('should_move_old_lessons_to_the_lesson_book_with_origin_theme_and_evidence', () => {
  // Arrange
  const dir = fs.mkdtempSync(path.join(tmp, 'fix12-'));
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`DROP TABLE lecciones;
    CREATE TABLE lecciones (
      id INTEGER PRIMARY KEY, licitacion_id TEXT NOT NULL, memoria_id INTEGER NOT NULL, apartado INTEGER, apartado_titulo TEXT,
      alcance TEXT NOT NULL CHECK (alcance IN ('general', 'licitacion')), texto TEXT NOT NULL, evidencia TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aceptada', 'descartada')),
      agente TEXT NOT NULL, trabajo_id INTEGER, creada_en TEXT NOT NULL, revisada_en TEXT);
    CREATE INDEX lecciones_memoria ON lecciones(memoria_id, estado);
    INSERT INTO memorias (id, licitacion_id, guion_id, version, estado, pedida_en, subida) VALUES (7, 'alm', 1, 3, 'ensamblada', 'x', 'memoria-revisada.docx');
    INSERT INTO lecciones VALUES (41, 'alm', 7, 2, 'Cronograma de ejecución', 'licitacion', 'Pon el calendario en una tabla semanal.', '+ Semana 1: diagnóstico', 'aceptada', 'licitaciones', NULL, '2026-10-01', '2026-10-02');
    INSERT INTO lecciones VALUES (42, 'alm', 7, NULL, NULL, 'general', 'Escribe los compromisos sin condicionales.', '', 'pendiente', 'licitaciones', NULL, '2026-10-01', NULL);
    PRAGMA user_version = 11;`);
  vieja.close();

  // Act
  const db = abrirLicitaciones(dir);
  const filas = db
    .prepare('SELECT id, origen, alcance, alcance_valor, tema, fuerza, estado, evidencias FROM lecciones ORDER BY id')
    .all() as { evidencias: string }[];
  const indices = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'lecciones'").all() as {
      name: string;
    }[]
  )
    .map((i) => i.name)
    .sort();
  const version = db.pragma('user_version', { simple: true });
  db.close();

  // Assert
  assert.deepEqual(
    filas.map((f) => ({ ...f, evidencias: JSON.parse(f.evidencias) })),
    [
      {
        id: 41,
        origen: 'edicion',
        alcance: 'licitacion',
        alcance_valor: 'alm',
        tema: 'planificacion',
        fuerza: 1,
        estado: 'aceptada',
        evidencias: [
          {
            licitacion_id: 'alm',
            memoria_id: 7,
            documento: 'memoria-revisada.docx',
            ubicacion: 'apartado 2 · Cronograma de ejecución',
            texto: '+ Semana 1: diagnóstico',
          },
        ],
      },
      {
        id: 42,
        origen: 'edicion',
        alcance: 'general',
        alcance_valor: null,
        tema: null,
        fuerza: 1,
        estado: 'pendiente',
        evidencias: [
          {
            licitacion_id: 'alm',
            memoria_id: 7,
            documento: 'memoria-revisada.docx',
            ubicacion: 'toda la memoria',
            texto: '',
          },
        ],
      },
    ],
  );
  assert.deepEqual(indices, ['lecciones_estado', 'lecciones_memoria']);
  assert.equal(version, ARREGLOS_TOTALES);
});

// 19: las memorias que se redactaban por apartados y seguían abiertas no tienen quien las termine y
// pasan a fallidas; las ensambladas y las que ya van por fases se conservan, y la columna del
// método desaparece.
function baseConMemoriasAntiguas(nombre: string): string {
  const dir = fs.mkdtempSync(path.join(tmp, nombre));
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`ALTER TABLE memorias ADD COLUMN pipeline TEXT NOT NULL DEFAULT 'v1';
    INSERT INTO memorias (id, licitacion_id, guion_id, version, estado, fase, pedida_en) VALUES
      (1, 'alm', 1, 1, 'redactando', NULL, 'x'),
      (2, 'alm', 1, 2, 'ensamblando', NULL, 'x'),
      (3, 'alm', 1, 3, 'ensamblada', NULL, 'x'),
      (4, 'alm', 1, 4, 'redactando', 'redaccion', 'x'),
      (5, 'alm', 1, 5, 'fallida', NULL, 'x');
    PRAGMA user_version = 18;`);
  vieja.close();
  return dir;
}

test('should_fail_open_memorias_without_phase_and_keep_the_rest_when_retiring_the_apartado_method', () => {
  // Arrange
  const dir = baseConMemoriasAntiguas('fix19-');

  // Act
  const db = abrirLicitaciones(dir);
  const filas = db.prepare('SELECT id, estado, fase, error FROM memorias ORDER BY id').all() as {
    id: number;
    estado: string;
    fase: string | null;
    error: string | null;
  }[];
  const version = db.pragma('user_version', { simple: true });
  db.close();

  // Assert
  assert.deepEqual(
    filas.map((f) => [f.id, f.estado, f.fase]),
    [
      [1, 'fallida', null],
      [2, 'fallida', null],
      [3, 'ensamblada', null],
      [4, 'redactando', 'redaccion'],
      [5, 'fallida', null],
    ],
  );
  assert.match(filas[0]!.error ?? '', /se redactaba por apartados, un método que ya no existe: pídela de nuevo/);
  assert.equal(filas[1]!.error, filas[0]!.error);
  assert.deepEqual([filas[2]!.error, filas[3]!.error, filas[4]!.error], [null, null, null], 'el resto no se toca');
  assert.equal(version, ARREGLOS_TOTALES);
});

test('should_drop_the_pipeline_column_once_and_not_create_it_on_a_new_database', () => {
  // Arrange
  const dir = baseConMemoriasAntiguas('fix19-columna-');
  const columnas = (d: ReturnType<typeof abrirLicitaciones>) =>
    (d.prepare('PRAGMA table_info(memorias)').all() as { name: string }[]).map((c) => c.name);

  // Act
  const migrada = abrirLicitaciones(dir);
  const trasMigrar = columnas(migrada);
  migrada.close();
  const otraVez = abrirLicitaciones(dir);
  const trasReabrir = columnas(otraVez);
  const memorias = (otraVez.prepare('SELECT COUNT(*) AS n FROM memorias').get() as { n: number }).n;
  otraVez.close();
  const nueva = abrirLicitaciones(fs.mkdtempSync(path.join(tmp, 'fix19-nueva-')));
  const columnasNueva = columnas(nueva);
  nueva.close();

  // Assert
  assert.ok(!trasMigrar.includes('pipeline'), 'la migración quita la columna');
  assert.ok(!trasReabrir.includes('pipeline'), 'abrirla otra vez no la devuelve');
  assert.equal(memorias, 5, 'sin perder filas');
  assert.ok(!columnasNueva.includes('pipeline'), 'una base nueva no la tiene');
  assert.ok(columnasNueva.includes('fase'));
});

// 20: lo que la 19 dejó a medias. Una memoria del método anterior con todos sus apartados recibidos
// se puede montar sin IA (vuelve a «ensamblando» y la monta reanudarEnsamblados); una base que nunca
// tuvo la columna del método no deja memorias sin fase redactándose para siempre.
const MOTIVO_19 = 'Esta memoria se redactaba por apartados, un método que ya no existe: pídela de nuevo.';
type FilaMigrada = { id: number; estado: string; error: string | null };
const memoriasMigradas = (d: ReturnType<typeof abrirLicitaciones>) =>
  d.prepare('SELECT id, estado, error FROM memorias ORDER BY id').all() as FilaMigrada[];

test('should_reopen_for_assembly_the_old_memorias_that_have_every_section_and_keep_the_rest_failed', () => {
  // Arrange: una base en la que la 19 ya corrió.
  const dir = fs.mkdtempSync(path.join(tmp, 'fix20-'));
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja
    .prepare(
      `INSERT INTO memorias (id, licitacion_id, guion_id, version, estado, fase, pedida_en, error, subida) VALUES
      (1, 'alm', 1, 1, 'fallida', NULL, 'x', @m, NULL),
      (2, 'alm', 1, 2, 'fallida', NULL, 'x', @m, NULL),
      (3, 'alm', 1, 3, 'fallida', NULL, 'x', 'Otro fallo.', NULL),
      (4, 'alm', 1, 4, 'fallida', NULL, 'x', @m, 'subida.docx')`,
    )
    .run({ m: MOTIVO_19 });
  vieja.exec(`INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES
      (1, 1, 'recibido'), (1, 2, 'recibido'),
      (2, 1, 'recibido'), (2, 2, 'pendiente'),
      (3, 1, 'recibido'),
      (4, 1, 'recibido');
    PRAGMA user_version = 19;`);
  vieja.close();

  // Act
  const db = abrirLicitaciones(dir);
  const filas = memoriasMigradas(db);
  const version = db.pragma('user_version', { simple: true });
  db.close();

  // Assert
  assert.deepEqual(
    filas.map((f) => [f.id, f.estado]),
    [
      [1, 'ensamblando'],
      [2, 'fallida'],
      [3, 'fallida'],
      [4, 'fallida'],
    ],
  );
  assert.equal(filas[0]!.error, null);
  assert.deepEqual([filas[1]!.error, filas[2]!.error], [MOTIVO_19, 'Otro fallo.'], 'el resto, tal cual');
  assert.equal(version, ARREGLOS_TOTALES);
});

test('should_close_open_memorias_without_phase_on_a_base_that_never_had_the_method_column', () => {
  // Arrange: sin columna pipeline, la 19 no hace nada.
  const dir = fs.mkdtempSync(path.join(tmp, 'fix20-sin-columna-'));
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`INSERT INTO memorias (id, licitacion_id, guion_id, version, estado, fase, pedida_en) VALUES
      (1, 'alm', 1, 1, 'redactando', NULL, 'x'),
      (2, 'alm', 1, 2, 'ensamblando', NULL, 'x'),
      (3, 'alm', 1, 3, 'redactando', 'redaccion', 'x');
    INSERT INTO memoria_apartados (memoria_id, apartado, estado) VALUES (1, 1, 'pendiente'), (2, 1, 'recibido');
    PRAGMA user_version = 18;`);
  vieja.close();

  // Act
  const db = abrirLicitaciones(dir);
  const filas = memoriasMigradas(db);
  db.close();

  // Assert
  assert.deepEqual(
    filas.map((f) => [f.id, f.estado, f.error]),
    [
      [1, 'fallida', MOTIVO_19],
      [2, 'ensamblando', null],
      [3, 'redactando', null],
    ],
  );
});

test('should_rename_the_stored_hecho_v2_comprobaciones_keys_once', () => {
  // Arrange
  const dir = fs.mkdtempSync(path.join(tmp, 'fix21-'));
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`INSERT INTO oferta_bloqueos (licitacion_id, clave, huella, estado, quien, en) VALUES
      ('alm', 'hecho_v2:2:3-abcd1234', 'h', 'riesgo_aceptado', 'Persona A', 'x'),
      ('alm', 'fuga:2:1', 'h', 'vamos', 'Persona A', 'x');
    PRAGMA user_version = 20;`);
  vieja.close();

  // Act
  abrirLicitaciones(dir).close();
  const db = abrirLicitaciones(dir);
  const claves = (db.prepare('SELECT clave FROM oferta_bloqueos ORDER BY id').all() as { clave: string }[]).map(
    (f) => f.clave,
  );
  db.close();

  // Assert
  assert.deepEqual(claves, ['hecho:2:3-abcd1234', 'fuga:2:1']);
});

test('should_rename_the_live_memoria2_job_keys_in_nucleo_and_keep_the_completed_ones', async () => {
  // Arrange
  const { abrirNucleo } = await import('../../src/nucleo/db.js');
  const dir = fs.mkdtempSync(path.join(tmp, 'fix22-'));
  abrirLicitaciones(dir).close();
  const nucleo = abrirNucleo(dir);
  const insertar = nucleo.prepare(
    "INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, creado_en, actualizado_en) VALUES ('t', 'licitaciones', ?, '{}', ?, 'x', 'x')",
  );
  for (const [clave, estado] of [
    ['memoria2-p-1-v3-estrategia', 'pendiente'],
    ['memoria2-p-1-v3-r0', 'lanzado'],
    ['memoria2-p-1-v3-critica-r0', 'fallido'],
    ['memoria2-p-1-v2-r0', 'completado'],
    ['anexo-p-1-a1', 'pendiente'],
  ])
    insertar.run(clave, estado);
  nucleo.close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`PRAGMA user_version = ${ARREGLOS_TOTALES - 2};`);
  vieja.close();

  // Act
  abrirLicitaciones(dir).close();
  const leer = new Database(path.join(dir, 'nucleo.db'));
  const claves = (leer.prepare('SELECT clave FROM trabajos_ia ORDER BY id').all() as { clave: string }[]).map(
    (f) => f.clave,
  );
  leer.close();

  // Assert
  assert.deepEqual(claves, [
    'memoria-p-1-v3-estrategia',
    'memoria-p-1-v3-r0',
    'memoria-p-1-v3-critica-r0',
    'memoria2-p-1-v2-r0',
    'anexo-p-1-a1',
  ]);
});

test('should_rename_the_en_cabina_column_of_preguntas_pliego_once_and_keep_its_rows', () => {
  // Arrange
  const dir = fs.mkdtempSync(path.join(tmp, 'fix23-'));
  abrirLicitaciones(dir).close();
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`ALTER TABLE preguntas_pliego RENAME COLUMN en_comprobaciones TO en_cabina;
    INSERT INTO preguntas_pliego (licitacion_id, pregunta, quien, estado, en_cabina, creada_en)
      VALUES ('alm', '¿Hay seguro?', 'Persona A', 'respondida', 1, 'x');
    PRAGMA user_version = 22;`);
  vieja.close();

  // Act
  abrirLicitaciones(dir).close();
  const db = abrirLicitaciones(dir);
  const columnas = (db.prepare('PRAGMA table_info(preguntas_pliego)').all() as { name: string }[]).map((c) => c.name);
  const fila = db.prepare('SELECT en_comprobaciones FROM preguntas_pliego').get();
  const version = db.pragma('user_version', { simple: true });
  db.close();

  // Assert
  assert.equal(columnas.includes('en_cabina'), false);
  assert.deepEqual(fila, { en_comprobaciones: 1 });
  assert.equal(version, ARREGLOS_TOTALES);
});
