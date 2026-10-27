import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoAnexo,
  textoDeuc,
  textoTipoBorrador,
  textoValoresAnexo,
  valoresDelAnexo,
  vistaPreviaAnexo,
  gruposHojaDatos,
  leerCambioDocumento,
  textoFaltasHoja,
} from './documentosOfertaFormato.js';

const anexo = (extra = {}) => ({ rellenable: false, motivo: null, en_curso: null, avisos: [], ...extra });

const DOCUMENTOS = [
  {
    clave: 'a0-d0',
    archivo: 'Archivo electrónico nº 1',
    nombre: 'DEUC',
    tipo: 'deuc',
    obligatorio: true,
    produce: 'persona',
    estado: 'pendiente',
    ruta: null,
    ruta_pdf: null,
    nota: null,
    anexo: anexo(),
  },
  {
    clave: 'a0-d1',
    archivo: 'Archivo electrónico nº 1',
    nombre: 'Memoria técnica',
    tipo: 'memoria',
    obligatorio: true,
    produce: 'hermes',
    estado: 'preparado',
    ruta: 'Salidas/x/memoria-v1.docx',
    nota: '',
    anexo: anexo(),
  },
  {
    clave: 'a1-d0',
    archivo: 'Archivo electrónico nº 2',
    nombre: 'Anexo VII',
    tipo: 'oferta_economica',
    obligatorio: true,
    produce: 'persona',
    estado: 'pendiente',
    ruta: null,
    nota: null,
    anexo: anexo({ rellenable: true }),
  },
];

test('should_say_whether_hermes_can_fill_a_form_and_why_not', () => {
  assert.equal(estadoAnexo({}), null);
  assert.deepEqual(estadoAnexo(DOCUMENTOS[2]), {
    rellenable: true,
    motivo: null,
    enCurso: null,
    avisos: [],
    modelo: null,
    deuc: null,
  });
  assert.equal(
    estadoAnexo({ anexo: anexo({ motivo: 'El modelo es un PDF: no se puede rellenar.' }) }).motivo,
    'El modelo es un PDF: no se puede rellenar.',
  );
  const enCurso = estadoAnexo({
    anexo: anexo({ rellenable: true, en_curso: { estado: 'generando' }, avisos: ['importe sin decidir: hueco vacío'] }),
  });
  assert.equal(enCurso.enCurso, 'Hermes lo está rellenando…');
  assert.deepEqual(enCurso.avisos, ['importe sin decidir: hueco vacío']);
});

test('should_describe_a_transcribed_draft_with_its_pages_and_ask_to_compare', () => {
  const transcrito = {
    ruta: 'Salidas/x/anexos/Anexo III-v1.docx',
    anexo: anexo({ modelo: { tipo: 'transcrito', ruta: 'Conocimiento/x/pcap.pdf', pagina: 41, hasta_pagina: 43 } }),
  };
  assert.equal(
    textoTipoBorrador(transcrito),
    'Borrador transcrito del PDF del pliego (págs. 41-43): compáralo con el original',
  );
  assert.equal(
    textoTipoBorrador({
      ...transcrito,
      anexo: anexo({ modelo: { tipo: 'transcrito', ruta: 'Conocimiento/x/pcap.pdf', pagina: 41 } }),
    }),
    'Borrador transcrito del PDF del pliego (pág. 41): compáralo con el original',
  );
  assert.equal(
    textoTipoBorrador({
      ruta: 'Salidas/x/a.pdf',
      anexo: anexo({ modelo: { tipo: 'campos', ruta: 'Conocimiento/x/a.pdf', pagina: null } }),
    }),
    'Borrador relleno por Hermes (PDF con campos)',
  );
  assert.equal(
    textoTipoBorrador({
      ruta: 'Salidas/x/a.docx',
      anexo: anexo({ modelo: { tipo: 'docx', ruta: 'Conocimiento/x/a.docx', pagina: null } }),
    }),
    'Borrador relleno por Hermes',
  );
  assert.equal(textoTipoBorrador({ ruta: null, anexo: anexo() }), null);
});

test('should_preview_the_pdf_of_a_draft_or_say_to_open_the_word', () => {
  assert.deepEqual(vistaPreviaAnexo({ ruta: 'Salidas/x/a-v1.pdf' }), { ruta: 'Salidas/x/a-v1.pdf', texto: null });
  assert.deepEqual(vistaPreviaAnexo({ ruta: 'Salidas/x/a-v1.docx', ruta_pdf: 'Salidas/x/a-v1.pdf' }), {
    ruta: 'Salidas/x/a-v1.pdf',
    texto: null,
  });
  assert.deepEqual(vistaPreviaAnexo({ ruta: 'Salidas/x/a-v1.docx', ruta_pdf: null }), {
    ruta: null,
    texto: 'Sin vista previa: abre el Word',
  });
  assert.equal(vistaPreviaAnexo({ ruta: null }), null);
});

test('should_link_the_original_model_at_its_page', () => {
  const a = estadoAnexo({
    anexo: anexo({ modelo: { tipo: 'a_mano', ruta: 'Conocimiento/Licitaciones/x/pcap.pdf', pagina: 12 } }),
  });
  assert.equal(a.modelo.url, '/hermes-vault/api/v1/files/raw?path=Licitaciones%2Fx%2Fpcap.pdf#page=12');
  assert.equal(a.modelo.pagina, 12);
  assert.equal(a.modelo.tipo, 'a_mano');
  const sinPagina = estadoAnexo({
    anexo: anexo({ modelo: { tipo: 'docx', ruta: 'Conocimiento/x/a.docx', pagina: null } }),
  });
  assert.equal(sinPagina.modelo.url, '/hermes-vault/api/v1/files/raw?path=x%2Fa.docx');
});

