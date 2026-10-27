// El pliego numera sus criterios («2B1. – Servicio de soporte técnico») y unas veces el guion trae
// el código y otras la web, las decisiones o la propuesta lo dejan fuera. CASO_D
// decía «El criterio «2B1. – …» no está en el guion vigente (v3)» y la hoja contaba 0 de 3.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licitacion } from '../helpers/sinteticas.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'criterio-codigo-'));
const agentes = path.join(tmp, '.agentes');
for (const d of [agentes, path.join(tmp, 'conocimiento'), path.join(tmp, 'salidas')])
  fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = agentes;
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { elegirLotesInteres } = await import('../../src/dominios/licitaciones/oportunidades.js');
const { GuionEntrada, guionVigente, proponerGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { automaticoDe, claveCriterio, conCriteriosDelGuion, criterioDelGuion } =
  await import('../../src/dominios/licitaciones/oferta/guionLotes.js');
const { decisionesDe, guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { hojaDeDatos } = await import('../../src/dominios/licitaciones/oferta/hojaDatos.js');
const { propuestaDecisionesDe } = await import('../../src/dominios/licitaciones/oferta/propuestaDecisiones.js');

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const CON_CODIGO = [
  '2B1. – Servicio de soporte técnico',
  '2B2.- Personalización de materiales',
  '2B3 – Merchandising adicional',
];
const SIN_CODIGO = ['Servicio de soporte técnico', 'Personalización de materiales', 'Merchandising adicional'];
const BASES = {
  clase: 'pcap' as const,
  nombre: 'Bases.pdf',
  url: 'https://contrataciondelestado.es/doc/Bases.pdf',
  hash: null,
};

const guionCon = (criterios: string[]) => ({
  archivos: [
    {
      nombre: 'Archivo electrónico único',
      contenido: 'Anexos y oferta económica.',
      documentos: [{ tipo: 'declaracion', nombre: 'Anexo I', obligatorio: true, produce: 'persona' }],
    },
  ],
  memoria: null,
  automaticos: criterios.map((criterio) => ({
    criterio,
    puntos: 5,
    como_se_acredita: 'Declaración',
    casilla_en: 'Anexo II',
    archivo: 'Archivo electrónico único',
    marcas: ['soporte'],
  })),
  oferta_economica: {
    formula: 'P = 40 × (Om / O)',
    presupuesto_base: 6_063.75,
    impuesto_aparte: 'IGIC',
    umbral_anormalidad: null,
    modelo: 'Anexo VI',
    archivo: 'Archivo electrónico único',
  },
  plazo: { fecha_limite: '2099-10-15T08:00', canal: 'PLACSP' },
  lotes: ['2'],
});

async function oferta(id: string, criteriosDelGuion: string[]): Promise<void> {
  const l = licitacion({
    titulo: 'Formación por lotes',
    publicada: '2026-09-24',
    presupuesto: 30_000,
    lotes: [
      { id: '1', nombre: 'Uno', importe: 1 },
      { id: '2', nombre: 'Dos', importe: 6_063.75 },
    ],
    limite: '2099-10-15T08:00:00',
  });
  guardarLicitacion(db, { ...l, id, atom_id: `atom-${id}`, documentos: [BASES] });
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
  ).run(id, JSON.stringify([{ id: '2', motivo: 'criba' }]), ts, ts);
  assert.equal(elegirLotesInteres(db, id, { lotes: ['2'] }).error, null);
  assert.equal(
    (await proponerGuion(db, GuionEntrada.parse({ ...guionCon(criteriosDelGuion), id }), 'licitaciones')).error,
    null,
  );
}

const decididos = (criterios: string[]) => ({
  lotes: ['2'],
  equipo: [],
  herramientas: [],
  enfoque: 'Formación práctica.',
  precio: { importe: 90, pendiente: false },
  automaticos: criterios.map((criterio) => ({ criterio, nos_acogemos: true })),
});

function guardarDirecto(id: string, criterios: string[]): void {
  const datos = {
    ...decididos(criterios),
    automaticos: criterios.map((criterio) => ({ criterio, lote: null, nos_acogemos: true, tramo: null })),
  };
  db.prepare('INSERT INTO decisiones_oferta (licitacion_id, guion_id, datos, actualizada_en) VALUES (?, ?, ?, ?)').run(
    id,
    guionVigente(db, id)!.id,
    JSON.stringify(datos),
    new Date().toISOString(),
  );
}

test('should_strip_tender_code_prefix_from_criterion_key', () => {
  assert.equal(claveCriterio('2B1. – Servicio de soporte técnico'), claveCriterio('Servicio de soporte técnico'));
  assert.equal(claveCriterio('2B2.- Personalización de materiales'), claveCriterio('personalización de materiales'));
  assert.equal(claveCriterio('2.3 — Plazo'), claveCriterio('Plazo'));
});

test('should_keep_whole_name_when_stripping_leaves_nothing', () => {
  assert.notEqual(claveCriterio('2B1. –'), '');
  assert.notEqual(claveCriterio('2B1. – '), '');
});

test('should_not_strip_numbers_that_are_not_a_code_prefix', () => {
  assert.notEqual(claveCriterio('30 horas de formación'), claveCriterio('horas de formación'));
  assert.match(claveCriterio('30 horas de formación'), /^30 horas/);
});

test('should_not_merge_homonyms_that_keep_different_names_after_the_code', () => {
  assert.notEqual(claveCriterio('2.3 – Plazo de inicio'), claveCriterio('2.4 – Plazo de entrega'));
});

test('should_not_report_criterion_missing_from_outline_when_only_code_differs', async () => {
  await oferta('p-cc-1', CON_CODIGO);
  const r = guardarDecisiones(db, nucleo().db, 'p-cc-1', decididos(SIN_CODIGO));
  assert.equal(r.error, null, r.error?.message);
  assert.doesNotMatch((r.data?.avisos ?? []).join(' '), /no está en el guion vigente/);
  assert.deepEqual(
    r.data!.datos.automaticos.map((a) => a.criterio),
    CON_CODIGO,
    'se guarda con el nombre del guion',
  );
});

test('should_return_outline_name_when_reading_decisions_saved_with_code', async () => {
  await oferta('p-cc-2', SIN_CODIGO);
  guardarDirecto('p-cc-2', CON_CODIGO);
  assert.deepEqual(
    decisionesDe(db, 'p-cc-2')!.datos.automaticos.map((a) => a.criterio),
    SIN_CODIGO,
  );
});

test('should_count_automatic_criteria_points_in_data_sheet_when_saved_with_code', async () => {
  await oferta('p-cc-3', SIN_CODIGO);
  guardarDirecto('p-cc-3', CON_CODIGO);
  const campos = hojaDeDatos(db, nucleo().db, 'p-cc-3').data!.campos.filter((c) => c.grupo === 'Criterios automáticos');
  assert.equal(campos.length, 3);
  assert.ok(
    campos.every((c) => c.valor?.startsWith('Sí, nos acogemos')),
    JSON.stringify(campos.map((c) => c.valor)),
  );
});

test('should_canonicalize_proposal_criteria_to_outline_names', async () => {
  await oferta('p-cc-4', CON_CODIGO);
  const datos = {
    lotes: ['2'],
    equipo: [],
    herramientas: [],
    enfoque: 'x'.repeat(60),
    resumen: 'Propuesta de prueba para el guion.',
    automaticos: SIN_CODIGO.map((criterio) => ({
      criterio,
      lote: null,
      tipo: 'compromiso',
      nos_acogemos: true,
      tramo: null,
      motivo: 'Lo ofrecemos de serie.',
    })),
  };
  db.prepare(
    "INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, avisos, agente, creada_en) VALUES (?, ?, ?, '[]', 'licitaciones', ?)",
  ).run('p-cc-4', guionVigente(db, 'p-cc-4')!.id, JSON.stringify(datos), new Date().toISOString());
  const p = propuestaDecisionesDe(db, 'p-cc-4')!;
  assert.deepEqual(
    p.datos.automaticos.map((a) => a.criterio),
    CON_CODIGO,
  );
  assert.deepEqual(
    p.decisiones.automaticos.map((a) => a.criterio),
    CON_CODIGO,
  );
  assert.deepEqual(
    conCriteriosDelGuion([{ criterio: 'Otro criterio' }], { automaticos: [] }),
    [{ criterio: 'Otro criterio' }],
    'sin casar, igual',
  );
});

test('should_not_merge_two_outline_criteria_with_the_same_name_and_different_codes', () => {
  const tramo = (valor: string) => [{ descripcion: `${valor} cursos`, puntos: 5, valor }];
  const g = {
    automaticos: [
      {
        criterio: '2A1. – Formación',
        puntos: 5,
        tramos: tramo('1'),
        como_se_acredita: 'Declaración',
        casilla_en: 'Anexo II',
        archivo: 'Archivo electrónico único',
        marcas: ['formación'],
      },
      {
        criterio: '2B1. – Formación',
        puntos: 5,
        tramos: tramo('3'),
        como_se_acredita: 'Declaración',
        casilla_en: 'Anexo II',
        archivo: 'Archivo electrónico único',
        marcas: ['formación'],
      },
    ],
  } as unknown as Parameters<typeof conCriteriosDelGuion>[1];

  const renombrados = conCriteriosDelGuion(
    [{ criterio: '2A1.- Formación' }, { criterio: '2B1.- Formación' }, { criterio: 'Formación' }],
    g,
  );

  assert.deepEqual(
    renombrados.map((x) => x.criterio),
    ['2A1. – Formación', '2B1. – Formación', 'Formación'],
    'cada uno con el suyo; sin código no se adivina',
  );
  assert.equal(
    automaticoDe(g, '2B1. – Formación', null)?.tramos?.[0]?.valor,
    '3',
    'los tramos del 2B1, no los del 2A1',
  );
  assert.equal(automaticoDe(g, 'Formación', null), undefined);
  assert.equal(criterioDelGuion(g, 'Formación'), null);
  assert.equal(
    criterioDelGuion({ automaticos: [g.automaticos[1]!] }, 'Formación'),
    '2B1. – Formación',
    'con un solo homónimo basta el nombre',
  );
});
