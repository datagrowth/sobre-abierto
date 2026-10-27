// Frontmatter de notas y propuestas que vienen de terceros: nunca se ejecuta (gray-matter
// evalúa «---js»), las anclas/alias YAML no se expanden y el agente no elige dónde
// queda su propuesta metiendo «carpeta» o «fuente» en su propio frontmatter.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-frontmatter-'));
const vault = path.join(tmp, 'conocimiento');
fs.mkdirSync(vault);
process.env.VAULT_PATH = vault;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.NODE_ENV = 'test';

const { leerNota, listarNotas } = await import('../../src/biblioteca/motor/notas.js');
const { crearPropuesta, listarPendientes, aprobar, carpetaAprobacion } =
  await import('../../src/biblioteca/motor/bandeja.js');
const { escanearBiblioteca, indexarHallazgos } = await import('../../src/biblioteca/motor/documentos/indexador.js');
const store = await import('../../src/biblioteca/motor/documentos/almacen.js');
const { leerFrontmatter, MAX_FRONTMATTER_BYTES } = await import('../../src/biblioteca/motor/frontmatter.js');

type Marcador = { __hermesEjecutado?: number };
const global = globalThis as Marcador;

after(() => fs.rmSync(tmp, { recursive: true, force: true }));
beforeEach(() => {
  delete global.__hermesEjecutado;
});

// Frontmatter JavaScript con efecto observable: si se evalúa, suma en una global (y
// podría lanzar procesos con child_process). Cada llamada es distinta para que la caché
// de gray-matter no esconda una segunda evaluación.
let n = 0;
function payload(lang = 'js'): string {
  n += 1;
  return `---${lang}\n{ x: (globalThis.__hermesEjecutado = ${n}, typeof require("child_process").execSync) }\n---\nCuerpo ${n}\n`;
}

