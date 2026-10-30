import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agregarImpactos,
  avisoGuardadoSinCoste,
  avisoTrasGuardar,
  pasoTrasImpacto,
  camposCambiados,
  clasificarImpacto,
  estadoParaConfirmar,
  ofertasEnPreparacion,
  pideConfirmacionFuerte,
  textoConfirmacionFuerte,
  textoCoste,
} from './impactoFormato.js';

const pieza = (clave, accion, extra = {}) => ({
  pieza: 'anexo',
  clave,
  nombre: `Anexo ${clave}`,
  accion,
  por: ['decision.precio[2]'],
  coste: { min: 0, runs: 0 },
  pierde: [],
  ...extra,
});

test('should_save_directly_when_every_affected_piece_is_regenerated_by_code_with_0_runs', () => {
  const r = {
    afectadas: [pieza('VI', 'regenerar'), pieza('v2', 'regenerar', { pieza: 'paquete', nombre: 'El paquete' })],
    se_mantiene: ['la memoria: no lleva el precio'],
    resumen: 'Cambia…',
  };

  const { data, error } = clasificarImpacto(r);

  assert.equal(error, null);
  assert.equal(data.sinCoste, true);
  assert.equal(
    avisoGuardadoSinCoste(data),
    'Guardado. Se regenera por código: Anexo VI, El paquete (segundos, 0 runs).',
  );
});

test('should_not_save_directly_when_a_piece_costs_runs_or_its_cost_is_unreadable', () => {
  const conRuns = clasificarImpacto({
    afectadas: [pieza('VI', 'regenerar'), pieza('v3-2', 'rehacer', { pieza: 'apartado', coste: { min: 15, runs: 1 } })],
  });
  const sinCosteLegible = clasificarImpacto({ afectadas: [pieza('VI', 'regenerar', { coste: undefined })] });

  assert.equal(conRuns.data.sinCoste, false);
  assert.equal(sinCosteLegible.data.sinCoste, false);
});

test('should_list_rehacer_marcar_and_pierde_separately', () => {
  const r = {
    afectadas: [
      pieza('v3-2', 'rehacer', {
        pieza: 'apartado',
        coste: { min: 15, runs: 1 },
        pierde: ['el formato del Word subido'],
      }),
      pieza('v3-3', 'revisar', { pieza: 'apartado' }),
      pieza('lote-6', 'podar', { pieza: 'decisiones' }),
    ],
    se_mantiene: [],
  };

  const { data } = clasificarImpacto(r);

  assert.deepEqual(
    data.rehace.map((a) => a.clave),
    ['v3-2', 'lote-6'],
  );
  assert.deepEqual(
    data.marca.map((a) => a.clave),
    ['v3-3'],
  );
  assert.deepEqual(
    data.pierden.map((a) => a.pierde),
    [['el formato del Word subido']],
  );
});

test('should_add_up_minutes_and_runs', () => {
  const r = {
    afectadas: [
      pieza('v3-2', 'rehacer', { coste: { min: 18, runs: 1 } }),
      pieza('v3-3', 'rehacer', { coste: { min: 12, runs: 1 } }),
      pieza('VI', 'regenerar'),
    ],
  };

  const { data } = clasificarImpacto(r);

  assert.equal(data.minutos, 30);
  assert.equal(data.runs, 2);
  assert.equal(textoCoste(data), 'unos 30 min, 2 runs');
  assert.equal(textoCoste({ minutos: 0, runs: 0 }), 'segundos, 0 runs');
  assert.equal(textoCoste({ minutos: 5, runs: 1 }), 'unos 5 min, 1 run');
});

