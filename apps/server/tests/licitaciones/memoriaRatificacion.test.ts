// La muletilla «X propone…; el órgano lo ratifica en el acta». Lo decidido se escribe
// como hecho; la ratificación queda para lo que el pliego reserva al órgano, una por apartado.
// Guiones sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';
import { apartadoCasoA, GUION_CASO_A } from './fixtures/casoA.js';

const { ratificacionesEn } = await import('../../src/dominios/licitaciones/oferta/aplazamientos.js');
const { EstrategiaDatos, problemasDePrudencia, DECISIONES_DE_DISENO } =
  await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { revisarApartado } = await import('../../src/dominios/licitaciones/oferta/memoriaRevision.js');
const { chequeosDelDocumento } = await import('../../src/dominios/licitaciones/oferta/chequeosDocumento.js');

const MEM = GuionBase.parse(GUION_CASO_A).memoria!;
const RATIFICA =
  'La empresa propone la región España central; el órgano lo ratifica en el acta de la semana 2, 27/11/2026.';
const PROPUESTA = 'La propuesta de umbral de calidad se valida en el acta de arranque.';

function estrategia() {
  const { id: _id, memoria_id: _m, version: _v, ...datos } = estrategiaCasoA({ memoria_id: 1, version: 1 });
  return EstrategiaDatos.parse(datos);
}

test('should_detect_ratification_formula_even_with_a_date', () => {
  assert.deepEqual(ratificacionesEn(`${RATIFICA} La solución usa la región España central. ${PROPUESTA}`), [
    RATIFICA,
    PROPUESTA,
  ]);
  assert.deepEqual(
    ratificacionesEn('Cada borrador lo valida el técnico antes de enviarse. El servicio se presta de 9:00 a 18:00 h.'),
    [],
    'la revisión humana del flujo no es ratificación',
  );
});

test('should_exempt_ratification_of_what_the_pliego_reserves_to_the_body', () => {
  const t = 'El tamaño de la muestra de aceptación lo ratifica el órgano en el acta de arranque.';
  assert.equal(ratificacionesEn(t).length, 1);
  assert.deepEqual(ratificacionesEn(t, ['Tamaño de la muestra de aceptación']), []);
});

test('should_flag_ratification_in_strategy_unless_it_is_a_legitimate_pending', () => {
  const e = estrategia();
  e.hechos.push({
    clave: 'region',
    categoria: 'otro',
    sobre: 'región de la nube',
    valor: RATIFICA,
    palabras: ['región'],
  });
  const p = problemasDePrudencia(e, { mem: MEM }).filter((x) => x.startsWith('Deja lo decidido'));
  assert.equal(p.length, 1, p.join('\n'));
  assert.match(
    p[0]!,
    /^Deja lo decidido a una ratificación del órgano \(hecho «region»\): «región de la nube: La empresa propone la región/,
  );
  e.solucion.pendientes_legitimos = [
    {
      parametro: 'región España central',
      cita: 'La región de alojamiento la decide el órgano',
      por_defecto: 'España central',
    },
  ];
  assert.deepEqual(
    problemasDePrudencia(e, { mem: MEM }).filter((x) => x.startsWith('Deja lo decidido')),
    [],
  );
});

test('should_tolerate_one_ratification_per_apartado_and_flag_more', () => {
  const c = {
    automaticos: [],
    apartado: { titulo: MEM.apartados[0]!.titulo, puntos: 8, se_valorara: MEM.apartados[0]!.se_valorara },
    cuota: null,
  };
  const a = apartadoCasoA(1, { memoria_id: 1, guion_id: 1, version: 1 });
  const con = (n: number) => ({
    ...a,
    bloques: a.bloques.slice(0, 1).map((b) => ({
      ...b,
      parrafos: [
        ...b.parrafos,
        ...Array.from(
          { length: n },
          (_, i) =>
            `La empresa propone el diseño ${i + 1} del servicio; el órgano lo ratifica en el acta de la semana ${i + 1}.`,
        ),
      ],
    })),
  });
  const ratificaciones = (x: typeof a) => revisarApartado(x, c).blandos.filter((b) => b.startsWith('RATIFICACIONES'));
  assert.deepEqual(ratificaciones(con(1)), []);
  const r = ratificaciones(con(2));
  assert.equal(r.length, 1);
  assert.match(
    r[0]!,
    /^RATIFICACIONES: el apartado deja 2 decisiones a que el órgano las ratifique \(«La empresa propone el diseño 1/,
  );
});

test('should_report_repeated_ratification_in_assembled_document', () => {
  const md = `# Memoria\n\n## 1. Metodología\n\n${RATIFICA} ${PROPUESTA}\n\n## 2. Calidad\n\n${RATIFICA} Los entregables se validan en la reunión quincenal de seguimiento. El acta de aceptación se aprueba en el comité de seguimiento.\n`;
  const cs = chequeosDelDocumento(md).filter((c) => c.tipo === 'ratificacion');
  assert.deepEqual(
    cs.map((c) => c.apartado),
    [1],
  );
  assert.match(cs[0]!.texto, /^Deja 2 decisiones a una ratificación posterior del órgano/);
});

test('should_ask_to_write_decisions_as_facts_in_design_instruction', () => {
  assert.match(DECISIONES_DE_DISENO, /Lo decidido se escribe como hecho/);
  assert.match(
    DECISIONES_DE_DISENO,
    /solo para lo que el pliego reserva expresamente al órgano \(«pendientes_legitimos»\) y como mucho una vez por apartado/,
  );
  assert.doesNotMatch(DECISIONES_DE_DISENO, /Escríbelo así: «proponemos/);
});

test('should_not_flag_normal_project_governance_or_rules_that_forbid_the_formula', () => {
  for (const t of [
    'Los entregables se validan en la reunión quincenal de seguimiento.',
    'Los cambios de alcance se aprueban en el comité de dirección.',
    'Acta de aceptación: se aprueba en el comité de seguimiento.',
    'Los cambios se ratifican en el comité de seguimiento.',
    'No escribir que el órgano ratificará los parámetros.',
  ])
    assert.deepEqual(ratificacionesEn(t), [], t);
  assert.equal(
    ratificacionesEn('El cliente ratifica el umbral en el acta de arranque.').length,
    1,
    'la ratificación del órgano o del cliente sí cuenta',
  );
});

test('should_not_flag_calendar_gates_or_the_frontier_in_strategy', () => {
  const e = estrategia();
  e.solucion.calendario.semanas = e.solucion.calendario.semanas.map((x) => ({
    ...x,
    puerta: 'Se valida en el comité de seguimiento con su acta',
  }));
  e.frontera.push({
    no_decir: 'Que el órgano ratificará los parámetros de diseño',
    motivo: 'Lo decidido se escribe como hecho.',
  });
  e.reglas.push('No escribir que el órgano ratificará lo decidido: se escribe como hecho.');
  assert.deepEqual(
    problemasDePrudencia(e, { mem: MEM }).filter((x) => x.startsWith('Deja lo decidido')),
    [],
  );
});
