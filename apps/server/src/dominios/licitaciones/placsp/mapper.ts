// Una entrada CODICE (Atom de la PLACSP) → licitación con los datos que usa el radar.
import { XMLParser } from 'fast-xml-parser';
import { decodificarEntidades } from '../../../nucleo/entidades.js';
import { z } from 'zod';
import { fail, ok, type Result } from '../../../nucleo/result.js';
import { esUrlDePlataforma, idCorto, type FuenteId } from './fuentes.js';
import { PRESENTACION_LOTES } from './codigos.js';

// Órgano, importes, CPV, plazo, criterios, requisitos, pliegos, lotes (con la regla de presentación por lotes) y
// resultados. Todo se valida con zod antes de tocar la base de datos.
const LISTAS = new Set([
  'RequiredCommodityClassification',
  'ProcurementProjectLot',
  'TenderResult',
  'AwardingCriteria',
  'SpecificTendererRequirement',
  'TechnicalEvaluationCriteria',
  'FinancialEvaluationCriteria',
  'LegalDocumentReference',
  'TechnicalDocumentReference',
  'AdditionalDocumentReference',
  'PartyIdentification',
  'RequiredBusinessClassificationScheme',
  'ClassificationCategory',
  'RequiredFinancialGuarantee',
  'PersonalSituation',
  'ValidNoticeInfo',
  'AdditionalPublicationStatus',
  'AdditionalPublicationDocumentReference',
  'GeneralDocument',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => LISTAS.has(name),
});

const Num = z.number().finite().nonnegative().nullable();
const Txt = z.string().nullable();

const Criterio = z.object({ tipo: Txt, descripcion: z.string(), peso: Num, nota: Txt });
// umbral: ThresholdQuantity (euros, o personas en plantilla); lote: null si vale para todo el contrato.
const Requisito = z.object({
  clase: z.enum(['tecnica', 'financiera', 'declaracion', 'clasificacion', 'habilitacion']),
  codigo: Txt,
  descripcion: z.string(),
  umbral: Num,
  lote: Txt,
});
// tipo: GuaranteeTypeCode (1 provisional, 2 definitiva, 3 complementaria o especial).
const Garantia = z.object({ tipo: Txt, porcentaje: Num, importe: Num });
// otro: los «Otros documentos» de la PLACSP (GeneralDocument): memoria justificativa, notas
// aclaratorias o de rectificación, preguntas y respuestas… que también obligan al ofertar.
// anuncio: lo que adjunta cada anuncio publicado (ValidNoticeInfo), como el de licitación.
const Documento = z.object({
  clase: z.enum(['pcap', 'ppt', 'adicional', 'otro', 'anuncio']),
  nombre: z.string(),
  url: z.string(),
  hash: Txt,
});
// valor_estimado: el del lote (EstimatedOverallContractAmount), si lo publica; lo guardado antes no lo trae.
const Lote = z.object({
  id: z.string(),
  nombre: Txt,
  presupuesto_sin_iva: Num,
  valor_estimado: Num.optional(),
  cpvs: z.array(z.string()),
});
// codigo: PartPresentationCode (1 un solo lote, 2 todos, 3 uno o varios); maximo_lotes:
// MaximumLotPresentationQuantity; maximo_adjudicables: MaximumTendererAwardedLotsQuantity;
// combinacion: LotsCombinationContractingAuthorityRights (texto libre del órgano).
const Maximo = z.number().int().positive().nullable();
const Presentacion = z.object({
  codigo: z.enum(['1', '2', '3']).nullable(),
  maximo_lotes: Maximo,
  maximo_adjudicables: Maximo,
  combinacion: Txt,
});
// inicio: TenderResult/StartDate, el día que empieza el contrato adjudicado (si consta).
const Resultado = z.object({
  lote: Txt,
  codigo: Txt,
  fecha: Txt,
  ofertas: Num,
  oferta_min: Num,
  oferta_max: Num,
  adjudicatario_nif: Txt,
  adjudicatario_nombre: Txt,
  importe_sin_iva: Num,
  importe_con_iva: Num,
  pyme: z.boolean().nullable(),
  inicio: Txt,
});
// PlannedPeriod del contrato: inicio y fin previstos, cuando el órgano los publica.
const Periodo = z.object({ inicio: Txt, fin: Txt });

