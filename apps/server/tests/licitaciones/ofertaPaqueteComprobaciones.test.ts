// Las comprobaciones del paquete (puras): lo que bloquea y lo que solo avisa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  comprobarPaquete,
  type CarpetaPlan,
  type ContextoComprobacion,
  type DocumentoPlan,
} from '../../src/dominios/licitaciones/oferta/paqueteComprobaciones.js';

const documento = (extra: Partial<DocumentoPlan> = {}): DocumentoPlan => ({
  orden: 1,
  nombre: 'Anexo II',
  clave: 'a1-d1',
  tipo: 'declaracion',
  obligatorio: true,
  estado: 'preparado',
  origen: 'Salidas/x/a.pdf',
  editable: null,
  con_pdf: true,
  archivo_destino: '01 Anexo II.pdf',
  ...extra,
});
const carpeta = (docs: DocumentoPlan[], extra: Partial<CarpetaPlan> = {}): CarpetaPlan => ({
  ruta: 'Lote 2/1 Sobre A',
  lote: '2',
  archivo: 'Sobre A',
  firma: null,
  indice: false,
  economica: false,
  documentos: docs,
  ...extra,
});
const ctx = (extra: Partial<ContextoComprobacion> = {}): ContextoComprobacion => ({
  plazo: null,
  coherencia: [],
  memoria: [],
  precios: [],
  pendientes: [],
  lecturas: new Map(),
  fugas: () => [],
  importes: () => [],
  anuladas: null,
  ...extra,
});
const lectura = (extra = {}) => ({ texto: '', amarillo: false, huecos: 0, pdf_antiguo: false, ...extra });
const resumen = (cs: { gravedad: string; tipo: string }[]) => cs.map((c) => `${c.gravedad}:${c.tipo}`);

test('should_block_when_a_mandatory_document_is_still_a_draft_but_only_warn_for_an_optional_one', () => {
  const cs = comprobarPaquete(
    [
      carpeta([
        documento({ estado: 'borrador' }),
        documento({ clave: 'a1-d2', nombre: 'Certificados', obligatorio: false, estado: 'borrador' }),
      ]),
    ],
    ctx(),
  );
  assert.deepEqual(resumen(cs), ['bloquea:obligatorio', 'aviso:obligatorio']);
  assert.match(cs[0]!.mensaje, /«Anexo II» \(obligatorio\) está en borrador/);
});

test('should_only_warn_about_a_prepared_mandatory_document_without_a_file_to_copy', () => {
  const enlace = documento({ nombre: 'Certificado ROLECE', origen: null, editable: null, archivo_destino: null });
  assert.deepEqual(resumen(comprobarPaquete([carpeta([enlace])], ctx())), ['aviso:obligatorio']);
  assert.deepEqual(
    resumen(comprobarPaquete([carpeta([{ ...enlace, estado: 'pendiente' }])], ctx())),
    ['bloquea:obligatorio'],
    'sin preparar sigue faltando',
  );
});

test('should_block_when_the_pdf_is_older_than_its_edited_docx', () => {
  const d = documento({ editable: 'Salidas/x/a.docx' });
  const cs = comprobarPaquete(
    [carpeta([d])],
    ctx({ lecturas: new Map([['Salidas/x/a.pdf', lectura({ pdf_antiguo: true })]]) }),
  );
  assert.deepEqual(resumen(cs), ['bloquea:pdf']);
  assert.match(cs[0]!.mensaje, /PDF de «Anexo II» es anterior a su \.docx/);
});

