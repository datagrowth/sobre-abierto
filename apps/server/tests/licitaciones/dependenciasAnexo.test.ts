// De qué secciones de las decisiones sale cada anexo automático (oferta/dependenciasAnexo.ts),
// con unas decisiones como las de CASO_E (lotes 2 y 4): personas y precios inventados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Decisiones, type DecisionesData } from '../../src/dominios/licitaciones/oferta/decisiones.js';
import {
  cambiosEntre,
  enumerar,
  huella,
  seccionesDeAnexo,
} from '../../src/dominios/licitaciones/oferta/dependenciasAnexo.js';

const decisiones = (cambio: (d: DecisionesData) => void = () => undefined): DecisionesData => {
  const d = Decisiones.parse({
    lotes: ['2', '4'],
    equipo: [
      { persona_id: 1, rol_en_la_oferta: 'Coordinadora', dedicacion: '20 %', lotes: [] },
      { persona_id: 2, rol_en_la_oferta: 'Formador', lotes: ['2'] },
      { persona_id: 3, rol_en_la_oferta: 'Formadora', lotes: ['4'] },
    ],
    automaticos: [
      { criterio: '2.1 Tiempo de respuesta de la tutoría', lote: null, nos_acogemos: true, tramo: '2 h o menos' },
      { criterio: '2.3 Material homologado', lote: '4', nos_acogemos: false },
    ],
    herramientas: ['Aula virtual'],
    enfoque: 'Formación práctica con casos reales.',
    ofertas: [
      { lote: '2', pendiente: false, importe: 5_000 },
      { lote: '4', pendiente: false, importe: 4_000 },
    ],
  });
  cambio(d);
  return d;
};

test('should_not_depend_on_approach_or_tools', () => {
  const antes = decisiones();
  const ahora = decisiones((d) => {
    d.enfoque = 'Otro enfoque, con tutorías semanales.';
    d.herramientas = ['Teams', 'Aula Abierta'];
  });
  for (const [tipo, lote] of [
    ['oferta_economica', '2'],
    ['declaracion', '4'],
    ['acreditacion', null],
    ['otro', '2'],
  ] as const) {
    const a = seccionesDeAnexo(tipo, lote, antes);
    const b = seccionesDeAnexo(tipo, lote, ahora);
    assert.deepEqual(cambiosEntre(a, b, lote), [], `${tipo} ${lote}`);
    assert.equal(huella(a), huella(b));
  }
  assert.deepEqual(seccionesDeAnexo('deuc', null, antes), {}, 'el DEUC no lleva nada de las decisiones');
});

test('should_tie_economic_annex_to_its_lot_price_only', () => {
  const antes = decisiones();
  const ahora = decisiones((d) => {
    d.ofertas[0]!.importe = 4_800;
  });
  const s4 = seccionesDeAnexo('oferta_economica', '4', antes);
  assert.deepEqual(s4.precio, [antes.ofertas[1]]);
  assert.deepEqual(
    (s4.automaticos as { criterio: string }[]).map((a) => a.criterio),
    ['2.1 Tiempo de respuesta de la tutoría', '2.3 Material homologado'],
    'los comunes y los de su lote',
  );
  assert.equal(s4.equipo, undefined);
  assert.deepEqual(cambiosEntre(s4, seccionesDeAnexo('oferta_economica', '4', ahora), '4'), []);
  assert.deepEqual(
    cambiosEntre(
      seccionesDeAnexo('oferta_economica', '2', antes),
      seccionesDeAnexo('oferta_economica', '2', ahora),
      '2',
    ),
    ['el precio del lote 2'],
  );
  const equipo = decisiones((d) => {
    d.equipo.pop();
  });
  assert.deepEqual(
    cambiosEntre(s4, seccionesDeAnexo('oferta_economica', '4', equipo), '4'),
    [],
    'el equipo no va en la oferta económica',
  );
});

