// Peticiones del DEUC (ESPDRequest, ESPD-EDM 1.0.2, como las que publica la PLACSP) inventadas para
// CASO_B y CASO_C: órgano, expediente y objeto ficticios y los criterios del modelo 1.0.2 con su
// código y su nombre. Lo que miran los tests: 24 motivos de exclusión en las dos, 40 criterios en la
// de CASO_C (con el volumen anual de negocios: cinco ejercicios «fecha, fecha, importe» que repiten
// los mismos ID de requisito) y 31 en la de CASO_B (solo «se cumplen todos los criterios de selección»),
// el lote 0 de la PLACSP y una referencia al anuncio.
import { createHash } from 'node:crypto';

type Requisito = [tipo: string, descripcion: string];
type Grupo = { requisitos: Requisito[]; siVerdadero?: Requisito[] };
type Criterio = { codigo: string; nombre: string; grupos: Grupo[] };

// ID con forma de UUID, estable para la misma semilla (no son los de la taxonomía de la UE).
function uuid(semilla: string): string {
  const h = createHash('sha256').update(semilla).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const SI_NO: Grupo = { requisitos: [['INDICATOR', 'Your answer?']] };
const DECLARA: Grupo = { requisitos: [['INDICATOR', 'Your answer?']], siVerdadero: [['DESCRIPTION', 'Please describe them']] };
const ELECTRONICO: Grupo = { requisitos: [['INDICATOR', 'Is this information available electronically?']], siVerdadero: [['EVIDENCE_URL', 'URL'], ['CODE', 'Code'], ['DESCRIPTION', 'Issuer']] };
const EJERCICIO: Grupo = { requisitos: [['DATE', 'Start Date'], ['DATE', 'End Date'], ['AMOUNT', 'Amount']] };

const EXCLUSION: [string, string][] = [
  ['CONVICTIONS.PARTICIPATION_IN_CRIMINAL_ORGANISATION', 'Participation in a criminal organisation'],
  ['CONVICTIONS.CORRUPTION', 'Corruption'],
  ['CONVICTIONS.FRAUD', 'Fraud'],
  ['CONVICTIONS.TERRORIST_OFFENCES', 'Terrorist offences or offences linked to terrorist activities'],
  ['CONVICTIONS.MONEY_LAUNDERING', 'Money laundering or terrorist financing'],
  ['CONVICTIONS.CHILD_LABOUR-HUMAN_TRAFFICKING', 'Child labour and other forms of trafficking in human beings'],
  ['CONTRIBUTIONS.PAYMENT_OF_TAXES', 'Payment of taxes'],
  ['CONTRIBUTIONS.PAYMENT_OF_SOCIAL_SECURITY', 'Payment of social security contributions'],
  ['SOCIAL.ENVIRONMENTAL_LAW', 'Breaching of obligations in the fields of environmental law'],
  ['SOCIAL.SOCIAL_LAW', 'Breaching of obligations in the fields of social law'],
  ['SOCIAL.LABOUR_LAW', 'Breaching of obligations in the fields of labour law'],
  ['BUSINESS.BANKRUPTCY', 'Bankruptcy'],
  ['BUSINESS.INSOLVENCY', 'Insolvency'],
  ['BUSINESS.CREDITORS_ARRANGEMENT', 'Arrangement with creditors'],
  ['BUSINESS.BANKRUPTCY_ANALOGOUS', 'Analogous situation like bankruptcy under national law'],
  ['BUSINESS.LIQUIDATOR_ADMINISTERED', 'Assets being administered by liquidator'],
  ['BUSINESS.ACTIVITIES_SUSPENDED', 'Business activities are suspended'],
  ['MISCONDUCT.MC_PROFESSIONAL', 'Guilty of grave professional misconduct'],
  ['MISCONDUCT.MARKET_DISTORTION', 'Agreements with other economic operators aimed at distorting competition'],
  ['CONFLICT_OF_INTEREST.PROCEDURE_PARTICIPATION', 'Conflict of interest due to its participation in the procurement procedure'],
  ['CONFLICT_OF_INTEREST.PROCEDURE_PREPARATION', 'Direct or indirect involvement in the preparation of this procurement procedure'],
  ['CONFLICT_OF_INTEREST.EARLY_TERMINATION', 'Early termination, damages or other comparable sanctions'],
  ['CONFLICT_OF_INTEREST.MISINTERPRETATION', 'Guilty of misrepresentation, withheld information, unable to provide required documents'],
  ['NATIONAL.OTHER', 'Purely national exclusion grounds'],
];
const SELECCION_CASO_C: Criterio[] = [
  { codigo: 'SELECTION.SUITABILITY.PROFESSIONAL_REGISTER_ENROLMENT', nombre: 'Enrolment in a relevant professional register', grupos: [DECLARA] },
  { codigo: 'SELECTION.SUITABILITY.TRADE_REGISTER_ENROLMENT', nombre: 'Enrolment in a trade register', grupos: [DECLARA] },
  { codigo: 'SELECTION.SUITABILITY.AUTHORISATION', nombre: 'For service contracts: authorisation of particular organisation needed', grupos: [DECLARA] },
  { codigo: 'SELECTION.ECONOMIC_FINANCIAL_STANDING.TURNOVER.GENERAL_YEARLY', nombre: 'General yearly turnover', grupos: [EJERCICIO, EJERCICIO, EJERCICIO, EJERCICIO, EJERCICIO, ELECTRONICO] },
  { codigo: 'SELECTION.ECONOMIC_FINANCIAL_STANDING.TURNOVER.SET_UP', nombre: 'Set up of economic operator', grupos: [{ requisitos: [['DESCRIPTION', 'Please specify']] }] },
  { codigo: 'SELECTION.ECONOMIC_FINANCIAL_STANDING.OTHER_REQUIREMENTS', nombre: 'Other economic or financial requirements', grupos: [{ requisitos: [['DESCRIPTION', 'Please describe them']] }, ELECTRONICO] },
  { codigo: 'SELECTION.TECHNICAL_PROFESSIONAL_ABILITY.REFERENCES.SERVICES_DELIVERY_PERFORMANCE', nombre: 'For service contracts: performance of services of the specified type', grupos: [{ requisitos: [['DESCRIPTION', 'Description'], ['AMOUNT', 'Amount'], ['DATE', 'Date'], ['DESCRIPTION', 'Recipients']] }] },
  { codigo: 'SELECTION.TECHNICAL_PROFESSIONAL_ABILITY.TECHNICAL.FACILITIES_FOR_QUALITY_ENSURING', nombre: 'Technical facilities and measures for ensuring quality', grupos: [{ requisitos: [['DESCRIPTION', 'Please describe them']] }] },
  { codigo: 'SELECTION.TECHNICAL_PROFESSIONAL_ABILITY.TECHNICAL.EQUIPMENT', nombre: 'Tools, plant or technical equipment', grupos: [{ requisitos: [['DESCRIPTION', 'Please describe them']] }] },
  { codigo: 'SELECTION.TECHNICAL_PROFESSIONAL_ABILITY.MANAGEMENT.SUBCONTRACTING_PROPORTION', nombre: 'Subcontracting proportion', grupos: [{ requisitos: [['DESCRIPTION', 'Please specify']] }] },
];
const SELECCION_CASO_B: Criterio[] = [{ codigo: 'SELECTION.ALL_SATISFIED', nombre: 'All selection criteria will be satisfied', grupos: [SI_NO] }];
const OTROS: Criterio[] = [
  { codigo: 'OTHER.EO_DATA.SHELTERED_WORKSHOP', nombre: 'Procurement reserved', grupos: [DECLARA] },
  { codigo: 'OTHER.EO_DATA.REGISTERED_IN_OFFICIAL_LIST', nombre: 'EO registered', grupos: [DECLARA] },
  { codigo: 'OTHER.EO_DATA.TOGETHER_WITH_OTHERS', nombre: 'EO participating in procurement procedure', grupos: [DECLARA] },
  { codigo: 'OTHER.EO_DATA.RELIES_ON_OTHER_CAPACITIES', nombre: 'EO relies on capacities of other entities', grupos: [SI_NO] },
  { codigo: 'OTHER.EO_DATA.SUBCONTRACTS_WITH_THIRD_PARTIES', nombre: 'Subcontracting third parties', grupos: [DECLARA] },
  { codigo: 'OTHER.EO_DATA.MEETS_THE_OBJECTIVE', nombre: 'Reduction of the number of qualified candidates', grupos: [SI_NO] },
];
const exclusiones = (): Criterio[] => EXCLUSION.map(([codigo, nombre]) => ({ codigo: `EXCLUSION.${codigo}`, nombre, grupos: [DECLARA] }));

const ATRIB_REQ = 'schemeID="CriterionRelatedIDs" schemeAgencyID="EU-COM-GROW" schemeVersionID="1.0"';
const ATRIB_GRUPO = 'schemeAgencyID="EU-COM-GROW" schemeVersionID="1.0"';

// El mismo requisito repetido en varios grupos (cada ejercicio del volumen) lleva el mismo ID.
const requisitoXml = (codigo: string, [tipo, descripcion]: Requisito, sangria: string) => [
  `${sangria}<ccv:Requirement responseDataType="${tipo}">`,
  `${sangria}    <cbc:ID ${ATRIB_REQ}>${uuid(`${codigo}:${tipo}:${descripcion}`)}</cbc:ID>`,
  `${sangria}    <cbc:Description>${descripcion}</cbc:Description>`,
  `${sangria}</ccv:Requirement>`,
];

function grupoXml(codigo: string, g: Grupo, n: number): string[] {
  const s = '        ';
  const dentro = g.siVerdadero ? [
    `${s}    <ccv:RequirementGroup pi="GROUP_FULFILLED.ON_TRUE">`,
    `${s}        <cbc:ID ${ATRIB_GRUPO}>${uuid(`${codigo}:grupo:${n}:si`)}</cbc:ID>`,
    ...g.siVerdadero.flatMap((r) => requisitoXml(codigo, r, `${s}        `)),
    `${s}    </ccv:RequirementGroup>`,
  ] : [];
  return [
    `${s}<ccv:RequirementGroup>`,
    `${s}    <cbc:ID ${ATRIB_GRUPO}>${uuid(`${codigo}:grupo:${n}`)}</cbc:ID>`,
    ...g.requisitos.flatMap((r) => requisitoXml(codigo, r, `${s}    `)),
    ...dentro,
    `${s}</ccv:RequirementGroup>`,
  ];
}

function criterioXml(c: Criterio): string {
  const codigo = `CRITERION.${c.codigo}`;
  return [
    '    <ccv:Criterion>',
    `        <cbc:ID schemeID="CriteriaID" schemeAgencyID="EU-COM-GROW" schemeVersionID="1.0">${uuid(codigo)}</cbc:ID>`,
    `        <cbc:TypeCode listID="CriteriaTypeCode" listAgencyID="EU-COM-GROW" listVersionID="1.0.2">${codigo}</cbc:TypeCode>`,
    `        <cbc:Name>${c.nombre}</cbc:Name>`,
    `        <cbc:Description>${c.nombre}.</cbc:Description>`,
    ...c.grupos.flatMap((g, n) => grupoXml(codigo, g, n)),
    '    </ccv:Criterion>',
  ].join('\n');
}

const NAMESPACES = [
  'espd-cbc="urn:grow:names:specification:ubl:schema:xsd:ESPD-CommonBasicComponents-1"',
  'espd-cac="urn:grow:names:specification:ubl:schema:xsd:ESPD-CommonAggregateComponents-1"',
  'cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"',
  'cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"',
  'espd="urn:grow:names:specification:ubl:schema:xsd:ESPDResponse-1"',
  'espd-req="urn:grow:names:specification:ubl:schema:xsd:ESPDRequest-1"',
  'ccv="urn:isa:names:specification:ubl:schema:xsd:CCV-CommonAggregateComponents-1"',
  'ccv-cbc="urn:isa:names:specification:ubl:schema:xsd:CCV-CommonBasicComponents-1"',
].map((ns) => ` xmlns:${ns}`).join('');

type Peticion = { expediente: string; organo: string; objeto: string; emitida: string; criterios: Criterio[] };

function peticionXml(p: Peticion): string {
  const [fecha, hora] = p.emitida.split('T');
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<espd-req:ESPDRequest${NAMESPACES}>`,
    '    <cbc:UBLVersionID schemeAgencyID="OASIS-UBL-TC">2.1</cbc:UBLVersionID>',
    '    <cbc:CustomizationID schemeName="CustomizationID" schemeAgencyID="BII" schemeVersionID="3.0">urn:www.cenbii.eu:transaction:biitrns070:ver3.0</cbc:CustomizationID>',
    `    <cbc:ID schemeID="ISO/IEC 9834-8:2008 - 4UUID" schemeAgencyID="EU-COM-GROW" schemeVersionID="1.1">${uuid(p.expediente)}</cbc:ID>`,
    '    <cbc:CopyIndicator>false</cbc:CopyIndicator>',
    '    <cbc:VersionID schemeAgencyID="EU-COM-GROW">1.0.2</cbc:VersionID>',
    `    <cbc:IssueDate>${fecha}</cbc:IssueDate>`,
    `    <cbc:IssueTime>${hora}</cbc:IssueTime>`,
    `    <cbc:ContractFolderID schemeAgencyID="TeD">${p.expediente}</cbc:ContractFolderID>`,
    '    <cac:ContractingParty>',
    '        <cac:Party>',
    `            <cac:PartyName><cbc:Name>${p.organo}</cbc:Name></cac:PartyName>`,
    '            <cac:PostalAddress><cac:Country><cbc:IdentificationCode listID="CountryCodeIdentifier" listAgencyID="EU-COM-GROW" listName="CountryCodeIdentifier" listVersionID="1.0.2">ES</cbc:IdentificationCode></cac:Country></cac:PostalAddress>',
    '            <cac:Contact/>',
    '        </cac:Party>',
    '    </cac:ContractingParty>',
    '    <cac:ProcurementProjectLot>',
    '        <cbc:ID schemeAgencyID="EU-COM-GROW">0</cbc:ID>',
    '    </cac:ProcurementProjectLot>',
    ...p.criterios.map(criterioXml),
    '    <cac:AdditionalDocumentReference>',
    '        <cbc:ID schemeID="COM-GROW-TEMPORARY-ID" schemeAgencyID="EU-COM-GROW" schemeVersionID="1.1">0000/S 000-000000</cbc:ID>',
    '        <cbc:DocumentTypeCode listID="ReferencesTypeCodes" listAgencyID="EU-COM-GROW" listVersionID="1.0">TED_CN</cbc:DocumentTypeCode>',
    `        <cac:Attachment><cac:ExternalReference><cbc:FileName>${p.objeto}</cbc:FileName><cbc:Description>${p.objeto}</cbc:Description></cac:ExternalReference></cac:Attachment>`,
    '    </cac:AdditionalDocumentReference>',
    '</espd-req:ESPDRequest>',
    '',
  ].join('\n');
}

/** «Deuc.xml» de CASO_C (Diputación Provincial de Villaejemplo, 2026/031): 40 criterios. */
export const peticionDeucCasoC = (): string => peticionXml({
  expediente: '2026/031', organo: 'DIPUTACIÓN PROVINCIAL DE VILLAEJEMPLO', emitida: '2026-09-21T10:05:00',
  objeto: 'SERVICIO, POR LOTES, DE IMPARTICIÓN DE CURSOS DE FORMACIÓN PARA EL EMPLEO DIRIGIDOS A MUJERES DE LA PROVINCIA DE VILLAEJEMPLO',
  criterios: [...exclusiones(), ...SELECCION_CASO_C, ...OTROS],
});

/** «espd-request.xml» de CASO_B (Ingeniería Pública de Ejemplo, S.A., EXP-2026-0517): 31 criterios. */
export const peticionDeucCasoB = (): string => peticionXml({
  expediente: 'EXP-2026-0517', organo: 'INGENIERÍA PÚBLICA DE EJEMPLO, S.A.', emitida: '2026-09-22T09:30:00',
  objeto: 'SERVICIO DE FORMACIÓN EN ANÁLISIS DE DATOS Y AUTOMATIZACIÓN DE PROCESOS PARA EL PERSONAL DE LA ENTIDAD',
  criterios: [...exclusiones(), ...SELECCION_CASO_B, ...OTROS],
});
