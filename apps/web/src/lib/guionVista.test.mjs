import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dividirPorLotes, prohibicionesVisibles, textoCambiosGuion } from './guionVista.js';

// La oferta de CASO_B tal como la sirve el servidor (fixture de la): guion de los lotes 1 a 5,
// decisiones solo para el lote 1.
const casoB = JSON.parse(readFileSync(new URL('../../e2e/datos/casoB.json', import.meta.url), 'utf8'))[
  'GET /api/licitaciones/licitaciones/p-91000740/oferta'
].body;

const sinCambios = {
  vacio: true,
  apartados: [],
  memoria: { existe: 'igual', limite: false, formato: false, valorable: false, advertencias: false },
  automaticos: [],
  ofertas: [],
  documentos: [],
  archivos: false,
  plazo: false,
  lotes: false,
};

test('should_fold_rows_of_lots_we_do_not_go_to', () => {
  const { datos } = casoB.guion;

  const { ajenos } = dividirPorLotes(datos, casoB.decisiones.datos.lotes);

  assert.equal(ajenos.total, 8);
  assert.deepEqual(
    ajenos.documentos.map((x) => x.documento.nombre).filter((n) => /LOTE 1\b/.test(n)),
    [],
  );
  assert.ok(
    ajenos.documentos.some(
      (x) => x.documento.nombre === 'ANEXO III BIS LOTE 5. PROPOSICIÓN DE CRITERIOS TÉCNICOS EVALUABLES POR FÓRMULA',
    ),
  );
});

test('should_not_count_folded_rows', () => {
  const { datos } = casoB.guion;
  const total = datos.archivos.reduce((n, a) => n + a.documentos.length, 0);

  const { propios } = dividirPorLotes(datos, ['1']);

  const propiosDocs = propios.archivos.flatMap((a) => a.documentos.map((d) => d.nombre));
  assert.equal(propiosDocs.length, total - 8);
  assert.ok(propiosDocs.includes('ANEXO III LOTE 1. PROPOSICIÓN ECONÓMICA'));
  assert.ok(!propiosDocs.includes('ANEXO III LOTE 2. PROPOSICIÓN ECONÓMICA'));
  assert.equal(propios.automaticos.length, datos.automaticos.length);
});

test('should_fold_v4_rows_by_their_own_lots', () => {
  const datos = {
    lotes: ['2', '4', '6'],
    archivos: [{ nombre: 'Sobre 2', documentos: [{ nombre: 'Anexo VI', lotes: ['6'] }, { nombre: 'DEUC' }] }],
    automaticos: [
      { criterio: 'Tutores', lotes: ['6'] },
      { criterio: 'ISO', lotes: [] },
    ],
    ofertas_economicas: [
      { lotes: ['2'], formula: 'f' },
      { lotes: ['6'], formula: 'f' },
    ],
  };

  const { propios, ajenos } = dividirPorLotes(datos, ['2', '4']);

  assert.equal(ajenos.total, 3);
  assert.deepEqual(
    propios.archivos[0].documentos.map((d) => d.nombre),
    ['DEUC'],
  );
  assert.deepEqual(
    propios.ofertas_economicas.map((o) => o.lotes),
    [['2']],
  );
});

test('should_fold_nothing_without_decided_lots', () => {
  const { datos } = casoB.guion;

  const { propios, ajenos } = dividirPorLotes(datos, []);

  assert.equal(ajenos.total, 0);
  assert.equal(propios, datos);
});

test('should_describe_script_changes_against_previous_version', () => {
  const cambios = {
    ...sinCambios,
    vacio: false,
    documentos: [{ identidad: 'declaracion · Declaración ENS BÁSICA', cambio: 'nuevo' }],
    apartados: [{ n: 2, titulo: 'Metodología', cambio: 'puntos' }],
    plazo: true,
  };

  const texto = textoCambiosGuion(cambios, 4);

  assert.equal(
    texto,
    'v4: añade Declaración ENS BÁSICA · apartado 2 «Metodología»: cambian los puntos · cambia el plazo o el canal',
  );
});

test('should_say_same_as_previous_when_there_are_no_changes', () => {
  assert.equal(textoCambiosGuion(sinCambios, 4), 'Igual que la v3');
});

test('should_say_it_is_unknown_when_the_server_gives_no_changes', () => {
  assert.equal(textoCambiosGuion(undefined, 4), 'No se sabe qué cambió');
  assert.equal(textoCambiosGuion({ ...sinCambios, vacio: false }, 4), 'No se sabe qué cambió');
});

test('should_hide_prohibitions_when_memory_and_criteria_share_a_file', () => {
  const datos = {
    memoria: { archivo: 'Archivo único' },
    archivos: [{ nombre: 'Archivo único', prohibiciones: ['No incluir el precio'] }],
    automaticos: [
      { criterio: 'Actualización diaria', archivo: 'ARCHIVO ÚNICO', marcas: ['actualización con frecuencia diaria'] },
    ],
  };

  assert.deepEqual(prohibicionesVisibles(datos), []);
});

test('should_hide_prohibitions_without_memory', () => {
  assert.deepEqual(prohibicionesVisibles(casoB.guion.datos), []);
});

test('should_show_prohibitions_when_memory_goes_in_its_own_file', () => {
  const datos = {
    memoria: { archivo: 'Sobre 2' },
    archivos: [
      { nombre: 'Sobre 2', prohibiciones: ['Sin datos del sobre 3'] },
      { nombre: 'Sobre 3', prohibiciones: [] },
    ],
    automaticos: [{ criterio: 'Tutores', archivo: 'Sobre 3', marcas: ['tutores adicionales'] }],
  };

  assert.deepEqual(prohibicionesVisibles(datos), [
    { donde: 'Sobre 2', textos: ['Sin datos del sobre 3'] },
    { donde: 'La memoria no puede decir', textos: ['«tutores adicionales»'] },
  ]);
});