function write(rel: string, content: string): void {
  const abs = path.join(vault, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// 10 niveles de alias de 10 en 10: unos cientos de bytes que, expandidos, son 10^6 «lol».
function bombaYaml(): string {
  const lineas = ['a0: &a0 [lol, lol, lol, lol, lol, lol, lol, lol, lol, lol]'];
  for (let i = 1; i <= 5; i++)
    lineas.push(
      `a${i}: &a${i} [${Array(10)
        .fill(`*a${i - 1}`)
        .join(', ')}]`,
    );
  return `---\nestado: pendiente\ntitle: Bomba\n${lineas.join('\n')}\n---\nTexto\n`;
}

test('should_not_execute_javascript_frontmatter_when_reading_a_note', async () => {
  write('js/nota.md', payload());
  const note = await leerNota('js/nota.md');
  assert.equal(global.__hermesEjecutado, undefined, 'el frontmatter se ejecutó');
  assert.deepEqual(note.frontmatter, {});
  write('js/coffee.md', payload('javascript'));
  await leerNota('js/coffee.md');
  assert.equal(global.__hermesEjecutado, undefined);
});

test('should_not_execute_javascript_frontmatter_when_listing_notes', async () => {
  write('js/lista.md', payload());
  const notas = await listarNotas();
  assert.equal(global.__hermesEjecutado, undefined, 'el frontmatter se ejecutó');
  assert.ok(notas.some((nota) => nota.path === 'js/lista.md'));
});

test('should_not_execute_javascript_frontmatter_when_indexing', async () => {
  write('js/indexada.md', payload());
  const db = store.abrirIndice(process.env.BIBLIOTECA_INDEX_DIR!);
  try {
    const found = (await escanearBiblioteca(vault)).get('js/indexada.md');
    assert.ok(found);
    await indexarHallazgos(db, found);
    assert.equal(global.__hermesEjecutado, undefined, 'el frontmatter se ejecutó');
    assert.equal(store.obtenerArchivo(db, 'js/indexada.md')?.status, 'ok');
  } finally {
    db.close();
  }
});

test('should_not_execute_javascript_frontmatter_in_an_agent_proposal', async () => {
  const { path: ruta } = await crearPropuesta({ title: 'Propuesta js', body: payload() });
  // También escondido tras un frontmatter YAML: matter.stringify volvía a leer el cuerpo.
  await crearPropuesta({ title: 'Propuesta js escondida', body: `---\ntipo: informe\n---\n${payload()}` });
  await listarPendientes();
  assert.equal(global.__hermesEjecutado, undefined, 'el frontmatter se ejecutó');
  const guardada = fs.readFileSync(path.join(vault, ruta), 'utf8');
  assert.match(guardada, /^---\n/);
  assert.match(guardada, /estado: pendiente/);
});

test('should_reject_frontmatter_in_other_languages_without_running_it', () => {
  for (const lang of ['js', 'javascript', ' JS ', 'coffee', 'toml', 'json']) {
    const r = leerFrontmatter(payload(lang));
    assert.equal(r.error?.code, 'invalid_content', lang);
  }
  assert.equal(global.__hermesEjecutado, undefined);
  assert.deepEqual(leerFrontmatter('---yaml\ntitle: Hola\n---\nx').data?.data, { title: 'Hola' });
});

test('should_not_expand_yaml_aliases_when_reading_a_note', async () => {
  write('bomba.md', bombaYaml());
  const note = await leerNota('bomba.md');
  assert.ok(JSON.stringify(note.frontmatter).length < 1000, 'el frontmatter se expandió');
  assert.equal(leerFrontmatter(bombaYaml()).error?.code, 'invalid_content');
});

test('should_not_expand_yaml_aliases_in_pending_proposals', async () => {
  fs.mkdirSync(path.join(vault, '_Propuestas'), { recursive: true });
  fs.writeFileSync(path.join(vault, '_Propuestas', 'Bomba.md'), bombaYaml());
  const pendientes = await listarPendientes();
  assert.ok(JSON.stringify(pendientes).length < 100_000, 'el frontmatter se expandió');
});

test('should_reject_frontmatter_larger_than_the_limit', () => {
  const grande = `---\ntitle: x\nrelleno: "${'a'.repeat(MAX_FRONTMATTER_BYTES)}"\n---\nTexto`;
  assert.equal(leerFrontmatter(grande).error?.code, 'invalid_content');
  assert.deepEqual(leerFrontmatter('---\ntitle: x\ntags: [a, b]\n---\nTexto').data, {
    data: { title: 'x', tags: ['a', 'b'] },
    content: 'Texto',
  });
});

test('should_drop_reserved_keys_from_the_agent_frontmatter', async () => {
  const body =
    '---\ncarpeta: Colaboradores\nfuente: Colaboradores/CV Ana.pdf\nestado: aprobada\norigen: humano\ntipo: informe\n---\nTexto de la nota\n';
  const { path: ruta } = await crearPropuesta({ title: 'Reservadas', body, origin: 'hermes' });
  const fm = leerFrontmatter(fs.readFileSync(path.join(vault, ruta), 'utf8')).data!.data;
  assert.equal(fm['carpeta'], undefined);
  assert.equal(fm['fuente'], undefined);
  assert.equal(fm['estado'], 'pendiente');
  assert.equal(fm['origen'], 'hermes');
  assert.equal(fm['tipo'], 'informe', 'el resto del frontmatter se conserva');
  assert.equal(carpetaAprobacion(fm), '');
  const { moved_to } = await aprobar(path.basename(ruta));
  assert.equal(moved_to, 'Reservadas.md');
});

test('should_keep_the_validated_folder_and_source_of_the_proposal', async () => {
  const { path: ruta } = await crearPropuesta({
    title: 'Con carpeta',
    body: '---\ncarpeta: Otra\n---\nx',
    folder: 'Licitaciones',
    source: 'Licitaciones/pliego.pdf',
  });
  const fm = leerFrontmatter(fs.readFileSync(path.join(vault, ruta), 'utf8')).data!.data;
  assert.equal(fm['carpeta'], 'Licitaciones');
  assert.equal(fm['fuente'], 'Licitaciones/pliego.pdf');
});
