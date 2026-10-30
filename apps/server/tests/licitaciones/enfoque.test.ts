// Enfoque opcional revisado: la fuga entre sobres se rechaza (CASO_F), lo que Hermes
// recomendó no prometer solo avisa (CASO_E: Aula Abierta propia, alojamiento en la UE, asistente 24/7) y va
// a la frontera del dossier. Sobre los fixtures seudonimizados de fixtures/comprobaciones y el entorno
// de la memoria (caso A) para el dossier.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { arrancar, cerrar, db, ID, nucleo, salidas, sinMemorias } from '../helpers/memoriaEntorno.js';
import { licitacion } from '../helpers/sinteticas.js';

const { crearPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { guardarLicitacion } = await import('../../src/dominios/licitaciones/store.js');
const { guionVigente } = await import('../../src/dominios/licitaciones/oferta/guion.js');
const { noPrometerDe, revisarEnfoque } = await import('../../src/dominios/licitaciones/oferta/enfoque.js');
const { guardarDecisiones } = await import('../../src/dominios/licitaciones/oferta/decisiones.js');
const { guardarSeccion } = await import('../../src/dominios/licitaciones/oferta/decisionesSecciones.js');
const { propuestaDecisionesDe, PropuestaDecisionesEntrada } =
  await import('../../src/dominios/licitaciones/oferta/propuestaDecisiones.js');
const { pedirMemoria } = await import('../../src/dominios/licitaciones/oferta/memoria.js');
const { componerDossier } = await import('../../src/dominios/licitaciones/oferta/dossier.js');
type DecisionesData = import('../../src/dominios/licitaciones/oferta/decisiones.js').DecisionesData;
type NoPrometerData = import('../../src/dominios/licitaciones/oferta/enfoque.js').NoPrometerData;

before(arrancar);
after(cerrar);

type Fixture = {
  licitacion: {
    titulo: string;
    presupuesto_sin_iva: number | null;
    lotes: { id: string; nombre: string; presupuesto_sin_iva: number }[];
  };
  oportunidad: { lotes_interes: string[] };
  guiones: { datos: unknown }[];
  decisiones: { datos: DecisionesData } | null;
  propuesta: { datos: Record<string, unknown> } | null;
  personas: { persona_id: number; nombre: string; rol: string }[];
};
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'comprobaciones');
const fixture = (n: string) => JSON.parse(fs.readFileSync(path.join(DIR, `${n}.json`), 'utf8')) as Fixture;
const CASO_E = fixture('casoE');
const CASO_F = fixture('casoF');

// El enfoque que Hermes propuso en CASO_E (literal, seudonimizado): promete lo que la empresa no tiene.
const ENFOQUE_CASO_E =
  'Aula Abierta 4.x administrado por la empresa y alojado en un centro de datos de la Unión Europea, con acceso individual y registro de conexión, informes quincenales con propuestas de mejora y asistente de IA integrado, disponible 24 horas, para dudas técnicas y de navegación.';
const NO_PROMETER_CASO_E: NoPrometerData[] = [
  {
    que: 'Aula Abierta propia',
    motivo: 'No tenemos una plataforma Aula Abierta propia en producción.',
    marcas: ['Aula Abierta propia', 'Aula Abierta 4.x', 'administrado por la empresa'],
  },
  {
    que: 'alojamiento en la UE',
    motivo: 'No consta dónde se alojaría ni con qué proveedor.',
    marcas: ['alojado en', 'centro de datos'],
  },
  {
    que: 'asistente 24/7',
    motivo: 'No tenemos un asistente de IA en servicio para alumnos.',
    marcas: ['24/7', '24 horas', 'chatbot'],
  },
];

// La licitación del fixture con su último guion (y sus decisiones, con personas nuevas y sin importes).
function sembrar(f: Fixture, id: string): { guion: number; decisiones: DecisionesData | null } {
  const lotes = f.licitacion.lotes.map((l) => ({ id: l.id, nombre: l.nombre, importe: l.presupuesto_sin_iva }));
  guardarLicitacion(db, {
    ...licitacion({
      titulo: f.licitacion.titulo,
      publicada: '2026-09-24',
      presupuesto: f.licitacion.presupuesto_sin_iva ?? 100000,
      lotes,
      limite: '2099-10-15T08:00:00',
    }),
    id,
    atom_id: `atom-${id}`,
  });
  const ts = new Date().toISOString();
  const interes = JSON.stringify(f.oportunidad.lotes_interes.map((x) => ({ id: x, motivo: 'criba' })));
  db.prepare(
    "INSERT INTO oportunidades (licitacion_id, estado, motivo_prefiltro, lotes_interes, creada_en, actualizada_en) VALUES (?, 'en_preparacion', 'CPV 80', ?, ?, ?)",
  ).run(id, interes, ts, ts);
  const guion = Number(
    db
      .prepare(
        "INSERT INTO guiones (licitacion_id, version, datos, agente, version_prompt, creado_en) VALUES (?, 1, ?, 'oferta-licitaciones', 1, ?)",
      )
      .run(id, JSON.stringify(f.guiones.at(-1)!.datos), ts).lastInsertRowid,
  );
  if (!f.decisiones) return { guion, decisiones: null };
  const ids = new Map(
    f.personas.map((p) => [
      p.persona_id,
      crearPersona(nucleo().db, { nombre: p.nombre, tipo: 'interno', rol: p.rol }).data!.id,
    ]),
  );
  const d = f.decisiones.datos;
  const decisiones = {
    ...d,
    equipo: d.equipo.map((m) => ({ ...m, persona_id: ids.get(m.persona_id)! })),
    ofertas: d.ofertas.map((o) => ({ ...o, pendiente: true, importe: null })),
  };
  return { guion, decisiones };
}

