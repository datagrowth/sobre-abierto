import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  datosAnexoDeFormulario,
  datosPedidos,
  formularioInicial,
  lotesParaOrden,
  mover,
  textoCita,
} from './datosAnexoFormato.js';

const CITA = {
  documento: 'ANEXO V.docx',
  pagina: null,
  texto: 'SUBCONTRATACIÓN SERVIDORES O SERVICIOS ASOCIADOS.',
  comprobada: false,
};
const fila = (dato, cita = CITA) => ({ clave: `dato_anexo:-:${dato}`, gravedad: 'riesgo', cita });

test('should_list_only_decided_lots_in_order_field', () => {
  const orden = lotesParaOrden(['4', '1', '2'], ['2', '4', '3']);

  assert.deepEqual(orden, ['4', '2', '3'], 'el 1 no está decidido; el 3 se añade al final');
});

test('should_list_the_decided_lots_when_no_order_was_saved', () => {
  assert.deepEqual(lotesParaOrden(null, ['3']), ['3']);
  assert.deepEqual(lotesParaOrden(['2', '2'], ['2']), ['2'], 'sin duplicados');
  assert.deepEqual(lotesParaOrden([], []), []);
});

test('should_show_the_comprobaciones_rows_and_the_decided_ones_in_fixed_order', () => {
  const pedidos = datosPedidos([fila('impuesto'), { clave: 'precio:3' }, fila('subcontratacion_servidores')], {
    orden_lotes: ['3'],
    impuesto: null,
  });

  assert.deepEqual(
    pedidos.map((p) => p.dato),
    ['subcontratacion_servidores', 'orden_lotes', 'impuesto'],
  );
  assert.equal(pedidos[1].cita, null, 'ya decidido: su fila no está');
  assert.equal(pedidos[0].cita, CITA);
});

test('should_show_nothing_when_the_annex_asks_for_nothing', () => {
  assert.deepEqual(datosPedidos([], null), []);
  assert.deepEqual(datosPedidos(undefined, undefined), []);
});

test('should_quote_document_page_and_text', () => {
  assert.equal(
    textoCita({ ...CITA, pagina: 108 }),
    'ANEXO V.docx, pág. 108: «SUBCONTRATACIÓN SERVIDORES O SERVICIOS ASOCIADOS.»',
  );
  assert.equal(textoCita(null), null);
});

test('should_move_a_lot_up_and_keep_the_list_at_the_edges', () => {
  assert.deepEqual(mover(['1', '2', '3'], 2, -1), ['1', '3', '2']);
  assert.deepEqual(mover(['1', '2'], 0, -1), ['1', '2']);
});

test('should_save_igic_with_the_general_rate_when_no_rate_is_typed', () => {
  const pedidos = [{ dato: 'impuesto' }];

  const r = datosAnexoDeFormulario(
    { impuesto_tipo: 'IGIC', impuesto_porcentaje: '' },
    { subcontratacion_servidores: false },
    pedidos,
  );

  assert.deepEqual(r.data, {
    subcontratacion_servidores: false,
    orden_lotes: null,
    impuesto: { tipo: 'IGIC', porcentaje: 7 },
  });
});

test('should_save_exempt_as_zero_and_reject_a_rate_out_of_range', () => {
  const pedidos = [{ dato: 'impuesto' }];

  assert.deepEqual(
    datosAnexoDeFormulario({ impuesto_tipo: 'exento', impuesto_porcentaje: '9' }, null, pedidos).data.impuesto,
    { tipo: 'exento', porcentaje: 0 },
  );
  assert.match(
    datosAnexoDeFormulario({ impuesto_tipo: 'IVA', impuesto_porcentaje: '45' }, null, pedidos).error,
    /de 0 a 30/,
  );
  assert.deepEqual(
    datosAnexoDeFormulario({ impuesto_tipo: 'IGIC', impuesto_porcentaje: '6,5' }, null, pedidos).data.impuesto,
    { tipo: 'IGIC', porcentaje: 6.5 },
  );
});

test('should_save_subcontracting_and_order_from_the_form', () => {
  const pedidos = [{ dato: 'subcontratacion_servidores' }, { dato: 'orden_lotes' }];
  const form = { ...formularioInicial(null, ['3']), subcontratacion: 'no' };

  const r = datosAnexoDeFormulario(form, null, pedidos);

  assert.deepEqual(r.data, { subcontratacion_servidores: false, orden_lotes: ['3'], impuesto: null });
});
