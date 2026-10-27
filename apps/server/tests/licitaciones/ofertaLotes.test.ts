// La oferta por lotes (guion v4) con tres casos de prueba: el caso B
// (cinco lotes, criterios y precios distintos por lote), CASO_E (precio por alumno en un guion v3)
// y CASO_F (la fórmula puntúa un precio por informe y el guion trajo solo el total).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GuionBase, type GuionBaseData } from '../../src/dominios/licitaciones/oferta/guion.js';
import {
  automaticoDe,
  automaticosDeLote,
  documentosDeLote,
  ofertaDeLote,
  maximosPorLote,
  ofertasEconomicas,
  tramosDe,
} from '../../src/dominios/licitaciones/oferta/guionLotes.js';
import {
  Decisiones,
  normalizarDecisiones,
  problemasDeTramos,
} from '../../src/dominios/licitaciones/oferta/decisiones.js';
import { valoresATeclear } from '../../src/dominios/licitaciones/oferta/paqueteTextos.js';
import { errorDuroGuion, problemasDeGuion } from '../../src/dominios/licitaciones/oferta/guionRevision.js';
import {
  bajaDeLote,
  importeDeLote,
  normalizarOfertas,
  problemasDePrecios,
  umbralMinimo,
} from '../../src/dominios/licitaciones/oferta/preciosOferta.js';
import {
  PropuestaDecisionesEntrada,
  problemasDeEnfoque,
  problemasDePropuesta,
} from '../../src/dominios/licitaciones/oferta/propuestaDecisiones.js';
import { lotesNombrados } from '../../src/dominios/licitaciones/oferta/textoPliego.js';
import { GUION_CASO_B } from './fixtures/casoB.js';

const casoB = (): GuionBaseData => GuionBase.parse(structuredClone(GUION_CASO_B));
const problemas = (g: GuionBaseData) => problemasDeGuion(g, { rubricas: null, limite: null });

const CASO_E_V3 = {
  archivos: [
    {
      nombre: 'Archivo electrónico único',
      contenido: 'Anexos y oferta económica.',
      documentos: [{ tipo: 'declaracion', nombre: 'Anexo I', obligatorio: true, produce: 'persona' }],
    },
  ],
  memoria: null,
  automaticos: [],
  oferta_economica: {
    formula: 'P = 40 × (Om / O)',
    presupuesto_base: 6_063.75,
    impuesto_aparte: 'IGIC',
    precio_unitario: { unidad: 'alumno', maximo: 110.25 },
    umbral_anormalidad: 'Anormalmente bajas las ofertas inferiores en un 15 % al presupuesto base.',
    modelo: 'Anexo VI',
    archivo: 'Archivo electrónico único',
  },
  plazo: { fecha_limite: '2026-10-15T08:00', canal: 'PLACSP' },
  lotes: ['2'],
};

test('should_save_the_casoB_outline_and_give_each_lot_its_criteria_and_offer', () => {
  const g = casoB();
  assert.equal(errorDuroGuion(g), null);
  assert.deepEqual(problemas(g), []);
  assert.deepEqual(
    automaticosDeLote(g, '2').map((a) => a.criterio),
    ['L2 Docente con acreditación oficial de la herramienta', 'Plazo de arranque'],
  );
  assert.equal(automaticosDeLote(g, '1').length, 7, 'C1-C6 y el común');
  assert.deepEqual(
    ofertaDeLote(g, '2')?.precios_unitarios.map((p) => [p.concepto, p.maximo, p.cantidad]),
    [
      ['Edición nivel básico', 4_704, 6],
      ['Edición nivel avanzado', 5_880, 4],
    ],
  );
  assert.equal(ofertaDeLote(g, '9'), null, 'un lote sin oferta no toma la de otro');
  assert.deepEqual(
    documentosDeLote(g.archivos[0]!, '1').map((d) => d.tipo),
    ['deuc', 'oferta_economica'],
    'el certificado de socio del fabricante es solo del lote 2',
  );
  assert.deepEqual(
    tramosDe(g.automaticos[0]!).map((t) => t.puntos),
    [5, 10],
  );
  assert.deepEqual(
    tramosDe(g.automaticos[1]!),
    [{ descripcion: 'C2 Guías de estudio en lectura fácil', puntos: 5 }],
    'sin tramos, uno: el criterio entero',
  );
});

