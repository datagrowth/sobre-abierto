// Wikilinks de las notas: enlaces salientes y entrantes, conflictos al guardar y
// reescritura de los enlaces al renombrar. Cada escenario usa nombres de nota propios
// porque los wikilinks se resuelven por nombre en toda la Biblioteca.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-wikilinks-'));
process.env.VAULT_PATH = tmp;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.NODE_ENV = 'test';

const { obtenerEnlacesNota, renombrarNotaActualizandoEnlaces } = await import('../../src/biblioteca/motor/enlaces.js');
const { leerNotaCruda, escribirNotaCruda, renombrarNota } = await import('../../src/biblioteca/motor/notas.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function escribir(relativa: string, contenido: string): void {
  const absoluta = path.join(tmp, relativa);
  fs.mkdirSync(path.dirname(absoluta), { recursive: true });
  fs.writeFileSync(absoluta, contenido, 'utf8');
}
const leer = (relativa: string): string => fs.readFileSync(path.join(tmp, relativa), 'utf8');

async function rechazaConCodigo(accion: () => Promise<unknown>, codigo: string): Promise<boolean> {
  try {
    await accion();
    return false;
  } catch (err) {
    return (err as { code?: string }).code === codigo;
  }
}

// Tres notas que se enlazan entre sí, con las formas de enlace que se reescriben (nombre,
// encabezado y alias, ruta completa, parcial con .md, embebido, frontmatter) y las que no
// (dentro de un bloque de código o de código en línea).
function escenarioConEnlaces(s: string) {
  const base = `Idea base ${s}`;
  escribir(`conceptos/Glosario ${s}.md`, `# Glosario\n\nVer [[${base}]] y [[${base}#Ejemplo|el ejemplo]].\n`);
  escribir(`metodo/${base}.md`, `# ${base}\n\nVuelve a [[Glosario ${s}]]. Enlace roto: [[No existe]].\n`);
  escribir(
    `proyectos/Plan ${s}.md`,
    [
      '---',
      `related: "[[${base}]]"`,
      '---',
      '',
      `Ruta completa [[metodo/${base}]], parcial [[${base}.md]], embebido ![[${base}]].`,
      '',
      '```',
      `Esto es código: [[${base}]]`,
      '```',
      '',
      `Código en línea \`[[${base}]]\` también se ignora.`,
      '',
    ].join('\n'),
  );
  return { base, glosario: `conceptos/Glosario ${s}.md`, nota: `metodo/${base}.md`, plan: `proyectos/Plan ${s}.md` };
}

test('should_resolve_outgoing_links_by_name_with_heading_and_flag_broken_ones', async () => {
  const e = escenarioConEnlaces('salientes');

  const desdeGlosario = await obtenerEnlacesNota(e.glosario);
  const desdeNota = await obtenerEnlacesNota(e.nota);

  assert.ok(
    desdeGlosario.outgoing.some((l) => l.target === e.base && l.heading === null && l.path === e.nota),
    JSON.stringify(desdeGlosario.outgoing),
  );
  assert.ok(desdeGlosario.outgoing.some((l) => l.heading === 'Ejemplo' && l.path === e.nota));
  assert.ok(desdeNota.outgoing.some((l) => l.target === 'No existe' && l.path === null));
});

test('should_list_incoming_links_without_counting_those_inside_code', async () => {
  const e = escenarioConEnlaces('entrantes');
  escribir('ideas/Suelta entrantes.md', '# Suelta\n\nSin enlaces.\n');

  const nota = await obtenerEnlacesNota(e.nota);
  const suelta = await obtenerEnlacesNota('ideas/Suelta entrantes.md');

  assert.deepEqual(nota.incoming.map((l) => l.path).sort(), [e.glosario, e.plan].sort());
  assert.equal(suelta.incoming.length, 0);
});

test('should_reject_saving_with_a_stale_hash_and_keep_the_external_edit', async () => {
  escribir('ideas/Conflicto.md', '# Conflicto\n\nSin enlaces.\n');
  const leida = await leerNotaCruda('ideas/Conflicto.md');
  assert.equal(typeof leida.hash, 'string');
  assert.equal(leida.hash.length, 64);
  escribir('ideas/Conflicto.md', leida.content + '\nEditado fuera del editor.\n');

  const rechazado = await rechazaConCodigo(
    () => escribirNotaCruda('ideas/Conflicto.md', 'mío', leida.hash),
    'conflict',
  );

  assert.equal(rechazado, true);
  assert.ok(leer('ideas/Conflicto.md').includes('Editado fuera del editor.'));
});

