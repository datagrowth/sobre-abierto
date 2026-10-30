// Libro de lecciones sobre el caso A: un párrafo que se usa bien en 3 ofertas se propone a la Biblioteca una sola vez;
// el libro de lecciones para los agentes, con su alcance y dónde se aplicó, y el alcance
// por órgano en licitaciones_lecciones con el valor que pone la plataforma.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { arrancar, cerrar, db, ID, sinMemorias } from '../helpers/memoriaEntorno.js';
import { licitacion } from '../helpers/sinteticas.js';

const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { proponerParrafosRepetidos } = await import('../../src/dominios/licitaciones/oferta/parrafosRepetidos.js');
const { apuntarAplicadas, libroParaAgente, ConsultaLibro } =
  await import('../../src/dominios/licitaciones/oferta/leccionesAplicadas.js');
const { insertarLecciones } = await import('../../src/dominios/licitaciones/oferta/libroLecciones.js');
const { LeccionesEntrada, proponerLecciones } = await import('../../src/dominios/licitaciones/oferta/lecciones.js');

before(arrancar);
after(cerrar);

const PARRAFO =
  'Medimos la asistencia, el progreso y la satisfacción de cada grupo con indicadores que publicamos cada dos semanas en un panel compartido con la entidad, y avisamos a la tutora cuando una persona deja de participar durante una semana.';
const OTRAS = [
  licitacion({ titulo: 'Formación en Python para técnicos', publicada: '2026-05-01' }),
  licitacion({ titulo: 'Formación en análisis de datos', publicada: '2026-06-01' }),
];
for (const l of OTRAS) guardarLicitacion(db, l);
const ORGANO_A = 'Sociedad Insular de Inclusión de Ejemplo, S.L. (SIIE)';

function presentadaCon(id: string, version: number, parrafo: string): number {
  const g = guionVigente(db, ID)!;
  const m = Number(
    db
      .prepare(
        "INSERT INTO memorias (licitacion_id, guion_id, version, estado, pedida_en, presentada, subida) VALUES (?, ?, ?, 'ensamblada', 'x', 1, 'presentada.docx')",
      )
      .run(id, g.id, version).lastInsertRowid,
  );
  db.prepare("INSERT INTO memoria_apartados (memoria_id, apartado, estado, datos) VALUES (?, 1, 'recibido', ?)").run(
    m,
    JSON.stringify({
      titulo: 'Organización y metodología del servicio',
      bloques: [
        {
          parrafos: [
            parrafo,
            'Un párrafo distinto en cada memoria para el resto del apartado, que no se repite en ninguna otra oferta.'.replace(
              'distinto',
              `distinto ${id}`,
            ),
          ],
        },
      ],
      cubre: [],
      compromisos: [],
    }),
  );
  const ts = new Date().toISOString();
  db.prepare(
    "INSERT OR REPLACE INTO propuestas (licitacion_id, presentada_en, resultado, creada_en, actualizada_en) VALUES (?, ?, 'ganada', ?, ?)",
  ).run(id, ts, ts, ts);
  return m;
}

const limpiar = () => {
  sinMemorias();
  db.exec(
    'DELETE FROM propuestas; DELETE FROM parrafos_biblioteca; DELETE FROM lecciones; DELETE FROM lecciones_aplicaciones;',
  );
};

test('should_propose_once_to_the_library_a_paragraph_used_well_in_three_offers', async () => {
  // Arrange
  limpiar();
  [ID, OTRAS[0]!.id, OTRAS[1]!.id].forEach((id, i) =>
    presentadaCon(id, i + 1, i === 2 ? PARRAFO.replace('dos semanas', 'quince días') : PARRAFO),
  );
  const propuestas: { title: string; body: string; folder?: string; origin?: string }[] = [];
  const crear = async (p: { title: string; body: string }) => {
    propuestas.push(p);
    return { path: `_Propuestas/${propuestas.length}.md` };
  };

  // Act
  const n = await proponerParrafosRepetidos(db, null, crear);
  const otraVez = await proponerParrafosRepetidos(db, null, crear);

  // Assert
  assert.deepEqual([n, otraVez], [1, 0], 'casi igual en la tercera también cuenta; y no se repite');
  const [p] = propuestas;
  assert.match(p!.body, /^---\ntipo: metodologia\norigen_tipo: parrafo\nrevisada_en: \d{4}-\d{2}-\d{2}\n---/);
  assert.match(p!.body, /Usado en 3 memorias que funcionaron/);
  assert.deepEqual([p!.folder, p!.origin], ['Metodologías', 'plataforma']);
});