test('should_read_a_v3_outline_as_a_single_economic_offer_with_its_unit_price', () => {
  const g = GuionBase.parse(CASO_E_V3);
  const [o, ...resto] = ofertasEconomicas(g);
  assert.equal(resto.length, 0);
  assert.deepEqual(o?.lotes, ['2']);
  assert.deepEqual(o?.precios_unitarios, [{ concepto: 'alumno', unidad: 'alumno', maximo: 110.25, cantidad: null }]);
  assert.equal(o?.umbral_baja, 0.15, 'el umbral sale del literal del pliego');
  assert.equal(ofertaDeLote(g, '2')?.presupuesto_base, 6_063.75);
  assert.equal(ofertaDeLote(g, null)?.presupuesto_base, 6_063.75, 'sin lote, la única que hay');
  assert.equal(automaticosDeLote(g, '2').length, 0);
});

test('should_reject_an_outline_whose_automatic_criteria_cite_lots_outside_it', () => {
  const g = casoB();
  g.automaticos[1]!.lotes = ['6'];
  assert.deepEqual(problemas(g), [
    'El criterio «C2 Guías de estudio en lectura fácil» cita el lote 6, que no está en el guion (los lotes 1, 2, 3, 4, 5).',
  ]);
});

test('should_require_an_economic_offer_for_each_lot_of_the_outline', () => {
  const g = casoB();
  g.ofertas_economicas = g.ofertas_economicas!.filter((o) => !o.lotes.includes('4') && !o.lotes.includes('5'));
  assert.deepEqual(problemas(g), [
    'Falta la oferta económica del lote 4: una por cada lote del guion, en «ofertas_economicas».',
    'Falta la oferta económica del lote 5: una por cada lote del guion, en «ofertas_economicas».',
  ]);
  const v3 = GuionBase.parse({ ...CASO_E_V3, lotes: ['1', '2', '3', '4', '5'] });
  assert.match(
    problemas(v3).join(' '),
    /una sola «oferta_economica»: envía «ofertas_economicas», una por lote/,
    'CASO_B: un total para cinco lotes',
  );
});

test('should_warn_when_the_formula_scores_a_unit_price_and_none_is_given', () => {
  const g = GuionBase.parse({
    ...CASO_E_V3,
    lotes: undefined,
    oferta_economica: {
      ...CASO_E_V3.oferta_economica,
      presupuesto_base: 30_261,
      precio_unitario: null,
      formula: 'P = 30 × (precio mínimo por informe / precio ofertado por informe)',
    },
  });
  assert.deepEqual(problemas(g), [
    'La fórmula puntúa un precio por informe: añade precios_unitarios (concepto, unidad, máximo y cantidad).',
  ]);
});

test('should_require_increasing_tiers_ending_at_the_criterion_points', () => {
  const g = casoB();
  g.automaticos[0]!.tramos = [
    { descripcion: '16 horas o más adicionales', puntos: 10 },
    { descripcion: 'De 8 a 15 horas adicionales', puntos: 5 },
  ];
  assert.deepEqual(problemas(g), [
    'Los tramos del criterio «C1 Horas de acompañamiento adicionales» van de menos a más puntos y el último vale los del criterio (10): ahora 10, 5.',
  ]);
  g.automaticos[0]!.tramos = [
    { descripcion: 'De 8 a 15 horas adicionales', puntos: 5 },
    { descripcion: '16 horas o más adicionales', puntos: 8 },
  ];
  assert.equal(problemas(g).length, 1, 'el último no da los puntos del criterio');
});

test('should_refuse_a_per_lot_file_in_an_outline_without_lots', () => {
  const g = casoB();
  delete g.lotes;
  assert.match(errorDuroGuion(g) ?? '', /«Sobre único» va «por_lote» y el guion no trae «lotes»/);
});

