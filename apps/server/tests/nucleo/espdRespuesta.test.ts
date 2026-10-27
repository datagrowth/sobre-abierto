// espd-response.xml desde la petición del DEUC: dos peticiones sintéticas como las de la PLACSP
// (Villaejemplo y el caso B, ESPDRequest 1.0.2) y una petición 2.x mínima con la estructura de la
// muestra oficial.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import { peticionDeucCasoB, peticionDeucCasoC } from '../licitaciones/fixtures/documentos/deuc.js';

const { respuestaEspd, DatosEspdEntrada } = await import('../../src/nucleo/documentos/espdRespuesta.js');
type DatosEspd = import('../../src/nucleo/documentos/espdRespuesta.js').DatosEspd;

const CASO_C = peticionDeucCasoC();
const CASO_B = peticionDeucCasoB();
const AHORA = new Date('2026-10-15T09:30:00Z');
const ID = '11111111-2222-4333-8444-555555555555';

const DATOS: DatosEspd = {
  operador: {
    nombre: 'Empresa Ejemplo, S.L.',
    nif: 'B00000000',
    domicilio: { calle: 'Calle Ejemplo 1', cp: '38000', municipio: 'Puerto de Ejemplo', pais: 'ES' },
    email: 'contacto@example.com',
    telefono: '900000000',
    pyme: true,
  },
  representante: { nombre: 'Persona A Apellido', nif: '00000000T', cargo: 'Administrador solidario' },
  lotes: ['3'],
  volumen_negocio: [
    { anio: 2024, importe: 150000 },
    { anio: 2025, importe: 180000 },
  ],
};
const SIN_DATOS: DatosEspd = { ...DATOS, operador: { ...DATOS.operador, pyme: null }, lotes: [], volumen_negocio: [] };

const CBC = 'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"';
const CAC = 'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"';
const propiedad = (id: string, tipo: string) =>
  `<cac:TenderingCriterionProperty><cbc:ID>${id}</cbc:ID><cbc:Description>q</cbc:Description><cbc:TypeCode>QUESTION</cbc:TypeCode><cbc:ValueDataTypeCode>${tipo}</cbc:ValueDataTypeCode></cac:TenderingCriterionProperty>`;
const criterio = (codigo: string, props: string) =>
  `<cac:TenderingCriterion><cbc:ID>c-${codigo}</cbc:ID><cbc:CriterionTypeCode>${codigo}</cbc:CriterionTypeCode><cbc:Name>${codigo}</cbc:Name><cac:TenderingCriterionPropertyGroup>${props}</cac:TenderingCriterionPropertyGroup></cac:TenderingCriterion>`;
const PETICION_V2 = `<?xml version="1.0" encoding="UTF-8"?>
<QualificationApplicationRequest xmlns="urn:oasis:names:specification:ubl:schema:xsd:QualificationApplicationRequest-2" ${CAC} ${CBC}>
  <cbc:UBLVersionID>2.2</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:www.cenbii.eu:transaction:biitrdm070:ver3.0</cbc:CustomizationID>
  <cbc:ID>peticion-1</cbc:ID>
  <cbc:ContractFolderID>EXP-1</cbc:ContractFolderID>
  <cbc:IssueDate>2026-09-01</cbc:IssueDate>
  <cbc:IssueTime>10:00:00</cbc:IssueTime>
  <cbc:VersionID>2.1.1</cbc:VersionID>
  <cac:ContractingParty><cac:Party><cac:PartyName><cbc:Name>Órgano</cbc:Name></cac:PartyName></cac:Party></cac:ContractingParty>
  <cac:ProcurementProject><cbc:Name>Servicio</cbc:Name></cac:ProcurementProject>
  <cac:ProcurementProjectLot><cbc:ID>1</cbc:ID></cac:ProcurementProjectLot>
  <cac:ProcurementProjectLot><cbc:ID>2</cbc:ID></cac:ProcurementProjectLot>
  ${criterio('CRITERION.EXCLUSION.CONVICTIONS.FRAUD', propiedad('p-fraude', 'INDICATOR'))}
  ${criterio('CRITERION.OTHER.EO_DATA.LOTS_TENDERED', propiedad('p-lotes', 'LOT_IDENTIFIER'))}
  ${criterio('CRITERION.SELECTION.ECONOMIC_FINANCIAL_STANDING.TURNOVER.GENERAL_YEARLY', propiedad('p-periodo', 'PERIOD') + propiedad('p-importe', 'AMOUNT') + propiedad('p-periodo', 'PERIOD') + propiedad('p-importe', 'AMOUNT') + propiedad('p-periodo', 'PERIOD') + propiedad('p-importe', 'AMOUNT'))}
  <cac:AdditionalDocumentReference><cbc:ID>doc</cbc:ID></cac:AdditionalDocumentReference>
</QualificationApplicationRequest>`;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: true,
});
const cuenta = (xml: string, re: RegExp) => (xml.match(re) ?? []).length;
const generar = (peticion: string, datos: DatosEspd = DATOS) => {
  const r = respuestaEspd(peticion, datos, AHORA, ID);
  assert.equal(r.error, null, r.error?.message);
  return r.data!;
};
// Criterio por su código, para mirar dentro (1.0.2: ccv:Criterion).
const criterioV1 = (xml: string, codigo: string) =>
  xml.split('<ccv:Criterion>').find((c) => c.includes(`>${codigo}<`)) ?? '';

