// Hitos hacia atrás desde el plazo: fechas desde la hora interna de cierre, hechos
// con su fase de las comprobaciones, un vencido es un riesgo que se acepta con motivo y que vuelve a abrirse
// si el plazo se rectifica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bloqueosDeHitos, diasAntes, hitosDe, proximoHito } from '../../src/dominios/licitaciones/oferta/hitos.js';
import { horaLocalEspana } from '../../src/nucleo/fechas.js';
import type { Fase, NombreFase } from '../../src/dominios/licitaciones/oferta/comprobacionesTipos.js';

const CIERRE = '2026-11-12T11:00:00.000Z';
const fases = (hechas: NombreFase[]): Pick<Fase, 'nombre' | 'estado'>[] =>
  (['decidir', 'decisiones', 'memoria', 'paquete'] as const).map((nombre) => ({
    nombre,
    estado: hechas.includes(nombre) ? 'hecho' : 'pendiente',
  }));

test('should_count_the_milestones_back_from_the_internal_close', () => {
  // Act
  const h = hitosDe(CIERRE, fases([]), Date.parse('2026-10-20T00:00:00Z'));

  // Assert
  assert.deepEqual(
    h.map((x) => [x.clave, x.fecha, x.estado]),
    [
      ['decidir', '2026-11-02T11:00:00.000Z', 'pendiente'],
      ['decisiones', '2026-11-05T11:00:00.000Z', 'pendiente'],
      ['memoria', '2026-11-09T11:00:00.000Z', 'pendiente'],
      ['paquete', '2026-11-11T11:00:00.000Z', 'pendiente'],
    ],
  );
});

test('should_mark_a_milestone_done_with_its_phase_and_overdue_when_past', () => {
  // Arrange: el 6 de noviembre ya pasaron D-10 y D-7.
  const ahora = Date.parse('2026-11-06T00:00:00Z');

  // Act
  const h = hitosDe(CIERRE, fases(['decidir']), ahora);

  // Assert
  assert.deepEqual(
    h.map((x) => x.estado),
    ['hecho', 'vencido', 'pendiente', 'pendiente'],
  );
  assert.equal(proximoHito(h)?.clave, 'decisiones');
  assert.equal(
    hitosDe(CIERRE, [{ nombre: 'memoria', estado: 'no_aplica' }], ahora)[2]?.estado,
    'hecho',
    'sin memoria, el hito está hecho',
  );
});

test('should_have_no_milestones_without_an_internal_close', () => {
  assert.deepEqual(hitosDe(null, fases([]), Date.now()), []);
  assert.equal(proximoHito([]), null);
});

test('should_turn_the_overdue_milestones_into_one_risk_row_that_reopens_if_the_deadline_moves', () => {
  // Arrange
  const ahora = Date.parse('2026-11-06T00:00:00Z');

  // Act
  const [fila, ...resto] = bloqueosDeHitos(hitosDe(CIERRE, fases(['decidir']), ahora));
  const rectificado = bloqueosDeHitos(hitosDe('2026-11-13T11:00:00.000Z', fases(['decidir']), ahora));

  // Assert
  assert.equal(resto.length, 0);
  assert.equal(fila?.clave, 'hito_vencido:-');
  assert.deepEqual([fila?.categoria, fila?.gravedad, fila?.actor, fila?.estado], ['plazo', 'riesgo', 'tu', 'abierto']);
  assert.match(fila?.titulo ?? '', /«Decisiones y precio»: tocaba el 05\/11 a las 12:00 hora peninsular, 7 días antes/);
  assert.notEqual(rectificado[0]?.huella, fila?.huella, 'con otro plazo, lo aceptado deja de valer');
});

test('should_name_the_latest_overdue_milestone_and_count_the_earlier_ones', () => {
  // Arrange: a 8 h del cierre interno, sin nada hecho.
  const ahora = Date.parse('2026-11-12T03:00:00Z');

  // Act
  const filas = bloqueosDeHitos(hitosDe(CIERRE, fases([]), ahora));

  // Assert
  assert.equal(filas.length, 1);
  assert.match(filas[0]!.titulo, /«Paquete y firma».*un día antes del cierre interno \(y 3 anteriores sin hacer\)$/);
  assert.deepEqual(
    bloqueosDeHitos(hitosDe(CIERRE, fases(['decidir', 'decisiones', 'memoria', 'paquete']), ahora)),
    [],
    'todo hecho, ninguna fila',
  );
});

test('should_keep_the_peninsular_hour_of_each_milestone_across_a_clock_change', () => {
  // Arrange: cierres internos a las 12:00 peninsulares a cada lado del 25 oct y del 29 mar de 2026.
  const peninsular = (ms: number) => horaLocalEspana(ms).slice(0, 16);
  const casos = [
    ['2026-10-30T11:00:00.000Z', '2026-10-23T12:00', 'tras el paso a horario de invierno'],
    ['2026-10-24T10:00:00.000Z', '2026-10-17T12:00', 'antes del cambio de octubre'],
    ['2026-04-02T10:00:00.000Z', '2026-03-26T12:00', 'tras el paso a horario de verano'],
    ['2026-03-27T11:00:00.000Z', '2026-03-20T12:00', 'antes del cambio de marzo'],
  ] as const;

  // Act / Assert
  for (const [cierre, d7, cuando] of casos) {
    assert.equal(peninsular(diasAntes(Date.parse(cierre), 7)), d7, cuando);
    assert.equal(peninsular(Date.parse(hitosDe(cierre, fases([]), 0)[1]!.fecha)), d7, `${cuando}: el hito D-7`);
  }
});
