// Perfil de la empresa: los campos nuevos tienen valor por defecto, así que un perfil guardado
// antes sigue validando; los nuevos se validan con su forma.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import {
  PerfilEmpresa,
  municipioDe,
  cerrarPropuestaEmpresa,
  guardarPerfilEmpresa,
  importesEnTexto,
  importesMalLeidos,
  leerPerfilEmpresa,
  perfilParaAgentes,
  leerPropuestaEmpresa,
  proponerPerfilEmpresa,
} from '../../src/nucleo/empresa.js';
import {
  EMPRESA_EJEMPLO,
  NIF_EJEMPLO,
  NOMBRE_EJEMPLO,
  VOLUMEN_2024,
  VOLUMEN_2025,
} from '../fixtures/empresaEjemplo.js';

const ANTERIOR = {
  nif: NIF_EJEMPLO,
  nombre: NOMBRE_EJEMPLO,
  clasificaciones: [],
  volumen_negocio: [VOLUMEN_2025],
  certificaciones: [],
  seguro_rc: null,
  plantilla_media: EMPRESA_EJEMPLO.plantilla_media,
  anios_actividad: 2,
  cpv_experiencia: ['72'],
  mayor_contrato_similar: null,
  notas: '',
};

test('should_accept_profile_saved_before_new_fields', () => {
  const r = PerfilEmpresa.safeParse(ANTERIOR);
  assert.ok(r.success);
  assert.equal(r.data.tamano, null);
  assert.equal(r.data.fecha_constitucion, null);
});

test('should_validate_size_and_founding_date', () => {
  const bien = PerfilEmpresa.safeParse({ ...ANTERIOR, tamano: 'micro', fecha_constitucion: '2023-09-29' });
  assert.ok(bien.success);
  assert.equal(PerfilEmpresa.safeParse({ ...ANTERIOR, fecha_constitucion: '29/09/2023' }).success, false);
  assert.equal(PerfilEmpresa.safeParse({ ...ANTERIOR, tamano: 'enorme' }).success, false);
});

test('should_still_read_a_saved_profile_with_retired_fields', () => {
  const { db, cerrar } = nucleoTemporal();
  try {
    // Arrange: guardado antes de retirar la sede, el CNAE y los certificados.
    const viejo = {
      ...ANTERIOR,
      nuts_sede: 'ES709',
      cnae: ['6201'],
      al_corriente: [{ organismo: 'aeat', caduca: '2026-12-28' }],
    };
    db.prepare('INSERT INTO perfil_empresa (id, datos, actualizado_en) VALUES (1, ?, ?)').run(
      JSON.stringify(viejo),
      '2026-10-01T00:00:00Z',
    );
    // Act
    const leido = leerPerfilEmpresa(db);
    // Assert
    assert.equal(leido?.perfil.nif, NIF_EJEMPLO);
    assert.equal('nuts_sede' in (leido?.perfil ?? {}), false);
    assert.equal(PerfilEmpresa.safeParse(viejo).success, false, 'al guardar ya no se aceptan');
  } finally {
    cerrar();
  }
});

test('should_accept_representative_and_contact_with_blank_optional_fields', () => {
  const antes = PerfilEmpresa.parse(ANTERIOR);
  assert.deepEqual([antes.representante, antes.contacto], [null, null], 'un perfil guardado antes sigue validando');
  const r = PerfilEmpresa.parse({
    ...ANTERIOR,
    representante: { nombre: 'Ana García Pérez', nif: '12.345.678-z', cargo: '' },
    contacto: { email: 'hola@example.com', telefono: '' },
  });
  assert.deepEqual(r.representante, { nombre: 'Ana García Pérez', nif: '12345678Z', cargo: null });
  assert.deepEqual(r.contacto, { email: 'hola@example.com', telefono: null });
  assert.equal(
    PerfilEmpresa.safeParse({ ...ANTERIOR, contacto: { email: 'no-es-un-correo', telefono: '922 000 000' } }).success,
    false,
  );
  assert.equal(PerfilEmpresa.safeParse({ ...ANTERIOR, representante: { nombre: 'Ana', nif: '123' } }).success, false);
});

