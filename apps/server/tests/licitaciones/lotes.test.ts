// Presentación por lotes con entradas reales recortadas (fixtures/lotes-*.atom): una de
// perfiles «a un solo lote» (p-20040420), otra «a uno o varios lotes» con máximos
// (p-20602952) y una agregada con lotes y sin regla publicada (a-20603673). Mapper,
// migración, prefiltro por lote, criba con lotes de interés, go/no-go, ficha y precios.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lotes-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { PerfilEmpresa } = await import('../../src/nucleo/empresa.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { abrirLicitaciones, guardarLicitacion, licitacionesFile, obtenerLicitacion } =
  await import('../../src/dominios/licitaciones/store.js');
const { procesarPagina } = await import('../../src/dominios/licitaciones/sincronizar.js');
const { FUENTES } = await import('../../src/dominios/licitaciones/placsp/fuentes.js');
const { entradas } = await import('../../src/dominios/licitaciones/placsp/atom.js');
const { mapearEntrada } = await import('../../src/dominios/licitaciones/placsp/mapper.js');
const {
  evaluarConLotes,
  prefiltrar,
  guardarFiltros,
  reprocesarLotes,
  revisarTodosLosLotes,
  descartarPorImporte,
  FILTROS_INICIALES,
} = await import('../../src/dominios/licitaciones/prefiltro.js');
const { crearLotes, aplicarCriba, candidatasDelLote } = await import('../../src/dominios/licitaciones/criba.js');
const { detalle, EleccionLotes, elegirLotesInteres, listarOportunidades, Filtro } =
  await import('../../src/dominios/licitaciones/oportunidades.js');
const { guionDeOtrosLotes, GuionBase } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { bloqueos, evaluarFila, semaforo } = await import('../../src/dominios/licitaciones/gonogo.js');
const { proponerFicha, fichasDe } = await import('../../src/dominios/licitaciones/ficha.js');
const { OpcionesPrecios, preciosDeLicitacion, comparablesDeLicitacion } =
  await import('../../src/dominios/licitaciones/precios/index.js');
const { equipoDeLicitacion } = await import('../../src/dominios/licitaciones/equipo.js');
const { etiquetaLote, lotesDeFila } = await import('../../src/dominios/licitaciones/lotes.js');

type FiltrosData = typeof FILTROS_INICIALES;

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const leer = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');
const AHORA = Date.parse('2026-10-02T12:00:00Z');
const HOY = new Date('2026-10-02T12:00:00Z');
const UN_LOTE = 'p-20040420';
const VARIOS = 'p-20602952';
const AGREGADA = 'a-20603673';

iniciarNucleo();
const db = dbLicitaciones();
procesarPagina(db, FUENTES.perfiles, leer('lotes-perfiles.atom'));
procesarPagina(db, FUENTES.agregadas, leer('lotes-agregadas.atom'));

after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const fila = (id: string) => obtenerLicitacion(db, id)!;
// Otra licitación con los datos de una entrada real (perfiles: 0 «a un solo lote», 1 «a uno o varios»).
function copiaDe(indice: number, id: string, fuente: 'perfiles' | 'agregadas' = 'perfiles'): string {
  const fixture = fuente === 'perfiles' ? 'lotes-perfiles.atom' : 'lotes-agregadas.atom';
  const datos = mapearEntrada(fuente, entradas(leer(fixture))[indice]!).data!;
  guardarLicitacion(db, { ...datos, id, atom_id: `atom-${id}` });
  return id;
}
function nuevaOportunidad(
  id: string,
  estado: string,
  cambios: { lotes_interes?: string; lotes_prefiltro?: string } = {},
): void {
  const ts = new Date().toISOString();
  db.prepare(
    `INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, lotes_prefiltro, creada_en, actualizada_en)
    VALUES (?, ?, 'motivo anterior', ?, ?, ?, ?)`,
  ).run(id, estado, cambios.lotes_interes ?? null, cambios.lotes_prefiltro ?? null, ts, ts);
}
const filtros = (c: Partial<FiltrosData>): FiltrosData => ({
  ...FILTROS_INICIALES,
  cpv_prefijos: [],
  palabras: [],
  tipos_contrato: ['2'],
  ...c,
});

test('should_map_the_lot_presentation_rule_and_maximums_from_the_tendering_process', () => {
  const [unLote, varios] = entradas(leer('lotes-perfiles.atom')).map((e) => mapearEntrada('perfiles', e).data!);
  const agregada = mapearEntrada('agregadas', entradas(leer('lotes-agregadas.atom'))[0]!).data!;

  assert.deepEqual(unLote?.presentacion, {
    codigo: '1',
    maximo_lotes: null,
    maximo_adjudicables: null,
    combinacion: null,
  });
  assert.deepEqual(
    unLote?.lotes.map((l) => [l.id, l.presupuesto_sin_iva]),
    [
      ['1', 368_000],
      ['2', 9000],
    ],
  );
  assert.equal(varios?.presentacion.codigo, '3');
  assert.equal(varios?.presentacion.maximo_lotes, 2);
  assert.equal(varios?.presentacion.maximo_adjudicables, 2);
  assert.match(varios?.presentacion.combinacion ?? '', /pliego de cláusulas administrativas/);
  assert.deepEqual(
    varios?.lotes.map((l) => [l.id, l.presupuesto_sin_iva, l.cpvs]),
    [
      ['1', 215_073.76, ['85121270']],
      ['2', 103_624.32, ['85320000']],
    ],
  );
  assert.deepEqual(agregada.presentacion, {
    codigo: null,
    maximo_lotes: null,
    maximo_adjudicables: null,
    combinacion: null,
  });
  assert.equal(agregada.lotes.length, 4);
});

