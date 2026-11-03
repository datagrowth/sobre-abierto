// Identidad de las organizaciones: NIF con su control, clase de entidad, nombre
// canónico, UTE separadas en sus miembros, provincia, y su guardado y relleno en nucleo.db.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  claseNif,
  esUte,
  estadoNif,
  miembrosUte,
  nombreCanonico,
  normalizarNif,
  provinciaDeCp,
} from '../../src/nucleo/identidad.js';
import { abrirNucleo } from '../../src/nucleo/db.js';
import {
  guardarOrganizacion,
  miembrosDeUte,
  obtenerOrganizacion,
  utesDeEmpresa,
} from '../../src/nucleo/organizaciones.js';

test('should_strip_spaces_dots_dashes_and_the_es_prefix_when_normalizing_a_nif', () => {
  assert.equal(normalizarNif(' es-b.0076543 8 '), 'B00765438');
  assert.equal(normalizarNif('ES12345678Z'), '12345678Z');
  assert.equal(normalizarNif('ESTONIA1'), 'ESTONIA1');
});

test('should_check_the_control_character_of_dni_nie_and_cif', () => {
  for (const nif of ['12345678Z', 'X1234567L', 'B00765438', 'A00000075', 'Q0000001H', 'ESB00765438'])
    assert.equal(estadoNif(nif), 'valido', nif);
  for (const nif of ['12345678A', 'X1234567A', 'B12345678', 'Q0000001A', 'A0000007A', '123', ''])
    assert.equal(estadoNif(nif), 'no_valido', nif);
  assert.equal(estadoNif('FR12345678901'), 'extranjero');
});

test('should_classify_a_nif_by_its_first_character', () => {
  assert.equal(claseNif('12345678Z'), 'persona_fisica');
  assert.equal(claseNif('X1234567L'), 'persona_fisica');
  assert.equal(claseNif('Q0000001H'), 'organismo');
  assert.equal(claseNif('U12345674'), 'ute');
  assert.equal(claseNif('B00765438'), 'empresa');
});

test('should_group_aliases_under_one_canonical_name', () => {
  const variantes = [
    'Sistemas Ejemplo, S.A.',
    'SISTEMAS EJEMPLO SA',
    'Sistemas  Ejemplo S.A.U.',
    'sistemas ejemplo, sociedad anónima',
  ];
  assert.deepEqual(new Set(variantes.map(nombreCanonico)), new Set(['sistemas ejemplo']));
  assert.equal(nombreCanonico('Ejemplo & Asociados, S.L.'), 'ejemplo y asociados');
});

test('should_split_a_joint_venture_into_its_members_without_splitting_names_with_y', () => {
  assert.deepEqual(miembrosUte('UTE Sistemas Ejemplo, S.A. - Analítica Ejemplo SL'), [
    'Sistemas Ejemplo, S.A.',
    'Analítica Ejemplo SL',
  ]);
  assert.deepEqual(miembrosUte('SISTEMAS EJEMPLO SA Y ANALÍTICA EJEMPLO SL UTE'), [
    'SISTEMAS EJEMPLO SA',
    'ANALÍTICA EJEMPLO SL',
  ]);
  assert.deepEqual(miembrosUte('Unión Temporal de Empresas Alfa SL / Beta SA'), ['Alfa SL', 'Beta SA']);
  assert.deepEqual(miembrosUte('Construcciones y Contratas, S.A.'), []);
  assert.deepEqual(miembrosUte('UTE Ley 18/1982 Acme'), []);
  assert.equal(esUte(null, 'UTE Alfa - Beta'), true);
  assert.equal(esUte('U12345674', 'Alfa Beta'), true);
  assert.equal(esUte('B00765438', 'Utensilios Canarios SL'), false);
});

test('should_derive_the_province_from_a_spanish_postal_code', () => {
  assert.equal(provinciaDeCp('35001'), 'Las Palmas');
  assert.equal(provinciaDeCp('38003'), 'Santa Cruz de Tenerife');
  assert.equal(provinciaDeCp('99001'), null);
  assert.equal(provinciaDeCp('F-75001'), null);
  assert.equal(provinciaDeCp(null), null);
});

function nucleoTemporal(): Database.Database {
  return abrirNucleo(fs.mkdtempSync(path.join(os.tmpdir(), 'identidad-')));
}

