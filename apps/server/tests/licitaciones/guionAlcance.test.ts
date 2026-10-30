// El alcance del guion (unidades por archivo, con página y documento): validación al leerlo y petición al run del guion.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
const { GuionBase, instruccionesGuion } = await import('../../src/dominios/licitaciones/oferta/guion.js');

const base = {
  archivos: [
    {
      nombre: 'Archivo 1',
      contenido: 'Todo',
      prohibiciones: [],
      firma: 'no',
      documentos: [{ tipo: 'otro', nombre: 'Anexo I', obligatorio: true, produce: 'persona', origen: null }],
    },
  ],
  memoria: null,
  automaticos: [],
  plazo: { fecha_limite: null, canal: 'PLACSP' },
};
const unidad = (o: object = {}) => ({
  nombre: 'Curso A',
  personas_minimas: 20,
  horas: 60,
  grupos: 2,
  semanas: 8,
  ...o,
});

test('should_parse_stored_guion_without_alcance', () => {
  const r = GuionBase.safeParse(base);
  const rutas = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  assert.deepEqual(
    rutas.filter((p) => p.startsWith('alcance')),
    [],
  );
  if (r.success) assert.equal(r.data.alcance, undefined);
});

test('should_accept_alcance_with_page_and_document', () => {
  const r = GuionBase.safeParse({ ...base, alcance: [unidad({ documento: 'PPT.pdf', pagina: 4, lotes: ['3'] })] });
  const rutas = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  assert.deepEqual(
    rutas.filter((p) => p.startsWith('alcance')),
    [],
  );
  if (r.success) assert.equal(r.data.alcance?.[0]?.pagina, 4);
});

test('should_reject_more_than_30_units_or_negative_people', () => {
  const rutas = (alcance: unknown[]) => {
    const r = GuionBase.safeParse({ ...base, alcance });
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.')).filter((p) => p.startsWith('alcance'));
  };
  assert.notEqual(rutas(Array.from({ length: 31 }, () => unidad())).length, 0);
  assert.notEqual(rutas([unidad({ personas_minimas: -1 })]).length, 0);
  assert.deepEqual(rutas(Array.from({ length: 30 }, () => unidad())), []);
});

test('should_ask_the_guion_run_for_alcance_rows', () => {
  assert.match(instruccionesGuion('p-1', 'Analítica Ejemplo'), /alcance: una fila por curso o servicio/);
});
