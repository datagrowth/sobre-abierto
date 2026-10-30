import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cuentaPorRevisar,
  filtrarLibro,
  porquesRespondidos,
  opcionesDeAlcance,
  resumenComparacion,
  textoActaQueFalta,
  textoAlcanceLeccion,
  textoEvidencia,
  textoUso,
  tramosComparacion,
} from './aprendizajeFormato.js';

test('should_say_the_scope_of_a_lesson_like_the_mockup', () => {
  assert.equal(textoAlcanceLeccion({ alcance: 'general', tema: 'planificacion' }), 'Tema Planificación');
  assert.equal(textoAlcanceLeccion({ alcance: 'organo', alcance_valor: 'CASO_A', tema: null }), 'Órgano: CASO_A');
  assert.equal(
    textoAlcanceLeccion({ alcance: 'cpv', alcance_valor: '7231', tema: 'metodologia' }),
    'CPV 7231 · Metodología',
  );
});

test('should_offer_scopes_with_the_values_of_its_tender', () => {
  const o = opcionesDeAlcance({
    licitacion_id: 'p-1',
    opciones_alcance: { organo: 'CASO_A', cpv: '7911', tipo_contrato: '2', tipo_contrato_nombre: 'Servicios' },
  });
  assert.deepEqual(
    o.map((x) => [x.valor, x.alcance_valor]),
    [
      ['general', null],
      ['licitacion', 'p-1'],
      ['organo', 'CASO_A'],
      ['cpv', '7911'],
      ['tipo_contrato', '2'],
    ],
  );
  assert.deepEqual(
    opcionesDeAlcance({ licitacion_id: null, opciones_alcance: {} }).map((x) => x.valor),
    ['general'],
    'un acta sin licitación: solo general',
  );
});

test('should_show_the_evidence_with_where_it_comes_from', () => {
  assert.equal(
    textoEvidencia({
      evidencias: [{ ubicacion: 'apartado 2 · Planificación', documento: 'memoria.docx', texto: '+ el 3 de marzo' }],
    }),
    'apartado 2 · Planificación · memoria.docx: + el 3 de marzo',
  );
  assert.equal(textoEvidencia({ evidencias: [] }), null);
  assert.equal(
    textoEvidencia({
      evidencias: [
        {
          ubicacion: 'cambio 5 · apartado 1',
          documento: null,
          texto: '– 20 horas de soporte',
          porque: 'No lo pedía el pliego',
        },
      ],
    }),
    'cambio 5 · apartado 1: – 20 horas de soporte · Por qué: No lo pedía el pliego',
  );
  assert.deepEqual(
    porquesRespondidos({
      preguntas: [
        { n: 5, respuesta: 'No lo pedía el pliego' },
        { n: 7, respuesta: null },
      ],
    }),
    { 5: 'No lo pedía el pliego' },
  );
});

test('should_say_where_a_lesson_was_used_and_what_the_critic_said', () => {
  assert.equal(textoUso({ aplicaciones: 0 }), 'Aún no se ha aplicado');
  assert.equal(
    textoUso({ aplicaciones: 3, ofertas: 2, cumplidas: 2, comprobadas: 3, nota_critico: 78 }),
    'En 3 apartados de 2 ofertas · cumplida 2 de 3 · crítico 78 %',
  );
  assert.equal(
    textoUso({ aplicaciones: 1, ofertas: 1, cumplidas: 0, comprobadas: 0, nota_critico: null }),
    'En 1 apartado de 1 oferta',
  );
});

test('should_filter_the_book_by_theme_origin_strength_and_text', () => {
  const libro = [
    { texto: 'Cronograma con fechas', tema: 'planificacion', origen: 'edicion', fuerza: 2, alcance_valor: null },
    {
      texto: 'Indicadores cuantificados',
      tema: 'calidad',
      origen: 'mesa',
      fuerza: 1,
      alcance_valor: 'Cabildo de Isla Ejemplo',
    },
  ];
  assert.equal(filtrarLibro(libro, { tema: 'planificacion' }).length, 1);
  assert.equal(filtrarLibro(libro, { fuerza: 2 }).length, 1);
  assert.equal(filtrarLibro(libro, { texto: 'isla ejemplo' })[0].origen, 'mesa');
  assert.equal(filtrarLibro(libro, {}).length, 2);
});

test('should_summarise_a_comparison_most_frequent_first', () => {
  const r = {
    total: 32,
    por_tipo: { estructura: 8, especificidad: 12, recorte: 6, correccion_dato: 4, compromiso: 2 },
  };
  assert.equal(
    resumenComparacion(r),
    '32 cambios: 12 de especificidad · 8 de estructura · 6 recortes · 4 de datos · 2 compromisos',
  );
  assert.deepEqual(
    tramosComparacion(r).map((t) => [t.tipo, t.pct]),
    [
      ['especificidad', 37.5],
      ['estructura', 25],
      ['recorte', 18.75],
      ['correccion_dato', 12.5],
      ['compromiso', 6.25],
    ],
  );
  assert.equal(
    resumenComparacion({ total: 0, por_tipo: {} }),
    'Sin cambios entre la memoria de Hermes y la presentada',
  );
});

test('should_count_what_is_left_to_review_and_say_where_to_leave_the_acta', () => {
  assert.equal(cuentaPorRevisar({ lecciones: [1, 2], porques: [1], actas: [] }), 3);
  const agosto = Date.parse('2026-09-01T10:00:00Z');
  assert.equal(
    textoActaQueFalta(
      {
        resultado: 'perdida',
        resuelta_en: '2026-08-10T10:00:00Z',
        carpeta: 'Conocimiento/Licitaciones/Ofertas/X/Resolución',
        publicada: false,
      },
      agosto,
    ),
    'Resuelta (perdida) el lun 10 ago: sube el acta a «Licitaciones/Ofertas/X/Resolución»',
  );
  assert.match(
    textoActaQueFalta({ resultado: 'ganada', resuelta_en: '2026-08-10T10:00:00Z', carpeta: null, publicada: true }),
    /la PLACSP ha publicado el acta y se está bajando sola$/,
  );
});
