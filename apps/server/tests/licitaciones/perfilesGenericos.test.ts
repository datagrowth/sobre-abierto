// Los fixtures llevan perfiles genéricos (fixtures/perfilesGenericos.mjs): con una plantilla tan
// pequeña, el rol, las titulaciones, las certificaciones, los años y los sectores reidentificaban a
// cada persona aunque el nombre fuera «Persona F». Se queda lo que leen las reglas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nivelTitulacion } from '../../src/nucleo/colaboradores/requisito.js';

type Persona = Record<string, unknown> & { rol?: string; titulaciones?: string[]; certificaciones?: string[] };
type Modulo = {
  personaGenerica: (p: Persona) => Persona;
  personasDe: (v: unknown) => Persona[];
  titulacionGenerica: (t: string) => string;
  certificacionGenerica: (t: string) => string;
  aniosPorTramo: (n: number) => number;
  generalizarLugares: (t: string) => string;
};

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MODULO = path.join(AQUI, 'fixtures', 'perfilesGenericos.mjs');
const g = (await import(`file://${MODULO.replace(/\\/g, '/')}`)) as Modulo;
const json = (dir: string) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => path.join(dir, f))
    : [];
const FIXTURES = [
  ...['comprobaciones', 'cambios', 'ofertas'].flatMap((d) => json(path.join(AQUI, 'fixtures', d))),
  ...json(path.join(AQUI, '..', '..', '..', 'web', 'e2e', 'datos')),
];

test('should_keep_only_generic_profiles_in_the_fixtures', () => {
  // Arrange
  const personas = FIXTURES.flatMap((f) =>
    g.personasDe(JSON.parse(fs.readFileSync(f, 'utf8'))).map((p) => ({ f: path.basename(f), p })),
  );

  // Act
  const concretas = personas.filter(({ p }) => JSON.stringify(g.personaGenerica(p)) !== JSON.stringify(p));

  // Assert
  assert.ok(personas.length >= 20, 'hay personas en los fixtures');
  assert.deepEqual(
    concretas.map(({ f, p }) => `${f}: ${String(p['nombre'])}`),
    [],
    'node tests/licitaciones/fixtures/generalizarFixtures.mjs',
  );
});

test('should_not_leave_identifying_details_of_the_team_in_any_fixture', () => {
  // Arrange: los rasgos que delatan a una persona de una plantilla pequeña (cargo y rol exactos).
  const DELATAN = [/\bCEO\b/, /cofundador/i, /Co-Founder/, /Data Scientist/];

  // Act
  const encontrados = FIXTURES.flatMap((f) => {
    const texto = fs.readFileSync(f, 'utf8');
    return DELATAN.filter((re) => re.test(texto)).map((re) => `${path.basename(f)}: ${re.source}`);
  });

  // Assert
  assert.deepEqual(encontrados, []);
});

test('should_keep_what_the_rules_read_from_a_profile', () => {
  // Act / Assert: el nivel de la titulación, la rama, las certificaciones que reconoce el código y la IA.
  assert.equal(g.titulacionGenerica('Máster en Ingeniería Matemática'), 'Máster en matemáticas');
  assert.equal(
    nivelTitulacion(
      g.titulacionGenerica('Grado en Ingeniería Informática, especialidad en Tecnologías de la Información'),
    )?.nombre,
    'titulación universitaria',
  );
  assert.equal(
    nivelTitulacion(
      g.titulacionGenerica('Máster Universitario en Análisis Avanzado de Datos Multivariantes y Big Data'),
    )?.nombre,
    'máster',
  );
  assert.equal(
    g.certificacionGenerica('AI-900: Microsoft Azure AI Fundamentals'),
    'Certificación Azure de inteligencia artificial (IA)',
  );
  assert.equal(
    g.certificacionGenerica('PRINCE2 Foundation Certificate in Project Management'),
    'Certificación PRINCE2',
  );
  assert.equal(g.certificacionGenerica('Cambridge English: First (FCE)'), 'Certificado de inglés B2');
  assert.deepEqual(
    [7, 10, 4, 2].map(g.aniosPorTramo),
    [5, 10, 3, 2],
    'por tramos: los umbrales de los pliegos dan lo mismo',
  );
});

test('should_take_the_real_company_and_the_places_out_of_free_texts', () => {
  // Arrange
  const texto = 'Impartirá a CASO_E el curso en Lanzarote. CASO_B lo recibe en Santa Cruz de La Palma.';

  // Act
  const limpio = g.generalizarLugares(texto);

  // Assert: la región se queda (la leen los festivos y el IGIC) y una segunda pasada no cambia nada.
  assert.equal(limpio, 'Impartirá al órgano el curso en Canarias. El órgano lo recibe en Villaejemplo (Canarias).');
  assert.equal(g.generalizarLugares(limpio), limpio);
  assert.deepEqual(
    ['Data Growth', 'DATA GROWTH'].map(g.generalizarLugares),
    ['Analítica Ejemplo', 'ANALÍTICA EJEMPLO'],
    'la empresa real pasa a la ficticia',
  );
});

test('should_leave_no_real_company_case_or_place_in_the_synthetic_fixtures', () => {
  // Arrange: los de las comprobaciones, los cambios tardíos y las ofertas de ejemplo (los de Playwright salen de las comprobaciones).
  const sinteticos = FIXTURES.filter((f) => !f.includes(`${path.sep}web${path.sep}`));

  // Act: ya generalizados, generalizarLugares no les cambia nada.
  const encontrados = sinteticos
    .filter((f) => {
      const texto = fs.readFileSync(f, 'utf8');
      return g.generalizarLugares(texto) !== texto;
    })
    .map((f) => path.basename(f));

  // Assert
  assert.ok(sinteticos.length >= 13, 'comprobaciones, cambios y ofertas');
  assert.deepEqual(encontrados, []);
});
