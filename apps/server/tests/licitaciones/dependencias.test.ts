// «Qué cambia» por reglas (oferta/dependencias.ts) sobre el guion de CASO_E capturado en producción
// (fixtures/ofertas/casoE.json, ya seudonimizado). El pliego pide «tantas proposiciones como a
// lotes licite», así que el archivo va por lote. Textos de apartados y equipo inventados, con
// Persona Alfa/Beta/Gamma y sin importes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GuionBaseData } from '../../src/dominios/licitaciones/oferta/guion.js';
import { documentosDelGuion } from '../../src/dominios/licitaciones/oferta/documentos.js';
import { CambioImpacto, impactoDe, type EstadoImpacto } from '../../src/dominios/licitaciones/oferta/dependencias.js';

const casoE = JSON.parse(readFileSync(new URL('./fixtures/ofertas/casoE.json', import.meta.url), 'utf8')) as {
  respuesta_oferta: { guion: { datos: GuionBaseData } };
};
const RELLENADO = '2026-10-14T12:00:00.000Z';

const APARTADOS = [
  {
    n: 1,
    titulo: 'Propuesta formativa',
    texto: 'El lote 2 lo imparte Persona Beta y el lote 6 lo imparte Persona Gamma; Persona Alfa coordina ambos.',
  },
  { n: 2, titulo: 'Plataforma de teleformación', texto: 'La plataforma da servicio al lote 6 con aulas virtuales.' },
  { n: 3, titulo: 'Equipo docente', texto: 'Persona Beta tiene diez años de experiencia en ofimática.' },
];

function estadoCasoE(cambios: Partial<EstadoImpacto> = {}): EstadoImpacto {
  const guion = structuredClone(casoE.respuesta_oferta.guion.datos);
  guion.archivos = guion.archivos.map((a) => ({ ...a, ambito: 'por_lote' }));
  const lotes = ['2', '4', '6'];
  // Los anexos rellenados guardaron su plan: un dato de la hoja se regenera por código.
  const documentos = documentosDelGuion(guion, lotes).map((d) => {
    const rellenado = d.doc.tipo === 'declaracion' || d.doc.tipo === 'oferta_economica';
    return {
      clave: d.clave,
      nombre: d.doc.nombre,
      tipo: d.doc.tipo,
      lote: d.lote,
      estado: 'borrador',
      anexo_en: rellenado ? RELLENADO : null,
      con_plan: rellenado,
    };
  });
  return {
    lotes,
    documentos,
    apartados: APARTADOS.map((a) => ({ memoria_version: 1, ...a })),
    equipo: [
      { persona_id: 1001, nombre: 'Persona Alfa', lotes: [] },
      { persona_id: 1002, nombre: 'Persona Beta', lotes: ['2'] },
      { persona_id: 1003, nombre: 'Persona Gamma', lotes: ['6'] },
    ],
    paquete: { version: 1 },
    memoria_ensamblada: true,
    ...cambios,
  };
}

const cambio = (c: unknown) => CambioImpacto.parse(c);
const de = (r: ReturnType<typeof impactoDe>, pieza: string) => r.afectadas.filter((a) => a.pieza === pieza);

test('should_list_only_the_lot_2_economic_annex_and_the_package_for_a_lot_2_price_change_and_keep_the_memory', () => {
  const estado = estadoCasoE();

  const r = impactoDe(estado, cambio({ decisiones: { precio: { lote: '2' } } }));

  assert.deepEqual(
    r.afectadas.map((a) => [a.pieza, a.nombre, a.accion]),
    [
      ['anexo', 'Anexo VI del lote 2', 'regenerar'],
      ['paquete', 'El paquete', 'regenerar'],
    ],
  );
  assert.deepEqual(r.afectadas[0]!.coste, { min: 0, runs: 0 });
  assert.deepEqual(r.afectadas[1]!.coste, { min: 0, runs: 0 });
  assert.deepEqual(r.afectadas[0]!.por, ['decision.precio[2]']);
  assert.deepEqual(r.se_mantiene, ['la memoria: no puede mencionar el precio']);
  assert.equal(
    r.resumen,
    'Cambia el Anexo VI del lote 2 y el paquete; la memoria se mantiene. Se hace en segundos, sin runs.',
  );
});

test('should_redo_the_economic_annex_with_hermes_when_it_has_no_saved_plan', () => {
  const base = estadoCasoE();
  const estado = { ...base, documentos: base.documentos.map((d) => ({ ...d, con_plan: false })) };

  const r = impactoDe(estado, cambio({ decisiones: { precio: { lote: '2' } } }));

  assert.deepEqual(
    r.afectadas.map((a) => [a.pieza, a.nombre, a.accion]),
    [
      ['anexo', 'Anexo VI del lote 2', 'rehacer'],
      ['paquete', 'El paquete', 'regenerar'],
    ],
  );
  assert.deepEqual(r.afectadas[0]!.coste, { min: 20, runs: 1 });
  assert.equal(r.resumen, 'Cambia el Anexo VI del lote 2 y el paquete; la memoria se mantiene. Unos 20 min, 1 run.');
});

