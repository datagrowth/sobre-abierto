import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clasificacionesATexto,
  clasificacionesDesdeTexto,
  diferenciasPerfil,
  formularioAPerfil,
  perfilAFormulario,
} from './empresaFormulario.js';
import {
  EMPRESA_EJEMPLO,
  NIF_EJEMPLO,
  NOMBRE_EJEMPLO,
  VOLUMEN_2024,
  VOLUMEN_2025,
} from '../../tests/fixtures/empresaEjemplo.mjs';

const camposDeLasDiferencias = (actual, propuesto) => diferenciasPerfil(actual, propuesto).map((d) => d.campo);

test('should_read_classifications_in_several_spellings_and_flag_the_rest', () => {
  const r = clasificacionesDesdeTexto('V-2-C, m2-5,\nV 8 d, X-1');
  assert.deepEqual(r.valor, [
    { grupo: 'V', subgrupo: 2, categoria: 'C' },
    { grupo: 'M', subgrupo: 2, categoria: '5' },
    { grupo: 'V', subgrupo: 8, categoria: 'D' },
  ]);
  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0], /X-1/);
  assert.equal(clasificacionesATexto(r.valor), 'V-2-C, M-2-5, V-8-D');
});

test('should_start_an_empty_form_with_the_last_three_closed_years', () => {
  const f = perfilAFormulario(null, 2026);
  assert.deepEqual(
    f.volumen.map((v) => v.anio),
    ['2023', '2024', '2025'],
  );
  assert.equal(f.nif, '');
  assert.equal(f.seguro_rc, '');
});

test('should_round_trip_a_profile_through_the_form', () => {
  const perfil = {
    nif: NIF_EJEMPLO,
    nombre: NOMBRE_EJEMPLO,
    direccion: {
      calle: 'C/ Ejemplo 1',
      codigo_postal: '38001',
      municipio: 'Santa Cruz de Tenerife',
      provincia: 'Santa Cruz de Tenerife',
    },
    domicilio: null,
    clasificaciones: [{ grupo: 'V', subgrupo: 2, categoria: 'C' }],
    volumen_negocio: [
      { anio: 2025, importe: 900000 },
      { anio: 2024, importe: 650000 },
    ],
    certificados: [
      { nombre: 'ENS', nivel: 'media', caduca: '2027-05-01' },
      { nombre: 'ISO 9001', nivel: null, caduca: null },
    ],
    certificaciones: ['ISO 9001', 'ENS media'],
    seguro_rc: 600000,
    plantilla_media: 25,
    anios_actividad: 8,
    cpv_experiencia: ['72', '73'],
    mayor_contrato_similar: 250000,
    notas: 'Sin UTE',
    fecha_constitucion: '2023-09-29',
    tamano: 'micro',
    idiomas: ['es', 'en'],
  };
  const { perfil: vuelta, errores } = formularioAPerfil(perfilAFormulario(perfil));
  assert.deepEqual(errores, []);
  // `certificaciones` y `domicilio` los deriva el servidor de lo estructurado: el formulario no los envía.
  const { certificaciones, ...esperado } = perfil;
  assert.deepEqual(vuelta, {
    ...esperado,
    volumen_negocio: [
      { anio: 2024, importe: 650000 },
      { anio: 2025, importe: 900000 },
    ],
  });
  assert.equal(formularioAPerfil(perfilAFormulario(null, 2026)).perfil.direccion, null, 'sin dirección va null');
});

test('should_skip_empty_years_and_report_malformed_numbers', () => {
  const f = {
    ...perfilAFormulario(null, 2026),
    nif: 'B12345678',
    nombre: 'X',
    plantilla_media: '2,5',
    seguro_rc: 'mucho',
  };
  f.volumen[2].importe = '1.200.000';
  const { perfil, errores } = formularioAPerfil(f);
  assert.deepEqual(perfil.volumen_negocio, [{ anio: 2025, importe: 1200000 }]);
  assert.equal(perfil.seguro_rc, null);
  assert.equal(errores.length, 2);
  assert.match(errores.join(' '), /Seguro/);
  assert.match(errores.join(' '), /Plantilla media: escribe un número entero/);
});

test('should_read_company_data_and_flag_a_malformed_founding_date', () => {
  const f = { ...perfilAFormulario(null, 2026), nif: NIF_EJEMPLO, nombre: 'X', tamano: 'micro' };
  const { perfil, errores } = formularioAPerfil(f);
  assert.deepEqual(errores, []);
  assert.equal(perfil.tamano, 'micro');
  assert.equal(perfil.fecha_constitucion, null);
  const mal = formularioAPerfil({ ...f, fecha_constitucion: '29/09/2023' });
  assert.deepEqual(mal.errores, ['Fecha de constitución: usa AAAA-MM-DD.']);
});

