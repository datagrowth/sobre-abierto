// La escala de los rankings de competencia (Ajustes › Fuentes y filtros): territorio y banda por
// defecto, aparte del prefiltro y del perfil de la empresa. Sin guardar, toda España y sin banda.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirLicitaciones } from '../../src/dominios/licitaciones/store.js';
import { ESCALA_NEUTRA, guardarEscala, leerEscala } from '../../src/dominios/licitaciones/competencia/escala.js';

const dbVacia = () => abrirLicitaciones(fs.mkdtempSync(path.join(os.tmpdir(), 'escala-')));

test('should_start_with_all_spain_and_no_band', () => {
  const db = dbVacia();
  assert.deepEqual(leerEscala(db), ESCALA_NEUTRA);
  db.close();
});

test('should_save_region_and_band_and_read_them_back', () => {
  const db = dbVacia();
  assert.deepEqual(guardarEscala(db, { region_nuts: 'es70', banda_min: 7_000, banda_max: 130_000 }).data, {
    region_nuts: 'ES70',
    banda_min: 7_000,
    banda_max: 130_000,
  });
  assert.deepEqual(leerEscala(db), { region_nuts: 'ES70', banda_min: 7_000, banda_max: 130_000 });
  assert.deepEqual(
    guardarEscala(db, { region_nuts: '', banda_min: 7_000 }).data,
    { region_nuts: null, banda_min: 7_000, banda_max: null },
    'en blanco, toda España; un extremo suelto vale',
  );
  db.close();
});

test('should_reject_a_foreign_region_an_upside_down_band_and_unknown_fields', () => {
  const db = dbVacia();
  assert.equal(guardarEscala(db, { region_nuts: 'FR10' }).error?.code, 'invalid_input');
  assert.match(guardarEscala(db, { banda_min: 130_000, banda_max: 7_000 }).error?.message ?? '', /de menos a más/);
  assert.equal(guardarEscala(db, { region: 'ES7' }).error?.code, 'invalid_input');
  assert.deepEqual(leerEscala(db), ESCALA_NEUTRA, 'nada inválido se guarda');
  db.close();
});
