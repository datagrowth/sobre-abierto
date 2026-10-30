// Los pliegos del radar (y lo de otro dominio con ficha) ya tienen su ficha: no se convierten
// en notas de la Biblioteca.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carpetasConFicha, dominioConFicha, registrarCarpetaConFicha } from '../../src/nucleo/documentos.js';

registrarCarpetaConFicha('Licitaciones/Radar', 'Licitaciones');
registrarCarpetaConFicha('Convenios', 'Convenios');

test('should_tell_which_domain_analyses_a_document_with_its_ficha', () => {
  assert.equal(
    dominioConFicha('Licitaciones/Radar/2026/EXP-2026-0412 (p-91000710)/PCAP_EXP-2026-0412_PLACSP.pdf'),
    'Licitaciones',
  );
  assert.equal(dominioConFicha('licitaciones/radar/2026/x/PCAP.pdf'), 'Licitaciones', 'Drive no distingue mayúsculas');
  assert.equal(dominioConFicha('Convenios/2026/Convenio marco/bases.pdf'), 'Convenios');
});

test('should_let_other_documents_become_notes', () => {
  assert.equal(
    dominioConFicha('Licitaciones/Presentadas/2026/x/memoria.pdf'),
    null,
    'lo que presentamos sí puede tener nota',
  );
  assert.equal(dominioConFicha('Empresa/perfil-licitaciones.md'), null);
  assert.equal(
    dominioConFicha('Licitaciones/Radarismo.pdf'),
    null,
    'solo dentro de la carpeta, no por prefijo de nombre',
  );
  assert.deepEqual(carpetasConFicha().sort(), ['Convenios', 'Licitaciones/Radar']);
});