test('should_require_explicit_confirmation_after_accepting_the_memory_or_with_a_package', () => {
  const fases = (memoria, paquete) => ({
    fases: [
      { nombre: 'memoria', estado: memoria },
      { nombre: 'paquete', estado: paquete },
    ],
  });
  const conPaquete = { afectadas: [pieza('v2', 'regenerar', { pieza: 'paquete' })] };

  const aceptada = estadoParaConfirmar({ comprobaciones: fases('hecho', 'pendiente'), impacto: { afectadas: [] } });
  const paquete = estadoParaConfirmar({ comprobaciones: fases('te_toca', 'pendiente'), impacto: conPaquete });
  const nada = estadoParaConfirmar({ comprobaciones: fases('te_toca', 'pendiente'), impacto: { afectadas: [] } });

  assert.equal(pideConfirmacionFuerte(aceptada), true);
  assert.equal(pideConfirmacionFuerte(paquete), true);
  assert.equal(
    textoConfirmacionFuerte(paquete),
    'Entiendo que el paquete v2 queda desfasado y habrá que volver a firmar',
  );
  assert.equal(pideConfirmacionFuerte(nada), false);
  assert.equal(pideConfirmacionFuerte(null), false);
});

test('should_never_classify_an_unknown_action_as_se_mantiene', () => {
  const r = { afectadas: [pieza('x', 'reinventar')], se_mantiene: [] };

  const { data } = clasificarImpacto(r);

  assert.equal(data.marca.length, 1);
  assert.equal(data.marca[0].accion, 'revisar');
  assert.deepEqual(data.mantiene, []);
  assert.equal(data.sinCoste, false);
});

test('should_return_an_error_instead_of_nothing_changes_when_the_response_is_malformed', () => {
  for (const r of [null, undefined, {}, { afectadas: 'todo' }]) {
    const { data, error } = clasificarImpacto(r);

    assert.equal(data, null);
    assert.match(error, /no se entiende/);
  }
});

test('should_aggregate_impact_of_several_offers_for_the_company_profile', () => {
  const portada = pieza('portada', 'regenerar', { pieza: 'portada', nombre: 'La portada y la firma de la memoria' });
  const porOferta = [
    {
      id: 'p-1',
      titulo: 'CASO_E',
      impacto: {
        afectadas: [pieza('VI', 'regenerar'), pieza('VII', 'regenerar'), portada],
        se_mantiene: ['los apartados: no llevan esos datos'],
      },
    },
    { id: 'p-2', titulo: 'Villaejemplo', impacto: { afectadas: [pieza('II', 'regenerar'), portada], se_mantiene: [] } },
    { id: 'p-3', titulo: 'CASO_A', impacto: { afectadas: [pieza('I', 'regenerar')], se_mantiene: [] } },
  ];

  const total = agregarImpactos(porOferta);
  const { data } = clasificarImpacto(total);

  assert.equal(total.resumen, 'En 3 ofertas: se regeneran 4 anexos y la portada de 2 memorias, 0 runs.');
  assert.equal(data.sinCoste, true);
  assert.equal(new Set(total.afectadas.map((a) => a.clave)).size, 6);
  assert.deepEqual(total.se_mantiene, ['CASO_E: los apartados: no llevan esos datos']);
});

test('should_not_aggregate_when_one_offer_response_is_malformed', () => {
  const total = agregarImpactos([
    { id: 'p-1', titulo: 'CASO_E', impacto: { afectadas: [] } },
    { id: 'p-2', titulo: 'X', impacto: null },
  ]);

  assert.equal(total, null);
  assert.ok(clasificarImpacto(total).error);
});

test('should_say_nothing_changes_for_an_empty_aggregate', () => {
  assert.equal(agregarImpactos([]).resumen, 'En 0 ofertas: no cambia nada de lo hecho.');
});

test('should_take_each_offer_in_preparation_once_and_at_most_10', () => {
  const fila = (id) => ({ id, titulo: `T ${id}` });
  const mesa = {
    decide_hoy: [
      { tipo: 'ficha_por_revisar', id: 'f-1' },
      { tipo: 'frenada', ...fila('p-1') },
    ],
    tu_mesa: [fila('p-1'), ...Array.from({ length: 12 }, (_, i) => fila(`p-${i + 2}`))],
    listas_para_firmar: [],
  };

  const ofertas = ofertasEnPreparacion(mesa);

  assert.equal(ofertas.length, 10);
  assert.equal(ofertas[0].id, 'p-1');
  assert.ok(!ofertas.some((o) => o.id === 'f-1'));
  assert.deepEqual(ofertasEnPreparacion(null), []);
});