test('should_store_identity_aliases_and_province_when_saving_an_organization', () => {
  const db = nucleoTemporal();
  guardarOrganizacion(db, { nif: 'ES-B00765438', nombre: 'SISTEMAS EJEMPLO SA', tipo: 'empresa' });
  guardarOrganizacion(db, { nif: 'B00765438', nombre: 'Sistemas Ejemplo, S.A.', tipo: 'empresa' });
  guardarOrganizacion(db, { nif: 'Q0000001H', nombre: 'Cabildo', tipo: 'organismo', cp: '35003' });
  const ejemplo = obtenerOrganizacion(db, 'B00765438');
  assert.equal(ejemplo?.nombre_canonico, 'sistemas ejemplo');
  assert.deepEqual(JSON.parse(ejemplo?.alias ?? ''), ['SISTEMAS EJEMPLO SA', 'Sistemas Ejemplo, S.A.']);
  assert.equal(ejemplo?.nif_estado, 'valido');
  assert.equal(obtenerOrganizacion(db, 'Q0000001H')?.provincia, 'Las Palmas');
  guardarOrganizacion(db, { nif: 'B12345678', nombre: 'Mal Escrita SL', tipo: 'empresa' });
  assert.equal(obtenerOrganizacion(db, 'B12345678')?.nif_estado, 'no_valido');
});

test('should_link_joint_venture_members_by_name_including_companies_seen_later', () => {
  const db = nucleoTemporal();
  guardarOrganizacion(db, { nif: 'B00765438', nombre: 'Sistemas Ejemplo, S.A.', tipo: 'empresa' });
  guardarOrganizacion(db, {
    nif: 'U76543214',
    nombre: 'UTE SISTEMAS EJEMPLO SA - ANALÍTICA EJEMPLO SL',
    tipo: 'empresa',
  });
  assert.equal(obtenerOrganizacion(db, 'U76543214')?.es_ute, 1);
  assert.deepEqual(
    miembrosDeUte(db, 'U76543214').map((m) => [m.nombre, m.nif]),
    [
      ['ANALÍTICA EJEMPLO SL', null],
      ['SISTEMAS EJEMPLO SA', 'B00765438'],
    ],
  );
  guardarOrganizacion(db, { nif: 'A00000075', nombre: 'Analítica Ejemplo, S.L.', tipo: 'empresa' });
  assert.deepEqual(utesDeEmpresa(db, 'A00000075'), ['U76543214']);
  assert.deepEqual(utesDeEmpresa(db, 'B00765438'), ['U76543214']);
});

test('should_not_link_a_member_when_two_companies_share_its_name', () => {
  const db = nucleoTemporal();
  guardarOrganizacion(db, { nif: 'B00765438', nombre: 'Alfa SL', tipo: 'empresa' });
  guardarOrganizacion(db, { nif: 'A00000075', nombre: 'ALFA, S.L.', tipo: 'empresa' });
  guardarOrganizacion(db, { nif: 'U76543214', nombre: 'UTE Alfa SL - Beta SA', tipo: 'empresa' });
  assert.equal(miembrosDeUte(db, 'U76543214').find((m) => m.nombre === 'Alfa SL')?.nif, null);
});

test('should_backfill_identity_and_merge_es_prefixed_nifs_when_opening_an_old_nucleo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'identidad-vieja-'));
  const vieja = new Database(path.join(dir, 'nucleo.db'));
  vieja.exec(`CREATE TABLE organizaciones (nif TEXT PRIMARY KEY, nombre TEXT NOT NULL, tipo TEXT NOT NULL, dir3 TEXT, ciudad TEXT, nuts TEXT, actualizada_en TEXT NOT NULL);
    INSERT INTO organizaciones VALUES ('B00765438', 'Sistemas Ejemplo SA', 'empresa', NULL, NULL, NULL, '2026-01-01'),
      ('ESB00765438', 'SISTEMAS EJEMPLO', 'empresa', NULL, NULL, NULL, '2026-01-01'),
      ('ESA00000075', 'Analítica Ejemplo SL', 'empresa', NULL, NULL, NULL, '2026-01-01'),
      ('U76543214', 'UTE Sistemas Ejemplo SA - Analítica Ejemplo SL', 'empresa', NULL, NULL, NULL, '2026-01-01');`);
  vieja.close();
  const db = abrirNucleo(dir);
  assert.deepEqual(
    (db.prepare('SELECT nif FROM organizaciones ORDER BY nif').all() as { nif: string }[]).map((f) => f.nif),
    ['A00000075', 'B00765438', 'U76543214'],
  );
  assert.equal(obtenerOrganizacion(db, 'A00000075')?.nombre_canonico, 'analitica ejemplo');
  assert.deepEqual(
    miembrosDeUte(db, 'U76543214')
      .map((m) => m.nif)
      .sort(),
    ['A00000075', 'B00765438'],
  );
});
