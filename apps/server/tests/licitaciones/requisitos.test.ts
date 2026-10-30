// Requisitos estructurados de la PLACSP (entradas reales recortadas en
// fixtures/requisitos.atom) y su evaluación determinista contra el perfil de la empresa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entradas } from '../../src/dominios/licitaciones/placsp/atom.js';
import { mapearEntrada, type LicitacionData } from '../../src/dominios/licitaciones/placsp/mapper.js';
import {
  categoriaNumerica,
  evaluarRequisitos,
  parsearClasificacion,
  type Evaluacion,
} from '../../src/dominios/licitaciones/evaluador.js';
import { bloqueos, resolverConFicha, semaforo } from '../../src/dominios/licitaciones/gonogo.js';
import { PerfilEmpresa, type PerfilEmpresaData } from '../../src/nucleo/empresa.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const HOY = new Date('2026-10-02T12:00:00Z');
const licitaciones = entradas(fs.readFileSync(path.join(FIX, 'requisitos.atom'), 'utf8')).map(
  (e) => mapearEntrada('perfiles', e).data!,
);

function lic(id: string): LicitacionData {
  const l = licitaciones.find((x) => x?.id === id);
  assert.ok(l, `falta ${id} en el fixture`);
  return l;
}

function perfil(cambios: Partial<PerfilEmpresaData> = {}): PerfilEmpresaData {
  return PerfilEmpresa.parse({
    nif: 'B-12.345.678',
    nombre: 'Analítica Ejemplo SL',
    clasificaciones: [{ grupo: 'v', subgrupo: 2, categoria: 'c' }],
    volumen_negocio: [
      { anio: 2023, importe: 400_000 },
      { anio: 2024, importe: 650_000 },
      { anio: 2025, importe: 900_000 },
    ],
    certificaciones: ['ISO 9001', 'ENS media'],
    seguro_rc: 600_000,
    plantilla_media: 25,
    anios_actividad: 8,
    cpv_experiencia: ['72'],
    mayor_contrato_similar: 250_000,
    ...cambios,
  });
}

const evaluar = (l: LicitacionData, p: PerfilEmpresaData | null) => evaluarRequisitos(l, p, HOY);
const lotesDe = (l: LicitacionData) => l.lotes.map((x) => x.id);

test('should_map_classification_thresholds_guarantees_and_lot_requirements_from_codice', () => {
  const servicios = lic('p-20435341');
  const reqs = servicios.requisitos.filter((r) => r.clase !== 'declaracion');
  assert.deepEqual(
    reqs.find((r) => r.clase === 'clasificacion'),
    { clase: 'clasificacion', codigo: 'M2-5', descripcion: 'M2-5', umbral: null, lote: null },
  );
  assert.equal(reqs.find((r) => r.clase === 'financiera' && r.codigo === '5')?.umbral, 1_200_000);
  assert.equal(reqs.find((r) => r.clase === 'tecnica' && r.codigo === 'OSR-COMPTASK')?.umbral, 1_200_000);
  assert.deepEqual(servicios.garantias, [{ tipo: '2', porcentaje: 5, importe: null }]);
  const porLotes = lic('p-20305225');
  const deLote2 = porLotes.requisitos.filter((r) => r.lote === '2').map((r) => [r.codigo, r.umbral]);
  assert.deepEqual(deLote2, [
    ['5', 28780.86],
    ['OSR-COMPTASK', 13431.07],
  ]);
});

test('should_parse_classification_codes_in_new_old_and_wildcard_formats', () => {
  assert.deepEqual(parsearClasificacion('V2-3'), { grupo: 'V', subgrupo: 2, categoria: 3 });
  assert.deepEqual(parsearClasificacion('U*-1'), { grupo: 'U', subgrupo: null, categoria: 1 });
  assert.deepEqual(parsearClasificacion('V2b'), { grupo: 'V', subgrupo: 2, categoria: 2 });
  assert.deepEqual(parsearClasificacion('G4'), { grupo: 'G', subgrupo: 4, categoria: null });
  assert.equal(parsearClasificacion('XX'), null);
  assert.equal(parsearClasificacion(null), null);
  assert.equal(categoriaNumerica('C', 'B'), 1, 'en obras a y b son la categoría 1');
  assert.equal(categoriaNumerica('V', 'D'), 4);
});