test('should_not_propose_a_paragraph_that_names_a_team_member_or_used_in_fewer_offers', async () => {
  limpiar();
  [ID, OTRAS[0]!.id].forEach((id, i) => presentadaCon(id, i + 1, PARRAFO));
  const crear = async () => ({ path: 'x' });
  assert.equal(await proponerParrafosRepetidos(db, null, crear), 0, 'dos ofertas no bastan');
  presentadaCon(OTRAS[1]!.id, 3, PARRAFO);
  assert.equal(
    await proponerParrafosRepetidos(db, (t) => t.replace('la entidad', 'la persona 4'), crear),
    0,
    'nombra a alguien de Colaboradores',
  );
});

test('should_give_agents_the_lessons_that_apply_to_a_tender_with_where_they_were_used', () => {
  // Arrange
  limpiar();
  const lec = (texto: string, alcance: 'general' | 'organo', alcance_valor: string | null) => {
    insertarLecciones(db, [
      {
        licitacion_id: ID,
        origen: 'mesa',
        alcance,
        alcance_valor,
        tema: 'calidad',
        texto,
        agente: 'licitaciones',
        evidencias: [
          {
            licitacion_id: ID,
            memoria_id: null,
            documento: 'acta.pdf',
            ubicacion: null,
            texto: 'La mesa valoró a Persona D.',
          },
        ],
      },
    ]);
    const id = (db.prepare('SELECT MAX(id) AS id FROM lecciones').get() as { id: number }).id;
    db.prepare("UPDATE lecciones SET estado = 'aceptada', revisada_en = ? WHERE id = ?").run(
      new Date().toISOString(),
      id,
    );
    return id;
  };
  const deCasoA = lec('Cuantifica los indicadores con su meta mensual.', 'organo', ORGANO_A);
  lec('Cita la ordenanza del cabildo.', 'organo', 'Cabildo de Isla Ejemplo');
  const m = presentadaCon(ID, 1, PARRAFO);
  apuntarAplicadas(db, { id: m, version: 1 }, 1, [deCasoA]);

  // Act
  const libro = libroParaAgente(db, ConsultaLibro.parse({ id: ID }), (t) => t.replace('Persona D', 'la persona 4')) as {
    id: number;
    alcance_valor: string;
    evidencias: { texto: string }[];
    aplicaciones: unknown[];
  }[];

  // Assert
  assert.deepEqual(
    libro.map((l) => l.id),
    [deCasoA],
    'solo las de su órgano',
  );
  assert.equal(libro[0]!.evidencias[0]!.texto, 'La mesa valoró a la persona 4.');
  assert.deepEqual(libro[0]!.aplicaciones, [{ licitacion_id: ID, version: 1, apartado: 1, cumplida: null }]);
});

test('should_fill_the_body_of_the_tender_when_hermes_scopes_a_lesson_to_it', () => {
  limpiar();
  const m = presentadaCon(ID, 1, PARRAFO);
  const r = proponerLecciones(
    db,
    LeccionesEntrada.parse({
      id: ID,
      memoria_id: m,
      lecciones: [
        {
          texto: 'Cita la normativa interna del cliente en cada procedimiento.',
          alcance: 'organo',
          apartado: 1,
          evidencia: '+ según su Reglamento',
        },
        {
          texto: 'Pon los plazos de respuesta en horas laborables.',
          alcance: 'cpv',
          tema: null,
          apartado: null,
          evidencia: '+ 24 horas',
        },
      ],
    }),
    'licitaciones',
  );
  assert.deepEqual(r.data, { guardadas: 2 });
  const filas = db.prepare('SELECT alcance, alcance_valor, tema FROM lecciones ORDER BY id').all();
  assert.deepEqual(filas, [
    { alcance: 'organo', alcance_valor: ORGANO_A, tema: 'metodologia' },
    { alcance: 'cpv', alcance_valor: '7911', tema: null },
  ]);
});

