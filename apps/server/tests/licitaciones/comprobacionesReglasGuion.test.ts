// Validaciones del guion en las comprobaciones sobre entradas sintéticas (puras, sin BD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reglasGuion, tipoFormula } from '../../src/dominios/licitaciones/oferta/comprobacionesReglasGuion.js';
import type { EntradasComprobaciones } from '../../src/dominios/licitaciones/oferta/comprobacionesEntradas.js';

type J = Record<string, any>;
const LINEAL = 'P = 49 × (BO – B) ÷ (BO – BMAX)';

function oferta(lotes: string[], formula = LINEAL): J {
  return {
    lotes,
    formula,
    presupuesto_base: 1000,
    impuesto_aparte: 'IGIC',
    umbral_anormalidad: null,
    modelo: null,
    archivo: 'Sobre C',
    precios_unitarios: [],
    documento: 'PCAP.pdf',
    pagina: 12,
  };
}

function guion(p: J = {}): J {
  return {
    archivos: [{ nombre: 'Sobre B' }, { nombre: 'Sobre C' }],
    memoria: { archivo: 'Sobre B', documento: 'PCAP.pdf', pagina: 10, apartados: [{ puntos: 25 }, { puntos: 15 }] },
    automaticos: [{ criterio: 'Horas adicionales', puntos: 15 }],
    ofertas_economicas: [oferta([])],
    ...p,
  };
}

const CRITERIOS = [
  { descripcion: 'Oferta económica', peso: 45, tipo: 'formula' },
  { descripcion: 'Horas adicionales', peso: 15, tipo: 'formula' },
  { descripcion: 'Memoria técnica', peso: 40, tipo: 'juicio_valor' },
];

function entradas(g: J | null, criterios: J[] = CRITERIOS, ambito: string[] = []): EntradasComprobaciones {
  return {
    guion: g ? { id: 7, datos: g } : null,
    ficha: { datos: { criterios } },
    ambito,
  } as unknown as EntradasComprobaciones;
}

test('should_return_nothing_when_points_add_up_and_formula_is_known', () => {
  assert.deepEqual(reglasGuion(entradas(guion())), []);
});

test('should_return_nothing_without_guion', () => {
  assert.deepEqual(reglasGuion(entradas(null)), []);
});

test('should_block_when_guion_points_do_not_add_up_to_the_sheet', () => {
  const r = reglasGuion(entradas(guion({ automaticos: [{ criterio: 'Horas adicionales', puntos: 10 }] })));
  assert.equal(r.length, 1);
  assert.equal(r[0]!.clave, 'guion_pesos:-');
  assert.equal(r[0]!.gravedad, 'impide');
  assert.equal(r[0]!.accion.tipo, 'extraer_guion');
  assert.equal(
    r[0]!.titulo,
    'Los criterios del guion suman 95 puntos y la ficha reparte 100: vuelve a extraer el guion o revisa la ficha',
  );
});

test('should_check_points_per_lot_when_the_sheet_splits_them_by_lot', () => {
  const criterios = [
    { descripcion: 'Lote 1: mejora económica', peso: 49, tipo: 'formula' },
    { descripcion: 'Lote 1: soporte adicional', peso: 51, tipo: 'formula' },
    { descripcion: 'Lote 2: mejora económica', peso: 49, tipo: 'formula' },
    { descripcion: 'Lote 2: soporte adicional', peso: 51, tipo: 'formula' },
  ];
  const g = guion({
    lotes: ['1', '2'],
    memoria: null,
    automaticos: [
      { criterio: 'Soporte', puntos: 51, lotes: ['1'] },
      { criterio: 'Soporte', puntos: 41, lotes: ['2'] },
    ],
    ofertas_economicas: [oferta(['1']), oferta(['2'])],
  });
  const r = reglasGuion(entradas(g, criterios));
  assert.deepEqual(
    r.map((b) => b.clave),
    ['guion_pesos:2'],
  );
  assert.equal(r[0]!.lote, '2');
});