test('should_compute_lot_amount_and_discount_from_unit_prices_and_quantities', () => {
  const g = casoB();
  const l2 = ofertaDeLote(g, '2');
  const o = {
    lote: '2',
    pendiente: false,
    importe: null,
    unitarios: [
      { concepto: 'Edición nivel básico', precio: 4_233.6 },
      { concepto: 'Edición nivel avanzado', precio: 5_292 },
    ],
  };
  assert.equal(importeDeLote(o, l2), 46_569.6, '4.233,60 × 6 + 5.292 × 4');
  assert.equal(Math.round(bajaDeLote(o, l2)! * 1000) / 1000, 0.1, 'sobre 4.704 × 6 + 5.880 × 4');
  assert.equal(importeDeLote({ ...o, unitarios: o.unitarios.slice(0, 1) }, l2), null, 'falta un precio');
  const casoE = GuionBase.parse(CASO_E_V3);
  assert.equal(
    Math.round(
      bajaDeLote(
        { lote: '2', pendiente: false, importe: null, unitarios: [{ concepto: 'alumno', precio: 93.7125 }] },
        ofertaDeLote(casoE, '2'),
      )! * 1000,
    ) / 1000,
    0.15,
    'una línea sin cantidad: sobre el máximo',
  );
  assert.equal(umbralMinimo(110.25, 0.15), 93.7125);
  assert.deepEqual(
    problemasDePrecios(
      {
        lotes: ['2'],
        ofertas: [
          {
            lote: '2',
            pendiente: false,
            importe: null,
            unitarios: [{ concepto: 'Edición nivel básico', precio: 4_000 }],
          },
        ],
      },
      g,
    ).map((p) => p.mensaje),
    ['Falta el precio de «Edición nivel avanzado» del lote 2 (o marca el lote pendiente).'],
  );
});

// CASO_E: el 2.1 con tramos y el 2.3, que exige el dossier del fabricante.
const CASO_E_AUTOMATICOS = GuionBase.parse({
  ...CASO_E_V3,
  lotes: ['2', '4'],
  automaticos: [
    {
      criterio: '2.1 Tiempo de respuesta de la tutoría',
      puntos: 10,
      como_se_acredita: 'Declaración',
      casilla_en: 'Anexo VI',
      archivo: 'Archivo electrónico único',
      marcas: ['respuesta de la tutoría'],
      tipo: 'compromiso',
      tramos: [
        { descripcion: '4 h o menos', puntos: 5 },
        { descripcion: '2 h o menos', puntos: 8 },
        { descripcion: '1 h o menos', puntos: 10 },
      ],
    },
    {
      criterio: '2.3 Material homologado por el fabricante',
      puntos: 10,
      como_se_acredita: 'Dossier',
      casilla_en: 'Anexo VI',
      archivo: 'Archivo electrónico único',
      marcas: ['dossier homologado'],
      tipo: 'acreditacion',
      exige_documento: 'Dossier Técnico Homologado del fabricante',
    },
  ],
});
const propuesta = (automaticos: Record<string, unknown>[]) =>
  PropuestaDecisionesEntrada.parse({
    id: 'p-91000080',
    guion_id: 1,
    lotes: ['2', '4'],
    equipo: [],
    herramientas: [],
    resumen: 'Propuesta para los lotes 2 y 4.',
    enfoque: 'Formación práctica con casos reales de la plantilla, tutorías en grupos pequeños y seguimiento semanal.',
    automaticos,
  });
const tutoria = {
  criterio: '2.1 Tiempo de respuesta de la tutoría',
  tipo: 'compromiso',
  nos_acogemos: true,
  tramo: '2 h o menos',
  capacidad: 'demostrada',
  evidencia: 'Turnos de tutoría de 2025 (Biblioteca/Operaciones/turnos-2025.xlsx).',
  motivo: 'Con dos tutoras cubrimos 2 h; 1 h exigiría una tercera.',
};
const dossier = {
  criterio: '2.3 Material homologado por el fabricante',
  tipo: 'acreditacion',
  cumple: 'falta_dato',
  capacidad: 'no',
};

test('should_accept_a_commitment_below_the_top_tier_when_only_that_tier_is_proven', () => {
  const p = propuesta([
    tutoria,
    {
      ...dossier,
      nos_acogemos: false,
      tramo: null,
      documento_en_mano: false,
      motivo: '0 puntos: exige el Dossier Técnico Homologado del fabricante, que no está en la Biblioteca.',
    },
  ]);
  assert.deepEqual(problemasDePropuesta(p, { ...CASO_E_AUTOMATICOS, memoria: null }), []);
});

