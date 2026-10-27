// Disponibilidad calculada: con un contrato en ejecución no está disponible; con varias
// ofertas abiertas, en parte; un dominio que falla no deja sin las asignaciones de los demás.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Asignacion } from '../../src/nucleo/colaboradores/disponibilidad.js';

process.env.NODE_ENV = 'test';

const { asignaciones, disponibilidadDe, disponibilidades, registrarAsignaciones } =
  await import('../../src/nucleo/colaboradores/disponibilidad.js');

function asignacion(estado: Asignacion['estado'], extra: Partial<Asignacion> = {}): Asignacion {
  return {
    persona_id: 1,
    dominio: 'licitaciones',
    recurso: 'p-1',
    expediente: 'EXP-1',
    titulo: 'Formación en IA',
    rol: 'docente',
    estado,
    hasta: null,
    ...extra,
  };
}

test('should_be_available_without_assignments_or_with_one_open_offer', () => {
  assert.deepEqual(disponibilidadDe([]), { estado: 'disponible', motivo: '', hasta: null });
  assert.deepEqual(disponibilidadDe([asignacion('en_preparacion')]), {
    estado: 'disponible',
    motivo: '1 oferta en curso',
    hasta: null,
  });
  assert.equal(
    disponibilidadDe([asignacion('perdida'), asignacion('ganada')]).estado,
    'disponible',
    'lo resuelto y terminado no ocupa',
  );
});

test('should_be_partly_available_with_two_open_offers', () => {
  const d = disponibilidadDe([asignacion('en_preparacion'), asignacion('presentada', { recurso: 'p-2' })]);
  assert.deepEqual(d, { estado: 'parcial', motivo: '2 ofertas en curso', hasta: null });
});

test('should_not_be_available_while_a_contract_runs_and_say_until_when', () => {
  const d = disponibilidadDe([
    asignacion('en_ejecucion', { titulo: 'Calidad del aire', hasta: '2026-11-15' }),
    asignacion('en_preparacion'),
  ]);
  assert.deepEqual(d, { estado: 'no_disponible', motivo: 'En ejecución: Calidad del aire', hasta: '2026-11-15' });
  assert.equal(
    disponibilidadDe([asignacion('en_ejecucion', { hasta: '2026-11-15' }), asignacion('en_ejecucion', { hasta: null })])
      .hasta,
    null,
    'sin fin conocido no se promete fecha',
  );
});

test('should_group_assignments_by_person', () => {
  const m = disponibilidades([asignacion('en_ejecucion'), asignacion('en_preparacion', { persona_id: 2 })]);
  assert.equal(m.get(1)?.estado, 'no_disponible');
  assert.equal(m.get(2)?.estado, 'disponible');
  assert.equal(m.get(3), undefined);
});

test('should_keep_other_domains_when_one_source_fails', () => {
  registrarAsignaciones('rota', () => {
    throw new Error('base cerrada');
  });
  registrarAsignaciones('buena', () => [asignacion('en_preparacion', { dominio: 'buena' })]);
  assert.deepEqual(
    asignaciones().map((a) => a.dominio),
    ['buena'],
  );
});