test('should_only_check_lots_of_interest', () => {
  const g = guion({
    lotes: ['1', '2'],
    memoria: null,
    automaticos: [{ criterio: 'Soporte', puntos: 1, lotes: ['2'] }],
    ofertas_economicas: [oferta(['1']), oferta(['2'])],
  });
  const criterios = [
    { descripcion: 'Precio', peso: 50, tipo: 'formula' },
    { descripcion: 'Soporte', peso: 50, tipo: 'formula' },
  ];
  assert.deepEqual(
    reglasGuion(entradas(g, criterios, ['1'])).map((b) => b.clave),
    ['guion_pesos:1'],
  );
});

// Sin poder juzgar, «no comprobado» a la vista en vez de callar.
test('should_say_not_checked_when_there_is_no_single_price_criterion', () => {
  const sinPrecio = CRITERIOS.filter((c) => c.descripcion !== 'Oferta económica');
  const [ninguno] = reglasGuion(entradas(guion({ automaticos: [] }), sinPrecio));
  assert.deepEqual([ninguno?.clave, ninguno?.gravedad], ['guion_pesos:-', 'no_comprobado']);
  assert.match(ninguno!.titulo, /ningún criterio de precio/);
  const dos = [...CRITERIOS, { descripcion: 'Mejoras económicas', peso: 5, tipo: 'formula' }];
  const [doble] = reglasGuion(entradas(guion(), dos));
  assert.match(doble!.titulo, /2 criterios económicos \(«Oferta económica», «Mejoras económicas»\)/);
});

test('should_say_not_checked_when_an_automatic_criterion_looks_like_the_price', () => {
  const g = guion({ automaticos: [{ criterio: 'Precio del servicio', puntos: 45 }] });
  const [b] = reglasGuion(entradas(g));
  assert.equal(b?.gravedad, 'no_comprobado');
  assert.match(b!.titulo, /«Precio del servicio» entre los automáticos/);
});

test('should_not_check_points_without_a_sheet', () => {
  const e = { guion: { id: 7, datos: guion() }, ficha: null, ambito: [] } as unknown as EntradasComprobaciones;
  assert.equal(reglasGuion(e).filter((b) => b.clave.startsWith('guion_pesos')).length, 0);
});

test('should_not_count_a_non_scored_memoria', () => {
  const g = guion({
    memoria: { archivo: 'Sobre C', valorable: false, apartados: [{ puntos: 0 }] },
    automaticos: [{ criterio: 'Horas', puntos: 55 }],
  });
  assert.deepEqual(
    reglasGuion(
      entradas(
        g,
        CRITERIOS.filter((c) => c.tipo === 'formula').map((c) => ({ ...c, peso: c.peso === 15 ? 55 : 45 })),
      ),
    ),
    [],
  );
});

test('should_warn_once_per_offer_when_the_price_formula_is_unknown', () => {
  const rara = 'Se otorgará la puntuación según el criterio del órgano';
  const g = guion({ lotes: ['1', '2'], ofertas_economicas: [oferta(['1', '2'], rara)] });
  const r = reglasGuion(entradas(g)).filter((b) => b.clave.startsWith('guion_formula'));
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravedad, 'riesgo');
  assert.equal(r[0]!.categoria, 'precio');
  assert.equal(r[0]!.cita?.pagina, 12);
});

test('should_block_a_scored_memoria_in_the_price_file', () => {
  const g = guion({
    memoria: { archivo: 'Sobre C', documento: 'PCAP.pdf', pagina: 10, apartados: [{ puntos: 25 }, { puntos: 15 }] },
  });
  const r = reglasGuion(entradas(g));
  assert.deepEqual(
    r.map((b) => [b.clave, b.gravedad]),
    [['guion_sobres:-', 'impide']],
  );
});

