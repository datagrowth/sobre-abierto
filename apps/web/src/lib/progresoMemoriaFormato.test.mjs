import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alternarCompromiso,
  compromisoQuitado,
  costeActualizar,
  esCompromisoFicha,
  fasesMemoria,
  gruposFicha,
  leerRevisionFicha,
  notasCampoFicha,
  tablaCriticas,
  textoCritico,
  textoEstadoFicha,
  textoDesfaseMemoria,
  textoEurosCompromiso,
  textoFaseMemoria,
} from './progresoMemoriaFormato.js';
import { progresoMemoria } from './memoriaFormato.js';

const apartados = (estados) =>
  estados.map((estado, i) => ({ apartado: i + 1, titulo: `Apartado ${i + 1}`, puntos: [8, 7, 6, 4][i], estado }));
const FICHA = {
  estado: 'pendiente',
  vence_en: '2026-10-16T10:00:00.000Z',
  revisada_en: null,
  revisada_por: null,
  editados: [],
  no_revisados: [],
  campos: [
    {
      clave: 'inicio',
      grupo: 'Calendario',
      etiqueta: 'Inicio del contrato (AAAA-MM-DD)',
      propuesto: '2026-11-16',
      valor: '2026-11-16',
    },
    {
      clave: 'soporte-horario',
      grupo: 'Soporte',
      etiqueta: 'Horario',
      propuesto: 'L-V 9:00-17:00',
      valor: 'L-V 9:00-17:00',
    },
    {
      clave: 'soporte-respuesta',
      grupo: 'Soporte',
      etiqueta: 'Tiempos de respuesta',
      propuesto: '48 horas',
      valor: '48 horas',
    },
  ],
};
const progreso = (cambios = {}) => ({
  fase: 'redaccion',
  ronda: 0,
  max_rondas: 3,
  umbral: 0.9,
  trabajo: null,
  dossier: null,
  estrategia: null,
  criticas: [],
  restaurados: [],
  coherencia: [],
  ...cambios,
});

test('should_show_the_phases_with_the_one_in_progress', () => {
  const m = {
    estado: 'redactando',
    apartados: apartados(['recibido', 'recibido', 'pendiente', 'pendiente']),
    progreso: progreso(),
  };
  assert.deepEqual(
    fasesMemoria(m).map((p) => [p.texto, p.estado]),
    [
      ['Dossier', 'hecho'],
      ['Estrategia', 'hecho'],
      ['Ficha de solución', 'omitido'],
      ['Redacción 2/4', 'en_curso'],
      ['Crítica', 'pendiente'],
      ['Ronda 0/3', 'pendiente'],
      ['Ensamblar', 'pendiente'],
    ],
  );
  const ronda = { ...m, progreso: progreso({ fase: 'critica', ronda: 1, ficha: FICHA }) };
  assert.deepEqual(
    fasesMemoria(ronda).map((p) => p.estado),
    ['hecho', 'hecho', 'hecho', 'hecho', 'en_curso', 'en_curso', 'pendiente'],
  );
  const enFicha = { ...m, progreso: progreso({ fase: 'ficha', ficha: FICHA }) };
  assert.deepEqual(
    fasesMemoria(enFicha)
      .map((p) => p.estado)
      .slice(0, 4),
    ['hecho', 'hecho', 'en_curso', 'pendiente'],
    'esperando la revisión',
  );
  const lista = {
    estado: 'ensamblada',
    apartados: apartados(['recibido', 'recibido', 'recibido', 'recibido']),
    progreso: progreso({ fase: 'fin' }),
  };
  assert.deepEqual(
    fasesMemoria(lista)
      .map((p) => [p.texto, p.estado])
      .slice(-2),
    [
      ['Ronda 0/3', 'omitido'],
      ['Ensamblada', 'hecho'],
    ],
    'sin rondas: no hizo falta',
  );
  assert.deepEqual(
    fasesMemoria({ estado: 'redactando', apartados: [] }),
    [],
    'una versión subida a mano no tiene fases',
  );
});

test('should_say_what_a_memoria_is_doing_now', () => {
  const m = (fase, ronda = 0) => ({
    estado: 'redactando',
    apartados: apartados(['recibido', 'pendiente', 'pendiente', 'pendiente']),
    progreso: progreso({ fase, ronda }),
  });
  assert.match(textoFaseMemoria(m('estrategia')), /^Hermes piensa la estrategia/);
  assert.equal(
    textoFaseMemoria(m('redaccion', 1)),
    'Hermes redacta la memoria entera: 1 de 4 apartados recibidos (ronda 1 de reescritura)',
  );
  assert.equal(textoFaseMemoria(m('critica', 2)), 'El crítico ciego puntúa la memoria (ronda 2)');
  assert.equal(
    progresoMemoria(m('critica')).texto,
    'El crítico ciego puntúa la memoria',
    'el progreso dice la fase, no solo los apartados',
  );
  assert.equal(textoFaseMemoria({ estado: 'redactando', apartados: [] }), null);
});