test('should_leave_everything_unknown_and_amber_without_a_company_profile', () => {
  const evals = evaluar(lic('p-20435341'), null);
  assert.ok(evals.length >= 3);
  assert.ok(evals.every((e) => e.resultado === 'desconocido'));
  assert.ok(evals.every((e) => /Falta el perfil/.test(e.motivo)));
  assert.equal(semaforo(evals, []).color, 'ambar');
});

test('should_accept_a_higher_category_covering_a_lower_one_and_reject_a_lower_one', () => {
  const conClasificacion = (codigo: string): LicitacionData => ({
    ...lic('p-20435341'),
    requisitos: [{ clase: 'clasificacion', codigo, descripcion: codigo, umbral: null, lote: null }],
  });
  assert.equal(evaluar(conClasificacion('V2-1'), perfil())[0]?.resultado, 'cumple', 'C (3) cubre la 1');
  assert.equal(evaluar(conClasificacion('V2b'), perfil())[0]?.resultado, 'cumple', 'C cubre la antigua b');
  assert.equal(evaluar(conClasificacion('V2-4'), perfil())[0]?.resultado, 'no_cumple');
  assert.equal(evaluar(conClasificacion('V3-1'), perfil())[0]?.resultado, 'no_cumple', 'otro subgrupo');
  assert.equal(evaluar(conClasificacion('V*-2'), perfil())[0]?.resultado, 'cumple', 'cualquier subgrupo del grupo V');
});

test('should_block_on_insufficient_turnover_and_explain_it', () => {
  const l = lic('p-20435341');
  const evals = evaluar(l, perfil());
  const volumen = evals.find((e) => e.etiqueta === 'Volumen anual de negocio')!;
  assert.equal(volumen.resultado, 'no_cumple');
  assert.equal(volumen.excluyente, true);
  assert.equal(volumen.exigido, '≥ 1.200.000 €');
  assert.match(volumen.motivo, /900\.000 € \(2025\)/);
  const clasificacion = evals.find((e) => e.clase === 'clasificacion')!;
  assert.equal(clasificacion.excluyente, false, 'en servicios la clasificación no es obligatoria');
  const s = semaforo(evals, lotesDe(l));
  assert.equal(s.color, 'rojo');
  assert.equal(s.bloqueos.length, 1);
  assert.match(s.bloqueos[0] ?? '', /^Volumen anual de negocio/);
});

test('should_ignore_turnover_outside_the_last_three_closed_years', () => {
  const viejo = perfil({ volumen_negocio: [{ anio: 2019, importe: 5_000_000 }] });
  const volumen = evaluar(lic('p-20435341'), viejo).find((e) => e.etiqueta === 'Volumen anual de negocio')!;
  assert.equal(volumen.resultado, 'desconocido');
  assert.match(volumen.motivo, /2023–2025/);
});

test('should_accept_solvency_through_the_matching_classification', () => {
  const clasificada = perfil({ clasificaciones: [{ grupo: 'M', subgrupo: 2, categoria: '5' }] });
  const evals = evaluar(lic('p-20435341'), clasificada);
  assert.ok(
    evals.filter((e) => e.clase === 'financiera' || e.clase === 'tecnica').every((e) => e.resultado !== 'no_cumple'),
  );
  assert.equal(bloqueos(evals, []).length, 0);
});

test('should_leave_unstructured_requirements_unknown_for_the_ai', () => {
  const l: LicitacionData = {
    ...lic('p-20435341'),
    requisitos: [
      { clase: 'financiera', codigo: 'ZZZ', descripcion: 'Según el anexo I del PCAP', umbral: null, lote: null },
      { clase: 'tecnica', codigo: 'XSX-CERTCALIDAD', descripcion: 'ISO 9001', umbral: null, lote: null },
      {
        clase: 'habilitacion',
        codigo: null,
        descripcion: 'Inscripción en el registro de empresas de seguridad',
        umbral: null,
        lote: null,
      },
      { clase: 'declaracion', codigo: '1', descripcion: 'Capacidad de obrar', umbral: null, lote: null },
    ],
  };
  const evals = evaluar(l, perfil());
  assert.equal(evals.length, 3, 'las declaraciones responsables no se evalúan');
  assert.ok(evals.every((e) => e.resultado === 'desconocido'));
  assert.equal(semaforo(evals, []).color, 'ambar');
});

