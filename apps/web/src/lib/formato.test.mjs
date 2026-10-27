import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diaEn,
  diasDeCalendario,
  instanteLocal,
  urgenciaPlazo,
  proximoPlazo,
  horaPlazo,
  horaCanarias,
  fijarZonaEmpresa,
  textoPlazo,
  diasHasta,
  plazo,
  euros,
  lista,
  numeroONulo,
  fechaHora,
  textoAlertaIa,
  fechaCorta,
  plural,
  textoVeredicto,
  comunidadesDeNuts,
  nutsDeComunidades,
  resumenComunidades,
  COMUNIDADES,
  urlEnlazable,
} from './formato.js';

// Los textos de estos tests son los de una empresa en Canarias: con la hora de allí al lado.
fijarZonaEmpresa('Atlantic/Canary');

// Con zona: los plazos se cuentan en hora peninsular, sea cual sea la del proceso de los tests.
const AHORA = Date.parse('2026-10-02T12:00:00+02:00');
const sinInstante = ({ instante, ...resto }) => resto;
const conTz = (tz, fn) => {
  const antes = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
};

test('should_count_calendar_days_until_the_deadline', () => {
  assert.equal(diasHasta('2026-10-09T10:00:00', AHORA), 7, 'del vie 2 al vie 9, aunque falten 6 d 22 h');
  assert.equal(diasHasta(null, AHORA), null);
  assert.equal(diasHasta('no es fecha', AHORA), null);
});

test('should_label_deadline_urgency', () => {
  assert.deepEqual(sinInstante(plazo('2026-10-02T20:00:00', AHORA)), {
    texto: 'hoy',
    urgencia: 'alta',
    fecha: 'vie 2 oct',
    hora: '20:00',
  });
  assert.deepEqual(sinInstante(plazo('2026-10-03T20:00:00', AHORA)), {
    texto: 'mañana',
    urgencia: 'alta',
    fecha: 'sáb 3 oct',
    hora: '20:00',
  });
  assert.deepEqual(sinInstante(plazo('2026-10-06T20:00:00', AHORA)), {
    texto: 'en 4 días',
    urgencia: 'media',
    fecha: 'mar 6 oct',
    hora: '20:00',
  });
  assert.deepEqual(sinInstante(plazo('2026-10-30T20:00:00', AHORA)), {
    texto: 'en 28 días',
    urgencia: 'baja',
    fecha: 'vie 30 oct',
    hora: '20:00',
  });
  assert.deepEqual(sinInstante(plazo('2026-10-01T20:00:00', AHORA)), {
    texto: 'vencida',
    urgencia: 'pasada',
    fecha: 'jue 1 oct',
    hora: '20:00',
  });
  assert.deepEqual(plazo(null, AHORA), {
    texto: 'sin plazo',
    urgencia: 'ninguna',
    fecha: null,
    hora: null,
    instante: null,
  });
});

test('should_write_short_readable_dates_and_plurals', () => {
  assert.equal(fechaCorta('2026-10-06', AHORA), 'mar 6 oct');
  assert.equal(fechaCorta('2025-12-31', AHORA), 'mié 31 dic 2025');
  assert.equal(fechaCorta(null, AHORA), '—');
  assert.equal(fechaCorta('no es fecha', AHORA), 'no es fecha');
  assert.equal(plural(1, 'contrato'), '1 contrato');
  assert.equal(plural(2, 'contrato'), '2 contratos');
  assert.equal(
    plural(1200, 'oportunidad', 'oportunidades'),
    '1200 oportunidades'.replace('1200', (1200).toLocaleString('es-ES')),
  );
});

test('should_format_amounts_and_parse_form_fields', () => {
  assert.match(euros(97290.9), /97\.291\s€/);
  assert.equal(euros(null), '—');
  assert.deepEqual(lista('72, 48 ,\n7331,,'), ['72', '48', '7331']);
  assert.equal(numeroONulo(''), null);
  assert.equal(numeroONulo('1.500.000'), 1500000);
  assert.equal(numeroONulo('12,5'), 12.5);
  assert.ok(Number.isNaN(numeroONulo('abc')));
  assert.equal(fechaHora(null), '—');
  assert.equal(fechaHora('no es fecha'), 'no es fecha');
});