test('should_not_block_on_leaks_the_reviewer_annulled_with_a_reason_but_still_warn', () => {
  const memoria = documento({ nombre: 'Propuesta', tipo: 'memoria', origen: 'Salidas/x/m.pdf' });
  const fuga = {
    tipo: 'eco' as const,
    marca: 'acceso solo para actuaciones indispensables',
    cita: 'x',
    criterio: 'Accesos',
    archivo: 'Sobre C',
  };
  const lecturas = new Map([['Salidas/x/m.pdf', lectura()]]);
  assert.deepEqual(resumen(comprobarPaquete([carpeta([memoria])], ctx({ lecturas, fugas: () => [fuga] }))), [
    'bloquea:fuga',
  ]);
  const anuladas = {
    motivo: 'Es el criterio general de la ley, no lo ofertado',
    fugas: [{ tipo: fuga.tipo, marca: fuga.marca, criterio: fuga.criterio }],
  };
  const cs = comprobarPaquete([carpeta([memoria])], ctx({ lecturas, fugas: () => [fuga], anuladas }));
  assert.deepEqual(resumen(cs), ['aviso:fuga']);
  assert.match(cs[0]!.mensaje, /Es el criterio general de la ley/);
  const otra = { ...fuga, marca: 'otra cosa' };
  assert.deepEqual(
    resumen(comprobarPaquete([carpeta([memoria])], ctx({ lecturas, fugas: () => [fuga, otra], anuladas }))),
    ['bloquea:fuga', 'aviso:fuga'],
    'una fuga nueva sigue bloqueando',
  );
  const enAnexo = documento({ nombre: 'Anexo V', tipo: 'declaracion', origen: 'Salidas/x/v.pdf' });
  assert.deepEqual(
    resumen(
      comprobarPaquete(
        [carpeta([enAnexo])],
        ctx({ lecturas: new Map([['Salidas/x/v.pdf', lectura()]]), fugas: () => [fuga], anuladas }),
      ),
    ),
    ['bloquea:fuga'],
    'la anulación es de la memoria',
  );
});

test('should_block_when_the_same_memory_goes_in_several_lots_of_a_per_lot_file', () => {
  const memoria = (lote: string, origen = 'Salidas/x/m.pdf') =>
    carpeta([documento({ nombre: 'Propuesta', tipo: 'memoria', origen })], { ruta: `Lote ${lote}/2 Sobre B`, lote });
  const cs = comprobarPaquete([memoria('2'), memoria('4')], ctx());
  assert.deepEqual(resumen(cs), ['bloquea:memoria_por_lote']);
  assert.equal(
    cs[0]!.mensaje,
    'La misma memoria va en los lotes 2, 4 y el pliego pide una por lote: redáctalas en Memoria («Redactar las memorias, una por lote») o sube la de cada lote.',
  );
  assert.deepEqual(
    resumen(comprobarPaquete([memoria('2'), memoria('4', 'Salidas/x/m4.pdf')], ctx())),
    [],
    'una memoria distinta por lote',
  );
  const comun = carpeta([documento({ nombre: 'Propuesta', tipo: 'memoria' })], { ruta: 'Comun/2 Sobre B', lote: null });
  assert.deepEqual(
    resumen(comprobarPaquete([comun], ctx())),
    ['aviso:memoria_por_lote'],
    'en un archivo común, solo se avisa',
  );
});

// CASO_E: un archivo electrónico único para todos los lotes, con una fila de memoria por lote en la checklist («a1-d7-l2»).
const enArchivoUnico = (origenes: [string, string]) =>
  carpeta(
    origenes.map((origen, i) =>
      documento({
        nombre: 'Memoria Técnica específica para cada lote',
        clave: `a1-d7-l${['2', '4'][i]}`,
        tipo: 'memoria',
        origen,
      }),
    ),
    { ruta: 'Comun/1 Archivo único', lote: null },
  );

const POR_LOTE = { lotes: ['2', '4'], comunes: [] as string[] };

test('should_not_block_package_when_each_lote_has_its_own_memoria', () => {
  // Arrange
  const carpetas = [enArchivoUnico(['Salidas/x/memoria-v5.pdf', 'Salidas/x/memoria-v6.pdf'])];

  // Act
  const cs = comprobarPaquete(carpetas, ctx({ memoria_por_lote: POR_LOTE }));

  // Assert
  assert.deepEqual(resumen(cs), [], 'ni bloquea ni avisa de una memoria común');
});

