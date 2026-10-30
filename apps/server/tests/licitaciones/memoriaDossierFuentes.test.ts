// Piezas del dossier, con documentos sintéticos: cómo se reconoce cada documento de
// la carpeta (clase, fecha, código y versión), el calendario sin inicio previsto (fecha límite +
// 5 semanas, sin festivos), los anexos informativos y los alias de los roles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clasificarDocumento,
  codigoYVersion,
  fechaDeDocumento,
} from '../../src/dominios/licitaciones/documentosCarpeta.js';
import {
  calendarioPrevisto,
  lineasCalendario,
  mesesDeTexto,
} from '../../src/dominios/licitaciones/oferta/calendario.js';
import { podarAnexos } from '../../src/dominios/licitaciones/oferta/dossierPoda.js';
import { aliasDeRoles, funcionesDelRol } from '../../src/dominios/licitaciones/oferta/equipoDossier.js';

const doc = (paginas: string[], etiqueta = 'PPT') => ({
  ruta: 'Licitaciones/X/PPT.pdf',
  etiqueta,
  paginas: new Map(paginas.map((t, i) => [i + 1, t])),
});

test('should_classify_folder_documents_by_name_subfolder_and_header', () => {
  assert.equal(clasificarDocumento('Respuesta a dudas de la licitación 261001.pdf', ''), 'aclaracion');
  assert.equal(
    clasificarDocumento('Documento 3.pdf', 'Rectificación del anuncio de licitación'),
    'aclaracion',
    'por su cabecera',
  );
  assert.equal(
    clasificarDocumento('NORMATIVA INTERNA/Instrucción de respuesta a incidentes.pdf', ''),
    'normativa',
    'en la carpeta de normativa, todo es normativa',
  );
  assert.equal(clasificarDocumento('Q-AB-012 Gestión documental.pdf', ''), 'normativa', 'por su código');
  assert.equal(clasificarDocumento('Contrato del servicio rev2.docx', ''), 'contrato');
  assert.equal(clasificarDocumento('Sobre 2/Respuesta a dudas copia.pdf', ''), null, 'lo nuestro no');
  assert.equal(clasificarDocumento('PCAP-2026.pdf', ''), null, 'un año no es un código');
  assert.equal(clasificarDocumento('Acuerdo de confidencialidad.docx', ''), null);
});

test('should_date_documents_from_name_or_header', () => {
  assert.equal(
    fechaDeDocumento('Respuestas 260925.pdf', '', '2026-11-20T14:00:00'),
    '2026-09-25',
    'AAMMDD cerca del plazo',
  );
  assert.equal(
    fechaDeDocumento('Respuestas 250926.pdf', '', '2026-11-20'),
    '2026-09-25',
    'DDMMAA si es lo más cercano',
  );
  assert.equal(fechaDeDocumento('Aclaración 07.10.2026.pdf', '', '2026-11-20'), '2026-10-07');
  assert.equal(fechaDeDocumento('Aclaración.pdf', 'Respuestas de 3 de octubre de 2026', '2026-11-20'), '2026-10-03');
  assert.equal(fechaDeDocumento('Aclaración.pdf', 'Sin fecha', '2026-11-20'), null);
});

test('should_read_code_and_version_of_client_rules', () => {
  assert.deepEqual(codigoYVersion('Manual de compras.pdf', 'M-CO-004 Rv 07 Manual de compras'), {
    codigo: 'M-CO-004',
    version: '07',
  });
  assert.deepEqual(codigoYVersion('N-021 Norma de calidad (2).pdf', 'REVISION: 12 FECHA'), {
    codigo: 'N-021',
    version: '12',
  });
  assert.deepEqual(codigoYVersion('Contrato rev1.docx', ''), { codigo: null, version: '1' });
});

test('should_start_five_weeks_after_deadline_skipping_holidays_when_no_start_is_given', () => {
  const c = calendarioPrevisto({
    pcaps: [],
    hitos: [],
    periodoInicio: null,
    duracionPlacsp: { valor: 6, unidad: 'MON' },
    fechaLimite: '2026-11-03T14:00:00',
    sede: { ciudad: 'Toledo' },
  })!;
  assert.equal(c.inicio, '2026-12-08');
  assert.equal(c.laborable, '2026-12-09', 'la Inmaculada se salta');
  assert.equal(c.meses, 6);
  assert.equal(c.comunidad, 'Castilla-La Mancha');
  assert.deepEqual(
    c.festivos.map((f) => f.fecha),
    ['2026-12-25', '2027-01-01', '2027-01-06', '2027-03-25', '2027-03-26', '2027-05-31'],
    'solo los que caen entre semana, con Jueves Santo y el día de la comunidad',
  );
  const lineas = lineasCalendario(c).join('\n');
  assert.match(
    lineas,
    /- Inicio previsto: martes 08\/12\/2026 \(no lo fija el pliego ni la ficha: fecha límite \+ 5 semanas\); no es laborable: el primer día laborable es el miércoles 09\/12\/2026\./,
  );
  assert.match(lineas, /Duración: 6 meses \(plataforma\); 6 meses, hasta el martes 08\/06\/2027\./);
});