test('should_list_only_the_fields_an_agent_proposal_changes', () => {
  const guardado = {
    nif: NIF_EJEMPLO,
    nombre: NOMBRE_EJEMPLO,
    volumen_negocio: [VOLUMEN_2025],
    plantilla_media: EMPRESA_EJEMPLO.plantilla_media,
    tamano: 'micro',
  };
  assert.deepEqual(
    camposDeLasDiferencias(guardado, {
      ...guardado,
      plantilla_media: EMPRESA_EJEMPLO.plantilla_media,
      tamano: 'pequena',
      fecha_constitucion: '2023-09-29',
    }),
    ['Fecha de constitución', 'Tamaño'],
  );
  assert.deepEqual(camposDeLasDiferencias(guardado, guardado), []);
});

test('should_list_every_filled_field_when_nothing_is_saved_yet', () => {
  const cambios = camposDeLasDiferencias(null, {
    nif: NIF_EJEMPLO,
    nombre: NOMBRE_EJEMPLO,
    volumen_negocio: [{ anio: 2025, importe: 1 }],
  });
  assert.deepEqual(cambios, ['NIF', 'Razón social', 'Volumen de negocio']);
});

test('should_show_what_an_agent_proposal_changes_before_and_after', async () => {
  const guardado = { nif: NIF_EJEMPLO, nombre: NOMBRE_EJEMPLO, volumen_negocio: [VOLUMEN_2025], plantilla_media: 4 };
  const d = diferenciasPerfil(guardado, {
    ...guardado,
    plantilla_media: 5,
    volumen_negocio: [VOLUMEN_2024, VOLUMEN_2025],
  });
  assert.deepEqual(d, [
    { campo: 'Volumen de negocio', antes: '2025: 196.275,85 €', despues: '2024: 118.640,55 €; 2025: 196.275,85 €' },
    { campo: 'Plantilla media', antes: '4', despues: '5' },
  ]);
});

test('should_keep_amounts_with_cents_when_the_saved_profile_is_saved_again', () => {
  const perfil = {
    nif: NIF_EJEMPLO,
    nombre: NOMBRE_EJEMPLO,
    clasificaciones: [],
    certificaciones: [],
    cpv_experiencia: ['72'],
    volumen_negocio: [VOLUMEN_2024, VOLUMEN_2025],
    seguro_rc: 250000.5,
    mayor_contrato_similar: EMPRESA_EJEMPLO.mayor_contrato_similar,
    plantilla_media: EMPRESA_EJEMPLO.plantilla_media,
    anios_actividad: 3,
    notas: '',
  };
  let vuelta = perfil;
  for (let i = 0; i < 3; i++) vuelta = formularioAPerfil(perfilAFormulario(vuelta, 2026)).perfil;
  assert.deepEqual(vuelta.volumen_negocio, perfil.volumen_negocio, 'guardar tres veces no cambia nada');
  assert.equal(vuelta.mayor_contrato_similar, 132480.35);
  assert.equal(vuelta.seguro_rc, 250000.5);
});

test('should_show_amounts_the_spanish_way_and_read_them_back_unchanged', () => {
  const guardado = {
    nif: NIF_EJEMPLO,
    nombre: NOMBRE_EJEMPLO,
    volumen_negocio: [VOLUMEN_2025, VOLUMEN_2024],
    seguro_rc: EMPRESA_EJEMPLO.seguro_rc,
    mayor_contrato_similar: EMPRESA_EJEMPLO.mayor_contrato_similar,
  };
  const f = perfilAFormulario(guardado);
  assert.deepEqual(
    f.volumen.map((v) => v.importe),
    ['118.640,55', '196.275,85'],
  );
  assert.equal(f.seguro_rc, '250.000');
  assert.equal(f.mayor_contrato_similar, '132.480,35');
  const { perfil } = formularioAPerfil(f);
  assert.deepEqual(
    perfil.volumen_negocio,
    [VOLUMEN_2024, VOLUMEN_2025],
    'guardar sin tocar nada no cambia los importes',
  );
  assert.equal(perfil.mayor_contrato_similar, 132480.35);
  assert.equal(perfil.seguro_rc, 250000);
});

test('should_round_trip_the_representative_and_contact_for_the_forms', () => {
  const perfil = {
    nif: 'B12345678',
    nombre: 'X',
    representante: { nombre: 'Luis Prueba', nif: '12345678Z', cargo: 'Administrador' },
    contacto: { email: 'info@ejemplo.es', telefono: '922000000' },
  };
  const f = perfilAFormulario(perfil, 2026);
  assert.equal(f.rep_cargo, 'Administrador');
  const { perfil: vuelta, errores } = formularioAPerfil({ ...f, rep_nif: ' 12345678z ' });
  assert.deepEqual(errores, []);
  assert.deepEqual(vuelta.representante, perfil.representante);
  assert.deepEqual(vuelta.contacto, perfil.contacto);
});

test('should_omit_empty_representative_and_contact_so_the_server_keeps_null', () => {
  const { perfil, errores } = formularioAPerfil({ ...perfilAFormulario(null, 2026), nif: 'B1', nombre: 'X' });
  assert.deepEqual(errores, []);
  assert.equal('representante' in perfil, false);
  assert.equal('contacto' in perfil, false);
});

