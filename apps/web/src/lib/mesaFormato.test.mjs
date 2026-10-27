import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bloquesMesa, siguienteTarea } from './mesaFormato.js';
import { rutaComprobaciones } from './rutas.js';

// Miércoles 14 oct 2026, 22:34 peninsular: la víspera de CASO_E y Villaejemplo.
const AHORA = Date.parse('2026-10-14T20:34:59.000Z');

const fila = (id, limite, extra = {}) => ({
  id,
  titulo: `Oferta ${id}`,
  vence_en: null,
  limite_decidir: limite,
  veredicto: { tipo: 'faltan_decisiones', texto: 'Faltan decisiones' },
  primer_bloqueo: { clave: `precio:${id}`, titulo: 'Precio sin decidir', cita: null },
  minutos_persona: 5,
  fases: [],
  ...extra,
});
const ficha = (id, plazo, extra = {}) => ({
  tipo: 'ficha_por_revisar',
  id,
  titulo: `Ficha ${id}`,
  plazo,
  solicitud: false,
  excluyentes: [],
  ...extra,
});
const frenada = (id, limite, clave) => ({
  ...fila(id, limite),
  tipo: 'frenada',
  veredicto: { tipo: 'no_presentable', texto: 'No presentable' },
  primer_bloqueo: {
    clave,
    titulo: 'Exigen ENS y el perfil no lo tiene',
    cita: { documento: 'PCAP.pdf', pagina: 18, texto: 'ENS', comprobada: false },
  },
});

test('should_put_esmasa_in_decide_hoy_when_its_participation_request_is_due_tomorrow', () => {
  // Arrange: una lista plana (sin agrupar) con ESMASA, cuya solicitud vence mañana, y otra ficha a 6 días.
  const mesa = {
    items: [
      ficha('esmasa', '2026-10-15T23:59:00+02:00', { solicitud: true }),
      ficha('lejos', '2026-10-20T14:00:00+02:00'),
    ],
  };

  // Act
  const b = bloquesMesa(mesa, AHORA);

  // Assert
  assert.deepEqual(
    b.decideHoy.map((x) => x.id),
    ['esmasa'],
  );
  assert.deepEqual(b.tuMesa, []);
});

test('should_put_offers_stopped_by_the_eligibility_brake_in_decide_hoy', () => {
  // Arrange: CASO_E, CASO_B y Villaejemplo paradas por el freno, en una lista plana que no dice el tipo.
  const parada = (id, limite) =>
    fila(id, limite, {
      veredicto: { tipo: 'no_presentable', texto: 'No presentable' },
      primer_bloqueo: { clave: 'excluyente_vs_perfil:-:ens', titulo: 'ENS', categoria: 'elegibilidad', cita: null },
    });
  const mesa = {
    ofertas: [
      parada('casoE', '2027-10-14T01:10:00.000Z'),
      parada('casoB', '2027-10-18T09:10:00.000Z'),
      parada('casoC', '2027-10-14T17:09:00.000Z'),
      fila('casoD', '2027-10-25T20:09:00.000Z'),
    ],
  };

  // Act
  const b = bloquesMesa(mesa, AHORA);

  // Assert
  assert.deepEqual(
    b.decideHoy.map((x) => [x.id, x.tipo]),
    [
      ['casoE', 'frenada'],
      ['casoC', 'frenada'],
      ['casoB', 'frenada'],
    ],
  );
  assert.deepEqual(
    b.tuMesa.map((x) => x.id),
    ['casoD'],
  );
});

test('should_order_tu_mesa_by_decision_deadline', () => {
  // Arrange: el servidor ya agrupa; una sin fecha límite va al final.
  const mesa = {
    decide_hoy: [],
    tu_mesa: [fila('b', null), fila('c', '2026-10-20T10:00:00.000Z'), fila('a', '2026-10-16T10:00:00.000Z')],
    listas_para_firmar: [],
  };

  // Act
  const b = bloquesMesa(mesa);

  // Assert
  assert.deepEqual(
    b.tuMesa.map((x) => x.id),
    ['a', 'c', 'b'],
  );
});

test('should_show_each_offer_once', () => {
  // Arrange: la misma oferta en los tres bloques y dos veces en «Tu mesa».
  const mesa = {
    decide_hoy: [frenada('casoE', '2027-10-14T01:10:00.000Z', 'excluyente_vs_perfil:-:ens')],
    tu_mesa: [
      fila('casoE', '2027-10-14T01:10:00.000Z'),
      fila('casoD', '2027-10-25T20:09:00.000Z'),
      fila('casoD', '2027-10-25T20:09:00.000Z'),
    ],
    listas_para_firmar: [fila('casoE', null), fila('casoA', null)],
  };

  // Act
  const b = bloquesMesa(mesa);

  // Assert
  const ids = [...b.decideHoy, ...b.tuMesa, ...b.listas].map((x) => x.id);
  assert.deepEqual(ids, ['casoE', 'casoD', 'casoA']);
  assert.equal(b.decideHoy[0].tipo, 'frenada');
});

test('should_pick_the_next_task_skipping_the_current_one', () => {
  // Arrange
  const mesa = {
    decide_hoy: [
      frenada('casoE', '2027-10-14T01:10:00.000Z', 'excluyente_vs_perfil:-:ens'),
      frenada('casoC', '2027-10-14T17:09:00.000Z', 'medios:3:topografia'),
    ],
    tu_mesa: [fila('casoD', '2027-10-25T20:09:00.000Z')],
    listas_para_firmar: [],
  };

  // Act
  const primera = siguienteTarea(mesa);
  const trasCasoE = siguienteTarea(mesa, 'casoE');

  // Assert
  assert.deepEqual(primera, {
    id: 'casoE',
    clave: 'excluyente_vs_perfil:-:ens',
    ruta: rutaComprobaciones('casoE', 'excluyente_vs_perfil:-:ens'),
  });
  assert.equal(trasCasoE.id, 'casoC');
  assert.equal(trasCasoE.ruta, '#/licitacion/casoC/comprobaciones#bloqueo=medios%3A3%3Atopografia');
  assert.equal(
    siguienteTarea({ decide_hoy: [], tu_mesa: [fila('casoD', null)], listas_para_firmar: [] }, 'casoD'),
    null,
  );
});

test('should_pick_a_ficha_por_revisar_without_bloqueo_as_the_next_task_by_its_deadline', () => {
  // Arrange: la solicitud de ESMASA vence antes que la fecha límite para decidir de CASO_D.
  const mesa = {
    decide_hoy: [ficha('esmasa', '2026-10-15T23:59:00+02:00')],
    tu_mesa: [fila('casoD', '2027-10-25T20:09:00.000Z')],
    listas_para_firmar: [],
  };

  // Act
  const t = siguienteTarea(mesa);

  // Assert
  assert.deepEqual(t, { id: 'esmasa', clave: null, ruta: rutaComprobaciones('esmasa') });
});
