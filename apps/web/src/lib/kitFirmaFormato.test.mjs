import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kitDeFirma } from './kitFirmaFormato.js';

const doc = (orden, archivo) => ({ orden, nombre: archivo.slice(3), archivo });
// Villaejemplo con dos lotes y lo común: el manifiesto trae las carpetas en el orden del guion.
const VIGENTE = {
  version: 2,
  ruta: 'Salidas/Licitaciones/Villaejemplo (p-1)/PRESENTACION/v2 2026-10-14 1800',
  manifiesto: {
    carpetas: [
      {
        ruta: 'Lote 3/1 Sobre A',
        lote: '3',
        archivo: 'Sobre A',
        firma: null,
        documentos: [doc(2, '02 Anexo VI.pdf'), doc(1, '01 DEUC.pdf')],
      },
      { ruta: 'Lote 10/1 Sobre A', lote: '10', archivo: 'Sobre A', firma: null, documentos: [doc(1, '01 DEUC.pdf')] },
      {
        ruta: 'Comun/2 Sobre B',
        lote: null,
        archivo: 'Sobre B',
        firma: 'Firma del representante',
        documentos: [doc(1, '01 Memoria.pdf'), doc(0, '00 Indice del sobre.pdf')],
      },
      { ruta: 'Lote 3/3 Sobre C', lote: '3', archivo: 'Sobre C', firma: null, documentos: [doc(1, '01 Anexo V.pdf')] },
      { ruta: 'Lote 10/3 Sobre C', lote: '10', archivo: 'Sobre C', firma: null, documentos: [] },
    ],
  },
};

test('should_number_files_in_upload_order_per_envelope', () => {
  // Act
  const k = kitDeFirma(VIGENTE);
  // Assert
  assert.deepEqual(
    k.carpetas.map((c) => c.ruta),
    ['Comun/2 Sobre B', 'Lote 3/1 Sobre A', 'Lote 3/3 Sobre C', 'Lote 10/1 Sobre A'],
  );
  assert.deepEqual(
    k.carpetas[0].archivos.map((a) => [a.n, a.archivo]),
    [
      [1, '00 Indice del sobre.pdf'],
      [2, '01 Memoria.pdf'],
    ],
  );
  assert.deepEqual(
    k.carpetas[1].archivos.map((a) => [a.n, a.archivo]),
    [
      [1, '01 DEUC.pdf'],
      [2, '02 Anexo VI.pdf'],
    ],
  );
  assert.equal(k.carpetas[0].firma, 'Firma del representante');
});

test('should_leave_out_envelopes_without_files', () => {
  const k = kitDeFirma(VIGENTE);
  assert.ok(!k.carpetas.some((c) => c.ruta === 'Lote 10/3 Sobre C'));
});

test('should_link_values_to_type_next_to_the_package', () => {
  const k = kitDeFirma(VIGENTE);
  assert.equal(
    k.valores,
    `/api/licitaciones/salidas/documento?ruta=${encodeURIComponent(`${VIGENTE.ruta}/VALORES_A_TECLEAR.md`)}`,
  );
  assert.match(decodeURIComponent(k.instrucciones), /\/INSTRUCCIONES\.md$/);
});

test('should_return_null_without_a_package_or_with_a_malformed_manifest', () => {
  assert.equal(kitDeFirma(null), null);
  assert.equal(kitDeFirma({ version: 1, ruta: 'x' }), null);
  assert.equal(kitDeFirma({ version: 1, manifiesto: { carpetas: [] } }), null);
  assert.deepEqual(kitDeFirma({ version: 1, ruta: 'x', manifiesto: { carpetas: [] } }).carpetas, []);
});