// Los nombres de lote de la PLACSP traen su «Lote N» de muchas maneras (las dos primeras, de
// lotes-perfiles.atom; la tercera dejó «Lote 3: Lote 3:» en la portada de Villaejemplo).
test('should_label_a_lot_with_its_number_once_whatever_the_placsp_name_brings', () => {
  const casos: [string, string | null, string][] = [
    ['1', 'Lote 1 Servicios jurídicos en Valencia', 'Lote 1: Servicios jurídicos en Valencia'],
    [
      '1',
      'l1_servicio maquinaria plan infoca. periodo 2027-2030 provincia huelva',
      'Lote 1: servicio maquinaria plan infoca. periodo 2027-2030 provincia huelva',
    ],
    ['3', 'Lote 3: Acciones formativas en teleformación', 'Lote 3: Acciones formativas en teleformación'],
    ['3', 'Lote 3: Lote 3: Acciones formativas', 'Lote 3: Acciones formativas'],
    ['3', 'LOTE Nº 3.- Acciones formativas', 'Lote 3: Acciones formativas'],
    ['3', 'Lote n.º 03 – Acciones formativas', 'Lote 3: Acciones formativas'],
    ['3', '3. Acciones formativas', 'Lote 3: Acciones formativas'],
    [
      '2',
      'Análisis de datos con hojas de cálculo y asistente de IA',
      'Lote 2: Análisis de datos con hojas de cálculo y asistente de IA',
    ],
    ['3', '3 cursos de inglés', 'Lote 3: 3 cursos de inglés'],
    ['1', 'Lote 10 Mantenimiento', 'Lote 1: Lote 10 Mantenimiento'],
    ['a', 'la limpieza de oficinas', 'Lote a: la limpieza de oficinas'],
    ['3', 'Lote 3', 'Lote 3'],
    ['3', null, 'Lote 3'],
  ];
  for (const [id, nombre, esperada] of casos) assert.equal(etiquetaLote(id, nombre), esperada, `${id} · ${nombre}`);
});

test('should_keep_an_entry_whose_presentation_code_is_not_in_the_official_list', () => {
  const xml = leer('lotes-perfiles.atom').replace(
    /(<cbc:PartPresentationCode[^>]*>)1(<\/cbc:PartPresentationCode>)/,
    '$1toString$2',
  );
  const r = mapearEntrada('perfiles', entradas(xml)[0]!);
  assert.equal(r.error, null);
  assert.equal(r.data?.presentacion.codigo, null);
});

test('should_store_the_presentation_rule_and_maximums_in_their_own_columns', () => {
  const varios = fila(VARIOS);
  assert.deepEqual([varios.presentacion_lotes, varios.max_lotes_oferta, varios.max_lotes_adjudicacion], ['3', 2, 2]);
  assert.deepEqual([fila(UN_LOTE).presentacion_lotes, fila(UN_LOTE).max_lotes_oferta], ['1', null]);
  assert.equal(fila(AGREGADA).presentacion_lotes, null);
  assert.equal((JSON.parse(varios.datos) as { presentacion: { codigo: string } }).presentacion.codigo, '3');
});

test('should_add_the_lot_columns_to_an_older_database_idempotently', () => {
  const dir = path.join(tmp, 'antigua');
  fs.mkdirSync(dir);
  const vieja = new Database(licitacionesFile(dir));
  vieja.exec(`CREATE TABLE licitaciones (id TEXT PRIMARY KEY, atom_id TEXT NOT NULL UNIQUE, fuente TEXT NOT NULL, expediente TEXT NOT NULL,
    titulo TEXT NOT NULL, url TEXT, estado TEXT NOT NULL, actualizada_en TEXT NOT NULL, organo_nombre TEXT NOT NULL, organo_nif TEXT,
    tipo_contrato TEXT, procedimiento TEXT, presupuesto_sin_iva REAL, valor_estimado REAL, cpvs TEXT NOT NULL, nuts TEXT, lugar TEXT,
    fecha_limite TEXT, datos TEXT NOT NULL, borrada_en TEXT, borrada_motivo TEXT, vista_en TEXT NOT NULL);
  INSERT INTO licitaciones (id, atom_id, fuente, expediente, titulo, estado, actualizada_en, organo_nombre, cpvs, datos, vista_en)
    VALUES ('p-1', 'a-1', 'perfiles', 'E', 'T', 'PUB', '2026-09-01', 'Órgano', '', '{"lotes":[{"id":"1"}]}', '2026-09-01');`);
  vieja.close();

  abrirLicitaciones(dir).close();
  const otra = abrirLicitaciones(dir);
  const columnas = (otra.prepare('PRAGMA table_info(licitaciones)').all() as { name: string }[]).map((c) => c.name);
  const deOportunidades = (otra.prepare('PRAGMA table_info(oportunidades)').all() as { name: string }[]).map(
    (c) => c.name,
  );
  const vieja1 = otra.prepare("SELECT presentacion_lotes FROM licitaciones WHERE id = 'p-1'").get();
  otra.close();

  for (const c of ['presentacion_lotes', 'max_lotes_oferta', 'max_lotes_adjudicacion'])
    assert.ok(columnas.includes(c), c);
  for (const c of ['lotes_prefiltro', 'lotes_interes']) assert.ok(deOportunidades.includes(c), c);
  assert.deepEqual({ ...(vieja1 as object) }, { presentacion_lotes: null });
});