test('should_reject_a_commitment_that_needs_a_document_we_do_not_have', () => {
  const marcado = propuesta([
    tutoria,
    {
      ...dossier,
      cumple: 'si',
      capacidad: 'demostrada',
      evidencia: 'Lo tiene el fabricante.',
      nos_acogemos: true,
      tramo: '2.3 Material homologado por el fabricante',
      motivo: 'Al máximo: lo pide el fabricante.',
    },
  ]);
  assert.deepEqual(problemasDePropuesta(marcado, { ...CASO_E_AUTOMATICOS, memoria: null }), [
    '«2.3 Material homologado por el fabricante» exige «Dossier Técnico Homologado del fabricante» y no consta en la Biblioteca (documento_en_mano): va con nos_acogemos false, 0 puntos, y el motivo lo dice.',
  ]);
  const sinNombrarlo = propuesta([
    tutoria,
    { ...dossier, nos_acogemos: false, tramo: null, motivo: 'Mejor no arriesgar con este criterio.' },
  ]);
  assert.deepEqual(problemasDePropuesta(sinNombrarlo, { ...CASO_E_AUTOMATICOS, memoria: null }), [
    'El motivo de «2.3 Material homologado por el fabricante» debe nombrar el documento que falta: «Dossier Técnico Homologado del fabricante».',
  ]);
});

test('should_reject_an_approach_with_specs_citations_or_negative_instructions', () => {
  const lotes = { ambito: ['2', '4'], licitacion: ['1', '2', '3', '4', '5', '6'] };
  assert.deepEqual(
    problemasDeEnfoque(
      'Contar la formación del lote 2 con hojas de cálculo y la del lote 4 con atención telefónica.',
      lotes,
    ),
    [],
  );
  assert.deepEqual(
    problemasDeEnfoque(
      'En el lote 6, Azure; según Bases, pp. 12, no prometer presencia diaria y evitar tecnicismos.',
      lotes,
    ),
    [
      'Quita del enfoque las citas del pliego («pp. 12»): lo que tomes del pliego, en prosa.',
      'Escribe el enfoque en positivo: lo que la memoria contará y cómo. Lo que no se ofrece no se menciona.',
      'El enfoque habla del lote 6, al que no vamos (vamos a 2, 4): quítalo.',
    ],
  );
  assert.deepEqual(lotesNombrados('Lotes 2, 4 y 6; el lote nº 3 no.'), ['2', '4', '6', '3']);
});

test('should_not_take_a_number_with_unit_as_another_lote', () => {
  assert.deepEqual(lotesNombrados('En el lote 3, 30 alumnas como máximo'), ['3']);
  assert.deepEqual(lotesNombrados('lote 2 y 15 horas de tutoría'), ['2']);
  assert.deepEqual(lotesNombrados('En el lote 3, 30 alumnas', ['3', '4']), ['3']);
  assert.deepEqual(lotesNombrados('Lotes 2, 4 y 6 son nuestros', ['2', '4', '6']), ['2', '4', '6']);
  assert.deepEqual(
    problemasDeEnfoque('En el lote 3, 30 alumnas como máximo', { ambito: ['3'], licitacion: ['1', '2', '3'] }),
    [],
  );
});

// CASO_E: «Horas adicionales» sale dos veces, con lotes y tramos distintos.
const HOMONIMOS = GuionBase.parse({
  ...CASO_E_V3,
  lotes: ['2', '4'],
  automaticos: [
    {
      criterio: 'Horas adicionales',
      puntos: 10,
      como_se_acredita: 'Declaración',
      casilla_en: 'Anexo VII, casilla 2',
      archivo: 'Archivo electrónico único',
      marcas: ['horas adicionales'],
      lotes: ['2'],
      tramos: [
        { descripcion: '10 horas', puntos: 5, valor: '10' },
        { descripcion: '20 horas', puntos: 10, valor: '20' },
      ],
    },
    {
      criterio: 'Horas adicionales',
      puntos: 20,
      como_se_acredita: 'Declaración',
      casilla_en: 'Anexo VII, casilla 5',
      archivo: 'Archivo electrónico único',
      marcas: ['horas adicionales'],
      lotes: ['4'],
      tramos: [
        { descripcion: '30 horas', puntos: 10, valor: '30' },
        { descripcion: '60 horas', puntos: 20, valor: '60' },
      ],
    },
  ],
});
const decidido = (lote: string, tramo: string) => ({
  criterio: 'Horas adicionales',
  lote,
  nos_acogemos: true,
  tramo,
  evidencia: 'Perfil de la empresa',
});