test('should_allow_a_non_scored_memoria_in_a_single_file', () => {
  const g = guion({
    archivos: [{ nombre: 'Sobre C' }],
    memoria: { archivo: 'Sobre C', valorable: false, apartados: [{ puntos: 0 }] },
    automaticos: [{ criterio: 'Horas', puntos: 15 }],
  });
  assert.equal(
    reglasGuion(
      entradas(
        g,
        CRITERIOS.filter((c) => c.tipo === 'formula').concat({ descripcion: 'Más horas', peso: 40, tipo: 'formula' }),
      ),
    ).filter((b) => b.clave.startsWith('guion_sobres')).length,
    0,
  );
});

test('should_recognise_the_price_formulas_of_the_five_offers', () => {
  assert.equal(tipoFormula('Puntuación = X*((A-B) /(A-C)) Donde: C es el precio más bajo'), 'lineal');
  assert.equal(tipoFormula(LINEAL), 'lineal');
  assert.equal(
    tipoFormula('Las restantes ofertas se puntuarán de forma proporcional a la oferta económica más baja'),
    'proporcional',
  );
  assert.equal(tipoFormula('COEi = PMED / P, dónde PMED = precio medio de las ofertas'), 'media');
  assert.equal(tipoFormula('Pi = Pmax · (1 + log₁₀(Omin / Oi))'), 'logaritmica');
  assert.equal(tipoFormula('P = Pmax × Omin / Oi'), 'proporcional');
  assert.equal(tipoFormula('A criterio de la mesa'), null);
});

// Banco de fórmulas de otros pliegos (revisión de la): las formas habituales de la LCSP,
// escritas como las escriben los órganos, con el tipo que les toca.
const BANCO: [string, ReturnType<typeof tipoFormula>][] = [
  ['Puntos = 40 · (1 - (Oi - Omin)/Pbase)', 'lineal'],
  ['Mejora económica sin coste adicional: 1 punto por cada 1% de baja', 'lineal'],
  ['Por cada 1 % de baja, 2 puntos', 'lineal'],
  ['Pi = Pmax × (PBL − Oi) / (PBL − Omin)', 'lineal'],
  ['P = 30 * Bi / Bmax, donde Bi es la baja de la oferta i y Bmax la mayor baja', 'lineal'],
  ['La puntuación se asignará de forma proporcional a la baja ofertada respecto del presupuesto base', 'lineal'],
  ['Pi = 50 x (1 - (Oi - Omin) / Omin)', 'lineal'],
  ['Puntuación lineal entre la oferta más baja (máxima puntuación) y el presupuesto (0 puntos)', 'lineal'],
  ['Pi = Pmax * Omin / Oi', 'proporcional'],
  ['Se otorgará la máxima puntuación a la oferta más baja y al resto por regla de tres inversa', 'proporcional'],
  ['P = 60 x (oferta más baja / oferta que se valora)', 'proporcional'],
  ['Puntuación inversamente proporcional al precio ofertado', 'proporcional'],
  ['Pi = Pmax · Omed / Oi, donde Omed es la media aritmética de las ofertas admitidas', 'media'],
  [
    'La oferta igual a la media de las ofertas obtiene 20 puntos y se suman o restan 2 puntos por cada punto de desviación',
    'media',
  ],
  ['Pi = Pmax · (1 + ln(Omin / Oi))', 'logaritmica'],
  ['Pi = Pmax · log(PBL/Oi) / log(PBL/Omin)', 'logaritmica'],
  ['De 0 % a 5 % de baja: 5 puntos; de 5 % a 10 %: 10 puntos; más del 10 %: 15 puntos', 'tramos'],
  ['Baja escalonada: hasta 15 puntos según el tramo de baja', 'tramos'],
  ['Se valorará el precio con el criterio de la mejor oferta, descartadas las anormales', null],
  ['Se puntuará según el informe técnico de la mesa', null],
];

test('should_classify_a_bank_of_price_formulas_from_other_tenders', () => {
  const fallos = BANCO.filter(([f, tipo]) => tipoFormula(f) !== tipo).map(
    ([f, tipo]) => `${f} → ${tipoFormula(f)} (esperado ${tipo})`,
  );
  assert.deepEqual(fallos, []);
});