test('should_list_only_the_profile_fields_that_change', () => {
  const antes = { nif: 'B0', nombre: 'Empresa', direccion: { calle: 'A' }, notas: null };
  const despues = { nif: 'B0', nombre: 'Empresa SL', direccion: { calle: 'B' } };

  assert.deepEqual(camposCambiados(antes, despues), ['nombre', 'direccion']);
  assert.deepEqual(camposCambiados(antes, antes), []);
  assert.deepEqual(camposCambiados({ domicilio: 'Calle A', nombre: 'E' }, { nombre: 'E' }), []);
  assert.deepEqual(camposCambiados(null, { nombre: 'E' }), ['nombre']);
});

test('should_open_the_panel_with_its_cost_when_the_change_spends_runs', () => {
  const r = {
    afectadas: [pieza('v3-2', 'rehacer', { pieza: 'apartado', coste: { min: 30, runs: 2 } })],
    se_mantiene: [],
    resumen: 'Cambia…',
  };

  const paso = pasoTrasImpacto(r);

  assert.equal(paso.fase, 'panel');
  assert.equal(textoCoste(paso.clasificacion), 'unos 30 min, 2 runs');
});

test('should_save_directly_only_when_free_and_nothing_was_accepted', () => {
  const gratis = { afectadas: [pieza('VI', 'regenerar')], se_mantiene: [] };
  const aceptada = { fases: [{ nombre: 'memoria', estado: 'hecho' }] };

  assert.equal(pasoTrasImpacto(gratis).fase, 'directo');
  assert.equal(pasoTrasImpacto(gratis, aceptada).fase, 'panel');
});

test('should_ask_instead_of_saving_when_the_impact_cannot_be_read', () => {
  const paso = pasoTrasImpacto(undefined);

  assert.equal(paso.fase, 'fallo');
  assert.equal(paso.texto, 'No se pudo calcular qué cambia. ¿Guardar y marcar todo para revisar?');
});

const clasificado = (afectadas) => clasificarImpacto({ afectadas }).data;

test('should_not_promise_that_hermes_redoes_pieces_that_cost_runs_after_saving', () => {
  const c = clasificado([
    pieza('VI', 'rehacer', { coste: { min: 10, runs: 1 } }),
    pieza('v3-2', 'rehacer', { pieza: 'apartado', nombre: 'Apartado 2', coste: { min: 15, runs: 1 } }),
  ]);

  const texto = avisoTrasGuardar('rehacer', c);

  assert.doesNotMatch(texto, /Hermes rehace/);
  assert.equal(
    texto,
    'Guardado. Sin rehacer todavía: Anexo VI, Apartado 2. Hermes no lo rehace solo: pídelo de nuevo desde su sección.',
  );
});

test('should_leave_out_the_memory_sections_when_the_panel_requests_them_after_saving', () => {
  const soloApartado = clasificado([
    pieza('v3-2', 'rehacer', { pieza: 'apartado', nombre: 'Apartado 2', coste: { min: 15, runs: 1 } }),
  ]);
  const conAnexo = clasificado([
    pieza('VI', 'rehacer', { coste: { min: 10, runs: 1 } }),
    pieza('v3-2', 'rehacer', { pieza: 'apartado', nombre: 'Apartado 2', coste: { min: 15, runs: 1 } }),
  ]);

  assert.equal(avisoTrasGuardar('rehacer', soloApartado, { conApartados: true }), 'Guardado.');
  assert.match(avisoTrasGuardar('rehacer', conAnexo, { conApartados: true }), /Sin rehacer todavía: Anexo VI\./);
});

test('should_keep_the_marked_and_regenerated_by_code_notices', () => {
  assert.equal(
    avisoTrasGuardar('marcar', clasificado([pieza('VI', 'revisar')])),
    'Guardado. Lo afectado queda marcado para revisar.',
  );
  assert.equal(avisoTrasGuardar('marcar', null), 'Guardado. Todo lo hecho queda marcado para revisar.');
  assert.equal(
    avisoTrasGuardar('rehacer', clasificado([pieza('VI', 'regenerar')])),
    'Guardado. Se regenera por código: Anexo VI (segundos, 0 runs).',
  );
  assert.equal(avisoTrasGuardar('rehacer', null), 'Guardado.');
});
