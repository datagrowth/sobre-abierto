// Los fixtures de los cambios tardíos (CASO_D, Villaejemplo, CASO_E) están
// seudonimizados; este test bloquea que se cuele un dato personal o un importe ofertado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(import.meta.dirname, 'fixtures');
const CAMBIOS = ['casoD-propuesta', 'casoC-medios', 'casoE-memoria'];
type J = Record<string, any>;
const leer = (...p: string[]): J => JSON.parse(fs.readFileSync(path.join(DIR, ...p), 'utf8'));
const crudo = (n: string) => fs.readFileSync(path.join(DIR, 'cambios', `${n}.json`), 'utf8');
const personasDe = (f: J): [number, string][] => (f.personas ?? []).map((p: J) => [p.persona_id, p.nombre]);

test('should_contain_no_email_phone_or_nif_in_any_o4_fixture', () => {
  const correo = /[\w.+-]+@[\w-]+\.[\w.]+/;
  const telefono = /(?:\+34\s?)?\b[6789]\d{2}\s?\d{3}\s?\d{3}\b/;
  const nifPersona = /\b(?:\d{8}[A-Z]|[XYZ]\d{7}[A-Z])\b/;
  for (const n of CAMBIOS) {
    const texto = crudo(n);
    assert.doesNotMatch(texto, correo, n);
    assert.doesNotMatch(texto, telefono, n);
    assert.doesNotMatch(texto, nifPersona, n);
    assert.doesNotMatch(texto, /"(?:cv_ruta|linkedin|tarifa)"s*:/i, n);
  }
});

test('should_keep_the_same_alias_for_a_person_across_fixtures', () => {
  const alias = new Map<number, string>();
  const comprobaciones = ['casoD', 'casoC', 'casoE'].flatMap((n) => personasDe(leer('comprobaciones', `${n}.json`)));
  for (const [id, nombre] of [...comprobaciones, ...CAMBIOS.flatMap((n) => personasDe(leer('cambios', `${n}.json`)))]) {
    assert.match(nombre, /^Persona [A-Z]$/);
    assert.equal(alias.get(id) ?? nombre, nombre, `persona ${id}`);
    alias.set(id, nombre);
  }
  assert.ok(alias.size >= 3);
});

test('should_have_no_offered_amount_in_decisions', () => {
  for (const n of ['casoD-propuesta', 'casoC-medios']) {
    const f = leer('cambios', `${n}.json`);
    const ofertas: J[] = [...(f.decisiones?.datos.ofertas ?? []), ...(f.propuesta?.datos.ofertas ?? [])];
    for (const o of ofertas) {
      assert.equal(o.importe, null, n);
      assert.deepEqual(o.unitarios, [], n);
    }
  }
});

test('should_carry_the_data_the_o4_acceptance_tests_need', () => {
  const g = leer('cambios', 'casoD-propuesta.json');
  const guardado = JSON.stringify(g.decisiones.datos.automaticos);
  const propuesto = JSON.stringify(g.propuesta.datos.automaticos);
  assert.match(guardado, /desde la puesta en marcha/);
  assert.match(propuesto, /a contar desde el 28 de diciembre de 2027/);

  const a = leer('cambios', 'casoC-medios.json');
  assert.ok(a.ficha_aprobada.datos && a.decisiones.datos.equipo.length > 0 && a.personas.length > 0);

  const m = leer('cambios', 'casoE-memoria.json');
  const textos = m.memorias.flatMap((x: J) => x.apartados.map((ap: J) => ap.texto ?? ''));
  assert.ok(textos.some((t: string) => t.length > 0));
});