test('should_prefer_the_contract_start_milestone_of_the_ficha_over_the_deadline', () => {
  const c = calendarioPrevisto({
    pcaps: [],
    hitos: [
      { hito: 'Fin del plazo de presentación de ofertas', fecha: '2026-10-20' },
      { hito: 'Inicio de la ejecución del contrato', fecha: '2027-01-11' },
    ],
    periodoInicio: null,
    duracionPlacsp: null,
    fechaLimite: '2026-10-20',
    sede: {},
  })!;
  assert.equal(c.inicio, '2027-01-11');
  assert.match(c.fuente, /ficha, hito «Inicio de la ejecución del contrato»/);
  assert.equal(mesesDeTexto('Doce (12) meses prorrogables por un (1) año'), 12, 'la prórroga no es duración');
});

test('should_prune_only_annexes_the_pliego_declares_informative', () => {
  const largo = 'Capacidad futura de la plataforma. '.repeat(40);
  const p = doc([
    'ÍNDICE\nANEXO 1. 15\nANEXO 2. 16\nLas posibles fases futuras se describen en el Anexo 1 con carácter orientativo.',
    'Requisitos del servicio.',
    `ANEXO 1. Hoja de ruta\n${largo}`,
    `${largo}\nANEXO 2. Requisitos de seguridad\nCifrado obligatorio en tránsito.`,
  ]);
  const { doc: podado, podados } = podarAnexos(p);
  assert.deepEqual(podados, [{ titulo: 'ANEXO 1. Hoja de ruta', paginas: [3, 4] }]);
  assert.equal(
    podado.paginas.get(3),
    '[ANEXO 1. Hoja de ruta: anexo prospectivo o fuera del objeto del contrato; no va en el dossier: sigue en biblioteca_leer ruta=«Licitaciones/X/PPT.pdf», págs. 3-4]',
  );
  assert.equal(
    podado.paginas.get(4),
    'ANEXO 2. Requisitos de seguridad\nCifrado obligatorio en tránsito.',
    'el anexo que obliga se queda',
  );
  assert.ok(podado.paginas.get(1)!.includes('ANEXO 1. 15'), 'el índice no es el anexo');
  assert.deepEqual(podarAnexos(doc(['Sin anexos.'])).podados, []);
});

test('should_not_prune_the_body_when_the_index_or_a_body_line_starts_with_annex', () => {
  const futuro = 'Integración futura con otros sistemas. '.repeat(20);
  const indice = doc([
    'ÍNDICE\n1. Objeto\n2. Alcance\nANEXO 1. Inventario\nANEXO 2. Evolución futura',
    '1. Objeto\nRequisito obligatorio A: alta disponibilidad.',
    '2. Alcance\nRequisito obligatorio B. El Anexo 2 es prospectivo: recoge fases futuras.',
    'ANEXO 1. Inventario\nServidor de aplicaciones y base de datos.',
    `ANEXO 2. Evolución futura\n${futuro}`,
  ]);
  const a = podarAnexos(indice);
  assert.deepEqual(
    a.podados,
    [{ titulo: 'ANEXO 2. Evolución futura', paginas: [5] }],
    'solo el anexo real, no la entrada del índice',
  );
  assert.ok(
    a.doc.paginas.get(2)!.includes('Requisito obligatorio A') &&
      a.doc.paginas.get(3)!.includes('Requisito obligatorio B'),
    'el cuerpo se queda',
  );
  const partida = doc([
    '1. Objeto\nLas fases futuras se describen en el\nAnexo I, a título informativo.\n2. Requisitos obligatorios\nRequisito clave Z',
    `ANEXO I. Fases futuras\n${futuro}`,
    'ANEXO II. Seguridad\nCifrado obligatorio.',
  ]);
  const b = podarAnexos(partida);
  assert.deepEqual(b.podados, [{ titulo: 'ANEXO I. Fases futuras', paginas: [2, 3] }]);
  assert.ok(b.doc.paginas.get(1)!.includes('Requisito clave Z'), 'una frase partida no es el anexo');
});

test('should_keep_informative_annexes_that_size_the_solution', () => {
  const p = doc([
    'Requisitos. El Anexo 3 recoge, a título orientativo, el volumen anual de expedientes y los sistemas actuales.',
    'ANEXO 3. Volumetría\n12.000 expedientes al año en el gestor actual.',
  ]);
  const { doc: podado, podados } = podarAnexos(p);
  assert.deepEqual(podados, [], '«orientativo» no es «fuera de lo que se contrata»');
  assert.ok(podado.paginas.get(2)!.includes('12.000 expedientes'));
});