test('should_pick_the_automatic_criterion_of_the_lot_when_two_share_the_same_text', () => {
  assert.equal(automaticoDe(HOMONIMOS, 'Horas adicionales', '4')?.casilla_en, 'Anexo VII, casilla 5');
  assert.equal(automaticoDe(HOMONIMOS, ' horas  ADICIONALES', '2')?.casilla_en, 'Anexo VII, casilla 2');
  assert.equal(
    automaticoDe(HOMONIMOS, 'Horas adicionales', '9'),
    undefined,
    'un lote que no cita ninguno no toma el de otro',
  );
  const d = Decisiones.parse({
    lotes: ['2', '4'],
    automaticos: [decidido('2', '20 horas'), decidido('4', '60 horas')],
  });
  assert.deepEqual(problemasDeTramos(d, HOMONIMOS), [], 'el tramo del lote 4 se compara con los tramos del lote 4');
  assert.match(
    problemasDeTramos(Decisiones.parse({ lotes: ['4'], automaticos: [decidido('4', '20 horas')] }), HOMONIMOS)[0]!,
    /«20 horas» no es ninguno de .*«30 horas», «60 horas»/,
  );
  assert.deepEqual(
    valoresATeclear(d, HOMONIMOS).map((v) => [v.lote, v.valor, v.donde]),
    [
      ['2', '20', 'Anexo VII, casilla 2'],
      ['4', '60', 'Anexo VII, casilla 5'],
    ],
  );
});

test('should_type_the_offered_figure_before_the_tier_value_in_values_to_type', () => {
  // Arrange: en el lote 4 se oferta una cifra (2,25) además del tramo.
  const d = Decisiones.parse({
    lotes: ['2', '4'],
    automaticos: [decidido('2', '20 horas'), { ...decidido('4', '60 horas'), valor: 2.25 }],
  });

  // Act
  const valores = valoresATeclear(d, HOMONIMOS);

  // Assert
  assert.deepEqual(
    valores.map((v) => [v.lote, v.valor]),
    [
      ['2', '20'],
      ['4', '2,25'],
    ],
  );
});

test('should_fill_the_only_tier_of_the_lot_criterion_not_the_one_of_a_homonym', () => {
  const g = structuredClone(HOMONIMOS);
  g.automaticos[1]!.tramos = [{ descripcion: '30 horas', puntos: 20, valor: '30' }];
  const d = normalizarDecisiones(
    Decisiones.parse({ lotes: ['2', '4'], automaticos: [{ ...decidido('4', '30 horas'), tramo: null }] }),
    g,
  );
  assert.equal(d.automaticos[0]!.tramo, '30 horas');
});

test('should_not_copy_a_v1_total_amount_to_every_lot_but_share_a_unit_price', () => {
  const unico = { lote: null, pendiente: false, importe: 80_000, unitarios: [] };
  const total = GuionBase.parse({
    ...CASO_E_V3,
    lotes: ['1', '2'],
    oferta_economica: { ...CASO_E_V3.oferta_economica, precio_unitario: null },
  });
  assert.deepEqual(
    normalizarOfertas([unico], ['1', '2'], total),
    [
      { lote: '1', pendiente: true, importe: null, unitarios: [] },
      { lote: '2', pendiente: true, importe: null, unitarios: [] },
    ],
    'el total del contrato no es el importe de cada lote',
  );
  assert.deepEqual(
    normalizarOfertas([unico], ['2'], total),
    [{ ...unico, lote: '2' }],
    'con un solo lote, el precio es el de ese lote',
  );
  const unitario = GuionBase.parse({ ...CASO_E_V3, lotes: ['1', '2'] });
  assert.deepEqual(
    normalizarOfertas([{ ...unico, importe: 100 }], ['1', '2'], unitario).map((o) => [o.lote, o.unitarios[0]?.precio]),
    [
      ['1', 100],
      ['2', 100],
    ],
    'un precio por alumno vale en cada lote',
  );
});

