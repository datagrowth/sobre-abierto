// Catálogo normativo. Con normativa del cliente en el dossier, la solución lleva sus
// reglas (id, regla, norma y apartado, cita literal del dossier y dónde se aplica), cada cita se
// comprueba contra el dossier y la redacción lo presenta como tabla. Normas sintéticas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';

const { normativaCitable, problemasDeSolucion, Solucion, solucionEnMarkdown } =
  await import('../../src/dominios/licitaciones/oferta/solucion.js');
const { CATALOGO_NORMATIVO, EstrategiaDatos } = await import('../../src/dominios/licitaciones/oferta/estrategia.js');
const { seccionNormativa, SIN_NORMATIVA } = await import('../../src/dominios/licitaciones/oferta/dossierCarpeta.js');

const SIN_FUGAS = { automaticos: [] };
const DOSSIER = [
  '- P-XX-010 (revisión 03): «Procedimiento de consultas.pdf» — Licitaciones/Radar/2026/X/NORMATIVA INTERNA CLIENTE/Procedimiento de consultas.pdf',
  '[P-XX-010 p. 2] 4.2 Registro. Las consultas de las áreas se registran en el gestor de peticiones y se responden en un plazo de 48 horas.',
].join('\n');
const REGLA = {
  id: 'R01',
  regla: 'Toda consulta entra por el gestor de peticiones y lleva su plazo de respuesta.',
  norma: 'P-XX-010, apartado 4.2',
  cita: 'Las consultas de las áreas se registran en el gestor de peticiones',
  donde: 'Bandeja de consultas: alta y semáforo de plazo',
};

function solucion() {
  const { id: _id, memoria_id: _m, version: _v, ...datos } = estrategiaCasoA({ memoria_id: 1, version: 1 });
  return EstrategiaDatos.parse(datos).solucion;
}
const catalogo = (s: ReturnType<typeof solucion>, op: { normativa?: boolean; recortado?: boolean } = {}) => {
  const p = problemasDeSolucion(s, { fugas: SIN_FUGAS, fuentes: DOSSIER, ...op });
  return {
    blandos: p.blandos.filter((b) => /catálogo normativo|catalogo_normativo/.test(b)),
    avisos: p.avisos.filter((a) => /catálogo normativo/.test(a)),
  };
};

test('should_default_catalog_to_empty_and_validate_its_rows', () => {
  const s = solucion();
  const { catalogo_normativo: _c, ...sin } = s;
  assert.deepEqual(Solucion.parse(sin).catalogo_normativo, [], 'lo guardado antes sigue valiendo');
  assert.equal(Solucion.safeParse({ ...s, catalogo_normativo: [REGLA] }).success, true);
  assert.equal(Solucion.safeParse({ ...s, catalogo_normativo: [{ ...REGLA, cita: 'corta' }] }).success, false);
  assert.equal(Solucion.safeParse({ ...s, catalogo_normativo: [{ ...REGLA, extra: 1 }] }).success, false);
});

test('should_require_catalog_when_dossier_has_client_rules', () => {
  const s = solucion();
  assert.deepEqual(catalogo(s).blandos, [], 'sin normativa, vacío permitido');
  assert.match(
    catalogo(s, { normativa: true }).blandos[0] ?? '',
    /^El dossier trae normativa del cliente \(sección «normativa_cliente»\): añade «catalogo_normativo»/,
  );
  s.catalogo_normativo = [REGLA];
  assert.deepEqual(catalogo(s, { normativa: true }).blandos, []);
});

test('should_check_each_rule_quote_and_norm_against_the_dossier', () => {
  const s = solucion();
  s.catalogo_normativo = [
    { ...REGLA, cita: 'Las consultas se contestan en el mismo día laborable' },
    { ...REGLA, id: 'R02', norma: 'P-ZZ-999, apartado 1' },
  ];
  const b = catalogo(s, { normativa: true }).blandos;
  assert.deepEqual(b, [
    'De la regla R02 del catálogo normativo, la norma «P-ZZ-999, apartado 1» no está en el dossier: copia el código y la frase literal de la sección «normativa_cliente», o quita la regla.',
  ]);
  assert.deepEqual(
    catalogo(s, { normativa: true }).avisos,
    [
      'De la regla R01 del catálogo normativo, la cita («Las consultas se contestan en el mismo día laborable») no está en los pasajes del dossier (¿leída con biblioteca_leer?): compruébala contra «P-XX-010, apartado 4.2» antes de entregar.',
    ],
    'una cita que no está puede venir de biblioteca_leer: aviso',
  );
  const recortado = catalogo(s, { normativa: true, recortado: true });
  assert.deepEqual(recortado.blandos, [], 'con el dossier recortado, se avisa');
  assert.equal(recortado.avisos.length, 2);
  s.catalogo_normativo = [REGLA, { ...REGLA }];
  assert.deepEqual(catalogo(s).blandos, [
    'Los identificadores del catálogo normativo se repiten (r01): uno distinto por regla.',
  ]);
});