test('should_prune_lot_6_and_redo_only_the_sections_that_name_it', () => {
  const estado = estadoCasoE();

  const r = impactoDe(estado, cambio({ lotes: ['2', '4'] }));

  const [poda] = de(r, 'decisiones');
  assert.equal(poda!.accion, 'podar');
  assert.ok(poda!.pierde.includes('Persona Gamma (solo va en el lote 6)'));
  assert.ok(!poda!.pierde.some((p) => p.includes('Persona Beta')));
  assert.ok(
    de(r, 'documento').length > 0 &&
      de(r, 'documento').every((d) => d.accion === 'ocultar' && d.nombre.endsWith('del lote 6')),
  );
  assert.deepEqual(
    de(r, 'apartado').map((a) => [a.clave, a.accion]),
    [
      ['v1-1', 'rehacer'],
      ['v1-2', 'rehacer'],
    ],
  );
  assert.equal(
    de(r, 'apartado').reduce((s, a) => s + a.coste.min, 0),
    30,
  );
  assert.deepEqual(
    r.afectadas.filter((a) => a.pieza === 'ficha' || a.pieza === 'guion'),
    [],
  );
  assert.deepEqual(r.se_mantiene, [
    'la ficha: sigue valiendo',
    'el guion: sigue valiendo',
    'el resto de la memoria: no nombra lo que cambia',
  ]);
  assert.match(r.resumen, /los apartados 1 y 2/);
  assert.match(r.resumen, /Unos 30 min, 2 runs\./);
});

test('should_redo_the_sections_that_name_the_person_who_leaves', () => {
  const estado = estadoCasoE();

  const r = impactoDe(estado, cambio({ decisiones: { equipo: [{ persona_id: 1002, sale: true }] } }));

  assert.deepEqual(
    de(r, 'apartado').map((a) => [a.clave, a.accion]),
    [
      ['v1-1', 'rehacer'],
      ['v1-3', 'rehacer'],
    ],
  );
  assert.deepEqual(de(r, 'apartado')[0]!.por, ['decision.equipo[1002]: sale']);
  assert.deepEqual(de(r, 'anexo'), []);
  assert.ok(r.se_mantiene.includes('el resto de la memoria: no nombra lo que cambia'));
});

test('should_review_every_section_when_the_person_who_leaves_has_a_one_word_name', () => {
  // Arrange: la persona se llama solo «Beta» (o una inicial): no hay forma fiable de buscarla.
  for (const nombre of ['Beta', 'B.']) {
    const base = estadoCasoE();
    const estado = estadoCasoE({ equipo: base.equipo.map((p) => (p.persona_id === 1002 ? { ...p, nombre } : p)) });

    // Act
    const r = impactoDe(estado, cambio({ decisiones: { equipo: [{ persona_id: 1002, sale: true }] } }));

    // Assert: se revisan todos, ninguno queda como «se mantiene» por no encontrarla.
    assert.deepEqual(
      de(r, 'apartado').map((a) => [a.clave, a.accion]),
      [
        ['v1-1', 'revisar'],
        ['v1-2', 'revisar'],
        ['v1-3', 'revisar'],
      ],
      nombre,
    );
    assert.equal(
      r.se_mantiene.some((m) => m.includes('no nombra lo que cambia')),
      false,
      nombre,
    );
  }
});

test('should_redo_the_assignment_annex_of_the_lots_of_the_person_who_leaves', () => {
  const base = estadoCasoE();
  const documentos = base.documentos.map((d) =>
    d.tipo === 'acreditacion' && /Curr[ií]culum/i.test(d.nombre) ? { ...d, anexo_en: RELLENADO } : d,
  );
  const estado = { ...base, documentos };

  const r = impactoDe(estado, cambio({ decisiones: { equipo: [{ persona_id: 1002, sale: true }] } }));

  assert.equal(de(r, 'anexo').length, 2);
  assert.ok(de(r, 'anexo').every((a) => a.nombre.endsWith('del lote 2') && a.accion === 'rehacer'));
});

test('should_regenerate_the_cover_and_the_filled_annexes_for_a_new_address', () => {
  const estado = estadoCasoE();
  const rellenados = estado.documentos.filter((d) => d.anexo_en !== null).length;

  const r = impactoDe(estado, cambio({ empresa: ['domicilio'] }));

  assert.equal(de(r, 'anexo').length, rellenados);
  assert.ok(
    de(r, 'anexo').every((a) => a.accion === 'regenerar' && a.coste.runs === 0 && a.por[0] === 'empresa.domicilio'),
  );
  assert.deepEqual(
    de(r, 'portada').map((a) => a.accion),
    ['regenerar'],
  );
  assert.deepEqual(
    de(r, 'paquete').map((a) => a.accion),
    ['regenerar'],
  );
  assert.deepEqual(de(r, 'apartado'), []);
  assert.match(r.resumen, /la portada y la firma de la memoria/);
});

test('should_not_regenerate_the_cover_when_the_memory_is_not_assembled', () => {
  const estado = estadoCasoE({ memoria_ensamblada: false });

  const r = impactoDe(estado, cambio({ empresa: ['nif'] }));

  assert.deepEqual(de(r, 'portada'), []);
});

