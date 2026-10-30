import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bajaEnVivo,
  causaSinSugerencia,
  estadoPrecio,
  filaInicial,
  guardadoDeLote,
  leerPrecio,
  leerPreciosLote,
  ofertasConLote,
  sugerenciasUnicas,
  textoSugerencia,
  textoUmbral,
  umbralBaja,
} from './precioEnLinea.js';

const opcion = (importe, baja = 0.1) => ({ importe, baja, ganadas: 0.8 });
const sugerido = (extra = {}) => ({
  base: 6000,
  unidad: null,
  referencia: 'lote',
  comparables: 12,
  ofertas_esperadas: 3,
  umbral_anormal: 0.2,
  equilibrio: opcion(5604),
  maxima: opcion(5000, 0.18),
  avisos: [],
  ...extra,
});
// Villaejemplo, lote 3: guion v3 con el precio por hora (máximo 1,54 €) y el umbral del pliego sobre la media.
const oeCasoC = (maximo = 1.54) => ({
  lotes: ['3'],
  presupuesto_base: 18557,
  documento: 'PCAP.pdf',
  pagina: 73,
  umbral_anormalidad:
    'c) Cuando concurran tres o más licitadores: las ofertas inferiores en más de 30 unidades porcentuales a la media aritmética…',
  precios_unitarios: [{ concepto: 'hora', unidad: 'hora', maximo, cantidad: null }],
});

test('should_never_report_a_suggested_price_as_decided', () => {
  // Arrange
  const s = sugerido();
  const usado = { importe: '5.604', unitarios: [] };

  // Act
  const sinNada = estadoPrecio({ guardado: null, borrador: null, sugerido: s });
  const conUsar = estadoPrecio({
    guardado: { lote: '2', pendiente: true, importe: null, unitarios: [] },
    borrador: usado,
    sugerido: s,
  });
  const guardado = estadoPrecio({
    guardado: { lote: '2', pendiente: false, importe: 5604, unitarios: [] },
    borrador: usado,
    sugerido: s,
  });

  // Assert
  assert.equal(sinNada, 'sugerido');
  assert.equal(conUsar, 'sugerido');
  assert.equal(guardado, 'decidido');
});

test('should_show_a_single_suggestion_when_equilibrium_and_max_probability_match', () => {
  // Arrange
  const iguales = sugerido({ equilibrio: opcion(5604), maxima: opcion(5604) });

  // Act
  const una = sugerenciasUnicas(iguales);
  const dos = sugerenciasUnicas(sugerido());

  // Assert
  assert.equal(una.length, 1);
  assert.match(textoSugerencia(una[0]), /^Equilibrio y máxima probabilidad: 5\.604\s€$/);
  assert.deepEqual(
    dos.map((s) => s.clave),
    ['equilibrio', 'maxima'],
  );
  assert.deepEqual(sugerenciasUnicas(null), []);
});

test('should_say_the_lot_maximum_is_missing_instead_of_blaming_the_budget', () => {
  // Arrange
  const sinMaximo = oeCasoC(null);

  // Act
  const causa = causaSinSugerencia(sinMaximo, '3', null);

  // Assert
  assert.match(causa, /^No consta el máximo por hora del lote 3/);
  assert.doesNotMatch(causa, /presupuesto/);
  assert.equal(
    causaSinSugerencia(oeCasoC(), '3', sugerido({ equilibrio: null, maxima: null })),
    'Sin precio sugerido: no hay adjudicaciones parecidas con las que compararlo.',
  );
  assert.equal(causaSinSugerencia(oeCasoC(), '3', sugerido()), null);
});

test('should_use_the_tender_threshold_when_the_script_brings_it', () => {
  // Arrange
  const delPliego = { presupuesto_base: 6000, precios_unitarios: [], umbral_baja: 0.29, documento: 'PCAP', pagina: 23 };
  const s = sugerido();

  // Act
  const texto = textoUmbral(s, delPliego);
  const estimado = textoUmbral(s, { presupuesto_base: 6000, precios_unitarios: [] });

  // Assert
  assert.equal(texto, 'Baja máxima sin anormalidad: 29 % · PCAP pág. 23');
  assert.equal(umbralBaja(s, delPliego), 0.29);
  assert.match(estimado, /^Umbral de anormalidad estimado: baja del 20 %/);
  assert.match(textoUmbral(sugerido({ umbral_anormal: null }), oeCasoC()), /el del pliego · PCAP\.pdf pág\. 73/);
  assert.match(textoUmbral(null, null), /art\. 85 RGLCAP/);
});