test('should_show_the_facts_patch_as_critique_done_and_round_in_progress', () => {
  const m = {
    estado: 'redactando',
    apartados: apartados(['recibido', 'pendiente', 'pendiente', 'recibido']),
    progreso: progreso({ fase: 'hechos', ronda: 1, ficha: FICHA }),
  };
  assert.deepEqual(
    fasesMemoria(m).map((p) => p.estado),
    ['hecho', 'hecho', 'hecho', 'hecho', 'hecho', 'en_curso', 'pendiente'],
  );
  assert.match(
    textoFaseMemoria(m),
    /^Hermes corrige los hechos que cita el crítico antes de la ronda 1 de reescritura/,
  );
});

test('should_build_the_round_by_apartado_table_marking_restored_ones', () => {
  const crit = (ronda, puntos, total) => ({
    ronda,
    total,
    maximo: 25,
    independiente: false,
    ciega: true,
    avisos: [],
    apartados: puntos.map((p, i) => ({ apartado: i + 1, tramo: p, puntos: p })),
  });
  const m = {
    estado: 'ensamblada',
    apartados: apartados(['recibido', 'recibido', 'recibido', 'recibido']),
    progreso: progreso({
      fase: 'fin',
      ronda: 1,
      restaurados: [3],
      criticas: [crit(0, [8, 5, 5, 4], 22), crit(1, [8, 7, 3, 4], 22)],
    }),
  };
  const t = tablaCriticas(m);
  assert.deepEqual(t.rondas, [0, 1]);
  assert.deepEqual(t.totales, ['22/25', '22/25']);
  assert.deepEqual(t.filas[2].celdas, [
    { ronda: 0, texto: '5/6', restaurado: false },
    { ronda: 1, texto: '3/6', restaurado: true },
  ]);
  assert.equal(tablaCriticas({ apartados: [], progreso: progreso() }), null);
});

test('should_warn_when_the_critic_is_not_independent_or_not_blind', () => {
  assert.deepEqual(textoCritico({ independiente: true, ciega: true }), {
    texto: 'Crítico independiente: sí · ciego: sí',
    avisos: [],
  });
  const malo = textoCritico({ independiente: false, ciega: false });
  assert.equal(malo.texto, 'Crítico independiente: no · ciego: no');
  assert.deepEqual(
    malo.avisos.map((a) => a.slice(0, 30)),
    ['Crítica hecha por el mismo mod', 'El crítico leyó más que el paq'],
  );
});

test('should_group_the_solution_sheet_fields_in_order', () => {
  assert.deepEqual(
    gruposFicha(FICHA).map((g) => [g.grupo, g.campos.length]),
    [
      ['Calendario', 1],
      ['Soporte', 2],
    ],
  );
  assert.deepEqual(gruposFicha(null), []);
});

test('should_send_only_changed_fields_and_who_reviews_the_sheet', () => {
  assert.deepEqual(
    leerRevisionFicha(FICHA, { 'soporte-horario': 'L-V 8:00-15:00 ', 'soporte-respuesta': '48 horas' }),
    { cuerpo: { campos: [{ clave: 'soporte-horario', valor: 'L-V 8:00-15:00' }] } },
  );
  assert.deepEqual(
    leerRevisionFicha(FICHA, {}),
    { cuerpo: { campos: [] } },
    'aceptar tal cual; quién la revisa lo pone el servidor',
  );
  assert.equal(
    leerRevisionFicha(FICHA, { 'soporte-horario': '  ' }).error,
    '«Horario» debe tener de 1 a 1500 caracteres.',
  );
  assert.equal(
    leerRevisionFicha(FICHA, { inicio: 'en enero' }).error,
    'El inicio del contrato va como fecha AAAA-MM-DD.',
  );
});

test('should_accept_long_composite_values_up_to_the_server_limit', () => {
  const largo = 'Servicio gestionado de búsqueda · Estándar · Región europea · '.padEnd(900, 'x');
  assert.deepEqual(
    leerRevisionFicha(FICHA, { 'soporte-horario': largo }).cuerpo.campos.map((c) => c.valor.length),
    [900],
    'una capa con su control pasa de 300 caracteres',
  );
  assert.match(leerRevisionFicha(FICHA, { 'soporte-horario': 'x'.repeat(1501) }).error, /de 1 a 1500 caracteres/);
});

test('should_explain_under_a_field_its_fact_sheet_twin_round_change_and_alert', () => {
  const campo = {
    clave: 'soporte-respuesta',
    valor: 'Respuesta a consultas en 48 horas',
    hechos: [
      { clave: 'respuesta', valor: '48 horas' },
      { clave: 'igual', valor: 'Respuesta a consultas en 48 horas' },
    ],
    ronda: { n: 2, antes: '72 horas' },
    alerta: 'Nombra una certificación.',
  };
  assert.deepEqual(notasCampoFicha(campo), [
    'En la hoja de hechos: «48 horas» (cambia con este campo).',
    'Corregido en la ronda 2 por lo que señaló el crítico; antes «72 horas».',
    'Nombra una certificación.',
  ]);
  assert.deepEqual(notasCampoFicha({ clave: 'inicio', valor: '2026-11-02' }), []);
});

