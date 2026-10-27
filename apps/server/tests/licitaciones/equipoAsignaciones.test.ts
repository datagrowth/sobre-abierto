// Dónde está cada persona: las ofertas en cuyas decisiones figura, con su rol y el estado
// de la oferta; un contrato ganado está en ejecución hasta su fin y, sin fin, durante un año.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asignaciones-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { asignacionesLicitaciones } = await import('../../src/dominios/licitaciones/equipoAsignaciones.js');
const { fichaDeEquipo } = await import('../../src/nucleo/colaboradores/fichaEquipo.js');
const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { licitacion } = await import('../helpers/sinteticas.js');

iniciarNucleo();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2026-10-22T10:00:00Z');

type Extra = {
  inicio?: string;
  duracion?: { valor: number; unidad: string } | null;
  equipo?: { persona_id: number; rol_en_la_oferta: string }[];
};

function oferta(titulo: string, estado: string, extra: Extra = {}): string {
  const db = dbLicitaciones();
  const l = licitacion({
    titulo,
    publicada: '2026-01-10',
    limite: '2026-02-10T14:00:00',
    inicio: extra.inicio ?? null,
    duracion: extra.duracion ?? null,
  });
  guardarLicitacion(db, l);
  db.prepare('INSERT INTO oportunidades (licitacion_id, estado, creada_en, actualizada_en) VALUES (?, ?, ?, ?)').run(
    l.id,
    estado,
    'x',
    'x',
  );
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, 1, ?, ?)').run(
    l.id,
    JSON.stringify({ equipo: extra.equipo ?? [{ persona_id: 1, rol_en_la_oferta: 'coordinación' }] }),
    'x',
  );
  return l.id;
}

test('should_list_each_person_once_per_offer_with_all_roles', () => {
  // Arrange
  const id = oferta('Servicio de formación en IA', 'en_preparacion', {
    equipo: [
      { persona_id: 7, rol_en_la_oferta: 'coordinación' },
      { persona_id: 7, rol_en_la_oferta: 'docente' },
      { persona_id: 8, rol_en_la_oferta: 'tutora' },
    ],
  });

  // Act
  const suyas = asignacionesLicitaciones(dbLicitaciones(), AHORA).filter((a) => a.recurso === id);

  // Assert
  assert.deepEqual(
    suyas.map((a) => [a.persona_id, a.rol, a.estado]),
    [
      [7, 'coordinación, docente', 'en_preparacion'],
      [8, 'tutora', 'en_preparacion'],
    ],
  );
  assert.equal(suyas[0]?.titulo, 'Formación en IA');
});

test('should_keep_a_won_contract_running_until_its_end', () => {
  const corre = oferta('Servicio de calidad del aire', 'ganada', {
    inicio: '2026-03-01',
    duracion: { valor: 12, unidad: 'MON' },
    equipo: [{ persona_id: 20, rol_en_la_oferta: 'ingeniero' }],
  });
  const acabo = oferta('Servicio de movilidad', 'ganada', {
    inicio: '2024-01-01',
    duracion: { valor: 1, unidad: 'ANN' },
    equipo: [{ persona_id: 20, rol_en_la_oferta: 'ingeniero' }],
  });
  const todas = asignacionesLicitaciones(dbLicitaciones(), AHORA);
  assert.deepEqual(todas.find((a) => a.recurso === corre)?.estado, 'en_ejecucion');
  assert.equal(todas.find((a) => a.recurso === corre)?.hasta, '2027-02-28');
  assert.equal(todas.find((a) => a.recurso === acabo)?.estado, 'ganada');
});

test('should_assume_a_year_of_work_when_a_won_contract_has_no_end', () => {
  const id = oferta('Servicio sin duración', 'ganada', {
    duracion: null,
    equipo: [{ persona_id: 30, rol_en_la_oferta: 'analista' }],
  });
  const a = asignacionesLicitaciones(dbLicitaciones(), AHORA).find((x) => x.recurso === id);
  assert.deepEqual([a?.estado, a?.hasta], ['en_ejecucion', null], 'cerró en febrero de 2026: hace menos de un año');
});

test('should_ignore_new_or_discarded_opportunities_and_broken_decisions', () => {
  const nueva = oferta('Servicio nuevo', 'nueva');
  const rota = oferta('Servicio roto', 'en_preparacion');
  dbLicitaciones().prepare('UPDATE decisiones_oferta SET datos = ? WHERE licitacion_id = ?').run('no es json', rota);
  const recursos = asignacionesLicitaciones(dbLicitaciones(), AHORA).map((a) => a.recurso);
  assert.ok(!recursos.includes(nueva));
  assert.ok(!recursos.includes(rota));
});

test('should_count_won_offers_and_show_where_someone_is_in_the_card', () => {
  const db = nucleo().db;
  const ana = crearPersona(db, { nombre: 'Ana Prueba', tipo: 'interno', cv_ruta: 'Colaboradores/cv-ana-prueba.pdf' });
  assert.ok(ana.data);
  const id = ana.data.id;
  oferta('Servicio uno', 'en_preparacion', { equipo: [{ persona_id: id, rol_en_la_oferta: 'coordinación' }] });
  oferta('Servicio dos', 'presentada', { equipo: [{ persona_id: id, rol_en_la_oferta: 'jefa de proyecto' }] });
  oferta('Servicio tres', 'perdida', { equipo: [{ persona_id: id, rol_en_la_oferta: 'coordinación' }] });
  oferta('Servicio cuatro', 'ganada', {
    inicio: '2024-01-01',
    duracion: { valor: 1, unidad: 'ANN' },
    equipo: [{ persona_id: id, rol_en_la_oferta: 'coordinación' }],
  });

  const ficha = fichaDeEquipo(db, id, asignacionesLicitaciones(dbLicitaciones(), AHORA), new Date(AHORA));

  assert.equal(ficha.data?.asignaciones.length, 4);
  assert.deepEqual(ficha.data?.ofertas, { ganadas: 1, resueltas: 2 });
  assert.deepEqual(ficha.data?.disponibilidad, { estado: 'parcial', motivo: '2 ofertas en curso', hasta: null });
  assert.equal(ficha.data?.cv.antiguo, false);
  assert.equal(
    fichaDeEquipo(db, id, [], new Date(Date.parse('2027-12-01T00:00:00Z'))).data?.cv.antiguo,
    true,
    'más de 12 meses después del alta con CV',
  );
});