const Licitacion = z.object({
  id: z.string().min(3),
  atom_id: z.string().min(1),
  fuente: z.enum(['perfiles', 'agregadas']),
  expediente: z.string(),
  titulo: z.string().min(1),
  url: Txt,
  estado: z.string().min(2).max(5),
  actualizada_en: z.string().min(10),
  // superior: el órgano del que depende (ParentLocatedParty). En las agregadas, que no traen
  // NIF, distingue la «Junta de Gobierno Local» de un ayuntamiento de la de otro.
  organo: z.object({
    nombre: z.string(),
    nif: Txt,
    dir3: Txt,
    ciudad: Txt,
    cp: Txt.optional(),
    superior: Txt.optional(),
  }),
  tipo_contrato: Txt,
  procedimiento: Txt,
  presupuesto_sin_iva: Num,
  presupuesto_con_iva: Num,
  valor_estimado: Num,
  cpvs: z.array(z.string().regex(/^\d{8}$/)),
  nuts: Txt,
  lugar: Txt,
  duracion: z.object({ valor: z.number(), unidad: z.string() }).nullable(),
  periodo: Periodo.nullable(),
  // Primer anuncio de licitación (DOC_CN) publicado: desde ahí corre el plazo de presentación.
  publicada_en: Txt,
  fecha_limite: Txt,
  // Procedimientos en dos fases (restringido, negociado): antes de la oferta, la solicitud de
  // participación, con su propio plazo.
  fecha_solicitud: Txt.default(null),
  criterios: z.array(Criterio),
  requisitos: z.array(Requisito),
  garantias: z.array(Garantia),
  documentos: z.array(Documento),
  lotes: z.array(Lote),
  presentacion: Presentacion,
  resultados: z.array(Resultado),
});

export type LicitacionData = z.infer<typeof Licitacion>;
type Nodo = Record<string, unknown> | undefined;

function txt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return decodificarEntidades(v) || null;
  if (typeof v === 'object' && '#text' in (v as object)) return txt((v as Record<string, unknown>)['#text']);
  return null;
}

