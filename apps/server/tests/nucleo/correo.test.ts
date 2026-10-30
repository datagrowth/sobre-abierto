// Envío de email: plantillas de la marca con lo de fuera escapado, el texto plano, el
// envío sin SMTP o con el transporte de prueba, las preferencias de cada persona y la hora de Canarias.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'correo-'));
process.env.PLATAFORMA_DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
delete process.env.SMTP_HOST;

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { enviarCorreo, hayCorreo, sinEmails, usarEnvioDePrueba } = await import('../../src/nucleo/correo.js');
const { montarCorreo } = await import('../../src/nucleo/correoPlantillas.js');
const p = await import('../../src/nucleo/avisosPersona.js');
const { crearUsuario, sembrarPrimerAdmin } = await import('../../src/nucleo/usuarios.js');
const { enHoraLocal } = await import('../../src/nucleo/fechas.js');
type Correo = import('../../src/nucleo/correo.js').Correo;

iniciarNucleo();
after(() => {
  usarEnvioDePrueba(null);
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const PLANTILLA = {
  asunto: 'Qué hacer esta semana',
  titulo: 'Tu semana en Hermes',
  intro: 'Lo que cierra y lo nuevo <para ti>.',
  bloques: [
    {
      titulo: 'Cierran esta semana',
      filas: [{ texto: 'Formación en IA & datos', detalle: 'cierra el jue', enlace: '#/licitacion/p-1' }],
    },
    { titulo: 'Lecciones', filas: [], vacio: 'Ninguna por revisar.' },
  ],
  boton: { texto: 'Abrir Hermes', enlace: '#/pipeline' },
};

test('should_escape_everything_that_comes_from_outside', () => {
  const m = montarCorreo(PLANTILLA, 'https://plataforma.example.com');
  assert.match(m.html, /Formación en IA &amp; datos/);
  assert.match(m.html, /&lt;para ti&gt;/);
  assert.doesNotMatch(m.html, /<para ti>/);
});

test('should_link_to_the_web_only_with_its_public_address', () => {
  const con = montarCorreo(PLANTILLA, 'https://plataforma.example.com');
  assert.match(con.html, /href="https:\/\/plataforma\.example\.com\/#\/licitacion\/p-1"/);
  assert.match(con.html, /border-radius:999px/, 'el botón en píldora');
  const sin = montarCorreo(PLANTILLA, null);
  assert.doesNotMatch(sin.html, /href=/);
  assert.doesNotMatch(sin.html, /Abrir Hermes/);
});

test('should_carry_a_plain_text_version_with_the_same_content', () => {
  const { texto } = montarCorreo(PLANTILLA, 'https://plataforma.example.com');
  assert.match(
    texto,
    /== Cierran esta semana ==\n- Formación en IA & datos — cierra el jue\n {2}https:\/\/plataforma\.example\.com\/#\/licitacion\/p-1/,
  );
  assert.match(texto, /Ninguna por revisar\./);
  assert.match(texto, /Ningún aviso lleva precios, costes ni datos de CV/);
});

test('should_not_send_without_smtp_and_send_through_the_test_transport', async () => {
  assert.equal(hayCorreo(), false);
  assert.equal(
    (await enviarCorreo({ para: 'a@b.es', asunto: 'x', html: 'x', texto: 'x' }, 'prueba')).error?.code,
    'sin_smtp',
  );
  const enviados: Correo[] = [];
  usarEnvioDePrueba(async (c) => {
    enviados.push(c);
    return { data: { id: '1' }, error: null };
  });
  const r = await enviarCorreo({ para: 'elisa@example.com', asunto: 'Hola', html: '<p>h</p>', texto: 'h' }, 'prueba');
  assert.equal(r.error, null);
  assert.deepEqual(
    enviados.map((c) => c.para),
    ['elisa@example.com'],
  );
  usarEnvioDePrueba(null);
});

test('should_take_email_addresses_out_of_smtp_errors_before_the_log', () => {
  assert.equal(
    sinEmails('550 5.1.1 <elisa@example.com>: Recipient address rejected'),
    '550 5.1.1 <[email]>: Recipient address rejected',
  );
});

test('should_keep_each_persons_alert_preferences_with_defaults', async () => {
  // Arrange
  const db = nucleo().db;
  await sembrarPrimerAdmin(db, 'paco', 'contraseña-de-siempre');
  const elisa = (
    await crearUsuario(db, {
      email: 'elisa@example.com',
      nombre: 'Elisa',
      rol: 'editor',
      contrasena: 'temporal-de-doce',
    })
  ).data!;
  // Act
  const antes = p.preferenciasDe(db, elisa.id);
  const despues = p.guardarPreferencias(db, elisa.id, { caducidades: true, urgentes: false });
  // Assert
  assert.deepEqual(antes, p.PREFERENCIAS_POR_DEFECTO);
  assert.deepEqual(despues.data, { ...p.PREFERENCIAS_POR_DEFECTO, caducidades: true, urgentes: false });
  assert.equal(p.guardarPreferencias(db, elisa.id, { cotilleos: true }).error?.code, 'invalid_input');
  assert.deepEqual(
    p.quienesQuieren(db, 'caducidades').map((d) => d.nombre),
    ['Elisa'],
  );
  assert.deepEqual(
    p.quienesQuieren(db, 'resoluciones').map((d) => d.nombre),
    ['Elisa'],
    'el admin con «paco» de email no recibe nada hasta que ponga el suyo',
  );
  assert.deepEqual(
    p.destinatariosDe(db, [1, elisa.id]).map((d) => d.nombre),
    ['Elisa'],
  );
});

test('should_tell_day_hour_and_iso_week_in_the_company_time_zone', () => {
  // 26 de octubre de 2026, lunes: horario de invierno, Canarias = UTC.
  assert.deepEqual(enHoraLocal(Date.parse('2026-10-26T08:00:00Z'), 'Atlantic/Canary'), {
    fecha: '2026-10-26',
    dia: 1,
    hora: 8,
    semana: '2026-W44',
  });
  assert.deepEqual(
    enHoraLocal(Date.parse('2026-10-26T08:00:00Z'), 'Europe/Madrid'),
    { fecha: '2026-10-26', dia: 1, hora: 9, semana: '2026-W44' },
    'en la península, una hora más',
  );
  // Viernes 23, en verano: Canarias = UTC+1.
  assert.deepEqual(enHoraLocal(Date.parse('2026-10-23T23:30:00Z'), 'Atlantic/Canary'), {
    fecha: '2026-10-24',
    dia: 6,
    hora: 0,
    semana: '2026-W43',
  });
  assert.equal(
    enHoraLocal(Date.parse('2027-01-01T12:00:00Z'), 'Atlantic/Canary').semana,
    '2026-W53',
    'el 1 de enero de 2027 es de la última semana de 2026',
  );
});
