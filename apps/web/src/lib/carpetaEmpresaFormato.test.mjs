import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datosSubida, preguntaQuitar, textoCaducidad, tonoCaducidad } from './carpetaEmpresaFormato.js';

const HOY = '2026-10-15';

test('should_say_expires_in_19_days', () => {
  assert.equal(textoCaducidad('2026-11-03', HOY), 'Caduca en 19 días');
  assert.equal(textoCaducidad('2026-10-16', HOY), 'Caduca en 1 día');
  assert.equal(textoCaducidad('2026-10-15', HOY), 'Caduca hoy');
});

test('should_say_expired', () => {
  assert.equal(textoCaducidad('2026-10-14', HOY), 'Caducado');
  assert.equal(tonoCaducidad('2026-10-14', HOY), 'peligro');
});

test('should_say_no_date_when_missing', () => {
  assert.equal(textoCaducidad(null, HOY), 'Sin fecha');
  assert.equal(textoCaducidad('basura', HOY), 'Sin fecha');
  assert.equal(tonoCaducidad(null, HOY), 'neutro');
});

test('should_use_warning_tone_within_30_days', () => {
  assert.equal(tonoCaducidad('2026-11-14', HOY), 'aviso');
  assert.equal(tonoCaducidad('2026-11-15', HOY), 'ok');
});

test('should_reject_an_upload_without_a_name_and_keep_the_optional_fields_null', () => {
  assert.match(datosSubida({ tipo: 'tgss', nombre: ' ' }).error, /nombre/);
  const { datos } = datosSubida({ tipo: 'tgss', nombre: 'Certificado TGSS', caduca_en: '', persona_id: '' });
  assert.deepEqual(datos, {
    tipo: 'tgss',
    nombre: 'Certificado TGSS',
    caduca_en: null,
    persona_id: null,
    horas_desglosadas: false,
  });
});

test('should_name_the_document_and_say_it_cannot_be_undone_before_removing_it', () => {
  // Arrange
  const d = { id: 7, nombre: 'Certificado TGSS' };

  // Act
  const q = preguntaQuitar(d);

  // Assert
  assert.equal(q.pregunta, '¿Quitar «Certificado TGSS» de la carpeta Empresa?');
  assert.match(q.detalle, /No se puede deshacer/);
});