test('should_turn_the_request_into_a_response_keeping_every_criterion_of_the_request', () => {
  const casos = [
    { peticion: CASO_C, criterios: 40, expediente: '2026/031' },
    { peticion: CASO_B, criterios: 31, expediente: 'EXP-2026-0517' },
  ];

  for (const { peticion, criterios, expediente } of casos) {
    const { xml } = generar(peticion);

    const doc = parser.parse(xml).ESPDResponse;
    assert.ok(doc, 'la raíz es ESPDResponse');
    assert.match(xml, /^<\?xml[^>]*\?>\s*<espd:ESPDResponse /);
    assert.equal(cuenta(peticion, /<ccv:Criterion>/g), criterios);
    assert.equal(cuenta(xml, /<ccv:Criterion>/g), criterios);
    assert.equal(doc.ContractFolderID['#text'], expediente);
    assert.equal(doc.ID['#text'], ID);
    assert.equal(doc.IssueDate, '2026-10-15');
    assert.equal(doc.IssueTime, '09:30:00');
    assert.match(xml, /biitrns092/);
    assert.ok(doc.ContractingParty.Party.PartyName.Name);
    assert.ok(doc.AdditionalDocumentReference);
  }

  const v2 = generar(PETICION_V2).xml;
  const raiz = parser.parse(v2).QualificationApplicationResponse;
  assert.match(
    v2,
    /<QualificationApplicationResponse xmlns="urn:oasis:names:specification:ubl:schema:xsd:QualificationApplicationResponse-2"/,
  );
  assert.equal(cuenta(v2, /<cac:TenderingCriterion>/g), 3);
  assert.equal(raiz.ID, ID);
  assert.equal(raiz.ProcurementProject.Name, 'Servicio');
  assert.match(v2, /biitrdm092/);
  assert.ok(v2.indexOf('<cac:EconomicOperatorParty>') < v2.indexOf('<cac:ProcurementProject>'));
  assert.ok(v2.lastIndexOf('</cac:TenderingCriterion>') < v2.indexOf('<cac:TenderingCriterionResponse>'));
  assert.ok(v2.lastIndexOf('<cac:TenderingCriterionResponse>') < v2.indexOf('<cac:AdditionalDocumentReference>'));
});

test('should_fill_the_economic_operator_and_representative_from_the_data', () => {
  const v1 = parser.parse(generar(CASO_C).xml).ESPDResponse.EconomicOperatorParty;
  const v2 = parser.parse(generar(PETICION_V2).xml).QualificationApplicationResponse.EconomicOperatorParty;

  for (const party of [v1.Party, v2.Party]) {
    assert.equal(party.PartyIdentification.ID['#text'] ?? party.PartyIdentification.ID, 'B00000000');
    assert.equal(party.PartyName.Name, 'Empresa Ejemplo, S.L.');
    assert.equal(party.PostalAddress.StreetName, 'Calle Ejemplo 1');
    assert.equal(party.PostalAddress.PostalZone, '38000');
    assert.equal(party.PostalAddress.Country.IdentificationCode['#text'], 'ES');
    assert.equal(party.Contact.ElectronicMail, 'contacto@example.com');
  }
  const personaV1 = v1.RepresentativeNaturalPerson.PowerOfAttorney.AgentParty.Person;
  assert.equal(v1.RepresentativeNaturalPerson.NaturalPersonRoleDescription, 'Administrador solidario');
  assert.deepEqual([personaV1.ID, personaV1.FirstName, personaV1.FamilyName], ['00000000T', 'Persona', 'A Apellido']);
  assert.equal(v2.Party.PowerOfAttorney.Description, 'Administrador solidario');
  assert.equal(v2.Party.PowerOfAttorney.AgentParty.Person.FirstName, 'Persona');
});