test('should_pass_the_prefilter_when_a_lot_fits_the_amount_range_although_the_total_does_not', () => {
  const e = evaluarConLotes(filtros({ cpv_prefijos: ['8532'], importe_max: 150_000 }), fila(VARIOS), AHORA);
  assert.deepEqual(e, { motivo: 'Lote 2 (103.624 €): CPV 8532…', lotes: ['2'] });
  assert.equal(
    evaluarConLotes(filtros({ cpv_prefijos: ['85121'], importe_max: 150_000 }), fila(VARIOS), AHORA),
    null,
    'el lote 1 encaja por CPV pero no por importe',
  );
  assert.deepEqual(
    evaluarConLotes(filtros({ palabras: ['asistencia social'] }), fila(VARIOS), AHORA)?.lotes,
    ['2'],
    'palabra en el nombre del lote',
  );
});

test('should_look_at_the_total_when_every_lot_must_be_tendered', () => {
  const todos = { ...fila(VARIOS), presentacion_lotes: '2' };
  assert.equal(evaluarConLotes(filtros({ cpv_prefijos: ['8532'], importe_max: 150_000 }), todos, AHORA), null);
  const e = evaluarConLotes(filtros({ cpv_prefijos: ['8532'], importe_max: 400_000 }), todos, AHORA);
  assert.equal(e?.lotes, null);
  assert.match(e?.motivo ?? '', /^CPV 8532… · hay que presentarse a todos los lotes \(total 318\.698 €\)$/);
});