test('should_list_only_the_values_of_the_document_lot_that_are_not_missing', () => {
  const hoja = {
    campos: [
      { grupo: 'Empresa', etiqueta: 'Razón social', valor: 'Empresa A', falta: false },
      { grupo: 'Empresa', etiqueta: 'Teléfono', valor: null, falta: true },
      { grupo: 'Oferta · Lote 2', etiqueta: 'Impuesto', valor: 'IGIC 7 %', falta: false },
      { grupo: 'Oferta · Lote 3', etiqueta: 'Impuesto', valor: 'IGIC 7 %', falta: false },
      { grupo: 'Criterios automáticos', etiqueta: 'Formación (lote 3)', valor: 'Sí, nos acogemos', falta: false },
      { grupo: 'Criterios automáticos', etiqueta: 'Formación (lote 2)', valor: 'No', falta: false },
    ],
  };
  const valores = valoresDelAnexo(hoja, { lote: '3', nombre: 'Anexo II' });
  assert.deepEqual(
    valores.map((c) => `${c.grupo}|${c.etiqueta}`),
    ['Empresa|Razón social', 'Oferta · Lote 3|Impuesto', 'Criterios automáticos|Formación (lote 3)'],
  );
  assert.equal(textoValoresAnexo(valores.slice(0, 2)), 'Razón social: Empresa A\nImpuesto: IGIC 7 %');
  assert.equal(valoresDelAnexo(hoja, { nombre: 'Anexo II' }).length, 5);
  assert.deepEqual(valoresDelAnexo(null, { nombre: 'Anexo II' }), []);
});

test('should_describe_the_deuc_with_version_and_unanswered_questions', () => {
  const preguntas = Array.from({ length: 15 }, (_, i) => ({ codigo: `C${i}`, nombre: `Motivo ${i}` }));
  assert.equal(
    textoDeuc({
      peticion: 'Conocimiento/x/deuc.xml',
      respuesta: 'Salidas/x/anexos/DEUC-v2.xml',
      version: 2,
      sin_responder: preguntas,
    }),
    'DEUC preparado para importar (v2) · quedan 15 preguntas por responder en el servicio',
  );
  assert.equal(
    textoDeuc({ respuesta: 'Salidas/x/anexos/DEUC-v1.xml', version: 1, sin_responder: [preguntas[0]] }),
    'DEUC preparado para importar (v1) · queda 1 pregunta por responder en el servicio',
  );
  assert.equal(
    textoDeuc({ respuesta: 'Salidas/x/anexos/DEUC-v1.xml', version: 1, sin_responder: null }),
    'DEUC preparado para importar (v1)',
  );
  assert.equal(estadoAnexo({ anexo: anexo({ deuc: { version: 2 } }) }).deuc.version, 2);
});

test('should_say_there_is_no_deuc_yet_when_the_row_has_none', () => {
  assert.equal(
    textoDeuc({ peticion: 'Conocimiento/x/deuc.xml', respuesta: null, version: null, sin_responder: null }),
    'Aún no hay DEUC preparado',
  );
  assert.equal(textoDeuc(null), 'Aún no hay DEUC preparado');
});

test('should_send_only_the_changed_path_and_note_of_a_document', () => {
  assert.deepEqual(leerCambioDocumento({ ruta: ' Salidas/x/deuc.pdf ', nota: '' }, DOCUMENTOS[0]), {
    body: { ruta: 'Salidas/x/deuc.pdf' },
  });
  assert.deepEqual(leerCambioDocumento({ ruta: '', nota: 'Lo firma Paco' }, DOCUMENTOS[1]), {
    body: { ruta: null, nota: 'Lo firma Paco' },
  });
  assert.match(leerCambioDocumento({ ruta: 'C:/deuc.pdf', nota: '' }, DOCUMENTOS[0]).error, /Salidas/);
  assert.equal(leerCambioDocumento({ ruta: '', nota: '' }, DOCUMENTOS[0]).error, 'No hay cambios que guardar.');
  assert.match(leerCambioDocumento({ ruta: '', nota: 'x'.repeat(1001) }, DOCUMENTOS[0]).error, /1\.000/);
});

test('should_group_the_data_sheet_and_list_what_is_missing', () => {
  const campos = [
    { grupo: 'empresa', etiqueta: 'NIF', valor: 'B12345678', falta: false },
    { grupo: 'empresa', etiqueta: 'Teléfono', valor: null, falta: true },
    { grupo: 'oferta', etiqueta: 'Importe sin impuestos', valor: null, falta: true },
    { grupo: 'otro', etiqueta: 'X', valor: 'y', falta: false },
  ];
  assert.deepEqual(
    gruposHojaDatos(campos).map((g) => [g.titulo, g.campos.length]),
    [
      ['Empresa', 2],
      ['Oferta', 1],
      ['otro', 1],
    ],
  );
  assert.equal(textoFaltasHoja(campos), 'Faltan 2 datos: Teléfono y Importe sin impuestos.');
  assert.equal(textoFaltasHoja([campos[1]]), 'Falta 1 dato: Teléfono.');
  assert.equal(textoFaltasHoja([campos[0]]), null);
  assert.equal(textoFaltasHoja(), null);
});
