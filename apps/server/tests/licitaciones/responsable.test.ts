// Responsable por oferta e hitos: al preparar la oferta la lleva quien pulsa (si
// nadie la llevaba), se cambia a otra persona activa o a nadie, sale en el Pipeline y en la ficha
// sin el email, y un hito vencido de una oferta en preparación es un riesgo de sus comprobaciones.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'responsable-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { crearUsuario, cambiarUsuario } = await import('../../src/nucleo/usuarios.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { cambiarOportunidad, detalle } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { cambiarResponsable, responsableDe } = await import('../../src/dominios/licitaciones/responsable.js');
const { pipeline } = await import('../../src/dominios/licitaciones/pipeline.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { mesaDe } = await import('../../src/dominios/licitaciones/oferta/mesa.js');
const { licitacion } = await import('../helpers/sinteticas.js');

iniciarNucleo();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const db = dbLicitaciones();
const usuario = async (nombre: string, email: string) =>
  (await crearUsuario(nucleo().db, { email, nombre, rol: 'editor', contrasena: 'temporal-de-doce' })).data!;
const ELISA = await usuario('Elisa Editora', 'elisa@example.com');
const PACO = await usuario('Paco Admin', 'paco@example.com');

function nueva(titulo: string, limite = '2026-11-12T14:00:00'): string {
  const l = licitacion({ titulo, publicada: '2026-10-01', limite });
  guardarLicitacion(db, l);
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, 'nueva', 'x', 'x')",
  ).run(l.id);
  return l.id;
}

test('should_give_the_offer_to_whoever_prepares_it_and_keep_it_if_someone_already_leads_it', () => {
  // Arrange
  const id = nueva('Formación en IA generativa');

  // Act
  cambiarOportunidad(db, id, { estado: 'en_preparacion', responsable_id: ELISA.id }, 'Elisa Editora');
  cambiarOportunidad(db, id, { estado: 'nueva', responsable_id: PACO.id }, 'Paco Admin');
  cambiarOportunidad(db, id, { estado: 'en_preparacion', responsable_id: PACO.id }, 'Paco Admin');

  // Assert
  assert.deepEqual(responsableDe(db, id), { id: ELISA.id, nombre: 'Elisa Editora' });
});

test('should_change_the_lead_to_an_active_person_or_nobody_and_reject_anyone_else', async () => {
  // Arrange
  const id = nueva('Cuadros de mando de movilidad');
  const baja = await usuario('Persona de Baja', 'baja@example.com');
  cambiarUsuario(nucleo().db, baja.id, { activo: false });

  // Act
  const aPaco = cambiarResponsable(db, id, { usuario_id: PACO.id });
  const aBaja = cambiarResponsable(db, id, { usuario_id: baja.id });
  const aNadie = cambiarResponsable(db, id, { usuario_id: null });

  // Assert
  assert.deepEqual(aPaco.data?.responsable, { id: PACO.id, nombre: 'Paco Admin' });
  assert.equal(aBaja.error?.code, 'invalid_input');
  assert.equal(aNadie.data?.responsable, null);
  assert.equal(cambiarResponsable(db, id, { usuario_id: 'Paco' }).error?.code, 'invalid_input');
  assert.equal(cambiarResponsable(db, 'p-no-existe', { usuario_id: null }).error?.code, 'not_found');
});

test('should_show_the_lead_on_the_board_and_in_the_tender_without_the_email', () => {
  // Arrange
  const id = nueva('Talleres de competencias digitales');
  cambiarOportunidad(db, id, { estado: 'en_preparacion', responsable_id: ELISA.id }, 'Elisa Editora');

  // Act
  const tarjeta = pipeline(db, Date.parse('2026-10-23T08:00:00Z'))
    .columnas.flatMap((c) => c.tarjetas)
    .find((t) => t.id === id);
  const d = detalle(db, id, new Date('2026-10-23T08:00:00Z'), null);

  // Assert
  assert.deepEqual(tarjeta?.responsable, { id: ELISA.id, nombre: 'Elisa Editora' });
  assert.deepEqual(d.data?.responsable, { id: ELISA.id, nombre: 'Elisa Editora' });
  assert.doesNotMatch(JSON.stringify(tarjeta), /@example\.com/);
});

test('should_turn_an_overdue_milestone_into_a_comprobaciones_risk_and_feed_its_date_to_the_desk', () => {
  // Arrange: cierra el 12/11; el 6/11 ya pasó «Decidir si vamos» si no se decidió y «Decisiones y precio».
  const id = nueva('Observatorio de datos turísticos');
  cambiarOportunidad(db, id, { estado: 'en_preparacion', responsable_id: ELISA.id }, 'Elisa Editora');
  const ahora = Date.parse('2026-11-06T08:00:00Z');

  // Act
  const c = comprobacionesDe(db, nucleo().db, id, ahora);
  const enMesa = mesaDe(db, nucleo().db, ahora).data!.tu_mesa.find((f) => f.id === id);

  // Assert
  assert.equal(c.data?.hitos.length, 4);
  const fila = c.data!.bloqueos.filter((b) => b.categoria === 'plazo');
  assert.equal(fila.length, 1);
  assert.match(fila[0]!.titulo, /«Decisiones y precio»/);
  assert.equal(fila[0]!.gravedad, 'riesgo', 'un hito vencido arriesga, no impide');
  assert.equal(enMesa?.proximo_hito?.estado, 'vencido');
});