test('should_pick_the_small_lot_of_a_single_lot_tender_without_warning_about_the_rule', () => {
  const abierta = { ...fila(UN_LOTE), estado: 'PUB', fecha_limite: '2026-10-30T10:00:00' };
  const e = evaluarConLotes(filtros({ cpv_prefijos: ['791'], importe_max: 50_000 }), abierta, AHORA);
  assert.deepEqual(e?.lotes, ['2']);
  assert.match(e?.motivo ?? '', /^Lote 2 \(/);
  assert.doesNotMatch(e?.motivo ?? '', /sin confirmar/);
});

test('should_treat_lots_without_a_published_rule_as_separable_but_unconfirmed', () => {
  const e = evaluarConLotes(filtros({ cpv_prefijos: ['7525'], importe_max: 500_000 }), fila(AGREGADA), AHORA);
  assert.deepEqual(
    e?.lotes,
    ['1', '2', '3', '4'],
    'los lotes sin CPV heredan el del contrato; sin importe no se descartan',
  );
  assert.match(e?.motivo ?? '', /^Lote 1 \(importe sin publicar\): CPV 7525… · /);
  assert.match(e?.motivo ?? '', / · total del contrato 2\.658\.072 € · presentación por lotes sin confirmar$/);
});

test('should_not_pass_lots_without_amount_when_even_the_contract_total_is_below_the_minimum', () => {
  assert.equal(
    evaluarConLotes(filtros({ cpv_prefijos: ['7525'], importe_min: 3_000_000 }), fila(AGREGADA), AHORA),
    null,
  );
  assert.deepEqual(
    evaluarConLotes(filtros({ cpv_prefijos: ['7525'], importe_min: 2_000_000 }), fila(AGREGADA), AHORA)?.lotes,
    ['1', '2', '3', '4'],
  );
});

test('should_look_at_the_total_when_no_single_lot_fits_but_every_lot_can_be_tendered', () => {
  const f = filtros({ cpv_prefijos: ['85'], importe_min: 250_000 });
  const e = evaluarConLotes(f, fila(VARIOS), AHORA);
  assert.deepEqual(e, {
    motivo: 'CPV 85… · ningún lote suelto encaja: a todos los lotes (total 318.698 €)',
    lotes: null,
  });
  assert.equal(
    evaluarConLotes(f, { ...fila(VARIOS), presentacion_lotes: '1' }, AHORA),
    null,
    'a un solo lote no se puede ir a todos',
  );
  assert.equal(
    evaluarConLotes(f, { ...fila(VARIOS), max_lotes_oferta: 1 }, AHORA),
    null,
    'el máximo por oferta no llega a todos',
  );
  assert.match(
    evaluarConLotes(f, { ...fila(VARIOS), presentacion_lotes: null }, AHORA)?.motivo ?? '',
    /a todos los lotes \(presentación por lotes sin confirmar\) \(total/,
  );
});

test('should_store_the_lots_that_passed_the_prefilter', () => {
  guardarFiltros(db, filtros({ cpv_prefijos: ['8532', '7525'], importe_max: 150_000 }));
  assert.equal(prefiltrar(db, 'todas', AHORA), 2, 'p-20040420 está adjudicada');
  const filas = db
    .prepare('SELECT licitacion_id AS id, lotes_prefiltro FROM oportunidades ORDER BY licitacion_id')
    .all();
  assert.deepEqual(
    filas.map((f) => ({ ...(f as object) })),
    [
      { id: AGREGADA, lotes_prefiltro: '["1","2","3","4"]' },
      { id: VARIOS, lotes_prefiltro: '["2"]' },
    ],
  );
});

let lote = 0;
const veredicto = (id: string, cambios: Record<string, unknown> = {}) => ({
  id,
  veredicto: 'interesa' as const,
  motivo: 'Encaja con el perfil',
  confianza: 0.8,
  ...cambios,
});

test('should_give_hermes_the_rule_maximums_and_lots_of_each_candidate', () => {
  lote = crearLotes(db, 40)[0] ?? 0;
  const candidatas = candidatasDelLote(db, lote).data?.candidatas as Record<string, unknown>[];
  const varios = candidatas.find((c) => c['id'] === VARIOS)!;
  assert.deepEqual(varios['presentacion'], {
    regla: 'A uno o varios lotes',
    codigo: '3',
    se_eligen_lotes: true,
    maximo_lotes: 2,
    maximo_adjudicables: 2,
    combinacion:
      'Ver informe justificativo del expediente o, en su caso, la cláusula correspondiente en el pliego de cláusulas administrativas',
  });
  assert.deepEqual(varios['lotes'], [
    { id: '2', nombre: 'Asistencia social', importe_sin_iva: 103_624.32, cpvs: ['85320000'], encaja_prefiltro: true },
    {
      id: '1',
      nombre: 'Asistencia psicológica',
      importe_sin_iva: 215_073.76,
      cpvs: ['85121270'],
      encaja_prefiltro: false,
    },
  ]);
  const agregada = candidatas.find((c) => c['id'] === AGREGADA)!;
  assert.equal((agregada['presentacion'] as { codigo: string | null }).codigo, null);
  assert.equal(agregada['lotes_total'], 4);
});

test('should_reject_lots_of_interest_that_do_not_exist_repeat_or_come_with_a_discard', () => {
  const otra = veredicto(AGREGADA);
  const r1 = aplicarCriba(db, {
    lote,
    veredictos: [veredicto(VARIOS, { lotes: [{ id: '9', motivo: 'No existe' }] }), otra],
  });
  assert.match(r1.error?.message ?? '', /p-20602952: no tiene los lotes 9 \(tiene 1, 2\)/);
  const r2 = aplicarCriba(db, {
    lote,
    veredictos: [
      veredicto(VARIOS, {
        lotes: [
          { id: '2', motivo: 'Uno' },
          { id: '2', motivo: 'Dos' },
        ],
      }),
      otra,
    ],
  });
  assert.match(r2.error?.message ?? '', /lotes repetidos: 2/);
  const r3 = aplicarCriba(db, {
    lote,
    veredictos: [veredicto(VARIOS, { veredicto: 'descartar', lotes: [{ id: '2', motivo: 'Uno' }] }), otra],
  });
  assert.match(r3.error?.message ?? '', /un descarte no lleva lotes/);
});

test('should_reject_lots_of_interest_above_the_amount_range_of_the_filters', () => {
  assert.equal(candidatasDelLote(db, lote).data?.rango_importe_lotes, 'hasta 150.000 €');
  const r = aplicarCriba(db, {
    lote,
    veredictos: [veredicto(VARIOS, { lotes: [{ id: '1', motivo: 'Psicología' }] }), veredicto(AGREGADA)],
  });
  assert.match(
    r.error?.message ?? '',
    /p-20602952: los lotes 1 \(215\.074 €\) quedan fuera del rango de importe de los filtros \(hasta 150\.000 €\)/,
  );
});

test('should_store_the_lots_of_interest_with_their_reason_and_show_them_in_list_and_detail', () => {
  const r = aplicarCriba(db, {
    lote,
    veredictos: [
      veredicto(VARIOS, { lotes: [{ id: '2', motivo: 'Asistencia social: nuestro tamaño' }] }),
      veredicto(AGREGADA, {
        veredicto: 'revisar',
        lotes: [
          { id: '1', motivo: 'Huelva' },
          { id: '2', motivo: 'Villaejemplo y Granada' },
        ],
      }),
    ],
  });
  assert.deepEqual(r.data, { interesa: 1, revisar: 1, descartar: 0 });

  const item = listarOportunidades(db, Filtro.parse({})).items.find((i) => i.id === VARIOS)!;
  assert.deepEqual(item.lotes_interes, [
    { id: '2', nombre: 'Asistencia social', importe: 103_624.32, motivo: 'Asistencia social: nuestro tamaño' },
  ]);
  assert.deepEqual(item.lotes_prefiltro, ['2']);
  const d = detalle(db, VARIOS, HOY).data!;
  assert.deepEqual(
    d.lotes.map((l) => [l.id, l.prefiltro, l.interes]),
    [
      ['1', false, false],
      ['2', true, true],
    ],
  );
  assert.equal(d.go_no_go.ambito.descripcion, 'Lote 2');
  assert.equal(d.go_no_go.ambito.importe, 103_624.32);
  assert.equal(d.go_no_go.presentacion?.origen, 'placsp');
});

test('should_enforce_a_single_lot_and_forbid_loose_lots_when_all_must_be_tendered', () => {
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, creada_en, actualizada_en) VALUES (?, 'candidata', 'a mano', ?, ?)",
  ).run(UN_LOTE, ts, ts);
  const otro = crearLotes(db, 40)[0] ?? 0;
  const dos = [
    { id: '1', motivo: 'Valencia' },
    { id: '2', motivo: 'Extremadura' },
  ];
  assert.match(
    aplicarCriba(db, { lote: otro, veredictos: [veredicto(UN_LOTE, { lotes: dos })] }).error?.message ?? '',
    /solo se puede presentar a un lote/,
  );
  db.prepare("UPDATE licitaciones SET presentacion_lotes = '2' WHERE id = ?").run(UN_LOTE);
  assert.match(
    aplicarCriba(db, { lote: otro, veredictos: [veredicto(UN_LOTE, { lotes: [dos[1]!] })] }).error?.message ?? '',
    /hay que presentarse a todos los lotes/,
  );
  db.prepare("UPDATE licitaciones SET presentacion_lotes = '1' WHERE id = ?").run(UN_LOTE);
  assert.equal(aplicarCriba(db, { lote: otro, veredictos: [veredicto(UN_LOTE, { lotes: [dos[1]!] })] }).error, null);
});

