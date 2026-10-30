// Aceptación de los cambios tardíos en un solo sitio, sobre los fixtures sintéticos
// (fixtures/comprobaciones y fixtures/cambios): lo que hizo falta a mano en CASO_D, Villaejemplo y
// CASO_E sale ahora por código. Cada test es un criterio de aceptación; el detalle vive en los tests de
// su módulo (bloqueoProponer, diffPropuesta, matrizEquipo, apartadosAfectados).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aceptacion-cambios-'));
const conocimiento = path.join(tmp, 'conocimiento');
const salidas = path.join(tmp, 'salidas');
for (const d of [conocimiento, salidas, path.join(tmp, '.agentes')]) fs.mkdirSync(d, { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = salidas;
process.env.VAULT_PATH = conocimiento;
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { comprobacionesDe } = await import('../../src/dominios/licitaciones/oferta/comprobaciones.js');
const { decisionesDe } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { BloqueoPropuestaEntrada, proponerBloqueo } =
  await import('../../src/dominios/licitaciones/oferta/bloqueoProponer.js');
const { aplicarPropuesta, diffDeLicitacion } = await import('../../src/dominios/licitaciones/oferta/diffPropuesta.js');
const { matrizDeLicitacion } = await import('../../src/dominios/licitaciones/oferta/matrizEquipo.js');
const { CambioImpacto, dependenciasDeApartado } =
  await import('../../src/dominios/licitaciones/oferta/dependencias.js');
const { apartadosARehacer } = await import('../../src/dominios/licitaciones/oferta/apartadosAfectados.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');
type Agente = import('../../src/nucleo/agentes/registro.js').Agente;
type J = Record<string, any>;

iniciarNucleo();
const db = dbLicitaciones();
const CASO_D = leerFixtureComprobaciones('casoD');
const CASO_C = leerFixtureComprobaciones('casoC');
// Las comprobaciones de cada oferta se leen antes de sembrar la siguiente: personas y perfil son del núcleo, uno para todas.
sembrarFixture(db, nucleo().db, CASO_D);
const BLOQUEO_CASO_D = comprobacionesDe(db, nucleo().db, CASO_D.id).data!.bloqueos.find(
  (b) => b.estado === 'abierto',
)!.clave;
sembrarFixture(db, nucleo().db, CASO_C);
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const fixture = (ruta: string): J =>
  JSON.parse(fs.readFileSync(new URL(`./fixtures/${ruta}`, import.meta.url), 'utf8'));

// ── CASO_D: una propuesta de bloqueo con una cita que el pliego no dice ──

const HERMES: Agente = { nombre: 'hermes', permisos: { licitaciones: 'proponer', colaboradores: 'leer' } };
const FRASE_PLIEGO =
  'El mantenimiento del campus virtual se prestará durante ocho meses a contar desde su puesta en marcha.';

// El texto del pliego, como lo deja la extracción de un PDF (marcas [pág. N]); los PDF reales no viajan al repo.
function pliegoCasoD(): string {
  const ruta = `Licitaciones/Radar/2026/${CASO_D.id}/PCT.md`;
  fs.mkdirSync(path.join(conocimiento, path.dirname(ruta)), { recursive: true });
  fs.writeFileSync(path.join(conocimiento, ruta), `[pág. 1]\nObjeto del contrato.\n\n[pág. 7]\n${FRASE_PLIEGO}\n`);
  db.prepare(
    "INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, actualizado_en) VALUES (?, ?, 'ppt', 'PCT.md', 'descargado', ?, ?)",
  ).run(CASO_D.id, `https://contrataciondelestado.es/e2e/${CASO_D.id}/pct`, ruta, CASO_D.ahora);
  return 'PCT.md';
}

test('should_reject_an_invented_quote', async () => {
  // Arrange
  const documento = pliegoCasoD();
  const inventada = 'El mantenimiento podrá empezar el 28 de diciembre de 2027 sin penalización alguna';
  const e = BloqueoPropuestaEntrada.parse({
    id: CASO_D.id,
    clave: BLOQUEO_CASO_D,
    tipo: 'consulta_organo',
    resumen: 'Preguntar al órgano desde cuándo cuentan los ocho meses de mantenimiento.',
    citas: [{ documento, pagina: 7, texto: inventada }],
    datos: {
      tipo: 'consulta_organo',
      texto: '¿Los ocho meses de mantenimiento cuentan desde la puesta en marcha o desde el 28 de diciembre?',
    },
  });

  // Act
  const r = await proponerBloqueo(db, { salidas, conocimiento }, e, HERMES);

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
  assert.equal(
    r.error?.message,
    `La cita «${inventada.slice(0, 40)}…» no está en «${documento}» (pág. 7): copia la frase literal.`,
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM oferta_bloqueos WHERE licitacion_id = ?').get(CASO_D.id)!['n' as never],
    0,
    'no se guarda nada',
  );
});

// ── CASO_D: lo que propuso Hermes, aplicado en una sola llamada ──

test('should_apply_casoD_diff_in_one_call', () => {
  // Arrange: lo que difiere y no es de acreditación (eso va de uno en uno).
  const antes = decisionesDe(db, CASO_D.id)!;
  const diff = diffDeLicitacion(db, nucleo().db, CASO_D.id);
  assert.equal(diff.error, null, diff.error?.message);
  const distintos = diff.data!.campos.filter((c) => !c.igual && !c.acreditacion).map((c) => c.campo);
  assert.ok(
    distintos.some((c) => c.startsWith('automatico:')),
    'el plazo del mantenimiento es uno de ellos',
  );

  // Act
  const r = aplicarPropuesta(db, nucleo().db, CASO_D.id, { campos: distintos, quien: 'Elisa' });

  // Assert: guardado de una vez, y cada fila aplicada pasa a «Sin cambios».
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.version, decisionesDe(db, CASO_D.id)!.version);
  assert.ok(r.data!.version > antes.version);
  const siguenDistintos = diffDeLicitacion(db, nucleo().db, CASO_D.id)
    .data!.campos.filter((c) => distintos.includes(c.campo) && !c.igual)
    .map((c) => c.campo);
  assert.deepEqual(siguenDistintos, []);
});

// Al guardar, el enfoque pierde las citas del pliego («(PCT.pdf, págs. 16-17)»,
// sinCitasInternas): el diff lo compara sin ellas y la fila aplicada pasa a «Sin cambios».
test('should_fold_the_applied_casoD_approach_into_unchanged', () => {
  // Arrange: el enfoque ya se aplicó en el test anterior.
  // Act
  const enfoque = diffDeLicitacion(db, nucleo().db, CASO_D.id).data!.campos.find((c) => c.campo === 'enfoque');

  // Assert
  assert.equal(enfoque?.igual, true);
});

// ── Villaejemplo: nadie del equipo tiene la docencia en topografía ──

test('should_mark_casoC_surveying_cross', async () => {
  // Arrange
  const nombres = new Set(CASO_C.personas.map((p) => String(p['nombre'])));

  // Act
  const r = await matrizDeLicitacion(db, nucleo().db, CASO_C.id, { cv: false });

  // Assert
  assert.equal(r.error, null, r.error?.message);
  const tutor = r.data!.filas.find((f) => /^Tutor/.test(f.rol));
  assert.ok(tutor?.asignados.length, 'la fila del tutor lleva a quien está asignado');
  for (const a of tutor!.asignados) {
    const topografía = a.celdas.find((c) => /topografía/.test(c.materia));
    assert.equal(topografía?.estado, 'no', `${a.nombre}: ✗ en topografía`);
    assert.ok(nombres.has(a.nombre), 'la celda nombra a una persona de Colaboradores (el enlace va a su ficha)');
  }
});

// ── CASO_E: quitar el lote 6 o cambiar a una persona rehace solo lo que la nombra ──

const CASO_E_MEMORIA = fixture('cambios/casoE-memoria.json');
const CASO_E = fixture('comprobaciones/casoE.json');
const AMBITO_CASO_E = ['2', '4', '6'];
// Como en dependenciasApartado.test.ts: el alias de una letra se alarga para reconocerlo como nombre.
const LARGO: Record<string, string> = {
  A: 'Alfa',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
};
const alias = (t: string) => t.replace(/\bPersona ([A-K])\b/g, (_, l: string) => `Persona ${LARGO[l]}`);
const NOMBRES_CASO_E = new Map<number, string>(CASO_E.personas.map((p: J) => [p.persona_id, alias(p.nombre)]));

function estadoCasoE() {
  const equipo = CASO_E.decisiones.datos.equipo.map((m: J) => ({
    persona_id: m.persona_id,
    nombre: NOMBRES_CASO_E.get(m.persona_id) ?? '',
    rol: m.rol_en_la_oferta,
  }));
  const ctx = (n: number) => ({
    n,
    guionApartado: `casoE-${n}`,
    lotesAmbito: AMBITO_CASO_E,
    equipo,
    herramientas: CASO_E.decisiones.datos.herramientas as string[],
    automaticosVigilados: [],
  });
  return {
    lotes: AMBITO_CASO_E,
    documentos: [],
    paquete: null,
    memoria_ensamblada: true,
    equipo: [...NOMBRES_CASO_E].map(([persona_id, nombre]) => ({ persona_id, nombre, lotes: [] })),
    apartados: CASO_E_MEMORIA.memorias[0].apartados.map((a: J) => {
      const texto = alias(a.texto);
      return {
        memoria_version: 1,
        n: a.apartado,
        titulo: a.titulo,
        texto,
        dependencias: dependenciasDeApartado(texto, ctx(a.apartado)),
      };
    }),
  };
}

const nombran = (apartados: J[], patron: RegExp) =>
  apartados.filter((a) => patron.test(a.texto)).map((a) => `v1-${a.n}`);

test('should_redo_only_sections_naming_changed_person_or_lot', () => {
  // Arrange
  const estado = estadoCasoE();
  // Persona D (analista) sale en los apartados 2 y 3, no en el 1.
  const saleD = CambioImpacto.parse({ decisiones: { equipo: [{ persona_id: 1004, sale: true }] } });

  // Act
  const sinLote6 = apartadosARehacer(estado, CambioImpacto.parse({ lotes: ['2', '4'] })).map((a) => a.clave);
  const sinPersona = apartadosARehacer(estado, saleD).map((a) => a.clave);

  // Assert: el lote 6 lo nombran el 1 y el 2; el 3 habla del docente «de cada lote» y no depende de él.
  assert.deepEqual(sinLote6, ['v1-1', 'v1-2']);
  const nombre = NOMBRES_CASO_E.get(1004)!;
  assert.deepEqual(sinPersona, nombran(estado.apartados, new RegExp(nombre)));
  assert.deepEqual(sinPersona, ['v1-2', 'v1-3']);
});