test('should_explain_why_the_ai_queue_is_stopped', () => {
  const limite = textoAlertaIa({ motivo: 'limite', tipo: null, hasta: '2026-10-04T13:30:00Z', error: null });
  assert.match(limite, /agotado el uso del modelo/);
  const criba = textoAlertaIa({
    motivo: 'fallos',
    tipo: 'licitaciones.cribar',
    nombre: 'Criba de licitaciones',
    hasta: '2026-10-04T18:00:00Z',
    error: 'El run terminó sin dejar el resultado esperado.',
  });
  assert.match(criba, /^Hermes ha frenado «Criba de licitaciones»/);
  assert.match(criba, /«Cribar ahora»/);
  assert.match(criba, /sin dejar el resultado/);
  assert.match(
    textoAlertaIa({
      motivo: 'fallos',
      tipo: 'licitaciones.ficha',
      nombre: 'Ficha',
      hasta: '2026-10-04T18:00:00Z',
      error: null,
    }),
    /^Hermes ha frenado «Ficha» .* pedirlo a mano\.$/,
  );
});

test('should_use_the_server_job_name_in_ai_alerts_even_for_types_the_web_does_not_know', () => {
  // Act
  const nuevo = textoAlertaIa({
    motivo: 'herramienta',
    tipo: 'licitaciones.tipo_nuevo',
    nombre: 'Memoria: crítica',
    hasta: null,
    error: null,
  });
  const sinNombre = textoAlertaIa({ motivo: 'desfase', tipo: 'licitaciones.otro', hasta: null, error: null });

  // Assert
  assert.match(nuevo, /^«Memoria: crítica» espera: /);
  assert.doesNotMatch(nuevo, /licitaciones\./);
  assert.match(sinNombre, /^«licitaciones\.otro» espera: /, 'un servidor antiguo sin nombre sigue diciendo algo');
});

test('should_show_date_and_time_only_when_there_is_a_time', async () => {
  const { fechaConHora } = await import('./formato.js');
  assert.equal(fechaConHora('2026-10-13T17:00:00', AHORA), 'mar 13 oct, 17:00');
  assert.equal(fechaConHora('2026-10-13T00:00:00', AHORA), 'mar 13 oct');
  assert.equal(fechaConHora('2026-10-13', AHORA), 'mar 13 oct');
  assert.equal(fechaConHora(null, AHORA), '—');
});

