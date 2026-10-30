// licitaciones_documentos sobre CASO_E tal como estaba el 14/10/2026 (fixtures/comprobaciones,
// seudonimizada): la checklist por lote y sobre con lo que falta primero, el estado verificado
// (el archivo existe) en vez del select, y la hoja de datos sin importes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-docs-'));
for (const d of ['salidas', 'conocimiento', '.agentes']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
process.env.PLATAFORMA_DATA_DIR = path.join(tmp, 'datos');
process.env.AGENTES_DIR = path.join(tmp, '.agentes');
process.env.SALIDAS_DIR = path.join(tmp, 'salidas');
process.env.VAULT_PATH = path.join(tmp, 'conocimiento');
process.env.LICITACIONES_ACTIVO = '0';
process.env.LIBREOFFICE_ACTIVO = '0';
process.env.HERMES_VAULT_CONFIG_PATH = path.join(tmp, '__no_config__.json');
process.env.BIBLIOTECA_INDEX_DIR = path.join(tmp, 'index');
process.env.HOME = tmp;
process.env.NODE_ENV = 'test';

const { iniciarNucleo, cerrarNucleo, nucleo } = await import('../../src/nucleo/contexto.js');
const { raicesActuales } = await import('../../src/nucleo/salidas.js');
const { dbLicitaciones, cerrarDbLicitaciones } = await import('../../src/dominios/licitaciones/db.js');
const { ConsultaDocumentos, documentosParaAgente } =
  await import('../../src/dominios/licitaciones/oferta/toolsDocumentos.js');
const { leerFixtureComprobaciones, sembrarFixture } = await import('../helpers/comprobacionesFixtures.js');

iniciarNucleo();
const db = dbLicitaciones();
after(() => {
  cerrarDbLicitaciones();
  cerrarNucleo();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const casoE = leerFixtureComprobaciones('casoE');
sembrarFixture(db, nucleo().db, casoE);

const consultar = async (q: Record<string, unknown> = {}) =>
  documentosParaAgente(db, nucleo().db, raicesActuales(), ConsultaDocumentos.parse({ id: casoE.id, ...q }));

// El archivo único de CASO_E se sube por lote: una fila por documento y lote decidido (2 y 4).
function conArchivoPorLote<T>(prueba: () => Promise<T>): Promise<T> {
  const fila = db
    .prepare('SELECT id, datos FROM guiones WHERE licitacion_id = ? ORDER BY version DESC LIMIT 1')
    .get(casoE.id) as { id: number; datos: string };
  const guion = JSON.parse(fila.datos) as { archivos: { ambito?: string }[] };
  guion.archivos[0]!.ambito = 'por_lote';
  const guardar = db.prepare('UPDATE guiones SET datos = ? WHERE id = ?');
  guardar.run(JSON.stringify(guion), fila.id);
  return prueba().finally(() => guardar.run(fila.datos, fila.id));
}

test('should_list_only_the_documents_of_the_requested_lot', async () => {
  const r = await conArchivoPorLote(() => consultar({ lote: '2' }));

  assert.equal(r.error, null);
  const lotes = new Set(r.data!.documentos.map((d) => d.lote));
  assert.ok(lotes.has('2'), JSON.stringify([...lotes]));
  assert.ok(!lotes.has('4'));
  assert.ok([...lotes].every((l) => l === null || l === '2'));
});

test('should_filter_by_envelope_name', async () => {
  const todos = await consultar();
  const r = await consultar({ sobre: 'archivo único de la oferta' });

  assert.ok(r.data!.documentos.length > 0);
  assert.equal(r.data!.documentos.length, todos.data!.documentos.length);
  assert.equal((await consultar({ sobre: 'sobre que no existe' })).data!.documentos.length, 0);
});

test('should_report_verified_state_not_the_manual_select', async () => {
  const [a, b] = casoE.documentos.slice(0, 2).map((d) => d.clave);
  fs.writeFileSync(path.join(tmp, 'salidas', 'anexo-i.docx'), 'contenido');
  const marcar = db.prepare(
    "UPDATE oferta_documentos SET estado = 'preparado', ruta = ? WHERE licitacion_id = ? AND clave = ?",
  );
  marcar.run('Salidas/anexo-i.docx', casoE.id, a);
  marcar.run('Salidas/no-existe.docx', casoE.id, b);

  const r = await consultar();
  const por = new Map(r.data!.documentos.map((d) => [d.clave, d.estado_verificado]));

  assert.equal(por.get(a!), 'verificado');
  assert.equal(por.get(b!), 'falta');
});

test('should_exclude_amounts_from_the_data_sheet', async () => {
  const r = await consultar({ hoja: true });

  const grupos = new Set(r.data!.hoja!.campos.map((c) => c.grupo));
  assert.ok(grupos.has('Empresa') && grupos.has('Firma'), JSON.stringify([...grupos]));
  assert.ok([...grupos].every((g) => !g.startsWith('Oferta')));
  assert.equal((await consultar()).data!.hoja, undefined);
});

test('should_return_not_found_for_unknown_tender', async () => {
  const r = await documentosParaAgente(
    db,
    nucleo().db,
    raicesActuales(),
    ConsultaDocumentos.parse({ id: 'no-existe-123' }),
  );

  assert.equal(r.data, null);
  assert.equal(r.error?.code, 'not_found');
});

test('should_put_summary_before_documents', async () => {
  const r = await consultar({ hoja: true });

  assert.deepEqual(Object.keys(r.data!).slice(0, 2), ['resumen', 'documentos']);
  const { obligatorios, verificados, faltan } = r.data!.resumen;
  assert.equal(obligatorios - verificados, faltan);
  const estados = r.data!.documentos.map((d) => d.estado_verificado);
  assert.ok(estados.indexOf('verificado') === -1 || estados.indexOf('falta') < estados.indexOf('verificado'));
});

test('should_reject_unknown_fields_in_the_query', () => {
  assert.equal(ConsultaDocumentos.safeParse({ id: 'abc', extra: 1 }).success, false);
});