test('should_save_with_the_current_hash_and_overwrite_when_no_hash_is_given', async () => {
  escribir('ideas/Guardado.md', '# Guardado\n');
  const actual = await leerNotaCruda('ideas/Guardado.md');

  const guardada = await escribirNotaCruda('ideas/Guardado.md', 'mío', actual.hash);
  const sinHash = await escribirNotaCruda('ideas/Guardado.md', 'otra vez');

  assert.equal(guardada.hash !== actual.hash, true);
  assert.equal(sinHash.content, 'otra vez');
  assert.equal(leer('ideas/Guardado.md'), 'otra vez');
});

test('should_reject_saving_with_the_hash_of_a_note_that_no_longer_exists', async () => {
  escribir('ideas/Borrada.md', '# Borrada\n');
  const antes = await leerNotaCruda('ideas/Borrada.md');

  const rechazado = await rechazaConCodigo(() => escribirNotaCruda('ideas/Nada.md', 'x', antes.hash), 'conflict');

  assert.equal(rechazado, true);
});

test('should_rewrite_links_in_every_form_when_renaming_a_note_and_leave_code_untouched', async () => {
  const e = escenarioConEnlaces('renombrar');
  const nuevo = `Idea nueva renombrar`;
  const planAntes = leer(e.plan);

  const r = await renombrarNotaActualizandoEnlaces(e.nota, `metodo/${nuevo}.md`);

  assert.equal(r.from, e.nota);
  assert.equal(r.to, `metodo/${nuevo}.md`);
  assert.deepEqual([...r.links_updated].sort(), [e.glosario, e.plan].sort());
  const glosario = leer(e.glosario);
  assert.ok(glosario.includes(`[[${nuevo}]]`) && glosario.includes(`[[${nuevo}#Ejemplo|el ejemplo]]`), glosario);
  assert.ok(!glosario.includes(e.base), glosario);
  const plan = leer(e.plan);
  assert.ok(plan.includes(`related: "[[${nuevo}]]"`), plan);
  assert.ok(plan.includes(`[[metodo/${nuevo}]]`), plan);
  assert.ok(plan.includes(`[[${nuevo}.md]]`) && plan.includes(`![[${nuevo}]]`), plan);
  assert.ok(plan.includes(`Esto es código: [[${e.base}]]`) && plan.includes(`\`[[${e.base}]]\``), plan);
  assert.ok(leer(`metodo/${nuevo}.md`).includes(`[[Glosario renombrar]]`));
  assert.ok(copiasDeRespaldo().includes(planAntes), 'la nota reescrita se respalda con su versión anterior');
});

// Las copias de las notas tocadas van a .hermes-vault/backups (formato en disco heredado).
function copiasDeRespaldo(): string[] {
  const copias: string[] = [];
  const recorrer = (carpeta: string): void => {
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else copias.push(fs.readFileSync(ruta, 'utf8'));
    }
  };
  recorrer(path.join(tmp, '.hermes-vault', 'backups'));
  return copias;
}

test('should_link_with_the_full_path_when_the_new_name_is_ambiguous', async () => {
  escribir('b/Unica.md', '# Única\n');
  escribir('c/Enlaza.md', 'Ver [[Unica]].\n');
  escribir('d/Nueva.md', '# Ya existe una "Nueva" en d/\n');

  await renombrarNotaActualizandoEnlaces('b/Unica.md', 'b/Nueva.md');

  assert.ok(leer('c/Enlaza.md').includes('[[b/Nueva]]'), leer('c/Enlaza.md'));
});

test('should_not_touch_other_notes_when_links_are_not_to_be_updated', async () => {
  escribir('e/Fija.md', '# Fija\n');
  escribir('e/Ref.md', 'Ver [[Fija]].\n');

  const r = await renombrarNotaActualizandoEnlaces('e/Fija.md', 'e/Movida.md', false);

  assert.equal(r.links_updated.length, 0);
  assert.ok(leer('e/Ref.md').includes('[[Fija]]'));
});

test('should_rename_when_only_the_case_changes_and_reject_renaming_a_note_to_itself', async () => {
  escribir('f/Caso.md', '# Caso\n');

  await renombrarNota('f/Caso.md', 'f/caso.md');

  assert.ok(fs.readdirSync(path.join(tmp, 'f')).includes('caso.md'));
  assert.equal(await rechazaConCodigo(() => renombrarNota('f/caso.md', 'f/caso.md'), 'exists'), true);
});
