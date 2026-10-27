import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertasDeEstado, estadoConexion } from './alertas.js';

test('should_warn_in_every_view_when_new_work_cannot_arrive', () => {
  const a = alertasDeEstado({
    activo: false,
    hermes: 'sin configurar (…)',
    alertas_ia: [{ motivo: 'limite', tipo: null, hasta: '2026-10-04T13:00:00Z' }],
    ingesta: { error: 'HTTP 503' },
  });
  assert.deepEqual(
    a.map((x) => x.tono),
    ['aviso', 'aviso', 'aviso', 'error'],
  );
  assert.match(a[1].texto, /Hermes no está conectado/);
  assert.match(a[3].texto, /HTTP 503/);
  assert.doesNotMatch(a.map((x) => x.texto).join(' '), /[A-Z]{3,}_[A-Z]{3,}/, 'sin variables de entorno');
});

test('should_say_nothing_when_all_is_running', () => {
  assert.deepEqual(alertasDeEstado({ activo: true, hermes: 'configurado', alertas_ia: [] }), []);
  assert.deepEqual(alertasDeEstado(null), []);
});

test('should_keep_warning_when_licitaciones_hermes_is_not_configured', () => {
  const a = alertasDeEstado({ activo: true, hermes: 'sin configurar (…)', alertas_ia: [] });
  assert.deepEqual(
    a.map((x) => x.tono),
    ['aviso'],
  );
  assert.match(a[0].texto, /La criba por IA está en espera/);
});

test('should_say_server_and_hermes_state_instead_of_connected', () => {
  const futuro = new Date(Date.now() + 3_600_000).toISOString();
  assert.deepEqual(estadoConexion(false, null), { tono: 'error', texto: 'Sin conexión con el servidor' });
  assert.deepEqual(estadoConexion(true, null), { tono: 'ok', texto: 'Servidor ✓' });
  assert.deepEqual(estadoConexion(true, { hermes: 'configurado', alertas_ia: [] }), {
    tono: 'ok',
    texto: 'Servidor ✓ · Hermes ✓',
  });
  assert.deepEqual(estadoConexion(true, { hermes: 'sin configurar (…)' }), {
    tono: 'aviso',
    texto: 'Servidor ✓ · Hermes ✗',
  });
  const pausa = estadoConexion(
    true,
    { hermes: 'configurado', alertas_ia: [{ motivo: 'limite', hasta: futuro }] },
    'UTC',
  );
  assert.equal(pausa.texto, `Servidor ✓ · Hermes en pausa hasta ${futuro.slice(11, 16)}`);
  assert.equal(
    estadoConexion(true, { hermes: 'configurado', pausa_por_limite_hasta: '2000-01-01T00:00:00Z' }).texto,
    'Servidor ✓ · Hermes ✓',
    'una pausa pasada no cuenta',
  );
});

test('should_warn_when_ingestion_brings_nothing_for_6_hours', () => {
  // Arrange: la ingesta corre («esperando») pero el servidor avisa de que no trae nada.
  const estado = {
    activo: true,
    hermes: 'configurado',
    alertas_ia: [],
    alertas_operacion: [{ motivo: 'ingesta_sin_novedades', desde: '2026-10-13T18:08:00Z' }],
  };

  // Act
  const a = alertasDeEstado(estado);

  // Assert
  assert.equal(a.length, 1);
  assert.equal(a[0].tono, 'aviso');
  assert.match(a[0].texto, /más de 6 h sin traer nada nuevo/);
  assert.match(a[0].texto, /2026/);
});

test('should_name_the_stopped_source_and_say_it_is_the_placsp_when_another_is_up_to_date', () => {
  // Arrange: perfiles parada desde el lunes por la tarde y agregadas al día (19-21/10/2026).
  const parada = {
    motivo: 'ingesta_sin_novedades',
    desde: '2026-10-19T18:17:08Z',
    fuente: 'perfiles',
    nombre: 'Perfiles de contratante (Estado y organismos adheridos)',
    horas: 6,
  };
  const estado = (al_dia) => ({
    activo: true,
    hermes: 'configurado',
    alertas_ia: [],
    alertas_operacion: [{ ...parada, al_dia }],
  });

  // Act
  const [conOtra] = alertasDeEstado(estado(['Plataformas agregadas (comunidades autónomas y entidades locales)']));
  const [sola] = alertasDeEstado(estado([]));

  // Assert
  assert.match(
    conOtra.texto,
    /^Perfiles de contratante \(Estado y organismos adheridos\): la PLACSP no publica nada nuevo desde hace más de 6 h/,
  );
  assert.match(conOtra.texto, /Plataformas agregadas .* sigue al día: la ingesta funciona, es la PLACSP/);
  assert.match(sola.texto, /Prueba «Sincronizar ahora»/);
  assert.doesNotMatch(sola.texto, /sigue al día/);
});

test('should_warn_when_screening_failures_exceed_20_percent', () => {
  // Arrange
  const estado = {
    activo: true,
    hermes: 'configurado',
    alertas_ia: [],
    alertas_operacion: [{ motivo: 'criba_con_fallos', fallidos: 58, total: 85 }, { motivo: 'inventado' }],
  };

  // Act
  const a = alertasDeEstado(estado);

  // Assert: un motivo que la web no conoce no sale como aviso vacío.
  assert.deepEqual(
    a.map((x) => x.tono),
    ['aviso'],
  );
  assert.match(a[0].texto, /58 de 85 lotes/);
});