test('should_show_instants_with_a_zone_in_local_time', async () => {
  const { fechaConHora } = await import('./formato.js');
  const antes = process.env.TZ;
  process.env.TZ = 'Europe/Madrid';
  try {
    assert.equal(
      fechaConHora('2026-10-05T07:30:00.000Z', AHORA),
      'lun 5 oct, 09:30',
      'la última visita (UTC) no sale 2 h antes',
    );
    assert.equal(fechaConHora('2026-10-04T23:30:00Z', AHORA), 'lun 5 oct, 01:30', 'de noche cambia también el día');
    assert.equal(fechaConHora('2026-10-05T09:30:00+02:00', AHORA), 'lun 5 oct, 09:30');
    assert.equal(
      fechaConHora('2026-10-04T22:00:00Z', AHORA),
      'lun 5 oct, 00:00',
      'un instante a medianoche conserva la hora',
    );
    assert.equal(fechaConHora('2026-10-13T17:00:00', AHORA), 'mar 13 oct, 17:00', 'sin zona, la hora del texto');
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
});

test('should_name_who_proposes_in_plain_words', async () => {
  const { nombreAgente } = await import('./formato.js');
  assert.equal(nombreAgente('claude-code'), 'Claude Code');
  assert.equal(nombreAgente('licitaciones'), 'Hermes (licitaciones)');
  assert.equal(nombreAgente('clientes'), 'Hermes (clientes)');
});

test('should_read_amounts_back_from_the_server_without_multiplying_them_by_a_hundred', () => {
  assert.equal(numeroONulo('136976.48'), 136976.48, 'lo que el formulario recibe del servidor');
  assert.equal(numeroONulo('186420.35'), 186420.35);
  assert.equal(numeroONulo('186.420,35'), 186420.35);
  assert.equal(numeroONulo('186420,35'), 186420.35);
  assert.equal(numeroONulo('186.420'), 186420, 'un punto con tres cifras detrás es de miles');
  assert.equal(numeroONulo('1.500.000,5'), 1500000.5);
  assert.equal(numeroONulo('300000'), 300000);
  assert.equal(numeroONulo('55.5'), 55.5, 'tarifa con decimales');
  assert.equal(numeroONulo('186.420,35 €'), 186420.35);
  assert.ok(Number.isNaN(numeroONulo('1.2.3')));
});

test('should_describe_the_triage_verdict_in_plain_words', () => {
  assert.equal(textoVeredicto('revisar'), 'Encaja con dudas');
  assert.equal(textoVeredicto('interesa'), 'Encaja');
  assert.equal(textoVeredicto('descartar'), 'No encaja');
  assert.equal(textoVeredicto(null), null);
});

test('should_turn_saved_nuts_prefixes_into_regions_and_keep_finer_ones', () => {
  assert.deepEqual(comunidadesDeNuts(['ES3', 'es70']), { comunidades: ['ES70', 'ES30'], otros: [] });
  assert.deepEqual(comunidadesDeNuts(['ES5']).comunidades.sort(), ['ES51', 'ES52', 'ES53']);
  assert.deepEqual(
    comunidadesDeNuts(['ES701']),
    { comunidades: [], otros: ['ES701'] },
    'una provincia no es una comunidad entera',
  );
  assert.deepEqual(comunidadesDeNuts([]), { comunidades: [], otros: [] });
});

test('should_save_regions_as_prefixes_and_all_of_them_as_the_whole_country', () => {
  assert.deepEqual(nutsDeComunidades(['ES30', 'ES70']), ['ES70', 'ES30']);
  assert.deepEqual(nutsDeComunidades(COMUNIDADES.map(([c]) => c)), [], 'todas = toda España');
  assert.deepEqual(nutsDeComunidades(['ES70'], ['ES701']), ['ES70', 'ES701']);
});

test('should_summarize_the_chosen_regions', () => {
  assert.equal(resumenComunidades([]), 'Toda España');
  assert.equal(resumenComunidades(['ES70']), 'Canarias');
  assert.equal(resumenComunidades(['ES30', 'ES70']), 'Canarias y Madrid');
  assert.equal(resumenComunidades(['ES61', 'ES70', 'ES30']), 'Andalucía, Canarias y Madrid');
  assert.equal(resumenComunidades(['ES61', 'ES70', 'ES30', 'ES11']), 'Andalucía, Canarias y 2 más');
  assert.equal(resumenComunidades([], ['ES701']), 'ES701');
});

test('should_only_link_http_and_https_urls_and_leave_the_rest_as_text', () => {
  assert.equal(urlEnlazable(' https://contrataciondelestado.es/x?a=1 '), 'https://contrataciondelestado.es/x?a=1');
  assert.equal(urlEnlazable('HTTP://boe.es'), 'HTTP://boe.es');
  for (const mala of [
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    '//evil.example',
    'https:evil',
    'javascript:x',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(urlEnlazable(mala), null, String(mala));
  }
});

test('should_show_the_hour_of_the_deadline_and_its_canary_time', () => {
  assert.equal(horaPlazo('2026-10-05T12:00:00'), '12:00');
  assert.equal(horaPlazo('2026-10-05'), null);
  assert.equal(horaCanarias('14:00'), '13:00');
  assert.equal(horaCanarias('00:30'), '23:30');
  const p = { texto: 'hoy', fecha: 'lun 5 oct', hora: '12:00' };
  assert.equal(textoPlazo(p), 'hoy · lun 5 oct · 12:00');
  assert.equal(textoPlazo(p, true), 'hoy · lun 5 oct · 12:00 (11:00 Canarias)');
  assert.equal(textoPlazo({ texto: 'hoy', fecha: 'lun 5 oct', hora: null }, true), 'hoy · lun 5 oct');
  assert.equal(textoPlazo({ texto: 'sin plazo', fecha: null, hora: null }), 'sin plazo');
});

test('should_tell_to_restart_hermes_when_it_lacks_a_platform_tool', () => {
  const t = textoAlertaIa({
    motivo: 'herramienta',
    tipo: 'licitaciones.guion',
    nombre: 'Guion de la oferta',
    hasta: '2026-10-07T09:00:00Z',
    error: 'Falta una herramienta en Hermes (licitaciones_guion): reinicia Hermes…',
  });
  assert.match(
    t,
    /^«Guion de la oferta» espera: Hermes no tiene una herramienta de la plataforma .* Reinicia Hermes y vuelve a pedirlo a mano/,
  );
  assert.match(
    textoAlertaIa({
      motivo: 'herramienta',
      tipo: 'licitaciones.aprender_acta',
      hasta: '2026-10-07T09:00:00Z',
      error: null,
    }),
    /vuelve a pulsar «Leer actas pendientes»/,
  );
  assert.match(
    textoAlertaIa({
      motivo: 'fallos',
      tipo: 'licitaciones.memoria_apartado',
      nombre: 'Memoria: apartados',
      hasta: '2026-10-07T09:00:00Z',
      error: null,
    }),
    /^Hermes ha frenado «Memoria: apartados»/,
  );
});

test('should_tell_to_restart_hermes_when_its_tool_list_is_older_than_the_deploy', () => {
  const t = textoAlertaIa({
    motivo: 'desfase',
    tipo: 'licitaciones.guion',
    nombre: 'Guion de la oferta',
    hasta: null,
    error: 'Perfil oferta-licitaciones: sus herramientas cambiaron…',
  });
  assert.match(
    t,
    /^«Guion de la oferta» espera: Hermes tiene la lista de herramientas de antes del despliegue\. Reinicia Hermes y saldrá solo/,
  );
  assert.match(t, /Perfil oferta-licitaciones/);
});

test('should_pick_the_participation_request_deadline_until_it_passes', () => {
  const ahora = Date.parse('2026-10-06T12:00:00Z');
  assert.deepEqual(proximoPlazo('2026-10-13T09:00:00', '2026-10-07T12:00:00', ahora), {
    fecha: '2026-10-07T12:00:00',
    solicitud: true,
  });
  assert.deepEqual(proximoPlazo('2026-10-13T09:00:00', '2026-10-05T12:00:00', ahora), {
    fecha: '2026-10-13T09:00:00',
    solicitud: false,
  });
  assert.deepEqual(proximoPlazo('2026-10-13T09:00:00', null, ahora), {
    fecha: '2026-10-13T09:00:00',
    solicitud: false,
  });
});

test('should_drop_the_request_deadline_at_peninsular_time_from_a_canary_browser', () => {
  // Arrange: 08:30 peninsulares (07:30 en Canarias); la solicitud vencía a las 08:00 peninsulares.
  const ahora = Date.parse('2026-10-15T08:30:00+02:00');
  // Act
  const r = conTz('Atlantic/Canary', () => proximoPlazo('2026-10-20T14:00:00', '2026-10-15T08:00:00', ahora));
  // Assert: manda ya la oferta, como en plazo() y en el orden del servidor.
  assert.deepEqual(r, { fecha: '2026-10-20T14:00:00', solicitud: false });
  assert.equal(
    conTz('Atlantic/Canary', () => plazo('2026-10-15T08:00:00', ahora).urgencia),
    'pasada',
  );
});

const MIERCOLES_17_08 = Date.parse('2026-10-14T17:08:00+02:00');

test('should_say_manana_for_thursday_08_00_seen_wednesday_17_08', () => {
  const p = plazo('2026-10-15T08:00:00', MIERCOLES_17_08);
  assert.deepEqual(p, {
    texto: 'mañana',
    urgencia: 'alta',
    fecha: 'jue 15 oct',
    hora: '08:00',
    instante: Date.parse('2026-10-15T08:00:00+02:00'),
  });
  assert.equal(textoPlazo(p, true), 'mañana · jue 15 oct · 08:00 (07:00 Canarias)');
});

test('should_count_calendar_days_not_24h_blocks', () => {
  const ahora = Date.parse('2026-10-14T17:00:00+02:00');
  assert.equal(
    plazo('2026-10-22T10:00:00', ahora).texto,
    'en 8 días',
    "Vall d'Hebron: del mié 14 al jue 22, aunque falten 7 d 17 h",
  );
  assert.equal(
    plazo('2026-10-23', ahora).texto,
    'en 9 días',
    'Mairena y Orce, el mismo viernes, el mismo número de días',
  );
  assert.equal(plazo('2026-10-23T14:00:00', ahora).texto, 'en 9 días');
  assert.equal(plazo('2026-10-14T23:59:00', ahora).texto, 'hoy');
});

test('should_count_days_the_same_when_browser_is_in_canary_time', () => {
  // 23:30 en Canarias del mié 14 es ya el jue 15 en la península: el plazo de las 08:00 vence «hoy».
  const ahora = Date.parse('2026-10-14T22:30:00Z');
  const enMadrid = conTz('Europe/Madrid', () => plazo('2026-10-15T08:00:00', ahora));
  const enCanarias = conTz('Atlantic/Canary', () => plazo('2026-10-15T08:00:00', ahora));
  assert.deepEqual(enCanarias, enMadrid);
  assert.equal(enCanarias.texto, 'hoy');
  assert.equal(enCanarias.fecha, 'jue 15 oct', 'la fecha sale del texto');
  assert.equal(
    enCanarias.instante,
    Date.parse('2026-10-15T06:00:00Z'),
    'las 08:00 peninsulares, no las 08:00 de Canarias',
  );
  assert.equal(
    conTz('Atlantic/Canary', () => diasHasta('2026-10-22T10:00:00', MIERCOLES_17_08)),
    8,
  );
});

test('should_read_canary_deadlines_in_canary_zone_for_grants', () => {
  // 00:30 del sáb 3 en Madrid = 23:30 del vie 2 en Canarias: un plazo canario del día 2 aún no ha vencido.
  const ahora = Date.parse('2026-10-02T22:30:00Z');
  assert.equal(plazo('2026-10-02', ahora, 'Atlantic/Canary').texto, 'hoy');
  assert.equal(plazo('2026-10-02', ahora).texto, 'vencida', 'en hora peninsular ya pasó');
  assert.equal(instanteLocal('2026-10-02', 'Atlantic/Canary'), Date.parse('2026-10-02T23:59:59+01:00'));
});

test('should_keep_vencida_and_sin_plazo', () => {
  const p = plazo('2026-10-14T17:00:00', MIERCOLES_17_08);
  assert.deepEqual([p.texto, p.urgencia, p.fecha, p.hora], ['vencida', 'pasada', 'mié 14 oct', '17:00']);
  assert.equal(plazo('2026-10-14T17:08:00', MIERCOLES_17_08).texto, 'vencida', 'en el mismo instante ya ha vencido');
  for (const nada of [null, undefined, '', 'no es fecha', '2026-10-15T08']) {
    assert.deepEqual(
      plazo(nada, MIERCOLES_17_08),
      { texto: 'sin plazo', urgencia: 'ninguna', fecha: null, hora: null, instante: null },
      String(nada),
    );
  }
  assert.equal(diasHasta('2026-10-12T10:00:00', MIERCOLES_17_08), -2);
});

test('should_turn_a_deadline_text_into_its_instant_in_the_zone', () => {
  assert.equal(instanteLocal('2026-10-15T08:00:00'), Date.parse('2026-10-15T06:00:00Z'), 'verano: UTC+2');
  assert.equal(instanteLocal('2026-12-15T08:00'), Date.parse('2026-12-15T07:00:00Z'), 'invierno: UTC+1');
  assert.equal(instanteLocal('2026-10-25T12:00:00'), Date.parse('2026-10-25T11:00:00Z'), 'el día del cambio de hora');
  assert.equal(
    instanteLocal('2026-10-15T08:00:00Z'),
    Date.parse('2026-10-15T08:00:00Z'),
    'con zona, el instante que dice',
  );
  assert.equal(instanteLocal('2026-10-15T08:00:00+01:00'), Date.parse('2026-10-15T07:00:00Z'));
  assert.equal(
    instanteLocal('2026-10-15'),
    Date.parse('2026-10-15T23:59:59+02:00'),
    'solo fecha: hasta el final del día',
  );
  assert.equal(instanteLocal('jueves'), null);
  assert.equal(instanteLocal(null), null);
});

test('should_name_the_calendar_day_and_count_days_between_them', () => {
  const t = Date.parse('2026-10-14T22:30:00Z');
  assert.equal(diaEn(t), '2026-10-15');
  assert.equal(diaEn(t, 'Atlantic/Canary'), '2026-10-14');
  assert.equal(diasDeCalendario(Date.parse('2026-10-15T06:00:00Z'), t), 0);
  assert.equal(diasDeCalendario(Date.parse('2026-10-15T06:00:00Z'), t, 'Atlantic/Canary'), 1);
  assert.equal(
    diasDeCalendario(Date.parse('2026-11-02T10:00:00Z'), Date.parse('2026-10-24T10:00:00Z')),
    9,
    'cruzando el cambio de hora',
  );
});

test('should_grade_urgency_by_hours_and_calendar_days', () => {
  const ahora = MIERCOLES_17_08;
  const h = 3_600_000;
  assert.equal(urgenciaPlazo(ahora, ahora, 0), 'pasada');
  assert.equal(urgenciaPlazo(ahora + 23 * h, ahora, 1), 'alta');
  assert.equal(urgenciaPlazo(ahora + 30 * h, ahora, 1), 'alta', 'mañana, aunque falten más de 24 h');
  assert.equal(urgenciaPlazo(ahora + 30 * h, ahora, 2), 'media');
  assert.equal(urgenciaPlazo(ahora + 120 * h, ahora, 5), 'media');
  assert.equal(urgenciaPlazo(ahora + 140 * h, ahora, 6), 'baja');
});

test('should_take_the_literal_day_of_a_deadline_with_time_and_no_zone', () => {
  const t = Date.parse('2026-10-14T22:30:00Z');
  assert.equal(
    conTz('Pacific/Honolulu', () => fechaCorta('2026-10-15T00:30:00', t)),
    'jue 15 oct',
  );
  assert.equal(
    conTz('Atlantic/Canary', () => fechaCorta('2026-10-15T00:30:00.000', t)),
    'jue 15 oct',
  );
});