function num(v: unknown): number | null {
  const t = txt(v);
  const n = t === null ? Number.NaN : Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function nodo(v: unknown): Nodo {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

function lista(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object') : [];
}

function idPorEsquema(party: Nodo, esquema: string): string | null {
  const ident = lista(party?.['PartyIdentification'])
    .map((p) => nodo(p['ID']))
    .find((id) => id?.['@schemeName'] === esquema);
  return txt(ident);
}

function cpvsDe(proyecto: Nodo): string[] {
  const codigos = lista(proyecto?.['RequiredCommodityClassification']).map((c) => txt(c['ItemClassificationCode']));
  return [...new Set(codigos.filter((c): c is string => c !== null && /^\d{8}$/.test(c)))];
}

function organo(cfs: Nodo): LicitacionData['organo'] {
  const party = nodo(nodo(cfs?.['LocatedContractingParty'])?.['Party']);
  const nombre = txt(nodo(party?.['PartyName'])?.['Name']) ?? 'Órgano sin nombre';
  const direccion = nodo(party?.['PostalAddress']);
  const ciudad = txt(direccion?.['CityName']);
  const padre = nodo(nodo(cfs?.['LocatedContractingParty'])?.['ParentLocatedParty']);
  const superior = txt(nodo(padre?.['PartyName'])?.['Name']);
  return {
    nombre,
    nif: idPorEsquema(party, 'NIF'),
    dir3: idPorEsquema(party, 'DIR3'),
    ciudad,
    cp: txt(direccion?.['PostalZone']),
    superior,
  };
}

function criterios(terms: Nodo): LicitacionData['criterios'] {
  return lista(nodo(terms?.['AwardingTerms'])?.['AwardingCriteria']).map((c) => ({
    tipo: txt(c['AwardingCriteriaTypeCode']),
    descripcion: txt(c['Description']) ?? '(sin descripción)',
    peso: num(c['WeightNumeric']),
    nota: txt(c['Note']),
  }));
}

type Req = LicitacionData['requisitos'][number];

function requisitosDe(q: Nodo, lote: string | null): Req[] {
  const de = (clave: string, clase: Req['clase'], codigo: string): Req[] =>
    lista(q?.[clave]).map((r) => ({
      clase,
      codigo: txt(r[codigo]),
      descripcion: txt(r['Description']) ?? txt(r[codigo]) ?? '(sin descripción)',
      umbral: num(r['ThresholdQuantity']),
      lote,
    }));
  const clasificacion = lista(q?.['RequiredBusinessClassificationScheme'])
    .flatMap((s) => lista(s['ClassificationCategory']))
    .map((c): Req => ({
      clase: 'clasificacion',
      codigo: txt(c['CodeValue']),
      descripcion: txt(c['Description']) ?? txt(c['CodeValue']) ?? 'Clasificación',
      umbral: null,
      lote,
    }));
  const habilitacion = (Array.isArray(q?.['PersonalSituation']) ? q['PersonalSituation'] : [])
    .map(txt)
    .filter((t): t is string => t !== null)
    .map((t): Req => ({ clase: 'habilitacion', codigo: null, descripcion: t, umbral: null, lote }));
  return [
    ...clasificacion,
    ...de('FinancialEvaluationCriteria', 'financiera', 'EvaluationCriteriaTypeCode'),
    ...de('TechnicalEvaluationCriteria', 'tecnica', 'EvaluationCriteriaTypeCode'),
    ...habilitacion,
    ...de('SpecificTendererRequirement', 'declaracion', 'RequirementTypeCode'),
  ];
}

// Los del contrato y, en contratos por lotes, los que cada lote fija aparte.
function requisitos(cfs: Nodo): Req[] {
  const generales = requisitosDe(nodo(nodo(cfs?.['TenderingTerms'])?.['TendererQualificationRequest']), null);
  const porLote = lista(cfs?.['ProcurementProjectLot']).flatMap((l) =>
    requisitosDe(nodo(nodo(l['TenderingTerms'])?.['TendererQualificationRequest']), txt(l['ID'])),
  );
  return [...generales, ...porLote];
}

// Una garantía a 0 € y sin porcentaje es la forma de la PLACSP de decir que no se pide.
function garantias(terms: Nodo): LicitacionData['garantias'] {
  return lista(terms?.['RequiredFinancialGuarantee'])
    .map((g) => ({
      tipo: txt(g['GuaranteeTypeCode']),
      porcentaje: num(g['AmountRate']),
      importe: num(g['LiabilityAmount']),
    }))
    .filter((g) => (g.porcentaje ?? 0) > 0 || (g.importe ?? 0) > 0);
}

/**
 * Versión de lo que el mapper saca de cada entrada (se guarda en `datos.mapper`). 2: los «Otros
 * documentos» (GeneralDocument) y los adjuntos de los anuncios. Lo guardado con una versión
 * anterior no los tiene hasta que la PLACSP vuelve a publicar la entrada o se recarga el
 * histórico: la completitud de los pliegos no lo da por comprobado.
 */
export const VERSION_MAPPER = 2;

type Doc = LicitacionData['documentos'][number];
const referencia = (d: Nodo) => nodo(nodo(d?.['Attachment'])?.['ExternalReference']);

// Sus nombres van en FileName («Memoria justificativa», «Anexo III (…docx)»): el ID es un código.
function otrosDocumentos(cfs: Nodo): Doc[] {
  return lista(cfs?.['GeneralDocument'])
    .map((g) => nodo(g['GeneralDocumentDocumentReference']))
    .map((d) => {
      const ref = referencia(d);
      return {
        clase: 'otro' as const,
        nombre: txt(ref?.['FileName']) ?? txt(d?.['ID']) ?? 'Otro documento',
        url: txt(ref?.['URI']) ?? '',
        hash: null,
      };
    });
}

// Solo lo que aloja la PLACSP: el mismo anuncio en otro medio (DOUE, BOE) no es otro documento.
function documentosDeAnuncios(cfs: Nodo): Doc[] {
  return lista(cfs?.['ValidNoticeInfo'])
    .flatMap((v) => lista(v['AdditionalPublicationStatus']))
    .flatMap((s) => lista(s['AdditionalPublicationDocumentReference']))
    .map((d) => {
      const ref = referencia(d);
      const tipo = txt(nodo(d['DocumentTypeCode'])?.['@name']);
      return {
        clase: 'anuncio' as const,
        nombre: txt(ref?.['FileName']) ?? tipo ?? 'Anuncio',
        url: txt(ref?.['URI']) ?? '',
        hash: null,
      };
    })
    .filter((d) => esUrlDePlataforma(d.url));
}

// Un mismo archivo puede ir en dos sitios (las bases como PCAP y como PPT): cuenta una vez.
function documentos(cfs: Nodo): LicitacionData['documentos'] {
  const de = (clave: string, clase: Doc['clase']): Doc[] =>
    lista(cfs?.[clave]).map((d) => {
      const ref = referencia(d);
      return {
        clase,
        nombre: txt(d['ID']) ?? clase.toUpperCase(),
        url: txt(ref?.['URI']) ?? '',
        hash: txt(ref?.['DocumentHash']),
      };
    });
  const todos = [
    ...de('LegalDocumentReference', 'pcap'),
    ...de('TechnicalDocumentReference', 'ppt'),
    ...de('AdditionalDocumentReference', 'adicional'),
    ...otrosDocumentos(cfs),
    ...documentosDeAnuncios(cfs),
  ].filter((d) => d.url);
  return todos.filter((d, i) => todos.findIndex((x) => x.url === d.url) === i);
}

function lotes(cfs: Nodo): LicitacionData['lotes'] {
  return lista(cfs?.['ProcurementProjectLot']).map((l) => {
    const proyecto = nodo(l['ProcurementProject']);
    const presupuesto = nodo(proyecto?.['BudgetAmount']);
    return {
      id: txt(l['ID']) ?? '?',
      nombre: txt(proyecto?.['Name']),
      presupuesto_sin_iva: num(presupuesto?.['TaxExclusiveAmount']),
      valor_estimado: num(presupuesto?.['EstimatedOverallContractAmount']),
      cpvs: cpvsDe(proyecto),
    };
  });
}

function entero(v: unknown): number | null {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

// Un código fuera de la lista oficial cuenta como no publicado: no tumba la entrada
// (Object.hasOwn y no `in`, que también ve «toString» o «constructor» del prototipo).
function presentacion(proceso: Nodo): LicitacionData['presentacion'] {
  const codigo = txt(proceso?.['PartPresentationCode']);
  return {
    codigo: codigo !== null && Object.hasOwn(PRESENTACION_LOTES, codigo) ? (codigo as '1' | '2' | '3') : null,
    maximo_lotes: entero(proceso?.['MaximumLotPresentationQuantity']),
    maximo_adjudicables: entero(proceso?.['MaximumTendererAwardedLotsQuantity']),
    combinacion: txt(proceso?.['LotsCombinationContractingAuthorityRights'])?.slice(0, 1000) ?? null,
  };
}

function resultados(cfs: Nodo): LicitacionData['resultados'] {
  return lista(cfs?.['TenderResult']).map((r) => {
    const ganador = nodo(r['WinningParty']);
    const proyecto = nodo(r['AwardedTenderedProject']);
    const total = nodo(proyecto?.['LegalMonetaryTotal']);
    const pyme = txt(r['SMEAwardedIndicator']);
    return {
      lote: txt(proyecto?.['ProcurementProjectLotID']),
      codigo: txt(r['ResultCode']),
      fecha: txt(r['AwardDate']),
      ofertas: num(r['ReceivedTenderQuantity']),
      oferta_min: num(r['LowerTenderAmount']),
      oferta_max: num(r['HigherTenderAmount']),
      adjudicatario_nif: idPorEsquema(ganador, 'NIF'),
      adjudicatario_nombre: txt(nodo(ganador?.['PartyName'])?.['Name']),
      importe_sin_iva: num(total?.['TaxExclusiveAmount']),
      importe_con_iva: num(total?.['PayableAmount']),
      pyme: pyme === null ? null : pyme === 'true',
      inicio: fecha(r['StartDate']),
    };
  });
}

function fecha(v: unknown): string | null {
  const t = txt(v);
  return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

function periodo(proyecto: Nodo): LicitacionData['periodo'] {
  const p = nodo(proyecto?.['PlannedPeriod']);
  const inicio = fecha(p?.['StartDate']);
  const fin = fecha(p?.['EndDate']);
  return inicio || fin ? { inicio, fin } : null;
}

// El anuncio de licitación (DOC_CN) puede publicarse en varios medios (perfil, DOUE, BOE):
// cuenta el primero, que es cuando los licitadores pudieron conocerla.
function publicadaEn(cfs: Nodo): string | null {
  const fechas = lista(cfs?.['ValidNoticeInfo'])
    .filter((v) => txt(v['NoticeTypeCode']) === 'DOC_CN')
    .flatMap((v) => lista(v['AdditionalPublicationStatus']))
    .flatMap((s) => lista(s['AdditionalPublicationDocumentReference']))
    .map((d) => fecha(d['IssueDate']))
    .filter((f): f is string => f !== null)
    .sort();
  return fechas[0] ?? null;
}

function plazo(proceso: Nodo, campo = 'TenderSubmissionDeadlinePeriod'): string | null {
  const periodo = nodo(proceso?.[campo]);
  const fecha = txt(periodo?.['EndDate']);
  if (!fecha || !/^\d{4}-\d{2}-\d{2}/.test(fecha)) return null;
  const hora = txt(periodo?.['EndTime']);
  return hora && /^\d{2}:\d{2}/.test(hora)
    ? `${fecha.slice(0, 10)}T${hora.slice(0, 8)}`
    : `${fecha.slice(0, 10)}T23:59:59`;
}

function duracion(proyecto: Nodo): LicitacionData['duracion'] {
  const medida = nodo(nodo(proyecto?.['PlannedPeriod'])?.['DurationMeasure']);
  const valor = num(medida);
  const unidad = typeof medida?.['@unitCode'] === 'string' ? medida['@unitCode'] : null;
  return valor !== null && unidad ? { valor, unidad } : null;
}

function construir(fuente: FuenteId, entry: Record<string, unknown>): unknown {
  const cfs = nodo(entry['ContractFolderStatus']);
  const proyecto = nodo(cfs?.['ProcurementProject']);
  const presupuesto = nodo(proyecto?.['BudgetAmount']);
  const lugar = nodo(proyecto?.['RealizedLocation']);
  const atomId = txt(entry['id']) ?? '';
  const href = nodo(entry['link'])?.['@href'];
  return {
    id: idCorto(fuente, atomId),
    atom_id: atomId,
    fuente,
    expediente: txt(cfs?.['ContractFolderID']) ?? '',
    titulo: txt(proyecto?.['Name']) ?? txt(entry['title']) ?? '(sin título)',
    url: typeof href === 'string' ? href : null,
    estado: txt(cfs?.['ContractFolderStatusCode']) ?? '?',
    actualizada_en: txt(entry['updated']) ?? '',
    organo: organo(cfs),
    tipo_contrato: txt(proyecto?.['TypeCode']),
    procedimiento: txt(nodo(cfs?.['TenderingProcess'])?.['ProcedureCode']),
    presupuesto_sin_iva: num(presupuesto?.['TaxExclusiveAmount']),
    presupuesto_con_iva: num(presupuesto?.['TotalAmount']),
    valor_estimado: num(presupuesto?.['EstimatedOverallContractAmount']),
    cpvs: cpvsDe(proyecto),
    nuts: txt(lugar?.['CountrySubentityCode']),
    lugar: txt(lugar?.['CountrySubentity']),
    duracion: duracion(proyecto),
    periodo: periodo(proyecto),
    publicada_en: publicadaEn(cfs),
    fecha_limite: plazo(nodo(cfs?.['TenderingProcess'])),
    fecha_solicitud: plazo(nodo(cfs?.['TenderingProcess']), 'ParticipationRequestReceptionPeriod'),
    criterios: criterios(nodo(cfs?.['TenderingTerms'])),
    requisitos: requisitos(cfs),
    garantias: garantias(nodo(cfs?.['TenderingTerms'])),
    documentos: documentos(cfs),
    lotes: lotes(cfs),
    presentacion: presentacion(nodo(cfs?.['TenderingProcess'])),
    resultados: resultados(cfs),
  };
}

/** Parsea y valida una entrada. Nunca lanza: una entrada rara no para la ingesta. */
export function mapearEntrada(fuente: FuenteId, xml: string): Result<LicitacionData> {
  try {
    const entry = nodo(nodo(parser.parse(xml))?.['entry']);
    if (!entry) return fail('entrada_vacia', 'La entrada no tiene contenido.');
    const parsed = Licitacion.safeParse(construir(fuente, entry));
    if (!parsed.success) return fail('entrada_invalida', z.prettifyError(parsed.error).slice(0, 500));
    return ok(parsed.data);
  } catch (err) {
    return fail('entrada_ilegible', err instanceof Error ? err.message : String(err));
  }
}
