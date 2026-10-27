import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cambiosQueAvisan,
  frenoElegibilidad,
  hayEnVivo,
  lineasEnVivo,
  puedeRelanzar,
  textoFallo,
  textoTopes,
  textosFreno,
  tipoCorto,
} from './enVivoFormato.js';
import { fijarZonaEmpresa } from './formato.js';

// Los textos de estos tests son los de una empresa en Canarias: con la hora de allí al lado.
fijarZonaEmpresa('Atlantic/Canary');

// 13:50Z y 14:40Z son las 15:50 y las 16:40 peninsulares en octubre (UTC+2).
const ETA = { desde: '2026-10-15T13:50:00.000Z', hasta: '2026-10-15T14:40:00.000Z', mediana_min: 20 };

const trabajo = (extra = {}) => ({
  id: 7,
  tipo: 'licitaciones.memoria_redaccion',
  nombre: 'Memoria: redacción',
  estado: 'en_cola',
  desde: '2026-10-15T13:00:00.000Z',
  posicion: 2,
  eta: ETA,
  mas_de_lo_normal: false,
  motivo_espera: 'cola',
  intentos: 0,
  proximo_intento_en: null,
  codigo: null,
  error: null,
  ...extra,
});

const enVivo = (extra = {}) => ({
  trabajos: [],
  ultimo_fallo: null,
  runs_hoy: 0,
  tope_runs: 12,
  propuestas_auto_hoy: 0,
  tope_propuestas: 3,
  frenos: [],
  pausa_hasta: null,
  ...extra,
});

test('should_describe_the_running_job_with_round_interval_and_queue_position', () => {
  const hermes = enVivo({ trabajos: [trabajo({ ronda: 2, rondas: 3 })] });

  const [linea] = lineasEnVivo(hermes);

  assert.equal(
    linea.texto,
    'Memoria: redacción · ronda 2/3 · lista entre 15:50 y 16:40 (14:50-15:40 Canarias) · 2.ª en cola',
  );
  assert.equal(linea.tipo, 'memoria_redaccion');
  assert.equal(linea.relanzable, false);
});

test('should_say_when_hermes_itself_asked_for_the_job', () => {
  const [linea] = lineasEnVivo(enVivo({ trabajos: [trabajo({ pedido_por_hermes: true })] }));
  const [otra] = lineasEnVivo(enVivo({ trabajos: [trabajo({ pedido_por_hermes: false })] }));

  assert.match(linea.texto, / · pedido por Hermes$/);
  assert.doesNotMatch(otra.texto, /pedido por Hermes/);
});

test('should_leave_out_the_hour_when_the_server_has_no_estimate', () => {
  const hermes = enVivo({ trabajos: [trabajo({ eta: null, posicion: 1 })] });

  const [linea] = lineasEnVivo(hermes);

  assert.equal(linea.texto, 'Memoria: redacción · 1.ª en cola');
});

test('should_say_more_than_usual_after_the_90th_percentile', () => {
  const hermes = enVivo({
    trabajos: [trabajo({ estado: 'generando', posicion: 0, mas_de_lo_normal: true, motivo_espera: null })],
  });

  const [linea] = lineasEnVivo(hermes);

  assert.match(linea.texto, /· en marcha · más de lo normal$/);
});

test('should_explain_the_last_failure_in_plain_spanish', () => {
  const t = trabajo({
    codigo: 'sin_resultado',
    intentos: 2,
    proximo_intento_en: '2026-10-15T14:05:00.000Z',
    motivo_espera: 'reintento',
  });

  const texto = textoFallo(t);

  assert.equal(texto, 'falló 2 de 3: Hermes acabó sin dejar el resultado; reintento a las 16:05 (15:05 Canarias)');
  assert.equal(textoFallo(trabajo()), null);
  assert.equal(lineasEnVivo(enVivo({ trabajos: [t] }))[0].fallo, texto);
});

test('should_offer_relaunch_only_after_p90_without_activity', () => {
  const parado = trabajo({ estado: 'generando', mas_de_lo_normal: true, desde: '2026-10-15T13:00:00.000Z' });
  const conActividad = { ...parado, desde: '2026-10-15T14:50:00.000Z' };

  assert.equal(puedeRelanzar(parado), true);
  assert.equal(puedeRelanzar(conActividad), false);
  assert.equal(puedeRelanzar({ ...parado, mas_de_lo_normal: false }), false);
  assert.equal(puedeRelanzar({ ...parado, estado: 'en_cola' }), false);
  assert.equal(puedeRelanzar({ ...parado, eta: null }), false);
  assert.equal(puedeRelanzar(null), false);
});

