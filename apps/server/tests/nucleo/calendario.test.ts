// Calendario ICS por persona: RFC 5545 (escape, líneas de 75 octetos, CRLF), plazos
// con TZID=Europe/Madrid y su VTIMEZONE, solo título, órgano y plazo, y un token que se guarda
// como hash, se revoca y deja de valer si la persona se da de baja.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { licitacion } from '../helpers/sinteticas.js';
import { escucharLocal } from '../helpers/servidorLocal.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'calendario-'));
process.env.PLATAFORMA_DATA_DIR = tmp;
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'https://hermes.ejemplo.es';

const express = (await import('express')).default;
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const cal = await import('../../src/nucleo/calendario.js');
const { rutaCalendario } = await import('../../src/nucleo/calendarioRuta.js');
const { crearUsuario, cambiarUsuario } = await import('../../src/nucleo/usuarios.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { eventosCalendario } = await import('../../src/dominios/licitaciones/avisos.js');

iniciarNucleo();
const db = nucleo().db;
let server: http.Server;
let base = '';
before(() => {
  const app = express();
  app.get('/cal/:archivo', rutaCalendario);
  server = escucharLocal(http.createServer(app));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ELISA = (
  await crearUsuario(db, {
    email: 'elisa@example.com',
    nombre: 'Elisa Editora',
    rol: 'editor',
    contrasena: 'temporal-de-doce',
  })
).data!;
const AHORA = Date.parse('2026-10-23T10:00:00Z');

// Una oferta en preparación con solicitud de participación y plazo, y su importe (que no debe salir).
const dbL = dbLicitaciones();
const l = licitacion({
  titulo: 'Formación en IA, datos; y Power BI',
  publicada: '2026-10-01',
  limite: '2026-11-12T14:00:00',
  presupuesto: 48_250,
});
guardarLicitacion(dbL, { ...l, id: 'p-95001', atom_id: 'atom-95001', fecha_solicitud: '2026-11-02T13:00:00' });
dbL
  .prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES ('p-95001', 'en_preparacion', ?, ?)",
  )
  .run(new Date(AHORA).toISOString(), new Date(AHORA).toISOString());
cal.registrarCalendario('licitaciones', (usuarioId) => eventosCalendario(dbL, db, usuarioId, AHORA));

test('should_escape_text_and_fold_lines_at_75_octets_without_splitting_a_character', () => {
  assert.equal(cal.escaparIcs('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  const larga = `SUMMARY:${'ñ'.repeat(60)}`;
  const partes = cal.plegar(larga);
  assert.ok(partes.every((p) => Buffer.byteLength(p) <= 75));
  assert.ok(partes.slice(1).every((p) => p.startsWith(' ')));
  assert.equal(partes.map((p, i) => (i ? p.slice(1) : p)).join(''), larga, 'al desplegar sale lo mismo');
});

test('should_store_only_the_token_hash_and_find_the_person_by_it', () => {
  const { token, ruta } = cal.crearEnlaceCalendario(db, ELISA.id);
  assert.match(token, cal.TOKEN);
  assert.equal(ruta, `/cal/${token}.ics`);
  const guardado = db.prepare('SELECT hash FROM calendario_tokens WHERE usuario_id = ?').get(ELISA.id) as {
    hash: string;
  };
  assert.notEqual(guardado.hash, token);
  assert.equal(cal.personaDelToken(db, token), ELISA.id);
  assert.ok(cal.estadoCalendario(db, ELISA.id).ultimo_uso, 'anota cuándo lo leyó el calendario');
  assert.equal(cal.personaDelToken(db, 'x'.repeat(43)), null);
});

test('should_stop_a_link_when_revoked_replaced_or_its_person_leaves', () => {
  const a = cal.crearEnlaceCalendario(db, ELISA.id).token;
  const b = cal.crearEnlaceCalendario(db, ELISA.id).token;
  assert.equal(cal.personaDelToken(db, a), null, 'el de antes ya no vale');
  assert.equal(cal.personaDelToken(db, b), ELISA.id);
  cal.revocarCalendario(db, ELISA.id);
  assert.equal(cal.personaDelToken(db, b), null);
  const c = cal.crearEnlaceCalendario(db, ELISA.id).token;
  cambiarUsuario(db, ELISA.id, { activo: false });
  assert.equal(cal.personaDelToken(db, c), null);
  cambiarUsuario(db, ELISA.id, { activo: true });
});

test('should_put_deadlines_in_madrid_time_with_its_timezone_and_only_public_data', () => {
  // Act
  const ics = cal.icsDe(ELISA.id, AHORA);
  // Assert
  assert.ok(
    ics.split('\r\n').every((linea) => Buffer.byteLength(linea) <= 75),
    'CRLF y 75 octetos',
  );
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Madrid/);
  assert.match(ics, /DTSTART;TZID=Europe\/Madrid:20261112T140000/);
  assert.match(ics, /DTSTART;TZID=Europe\/Madrid:20261102T130000/, 'también la solicitud de participación');
  assert.match(ics.replace(/\r\n /g, ''), /SUMMARY:Cierre: Formación en IA\\, datos\\; y Power BI/);
  assert.match(ics.replace(/\r\n /g, ''), /URL:https:\/\/hermes\.ejemplo\.es\/#\/licitacion\/p-95001/);
  assert.doesNotMatch(ics, /48[.,]?250|€/, 'sin importes');
});

test('should_serve_the_feed_without_session_and_404_for_an_unknown_token', async () => {
  const { token } = cal.crearEnlaceCalendario(db, ELISA.id);
  const r = await fetch(`${base}/cal/${token}.ics`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /^text\/calendar/);
  assert.match(await r.text(), /BEGIN:VEVENT/);
  assert.equal((await fetch(`${base}/cal/${'y'.repeat(43)}.ics`)).status, 404);
  assert.equal((await fetch(`${base}/cal/${token}`)).status, 404, 'sin .ics tampoco');
});

test('should_add_the_pending_milestones_only_for_the_offers_the_person_leads_or_nobody_leads', async () => {
  // Arrange: el cierre interno es el plazo menos el margen de firma; los hitos, días antes.
  const otro = (
    await crearUsuario(db, {
      email: 'otro@example.com',
      nombre: 'Otro Editor',
      rol: 'editor',
      contrasena: 'temporal-de-doce',
    })
  ).data!;
  const hitos = () =>
    cal
      .icsDe(ELISA.id, AHORA)
      .replace(/\r\n /g, '')
      .split('\r\n')
      .filter((x) => x.startsWith('SUMMARY:Hito'));

  // Act
  const sinNadie = hitos();
  dbL.prepare("UPDATE oportunidades SET responsable_id = ? WHERE licitacion_id = 'p-95001'").run(otro.id);
  const deOtro = hitos();
  dbL.prepare("UPDATE oportunidades SET responsable_id = ? WHERE licitacion_id = 'p-95001'").run(ELISA.id);
  const suya = hitos();

  // Assert
  const titulo = String.raw`Formación en IA\, datos\; y Power BI`;
  assert.deepEqual(
    sinNadie,
    ['Decidir si vamos', 'Decisiones y precio', 'Memoria dada por buena', 'Paquete y firma'].map(
      (h) => `SUMMARY:Hito «${h}»: ${titulo}`,
    ),
  );
  assert.deepEqual(deOtro, [], 'los hitos de una oferta de otra persona no van a su calendario');
  assert.equal(suya.length, 4);
});

test('should_give_the_milestones_to_everyone_when_the_lead_leaves', async () => {
  // Arrange: la oferta la lleva alguien que se da de baja.
  const baja = (
    await crearUsuario(db, {
      email: 'baja@example.com',
      nombre: 'Persona Baja',
      rol: 'editor',
      contrasena: 'temporal-de-doce',
    })
  ).data!;
  dbL.prepare("UPDATE oportunidades SET responsable_id = ? WHERE licitacion_id = 'p-95001'").run(baja.id);
  const hitosDeElisa = () =>
    cal
      .icsDe(ELISA.id, AHORA)
      .split('\r\n')
      .filter((x) => x.startsWith('SUMMARY:Hito')).length;
  const antes = hitosDeElisa();

  // Act
  cambiarUsuario(db, baja.id, { activo: false });
  const despues = hitosDeElisa();

  // Assert
  assert.deepEqual([antes, despues], [0, 4], 'de baja, como si no la llevara nadie (igual que el Pipeline)');
});
