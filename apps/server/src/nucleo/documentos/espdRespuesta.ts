// espd-response.xml prellenado a partir de la petición del DEUC del órgano, para importarlo en el servicio DEUC.
import { createHash } from 'node:crypto';
import { XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { decodificarEntidades } from '../entidades.js';
import { fail, ok, type Result } from '../result.js';

// Se transforma el texto, no un
// árbol: así se conservan los prefijos, los namespaces y cada criterio tal como los generó el
// órgano, que es lo que el servicio compara al importar.
// Dos modelos: la PLACSP publica todavía ESPDRequest (ESPD-EDM 1.0.2, criterios ccv:Criterion,
// las respuestas van dentro de cada ccv:Requirement) y el modelo 2.x usa
// QualificationApplicationRequest (las respuestas van aparte, en TenderingCriterionResponse).
// Los motivos de exclusión no se responden nunca: los declara una persona.
// Nada de precio: el DEUC va en el sobre A y un importe ofertado ahí excluye la oferta.

// Se importa en vez de teclearlo.
const Texto = (max: number) => z.string().trim().min(1).max(max);

export const DatosEspdEntrada = z.strictObject({
  operador: z.strictObject({
    nombre: Texto(300),
    nif: Texto(20),
    domicilio: z
      .strictObject({
        calle: Texto(300),
        cp: Texto(10).nullable(),
        municipio: Texto(200).nullable(),
        pais: z.literal('ES'),
      })
      .nullable(),
    email: z.email().max(200).nullable(),
    telefono: Texto(40).nullable(),
    pyme: z.boolean().nullable(),
  }),
  representante: z
    .strictObject({ nombre: Texto(200), nif: Texto(20).nullable(), cargo: Texto(200).nullable() })
    .nullable(),
  lotes: z.array(Texto(40)).max(200),
  volumen_negocio: z
    .array(
      z.strictObject({
        anio: z.number().int().min(1900).max(2200),
        importe: z.number().finite().nonnegative(),
      }),
    )
    .max(20),
});
export type DatosEspd = z.infer<typeof DatosEspdEntrada>;

export type RespuestaEspd = { xml: string; respondidos: string[]; sin_responder: { codigo: string; nombre: string }[] };

const MAX_PETICION = 20 * 1024 * 1024;
const NS = {
  cbc: 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
  cac: 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  espdCbc: 'urn:grow:names:specification:ubl:schema:xsd:ESPD-CommonBasicComponents-1',
  espdCac: 'urn:grow:names:specification:ubl:schema:xsd:ESPD-CommonAggregateComponents-1',
  ccv: 'urn:isa:names:specification:ubl:schema:xsd:CCV-CommonAggregateComponents-1',
};
const MODELOS = {
  ESPDRequest: {
    v: 1,
    respuesta: 'ESPDResponse',
    criterio: 'Criterion',
    tipo: 'TypeCode',
    ns: 'urn:grow:names:specification:ubl:schema:xsd:ESPDRequest-1',
    nsRespuesta: 'urn:grow:names:specification:ubl:schema:xsd:ESPDResponse-1',
  },
  QualificationApplicationRequest: {
    v: 2,
    respuesta: 'QualificationApplicationResponse',
    criterio: 'TenderingCriterion',
    tipo: 'CriterionTypeCode',
    ns: 'urn:oasis:names:specification:ubl:schema:xsd:QualificationApplicationRequest-2',
    nsRespuesta: 'urn:oasis:names:specification:ubl:schema:xsd:QualificationApplicationResponse-2',
  },
} as const;
type Modelo = (typeof MODELOS)[keyof typeof MODELOS];
const VOLUMEN = 'CRITERION.SELECTION.ECONOMIC_FINANCIAL_STANDING.TURNOVER.GENERAL_YEARLY';
const LOTES = 'CRITERION.OTHER.EO_DATA.LOTS_TENDERED';

// ── Lectura del XML como texto ─────────────────────────────────────────────────────────────

type Elemento = { nombre: string; local: string; ini: number; finApertura: number; fin: number };
type Marca = { tipo: 'abre' | 'cierra' | 'vacia' | 'otro'; nombre: string; fin: number };

const ETIQUETA = /<(\/?)([^\s/>!?]+)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/y;
const OTRAS: [string, string][] = [
  ['<!--', '-->'],
  ['<![CDATA[', ']]>'],
  ['<?', '?>'],
  ['<!', '>'],
];
const localDe = (nombre: string): string => nombre.slice(nombre.indexOf(':') + 1);

function leerMarca(xml: string, lt: number): Marca {
  for (const [abre, cierra] of OTRAS) {
    if (xml.startsWith(abre, lt)) {
      const fin = xml.indexOf(cierra, lt + abre.length);
      return { tipo: 'otro', nombre: '', fin: fin < 0 ? xml.length : fin + cierra.length };
    }
  }
  ETIQUETA.lastIndex = lt;
  const m = ETIQUETA.exec(xml);
  if (!m) return { tipo: 'otro', nombre: '', fin: lt + 1 };
  const tipo = m[1] ? 'cierra' : m[3] ? 'vacia' : 'abre';
  return { tipo, nombre: m[2]!, fin: lt + m[0].length };
}

// Hijos directos entre dos posiciones: los comentarios, las instrucciones y el CDATA no cuentan.
function hijosDirectos(xml: string, desde: number, hasta: number): Elemento[] {
  const hijos: Elemento[] = [];
  let prof = 0;
  let actual: Elemento | null = null;
  for (let lt = xml.indexOf('<', desde); lt >= 0 && lt < hasta;) {
    const marca = leerMarca(xml, lt);
    if (prof === 0 && marca.tipo !== 'cierra' && marca.tipo !== 'otro') {
      actual = { nombre: marca.nombre, local: localDe(marca.nombre), ini: lt, finApertura: marca.fin, fin: marca.fin };
    }
    if (marca.tipo === 'abre') prof++;
    if (marca.tipo === 'cierra') prof--;
    const cerrado = prof === 0 && actual !== null && (marca.tipo === 'cierra' || marca.tipo === 'vacia');
    if (cerrado) {
      hijos.push({ ...actual!, fin: marca.fin });
      actual = null;
    }
    lt = xml.indexOf('<', marca.fin);
  }
  return hijos;
}

// Texto del primer elemento con ese nombre local; en un criterio, su código y su nombre van antes que todo lo demás.
function primero(xml: string, local: string): string {
  const m = new RegExp(`<((?:[\\w.-]+:)?)${local}\\b[^>]*>([\\s\\S]*?)</\\1${local}>`).exec(xml);
  return m ? decodificarEntidades(m[2]!.replace(/<[^>]*>/g, '')).trim() : '';
}

function prefijosDe(apertura: string): Map<string, string> {
  const ns = new Map<string, string>();
  for (const m of apertura.matchAll(/\sxmlns(?::([\w.-]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const uri = m[2] ?? m[3] ?? '';
    if (!ns.has(uri)) ns.set(uri, m[1] ?? '');
  }
  return ns;
}

// ── Escritura ─────────────────────────────────────────────────────────────────────────────

const escapar = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

type Ctx = { modelo: Modelo; ns: Map<string, string>; nuevos: string[]; id: string; ahora: Date; version: string };

// Prefijo de un namespace en la petición; si no lo declara, se declara en la raíz con el habitual.
function pfx(ctx: Ctx, uri: string, preferido: string): string {
  const actual = ctx.ns.get(uri);
  if (actual !== undefined) return actual ? `${actual}:` : '';
  const usados = new Set(ctx.ns.values());
  let nombre = preferido;
  for (let n = 2; usados.has(nombre); n++) nombre = `${preferido}${n}`;
  ctx.ns.set(uri, nombre);
  ctx.nuevos.push(` xmlns:${nombre}="${uri}"`);
  return `${nombre}:`;
}

const el = (nombre: string, contenido: string, attrs = ''): string => `<${nombre}${attrs}>${contenido}</${nombre}>`;
const txt = (nombre: string, valor: string | null, attrs = ''): string =>
  valor ? el(nombre, escapar(valor), attrs) : '';
const cbc = (ctx: Ctx, local: string, valor: string | null, attrs = ''): string =>
  txt(`${pfx(ctx, NS.cbc, 'cbc')}${local}`, valor, attrs);
const cac = (ctx: Ctx, local: string, contenido: string): string =>
  contenido ? el(`${pfx(ctx, NS.cac, 'cac')}${local}`, contenido) : '';

function uuidDe(semilla: string): string {
  const h = createHash('sha256').update(semilla).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${'89ab'[Number.parseInt(h[16]!, 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ── Cabecera, raíz y operador ─────────────────────────────────────────────────────────────

function conTexto(xml: string, texto: string): string {
  const abre = xml.indexOf('>') + 1;
  if (xml[abre - 2] === '/')
    return `${xml.slice(0, abre - 2)}>${escapar(texto)}</${xml.slice(1, xml.search(/[\s/>]/))}>`;
  return `${xml.slice(0, abre)}${escapar(texto)}${xml.slice(xml.lastIndexOf('</'))}`;
}

function cabecera(xml: string, local: string, ctx: Ctx): string {
  const iso = ctx.ahora.toISOString();
  if (local === 'ID' || local === 'UUID') return conTexto(xml, ctx.id);
  if (local === 'IssueDate') return conTexto(xml, iso.slice(0, 10));
  if (local === 'IssueTime') return conTexto(xml, iso.slice(11, 19));
  // Perfil CEN BII: 070 es la petición y 092 la respuesta, en los dos modelos.
  if (local === 'CustomizationID') return xml.replace(/(biitr(?:ns|dm))070/, '$1092');
  return xml;
}

function raizRespuesta(apertura: string, raiz: Elemento, ctx: Ctx): { abre: string; cierra: string } {
  const { modelo } = ctx;
  let abre = apertura;
  let prefijo = ctx.ns.get(modelo.nsRespuesta);
  if (prefijo === undefined) {
    prefijo = raiz.nombre.includes(':') ? raiz.nombre.slice(0, raiz.nombre.indexOf(':')) : '';
    const decl = new RegExp(
      `(\\sxmlns${prefijo ? `:${prefijo}` : ''}\\s*=\\s*["'])${modelo.ns.replace(/[.]/g, '\\.')}(["'])`,
    );
    abre = abre.replace(decl, `$1${modelo.nsRespuesta}$2`);
  }
  const nombre = prefijo ? `${prefijo}:${modelo.respuesta}` : modelo.respuesta;
  abre = `<${nombre}${abre.slice(1 + raiz.nombre.length, abre.length - 1)}${ctx.nuevos.join('')}>`;
  return { abre, cierra: `</${nombre}>` };
}

function pais(ctx: Ctx): string {
  const lista =
    ctx.modelo.v === 1
      ? 'listAgencyID="EU-COM-GROW" listName="CountryCodeIdentifier" listVersionID="1.0.2"'
      : 'listAgencyID="ISO" listName="CountryCodeIdentifier" listVersionID="1.0"';
  return cac(ctx, 'Country', cbc(ctx, 'IdentificationCode', 'ES', ` listID="CountryCodeIdentifier" ${lista}`));
}

function apoderado(ctx: Ctx, rep: NonNullable<DatosEspd['representante']>, conCargo: boolean): string {
  const [nombre, ...apellidos] = rep.nombre.split(/\s+/);
  const persona =
    cbc(ctx, 'ID', rep.nif) +
    cbc(ctx, 'FirstName', nombre ?? null) +
    cbc(ctx, 'FamilyName', apellidos.join(' ') || null);
  const descripcion = conCargo ? cbc(ctx, 'Description', rep.cargo) : '';
  return cac(ctx, 'PowerOfAttorney', descripcion + cac(ctx, 'AgentParty', cac(ctx, 'Person', persona)));
}

function parte(ctx: Ctx, datos: DatosEspd): string {
  const { operador: op, representante: rep } = datos;
  const pyme =
    ctx.modelo.v === 2 && op.pyme !== null
      ? cbc(
          ctx,
          'IndustryClassificationCode',
          op.pyme ? 'SME' : 'LARGE',
          ' listID="EOIndustryClassificationCode" listAgencyID="EU-COM-GROW" listVersionID="2.1.0"',
        )
      : '';
  const id = cac(
    ctx,
    'PartyIdentification',
    cbc(ctx, 'ID', op.nif, ctx.modelo.v === 2 ? ' schemeAgencyID="EU-COM-GROW"' : ''),
  );
  const dom = op.domicilio;
  const direccion = dom
    ? cac(
        ctx,
        'PostalAddress',
        cbc(ctx, 'StreetName', dom.calle) +
          cbc(ctx, 'CityName', dom.municipio) +
          cbc(ctx, 'PostalZone', dom.cp) +
          pais(ctx),
      )
    : '';
  const contacto = cac(
    ctx,
    'Contact',
    cbc(ctx, 'Name', rep?.nombre ?? null) + cbc(ctx, 'Telephone', op.telefono) + cbc(ctx, 'ElectronicMail', op.email),
  );
  const poder = ctx.modelo.v === 2 && rep ? apoderado(ctx, rep, true) : '';
  return cac(
    ctx,
    'Party',
    pyme + id + cac(ctx, 'PartyName', cbc(ctx, 'Name', op.nombre)) + direccion + contacto + poder,
  );
}

function operadorXml(ctx: Ctx, datos: DatosEspd): string {
  if (ctx.modelo.v === 2) return cac(ctx, 'EconomicOperatorParty', parte(ctx, datos));
  const ecac = pfx(ctx, NS.espdCac, 'espd-cac');
  const ecbc = pfx(ctx, NS.espdCbc, 'espd-cbc');
  const { operador: op, representante: rep } = datos;
  const pyme = op.pyme === null ? '' : el(`${ecbc}SMEIndicator`, String(op.pyme));
  const representante = rep
    ? el(
        `${ecac}RepresentativeNaturalPerson`,
        txt(`${ecbc}NaturalPersonRoleDescription`, rep.cargo) + apoderado(ctx, rep, false),
      )
    : '';
  return el(`${ecac}EconomicOperatorParty`, pyme + representante + parte(ctx, datos));
}

// ── Criterios y respuestas ────────────────────────────────────────────────────────────────

type Pregunta = { id: string; tipo: string; cierre: number };
type Valor =
  { fecha: string } | { importe: number } | { periodo: [string, string] } | { texto: string } | { lotes: string[] };
type Respuesta = { pregunta: Pregunta; valor: Valor };
type Parte = { local: string; texto: string };

function preguntasDe(criterio: string, ctx: Ctx): Pregunta[] {
  const local = ctx.modelo.v === 1 ? 'Requirement' : 'TenderingCriterionProperty';
  const re = new RegExp(`<((?:[\\w.-]+:)?)${local}\\b([^>]*)>([\\s\\S]*?)</\\1${local}>`, 'g');
  const preguntas: Pregunta[] = [];
  for (const m of criterio.matchAll(re)) {
    const cuerpo = m[3]!;
    if (ctx.modelo.v === 2 && primero(cuerpo, 'TypeCode') !== 'QUESTION') continue;
    const tipo =
      ctx.modelo.v === 1
        ? (/responseDataType\s*=\s*["']([^"']*)/.exec(m[2]!)?.[1] ?? '')
        : primero(cuerpo, 'ValueDataTypeCode');
    preguntas.push({ id: primero(cuerpo, 'ID'), tipo, cierre: m.index + m[0].length - `</${m[1]}${local}>`.length });
  }
  return preguntas;
}

// Los ejercicios que pide el órgano son los huecos de la petición (fecha, fecha, importe en el 1.0.2;
// periodo e importe en el 2.x): el más reciente de los datos va al primer hueco.
function respuestasVolumen(preguntas: Pregunta[], datos: DatosEspd): Respuesta[] {
  const anios = [...datos.volumen_negocio].sort((a, b) => b.anio - a.anio);
  const respuestas: Respuesta[] = [];
  for (let i = 0; i < preguntas.length && anios.length; i++) {
    const tipos = preguntas
      .slice(i, i + 3)
      .map((p) => p.tipo)
      .join(',');
    const hueco = tipos === 'DATE,DATE,AMOUNT' ? 3 : tipos.startsWith('PERIOD,AMOUNT') ? 2 : 0;
    if (!hueco) continue;
    const { anio, importe } = anios.shift()!;
    const [ini, fin] = [`${anio}-01-01`, `${anio}-12-31`];
    const [a, b, c] = preguntas.slice(i, i + hueco) as [Pregunta, Pregunta, Pregunta?];
    if (c)
      respuestas.push(
        { pregunta: a, valor: { fecha: ini } },
        { pregunta: b, valor: { fecha: fin } },
        { pregunta: c, valor: { importe } },
      );
    else respuestas.push({ pregunta: a, valor: { periodo: [ini, fin] } }, { pregunta: b, valor: { importe } });
    i += hueco - 1;
  }
  return respuestas;
}

function respuestasLotes(preguntas: Pregunta[], datos: DatosEspd): Respuesta[] {
  const pregunta = preguntas[0];
  if (!pregunta || !datos.lotes.length) return [];
  const valor = pregunta.tipo === 'LOT_IDENTIFIER' ? { lotes: datos.lotes } : { texto: datos.lotes.join(', ') };
  return [{ pregunta, valor }];
}

function respuestasDe(
  criterio: string,
  ctx: Ctx,
  datos: DatosEspd,
): { respuestas: Respuesta[]; codigo: string; nombre: string } {
  const codigo = primero(criterio, ctx.modelo.tipo);
  const nombre = primero(criterio, 'Name');
  if (codigo.startsWith('CRITERION.EXCLUSION.')) return { respuestas: [], codigo, nombre };
  const preguntas = preguntasDe(criterio, ctx);
  const respuestas =
    codigo === VOLUMEN
      ? respuestasVolumen(preguntas, datos)
      : codigo === LOTES
        ? respuestasLotes(preguntas, datos)
        : [];
  return { respuestas, codigo, nombre };
}

function valorV1(ctx: Ctx, valor: Valor): string {
  if ('fecha' in valor) return cbc(ctx, 'Date', valor.fecha);
  if ('importe' in valor) return cbc(ctx, 'Amount', String(valor.importe), ' currencyID="EUR"');
  return cbc(
    ctx,
    'Description',
    'texto' in valor ? valor.texto : 'lotes' in valor ? valor.lotes.join(', ') : valor.periodo.join(' - '),
  );
}

// En el 1.0.2 la respuesta va dentro de su ccv:Requirement, justo antes de cerrarlo.
function responderV1(criterio: string, respuestas: Respuesta[], ctx: Ctx): string {
  const ccv = pfx(ctx, NS.ccv, 'ccv');
  let texto = criterio;
  for (const r of [...respuestas].sort((a, b) => b.pregunta.cierre - a.pregunta.cierre)) {
    texto =
      texto.slice(0, r.pregunta.cierre) + el(`${ccv}Response`, valorV1(ctx, r.valor)) + texto.slice(r.pregunta.cierre);
  }
  return texto;
}

function valorV2(ctx: Ctx, valor: Valor, semilla: string): string {
  if ('periodo' in valor)
    return cac(
      ctx,
      'ApplicablePeriod',
      cbc(ctx, 'StartDate', valor.periodo[0]) + cbc(ctx, 'EndDate', valor.periodo[1]),
    );
  const uuid = ` schemeID="ISO/IEC 9834-8:2008 - 4UUID" schemeAgencyID="EU-COM-GROW" schemeVersionID="${escapar(ctx.version)}"`;
  const unValor = (contenido: string, n: number) =>
    cac(ctx, 'ResponseValue', cbc(ctx, 'ID', uuidDe(`${semilla}:${n}`), uuid) + contenido);
  if ('lotes' in valor)
    return valor.lotes.map((l, n) => unValor(cbc(ctx, 'ResponseID', l, ' schemeAgencyID="OGP"'), n)).join('');
  if ('importe' in valor) return unValor(cbc(ctx, 'ResponseAmount', String(valor.importe), ' currencyID="EUR"'), 0);
  if ('fecha' in valor) return unValor(cbc(ctx, 'ResponseDate', valor.fecha), 0);
  return unValor(cbc(ctx, 'Description', valor.texto), 0);
}

function respuestaV2(ctx: Ctx, r: Respuesta, n: number): string {
  const semilla = `${ctx.id}:${r.pregunta.id}:${n}`;
  const version = escapar(ctx.version);
  const id = cbc(
    ctx,
    'ID',
    uuidDe(semilla),
    ` schemeID="ISO/IEC 9834-8:2008 - 4UUID" schemeAgencyID="EU-COM-GROW" schemeVersionID="${version}"`,
  );
  const propiedad = cbc(
    ctx,
    'ValidatedCriterionPropertyID',
    r.pregunta.id,
    ` schemeID="CriteriaTaxonomy" schemeAgencyID="EU-COM-GROW" schemeVersionID="${version}"`,
  );
  return cac(ctx, 'TenderingCriterionResponse', id + propiedad + valorV2(ctx, r.valor, `${semilla}:valor`));
}

type Criterios = { respuestasV2: string[]; respondidos: Set<string>; sin_responder: RespuestaEspd['sin_responder'] };

function responderCriterios(partes: Parte[], ctx: Ctx, datos: DatosEspd): Criterios {
  const out: Criterios = { respuestasV2: [], respondidos: new Set(), sin_responder: [] };
  for (const p of partes.filter((x) => x.local === ctx.modelo.criterio)) {
    const { respuestas, codigo, nombre } = respuestasDe(p.texto, ctx, datos);
    if (!respuestas.length) {
      out.sin_responder.push({ codigo, nombre });
      continue;
    }
    for (const r of respuestas) out.respondidos.add(r.pregunta.id);
    if (ctx.modelo.v === 1) p.texto = responderV1(p.texto, respuestas, ctx);
    else out.respuestasV2.push(...respuestas.map((r, n) => respuestaV2(ctx, r, n)));
  }
  return out;
}

// ── Montaje ───────────────────────────────────────────────────────────────────────────────

function indiceDe(partes: Parte[], locales: string[]): number {
  const i = partes.findIndex((p) => locales.includes(p.local));
  return i < 0 ? partes.length : i;
}

function insertarOperador(partes: Parte[], ctx: Ctx, datos: DatosEspd): Parte[] {
  const ultimo = partes.map((p) => p.local).lastIndexOf('ContractingParty');
  const i =
    ultimo >= 0 ? ultimo + 1 : indiceDe(partes, ['ProcurementProject', 'ProcurementProjectLot', ctx.modelo.criterio]);
  return [
    ...partes.slice(0, i),
    { local: 'EconomicOperatorParty', texto: operadorXml(ctx, datos) },
    ...partes.slice(i),
  ];
}

// Los lotes de la respuesta son a los que se presenta; sin lotes decididos se dejan los de la petición.
function insertarLotes(partes: Parte[], ctx: Ctx, lotes: string[]): Parte[] {
  if (!lotes.length) return partes;
  const i = indiceDe(partes, ['ProcurementProjectLot', ctx.modelo.criterio]);
  const nuevos = lotes.map((l) => ({
    local: 'ProcurementProjectLot',
    texto: cac(ctx, 'ProcurementProjectLot', cbc(ctx, 'ID', l, ' schemeAgencyID="EU-COM-GROW"')),
  }));
  const resto = (ps: Parte[]) => ps.filter((p) => p.local !== 'ProcurementProjectLot');
  return [...resto(partes.slice(0, i)), ...nuevos, ...resto(partes.slice(i))];
}

function insertarRespuestas(partes: Parte[], ctx: Ctx, respuestas: string[]): Parte[] {
  if (!respuestas.length) return partes;
  const i = partes.map((p) => p.local).lastIndexOf(ctx.modelo.criterio) + 1 || partes.length;
  return [
    ...partes.slice(0, i),
    ...respuestas.map((texto) => ({ local: 'TenderingCriterionResponse', texto })),
    ...partes.slice(i),
  ];
}

function leerPeticion(peticion: string): Result<{ raiz: Elemento; modelo: Modelo }> {
  if (typeof peticion !== 'string' || !peticion.trim())
    return fail('invalid_input', 'La petición del DEUC está vacía.');
  if (peticion.length > MAX_PETICION) return fail('invalid_input', 'La petición del DEUC es demasiado grande.');
  // Sin DTD: ni entidades externas ni expansión (misma regla que biblioteca/motor/documentos/extraccion.ts).
  if (/<!DOCTYPE/i.test(peticion))
    return fail('invalid_input', 'La petición del DEUC trae una DTD y no se lee por seguridad.');
  if (XMLValidator.validate(peticion) !== true)
    return fail('invalid_input', 'La petición del DEUC no es un XML válido.');
  const raiz = hijosDirectos(peticion, 0, peticion.length)[0];
  const modelo = raiz && Object.hasOwn(MODELOS, raiz.local) ? MODELOS[raiz.local as keyof typeof MODELOS] : null;
  if (!raiz || !modelo) {
    const respuesta = raiz?.local === 'ESPDResponse' || raiz?.local === 'QualificationApplicationResponse';
    return fail(
      'no_soportado',
      respuesta
        ? 'El archivo ya es una respuesta del DEUC, no la petición del órgano: usa el Deuc.xml de los pliegos.'
        : 'El archivo no es una petición del DEUC (ESPDRequest o QualificationApplicationRequest): rellénalo en el servicio DEUC con la guía.',
    );
  }
  return ok({ raiz, modelo });
}

/** Respuesta del DEUC (espd-response.xml) a partir de la petición del órgano, con lo que se sabe sin preguntar. */
export function respuestaEspd(peticion: string, datos: DatosEspd, ahora: Date, id: string): Result<RespuestaEspd> {
  const validos = DatosEspdEntrada.safeParse(datos);
  if (!validos.success)
    return fail('invalid_input', `Datos del DEUC no válidos: ${validos.error.issues[0]?.message ?? ''}`);
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime()))
    return fail('invalid_input', 'Fecha de emisión no válida.');
  if (typeof id !== 'string' || !id.trim() || id.length > 200)
    return fail('invalid_input', 'Identificador de la respuesta no válido.');
  const leida = leerPeticion(peticion);
  if (leida.error) return leida;
  const { raiz, modelo } = leida.data;
  const apertura = peticion.slice(raiz.ini, raiz.finApertura);
  const hijos = hijosDirectos(peticion, raiz.finApertura, peticion.lastIndexOf('</', raiz.fin));
  const ctx: Ctx = {
    modelo,
    ns: prefijosDe(apertura),
    nuevos: [],
    id: id.trim(),
    ahora,
    version: primeroHijo(peticion, hijos, 'VersionID') || '2.1.1',
  };
  let partes = hijos.map((h) => ({ local: h.local, texto: cabecera(peticion.slice(h.ini, h.fin), h.local, ctx) }));
  const criterios = responderCriterios(partes, ctx, validos.data);
  partes = insertarRespuestas(
    insertarLotes(insertarOperador(partes, ctx, validos.data), ctx, validos.data.lotes),
    ctx,
    criterios.respuestasV2,
  );
  const { abre, cierra } = raizRespuesta(apertura, raiz, ctx);
  const xml = `${peticion.slice(0, raiz.ini)}${abre}\n    ${partes.map((p) => p.texto).join('\n    ')}\n${cierra}\n`;
  if (XMLValidator.validate(xml) !== true)
    return fail('xml_no_valido', 'La respuesta del DEUC no sale como XML válido.');
  return ok({ xml, respondidos: [...criterios.respondidos], sin_responder: criterios.sin_responder });
}

function primeroHijo(xml: string, hijos: Elemento[], local: string): string {
  const h = hijos.find((x) => x.local === local);
  return h ? primero(xml.slice(h.ini, h.fin), local) : '';
}