test('should_still_block_when_the_same_memoria_goes_in_two_lotes', () => {
  // Arrange: sin memoria propia del lote 4, su fila toma la común (documentos.ts).
  const carpetas = [enArchivoUnico(['Salidas/x/memoria-v3.pdf', 'Salidas/x/memoria-v3.pdf'])];

  // Act
  const cs = comprobarPaquete(
    carpetas,
    ctx({ memoria_por_lote: { ...POR_LOTE, comunes: ['Salidas/x/memoria-v3.pdf'] } }),
  );

  // Assert
  assert.deepEqual(resumen(cs), ['bloquea:memoria_por_lote']);
  assert.match(cs[0]!.mensaje, /^La misma memoria va en los lotes 2, 4 y el pliego pide una por lote/);
});

test('should_only_warn_when_the_pliego_does_not_ask_one_memoria_per_lote', () => {
  // Arrange: memoria.por_lote = false, pero el documento de memoria trae lotes (filas a1-d7-l2 y a1-d7-l4).
  const carpetas = [enArchivoUnico(['Salidas/x/memoria-v3.pdf', 'Salidas/x/memoria-v3.pdf'])];

  // Act
  const cs = comprobarPaquete(carpetas, ctx({ memoria_por_lote: null }));

  // Assert
  assert.deepEqual(resumen(cs), ['aviso:memoria_por_lote'], 'como antes: sin carpetas por lote, solo un aviso');
});

test('should_block_when_a_lote_row_carries_the_common_memoria', () => {
  // Arrange: el lote 2 tiene la suya (v5) y la fila del lote 4 tira de la común (v3).
  const carpetas = [enArchivoUnico(['Salidas/x/memoria-v5.pdf', 'Salidas/x/memoria-v3.pdf'])];

  // Act
  const cs = comprobarPaquete(
    carpetas,
    ctx({ memoria_por_lote: { ...POR_LOTE, comunes: ['Salidas/x/memoria-v3.pdf'] } }),
  );

  // Assert
  assert.deepEqual(resumen(cs), ['bloquea:memoria_por_lote']);
  assert.equal(
    cs[0]!.mensaje,
    'La memoria común va en el lote 4 y el pliego pide una por lote: redáctalas en Memoria («Redactar las memorias, una por lote») o sube la de cada lote.',
  );
});

// ── Forma del paquete ──

test('should_block_a_memory_pdf_well_over_the_page_limit_and_warn_when_just_over', () => {
  const memoria = documento({ nombre: 'Memoria técnica', tipo: 'memoria', origen: 'Salidas/x/m.pdf' });
  const con = (paginas: number) =>
    comprobarPaquete(
      [carpeta([memoria])],
      ctx({ limite_paginas: 20, lecturas: new Map([['Salidas/x/m.pdf', lectura({ paginas })]]) }),
    );
  assert.deepEqual(resumen(con(20)), []);
  assert.deepEqual(resumen(con(22)), ['aviso:paginas'], 'portada e índice pueden no contar');
  const cs = con(23);
  assert.deepEqual(resumen(cs), ['bloquea:paginas']);
  assert.equal(
    cs[0]!.mensaje,
    '«Memoria técnica» tiene 23 páginas y el pliego permite 20: recórtala antes de firmarla.',
  );
  assert.deepEqual(
    resumen(
      comprobarPaquete(
        [carpeta([memoria])],
        ctx({ limite_paginas: null, lecturas: new Map([['Salidas/x/m.pdf', lectura({ paginas: 90 })]]) }),
      ),
    ),
    [],
    'sin límite no se juzga',
  );
});

