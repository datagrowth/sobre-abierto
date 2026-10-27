// Evidencia en el CV de una persona: la ficha abierta desde la matriz de equipo
// pregunta si su CV menciona la materia («topografía») y en qué página. El índice de la Biblioteca
// es la frontera: aquí, un doble que apunta qué CV se le pide leer.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abrirNucleo } from '../../src/nucleo/db.js';
import { crearPersona } from '../../src/nucleo/colaboradores/personas.js';
import { evidenciaEnCv, mencionaMateria, type LectorCv, type Trozo } from '../../src/nucleo/colaboradores/evidencia.js';
import { ok } from '../../src/nucleo/result.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evidencia-cv-'));
const db = abrirNucleo(path.join(tmp, 'datos'));
const CV_A = 'Colaboradores/cv-persona-a.pdf';
const CV_B = 'Colaboradores/cv-persona-b.pdf';

const CVS: Record<string, Trozo[]> = {
  [CV_A]: [
    { page: 1, text: 'Persona A. Formadora ambiental con diez años de experiencia en educación para adultos.' },
    { page: 2, text: 'Impartió talleres de Topografía urbana y rural para el ayuntamiento durante 2023.' },
  ],
  [CV_B]: [{ page: 1, text: 'Persona B. Docente de topografía y cartografía en centros de formación.' }],
};

function lectorEspia(): { lector: LectorCv; leidos: string[] } {
  const leidos: string[] = [];
  return {
    leidos,
    lector: (ruta) => {
      leidos.push(ruta);
      return ok(CVS[ruta] ?? []);
    },
  };
}

const alta = (nombre: string, cv: string | null) => crearPersona(db, { nombre, tipo: 'externo', cv_ruta: cv }).data!.id;

after(() => {
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec('DELETE FROM personas');
});

test('should_return_cv_fragments_with_page_for_the_subject', () => {
  const id = alta('Persona A', CV_A);
  const { lector } = lectorEspia();

  const r = evidenciaEnCv(db, id, { materia: 'topografía' }, lector);

  assert.equal(r.error, null);
  assert.equal(r.data!.fragmentos.length, 1);
  const [f] = r.data!.fragmentos;
  assert.equal(f!.ruta, CV_A);
  assert.equal(f!.pagina, 2);
  assert.match(f!.texto, /Topografía urbana/);
});

test('should_return_empty_when_the_cv_does_not_mention_it', () => {
  const id = alta('Persona A', CV_A);
  const sinCv = alta('Persona C', null);
  const { lector, leidos } = lectorEspia();

  const r = evidenciaEnCv(db, id, { materia: 'limpieza' }, lector);
  const s = evidenciaEnCv(db, sinCv, { materia: 'topografía' }, lector);

  assert.deepEqual(r.data, { fragmentos: [] });
  assert.deepEqual(s.data, { fragmentos: [] });
  assert.deepEqual(leidos, [CV_A], 'sin CV no se lee nada');
});

test('should_never_search_another_persons_cv', () => {
  const a = alta('Persona A', CV_A);
  alta('Persona B', CV_B);
  const { lector, leidos } = lectorEspia();

  const r = evidenciaEnCv(db, a, { materia: 'topografía' }, lector);

  assert.deepEqual(leidos, [CV_A]);
  assert.ok(r.data!.fragmentos.every((f) => f.ruta === CV_A));
  assert.ok(r.data!.fragmentos.every((f) => !f.texto.includes('Persona B')));
});

test('should_reject_a_subject_too_short_or_too_long', () => {
  const id = alta('Persona A', CV_A);
  const { lector, leidos } = lectorEspia();

  assert.equal(evidenciaEnCv(db, id, { materia: 'x' }, lector).error?.code, 'invalid_input');
  assert.equal(evidenciaEnCv(db, id, { materia: 'x'.repeat(81) }, lector).error?.code, 'invalid_input');
  assert.equal(evidenciaEnCv(db, id, {}, lector).error?.code, 'invalid_input');
  assert.deepEqual(leidos, []);
});

test('should_return_not_found_for_an_unknown_person', () => {
  const r = evidenciaEnCv(db, 999_999, { materia: 'topografía' }, lectorEspia().lector);

  assert.equal(r.error?.code, 'not_found');
});

test('should_match_whole_words_without_accents_or_case', () => {
  const materia = 'Jardinería y arbolado';

  assert.ok(mencionaMateria('jardinerías y arbolado de parques', materia));
  assert.ok(mencionaMateria('JARDINERÍA Y ARBOLADO', materia));
  assert.ok(!mencionaMateria('subjardinería y arbolados', materia));
  assert.ok(!mencionaMateria('jardinería de interiores', materia));
  assert.ok(mencionaMateria('Educación ambiental', 'educacion'));
});

test('should_report_the_failure_when_the_index_is_not_available', () => {
  const id = alta('Persona A', CV_A);
  const caido: LectorCv = () => ({ data: null, error: { code: 'biblioteca_no_disponible', message: 'sin índice' } });

  const r = evidenciaEnCv(db, id, { materia: 'topografía' }, caido);

  assert.equal(r.error?.code, 'biblioteca_no_disponible');
});