function guardarPropuesta(id: string, guion: number, datos: Record<string, unknown>): void {
  db.prepare(
    "INSERT INTO propuestas_decisiones (licitacion_id, guion_id, datos, avisos, agente, creada_en) VALUES (?, ?, ?, '[]', 'oferta-licitaciones', ?)",
  ).run(id, guion, JSON.stringify(datos), new Date().toISOString());
}

test('should_warn_when_enfoque_promises_what_hermes_said_not_to', () => {
  const ID_CASO_E = 'p-91000170';
  sembrar(CASO_E, ID_CASO_E);

  const r = revisarEnfoque(db, guionVigente(db, ID_CASO_E)!, ENFOQUE_CASO_E, NO_PROMETER_CASO_E);

  assert.deepEqual(r.errores, []);
  assert.deepEqual(r.avisos, [
    'El enfoque promete «Aula Abierta 4.x» y Hermes recomendó no prometer «Aula Abierta propia»: No tenemos una plataforma Aula Abierta propia en producción.',
    'El enfoque promete «alojado en» y Hermes recomendó no prometer «alojamiento en la UE»: No consta dónde se alojaría ni con qué proveedor.',
    'El enfoque promete «24 horas» y Hermes recomendó no prometer «asistente 24/7»: No tenemos un asistente de IA en servicio para alumnos.',
  ]);
});

test('should_match_marks_as_whole_words_only', () => {
  const ID_CASO_E = 'p-91000180';
  sembrar(CASO_E, ID_CASO_E);
  const moodle: NoPrometerData = {
    que: 'Aula Abierta propia',
    motivo: 'No tenemos una plataforma Aula Abierta propia.',
    marcas: ['Aula Abierta'],
  };
  const g = guionVigente(db, ID_CASO_E)!;

  const dentro = revisarEnfoque(db, g, 'Formación sobre Aula Abiertas de terceros.', [moodle]);
  const entera = revisarEnfoque(db, g, 'Formación en AULA ABIERTA, con soporte 24/7.', [
    moodle,
    NO_PROMETER_CASO_E[2]!,
  ]);

  assert.deepEqual(dentro.avisos, []);
  assert.equal(entera.avisos.length, 2);
  assert.match(entera.avisos[1]!, /promete «24\/7»/);
});

test('should_reject_enfoque_that_leaks_an_automatic_criterion', () => {
  const ID_CASO_F = 'p-91000790';
  sembrar(CASO_F, ID_CASO_F);

  const r = revisarEnfoque(
    db,
    guionVigente(db, ID_CASO_F)!,
    'Auditamos los portales con un analizador WCAG 2.2 y un lector de pantalla JAWS, y con pruebas con usuarios durante 12 meses.',
    [],
  );

  assert.equal(r.errores.length, 1);
  assert.match(r.errores[0]!, /^El enfoque delata lo que va en otro sobre: /);
});

test('should_accept_an_empty_enfoque', () => {
  const ID_CASO_F = 'p-91000800';
  sembrar(CASO_F, ID_CASO_F);

  const r = revisarEnfoque(db, guionVigente(db, ID_CASO_F)!, '   ', NO_PROMETER_CASO_E);
  const propuesta = PropuestaDecisionesEntrada.safeParse({
    id: ID_CASO_F,
    guion_id: 1,
    equipo: [],
    resumen: 'Sin enfoque: la estrategia lo saca del pliego.',
  });

  assert.deepEqual(r, { errores: [], avisos: [] });
  assert.ok(propuesta.success, JSON.stringify(propuesta.error?.issues));
  assert.equal(propuesta.data.enfoque, '');
  assert.deepEqual(propuesta.data.no_prometer, []);
});

test('should_parse_stored_proposals_without_no_prometer', () => {
  const ID_CASO_E = 'p-91000190';
  const { guion } = sembrar(CASO_E, ID_CASO_E);
  guardarPropuesta(ID_CASO_E, guion, CASO_E.propuesta!.datos);

  const p = propuestaDecisionesDe(db, ID_CASO_E);

  assert.ok(p, 'la propuesta guardada antes del campo sigue validando');
  assert.deepEqual(p.datos.no_prometer, []);
  assert.deepEqual(noPrometerDe(db, ID_CASO_E), []);
});