function perfil() {
  const anio = HOY.getFullYear();
  return PerfilEmpresa.parse({
    nif: 'B12345678',
    nombre: 'Analítica Ejemplo SL',
    clasificaciones: [],
    volumen_negocio: [
      { anio: anio - 3, importe: 400_000 },
      { anio: anio - 2, importe: 650_000 },
      { anio: anio - 1, importe: 900_000 },
    ],
    certificaciones: [],
    seguro_rc: null,
    plantilla_media: null,
    anios_actividad: 8,
    cpv_experiencia: [],
    mayor_contrato_similar: null,
  });
}

// p-20602952 con un volumen de negocio exigido de 1 M€ solo en el lote 1: no lo cumplimos.
function conVolumenEnLote1(cambios: { presentacion_lotes?: string; lotes_interes?: string | null }) {
  const f = fila(VARIOS);
  const datos = JSON.parse(f.datos) as { requisitos: unknown[] };
  datos.requisitos.push({
    clase: 'financiera',
    codigo: '5',
    descripcion: 'Volumen anual de negocio',
    umbral: 1_000_000,
    lote: '1',
  });
  return { ...f, datos: JSON.stringify(datos), lotes_interes: null, ...cambios };
}

test('should_evaluate_requirements_against_the_lots_of_interest_or_the_total_when_all_are_required', () => {
  const sinElegir = evaluarFila(conVolumenEnLote1({}), perfil(), HOY);
  assert.deepEqual(bloqueos(sinElegir.evals, sinElegir.lotes, sinElegir.todos), [], 'aún se puede ir al lote 2');

  const lote1 = evaluarFila(conVolumenEnLote1({ lotes_interes: '[{"id":"1","motivo":"x"}]' }), perfil(), HOY);
  assert.equal(semaforo(lote1.evals, lote1.lotes, lote1.todos).color, 'rojo');

  const lote2 = evaluarFila(conVolumenEnLote1({ lotes_interes: '[{"id":"2","motivo":"x"}]' }), perfil(), HOY);
  assert.ok(
    lote2.evals.every((e) => e.lote !== '1'),
    'los requisitos de otros lotes no cuentan',
  );
  assert.deepEqual(bloqueos(lote2.evals, lote2.lotes, lote2.todos), []);

  const todos = evaluarFila(
    conVolumenEnLote1({ presentacion_lotes: '2', lotes_interes: '[{"id":"2","motivo":"x"}]' }),
    perfil(),
    HOY,
  );
  assert.equal(todos.ambito.por_lotes, false);
  assert.equal(
    bloqueos(todos.evals, todos.lotes, todos.todos).length,
    1,
    'con todos los lotes obligatorios, cualquier excluyente deja fuera',
  );
});

test('should_measure_against_the_prefilter_lots_and_flag_without_trimming_those_over_the_rule', () => {
  const varios = fila(VARIOS);
  const delPrefiltro = lotesDeFila({ ...varios, lotes_interes: null, lotes_prefiltro: '["2"]' }).ambito;
  assert.deepEqual(
    [delPrefiltro.origen, delPrefiltro.descripcion, delPrefiltro.importe, delPrefiltro.error],
    ['prefiltro', 'Lote 2 (del prefiltro)', 103_624.32, null],
  );

  const dos = JSON.stringify([
    { id: '1', motivo: 'a' },
    { id: '2', motivo: 'b' },
  ]);
  const unLote = lotesDeFila({ ...varios, presentacion_lotes: '1', lotes_interes: dos }).ambito;
  assert.deepEqual(
    unLote.lotes.map((l) => l.id),
    ['1', '2'],
    'no se recorta en silencio: cuál se queda lo decide una persona',
  );
  assert.equal(
    unLote.error,
    'La regla permite un solo lote por oferta y 2 lotes son de interés (1, 2): elige a cuál vamos en el bloque Lotes.',
  );
  assert.equal(unLote.aviso, null);

  const maxFicha = lotesDeFila({
    ...varios,
    presentacion_lotes: null,
    max_lotes_oferta: null,
    regla_ficha: 'uno_o_varios',
    maximo_ficha: 1,
    lotes_interes: null,
    lotes_prefiltro: '["1","2"]',
  });
  assert.equal(maxFicha.presentacion?.maximo_lotes, 1);
  assert.deepEqual(
    maxFicha.ambito.lotes.map((l) => l.id),
    ['1', '2'],
  );
  assert.match(maxFicha.ambito.error ?? '', /2 lotes encajaron en el prefiltro \(1, 2\)/);
});

