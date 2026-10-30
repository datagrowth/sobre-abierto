// licitaciones_compromisos sobre la memoria v3 de Villaejemplo (fixtures/comprobaciones/casoC.json,
// seudonimizada): lo que la memoria compromete y cuesta, para el agente, en horas y nivel y nunca
// en euros; y los bloqueos de las comprobaciones que ve el agente, sin coste.euros.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-compromisos-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { McpServer } = await import('@modelcontextprotocol/server');
const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { catalogoRegistrado } = await import('../../src/nucleo/mcp/herramienta.js');
const { perfilCostesPorDefecto } = await import('../../src/nucleo/perfilCostes.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { bloqueosParaAgente, supuestoParaAgente, taparPersonas } =
  await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
const { compromisosDeMemoria } = await import('../../src/dominios/licitaciones/oferta/resumenMemoria.js');
const { herramientasOferta } = await import('../../src/dominios/licitaciones/oferta/tools.js');
const { ConsultaCompromisos, compromisosParaAgente, nivelDeCompromiso } =
  await import('../../src/dominios/licitaciones/oferta/toolsCompromisos.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type FixtureComprobaciones = import('../helpers/comprobacionesFixtures.js').FixtureComprobaciones;
type BloqueoConCoste = import('../../src/dominios/licitaciones/oferta/comprobaciones.js').BloqueoConCoste;
type CompromisoCosteMemoria = import('../../src/dominios/licitaciones/oferta/resumenMemoria.js').CompromisoCosteMemoria;

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const AHORA = Date.parse('2027-10-13T20:34:57.000Z');
const casoC = leerFixtureComprobaciones('casoC');
sembrarFixture(db, nucleo().db, casoC);

// Una copia de Villaejemplo con otro id y su memoria cambiada (ids desplazados; personas y perfil ya están).
type MemoriaFixture = FixtureComprobaciones['memorias'][number];
function copia(
  id: string,
  desplazar: number,
  memoria: (m: MemoriaFixture) => MemoriaFixture,
  alcance = false,
): FixtureComprobaciones {
  const f = leerFixtureComprobaciones('casoC');
  const g = (n: number) => n + desplazar;
  const ALCANCE = [
    {
      nombre: 'Topografía y cartografía digital',
      personas_minimas: 100,
      horas: 40,
      grupos: 1,
      semanas: 5,
      documento: 'PPT.pdf',
      pagina: 13,
    },
  ];
  return {
    ...f,
    id,
    perfil: null,
    personas: [],
    ficha: f.ficha && { ...f.ficha, id: g(f.ficha.id) },
    guiones: f.guiones.map((x) => ({
      ...x,
      id: g(x.id),
      ficha_id: x.ficha_id === null ? null : g(x.ficha_id),
      datos: alcance ? { ...x.datos, alcance: ALCANCE } : x.datos,
    })),
    decisiones: f.decisiones && { ...f.decisiones, guion_id: g(f.decisiones.guion_id) },
    propuesta: f.propuesta && { ...f.propuesta, guion_id: g(f.propuesta.guion_id) },
    memorias: [memoria(f.memorias[0]!)].map((m) => ({
      ...m,
      id: g(m.id),
      guion_id: g(m.guion_id),
      borrador_id: m.borrador_id === null ? null : g(m.borrador_id),
    })),
  };
}

const PERSONA = String(casoC.personas[0]!.nombre);
const CON_NOMBRE = 'p-vil-nombre';
sembrarFixture(
  db,
  nucleo().db,
  copia(
    CON_NOMBRE,
    6000,
    (m) => ({
      ...m,
      apartados: m.apartados.map((a, i) => ({
        ...a,
        compromisos: [],
        avisos: [],
        texto:
          i === 0
            ? `${PERSONA} envía a cada alumna un kit con cinta métrica y guantes.`
            : i === 1
              ? `${PERSONA} invita a cada alumna apta a una entrevista individual de 30 minutos.`
              : 'Metodología práctica con guías de estudio.',
      })),
    }),
    true,
  ),
);
const SIN_MONTAR = 'p-vil-sin-montar';
sembrarFixture(
  db,
  nucleo().db,
  copia(SIN_MONTAR, 7000, (m) => ({ ...m, estado: 'redactando', ensamblada_en: null })),
);

const consulta = (q: Record<string, unknown>) => compromisosParaAgente(db, nucleo().db, ConsultaCompromisos.parse(q));
const EUROS = /€|\beur(?:os?)?\b/i;
// El precio por persona del material sin «€» («× (18 + 7) por alumna»): también es un importe.
const PRECIO_SUELTO = /\(\s*\d[\d.,]*\s*\+\s*\d[\d.,]*\s*\)/;

const fila = (x: Partial<CompromisoCosteMemoria>): CompromisoCosteMemoria => ({
  texto: 'Informe semanal',
  cita: null,
  apartados: [],
  clase: 'anadido',
  criterio: null,
  horas: null,
  euros: null,
  supuesto: '',
  barata: '',
  instruccion: '',
  caro: false,
  ficha: null,
  justificado: false,
  ...x,
});

test('should_never_return_euro_amounts_or_euros_word', () => {
  // Arrange: el resumen de la web sí lleva euros para esa misma memoria.
  const web = compromisosDeMemoria(db, nucleo().db, casoC.id, 3, null);
  assert.equal(web.error, null);
  assert.ok(
    web.data!.compromisos.some((x) => (x.euros ?? 0) > 0),
    'la memoria de Villaejemplo tiene compromisos con euros',
  );

  // Act
  const r = consulta({ id: casoC.id });

  // Assert
  assert.equal(r.error, null);
  const json = JSON.stringify(r.data);
  assert.equal(r.data!.version, 3);
  assert.equal(r.data!.compromisos.length, web.data!.compromisos.length);
  assert.equal(r.data!.total_horas, web.data!.total_anadidos.horas);
  assert.doesNotMatch(json, EUROS);
  assert.doesNotMatch(json, PRECIO_SUELTO);
  assert.ok(r.data!.compromisos.every((x) => !('euros' in x) && !('coste_estimado' in x)));
});

test('should_keep_material_cost_in_units_without_price_per_person', () => {
  // Arrange: con el alcance (100 alumnas), el supuesto del kit lleva el precio por alumna sin «€».
  const web = compromisosDeMemoria(db, nucleo().db, CON_NOMBRE, 3, null).data!;
  const kit = web.compromisos.find((x) => x.texto.startsWith('Material físico'));
  assert.match(kit?.supuesto ?? '', PRECIO_SUELTO);

  // Act
  const r = consulta({ id: CON_NOMBRE });

  // Assert
  const paraAgente = r.data!.compromisos.find((x) => x.texto.startsWith('Material físico'));
  assert.match(paraAgente?.supuesto ?? '', /^100 alumnas .*× 1 envío de material por alumna/);
  assert.doesNotMatch(JSON.stringify(r.data), PRECIO_SUELTO);
  assert.doesNotMatch(JSON.stringify(r.data), EUROS);
});

test('should_map_cost_to_level_with_profile_thresholds', () => {
  // Arrange: umbrales por defecto (15 h, 300 €) y otro perfil más exigente (100 h).
  const base = perfilCostesPorDefecto();
  const exigente = { ...base, umbral_horas: 100 };

  // Act
  const niveles = [
    nivelDeCompromiso(fila({ horas: 20, caro: true }), base),
    nivelDeCompromiso(fila({ horas: 9 }), base),
    nivelDeCompromiso(fila({ horas: 3 }), base),
    nivelDeCompromiso(fila({ clase: 'exigido', horas: 20 }), base),
    nivelDeCompromiso(fila({ clase: 'exigido', horas: 20 }), exigente),
    nivelDeCompromiso(fila({ euros: 200 }), base),
    nivelDeCompromiso(fila({}), base),
  ];
  const r = consulta({ id: casoC.id, solo_caros: true });

  // Assert
  assert.deepEqual(niveles, ['alto', 'medio', 'bajo', 'alto', 'bajo', 'medio', null]);
  assert.equal(r.error, null);
  assert.ok(r.data!.compromisos.length > 0);
  assert.ok(
    r.data!.compromisos.every((x) => x.clase === 'anadido' && x.nivel === 'alto'),
    JSON.stringify(r.data!.compromisos),
  );
});

test('should_fail_not_found_for_unknown_offer_and_conflict_for_unassembled_memoria', () => {
  // Arrange: una oferta que no existe, una versión que no existe y una memoria que se está generando.

  // Act
  const [desconocida, sinVersion, sinMontar] = [
    consulta({ id: 'no-existe' }),
    consulta({ id: casoC.id, version: 9 }),
    consulta({ id: SIN_MONTAR }),
  ];

  // Assert
  assert.equal(desconocida.error?.code, 'not_found');
  assert.equal(sinVersion.error?.code, 'not_found');
  assert.equal(sinMontar.error?.code, 'conflicto');
});

test('should_strip_euros_from_comprobaciones_rows_for_agents', () => {
  // Arrange: las comprobaciones de Villaejemplo tiene filas de compromisos caros con coste en euros (solo web).
  const bloqueos: BloqueoConCoste[] = comprobacionesDe(db, nucleo().db, casoC.id, AHORA).data!.bloqueos;
  const conCoste = bloqueos.filter((b) => b.coste);
  assert.ok(conCoste.length > 0, 'filas con coste');
  assert.ok(
    conCoste.some((b) => (b.coste?.euros ?? 0) > 0),
    'la web lleva euros',
  );

  // Act
  const paraAgente = bloqueosParaAgente(bloqueos, null);

  // Assert
  const costes = paraAgente.flatMap((b) => (b.coste ? [b.coste] : []));
  assert.equal(costes.length, conCoste.length);
  assert.ok(costes.every((c) => !('euros' in c)));
  assert.doesNotMatch(JSON.stringify(costes.map((c) => c.supuesto)), EUROS);
  assert.doesNotMatch(JSON.stringify(costes.map((c) => c.supuesto)), PRECIO_SUELTO);
  assert.equal(
    supuestoParaAgente('100 alumnas (alcance) × (18 + 7) por alumna: material y envío (perfil de costes)'),
    '100 alumnas (alcance) × 1 envío de material por alumna (perfil de costes)',
  );
});

test('should_hide_person_names', () => {
  // Arrange: la memoria nombra a una persona del equipo en los dos compromisos.

  // Act
  const r = consulta({ id: CON_NOMBRE });

  // Assert
  assert.equal(r.error, null);
  assert.ok(r.data!.compromisos.length >= 2, JSON.stringify(r.data));
  assert.ok(!JSON.stringify(r.data).includes(PERSONA), JSON.stringify(r.data));
  assert.ok(r.data!.compromisos.some((x) => x.cita?.includes('envía a cada alumna')));
});

// Una memoria que nombra a la persona por su nombre corto y escribe un importe (dada por buena con anular_fugas).
const CORTO = PERSONA.split(' ')[0]!;
const CON_CORTO = 'p-vil-corto';
sembrarFixture(
  db,
  nucleo().db,
  copia(
    CON_CORTO,
    8000,
    (m) => ({
      ...m,
      apartados: m.apartados.map((a, i) => ({
        ...a,
        compromisos: [],
        avisos: [],
        texto:
          i === 0
            ? 'La empresa envía a cada alumna un kit valorado en 25 € con cinta métrica y guantes.'
            : i === 1
              ? `${CORTO} realizará una entrevista individual de 30 minutos con cada alumna apta.`
              : 'Metodología práctica con guías de estudio.',
      })),
    }),
    true,
  ),
);

test('should_hide_short_names_and_amounts_from_cost_rows_for_agents', () => {
  // Arrange
  const bloqueos: BloqueoConCoste[] = comprobacionesDe(db, nucleo().db, CON_CORTO, AHORA).data!.bloqueos;
  const deCoste = bloqueos.filter((b) => b.coste);
  assert.ok(
    deCoste.some((b) => JSON.stringify(b).includes(CORTO)),
    'la web ve la cita entera',
  );
  assert.ok(
    deCoste.some((b) => JSON.stringify(b).includes('25 €')),
    'la web ve el importe de la cita',
  );

  // Act
  const tapados = bloqueosParaAgente(deCoste, taparPersonas(nucleo().db));
  const conPermiso = bloqueosParaAgente(deCoste, null);

  // Assert
  const json = JSON.stringify(tapados);
  assert.ok(!json.includes(CORTO), json);
  assert.doesNotMatch(json, EUROS);
  assert.ok(tapados.every((b) => b.cita === null && (b.coste?.apariciones ?? []).every((a) => a.cita === '')));
  assert.doesNotMatch(JSON.stringify(conPermiso), EUROS, 'con permiso de colaboradores, las citas sin importes');
  assert.ok(JSON.stringify(conPermiso).includes(CORTO), 'con permiso, la cita sigue');
});

test('should_register_real_cost_provider_for_the_critic_when_tools_load', async () => {
  // Arrange: este archivo ya cargó las tools de la oferta (como el arranque del MCP); la memoria dice cuántas alumnas son.
  const { chequeosConCoste, registrarProveedorCoste } =
    await import('../../src/dominios/licitaciones/oferta/compromisosMemoriaCoste.js');
  const { registrarCostesDelCritico } = await import('../../src/dominios/licitaciones/oferta/toolsCompromisos.js');
  const { guardarPerfilCostes } = await import('../../src/nucleo/perfilCostes.js');
  const md = [
    '## 1. Metodología',
    'El curso atiende a 150 alumnas.',
    '## 2. Orientación',
    'La coordinación hace una entrevista individual de 30 minutos con cada alumna.',
  ].join('\n\n');
  const deCoste = () => chequeosConCoste(md).filter((c) => c.tipo === 'coste');
  try {
    // Act
    const alCargar = deCoste();
    assert.equal(
      guardarPerfilCostes(nucleo().db, { ...perfilCostesPorDefecto(), minutos_preparacion_individual: 60 }).error,
      null,
    );
    const conOtroPerfil = deCoste();
    registrarProveedorCoste();
    const sinProveedor = deCoste();
    registrarCostesDelCritico();
    const deNuevo = deCoste();

    // Assert
    assert.equal(alCargar.length, 1, JSON.stringify(alCargar));
    assert.equal(alCargar[0]!.apartado, 2);
    assert.match(
      alCargar[0]!.texto,
      /^Compromete «Entrevista individual de 30 min con cada alumna» \(100 h, coste alto\), que el pliego no exige/,
    );
    assert.match(
      conOtroPerfil[0]!.texto,
      /\(225 h, coste alto\)/,
      'el perfil se lee en cada llamada: 150 × (30 + 60) min',
    );
    assert.deepEqual(sinProveedor, []);
    assert.equal(deNuevo.length, 1);
    assert.doesNotMatch(JSON.stringify([...alCargar, ...conOtroPerfil]), EUROS);
  } finally {
    guardarPerfilCostes(nucleo().db, perfilCostesPorDefecto());
  }
});

test('should_register_licitaciones_compromisos_as_a_licitaciones_read_tool', () => {
  // Arrange
  const server = new McpServer({ name: 'catalogo', version: '1.0.0' });

  // Act
  herramientasOferta(server, { nombre: 'catalogo', permisos: {} });

  // Assert
  assert.deepEqual(
    catalogoRegistrado().find((h) => h.nombre === 'licitaciones_compromisos'),
    { nombre: 'licitaciones_compromisos', dominio: 'licitaciones', accion: 'leer' },
  );
});