test('should_give_short_unique_aliases_and_pliego_functions_per_role', () => {
  assert.deepEqual(
    aliasDeRoles([
      'Responsable del servicio',
      'Primer técnico de sistemas',
      'Segundo técnico de sistemas',
      'Responsable del servicio',
      'Consultor',
    ]),
    ['RS', 'TS-1', 'TS-2', 'RS-2', 'CON'],
  );
  const pliego = doc([
    'Objeto del contrato.',
    'El responsable del servicio tendrá como funciones la coordinación con la entidad y la entrega de los informes mensuales. Otra frase.',
  ]);
  assert.equal(
    funcionesDelRol('Responsable del servicio', [pliego]),
    '«El responsable del servicio tendrá como funciones la coordinación con la entidad y la entrega de los informes mensuales.» [PPT p. 2]',
  );
  assert.equal(funcionesDelRol('Analista de datos', [pliego]), null);
});

test('should_not_add_extensions_or_equivalences_to_the_contract_length', () => {
  assert.equal(mesesDeTexto(': 12 meses, prorrogable por 12 meses más'), 12);
  assert.equal(mesesDeTexto(': 24 meses (2 años)'), 24);
  assert.equal(mesesDeTexto(': 2 años (24 meses)'), 24);
  assert.equal(mesesDeTexto(': 2 años, prorrogables 1 año'), 24);
  assert.equal(mesesDeTexto('Tres (3) meses de implantación + un (1) mes de soporte'), 4, 'las fases sí se suman');
  const c = calendarioPrevisto({
    pcaps: [doc(['Duración del contrato: 12 meses, prorrogable por 12 meses más'], 'PCAP')],
    hitos: [{ hito: 'Inicio del contrato', fecha: '2026-11-16' }],
    periodoInicio: null,
    duracionPlacsp: null,
    fechaLimite: null,
    sede: {},
  })!;
  assert.deepEqual([c.meses, c.fin], [12, '2027-11-15']);
});

test('should_find_the_planned_start_on_the_next_line_of_a_summary_table', () => {
  const pcap = doc(['CUADRO RESUMEN\nFecha prevista de inicio\n16/11/2026\nDuración del contrato: 12 meses'], 'PCAP');
  const c = calendarioPrevisto({
    pcaps: [pcap],
    hitos: [],
    periodoInicio: null,
    duracionPlacsp: null,
    fechaLimite: '2026-10-13',
    sede: {},
  })!;
  assert.equal(c.inicio, '2026-11-16');
  assert.match(c.fuente, /^\[PCAP p\. 1\] «fecha prevista de inicio 16\/11\/2026»$/);
});

test('should_end_on_the_last_day_of_the_month_when_the_start_day_does_not_exist_there', () => {
  const fin = (inicio: string, meses: number) =>
    calendarioPrevisto({
      pcaps: [],
      hitos: [{ hito: 'Inicio de la ejecución', fecha: inicio }],
      periodoInicio: null,
      duracionPlacsp: { valor: meses, unidad: 'MON' },
      fechaLimite: null,
      sede: {},
    })!.fin;
  assert.equal(fin('2026-08-31', 6), '2027-02-28');
  assert.equal(fin('2028-01-31', 1), '2028-02-29');
  assert.equal(fin('2026-11-16', 12), '2027-11-15');
});

test('should_only_take_as_clarifications_what_the_contracting_body_publishes', () => {
  for (const nombre of [
    'Plan de respuesta a incidentes.pdf',
    'Modelo de respuesta técnica.docx',
    'Preguntas para el órgano (borrador).docx',
    'Consultas preliminares al mercado.pdf',
  ]) {
    assert.equal(clasificarDocumento(nombre, 'Documento de trabajo.'), null, nombre);
  }
  for (const nombre of [
    'Nota informativa 2.pdf',
    'Comunicación a licitadores.pdf',
    'Modificación del pliego.pdf',
    'Respuestas a las consultas recibidas.pdf',
  ]) {
    assert.equal(clasificarDocumento(nombre, 'Órgano de contratación.'), 'aclaracion', nombre);
  }
  assert.equal(
    clasificarDocumento('Borrador de contrato.docx', ''),
    'contrato',
    'un borrador del cliente sigue siendo su contrato',
  );
});

test('should_not_read_a_file_number_as_a_date_decades_away', () => {
  assert.equal(fechaDeDocumento('Respuestas a dudas exp 000412.pdf', '', '2026-10-13'), null);
  assert.equal(
    fechaDeDocumento('Respuestas a dudas exp 000412.pdf', 'Respuestas de 2 de octubre de 2026', '2026-10-13'),
    '2026-10-02',
    'entonces vale la de la cabecera',
  );
});
