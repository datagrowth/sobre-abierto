// Cobertura de la ficha: la lista de temas, lo que la PLACSP publica sin detalle y las citas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  certificacionesOmitidas,
  coberturaDeFicha,
  type CoberturaTema,
} from '../../src/dominios/licitaciones/fichaCobertura.js';
import { TEMAS_CHECKLIST, temaDeRequisitoPlacsp } from '../../src/dominios/licitaciones/temas.js';
import type { Evaluacion } from '../../src/dominios/licitaciones/evaluador.js';

const completa = (enRequisitos: string[] = []): CoberturaTema[] =>
  TEMAS_CHECKLIST.map((tema) => ({
    tema,
    estado: enRequisitos.includes(tema) ? 'en_requisitos' : 'no_lo_pide',
    documento: 'PCAP.pdf',
    pagina: 3,
  }));
const requisito = (tipo: string, extra: Record<string, unknown> = {}) => ({
  tipo,
  descripcion: `Requisito de ${tipo}`,
  excluyente: false,
  cumple: 'dudoso',
  ...extra,
});
const placsp = (etiqueta: string, lote: string | null = null): Evaluacion => ({
  origen: 'placsp',
  clase: 'tecnica',
  etiqueta,
  descripcion: 'x',
  lote,
  exigido: null,
  resultado: 'desconocido',
  excluyente: true,
  motivo: '',
});

test('should_accept_a_complete_coverage', () => {
  const r = coberturaDeFicha(completa(['solvencia_economica']), [requisito('solvencia_economica')], []);
  assert.deepEqual(r.problemas, []);
  assert.equal(r.checklist_pct, 100);
});

test('should_list_the_topics_missing_from_the_coverage', () => {
  const r = coberturaDeFicha(
    completa().filter((c) => c.tema !== 'idioma' && c.tema !== 'seguro'),
    [],
    [],
  );
  assert.match(r.problemas[0] ?? '', /Falta en «cobertura»: «idioma», «seguro»/);
  assert.equal(coberturaDeFicha(undefined, [], []).checklist_pct, 0);
});

test('should_refuse_a_topic_said_to_be_in_the_requirements_without_any', () => {
  const r = coberturaDeFicha(completa(['medios_personales']), [], []);
  assert.match(r.problemas.join(' '), /en_requisitos para «medios_personales»/);
});

test('should_require_every_placsp_requirement_without_detail_to_be_read_from_the_pliego', () => {
  const pendientes = [placsp('Trabajos similares', '2'), placsp('Técnicos o unidades técnicas')];
  const sin = coberturaDeFicha(completa(), [], pendientes);
  assert.match(sin.problemas.join(' '), /«Trabajos similares» del lote 2/);
  assert.match(sin.problemas.join(' '), /«Técnicos o unidades técnicas».*medios personales/);
  assert.equal(sin.placsp_pct, 0);
  const con = coberturaDeFicha(
    completa(['solvencia_tecnica', 'medios_personales']),
    [requisito('experiencia', { lote: '2' }), requisito('medios_personales')],
    pendientes,
  );
  assert.deepEqual(con.problemas, []);
  assert.equal(con.placsp_pct, 100);
  assert.equal(
    coberturaDeFicha(
      completa(['solvencia_tecnica']),
      [requisito('experiencia', { lote: '1' })],
      [placsp('Trabajos similares', '2')],
    ).placsp_pct,
    0,
    'el del lote 1 no cubre el lote 2',
  );
});

test('should_require_quotes_for_exclusions_and_a_source_for_yes_or_no', () => {
  const r = coberturaDeFicha(
    completa(['solvencia_economica']),
    [requisito('solvencia_economica', { excluyente: true, cumple: 'si' })],
    [],
  );
  assert.match(r.problemas.join(' '), /excluyentes deben citar documento y página/);
  assert.match(r.problemas.join(' '), /di en «fuente»/);
});

test('should_map_placsp_labels_to_topics', () => {
  assert.equal(temaDeRequisitoPlacsp('Volumen anual de negocio'), 'solvencia_economica');
  assert.equal(temaDeRequisitoPlacsp('Subcontratación'), 'subcontratacion');
  assert.equal(temaDeRequisitoPlacsp('Capacidad de obrar'), null);
});

// Pasajes literales de licitaciones_pliegos (tema certificaciones). CASO_E (p-91000080): la nota de
// rectificación del 28/09 exige el ENS; CASO_D (p-91000880): el PCAP no pide ningún certificado.
const NOTA_CASO_E = {
  ruta: 'Licitaciones/p-91000080/Rectificación de errores materiales del pliego 27-09-2027 1032.pdf',
  clase: 'adicional',
  pagina: 1,
  texto:
    'Los licitadores deberán presentar, junto con la oferta técnica, la correspondiente Declaración de conformidad con el Esquema Nacional de Seguridad (ENS), categoría BÁSICA, como requisito exigible.',
};
const PCAP_CASO_D = [
  {
    ruta: 'Licitaciones/p-91000880/PCAP.pdf',
    clase: 'pcap',
    pagina: 5,
    texto:
      '4.3.- Solvencia Al tratarse de un Procedimiento Abierto Simplificado Abreviado, para ser adjudicatario del presente contrato de servicio no será necesaria la acreditación de la solvencia económica, financiera y técnica o profesional (artículo 159.6.b).',
  },
  {
    ruta: 'Licitaciones/p-91000880/PCAP.pdf',
    clase: 'pcap',
    pagina: 6,
    texto:
      '• Documentación acreditativa de la experiencia profesional mínima de tres (3) años exigida en el citado apartado, mediante certificados expedidos por las entidades para las que se hayan desarrollado los trabajos, contratos, certificados de servicios prestados, informes u otra documentación equivalente que permita comprobar el periodo y la naturaleza de los trabajos realizados.',
  },
];

test('should_reject_no_certifications_required_when_a_rectification_passage_demands_ens', () => {
  const sinCertificaciones = completa();

  const r = certificacionesOmitidas(sinCertificaciones, [PCAP_CASO_D[0]!, NOTA_CASO_E]);

  assert.match(
    r ?? '',
    /^La cobertura dice que el pliego no pide certificaciones, pero «Rectificación de errores materiales del pliego 27-09-2027 1032\.pdf» pág\. 1 dice: «Los licitadores deberán presentar.*Esquema Nacional de Seguridad \(ENS\), categoría BÁSICA, como requisito exigible\.»\. Añade el requisito o explica por qué no se exige\.$/,
  );
  assert.equal(
    certificacionesOmitidas(completa(['certificaciones']), [NOTA_CASO_E]),
    null,
    'con las certificaciones en los requisitos no hay nada que añadir',
  );
});

test('should_accept_no_certifications_required_when_the_passages_say_none_is_required', () => {
  const sinCertificaciones = completa();
  const exime = {
    ...PCAP_CASO_D[0]!,
    texto: 'No se exige certificación ISO 9001, ENS ni otra certificación empresarial específica.',
  };

  assert.equal(certificacionesOmitidas(sinCertificaciones, PCAP_CASO_D), null);
  assert.equal(
    certificacionesOmitidas(sinCertificaciones, [exime]),
    null,
    'una frase que dice que no se exige no pide nada',
  );
  assert.equal(certificacionesOmitidas(sinCertificaciones, []), null);
  assert.equal(certificacionesOmitidas(undefined, [NOTA_CASO_E]), null);
});