// La fuerza sube por el flujo real, sin fabricarla.
test('should_raise_the_strength_when_two_offers_propose_the_same_lesson_and_flag_it_when_not_applied', async () => {
  // Arrange: dos ofertas retocan su memoria y Hermes saca la misma lección de cada una, con otras palabras.
  limpiar();
  const { revisarDelLibro } = await import('../../src/dominios/licitaciones/oferta/libroLecciones.js');
  const { leccionesNoAplicadas } = await import('../../src/dominios/licitaciones/oferta/leccionesAplicadas.js');
  const proponer = (id: string, m: number, texto: string) =>
    proponerLecciones(
      db,
      LeccionesEntrada.parse({
        id,
        memoria_id: m,
        lecciones: [{ texto, alcance: 'general', apartado: 1, evidencia: '+ indicadores con meta' }],
      }),
      'licitaciones',
    );
  const a = presentadaCon(ID, 1, PARRAFO);
  const b = presentadaCon(OTRAS[0]!.id, 2, PARRAFO);

  // Act
  proponer(ID, a, 'Pon un indicador con meta mensual por cada compromiso del servicio.');
  proponer(OTRAS[0]!.id, b, 'Pon por cada compromiso del servicio un indicador con su meta mensual y su fuente.');
  proponer(OTRAS[0]!.id, b, 'Pon por cada compromiso del servicio un indicador con su meta mensual y su fuente.');

  // Assert
  const filas = db.prepare('SELECT id, fuerza, evidencias FROM lecciones').all() as {
    id: number;
    fuerza: number;
    evidencias: string;
  }[];
  assert.deepEqual(
    filas.map((f) => [f.fuerza, JSON.parse(f.evidencias).length]),
    [[2, 2]],
    'una lección con las dos ofertas; reenviar no la cuenta dos veces',
  );
  revisarDelLibro(db, filas[0]!.id, { decision: 'aceptar' });
  const nueva = presentadaCon(
    OTRAS[1]!.id,
    3,
    'Otro texto de una memoria nueva que aún no ha recibido ninguna de las lecciones del libro, con suficiente largo para contar.',
  );
  db.prepare('UPDATE memorias SET presentada = 0 WHERE id = ?').run(nueva);
  assert.deepEqual(
    leccionesNoAplicadas(db, nueva).map((x) => [x.leccion_id, x.motivo]),
    [[filas[0]!.id, 'no_pasada']],
    'la regla de las comprobaciones ya puede salir',
  );
});

// I4 (revisión de la): ninguna lección guarda un nombre de persona, con los Colaboradores
// seudonimizados de la oferta de Villaejemplo y taparPersonas, como en la tool.
test('should_keep_no_team_name_in_the_lesson_book_with_the_real_collaborator_fixtures', async () => {
  // Arrange
  limpiar();
  const fs = await import('node:fs');
  const { nucleo } = await import('../helpers/memoriaEntorno.js');
  const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
  const { taparPersonas } = await import('../../src/dominios/licitaciones/oferta/ofertaAgente.js');
  const { leccionesDeActa } = await import('../../src/dominios/licitaciones/propuestas/leccionesResultado.js');
  const casoC = JSON.parse(
    fs.readFileSync(new URL('./fixtures/comprobaciones/casoC.json', import.meta.url), 'utf8'),
  ) as {
    personas: { nombre: string; tipo: string; rol: string }[];
  };
  for (const p of casoC.personas) crearPersona(nucleo().db, { nombre: p.nombre, tipo: p.tipo, rol: p.rol });
  const nombres = casoC.personas.map((p) => p.nombre);
  const tapar = taparPersonas(nucleo().db);
  const m = presentadaCon(ID, 1, PARRAFO);
  const leccion = (texto: string) => ({
    texto,
    alcance: 'general' as const,
    apartado: 1,
    evidencia: `+ ${nombres[0]} coordina el servicio y ${nombres[1]} lo supervisa`,
  });

  // Act
  const conNombre = proponerLecciones(
    db,
    LeccionesEntrada.parse({
      id: ID,
      memoria_id: m,
      lecciones: [leccion(`Pon a ${nombres[0]} como coordinadora en cada apartado.`)],
    }),
    'licitaciones',
    tapar,
  );
  const sinNombre = proponerLecciones(
    db,
    LeccionesEntrada.parse({
      id: ID,
      memoria_id: m,
      lecciones: [leccion('Nombra a la persona coordinadora y su dedicación en cada apartado.')],
    }),
    'licitaciones',
    tapar,
  );
  leccionesDeActa(
    db,
    {
      id: 900,
      licitacion_id: ID,
      organo: null,
      documento: 'acta.pdf',
      agente: 'licitaciones',
      datos: {
        resultado: 'perdida',
        ganador: null,
        puntos_nuestros: 8,
        puntos_ganador: 10,
        criterios: [
          {
            criterio: 'Equipo y coordinación',
            puntos_max: 10,
            nuestros: 8,
            ganador: 10,
            comentario_mesa: `Valora la experiencia de ${nombres[2]} en formación.`,
            pagina: 3,
          },
        ],
        lecciones: ['Acredita la experiencia docente del equipo con horas y materias.'],
      },
    },
    tapar,
  );

  // Assert
  assert.match(conNombre.error?.message ?? '', /nombra a una persona del equipo/);
  assert.deepEqual(sinNombre.data, { guardadas: 1 });
  const libro = (db.prepare('SELECT texto, evidencias FROM lecciones').all() as { texto: string; evidencias: string }[])
    .map((l) => `${l.texto} ${l.evidencias}`)
    .join('\n');
  assert.equal(libro.split('\n').length, 2);
  assert.deepEqual(
    nombres.filter((n) => libro.includes(n)),
    [],
    'ni en el enunciado ni en la evidencia',
  );
});