test('should_leave_ratio_or_count_thresholds_unknown_instead_of_reading_them_as_euros', () => {
  // p-20415829 (real) publica 1,5 (veces el valor estimado) como umbral del volumen y de los trabajos similares.
  const l = lic('p-20415829');
  const evals = evaluar(l, perfil({ volumen_negocio: [{ anio: 2025, importe: 100 }], mayor_contrato_similar: 50 }));
  const volumen = evals.find((e) => e.etiqueta === 'Volumen anual de negocio');
  const trabajos = evals.find((e) => e.etiqueta === 'Trabajos similares');
  assert.equal(volumen?.resultado, 'desconocido');
  assert.equal(volumen?.exigido, 'umbral publicado: 1.5');
  assert.match(volumen?.motivo ?? '', /no es un importe/);
  assert.equal(trabajos?.resultado, 'desconocido');
  assert.notEqual(semaforo(evals, lotesDe(l)).color, 'verde');
  const cero = evaluar(
    { ...l, requisitos: [{ clase: 'financiera', codigo: '5', descripcion: 'Volumen', umbral: 0, lote: null }] },
    perfil(),
  );
  assert.equal(cero[0]?.resultado, 'desconocido', 'un 0 tampoco es un importe');
  const plantilla = evaluar(
    {
      ...l,
      requisitos: [{ clase: 'tecnica', codigo: 'OXR-PLANTILLA', descripcion: 'Plantilla', umbral: 3, lote: null }],
    },
    perfil(),
  );
  assert.equal(plantilla[0]?.resultado, 'cumple', 'la plantilla sí es un número de personas');
});

test('should_turn_green_when_an_approved_ficha_resolves_what_the_placsp_left_unknown', () => {
  const l: LicitacionData = {
    ...lic('p-20435341'),
    requisitos: [
      {
        clase: 'habilitacion',
        codigo: null,
        descripcion: 'Inscripción en el registro de empresas de seguridad',
        umbral: null,
        lote: null,
      },
      { clase: 'financiera', codigo: '5', descripcion: 'Volumen', umbral: 300_000, lote: null },
    ],
  };
  const evals = evaluar(l, perfil());
  const deFicha: Evaluacion[] = [
    {
      origen: 'ficha',
      clase: 'habilitacion',
      etiqueta: 'Habilitación',
      descripcion: 'Inscripción en el registro',
      lote: null,
      exigido: null,
      resultado: 'cumple',
      excluyente: true,
      motivo: 'Inscritos en el registro (pág. 12).',
    },
  ];

  const resueltas = resolverConFicha(evals, deFicha);

  assert.equal(semaforo(evals, []).color, 'ambar');
  assert.equal(resueltas.find((e) => e.clase === 'habilitacion')?.en_ficha, true);
  assert.equal(
    resueltas.find((e) => e.clase === 'financiera')?.en_ficha,
    undefined,
    'lo evaluado por código sigue contando',
  );
  assert.equal(semaforo([...resueltas, ...deFicha], []).color, 'verde');
  assert.deepEqual(resolverConFicha(evals, []), evals, 'una ficha sin requisitos no resuelve nada');
});

test('should_read_rows_stored_before_thresholds_existed_as_unknown', () => {
  const antigua = {
    tipo_contrato: '2',
    valor_estimado: 100_000,
    requisitos: [{ clase: 'financiera', codigo: '5', descripcion: 'Volumen' }],
  };
  assert.equal(evaluarRequisitos(antigua, perfil(), HOY)[0]?.resultado, 'desconocido');
  assert.deepEqual(evaluarRequisitos({ ...antigua, requisitos: 'roto' }, perfil(), HOY), []);
});