test('should_say_who_reviewed_the_sheet_or_that_it_expired_unreviewed', () => {
  assert.match(
    textoEstadoFicha(FICHA),
    /^Hermes espera tu revisión para redactar; si nadie la revisa, redactará con lo propuesto a partir del 2026-10-16T10:00/,
  );
  assert.equal(
    textoEstadoFicha({
      ...FICHA,
      estado: 'aprobada',
      revisada_por: 'Elisa',
      revisada_en: 'hoy',
      editados: ['soporte-horario'],
    }),
    'Revisada por Elisa el hoy (1 valor cambiado).',
  );
  assert.equal(
    textoEstadoFicha({ ...FICHA, estado: 'vencida' }),
    'Venció sin revisar: la memoria lleva los valores que propuso Hermes, marcados para la revisión final.',
  );
  assert.equal(textoEstadoFicha(null), null);
});

// ── Desfase ──

test('should_say_what_changed_and_which_apartados_it_affects', () => {
  // Arrange
  const m = {
    estado: 'ensamblada',
    apartados: apartados(['recibido', 'recibido', 'recibido', 'recibido']),
    progreso: progreso({ fase: 'fin', desfase: { secciones: ['equipo', 'herramientas'], apartados: [2, 4] } }),
  };
  // Act
  const t = textoDesfaseMemoria(m);
  // Assert
  assert.equal(
    t,
    'Cambió desde esta versión: el equipo y las herramientas. Afecta a los apartados 2 y 4; el resto se mantiene.',
  );
  assert.equal(costeActualizar([2, 4]), 'Unos 40 min de Hermes y una crítica; los demás apartados no se tocan.');
});

test('should_say_it_in_singular_when_only_one_apartado_is_affected', () => {
  const m = { progreso: progreso({ desfase: { secciones: ['equipo'], apartados: [3] } }) };
  assert.equal(
    textoDesfaseMemoria(m),
    'Cambió desde esta versión: el equipo. Afecta al apartado 3; el resto se mantiene.',
  );
});

test('should_say_nothing_when_there_is_no_drift', () => {
  assert.equal(textoDesfaseMemoria(null), null);
  assert.equal(textoDesfaseMemoria({ progreso: null }), null);
  assert.equal(textoDesfaseMemoria({ progreso: progreso({ desfase: null }) }), null);
  assert.equal(textoDesfaseMemoria({ progreso: progreso() }), null);
  assert.equal(
    textoDesfaseMemoria({ progreso: progreso({ desfase: { secciones: ['equipo'], apartados: [] } }) }),
    null,
  );
});

test('should_use_readable_section_names', () => {
  // Arrange
  const m = {
    progreso: progreso({
      desfase: { secciones: ['identificacion', 'frontera', 'empresa', 'equipo', 'herramientas'], apartados: [1] },
    }),
  };
  // Act
  const t = textoDesfaseMemoria(m);
  // Assert
  assert.match(
    t,
    /^Cambió desde esta versión: los lotes o el plazo, los criterios de otros sobres, el perfil de la empresa, el equipo y las herramientas\./,
  );
  assert.doesNotMatch(t, /identificacion|frontera|_/);
});

test('should_toggle_an_added_commitment_between_keep_and_remove', () => {
  const valor = 'Tutoría individual a petición · 20 h · sin estimar · mantener';
  assert.equal(esCompromisoFicha({ clave: 'compromiso-2' }), true);
  assert.equal(esCompromisoFicha({ clave: 'soporte-horario' }), false);
  assert.equal(esCompromisoFicha({ clave: 'exigido-1' }), false, 'lo exigido caro se enseña, pero no se puede quitar');
  assert.equal(compromisoQuitado(valor), false);
  const quitado = alternarCompromiso(valor);
  assert.equal(quitado, 'Tutoría individual a petición · 20 h · sin estimar · quitar');
  assert.equal(compromisoQuitado(quitado), true);
  assert.equal(alternarCompromiso(quitado), valor, 'y vuelve');
  assert.deepEqual(
    leerRevisionFicha(
      { campos: [{ clave: 'compromiso-2', etiqueta: 'Para «Apartado 2»', valor }] },
      { 'compromiso-2': quitado },
    ).cuerpo.campos,
    [{ clave: 'compromiso-2', valor: quitado }],
    'se envía como cualquier campo',
  );
});

test('should_show_server_computed_euros_only_when_the_field_brings_them', () => {
  assert.match(textoEurosCompromiso({ clave: 'compromiso-1', euros: 6000 }), /^≈ 6\.000\s€$/);
  assert.equal(textoEurosCompromiso({ clave: 'compromiso-1' }), null, 'sin precio por hora configurado, sin euros');
  assert.equal(textoEurosCompromiso(null), null);
});
