// Escritura de notas: ida y vuelta, copia previa, validación del contenido y rechazo
// de rutas que salen de la Biblioteca.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-escritura-'));
process.env.VAULT_PATH = tmp;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.NODE_ENV = 'test';

const { escribirNotaCruda, leerNota, MAX_BYTES_NOTA } = await import('../../src/biblioteca/motor/notas.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Las copias de una nota van a .hermes-vault/backups (formato en disco heredado).
function copiasDe(nombreArchivo: string): string[] {
  const copias: string[] = [];
  const recorrer = (carpeta: string): void => {
    for (const entrada of fs.readdirSync(carpeta, { withFileTypes: true })) {
      const ruta = path.join(carpeta, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (entrada.name === nombreArchivo) copias.push(fs.readFileSync(ruta, 'utf8'));
    }
  };
  const raiz = path.join(tmp, '.hermes-vault', 'backups');
  if (fs.existsSync(raiz)) recorrer(raiz);
  return copias;
}

async function rechaza(accion: () => Promise<unknown>): Promise<boolean> {
  try {
    await accion();
    return false;
  } catch {
    return true;
  }
}

function crearNotaEnDisco(relativa: string, contenido: string): string {
  const absoluta = path.join(tmp, relativa);
  fs.mkdirSync(path.dirname(absoluta), { recursive: true });
  fs.writeFileSync(absoluta, contenido, 'utf8');
  return absoluta;
}

test('should_persist_the_sent_content_and_reparse_the_frontmatter_on_read', async () => {
  const relativa = 'conceptos/Ida y vuelta.md';
  const absoluta = crearNotaEnDisco(relativa, '---\ntags: [a]\n---\n\n# Original\n\nCuerpo inicial.\n');
  const nuevo = '---\ntags: [a, b]\n---\n\n# Editado\n\nCuerpo nuevo con [[Otra nota]].\n';

  const actualizada = await escribirNotaCruda(relativa, nuevo);
  const releida = await leerNota(relativa);

  assert.equal(actualizada.path, relativa);
  assert.equal(fs.readFileSync(absoluta, 'utf8'), nuevo);
  assert.deepEqual(releida.frontmatter.tags, ['a', 'b']);
});

test('should_back_up_the_original_before_overwriting_and_keep_both_copies_on_consecutive_saves', async () => {
  const relativa = 'conceptos/Con copia.md';
  const original = '---\ntags: [a]\n---\n\n# Original\n\nCuerpo inicial.\n';
  crearNotaEnDisco(relativa, original);
  const nuevo = '---\ntags: [a, b]\n---\n\n# Editado\n';

  await escribirNotaCruda(relativa, nuevo);
  const trasElPrimero = copiasDe('Con copia.md');
  await escribirNotaCruda(relativa, nuevo + 'otra línea\n');
  const trasElSegundo = copiasDe('Con copia.md');

  assert.ok(trasElPrimero.includes(original), 'copia del contenido original');
  assert.ok(trasElSegundo.includes(original) && trasElSegundo.includes(nuevo), `copias=${trasElSegundo.length}`);
});

test('should_reject_missing_non_text_or_oversized_content_without_emptying_the_note', async () => {
  const relativa = 'conceptos/Intacta.md';
  const absoluta = crearNotaEnDisco(relativa, '# Intacta\n');

  const sinContenido = await rechaza(() => escribirNotaCruda(relativa, undefined));
  const noTexto = await rechaza(() => escribirNotaCruda(relativa, 42));
  const demasiado = await rechaza(() => escribirNotaCruda(relativa, 'x'.repeat(MAX_BYTES_NOTA + 1)));

  assert.equal(sinContenido, true);
  assert.equal(noTexto, true);
  assert.equal(demasiado, true);
  assert.equal(fs.readFileSync(absoluta, 'utf8'), '# Intacta\n');
});

test('should_reject_paths_outside_the_library_and_files_that_are_not_markdown', async () => {
  const fuera = await rechaza(() => escribirNotaCruda('../fuera.md', 'x'));
  const noMarkdown = await rechaza(() => escribirNotaCruda('script.js', 'x'));

  assert.equal(fuera, true);
  assert.equal(noMarkdown, true);
});