test('should_tie_declarations_to_team_of_their_lot', () => {
  const antes = decisiones();
  const s2 = seccionesDeAnexo('declaracion', '2', antes);
  assert.deepEqual(s2.equipo, [
    { persona_id: 1, rol: 'Coordinadora', dedicacion: '20 %', lotes: [] },
    { persona_id: 2, rol: 'Formador', dedicacion: null, lotes: ['2'] },
  ]);
  assert.deepEqual(s2.lotes, ['2', '4']);
  assert.equal(s2.precio, undefined);
  const otraDel4 = decisiones((d) => {
    d.equipo[2]!.dedicacion = '50 %';
  });
  assert.deepEqual(
    cambiosEntre(s2, seccionesDeAnexo('declaracion', '2', otraDel4), '2'),
    [],
    'una persona del lote 4 no cambia la del 2',
  );
  assert.deepEqual(
    cambiosEntre(seccionesDeAnexo('declaracion', '4', antes), seccionesDeAnexo('declaracion', '4', otraDel4), '4'),
    ['el equipo'],
  );
  const precio = decisiones((d) => {
    d.ofertas[0]!.importe = 4_800;
  });
  assert.deepEqual(
    cambiosEntre(s2, seccionesDeAnexo('declaracion', '2', precio), '2'),
    [],
    'el precio no va en una declaración',
  );
});

test('should_name_what_changed_in_plain_words', () => {
  const antes = decisiones();
  const todo = decisiones((d) => {
    d.ofertas[0]!.importe = 4_800;
    d.ofertas[1]!.importe = 3_900;
    d.equipo[0]!.rol_en_la_oferta = 'Directora';
    d.automaticos[0]!.tramo = '1 h o menos';
    d.lotes = ['2'];
  });
  assert.deepEqual(
    cambiosEntre(seccionesDeAnexo('declaracion', '2', antes), seccionesDeAnexo('declaracion', '2', todo), '2'),
    ['el equipo', 'los criterios automáticos', 'los lotes'],
  );
  assert.deepEqual(
    cambiosEntre(
      seccionesDeAnexo('oferta_economica', null, antes),
      seccionesDeAnexo('oferta_economica', null, todo),
      null,
    ),
    ['el precio de los lotes 2 y 4', 'los criterios automáticos'],
  );
  const solo2 = decisiones((d) => {
    d.ofertas[0]!.importe = 4_800;
  });
  assert.deepEqual(
    cambiosEntre(
      seccionesDeAnexo('oferta_economica', null, antes),
      seccionesDeAnexo('oferta_economica', null, solo2),
      null,
    ),
    ['el precio del lote 2'],
  );
  const sinLotes = { precio: [{ lote: null, importe: 1 }] };
  assert.deepEqual(cambiosEntre(sinLotes, { precio: [{ lote: null, importe: 2 }] }, null), ['el precio']);
  assert.equal(
    enumerar(['el precio del lote 2', 'el equipo', 'los lotes']),
    'el precio del lote 2, el equipo y los lotes',
  );
});

test('should_give_the_same_fingerprint_whatever_the_key_order', () => {
  const a = { precio: [{ lote: '2', importe: 5_000, pendiente: false }] };
  const b = { precio: [{ pendiente: false, importe: 5_000, lote: '2' }] };
  assert.equal(huella(a), huella(b));
  assert.match(huella(a), /^[0-9a-f]{12}$/);
  assert.notEqual(huella(a), huella({ precio: [{ lote: '2', importe: 5_001, pendiente: false }] }));
});

test('should_tie_the_economic_annex_to_the_decided_tax_and_declarations_to_subcontracting', () => {
  // Arrange: el económico se rellenó sin decidir el impuesto (el IVA del guion); luego se decide IGIC 7 %.
  const antes = decisiones();
  const ahora = decisiones((d) => {
    d.datos_anexo = { subcontratacion_servidores: true, orden_lotes: null, impuesto: { tipo: 'IGIC', porcentaje: 7 } };
  });

  // Act
  const eco = cambiosEntre(
    seccionesDeAnexo('oferta_economica', '2', antes),
    seccionesDeAnexo('oferta_economica', '2', ahora),
    '2',
  );
  const decl = cambiosEntre(
    seccionesDeAnexo('declaracion', '2', antes),
    seccionesDeAnexo('declaracion', '2', ahora),
    '2',
  );

  // Assert
  assert.deepEqual(eco, ['el impuesto']);
  assert.deepEqual(decl, ['la subcontratación de servidores']);
  assert.equal(
    seccionesDeAnexo('oferta_economica', '2', antes).datos_anexo,
    undefined,
    'sin decidir no entra: los anexos de antes no se desfasan',
  );
});
