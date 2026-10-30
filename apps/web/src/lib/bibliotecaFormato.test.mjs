import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filasDeNotas,
  filtrarNotas,
  lineaIndexador,
  motivoIlegible,
  origenDePropuesta,
  recuentos,
  textoUsos,
} from './bibliotecaFormato.js';

const NOTAS = [
  {
    path: 'Casos/Medio ambiente/Aire.md',
    title: 'Cuadros de mando de calidad del aire',
    tipo: 'caso_exito',
    sector: 'Medio ambiente',
    revisar: false,
  },
  {
    path: 'Metodologías/IA.md',
    title: 'Metodología de formación en IA',
    tipo: 'metodologia',
    sector: 'Formación',
    revisar: false,
  },
  {
    path: 'Servicios/Gobierno del dato.md',
    title: 'Gobierno del dato',
    tipo: 'ficha_servicio',
    sector: null,
    revisar: true,
  },
  { path: 'Sueltas/x.md', title: 'Sin tipo', tipo: null, sector: null, revisar: false },
];

test('should_add_the_folder_and_the_offers_where_each_note_was_used', () => {
  const f = filasDeNotas(NOTAS, { 'Metodologías/IA.md': 6 });
  assert.deepEqual(
    f.map((n) => [n.carpeta, n.usos]),
    [
      ['Casos/Medio ambiente', 0],
      ['Metodologías', 6],
      ['Servicios', 0],
      ['Sueltas', 0],
    ],
  );
  assert.deepEqual([textoUsos(0), textoUsos(1), textoUsos(6)], ['—', '1 oferta', '6 ofertas']);
});

test('should_filter_by_type_sector_state_and_text', () => {
  const f = filasDeNotas(NOTAS);
  assert.equal(filtrarNotas(f, { tipos: ['caso_exito', 'metodologia'] }).length, 2);
  assert.equal(filtrarNotas(f, { tipos: ['sin_tipo'] })[0].title, 'Sin tipo');
  assert.equal(filtrarNotas(f, { sector: 'Formación' }).length, 1);
  assert.deepEqual(
    filtrarNotas(f, { estado: 'revisar' }).map((n) => n.title),
    ['Gobierno del dato'],
  );
  assert.equal(filtrarNotas(f, { estado: 'al_dia' }).length, 3);
  assert.equal(filtrarNotas(f, { texto: 'aire' }).length, 1);
  assert.deepEqual(recuentos(f), {
    tipos: { caso_exito: 1, metodologia: 1, ficha_servicio: 1, sin_tipo: 1 },
    sectores: ['Formación', 'Medio ambiente'],
    revisar: 1,
  });
});

test('should_say_how_the_index_is_in_one_line', () => {
  assert.equal(
    lineaIndexador({ status: { phase: 'idle', documents: 1284, notes: 312, scanned: 3 } }),
    'Búsqueda al día: 1.284 documentos y 312 notas leídos. 3 PDF escaneados sin texto.',
  );
  assert.equal(
    lineaIndexador({ status: { phase: 'scanning', documents: 10, notes: 2, scanned: 0 } }),
    'Leyendo la Biblioteca: 10 documentos y 2 notas leídos.',
  );
  assert.equal(lineaIndexador(null), 'El índice aún no ha arrancado.');
});

test('should_tell_where_a_proposal_comes_from', () => {
  assert.equal(origenDePropuesta({ fuente: 'Licitaciones/TUR-2026/memoria.pdf' }), 'Desde un documento');
  assert.equal(origenDePropuesta({ fuente: 'Ofertas/X/Resolución/Acta mesa.pdf' }), 'Desde un acta');
  assert.equal(origenDePropuesta({ origen_tipo: 'parrafo' }), 'Párrafo que se repite');
  assert.equal(origenDePropuesta({}), 'Propuesta de Hermes');
});

test('should_say_why_a_document_cannot_be_read', () => {
  assert.equal(motivoIlegible({ estado: 'scanned' }), 'PDF escaneado sin texto: necesita OCR');
  assert.equal(motivoIlegible({ estado: 'error', error: 'cifrado' }), 'No se puede leer: cifrado');
});
