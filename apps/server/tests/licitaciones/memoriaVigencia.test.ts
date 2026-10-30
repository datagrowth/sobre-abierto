// Versiones de modelo anticuadas. Una versión fechada de más de 12 meses antes del
// inicio previsto se marca, salvo que el pliego la cite. Datos sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estrategiaCasoA } from './fixtures/estrategiaCasoA.js';

const { mesesAntes, versionesAnticuadas, versionesFechadas } =
  await import('../../src/dominios/licitaciones/oferta/vigenciaModelos.js');
const { EstrategiaDatos, MODELOS_VIGENTES, problemasDeVigencia } =
  await import('../../src/dominios/licitaciones/oferta/estrategia.js');

function estrategia() {
  const { id: _id, memoria_id: _m, version: _v, ...datos } = estrategiaCasoA({ memoria_id: 1, version: 1 });
  return EstrategiaDatos.parse(datos);
}

test('should_read_dated_versions_in_dash_compact_and_month_forms', () => {
  assert.deepEqual(
    versionesFechadas('Modelo A (versión 2025-04-14); modelo-b-20240806; modelo C 2024-08.').map((v) => v.fecha),
    ['2025-04-14', '2024-08-06', '2024-08-01'],
  );
  assert.equal(mesesAntes('2026-11-16', 12), '2025-11-16');
});

test('should_flag_versions_older_than_twelve_months_before_start_unless_cited', () => {
  assert.deepEqual(
    versionesAnticuadas('Modelo A, versión 2025-04-14', '2026-11-16').map((v) => v.texto),
    ['2025-04-14'],
  );
  assert.deepEqual(versionesAnticuadas('Modelo A, versión 2026-03-01', '2026-11-16'), [], 'dentro de los 12 meses');
  assert.deepEqual(
    versionesAnticuadas(
      'Modelo A, versión 2025-04-14',
      '2026-11-16',
      'El pliego exige el modelo A versión 2025-04-14.',
    ),
    [],
    'el pliego la cita',
  );
});

test('should_report_outdated_model_in_strategy_with_substitution_criterion', () => {
  const e = estrategia();
  e.solucion.modelos = [
    { uso: 'Generación de borradores', modelo: 'Modelo A (2024-05-13)', alternativa: 'Modelo A mini (2024-07-18)' },
  ];
  e.hechos.push({
    clave: 'modelo',
    categoria: 'herramienta',
    sobre: 'modelo de lenguaje',
    valor: 'Modelo A (2024-05-13)',
    palabras: ['modelo'],
  });
  const inicio = e.solucion.calendario.inicio;
  const p = problemasDeVigencia(e, { inicio, fuentes: '' });
  assert.equal(p.length, 3, p.join('\n'));
  assert.ok(
    p[0]!.startsWith(
      `Versión anticuada (modelo «Generación de borradores»): «Modelo A (2024-05-13) | Modelo A mini (2024-07-18)» fija una versión del 2024-05-13, más de 12 meses antes del inicio previsto (${inicio}).`,
    ),
    p[0],
  );
  assert.ok(p[0]!.endsWith(MODELOS_VIGENTES));
  assert.match(p[2]!, /^Versión anticuada \(hecho «modelo»\)/);
  e.solucion.modelos = [
    {
      uso: 'Generación de borradores',
      modelo: 'Familia A, nivel alto: la versión estable vigente al inicio',
      alternativa: 'Familia A, nivel ligero',
    },
  ];
  e.hechos.pop();
  assert.deepEqual(problemasDeVigencia(e, { inicio, fuentes: '' }), []);
});

test('should_ask_for_current_model_families_in_instructions', () => {
  assert.match(
    MODELOS_VIGENTES,
    /no fijes una versión fechada de más de 12 meses antes del inicio previsto salvo que el pliego la cite/,
  );
  assert.match(MODELOS_VIGENTES, /nombra la familia y el nivel con el criterio de sustitución/);
});

test('should_exempt_versions_the_pliego_cites_in_spanish_date_formats', () => {
  for (const pliego of [
    'El modelo A en su versión de 14/04/2025.',
    'El modelo A (versión del 14 de abril de 2025).',
    'Modelo A, versión 14.04.2025.',
  ]) {
    assert.deepEqual(versionesAnticuadas('modelo-a-2025-04-14', '2026-11-16', pliego), [], pliego);
  }
  assert.equal(
    versionesAnticuadas('modelo-a-20250414', '2026-11-16', 'El pliego cita otra fecha: 15/04/2025.').length,
    1,
  );
});

test('should_not_treat_api_or_standard_dates_as_model_versions', () => {
  assert.deepEqual(versionesAnticuadas('Servicio de modelos con api-version 2024-10-21', '2026-12-01'), []);
  assert.deepEqual(versionesAnticuadas('Gestión conforme a ISO/IEC 42001 (2023-12)', '2026-12-01'), []);
  assert.deepEqual(versionesAnticuadas('Real Decreto 311/2022 (2022-05-03)', '2026-12-01'), []);
  assert.equal(
    versionesAnticuadas('Modelo A (2024-05-13) conforme a ISO/IEC 42001', '2026-12-01').length,
    1,
    'la norma detrás no exime al modelo',
  );
  const e = estrategia();
  e.hechos.push({
    clave: 'hito',
    categoria: 'otro',
    sobre: 'aclaración publicada',
    valor: 'Aclaración del 2025-09-25',
    palabras: ['aclaración'],
  });
  assert.deepEqual(
    problemasDeVigencia(e, { inicio: e.solucion.calendario.inicio, fuentes: '' }),
    [],
    'un hito pasado no es una versión',
  );
});