test('should_leave_the_scope_amount_empty_when_a_chosen_lot_has_no_published_amount', () => {
  const a = lotesDeFila({
    ...fila(AGREGADA),
    lotes_interes: JSON.stringify([
      { id: '1', motivo: 'Huelva' },
      { id: '2', motivo: 'Villaejemplo' },
    ]),
  }).ambito;
  assert.equal(a.importe, null);
  assert.match(a.aviso ?? '', /Los lotes 1, 2 no publican importe: cuenta el del contrato/);
  const conImporte = {
    ...fila(VARIOS),
    lotes_interes: JSON.stringify([
      { id: '1', motivo: 'a' },
      { id: '2', motivo: 'b' },
    ]),
  };
  const datos = JSON.parse(conImporte.datos) as { lotes: { presupuesto_sin_iva: number | null }[] };
  datos.lotes[1]!.presupuesto_sin_iva = null;
  assert.equal(
    lotesDeFila({ ...conImporte, datos: JSON.stringify(datos) }).ambito.importe,
    null,
    'no se suma solo el lote 1',
  );
});

const FICHA = {
  resumen: 'Servicio de maquinaria pesada para el plan Infoca en cuatro lotes provinciales.',
  requisitos: [],
  criterios: [],
  documentacion: [],
  hitos: [],
  garantias: [],
  penalizaciones: [],
  riesgos: [],
  recomendacion: { decision: 'revisar' as const, motivo: 'Hay que confirmar el alcance.' },
};

test('should_refuse_a_presentation_rule_in_the_ficha_of_a_tender_without_lots', async () => {
  const sinLotes = {
    ...mapearEntrada('perfiles', entradas(leer('lotes-perfiles.atom'))[0]!).data!,
    id: 'p-1',
    atom_id: 'atom-sin-lotes',
    lotes: [],
  };
  guardarLicitacion(db, sinLotes);
  const r = await proponerFicha(db, { ...FICHA, id: 'p-1', presentacion_lotes: { regla: 'un_lote' } }, 'hermes');
  assert.equal(r.error?.code, 'invalid_input');
});

test('should_reevaluate_with_the_total_when_the_approved_ficha_requires_every_lot', async () => {
  assert.equal(detalle(db, AGREGADA, HOY).data?.go_no_go.presentacion?.sin_confirmar, true);
  const r = await proponerFicha(
    db,
    { ...FICHA, id: AGREGADA, presentacion_lotes: { regla: 'todos_los_lotes', pagina: 3 } },
    'hermes',
  );
  assert.equal(r.error, null);
  assert.equal(r.data?.descartada, true, 'el total (2,66 M€) queda fuera del máximo de 150.000 €');

  const d = detalle(db, AGREGADA, HOY).data!;
  assert.equal(d.estado, 'descartada');
  assert.match(d.motivo_descarte ?? '', /hay que presentarse a todos los lotes/);
  assert.deepEqual(d.lotes_interes, []);
  assert.deepEqual([d.go_no_go.presentacion?.codigo, d.go_no_go.presentacion?.origen], ['2', 'ficha']);
  assert.equal(d.go_no_go.ambito.por_lotes, false);
});

test('should_ask_to_choose_instead_of_trimming_the_lots_of_interest_when_the_approved_ficha_says_one_lot_only', async () => {
  const id = copiaDe(0, 'a-un-lote', 'agregadas');
  nuevaOportunidad(id, 'nueva', {
    lotes_interes: JSON.stringify([
      { id: '1', motivo: 'Huelva' },
      { id: '2', motivo: 'Villaejemplo' },
    ]),
  });
  assert.equal(
    detalle(db, id, HOY).data?.go_no_go.ambito.lotes.length,
    2,
    'sin regla publicada, la criba pudo elegir dos',
  );
  assert.equal(
    (await proponerFicha(db, { ...FICHA, id, presentacion_lotes: { regla: 'un_lote', pagina: 4 } }, 'hermes')).error,
    null,
  );

  const g = detalle(db, id, HOY).data!.go_no_go;
  assert.deepEqual([g.presentacion?.codigo, g.presentacion?.origen], ['1', 'ficha']);
  assert.deepEqual(
    g.ambito.lotes.map((l) => l.id),
    ['1', '2'],
  );
  assert.match(
    g.ambito.error ?? '',
    /un solo lote por oferta y 2 lotes son de interés \(1, 2\): elige a cuál vamos en el bloque Lotes/,
  );
  assert.deepEqual(
    fichasDe(db, id).aprobada?.datos.ambito_lotes,
    ['1', '2'],
    'la ficha recuerda para qué lotes se hizo',
  );
});

test('should_bring_stored_candidates_and_rejected_open_tenders_up_to_date_with_the_lot_prefilter', () => {
  const antigua = copiaDe(1, 'p-varios-antigua');
  const rechazada = copiaDe(1, 'p-varios-rechazada');
  nuevaOportunidad(antigua, 'candidata');
  assert.equal(reprocesarLotes(db, AHORA), 1);
  const filas = db
    .prepare(
      'SELECT licitacion_id AS id, estado, motivo_prefiltro AS motivo, lotes_prefiltro FROM oportunidades WHERE licitacion_id IN (?, ?) ORDER BY 1',
    )
    .all(antigua, rechazada)
    .map((f) => ({ ...(f as object) }));
  assert.deepEqual(filas, [
    { id: antigua, estado: 'candidata', motivo: 'Lote 2 (103.624 €): CPV 8532…', lotes_prefiltro: '["2"]' },
    { id: rechazada, estado: 'candidata', motivo: 'Lote 2 (103.624 €): CPV 8532…', lotes_prefiltro: '["2"]' },
  ]);
  assert.equal(reprocesarLotes(db, AHORA), 0, 'idempotente');
});