test('should_warn_when_a_pdf_of_a_signed_file_has_no_signature_yet', () => {
  const lecturas = (firmado: boolean | null) => new Map([['Salidas/x/a.pdf', lectura({ firmado })]]);
  const firmar = carpeta([documento()], { firma: 'Firma electrónica del representante' });
  const cs = comprobarPaquete([firmar], ctx({ lecturas: lecturas(false) }));
  assert.deepEqual(resumen(cs), ['aviso:firma']);
  assert.equal(
    cs[0]!.mensaje,
    '«Anexo II» aún no lleva firma electrónica: fírmalo (Firma electrónica del representante) antes de subirlo.',
  );
  assert.deepEqual(resumen(comprobarPaquete([firmar], ctx({ lecturas: lecturas(true) }))), []);
  assert.deepEqual(
    resumen(comprobarPaquete([firmar], ctx({ lecturas: lecturas(null) }))),
    [],
    'sin PDF legible no se juzga',
  );
  assert.deepEqual(
    resumen(comprobarPaquete([carpeta([documento()])], ctx({ lecturas: lecturas(false) }))),
    [],
    'el pliego no pide firma en ese archivo',
  );
});

test('should_block_the_memory_in_the_price_file_and_the_price_offer_outside_it', () => {
  const memoria = documento({ nombre: 'Memoria', tipo: 'memoria', origen: 'Salidas/x/m.pdf' });
  const oferta = documento({
    clave: 'a3-d1',
    nombre: 'Oferta económica',
    tipo: 'oferta_economica',
    origen: 'Salidas/x/o.pdf',
  });
  const b = (docs: DocumentoPlan[]) => carpeta(docs, { ruta: 'Lote 2/2 Sobre B', archivo: 'Sobre B' });
  const c = (docs: DocumentoPlan[]) => carpeta(docs, { ruta: 'Lote 2/3 Sobre C', archivo: 'Sobre C', economica: true });
  assert.deepEqual(resumen(comprobarPaquete([b([memoria]), c([oferta])], ctx())), []);
  assert.deepEqual(resumen(comprobarPaquete([b([oferta]), c([memoria])], ctx())), ['bloquea:sobre', 'bloquea:sobre']);
  assert.deepEqual(resumen(comprobarPaquete([c([memoria, oferta])], ctx())), [], 'un archivo único lleva todo');
});

test('should_warn_when_two_rows_with_the_same_name_go_in_one_folder', () => {
  const cs = comprobarPaquete(
    [carpeta([documento(), documento({ clave: 'a1-d2', nombre: 'anexo ii', origen: 'Salidas/x/b.pdf' })])],
    ctx(),
  );
  assert.deepEqual(resumen(cs), ['aviso:nombre']);
});

// El formato de la memoria frente al del pliego, como aviso.
test('should_warn_when_the_memory_format_is_below_what_the_tender_asks', () => {
  const memoria = documento({ nombre: 'Memoria técnica', tipo: 'memoria', origen: 'Salidas/x/m.pdf' });
  const con = (formato: object | null, pliego: object | null) =>
    comprobarPaquete(
      [carpeta([memoria])],
      ctx({ formato: pliego, lecturas: new Map([['Salidas/x/m.pdf', lectura({ formato })]]) }),
    );
  const pliego = { fuente: 'Arial o similar', tamano_letra: 11, interlineado: 1.5 };
  assert.deepEqual(resumen(con({ fuente: 'Arial', tamano: 11, interlineado: 1.5 }, pliego)), []);
  assert.deepEqual(
    resumen(con({ fuente: 'Arial', tamano: 12, interlineado: 2 }, pliego)),
    [],
    'por encima del mínimo vale',
  );
  const cs = con({ fuente: 'Calibri', tamano: 10, interlineado: 1 }, pliego);
  assert.deepEqual(resumen(cs), ['aviso:formato']);
  assert.equal(
    cs[0]!.mensaje,
    '«Memoria técnica»: la fuente es Calibri y el pliego pide Arial o similar; la letra es de 10 puntos y el pliego pide 11; el interlineado es 1 y el pliego pide 1,5. Revísalo en el .docx antes de exportarlo a PDF.',
  );
  assert.deepEqual(resumen(con(null, pliego)), [], 'sin .docx no se juzga');
  assert.deepEqual(
    resumen(con({ fuente: 'Calibri', tamano: 9, interlineado: 1 }, null)),
    [],
    'el pliego no fija formato',
  );
});