test('should_answer_lots_sme_and_turnover_only_when_the_data_has_them', () => {
  const VOLUMEN = 'CRITERION.SELECTION.ECONOMIC_FINANCIAL_STANDING.TURNOVER.GENERAL_YEARLY';
  const con = generar(CASO_C);
  const sin = generar(CASO_C, SIN_DATOS);

  const volumen = criterioV1(con.xml, VOLUMEN);
  assert.match(con.xml, /<espd-cbc:SMEIndicator>true<\/espd-cbc:SMEIndicator>/);
  assert.deepEqual(
    [...volumen.matchAll(/<cbc:Amount currencyID="EUR">(\d+)<\/cbc:Amount>/g)].map((m) => m[1]),
    ['180000', '150000'],
  );
  assert.match(volumen, /<cbc:Date>2025-01-01<\/cbc:Date><\/ccv:Response>/);
  assert.equal(cuenta(con.xml, /<ccv:Response>/g), 6);
  assert.equal(parser.parse(con.xml).ESPDResponse.ProcurementProjectLot.ID['#text'], '3');
  assert.ok(!con.sin_responder.some((s) => s.codigo === VOLUMEN));
  assert.equal(con.respondidos.length, 3);

  assert.doesNotMatch(sin.xml, /SMEIndicator|<ccv:Response>/);
  assert.equal(parser.parse(sin.xml).ESPDResponse.ProcurementProjectLot.ID['#text'], '0');
  assert.ok(sin.sin_responder.some((s) => s.codigo === VOLUMEN));
  assert.deepEqual(sin.respondidos, []);

  const v2 = generar(PETICION_V2);
  const raiz = parser.parse(v2.xml).QualificationApplicationResponse;
  assert.deepEqual(new Set(v2.respondidos), new Set(['p-lotes', 'p-periodo', 'p-importe']));
  assert.equal(raiz.ProcurementProjectLot.ID['#text'], '3');
  assert.match(v2.xml, /<cbc:IndustryClassificationCode [^>]*>SME</);
  assert.match(v2.xml, /<cbc:ResponseID schemeAgencyID="OGP">3<\/cbc:ResponseID>/);
  assert.equal(cuenta(v2.xml, /<cbc:ResponseAmount currencyID="EUR">/g), 2);
  const v2Sin = generar(PETICION_V2, SIN_DATOS);
  assert.doesNotMatch(v2Sin.xml, /TenderingCriterionResponse|IndustryClassificationCode/);
  assert.equal(cuenta(v2Sin.xml, /<cac:ProcurementProjectLot>/g), 2);
});

test('should_never_answer_exclusion_grounds_and_list_them_as_unanswered', () => {
  for (const peticion of [CASO_C, CASO_B]) {
    const { xml, sin_responder } = generar(peticion);

    const exclusiones = [...new Set(peticion.match(/CRITERION\.EXCLUSION\.[A-Z_.-]+/g))];
    assert.equal(exclusiones.length, 24);
    for (const codigo of exclusiones) {
      assert.ok(
        sin_responder.some((s) => s.codigo === codigo && s.nombre),
        codigo,
      );
      assert.doesNotMatch(criterioV1(xml, codigo), /<ccv:Response>/, codigo);
    }
  }
  const v2 = generar(PETICION_V2);
  assert.ok(v2.sin_responder.some((s) => s.codigo === 'CRITERION.EXCLUSION.CONVICTIONS.FRAUD'));
  assert.ok(!v2.respondidos.includes('p-fraude'));
});

test('should_escape_values_and_produce_xml_that_parses_again', () => {
  const nombre = `Ruiz & Hijos <S.L.> "uno" 'dos'`;
  const datos = { ...DATOS, operador: { ...DATOS.operador, nombre }, lotes: ['3 & 4'] };

  for (const peticion of [CASO_C, PETICION_V2]) {
    const { xml } = generar(peticion, datos);

    assert.match(xml, /Ruiz &amp; Hijos &lt;S\.L\.&gt; &quot;uno&quot; &apos;dos&apos;/);
    const doc = parser.parse(xml);
    const raiz = doc.ESPDResponse ?? doc.QualificationApplicationResponse;
    assert.equal(raiz.EconomicOperatorParty.Party.PartyName.Name, nombre);
  }
});

test('should_refuse_a_document_that_is_not_an_espd_request_with_a_clear_message', () => {
  const respuesta = generar(CASO_C).xml;
  const casos = [
    { xml: respuesta, codigo: 'no_soportado', mensaje: /ya es una respuesta/ },
    {
      xml: '<?xml version="1.0"?><Invoice><ID>1</ID></Invoice>',
      codigo: 'no_soportado',
      mensaje: /no es una petición del DEUC/,
    },
    {
      xml: '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><ESPDRequest>&e;</ESPDRequest>',
      codigo: 'invalid_input',
      mensaje: /DTD/,
    },
    { xml: '<ESPDRequest><sin-cerrar></ESPDRequest>', codigo: 'invalid_input', mensaje: /no es un XML válido/ },
    { xml: '', codigo: 'invalid_input', mensaje: /vacía/ },
  ];

  for (const { xml, codigo, mensaje } of casos) {
    const r = respuestaEspd(xml, DATOS, AHORA, ID);

    assert.equal(r.data, null);
    assert.equal(r.error?.code, codigo);
    assert.match(r.error!.message, mensaje);
  }
});

test('should_not_accept_any_price_field_in_the_data', () => {
  const conPrecio = [
    { ...DATOS, importe: 1000 },
    { ...DATOS, operador: { ...DATOS.operador, importe: 1000 } },
    { ...DATOS, lotes: [{ id: '3', importe: 1000 }] },
    { ...DATOS, precio: 1000 },
  ];

  for (const datos of conPrecio) {
    assert.equal(DatosEspdEntrada.safeParse(datos).success, false);
    assert.equal(respuestaEspd(CASO_C, datos as DatosEspd, AHORA, ID).error?.code, 'invalid_input');
  }
  assert.equal(DatosEspdEntrada.safeParse(DATOS).success, true);
});