test('should_measure_the_total_when_the_placsp_later_says_every_lot_must_be_tendered', () => {
  const id = copiaDe(1, 'p-varios-todos');
  nuevaOportunidad(id, 'nueva', {
    lotes_prefiltro: '["2"]',
    lotes_interes: JSON.stringify([{ id: '2', motivo: 'tamaño' }]),
  });
  db.prepare("UPDATE licitaciones SET presentacion_lotes = '2' WHERE id = ?").run(id);
  assert.equal(revisarTodosLosLotes(db, [id, VARIOS]), 1, 'el total (318.698 €) supera el máximo de 150.000 €');
  const o = db
    .prepare(
      'SELECT estado, motivo_descarte, lotes_interes, lotes_prefiltro FROM oportunidades WHERE licitacion_id = ?',
    )
    .get(id) as Record<string, unknown>;
  assert.equal(o['estado'], 'descartada');
  assert.match(
    String(o['motivo_descarte']),
    /^La PLACSP publica que hay que presentarse a todos los lotes y el total \(318\.698 €\)/,
  );
  assert.deepEqual([o['lotes_interes'], o['lotes_prefiltro']], [null, null]);
  assert.equal(revisarTodosLosLotes(db, [id]), 0, 'ya medida con el total');
});

test('should_price_the_lot_of_interest_unless_another_lot_is_asked_for', () => {
  const opciones = OpcionesPrecios.parse({});
  const p = preciosDeLicitacion(db, VARIOS, opciones, 20).data!;
  assert.deepEqual(p.lote, { id: '2', nombre: 'Asistencia social', importe: 103_624.32 });
  assert.equal(p.consulta.presupuesto, 103_624.32);
  assert.equal(p.consulta.cpv, '85320000');
  assert.deepEqual(p.lotes_interes, ['2']);
  assert.equal(preciosDeLicitacion(db, VARIOS, { ...opciones, lote: '1' }, 20).data?.consulta.presupuesto, 215_073.76);
  assert.equal(preciosDeLicitacion(db, VARIOS, { ...opciones, lote: '9' }, 20).error?.code, 'invalid_input');
  assert.equal(comparablesDeLicitacion(db, VARIOS, { mismo_organo: false, lote: '9' }, 5).error?.code, 'invalid_input');
});

test('should_look_for_the_team_with_the_cpv_of_the_lot_of_interest', async () => {
  const e = await equipoDeLicitacion(db, nucleo().db, VARIOS, 5);
  assert.deepEqual(e.data?.cpvs, ['85320000']);
  assert.equal(e.data?.ambito, 'Lote 2');
});

test('should_discard_already_triaged_opportunities_whose_amount_is_above_the_filters', () => {
  // Los filtros guardados en este archivo tienen un máximo de 150.000 €; el contrato copiado
  // tiene el lote 1 de 215.074 €, el lote 2 de 103.624 € y 318.698 € en total.
  const caro = copiaDe(1, 'p-imp-lote-caro');
  nuevaOportunidad(caro, 'nueva', { lotes_interes: JSON.stringify([{ id: '1', motivo: 'psicología' }]) });
  const barato = copiaDe(1, 'p-imp-lote-barato');
  nuevaOportunidad(barato, 'nueva', { lotes_interes: JSON.stringify([{ id: '2', motivo: 'social' }]) });
  const total = copiaDe(1, 'p-imp-total');
  nuevaOportunidad(total, 'nueva');
  db.prepare("UPDATE licitaciones SET presentacion_lotes = '2' WHERE id = ?").run(total);
  const sinElegir = copiaDe(1, 'p-imp-sin-elegir');
  nuevaOportunidad(sinElegir, 'nueva');
  const aMano = copiaDe(1, 'p-imp-a-mano');
  nuevaOportunidad(aMano, 'nueva');
  db.prepare('UPDATE oportunidades SET cambiada_a_mano = 1 WHERE licitacion_id = ?').run(aMano);

  descartarPorImporte(db);
  const estado = (id: string) =>
    db.prepare('SELECT estado, motivo_descarte FROM oportunidades WHERE licitacion_id = ?').get(id) as {
      estado: string;
      motivo_descarte: string | null;
    };
  assert.equal(estado(caro).estado, 'descartada');
  assert.match(estado(caro).motivo_descarte ?? '', /^Importe \(215\.074 €\) fuera del rango de Ajustes › Filtros/);
  assert.equal(estado(barato).estado, 'nueva', 'su lote de interés cabe');
  assert.match(estado(total).motivo_descarte ?? '', /^Importe \(318\.698 €\)/, 'a todos los lotes: el total');
  assert.equal(estado(sinElegir).estado, 'nueva', 'sin lotes elegidos y por lotes sueltos, el lote 2 cabe');
  assert.equal(estado(aMano).estado, 'nueva', 'lo cambiado a mano no se toca');
});

