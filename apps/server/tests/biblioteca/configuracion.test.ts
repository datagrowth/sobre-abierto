// Configuración de la Biblioteca tras quitar el chat y el grafo: solo queda la
// ruta de la bóveda y la API key del antiguo LLM se borra del disco.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-config-'));
const file = path.join(tmp, 'hermes-vault.config.json');
process.env.HERMES_VAULT_CONFIG_PATH = file;
// Desarrollo local: sin VAULT_PATH la bóveda se elige en Ajustes y se guarda en el archivo.
delete process.env.VAULT_PATH;
delete process.env.HERMES_VAULT_MODE;
process.env.NODE_ENV = 'test';

const { descartarAjustesObsoletos, obtenerRutaBiblioteca, fijarRutaBiblioteca, rutaBibliotecaFijada } =
  await import('../../src/biblioteca/motor/configuracion.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('should_remove_the_old_llm_key_and_keep_the_vault_path', () => {
  const vault = path.join(tmp, 'notas');
  fs.mkdirSync(vault);
  fs.writeFileSync(
    file,
    JSON.stringify({
      vault_path: vault,
      llm_backend: 'claude',
      llm_api_key: 'sk-ant-secreto-viejo',
      graph_auto_refresh: true,
    }),
  );
  assert.equal(descartarAjustesObsoletos(), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { vault_path: vault });
  assert.equal(obtenerRutaBiblioteca(), vault);
  assert.equal(descartarAjustesObsoletos(), false, 'la segunda vez no hay nada que quitar');
});

test('should_delete_the_file_when_only_obsolete_keys_were_left', () => {
  fs.writeFileSync(file, JSON.stringify({ llm_backend: 'ollama' }));
  assert.equal(descartarAjustesObsoletos(), true);
  assert.equal(fs.existsSync(file), false);
});

test('should_return_false_when_the_obsolete_key_cannot_be_removed', () => {
  const vault = path.join(tmp, 'notas');
  fs.writeFileSync(file, JSON.stringify({ vault_path: vault, llm_api_key: 'sk-ant-secreto-viejo' }));
  fs.chmodSync(file, 0o444);
  try {
    assert.equal(descartarAjustesObsoletos(), false, 'el secreto sigue en disco: no se puede dar por quitado');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).llm_api_key, 'sk-ant-secreto-viejo');
  } finally {
    fs.chmodSync(file, 0o666);
  }
  assert.equal(descartarAjustesObsoletos(), true, 'cuando se puede escribir, se quita');
});

test('should_let_the_web_choose_the_vault_when_no_vault_path_is_fixed', () => {
  const vault = path.join(tmp, 'elegida');
  fs.mkdirSync(vault);
  assert.equal(rutaBibliotecaFijada(), false);
  assert.deepEqual(fijarRutaBiblioteca(vault), { vault_path: vault });
  assert.equal(obtenerRutaBiblioteca(), vault);
});