test('should_put_catalog_table_in_solution_contract', () => {
  const s = solucion();
  s.catalogo_normativo = [REGLA];
  const md = solucionEnMarkdown(s);
  const i = md.indexOf('### Catálogo normativo (va como tabla en el apartado funcional que corresponda)');
  assert.ok(i >= 0);
  assert.equal(md[i + 1], '| Id | Regla | Norma y apartado | Dónde se aplica |');
  assert.equal(md[i + 3], `| R01 | ${REGLA.regla} | ${REGLA.norma} | ${REGLA.donde} |`);
  s.catalogo_normativo = [];
  assert.equal(
    solucionEnMarkdown(s)[
      solucionEnMarkdown(s).indexOf('### Catálogo normativo (va como tabla en el apartado funcional que corresponda)') +
        1
    ],
    '(no aplica)',
  );
});

test('should_mark_dossier_without_client_rules_and_instruct_the_catalog', () => {
  assert.ok(seccionNormativa({ docs: [], idx: null, apartados: [], tope: 1000 }).texto.startsWith(SIN_NORMATIVA));
  assert.match(
    CATALOGO_NORMATIVO,
    /la cita literal del pasaje del dossier que la sostiene \(se comprueba contra él: de un pasaje de esa misma norma, nunca del pliego, y con el apartado que sale en el pasaje\)/,
  );
  assert.match(
    CATALOGO_NORMATIVO,
    /La memoria lo presenta como tabla en el apartado del diseño funcional\. Sin normativa del cliente, vacío\.$/,
  );
});

test('should_require_catalog_only_with_quotable_client_rule_passages', () => {
  const indice =
    '- P-XX-010 (revisión 03): «Procedimiento de compras.pdf» — Licitaciones/X/Procedimiento de compras.pdf';
  assert.equal(
    normativaCitable(
      `${indice}\n\nNingún pasaje casa con los apartados de la memoria: búscalos con biblioteca_buscar en la carpeta de la licitación.`,
    ),
    false,
    'solo el índice',
  );
  assert.equal(
    normativaCitable(
      '- Contrato: «Borrador de contrato.pdf» — X/contrato.pdf\n\n[Contrato p. 4] El adjudicatario guardará confidencialidad sobre los datos.',
    ),
    false,
    'solo el contrato',
  );
  assert.equal(normativaCitable(DOSSIER), true);
  assert.equal(normativaCitable(`${SIN_NORMATIVA} ni contrato en la carpeta de la licitación.`), false);
});

test('should_reject_rules_whose_quote_or_section_is_not_from_that_norm', () => {
  const pliego = 'El adjudicatario conservará la trazabilidad de cada documento generado durante el servicio.';
  const s = solucion();
  s.catalogo_normativo = [
    { ...REGLA, id: 'R03', cita: 'El adjudicatario conservará la trazabilidad de cada documento generado' },
    { ...REGLA, id: 'R04', norma: 'P-XX-010, apartado 9.7' },
  ];
  const p = problemasDeSolucion(s, {
    fugas: SIN_FUGAS,
    fuentes: `${DOSSIER}\n${pliego}`,
    normativa: true,
    normativaTexto: DOSSIER,
  });
  assert.deepEqual(
    p.blandos.filter((b) => /catálogo normativo/.test(b)),
    [
      'De la regla R03 del catálogo normativo, la cita («El adjudicatario conservará la trazabilidad de cada documento generado») está en el dossier pero no en un pasaje de la norma «P-XX-010, apartado 4.2»: atribúyela a la norma de la que sale (lo del pliego no es una regla del cliente) o quita la regla.',
      'De la regla R04 del catálogo normativo, el apartado 9.7 de «P-XX-010, apartado 9.7» no sale en los pasajes de esa norma del dossier: pon el apartado que dice el pasaje o deja solo el código de la norma.',
    ],
  );
  s.catalogo_normativo = [{ ...REGLA, norma: 'P-XX-010' }];
  assert.deepEqual(
    problemasDeSolucion(s, {
      fugas: SIN_FUGAS,
      fuentes: DOSSIER,
      normativa: true,
      normativaTexto: DOSSIER,
    }).blandos.filter((b) => /catálogo normativo/.test(b)),
    [],
    'solo el código vale',
  );
});