test('should_mark_for_review_when_a_section_text_is_empty_instead_of_keeping_it', () => {
  const estado = estadoCasoE({
    apartados: [
      { memoria_version: 1, n: 1, titulo: 'Propuesta formativa', texto: '   ' },
      { memoria_version: 1, n: 2, titulo: 'Plataforma', texto: null },
    ],
  });

  const r = impactoDe(estado, cambio({ lotes: ['2', '4'] }));

  assert.deepEqual(
    de(r, 'apartado').map((a) => a.accion),
    ['revisar', 'revisar'],
  );
  assert.ok(!r.se_mantiene.some((m) => m.includes('memoria')));
  assert.match(r.resumen, /Hay que revisar los apartados 1 y 2\./);
});

test('should_review_the_memory_when_the_approach_changes', () => {
  const estado = estadoCasoE();

  const r = impactoDe(estado, cambio({ decisiones: { enfoque: true } }));

  assert.deepEqual(
    de(r, 'apartado').map((a) => a.accion),
    ['revisar', 'revisar', 'revisar'],
  );
  assert.deepEqual(de(r, 'paquete'), []);
  assert.equal(
    r.afectadas.reduce((s, a) => s + a.coste.runs, 0),
    0,
  );
});

test('should_redo_ficha_guion_and_proposal_when_a_lot_is_added', () => {
  const estado = estadoCasoE();

  const r = impactoDe(estado, cambio({ lotes: ['2', '4', '6', '1'] }));

  assert.deepEqual(
    r.afectadas.filter((a) => a.pieza !== 'paquete').map((a) => [a.pieza, a.coste.min]),
    [
      ['ficha', 40],
      ['guion', 45],
      ['decisiones', 30],
    ],
  );
  assert.match(r.resumen, /Unos 115 min, 3 runs\./);
});

test('should_redo_the_guion_and_review_the_rest_when_it_is_extracted_again', () => {
  const estado = estadoCasoE();

  const r = impactoDe(estado, cambio({ guion: 'reextraer' }));

  assert.deepEqual(
    de(r, 'guion').map((a) => [a.accion, a.coste.min]),
    [['rehacer', 45]],
  );
  assert.ok([...de(r, 'decisiones'), ...de(r, 'apartado'), ...de(r, 'documento')].every((a) => a.accion === 'revisar'));
  assert.equal(de(r, 'documento').length, estado.documentos.length);
});

test('should_never_include_an_amount_in_the_result', () => {
  const estado = estadoCasoE({
    apartados: [
      {
        memoria_version: 1,
        n: 1,
        titulo: 'Propuesta',
        texto: 'El lote 6 por 98,50 €/alumno y 6.063,75 € de presupuesto.',
      },
    ],
  });
  const conImporte = CambioImpacto.safeParse({ decisiones: { precio: { lote: '2', importe: 98.5 } } });

  const r = [
    impactoDe(estado, cambio({ decisiones: { precio: { lote: '2' } } })),
    impactoDe(estado, cambio({ lotes: ['2', '4'] })),
    impactoDe(estado, cambio({ empresa: ['nombre'] })),
  ];

  assert.equal(conImporte.success, false);
  const texto = JSON.stringify(r);
  assert.doesNotMatch(texto, /€|98[.,]5|6\.?352|importe/i);
});

test('should_reject_a_change_with_more_than_one_kind_or_none', () => {
  const casos = [
    {},
    { lotes: ['2'], guion: 'reextraer' },
    { decisiones: {} },
    { empresa: [] },
    { empresa: ['no_existe'] },
  ];

  const resultados = casos.map((c) => CambioImpacto.safeParse(c).success);

  assert.deepEqual(resultados, [false, false, false, false, false]);
});

test('should_review_and_never_redo_a_whole_uploaded_version_that_names_the_person_who_leaves', () => {
  // Arrange: la v3 se subió entera (subidaFlexible.ts): una sola pieza con todo su texto, sin apartados.
  const estado = estadoCasoE({
    apartados: [
      {
        memoria_version: 3,
        n: 0,
        titulo: 'Memoria entera',
        texto: 'Persona Beta imparte el lote 2 y Persona Alfa coordina.',
        dependencias: null,
        entera: true,
      },
    ],
  });

  // Act
  const sale = impactoDe(estado, cambio({ decisiones: { equipo: [{ persona_id: 1002, sale: true }] } }));
  const otroLote = impactoDe(estado, cambio({ lotes: ['4', '6'] }));

  // Assert
  assert.deepEqual(
    de(sale, 'apartado').map((a) => [a.clave, a.nombre, a.accion]),
    [['v3-0', 'Memoria v3 entera', 'revisar']],
  );
  assert.deepEqual(
    de(otroLote, 'apartado').map((a) => [a.clave, a.accion]),
    [['v3-0', 'revisar']],
    'nombra el lote 2: se revisa a mano',
  );
  assert.ok(
    de(sale, 'apartado').every((a) => a.coste.runs === 0),
    'revisar no gasta Hermes',
  );
});
