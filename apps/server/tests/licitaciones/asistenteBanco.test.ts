// Banco de 30 respuestas libres: cada caso es de una pregunta real que va a Hermes y su
// decisión esperada existe en ella; la puntuación da 30 de 30 a las respuestas correctas y suspende
// por debajo de 27.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'banco-'));
for (const d of ['salidas', 'conocimiento']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { obtenerPersona } = await import('../../src/nucleo/colaboradores/personas.js');
const { preguntasDeOferta } = await import('../../src/dominios/licitaciones/oferta/asistentePreguntas.js');
const { CasoBanco, puntuarBanco, UMBRAL_BANCO } =
  await import('../../src/dominios/licitaciones/oferta/asistenteBanco.js');
const { OFERTAS_COMPROBACIONES, leerFixtureComprobaciones, sembrarFixture } =
  await import('../helpers/comprobacionesFixtures.js');

type Caso = ReturnType<typeof CasoBanco.parse>;
type Pregunta = NonNullable<Awaited<ReturnType<typeof preguntasDeOferta>>['data']>['preguntas'][number];

iniciarNucleo();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const BANCO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'asistente', 'respuestasLibres.json');
const casos = (JSON.parse(fs.readFileSync(BANCO, 'utf8')) as unknown[]).map((c) => CasoBanco.parse(c));
const preguntas = new Map<string, Pregunta[]>();
for (const o of OFERTAS_COMPROBACIONES) {
  const f = leerFixtureComprobaciones(o);
  sembrarFixture(dbLicitaciones(), nucleo().db, f);
}
for (const o of OFERTAS_COMPROBACIONES) {
  const f = leerFixtureComprobaciones(o);
  preguntas.set(
    o,
    (await preguntasDeOferta(dbLicitaciones(), nucleo().db, f.id, Date.parse(f.ahora))).data?.preguntas ?? [],
  );
}
const preguntaDe = (c: Caso) => preguntas.get(c.oferta)?.find((p) => p.clave === c.pregunta) ?? null;
const nombreDe = (id: number) => obtenerPersona(nucleo().db, id).data?.nombre ?? null;

// La respuesta correcta de cada caso, como la mandaría Hermes.
function correcta(c: Caso) {
  const p = preguntaDe(c)!;
  const e = c.esperado;
  if ('entendido' in e) return { entendido: false };
  if ('opcion' in e) return { entendido: true, opcion: e.opcion };
  if ('persona' in e)
    return {
      entendido: true,
      opcion: p.opciones.find((o) => o.accion?.tipo === 'persona' && nombreDe(o.accion.persona_id) === e.persona)!
        .clave,
    };
  return {
    entendido: true,
    opcion: e.acogerse ? p.opciones.find((o) => o.accion?.tipo === 'automatico' && o.accion.nos_acogemos)!.clave : 'no',
  };
}

test('should_have_thirty_cases_on_real_questions_that_go_to_hermes', () => {
  assert.equal(casos.length, 30);
  assert.equal(new Set(casos.map((c) => c.caso)).size, 30, 'sin casos repetidos');
  for (const c of casos) {
    const p = preguntaDe(c);
    assert.ok(p, `${c.caso}: no está la pregunta ${c.pregunta}`);
    assert.equal(p.libre, 'hermes', `${c.caso}: esa pregunta no manda el texto libre a Hermes`);
    const e = c.esperado;
    if ('opcion' in e)
      assert.ok(
        p.opciones.some((o) => o.clave === e.opcion),
        `${c.caso}: sin la opción ${e.opcion}`,
      );
    if ('persona' in e)
      assert.ok(
        p.opciones.some((o) => o.accion?.tipo === 'persona' && nombreDe(o.accion.persona_id) === e.persona),
        `${c.caso}: ${e.persona} no es candidata`,
      );
    if ('acogerse' in e) assert.equal(p.seccion, 'automaticos', c.caso);
  }
});

test('should_score_correct_answers_thirty_out_of_thirty', () => {
  const respuestas = Object.fromEntries(casos.map((c) => [c.caso, correcta(c)]));
  const r = puntuarBanco(casos, respuestas, preguntaDe, nombreDe);
  assert.deepEqual([r.aciertos, r.total, r.aprobado, r.fallos], [30, 30, true, []]);
});

test('should_fail_below_the_threshold_and_list_what_went_wrong', () => {
  // Arrange: cuatro mal, una sin responder
  const respuestas: Record<string, unknown> = Object.fromEntries(casos.map((c) => [c.caso, correcta(c)]));
  respuestas['director-fuera'] = { entendido: true, opcion: 'persona-1' };
  respuestas['sociales-si'] = { entendido: true, opcion: 'no' };
  respuestas['analista-manana'] = { entendido: true, opcion: 'contratar' };
  respuestas['coordinador-d'] = { entendido: true, accion: { tipo: 'contratar', rol: 'Coordinador', lotes: [] } };
  delete respuestas['alertas-si'];

  // Act
  const r = puntuarBanco(casos, respuestas as Parameters<typeof puntuarBanco>[1], preguntaDe, nombreDe);

  // Assert
  assert.equal(r.aciertos, 25);
  assert.equal(r.aprobado, r.aciertos >= UMBRAL_BANCO);
  assert.equal(r.aprobado, false);
  assert.deepEqual(r.fallos.map((f) => f.caso).sort(), [
    'alertas-si',
    'analista-manana',
    'coordinador-d',
    'director-fuera',
    'sociales-si',
  ]);
});

test('should_accept_a_decision_sent_as_an_action_instead_of_an_option', () => {
  const c = casos.find((x) => x.caso === 'monitorizacion-si')!;
  const p = preguntaDe(c)!;
  const criterio = p.opciones.find((o) => o.accion?.tipo === 'automatico')!.accion as { criterio: string };
  const r = puntuarBanco(
    [c],
    {
      [c.caso]: {
        entendido: true,
        accion: {
          tipo: 'automatico',
          criterio: criterio.criterio,
          lote: null,
          nos_acogemos: true,
          tramo: null,
          evidencia: 'Certificados de 2024 y 2025',
        },
      },
    },
    preguntaDe,
    nombreDe,
  );
  assert.equal(r.aciertos, 1);
});