test('should_make_classification_mandatory_only_for_works_of_500k_or_more', () => {
  const obras = lic('p-20602990');
  assert.equal(obras.tipo_contrato, '3');
  const pequena = evaluar(obras, perfil()).find((e) => e.clase === 'clasificacion')!;
  assert.equal(pequena.excluyente, false);
  const grande = evaluar({ ...obras, valor_estimado: 750_000 }, perfil()).find((e) => e.clase === 'clasificacion')!;
  assert.equal(grande.excluyente, true);
  assert.equal(grande.resultado, 'no_cumple');
});

test('should_block_a_lot_tender_only_when_every_lot_fails', () => {
  const l = lic('p-20305225');
  const soloLote1 = evaluar(
    l,
    perfil({ volumen_negocio: [{ anio: 2025, importe: 50_000 }], mayor_contrato_similar: 100_000 }),
  );
  assert.equal(
    soloLote1
      .filter((e) => e.resultado === 'no_cumple' && e.excluyente)
      .map((e) => e.lote)
      .join(),
    '1',
  );
  assert.deepEqual(bloqueos(soloLote1, lotesDe(l)), []);
  assert.equal(semaforo(soloLote1, lotesDe(l)).color, 'ambar');
  const ninguno = evaluar(
    l,
    perfil({ volumen_negocio: [{ anio: 2025, importe: 5_000 }], mayor_contrato_similar: 100_000 }),
  );
  assert.equal(bloqueos(ninguno, lotesDe(l)).length, 4);
  assert.equal(semaforo(ninguno, lotesDe(l)).color, 'rojo');
});

test('should_turn_green_when_every_evaluated_requirement_is_met', () => {
  const l: LicitacionData = {
    ...lic('p-20435341'),
    requisitos: [
      { clase: 'financiera', codigo: '5', descripcion: 'Volumen', umbral: 300_000, lote: null },
      { clase: 'financiera', codigo: '3', descripcion: 'Seguro', umbral: 300_000, lote: null },
      { clase: 'tecnica', codigo: 'OXR-PLANTILLA', descripcion: 'Plantilla', umbral: 10, lote: null },
    ],
  };
  const s = semaforo(evaluar(l, perfil()), []);
  assert.equal(s.color, 'verde');
  assert.match(s.motivo, /Cumplimos los 3/);
});

test('should_reject_an_invalid_company_profile', () => {
  assert.equal(PerfilEmpresa.safeParse({ nif: 'B1', nombre: 'X' }).success, false);
  assert.equal(
    PerfilEmpresa.safeParse({
      nif: 'B12345678',
      nombre: 'X',
      clasificaciones: [{ grupo: 'V', subgrupo: 2, categoria: 'Z' }],
    }).success,
    false,
  );
  assert.equal(
    PerfilEmpresa.safeParse({
      nif: 'B12345678',
      nombre: 'X',
      volumen_negocio: [
        { anio: 2025, importe: 1 },
        { anio: 2025, importe: 2 },
      ],
    }).success,
    false,
  );
  assert.equal(PerfilEmpresa.safeParse({ nif: 'B12345678', nombre: 'X', inventado: 1 }).success, false);
  assert.equal(perfil().nif, 'B12345678');
  assert.deepEqual(perfil().clasificaciones, [{ grupo: 'V', subgrupo: 2, categoria: 'C' }]);
});

test('should_never_block_on_the_liability_insurance_because_it_can_be_taken_out_before_bidding', () => {
  const l: LicitacionData = {
    ...lic('p-20435341'),
    requisitos: [{ clase: 'financiera', codigo: '3', descripcion: 'Seguro', umbral: 1_000_000, lote: null }],
  };
  for (const seguro_rc of [null, 300_000]) {
    const evals = evaluar(l, { ...perfil(), seguro_rc });
    const seguro = evals.find((e) => e.etiqueta === 'Seguro de indemnización');
    assert.equal(seguro?.resultado, 'no_cumple');
    assert.equal(seguro?.excluyente, false);
    assert.match(seguro?.motivo ?? '', /contratar antes de presentarse/);
    assert.equal(bloqueos(evals, []).length, 0, 'no descarta la oportunidad');
    assert.equal(semaforo(evals, []).color, 'ambar');
  }
});
