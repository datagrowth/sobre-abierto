// Perfiles a incorporar: lo guarda la oferta al comprometer un perfil sin nombrar a nadie,
// se retira si deja de comprometerlo, se ordena por la fecha de acreditación y una persona apunta el
// candidato o lo da por cubierto. Borrar a la persona candidata no deja su id colgando.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'incorporar-'));
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.LICITACIONES_ACTIVO = '0';
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const {
  guardarPerfilAIncorporar,
  retirarPerfilesAIncorporar,
  listarPerfilesAIncorporar,
  cambiarPerfilAIncorporar,
  registrarVigenciaIncorporar,
} = await import('../../src/nucleo/colaboradores/aIncorporar.js');
const { crearPersona, borrarPersona } = await import('../../src/nucleo/colaboradores/personas.js');

iniciarNucleo();
after(() => {
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function perfil(clave: string, extra: Record<string, unknown> = {}) {
  return {
    dominio: 'licitaciones',
    recurso: 'p-1',
    clave,
    perfil: 'Docente de IA generativa · lote 1',
    lote: '1',
    requisitos: '150 h impartidas en IA en los 3 últimos años y titulación universitaria',
    expediente: 'EXP-2026-0417',
    titulo: 'Formación en IA generativa',
    acreditar_antes: '2026-12-15',
    plazo: '10 días hábiles desde el requerimiento',
    cita: { documento: 'PCAP', pagina: 19, texto: 'cláusula 14.2' },
    ...extra,
  };
}

test('should_save_a_profile_once_per_offer_and_key_and_keep_its_candidate', () => {
  // Arrange
  const db = nucleo().db;
  const luis = crearPersona(db, { nombre: 'Luis Prueba', tipo: 'externo' });
  const p = guardarPerfilAIncorporar(db, perfil('docente:1'));
  assert.ok(p.data && luis.data);
  cambiarPerfilAIncorporar(db, p.data.id, { candidato_id: luis.data.id });

  // Act
  const otra = guardarPerfilAIncorporar(db, perfil('docente:1', { acreditar_antes: '2026-12-20' }));

  // Assert
  assert.equal(otra.data?.id, p.data.id);
  assert.equal(otra.data?.candidato_id, luis.data.id);
  assert.equal(otra.data?.acreditar_antes, '2026-12-20');
});

test('should_reject_a_profile_without_requirements_or_with_a_bad_date', () => {
  const db = nucleo().db;
  assert.equal(guardarPerfilAIncorporar(db, perfil('x', { requisitos: '' })).error?.code, 'invalid_input');
  assert.equal(
    guardarPerfilAIncorporar(db, perfil('x', { acreditar_antes: '15/12/2026' })).error?.code,
    'invalid_input',
  );
});

test('should_retire_profiles_the_offer_no_longer_commits_and_bring_them_back', () => {
  const db = nucleo().db;
  guardarPerfilAIncorporar(db, perfil('tutor:2', { recurso: 'p-2' }));
  guardarPerfilAIncorporar(db, perfil('docente:2', { recurso: 'p-2' }));
  assert.equal(retirarPerfilesAIncorporar(db, 'licitaciones', 'p-2', ['docente:2']), 1);
  assert.deepEqual(
    listarPerfilesAIncorporar(db, { dominio: 'licitaciones', recurso: 'p-2' }).map((p) => p.clave),
    ['docente:2'],
  );
  const vuelve = guardarPerfilAIncorporar(db, perfil('tutor:2', { recurso: 'p-2' }));
  assert.equal(vuelve.data?.estado, 'pendiente');
});

test('should_list_pending_by_nearest_accreditation_date_and_covered_last', () => {
  const db = nucleo().db;
  const tarde = guardarPerfilAIncorporar(db, perfil('a', { recurso: 'p-3', acreditar_antes: '2027-02-01' }));
  guardarPerfilAIncorporar(db, perfil('b', { recurso: 'p-3', acreditar_antes: '2026-11-01' }));
  guardarPerfilAIncorporar(db, perfil('c', { recurso: 'p-3', acreditar_antes: null }));
  assert.ok(tarde.data);
  cambiarPerfilAIncorporar(db, tarde.data.id, { estado: 'cubierto' });
  assert.deepEqual(
    listarPerfilesAIncorporar(db, { dominio: 'licitaciones', recurso: 'p-3' }).map((p) => p.clave),
    ['b', 'c', 'a'],
  );
});

test('should_not_accept_an_unknown_candidate_or_change_a_retired_profile', () => {
  const db = nucleo().db;
  const p = guardarPerfilAIncorporar(db, perfil('d', { recurso: 'p-4' }));
  assert.ok(p.data);
  assert.equal(cambiarPerfilAIncorporar(db, p.data.id, { candidato_id: 9999 }).error?.code, 'not_found');
  retirarPerfilesAIncorporar(db, 'licitaciones', 'p-4', []);
  assert.equal(cambiarPerfilAIncorporar(db, p.data.id, { estado: 'cubierto' }).error?.code, 'conflicto');
  assert.equal(cambiarPerfilAIncorporar(db, 123456, {}).error?.code, 'not_found');
});

test('should_clear_the_candidate_when_that_person_is_deleted', () => {
  const db = nucleo().db;
  const sofia = crearPersona(db, { nombre: 'Sofía Prueba', tipo: 'externo' });
  const p = guardarPerfilAIncorporar(db, perfil('e', { recurso: 'p-5' }));
  assert.ok(p.data && sofia.data);
  cambiarPerfilAIncorporar(db, p.data.id, { candidato_id: sofia.data.id });
  borrarPersona(db, sofia.data.id);
  assert.equal(listarPerfilesAIncorporar(db, { dominio: 'licitaciones', recurso: 'p-5' })[0]?.candidato_id, null);
});

test('should_retire_profiles_of_offers_that_no_longer_go_on', () => {
  // Arrange: la oferta p-9 se descartó; la p-10 sigue
  const db = nucleo().db;
  guardarPerfilAIncorporar(db, perfil('f', { recurso: 'p-9' }));
  guardarPerfilAIncorporar(db, perfil('g', { recurso: 'p-10' }));
  registrarVigenciaIncorporar('licitaciones', (recurso) => recurso !== 'p-9');

  // Act
  const lista = listarPerfilesAIncorporar(db);

  // Assert
  assert.ok(!lista.some((p) => p.recurso === 'p-9'), 'el de la oferta cerrada ya no sale');
  assert.ok(lista.some((p) => p.recurso === 'p-10'));
  registrarVigenciaIncorporar('licitaciones', () => true);
});
