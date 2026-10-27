// El perfil de LinkedIn de un colaborador: solo el público y escrito siempre igual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfilProfesional } from '../../src/nucleo/colaboradores/personas.js';

const base = { nombre: 'Ana Prueba', tipo: 'externo' as const };

test('should_store_the_linkedin_profile_in_one_canonical_form', () => {
  assert.equal(
    PerfilProfesional.parse({ ...base, linkedin: 'es.linkedin.com/in/ana-prueba/?trk=public' }).linkedin,
    'https://www.linkedin.com/in/ana-prueba',
  );
  assert.equal(
    PerfilProfesional.parse({ ...base, linkedin: 'https://www.linkedin.com/in/ana-prueba' }).linkedin,
    'https://www.linkedin.com/in/ana-prueba',
  );
  assert.equal(PerfilProfesional.parse(base).linkedin, null, 'opcional: un perfil anterior sigue validando');
});

test('should_reject_anything_that_is_not_a_public_linkedin_profile', () => {
  for (const linkedin of [
    'linkedin.com/company/analitica-ejemplo',
    'https://evil.com/linkedin.com/in/ana',
    'ana prueba',
  ]) {
    assert.equal(PerfilProfesional.safeParse({ ...base, linkedin }).success, false, linkedin);
  }
});