test('should_save_decisions_with_no_prometer_warnings_not_errors', () => {
  const ID_CASO_E = 'p-91000200';
  const { guion, decisiones } = sembrar(CASO_E, ID_CASO_E);
  guardarPropuesta(ID_CASO_E, guion, { ...CASO_E.propuesta!.datos, no_prometer: NO_PROMETER_CASO_E });

  // Los automáticos del fixture, sin acogernos: tal cual no pasan el PUT (sin evidencia) y aquí se mide el enfoque.
  const automaticos = decisiones!.automaticos.map((a) => ({
    ...a,
    nos_acogemos: false,
    tramo: null,
    nota: 'Sin acogernos en esta prueba.',
  }));
  const r = guardarDecisiones(db, nucleo().db, ID_CASO_E, { ...decisiones!, automaticos, enfoque: ENFOQUE_CASO_E });

  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.avisos.filter((a) => a.includes('Hermes recomendó no prometer')).length, 3);
  assert.equal(r.data!.datos.enfoque, ENFOQUE_CASO_E, 'se guarda tal cual');
});

test('should_reject_saving_decisions_whose_enfoque_leaks', () => {
  const ID_CASO_F = 'p-91000810';
  sembrar(CASO_F, ID_CASO_F);

  const r = guardarDecisiones(db, nucleo().db, ID_CASO_F, {
    enfoque: 'Usaremos un analizador WCAG 2.2 y un lector de pantalla JAWS.',
  });

  assert.equal(r.error?.code, 'invalid_input');
  assert.match(r.error?.message ?? '', /El enfoque delata lo que va en otro sobre/);
  assert.equal(
    db.prepare('SELECT 1 FROM decisiones_oferta WHERE licitacion_id = ?').get(ID_CASO_F),
    undefined,
    'no se escribe nada',
  );
});

test('should_list_no_prometer_in_the_dossier_frontier', async () => {
  const guion = guionVigente(db, ID)!;
  guardarPropuesta(ID, guion.id, {
    lotes: [],
    equipo: [],
    resumen: 'Propuesta de prueba.',
    no_prometer: [{ que: 'atención presencial diaria', motivo: 'El servicio es remoto', marcas: ['presencial'] }],
  });
  sinMemorias();
  const memoria = pedirMemoria(nucleo().db, db, salidas, ID).data!.memoria;

  const d = await componerDossier(db, nucleo().db, memoria);

  assert.equal(d.error, null, d.error?.message);
  const frontera = d.data!.secciones.find((s) => s.clave === 'frontera')!.texto;
  assert.ok(
    frontera.includes(
      '- No prometer (lo recomendó Hermes al proponer las decisiones): «atención presencial diaria» — El servicio es remoto.',
    ),
    frontera,
  );
});

test('should_warn_when_enfoque_section_promises_what_hermes_said_not_to', () => {
  // Arrange
  const ID_CASO_E = 'p-91000210';
  const { guion } = sembrar(CASO_E, ID_CASO_E);
  guardarPropuesta(ID_CASO_E, guion, { ...CASO_E.propuesta!.datos, no_prometer: NO_PROMETER_CASO_E });

  // Act: la web guarda solo el bloque Enfoque (PATCH /oferta/decisiones/enfoque).
  const r = guardarSeccion(db, nucleo().db, ID_CASO_E, 'enfoque', { version: 1, valor: ENFOQUE_CASO_E });

  // Assert
  assert.equal(r.error, null, r.error?.message);
  assert.equal(r.data!.avisos.filter((a) => a.includes('Hermes recomendó no prometer')).length, 3);
  assert.equal(r.data!.datos.enfoque, ENFOQUE_CASO_E, 'se guarda tal cual');
});

test('should_reject_enfoque_section_that_leaks_without_writing_anything', () => {
  // Arrange
  const ID_CASO_F = 'p-91000820';
  sembrar(CASO_F, ID_CASO_F);

  // Act
  const r = guardarSeccion(db, nucleo().db, ID_CASO_F, 'enfoque', {
    version: 1,
    valor: 'Usaremos un analizador WCAG 2.2 y un lector de pantalla JAWS.',
  });
  const otra = guardarSeccion(db, nucleo().db, ID_CASO_F, 'herramientas', { version: 1, valor: [] });

  // Assert
  assert.equal(r.error?.code, 'invalid_input');
  assert.match(r.error?.message ?? '', /El enfoque delata lo que va en otro sobre/);
  assert.equal(otra.error, null, 'el resto de secciones se sigue guardando');
  assert.equal(otra.data!.datos.enfoque, '', 'el enfoque con fuga no llegó a guardarse');
});