test('should_notify_only_when_a_phase_becomes_te_toca_or_a_job_fails', () => {
  const fallo = {
    tipo: 'licitaciones.ficha',
    nombre: 'Ficha',
    codigo: 'run_inactivo',
    texto: 'falló 1 de 3: Hermes dejó de responder',
    en: '2026-10-15T14:00:00.000Z',
  };
  const antes = {
    fases: [
      { nombre: 'guion', estado: 'en_curso' },
      { nombre: 'decisiones', estado: 'te_toca' },
    ],
    hermes: enVivo(),
  };
  const despues = {
    fases: [
      { nombre: 'guion', estado: 'te_toca' },
      { nombre: 'decisiones', estado: 'te_toca' },
    ],
    hermes: enVivo({ ultimo_fallo: fallo }),
  };

  const avisos = cambiosQueAvisan(antes, despues);

  assert.deepEqual(avisos, [
    { tipo: 'te_toca', texto: 'Te toca: Guion' },
    { tipo: 'fallo', texto: 'Ficha: falló 1 de 3: Hermes dejó de responder' },
  ]);
  assert.deepEqual(cambiosQueAvisan(despues, despues), []);
  assert.deepEqual(cambiosQueAvisan(null, despues), []);
  const enMarcha = {
    ...despues,
    fases: [
      { nombre: 'guion', estado: 'hecho' },
      { nombre: 'decisiones', estado: 'en_curso' },
    ],
  };
  assert.deepEqual(cambiosQueAvisan(despues, enMarcha), []);
});

test('should_show_the_daily_run_cap_of_the_offer', () => {
  assert.equal(textoTopes(enVivo({ runs_hoy: 3 })), '3 de 12 runs hoy en esta oferta');
  assert.equal(
    textoTopes(enVivo({ runs_hoy: 3, propuestas_auto_hoy: 1 })),
    '3 de 12 runs hoy en esta oferta · 1 de 3 propuestas automáticas',
  );
  assert.equal(textoTopes(enVivo()), null);
  assert.equal(textoTopes(null), null);
});

test('should_say_what_holds_hermes_back_and_hide_when_there_is_nothing', () => {
  const hermes = enVivo({
    pausa_hasta: '2026-10-15T14:05:00.000Z',
    frenos: [{ tipo: 'licitaciones.anexo', nombre: 'Anexo', hasta: '2026-10-15T14:40:00.000Z', alcance: 'tipo' }],
  });

  assert.deepEqual(textosFreno(hermes), [
    'Hermes espera al uso del modelo hasta las 16:05 (15:05 Canarias)',
    'Anexo frenado hasta las 16:40 (15:40 Canarias) (en todas las ofertas)',
  ]);
  assert.equal(hayEnVivo(hermes), true);
  assert.equal(hayEnVivo(enVivo()), false);
  assert.equal(hayEnVivo(null), false);
  assert.equal(tipoCorto('licitaciones.ficha'), 'ficha');
});

test('should_say_why_the_chain_is_braked_by_eligibility', () => {
  // Arrange
  const ens = { clave: 'excluyente_vs_perfil:-:ens', titulo: 'Exigen ENS BÁSICA y el perfil no lo tiene' };
  const frenada = {
    trabajos: [],
    ultimo_fallo: null,
    runs_hoy: 0,
    frenos: [],
    pausa_hasta: null,
    freno_elegibilidad: { frenada: true, bloqueos: [ens] },
  };

  // Act
  const f = frenoElegibilidad(frenada);

  // Assert
  assert.deepEqual(f, { texto: 'Hermes no redacta la memoria ni los anexos hasta que decidas:', bloqueos: [ens] });
  assert.equal(hayEnVivo(frenada), true, 'aunque no haya trabajos, se enseña');
  assert.equal(frenoElegibilidad({ ...frenada, freno_elegibilidad: { frenada: false, bloqueos: [] } }), null);
  assert.equal(
    frenoElegibilidad({ ...frenada, freno_elegibilidad: { frenada: true, bloqueos: [] } }),
    null,
    'sin filas no hay nada a lo que llevar',
  );
  assert.equal(frenoElegibilidad({ trabajos: [] }), null, 'un servidor antiguo sin el campo');
});