test('should_let_a_person_choose_the_lots_we_bid_for_within_the_rule_keeping_the_screening_reasons', () => {
  const id = copiaDe(1, 'p-91000830');
  nuevaOportunidad(id, 'en_preparacion', {
    lotes_interes: JSON.stringify([{ id: '2', motivo: 'Asistencia social: nuestro tamaño' }]),
  });
  const elegir = (lotes: string[]) => elegirLotesInteres(db, id, EleccionLotes.parse({ lotes }));

  assert.deepEqual(elegir(['2', '1', '2']).data?.lotes, ['1', '2'], 'en el orden de la licitación y sin repetir');
  const d = detalle(db, id, HOY).data!;
  assert.deepEqual(
    d.lotes.map((l) => [l.id, l.interes, l.motivo_interes]),
    [
      ['1', true, 'Elegido a mano'],
      ['2', true, 'Asistencia social: nuestro tamaño'],
    ],
  );
  assert.equal(d.go_no_go.ambito.descripcion, 'Lotes 1, 2');

  assert.match(elegir(['3']).error?.message ?? '', /no tiene el lote 3 \(lotes: 1, 2\)/);
  assert.equal(EleccionLotes.safeParse({ lotes: [] }).success, false, 'al menos un lote');
  assert.equal(elegirLotesInteres(db, 'p-00000000', { lotes: ['1'] }).error?.code, 'not_found');
  db.prepare('UPDATE licitaciones SET max_lotes_oferta = 1 WHERE id = ?').run(id);
  assert.match(elegir(['1', '2']).error?.message ?? '', /permite un solo lote por oferta/);
  db.prepare("UPDATE licitaciones SET presentacion_lotes = '2' WHERE id = ?").run(id);
  assert.match(elegir(['1']).error?.message ?? '', /Hay que presentarse a todos los lotes/);
});

test('should_tell_when_the_outline_was_extracted_for_other_lots', () => {
  const id = copiaDe(1, 'p-91000840');
  nuevaOportunidad(id, 'en_preparacion', { lotes_interes: JSON.stringify([{ id: '2', motivo: 'criba' }]) });
  const guion = (lotes?: string[]) =>
    ({ licitacion_id: id, datos: { lotes } }) as Parameters<typeof guionDeOtrosLotes>[1];
  assert.equal(guionDeOtrosLotes(db, guion(['2'])), false);
  assert.equal(elegirLotesInteres(db, id, { lotes: ['1', '2'] }).error, null);
  assert.equal(guionDeOtrosLotes(db, guion(['2'])), true);
  assert.equal(guionDeOtrosLotes(db, guion(['2', '1'])), false, 'el orden no cuenta');
  assert.equal(guionDeOtrosLotes(db, guion()), false, 'un guion sin lotes no se compara');
  assert.equal(guionDeOtrosLotes(db, null), false);
});

// Un guion mínimo pero válido: uno que no valida no se usa y el aviso saldría falso.
const GUION_LOTES = (lotes: string[]) =>
  JSON.stringify({
    archivos: [
      {
        nombre: 'Sobre A',
        contenido: 'Documentación administrativa',
        prohibiciones: [],
        documento: 'Licitaciones/Radar/2026/x/PCAP.pdf',
        documentos: [],
      },
    ],
    memoria: null,
    automaticos: [],
    oferta_economica: null,
    plazo: { fecha_limite: null, canal: 'PLACSP' },
    lotes,
  });
function guardarGuionDeLotes(id: string, lotes: string[]): void {
  assert.ok(GuionBase.safeParse(JSON.parse(GUION_LOTES(lotes))).success);
  db.prepare(
    "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, 'test', 1, 'x')",
  ).run(id, GUION_LOTES(lotes));
}

test('should_report_removed_lots_without_redoing_ficha_or_guion', () => {
  const id = copiaDe(1, 'p-91000850');
  nuevaOportunidad(id, 'en_preparacion', {
    lotes_interes: JSON.stringify([
      { id: '1', motivo: 'a' },
      { id: '2', motivo: 'b' },
    ]),
  });
  guardarGuionDeLotes(id, ['1', '2']);

  const r = elegirLotesInteres(db, id, { lotes: ['2'] });

  assert.deepEqual(r.data, { lotes: ['2'], anadidos: [], quitados: ['1'], rehace: { ficha: false, guion: false } });
});

test('should_report_redo_when_adding_uncovered_lot', () => {
  const id = copiaDe(1, 'p-91000860');
  nuevaOportunidad(id, 'en_preparacion', { lotes_interes: JSON.stringify([{ id: '2', motivo: 'b' }]) });
  guardarGuionDeLotes(id, ['2']);

  const r = elegirLotesInteres(db, id, { lotes: ['1', '2'] });

  assert.deepEqual(r.data?.anadidos, ['1']);
  assert.deepEqual(r.data?.rehace, { ficha: false, guion: true });
});

test('should_not_report_redo_when_the_opportunity_is_not_in_preparation', () => {
  const id = copiaDe(1, 'p-91000870');
  nuevaOportunidad(id, 'nueva', { lotes_interes: JSON.stringify([{ id: '2', motivo: 'b' }]) });
  guardarGuionDeLotes(id, ['2']);

  const r = elegirLotesInteres(db, id, { lotes: ['1', '2'] });

  assert.deepEqual(r.data?.rehace, { ficha: false, guion: false });
  assert.deepEqual(r.data?.anadidos, ['1']);
});