test('should_flag_a_live_discount_that_passes_the_threshold', () => {
  // Arrange / Act
  const dentro = bajaEnVivo(1.5, 1.54, { unidad: 'hora', umbral: 0.29 });
  const pasa = bajaEnVivo(1, 1.54, { unidad: 'hora', umbral: 0.29 });

  // Assert
  assert.equal(dentro.pasa, false);
  assert.match(dentro.texto, /^Baja del 2,6 % sobre 1,54\s€ por hora\.$/);
  assert.equal(pasa.pasa, true);
  assert.match(pasa.texto, /Pasa del umbral de anormalidad/);
  assert.equal(bajaEnVivo(null, 1.54), null);
  assert.equal(bajaEnVivo(1, null), null);
});

test('should_reject_a_price_above_the_lot_maximum', () => {
  // Arrange / Act
  const encima = leerPrecio('1,70', { maximo: 1.54, unidad: 'hora' });
  const cero = leerPrecio('0', { maximo: 1.54 });
  const letras = leerPrecio('mucho', {});
  const bien = leerPrecio('1,45', { maximo: 1.54, unidad: 'hora' });

  // Assert
  assert.equal(encima.data, null);
  assert.match(encima.error, /pasa del máximo por hora del lote \(1,54\s€ por hora\)/);
  assert.match(cero.error, /Escribe el precio/);
  assert.match(letras.error, /Escribe el precio/);
  assert.deepEqual(bien, { data: 1.45, error: null });
});

test('should_treat_an_empty_price_as_pending', () => {
  // Arrange
  const fila = { lote: '3', pendiente: true, importe: '', unitarios: [{ concepto: 'hora', precio: '  ' }] };

  // Act
  const r = leerPreciosLote(fila, oeCasoC());

  // Assert
  assert.deepEqual(leerPrecio('', {}), { data: null, error: null });
  assert.deepEqual(r, { data: { lote: '3', pendiente: true, importe: null, unitarios: [] }, error: null });
  assert.equal(
    estadoPrecio({
      guardado: { lote: '3', pendiente: false, importe: null, unitarios: [] },
      borrador: fila,
      sugerido: null,
    }),
    'pendiente',
  );
});

test('should_read_unit_prices_line_by_line_with_their_maximum', () => {
  // Arrange
  const oe = {
    precios_unitarios: [
      { concepto: 'Básico', unidad: 'edición', maximo: 4704 },
      { concepto: 'Avanzado', unidad: 'edición', maximo: 5000 },
    ],
  };

  // Act
  const bien = leerPreciosLote(
    {
      lote: '1',
      importe: '',
      unitarios: [
        { concepto: 'Básico', precio: '4.000' },
        { concepto: 'Avanzado', precio: '' },
      ],
    },
    oe,
  );
  const mal = leerPreciosLote(
    {
      lote: '1',
      importe: '',
      unitarios: [
        { concepto: 'Básico', precio: '4.000' },
        { concepto: 'Avanzado', precio: '5.100' },
      ],
    },
    oe,
  );

  // Assert
  assert.deepEqual(bien.data, {
    lote: '1',
    pendiente: false,
    importe: null,
    unitarios: [{ concepto: 'Básico', precio: 4000 }],
  });
  assert.match(mal.error, /^Avanzado: .*pasa del máximo por edición/);
});

test('should_replace_only_this_lot_in_the_saved_prices', () => {
  // Arrange
  const guardadas = [
    { lote: '2', pendiente: false, importe: 10, unitarios: [] },
    { lote: '4', pendiente: true, importe: null, unitarios: [] },
  ];
  const nueva = { lote: '4', pendiente: false, importe: 7, unitarios: [] };

  // Act
  const r = ofertasConLote(guardadas, nueva);

  // Assert
  assert.deepEqual(r, [guardadas[0], nueva]);
  assert.deepEqual(ofertasConLote([], nueva), [nueva]);
});

test('should_fill_the_row_from_the_saved_price_of_the_lot', () => {
  // Arrange
  const antiguas = [{ lote: null, pendiente: false, importe: 1.45, unitarios: [] }];

  // Act
  const g = guardadoDeLote(antiguas, '3');
  const fila = filaInicial(oeCasoC(), '3', g);
  const vacia = filaInicial({ presupuesto_base: 100, precios_unitarios: [] }, '2', guardadoDeLote([], '2'));

  // Assert
  assert.deepEqual(fila, { lote: '3', importe: '', unitarios: [{ concepto: 'hora', precio: '1,45' }] });
  assert.deepEqual(vacia, { lote: '2', importe: '', unitarios: [] });
});

test('should_keep_the_saved_estimated_cost_when_saving_the_price_of_the_lot', () => {
  const guardadas = [{ lote: '3', pendiente: true, importe: null, unitarios: [], coste_estimado: { total: 1000 } }];
  const nueva = { lote: '3', pendiente: false, importe: 7, unitarios: [] };

  const r = ofertasConLote(guardadas, nueva);

  assert.deepEqual(r, [{ ...nueva, coste_estimado: { total: 1000 } }]);
});