test('should_reject_a_half_filled_representative_or_a_malformed_email', () => {
  const base = { ...perfilAFormulario(null, 2026), nif: 'B1', nombre: 'X' };
  assert.match(
    formularioAPerfil({ ...base, rep_nombre: 'Luis' }).errores.join(' '),
    /Representante: rellena nombre, NIF y cargo/,
  );
  assert.match(
    formularioAPerfil({ ...base, email: 'info@ejemplo.es' }).errores.join(' '),
    /Contacto: rellena correo y teléfono/,
  );
  assert.match(
    formularioAPerfil({ ...base, email: 'info', telefono: '922' }).errores.join(' '),
    /no tiene forma de correo/,
  );
});

test('should_list_representative_changes_proposed_by_an_agent', () => {
  const guardado = { nif: 'B1', nombre: 'X' };
  const cambios = diferenciasPerfil(guardado, {
    ...guardado,
    representante: { nombre: 'Luis', nif: '1Z', cargo: 'Gerente' },
  }).map((d) => d.campo);
  assert.deepEqual(cambios, ['Representante', 'NIF del representante', 'Cargo del representante']);
});

const base = { ...perfilAFormulario(null, 2026), nif: 'B1', nombre: 'X' };

test('should_round_trip_the_structured_address', () => {
  const direccion = {
    calle: 'C/ Ejemplo 1',
    codigo_postal: '38001',
    municipio: 'Santa Cruz',
    provincia: 'Santa Cruz de Tenerife',
  };
  const f = perfilAFormulario({ nif: 'B1', nombre: 'X', direccion });
  assert.equal(f.codigo_postal, '38001');
  const { perfil, errores } = formularioAPerfil({ ...f, calle: '  C/ Ejemplo 1 ' });
  assert.deepEqual(errores, []);
  assert.deepEqual(perfil.direccion, direccion);
});

test('should_send_an_empty_certificate_list_when_we_have_none_ticked', () => {
  const { perfil, errores } = formularioAPerfil({ ...base, sin_certificados: true });
  assert.deepEqual(errores, []);
  assert.deepEqual(perfil.certificados, []);
  assert.equal(perfilAFormulario({ certificados: [] }).sin_certificados, true);
});

test('should_send_null_certificates_when_nothing_is_filled', () => {
  const { perfil } = formularioAPerfil({ ...base, certificados: [{ nombre: ' ', nivel: '', caduca: '' }] });
  assert.equal(perfil.certificados, null);
  assert.equal(perfilAFormulario({ nif: 'B1', nombre: 'X' }).sin_certificados, false);
});

test('should_send_a_certificate_row_with_level_and_expiry', () => {
  const { perfil, errores } = formularioAPerfil({
    ...base,
    certificados: [{ nombre: 'ENS', nivel: 'media', caduca: '2027-05-01' }],
  });
  assert.deepEqual(errores, []);
  assert.deepEqual(perfil.certificados, [{ nombre: 'ENS', nivel: 'media', caduca: '2027-05-01' }]);
});

test('should_flag_a_postcode_that_is_not_five_digits', () => {
  const llena = { ...base, calle: 'C/ Ejemplo 1', municipio: 'Santa Cruz', provincia: 'Tenerife' };
  assert.match(formularioAPerfil({ ...llena, codigo_postal: '3800' }).errores.join(' '), /Código postal: 5 cifras/);
  assert.match(formularioAPerfil({ ...base, calle: 'C/ Ejemplo 1' }).errores.join(' '), /Dirección: rellena/);
});

test('should_keep_the_legacy_text_address_and_certifications_until_replaced', () => {
  const { perfil } = formularioAPerfil(
    perfilAFormulario({ nif: 'B1', nombre: 'X', domicilio: 'C/ Vieja 2', certificaciones: ['ISO 9001'] }),
  );
  assert.equal(perfil.domicilio, 'C/ Vieja 2');
  assert.deepEqual(perfil.certificaciones, ['ISO 9001']);
});

test('should_clear_the_address_when_the_four_structured_fields_are_emptied', () => {
  // Arrange: el servidor guardó el domicilio que derivó de la dirección estructurada.
  const direccion = { calle: 'C/ X', codigo_postal: '35001', municipio: 'Las Palmas', provincia: 'Las Palmas' };
  const f = perfilAFormulario({ nif: 'B1', nombre: 'X', direccion, domicilio: 'C/ X, 35001 Las Palmas (Las Palmas)' });

  // Act
  const { perfil, errores } = formularioAPerfil({ ...f, calle: '', codigo_postal: '', municipio: '', provincia: '' });

  // Assert
  assert.deepEqual(errores, []);
  assert.equal(perfil.direccion, null);
  assert.equal(perfil.domicilio, null, 'no vuelve el domicilio de la dirección borrada');
});