test('should_give_max_unit_price_per_lot_from_outline', () => {
  const g = GuionBase.parse(CASO_E_V3);
  assert.deepEqual(maximosPorLote(g, ['2'], { '2': 6_063.75 }), [
    { lote: '2', unidad: 'alumno', maximo: 110.25, presupuesto: 6_063.75 },
  ]);
});

test('should_give_null_max_and_each_lot_budget_when_outline_has_no_max', () => {
  // Guion v3: una sola oferta para los lotes 2 y 4, con el presupuesto del contrato (6.819,75).
  const g = GuionBase.parse({
    ...CASO_E_V3,
    lotes: ['2', '4'],
    oferta_economica: {
      ...CASO_E_V3.oferta_economica,
      presupuesto_base: 6_819.75,
      precio_unitario: { unidad: 'alumno', maximo: null },
    },
  });
  assert.deepEqual(
    maximosPorLote(g, ['2', '4'], { '2': 6_063.75, '4': 756 }).map((x) => [x.lote, x.maximo, x.presupuesto]),
    [
      ['2', null, 6_063.75],
      ['4', null, 756],
    ],
  );
  assert.deepEqual(
    maximosPorLote(g, ['2', '4']).map((x) => x.presupuesto),
    [null, null],
    'sin el del lote, el del contrato no pasa por el del lote',
  );
  assert.deepEqual(
    maximosPorLote(g, []).map((x) => [x.lote, x.presupuesto]),
    [[null, 6_819.75]],
    'sin lotes, una fila del contrato entero',
  );
});

// CASO_E sin precio unitario: un total de prueba (no es el ofertado) con IGIC aparte en el guion.
const casoETotal = (): GuionBaseData =>
  GuionBase.parse({
    ...CASO_E_V3,
    lotes: undefined,
    oferta_economica: { ...CASO_E_V3.oferta_economica, precio_unitario: null },
  });
const conImpuesto = (impuesto: { tipo: 'IVA' | 'IGIC' | 'exento'; porcentaje: number | null } | null) =>
  Decisiones.parse({ ofertas: [{ lote: null, pendiente: false, importe: 1_000 }], datos_anexo: { impuesto } });
const fiscales = (d: ReturnType<typeof conImpuesto>) =>
  valoresATeclear(d, casoETotal())
    .filter((v) => /Impuesto|Cuota|Total con/.test(v.concepto))
    .map((v) => [v.concepto, v.valor.replace(/\s/g, ' ')]);

test('should_type_exempt_in_values_when_the_offer_decided_exempt_despite_igic_in_the_outline', () => {
  // Act
  const valores = fiscales(conImpuesto({ tipo: 'exento', porcentaje: 0 }));

  // Assert
  assert.deepEqual(valores, [['Impuesto', 'Exento']], 'ni cuota ni total con IGIC: cuadra con la hoja y el anexo');
});

test('should_type_the_decided_igic_rate_with_its_quota_and_no_confirm_warning', () => {
  // Act
  const valores = fiscales(conImpuesto({ tipo: 'IGIC', porcentaje: 3 }));

  // Assert
  assert.deepEqual(
    valores.map(([c]) => c),
    ['Impuesto', 'Cuota de IGIC', 'Total con IGIC'],
  );
  assert.equal(valores[0]![1], 'IGIC 3 %');
  assert.match(valores[1]![1]!, /^30,00 €/);
  assert.match(valores[2]![1]!, /^1\.030,00 €/);
});

test('should_keep_the_general_rate_warning_when_the_tax_is_undecided', () => {
  // Act
  const valores = fiscales(conImpuesto(null));

  // Assert
  assert.equal(valores[0]![1], 'IGIC 7 % (tipo general: confírmalo en el pliego)');
});