function nucleoTemporal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'empresa-'));
  const db = abrirNucleo(dir);
  return {
    db,
    cerrar: () => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('should_keep_the_saved_profile_untouched_when_an_agent_proposes_one', () => {
  const { db, cerrar } = nucleoTemporal();
  try {
    assert.equal(guardarPerfilEmpresa(db, ANTERIOR).error, null);
    const r = proponerPerfilEmpresa(
      db,
      { ...ANTERIOR, plantilla_media: 8, tamano: 'micro' },
      'claude-code',
      'Datos del Modelo 200 y de la escritura',
    );
    assert.equal(r.error, null);
    assert.equal(leerPerfilEmpresa(db)?.perfil.plantilla_media, EMPRESA_EJEMPLO.plantilla_media);
    const p = leerPropuestaEmpresa(db);
    assert.equal(p?.perfil.plantilla_media, 8);
    assert.equal(p?.agente, 'claude-code');
    assert.equal(p?.motivo, 'Datos del Modelo 200 y de la escritura');
  } finally {
    cerrar();
  }
});

test('should_replace_the_previous_proposal_and_close_it_once', () => {
  const { db, cerrar } = nucleoTemporal();
  try {
    proponerPerfilEmpresa(db, ANTERIOR, 'hermes', 'primera propuesta');
    proponerPerfilEmpresa(db, { ...ANTERIOR, anios_actividad: 3 }, 'claude-code', 'segunda propuesta');
    assert.equal(leerPropuestaEmpresa(db)?.agente, 'claude-code');
    assert.equal(cerrarPropuestaEmpresa(db), true);
    assert.equal(cerrarPropuestaEmpresa(db), false);
    assert.equal(leerPropuestaEmpresa(db), null);
  } finally {
    cerrar();
  }
});

test('should_return_an_error_and_store_nothing_when_the_proposal_is_malformed', () => {
  const { db, cerrar } = nucleoTemporal();
  try {
    const r = proponerPerfilEmpresa(db, { ...ANTERIOR, nif: '123' }, 'claude-code', 'NIF mal escrito');
    assert.equal(r.error?.code, 'invalid_input');
    assert.equal(leerPropuestaEmpresa(db), null);
  } finally {
    cerrar();
  }
});

test('should_write_profile_amounts_in_spanish_so_agents_do_not_read_the_decimal_point_as_thousands', () => {
  const perfil = PerfilEmpresa.parse({
    ...ANTERIOR,
    volumen_negocio: [VOLUMEN_2024, VOLUMEN_2025],
    seguro_rc: 3000,
    mayor_contrato_similar: EMPRESA_EJEMPLO.mayor_contrato_similar,
  });
  const t = importesEnTexto(perfil);
  const sinEspacios = (s: string | null) => s?.replace(/\s/g, ' ');
  assert.equal(sinEspacios(t.volumen_negocio['2025'] ?? null), '268.420,15 €');
  assert.equal(sinEspacios(t.volumen_negocio['2024'] ?? null), '152.310,72 €');
  assert.equal(sinEspacios(t.seguro_rc), '3.000,00 €', 'también con cuatro cifras');
  assert.equal(sinEspacios(t.mayor_contrato_similar), '174.905,36 €');
  assert.equal(importesEnTexto(PerfilEmpresa.parse(ANTERIOR)).seguro_rc, null);
});

test('should_give_agents_whole_euros_and_catch_amounts_read_a_hundred_times_bigger', () => {
  const perfil = PerfilEmpresa.parse({ ...ANTERIOR, volumen_negocio: [VOLUMEN_2024, VOLUMEN_2025] });
  assert.deepEqual(perfilParaAgentes(perfil).volumen_negocio, [
    { anio: 2024, importe: 152311 },
    { anio: 2025, importe: 268420 },
  ]);
  const mal = importesMalLeidos(
    perfil,
    'El perfil registra volumen de negocio 15.231.072 € (2024) y 26.842.015 € (2025).',
  );
  assert.match(mal ?? '', /volumen de negocio de 2024: 152\.310,72\s€, no 15\.231\.072,00\s€/);
  assert.match(mal ?? '', /2025/);
  for (const bien of [
    'Volumen 268.420,15 € en 2025',
    'Volumen 268420.15 € en 2025',
    'Volumen 268.420 € y umbral 363.454 €',
    'Plazo de 24 meses',
  ]) {
    assert.equal(importesMalLeidos(perfil, bien), null, bien);
  }
});

function guardar(entrada: unknown) {
  const db = abrirNucleo(fs.mkdtempSync(path.join(os.tmpdir(), 'empresa-')));
  try {
    const r = guardarPerfilEmpresa(db, entrada);
    return { r, leido: leerPerfilEmpresa(db)?.perfil ?? null };
  } finally {
    db.close();
  }
}

const DIRECCION = {
  calle: 'Calle Mayor 1',
  codigo_postal: '38003',
  municipio: 'Santa Cruz de Tenerife',
  provincia: 'Santa Cruz de Tenerife',
};

test('should_compose_the_address_text_from_the_structured_address_so_the_signing_town_is_found', () => {
  const { r, leido } = guardar({ ...ANTERIOR, direccion: DIRECCION });
  assert.ok(r.data);
  assert.equal(leido?.domicilio, 'Calle Mayor 1, 38003 Santa Cruz de Tenerife (Santa Cruz de Tenerife)');
  assert.equal(municipioDe(leido?.domicilio), 'Santa Cruz de Tenerife');
});

test('should_keep_null_certificates_apart_from_an_empty_list', () => {
  const sin = guardar({ ...ANTERIOR, certificaciones: ['ISO 9001'] }).leido;
  assert.equal(sin?.certificados, null);
  assert.deepEqual(sin?.certificaciones, ['ISO 9001'], 'sin indicar no toca el texto');
  const vacio = guardar({ ...ANTERIOR, certificaciones: ['ISO 9001'], certificados: [] }).leido;
  assert.deepEqual(vacio?.certificados, []);
  assert.deepEqual(vacio?.certificaciones, [], '«no tenemos ninguno» vacía las certificaciones');
});

test('should_derive_the_certification_names_with_the_ens_level', () => {
  const { leido } = guardar({
    ...ANTERIOR,
    certificados: [{ nombre: 'ENS', nivel: 'media', caduca: '2027-01-31' }, { nombre: 'ISO 27001' }],
  });
  assert.deepEqual(leido?.certificaciones, ['ENS media', 'ISO 27001']);
  assert.equal(leido?.certificados?.[1]?.nivel, null);
});

test('should_reject_a_postcode_that_is_not_five_digits', () => {
  const { r } = guardar({ ...ANTERIOR, direccion: { ...DIRECCION, codigo_postal: '3800' } });
  assert.ok(r.error);
  assert.equal(r.error.code, 'invalid_input');
});

test('should_still_read_a_profile_saved_before_the_structured_fields', () => {
  const db = abrirNucleo(fs.mkdtempSync(path.join(os.tmpdir(), 'empresa-')));
  try {
    db.prepare('INSERT INTO perfil_empresa (id, datos, actualizado_en) VALUES (1, ?, ?)').run(
      JSON.stringify({ ...ANTERIOR, domicilio: 'Calle Sol 2, 35001 Las Palmas', certificaciones: ['ISO 9001'] }),
      '2026-01-01',
    );
    const p = leerPerfilEmpresa(db)?.perfil;
    assert.equal(p?.direccion, null);
    assert.equal(p?.certificados, null);
    assert.equal(p?.domicilio, 'Calle Sol 2, 35001 Las Palmas');
    assert.deepEqual(p?.certificaciones, ['ISO 9001']);
  } finally {
    db.close();
  }
});
