// Catálogo de la Biblioteca: tipo, sector y revisión de cada nota en el listado, y «Editar
// antes» de aprobar una propuesta de Hermes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'biblioteca-catalogo-'));
const vault = path.join(tmp, 'conocimiento');
fs.mkdirSync(vault);
process.env.VAULT_PATH = vault;
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.NODE_ENV = 'test';

const { catalogoDe } = await import('../../src/biblioteca/motor/catalogo.js');
const { listarNotas } = await import('../../src/biblioteca/motor/notas.js');
const { aprobar, crearPropuesta, editarPropuesta, leerPropuesta } =
  await import('../../src/biblioteca/motor/bandeja.js');

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const AHORA = Date.parse('2026-10-23T10:00:00Z');

test('should_read_the_type_from_the_frontmatter_or_deduce_it_from_the_folder', () => {
  assert.deepEqual(
    catalogoDe(
      { tipo: 'metodologia', sector: 'formación', revisada_en: '2026-06-01' },
      'Varios/x.md',
      '2026-01-01T00:00:00.000Z',
      AHORA,
    ),
    {
      tipo: 'metodologia',
      tipo_deducido: false,
      sector: 'formación',
      revisada_en: '2026-06-01T00:00:00.000Z',
      revisar: false,
    },
  );
  const deducida = catalogoDe({}, 'Casos de éxito/Medio ambiente/aire.md', '2026-09-01T00:00:00.000Z', AHORA);
  assert.deepEqual([deducida.tipo, deducida.tipo_deducido], ['caso_exito', true]);
  assert.equal(
    catalogoDe({ tipo: 'otra cosa' }, 'Notas/x.md', '2026-09-01T00:00:00.000Z', AHORA).tipo,
    null,
    'un tipo desconocido no cuenta',
  );
});

test('should_ask_to_review_a_note_untouched_for_more_than_twelve_months', () => {
  assert.equal(catalogoDe({}, 'x.md', '2025-03-01T00:00:00.000Z', AHORA).revisar, true);
  assert.equal(
    catalogoDe({ revisada_en: '2026-02-01' }, 'x.md', '2025-03-01T00:00:00.000Z', AHORA).revisar,
    false,
    'manda la fecha de revisión, no la del archivo',
  );
});

test('should_list_notes_with_their_catalog', async () => {
  fs.mkdirSync(path.join(vault, 'Plantillas'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'Plantillas', 'Cronograma.md'), '---\nsector: formación\n---\nUna tabla semanal.');
  const n = (await listarNotas()).find((x) => x.path === 'Plantillas/Cronograma.md')!;
  assert.deepEqual([n.tipo, n.tipo_deducido, n.sector, n.revisar], ['plantilla', true, 'formación', false]);
});

test('should_edit_a_pending_proposal_before_approving_it_keeping_its_origin', async () => {
  // Arrange
  const { path: ruta } = await crearPropuesta({
    title: 'Caso Cabildo',
    body: 'Borrador de Hermes.',
    source: 'Casos/informe.pdf',
    origin: 'licitaciones',
  });
  const archivo = path.basename(ruta);

  // Act
  await editarPropuesta(archivo, { title: 'Caso del Cabildo de Lanzarote', body: 'Texto revisado por una persona.' });
  const leida = await leerPropuesta(archivo);
  const { moved_to } = await aprobar(archivo);

  // Assert
  assert.deepEqual(
    [leida.title, leida.body.trim(), leida.frontmatter['origen'], leida.frontmatter['fuente']],
    ['Caso del Cabildo de Lanzarote', 'Texto revisado por una persona.', 'licitaciones', 'Casos/informe.pdf'],
  );
  assert.match(fs.readFileSync(path.join(vault, moved_to), 'utf8'), /Texto revisado por una persona/);
  await assert.rejects(() => leerPropuesta(archivo), /no encontrada/, 'ya aprobada, no se edita');
});
