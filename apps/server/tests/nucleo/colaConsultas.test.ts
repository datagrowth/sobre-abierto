// Consultas de la cola para la web y el MCP: el listado por filtros y páginas y los últimos trabajos,
// con el error recortado y sin decir de quién es un trabajo con datos personales.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cola-consultas-'));
process.env.NODE_ENV = 'test';

const { abrirNucleo } = await import('../../src/nucleo/db.js');
const { estadoCola, listarTrabajos } = await import('../../src/nucleo/colaConsultas.js');
const { insertarFallido } = await import('../helpers/cola.js');

const otraCola = (nombre: string) => abrirNucleo(path.join(tmp, nombre));

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('should_list_jobs_by_type_state_code_and_tender_page_by_page', () => {
  const d = otraCola('listar');
  const insertar =
    d.prepare(`INSERT INTO trabajos_ia (tipo, dominio, clave, payload, estado, codigo, error, creado_en, actualizado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const hoy = new Date().toISOString();
  for (let i = 0; i < 5; i += 1)
    insertar.run(
      'licitaciones.ficha',
      'licitaciones',
      `f${i}`,
      JSON.stringify({ id: `p-${i % 2}` }),
      'fallido',
      'sin_resultado',
      'x'.repeat(2000),
      hoy,
      hoy,
    );
  insertar.run(
    'licitaciones.ficha',
    'licitaciones',
    'ok',
    JSON.stringify({ id: 'p-0' }),
    'completado',
    null,
    null,
    hoy,
    hoy,
  );
  insertar.run(
    'colaboradores.perfil_cv',
    'colaboradores',
    'cv',
    JSON.stringify({ id: 'Ana Pérez.pdf' }),
    'fallido',
    'sin_resultado',
    null,
    hoy,
    hoy,
  );
  insertar.run(
    'licitaciones.ficha',
    'licitaciones',
    'viejo',
    JSON.stringify({ id: 'p-0' }),
    'fallido',
    'sin_resultado',
    null,
    '2020-01-01T00:00:00Z',
    '2020-01-01T00:00:00Z',
  );
  const pagina = listarTrabajos(d, {
    tipo: 'licitaciones.ficha',
    estado: 'fallido',
    codigo: 'sin_resultado',
    dias: 7,
    desde: 0,
    limite: 2,
  });
  assert.deepEqual([pagina.total, pagina.trabajos.length, pagina.siguiente], [5, 2, 2]);
  const t = pagina.trabajos[0] as { recurso: string; error: string };
  assert.equal(t.recurso, 'p-0', 'la licitación del trabajo, del más nuevo al más viejo');
  assert.equal(t.error.length, 1500, 'el error, recortado');
  assert.equal(
    listarTrabajos(d, { tipo: 'licitaciones.ficha', estado: 'fallido', dias: 7, desde: 4, limite: 2 }).siguiente,
    null,
    'última página',
  );
  assert.equal(
    listarTrabajos(d, { recurso: 'p-0', desde: 0, limite: 50 }).total,
    5,
    'por licitación, de cualquier estado y fecha',
  );
  const cv = listarTrabajos(d, { tipo: 'colaboradores.perfil_cv', desde: 0, limite: 5 }).trabajos[0] as {
    recurso: unknown;
  };
  assert.equal(cv.recurso, null, 'un CV no dice de quién es');
  d.close();
});

test('should_cut_errors_at_1500_characters_from_the_end', () => {
  const d = otraCola('recorte');
  insertarFallido(d, 'largo', `${'a'.repeat(1499)}${'b'.repeat(500)}`, { codigo: 'x' });
  const largo = (estadoCola(d).ultimos as { error: string }[])[0]!.error;
  assert.equal(largo.length, 1500);
  assert.ok(largo.endsWith('…') && largo.startsWith('aaa') && !largo.includes('b'));
  const listado = (listarTrabajos(d, { desde: 0, limite: 10 }).trabajos as { error: string }[])[0]!.error;
  assert.equal(listado, largo);
  d.close();
});

test('should_include_resource_in_latest_jobs_except_personal_domains', () => {
  const d = otraCola('recurso');
  insertarFallido(d, 'lic', 'x', { payload: '{"id":"LIC-1"}' });
  insertarFallido(d, 'cv', 'x', { payload: '{"id":"colab-7"}', dominio: 'colaboradores' });
  const ultimos = estadoCola(d).ultimos as { recurso: string | null; dominio?: string }[];
  assert.equal(ultimos[1]!.recurso, 'LIC-1');
  assert.equal(ultimos[0]!.recurso, null);
  assert.ok(ultimos.every((u) => !('dominio' in u)));
  d.close();
});
