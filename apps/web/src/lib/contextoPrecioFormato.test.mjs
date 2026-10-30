import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avisoMargen,
  costeGuardado,
  importeDeOferta,
  leerCoste,
  lineaOrgano,
  ofertasConCoste,
  textoIndicios,
  textoUnLicitador,
} from './contextoPrecioFormato.js';

const CASO_D = {
  ofertas_media: 1,
  baja_media: 0,
  ultima: { anio: 2022, ganador: 'Archivera Insular SL', baja: 0, ofertas: 1 },
  n: 1,
};

test('should_format_organ_context_line', () => {
  assert.equal(lineaOrgano(CASO_D), 'Este órgano: 1 oferta, 0,0 % de baja (2022) · ganó Archivera Insular SL');
  assert.equal(
    lineaOrgano({
      ofertas_media: 2.5,
      baja_media: 0.083,
      ultima: { anio: 2024, ganador: 'Otra SL', baja: 0.12, ofertas: 3 },
      n: 4,
    }),
    'Este órgano: 3 ofertas, 12,0 % de baja (2024) · ganó Otra SL · media de 4 adjudicaciones: 2,5 ofertas, 8,3 % de baja',
  );
  assert.equal(
    lineaOrgano({
      ofertas_media: null,
      baja_media: null,
      ultima: { anio: 2023, ganador: 'X SL', baja: null, ofertas: null },
      n: 1,
    }),
    'Este órgano: ofertas sin publicar, — de baja (2023) · ganó X SL',
  );
});

test('should_say_there_are_no_awards_for_an_empty_organ', () => {
  assert.equal(
    lineaOrgano({ ofertas_media: null, baja_media: null, ultima: null, n: 0 }),
    'Este órgano: sin adjudicaciones publicadas en el histórico cargado.',
  );
  assert.equal(lineaOrgano(null), 'Este órgano: sin adjudicaciones publicadas en el histórico cargado.');
});

test('should_show_the_one_bidder_scenario_only_when_known', () => {
  assert.equal(
    textoUnLicitador({
      un_licitador: {
        texto: 'Con un solo licitador cualquier baja da los 49 puntos: no hace falta bajar',
        baja_recomendada: 0,
      },
    }),
    'Con un solo licitador cualquier baja da los 49 puntos: no hace falta bajar',
  );
  assert.equal(textoUnLicitador({ un_licitador: null }), null);
  assert.equal(textoIndicios('alto'), 'Indicios de licitación con nombre: alto');
  assert.equal(textoIndicios(null), null);
});

test('should_warn_on_negative_margin', () => {
  // Intl separa la cifra y el símbolo con un espacio duro.
  const llano = (a) => ({ ...a, texto: a.texto.replace(/\u00A0/g, ' ') });
  assert.deepEqual(llano(avisoMargen(5000, 6200)), {
    negativo: true,
    texto: 'El precio queda por debajo del coste estimado: pierdes 1.200 €.',
  });
  assert.deepEqual(llano(avisoMargen(7000, 5600)), { negativo: false, texto: 'Margen estimado: 1.400 € (20,0 %).' });
  assert.equal(avisoMargen(null, 5600), null);
  assert.equal(avisoMargen(7000, null), null);
});

test('should_compute_the_lot_amount_like_the_server_from_unit_prices', () => {
  const oe = { precios_unitarios: [{ concepto: 'Hora de formación', cantidad: 100 }] };
  assert.equal(
    importeDeOferta({ importe: 900, unitarios: [] }, { precios_unitarios: [] }),
    900,
    'sin líneas, el total',
  );
  assert.equal(
    importeDeOferta({ importe: null, unitarios: [{ concepto: 'hora de formacion', precio: 30 }] }, oe),
    3000,
    'sin mayúsculas ni tildes',
  );
  assert.equal(importeDeOferta({ importe: 900, unitarios: [] }, oe), null, 'con líneas, el total suelto no cuenta');
  assert.equal(
    importeDeOferta(
      { importe: null, unitarios: [{ concepto: 'Hora de formación', precio: 30 }] },
      { precios_unitarios: [{ concepto: 'Hora de formación', cantidad: null }] },
    ),
    null,
  );
  assert.equal(importeDeOferta(null, oe), null);
});

test('should_read_the_cost_field_and_reject_text', () => {
  assert.deepEqual(leerCoste('4.500'), { data: 4500, error: null });
  assert.deepEqual(leerCoste(''), { data: null, error: null });
  assert.equal(leerCoste('mucho').error, 'Escribe el coste en euros, sin impuestos (p. ej. 4.500).');
});

test('should_put_the_cost_on_its_lot_and_keep_the_others', () => {
  const guardadas = [
    { lote: '1', pendiente: false, importe: 100, unitarios: [] },
    { lote: '2', pendiente: false, importe: 200, unitarios: [], coste_estimado: 50 },
  ];

  const con = ofertasConCoste(guardadas, '2', 180);
  const nueva = ofertasConCoste([], '2', 180);

  assert.deepEqual(con, [guardadas[0], { ...guardadas[1], coste_estimado: 180 }]);
  assert.deepEqual(nueva, [{ lote: '2', pendiente: true, importe: null, unitarios: [], coste_estimado: 180 }]);
  assert.equal(costeGuardado(con, '2'), '180');
  assert.equal(costeGuardado(con, '1'), '');
});
