// Guía del DEUC: DEUC_GUIA.md en Salidas de la oferta, campo a campo, para rellenarlo en el servicio DEUC.
import fs from 'node:fs';
import path from 'node:path';
import type { Router } from 'express';
import { nucleo } from '../../../nucleo/contexto.js';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { leerPerfilEmpresa, textoEuros, type PerfilEmpresaData } from '../../../nucleo/empresa.js';
import { decodificarEntidades } from '../../../nucleo/entidades.js';
import { emitir } from '../../../nucleo/eventos.js';
import { responder } from '../../../nucleo/http.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, raicesActuales, type Raices } from '../../../nucleo/salidas.js';
import { dbLicitaciones } from '../db.js';
import { conId } from '../http.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import type { Db } from '../store.js';
import { decisionesDe, lotesDecididos } from './decisiones.js';
import { peticionDeuc } from './deuc.js';
import { documentosDe, filaDocumento, type FilaDocumento } from './documentos.js';
import { hojaDeDatos, type HojaDatos } from './hojaDatos.js';
import { SERVICIO_DEUC } from './paqueteTextos.js';

const log = logger('licitaciones');

// Se usa tras importar la petición del órgano (Deuc.xml). Mientras el DEUC en XML siga apagado
// (LICITACIONES_DEUC_XML), es lo que baja el DEUC de 20-30 min a 8-10. Sale del perfil de la empresa, la hoja de
// datos, las decisiones y los criterios de la petición; lo que falta se escribe «FALTA: …», nunca se inventa.
// Nunca lleva un importe ofertado (el DEUC va en el sobre A) y nunca pisa una guía anterior: una persona pudo
// editarla. Sin runs.
export type Criterio = { codigo: string; nombre: string };

const MAX_PETICION = 20 * 1024 * 1024;
const AJUSTES = '(Ajustes › Empresa)';
export const GUIA_DEUC = /(^|\/)DEUC_GUIA(-v(\d+))?\.md$/i;

// ── Los criterios de la petición ──

// ESPDRequest (1.0.2: ccv:Criterion con cbc:TypeCode) y el modelo 2.x (cac:TenderingCriterion con
// cbc:CriterionTypeCode), con cualquier prefijo. «\b» deja fuera TenderingCriterionProperty/Response.
const CRITERIO = /<((?:[\w.-]+:)?)(Criterion|TenderingCriterion)\b[^>]*>([\s\S]*?)<\/\1\2>/g;

function primero(xml: string, local: string): string {
  const m = new RegExp(`<((?:[\\w.-]+:)?)${local}\\b[^>]*>([\\s\\S]*?)</\\1${local}>`).exec(xml);
  return m
    ? decodificarEntidades(m[2]!.replace(/<[^>]*>/g, ''))
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

/** Los criterios (código y nombre) de una petición del DEUC, sin repetir. [] si no se entiende: nunca falla. */
export function criteriosDePeticion(xml: string): Criterio[] {
  if (typeof xml !== 'string' || xml.length > MAX_PETICION || /<!DOCTYPE/i.test(xml)) return [];
  const vistos = new Set<string>();
  const criterios: Criterio[] = [];
  for (const m of xml.matchAll(CRITERIO)) {
    const codigo = primero(m[3]!, m[2] === 'Criterion' ? 'TypeCode' : 'CriterionTypeCode');
    if (!/^CRITERION\.[A-Z0-9_.-]+$/.test(codigo) || vistos.has(codigo)) continue;
    vistos.add(codigo);
    criterios.push({ codigo, nombre: primero(m[3]!, 'Name') || codigo });
  }
  return criterios;
}

// ── El texto ──

// Los nombres que enseña el servicio DEUC en español; la petición los trae en inglés.
const EXCLUSION_ES: Record<string, string> = {
  'CONVICTIONS.PARTICIPATION_IN_CRIMINAL_ORGANISATION': 'Participación en una organización delictiva',
  'CONVICTIONS.CORRUPTION': 'Corrupción',
  'CONVICTIONS.FRAUD': 'Fraude',
  'CONVICTIONS.TERRORIST_OFFENCES': 'Delitos de terrorismo o delitos ligados a las actividades terroristas',
  'CONVICTIONS.MONEY_LAUNDERING': 'Blanqueo de capitales o financiación del terrorismo',
  'CONVICTIONS.CHILD_LABOUR-HUMAN_TRAFFICKING': 'Trabajo infantil y otras formas de trata de seres humanos',
  'CONTRIBUTIONS.PAYMENT_OF_TAXES': 'Pago de impuestos',
  'CONTRIBUTIONS.PAYMENT_OF_SOCIAL_SECURITY': 'Pago de cotizaciones a la seguridad social',
  'SOCIAL.ENVIRONMENTAL_LAW': 'Incumplimiento de obligaciones en materia de Derecho medioambiental',
  'SOCIAL.SOCIAL_LAW': 'Incumplimiento de obligaciones en materia de Derecho social',
  'SOCIAL.LABOUR_LAW': 'Incumplimiento de obligaciones en materia de Derecho laboral',
  'BUSINESS.BANKRUPTCY': 'Quiebra',
  'BUSINESS.INSOLVENCY': 'Insolvencia',
  'BUSINESS.CREDITORS_ARRANGEMENT': 'Convenio con los acreedores',
  'BUSINESS.BANKRUPTCY_ANALOGOUS': 'Situación análoga a la quiebra con arreglo al Derecho nacional',
  'BUSINESS.LIQUIDATOR_ADMINISTERED': 'Activos administrados por un liquidador',
  'BUSINESS.ACTIVITIES_SUSPENDED': 'Cese de actividades',
  'MISCONDUCT.MC_PROFESSIONAL': 'Falta profesional grave',
  'MISCONDUCT.MARKET_DISTORTION': 'Acuerdos con otros operadores económicos destinados a falsear la competencia',
  'CONFLICT_OF_INTEREST.PROCEDURE_PARTICIPATION':
    'Conflicto de intereses debido a su participación en el procedimiento de contratación',
  'CONFLICT_OF_INTEREST.PROCEDURE_PREPARATION':
    'Participación directa o indirecta en la preparación del procedimiento de contratación',
  'CONFLICT_OF_INTEREST.EARLY_TERMINATION': 'Rescisión anticipada, daños y perjuicios u otras sanciones comparables',
  'CONFLICT_OF_INTEREST.MISINTERPRETATION':
    'Declaraciones falsas, ocultación de información o de documentos e información confidencial',
  'NATIONAL.OTHER': 'Motivos de exclusión puramente nacionales',
};
const SELECCION_ES: Record<string, string> = {
  'SUITABILITY.PROFESSIONAL_REGISTER_ENROLMENT': 'Inscripción en un registro profesional',
  'SUITABILITY.TRADE_REGISTER_ENROLMENT': 'Inscripción en un registro mercantil',
  'SUITABILITY.AUTHORISATION': 'Autorización o afiliación a una organización (contratos de servicios)',
  'ECONOMIC_FINANCIAL_STANDING.TURNOVER.GENERAL_YEARLY': 'Volumen de negocios anual («general»)',
  'ECONOMIC_FINANCIAL_STANDING.TURNOVER.SET_UP': 'Fecha de creación del operador económico',
  'ECONOMIC_FINANCIAL_STANDING.OTHER_REQUIREMENTS': 'Otros requisitos económicos o financieros',
  'ECONOMIC_FINANCIAL_STANDING.PROFESSIONAL_RISK_INSURANCE': 'Seguro de indemnización por riesgos profesionales',
  'TECHNICAL_PROFESSIONAL_ABILITY.REFERENCES.SERVICES_DELIVERY_PERFORMANCE':
    'Contratos de servicios: prestación de servicios del tipo especificado',
  'TECHNICAL_PROFESSIONAL_ABILITY.TECHNICAL.FACILITIES_FOR_QUALITY_ENSURING':
    'Instalaciones técnicas y medidas para garantizar la calidad',
  'TECHNICAL_PROFESSIONAL_ABILITY.TECHNICAL.EQUIPMENT': 'Instrumentos, material y equipo técnico',
  'TECHNICAL_PROFESSIONAL_ABILITY.MANAGEMENT.SUBCONTRACTING_PROPORTION': 'Proporción de subcontratación',
};

const EXCLUSION = 'CRITERION.EXCLUSION.';
const SELECCION = 'CRITERION.SELECTION.';
const ALFA = 'CRITERION.SELECTION.ALL_SATISFIED';
const falta = (que: string, donde = AJUSTES) => `FALTA: ${que} ${donde}`;
const o = (v: string | null | undefined, que: string) => (v?.trim() ? v.trim() : falta(que));
const linea = (etiqueta: string, valor: string) => `- **${etiqueta}:** ${valor}`;

export type EntradaGuia = {
  perfil: PerfilEmpresaData | null;
  hoja: HojaDatos;
  criterios: Criterio[];
  lotes: string[];
  licitacion: { expediente: string; organo: string };
  // decisiones.datos_anexo.subcontratacion_servidores: null = sin decidir.
  subcontratacion_servidores?: boolean | null;
};

function domicilioDe(p: PerfilEmpresaData | null): string | null {
  const d = p?.direccion;
  if (d) return `${d.calle}, ${d.codigo_postal} ${d.municipio} (${d.provincia})`;
  return p?.domicilio?.trim() || null;
}

const PYME: Record<NonNullable<PerfilEmpresaData['tamano']>, string> = {
  micro: 'Sí (microempresa)',
  pequena: 'Sí (pequeña empresa)',
  mediana: 'Sí (mediana empresa)',
  grande: 'No',
};

const textoLotes = (lotes: string[]) =>
  lotes.length ? lotes.map((l) => `Lote ${l}`).join(', ') : 'Contrato sin lotes: toda la licitación';

function parteI(e: EntradaGuia): string[] {
  return [
    '## Parte I · Procedimiento',
    'La rellena el servicio al importar Deuc.xml: comprueba que coincide.',
    linea('Expediente', e.licitacion.expediente),
    linea('Órgano de contratación', e.licitacion.organo),
  ];
}

function parteIIA(p: PerfilEmpresaData | null, lotes: string[]): string[] {
  return [
    '## Parte II · A. El operador económico',
    linea('Nombre', o(p?.nombre, 'nombre de la empresa')),
    linea('NIF', o(p?.nif, 'NIF')),
    linea('Dirección postal', o(domicilioDe(p), 'domicilio')),
    linea('Correo electrónico de contacto', o(p?.contacto?.email, 'correo de contacto')),
    linea('Teléfono de contacto', o(p?.contacto?.telefono, 'teléfono de contacto')),
    linea('¿Es una PYME?', p?.tamano ? PYME[p.tamano] : falta('tamaño de la empresa')),
    linea('Lotes a los que se presenta', textoLotes(lotes)),
  ];
}

function parteIIBCD(p: PerfilEmpresaData | null, subcontrata: boolean | null | undefined): string[][] {
  const r = p?.representante;
  const sub =
    subcontrata === true
      ? 'Sí: indica a quién y qué parte, como en el anexo de la oferta'
      : subcontrata === false
        ? 'No'
        : falta('decide si subcontratas los servidores o servicios asociados', '(Decisiones › Datos del anexo)');
  return [
    [
      '## Parte II · B. Representante',
      linea('Nombre y apellidos', o(r?.nombre, 'representante')),
      linea('NIF del representante', o(r?.nif, 'NIF del representante')),
      linea('Cargo', o(r?.cargo, 'cargo del representante')),
    ],
    ['## Parte II · C. Capacidades de otras entidades', linea('¿Se basa en la capacidad de otras entidades?', 'No')],
    ['## Parte II · D. Subcontratación', linea('¿Tiene intención de subcontratar alguna parte del contrato?', sub)],
  ];
}

function parteIII(criterios: Criterio[]): string[] {
  const exclusion = criterios.filter((c) => c.codigo.startsWith(EXCLUSION));
  const lineas = exclusion.length
    ? exclusion.map((c) => linea(EXCLUSION_ES[c.codigo.slice(EXCLUSION.length)] ?? c.nombre, 'No'))
    : [linea('Cada motivo de exclusión que pregunte el servicio', 'No')];
  return [
    '## Parte III · Motivos de exclusión',
    'Una persona confirma cada respuesta: la plataforma no la declara por la empresa.',
    ...lineas,
  ];
}

function volumenDe(p: PerfilEmpresaData | null): string {
  const v = [...(p?.volumen_negocio ?? [])].sort((a, b) => b.anio - a.anio);
  return v.length ? v.map((x) => `${x.anio}: ${textoEuros(x.importe)}`).join(' · ') : falta('volumen de negocio anual');
}

// El valor del perfil para un criterio de selección; si el perfil no lo tiene, lo dice el pliego.
function valorSeleccion(codigo: string, p: PerfilEmpresaData | null): string {
  if (codigo.includes('.TURNOVER.') && !codigo.endsWith('.SET_UP')) return volumenDe(p);
  if (codigo.endsWith('.SET_UP')) return o(p?.fecha_constitucion, 'fecha de constitución');
  if (codigo.includes('PROFESSIONAL_RISK_INSURANCE'))
    return p?.seguro_rc != null ? textoEuros(p.seguro_rc) : falta('seguro de responsabilidad civil');
  if (codigo.includes('.REFERENCES.')) {
    return p?.mayor_contrato_similar != null
      ? `Mayor contrato similar de los últimos 3 años: ${textoEuros(p.mayor_contrato_similar)}; detalla los servicios como pide el PCAP`
      : falta('mayor contrato similar');
  }
  if (/QUALITY|ENVIRONMENTAL_MANAGEMENT|CERTIFICATE/.test(codigo))
    return p?.certificaciones.length ? p.certificaciones.join(', ') : falta('certificados');
  return 'Lo que pida el PCAP para este criterio';
}

function parteIV(criterios: Criterio[], p: PerfilEmpresaData | null): string[] {
  const seleccion = criterios.filter((c) => c.codigo.startsWith(SELECCION) && c.codigo !== ALFA);
  const titulo = '## Parte IV · Criterios de selección';
  if (criterios.some((c) => c.codigo === ALFA) || !seleccion.length) {
    return [
      titulo,
      linea(
        'α · Indicación global relativa a todos los criterios de selección',
        'Sí, cumple los criterios de selección exigidos',
      ),
    ];
  }
  return [
    titulo,
    ...seleccion.map((c) =>
      linea(SELECCION_ES[c.codigo.slice(SELECCION.length)] ?? c.nombre, valorSeleccion(c.codigo, p)),
    ),
  ];
}

function parteVI(hoja: HojaDatos, p: PerfilEmpresaData | null): string[] {
  const de = (grupo: string, etiqueta: string) =>
    hoja.campos.find((c) => c.grupo === grupo && c.etiqueta === etiqueta)?.valor ?? null;
  return [
    '## Parte VI · Declaraciones finales',
    linea('Lugar', o(de('Empresa', 'Lugar'), 'domicilio')),
    linea('Fecha', de('Firma', 'Fecha') ?? 'a la fecha de la firma electrónica'),
    linea('Firma', `${o(p?.representante?.nombre, 'representante')}, con su certificado electrónico`),
  ];
}

/** DEUC_GUIA.md: lo que se teclea en el servicio DEUC, parte a parte. Sin importes ofertados. */
export function guiaDeuc(e: EntradaGuia): string {
  const cabecera = [
    `# Guía del DEUC · ${e.licitacion.expediente}`,
    `1. Descarga Deuc.xml · 2. Impórtalo en el [servicio DEUC](${SERVICIO_DEUC}) · 3. Rellena con esta guía`,
    'Lo marcado «FALTA» no se sabe todavía: complétalo donde se indica y vuelve a preparar la guía.',
  ];
  const partes = [
    parteI(e),
    parteIIA(e.perfil, e.lotes),
    ...parteIIBCD(e.perfil, e.subcontratacion_servidores),
    parteIII(e.criterios),
    parteIV(e.criterios, e.perfil),
    parteVI(e.hoja, e.perfil),
  ];
  return `${[cabecera, ...partes].map((b) => b.join('\n')).join('\n\n')}\n`;
}

// ── Escribir ──

type Guardada = { nombre: string; version: number };

function guiasEn(dir: string): Guardada[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .flatMap((nombre) => {
      const m = GUIA_DEUC.exec(nombre);
      return m ? [{ nombre, version: m[3] ? Number(m[3]) : 1 }] : [];
    })
    .sort((a, b) => a.version - b.version);
}

const nombreGuia = (v: number) => (v === 1 ? 'DEUC_GUIA.md' : `DEUC_GUIA-v${v}.md`);

// «wx»: nunca se pisa una guía. Si la última dice lo mismo, se devuelve esa sin escribir otra.
function escribirSinPisar(raices: Raices, carpeta: string, texto: string): Result<{ ruta: string; nueva: boolean }> {
  const dir = documentoEnDisco(raices, carpeta);
  if (dir.error) return dir;
  try {
    const guias = guiasEn(dir.data);
    const ultima = guias.at(-1);
    if (ultima && fs.readFileSync(path.join(dir.data, ultima.nombre), 'utf8') === texto)
      return ok({ ruta: `${carpeta}/${ultima.nombre}`, nueva: false });
    fs.mkdirSync(dir.data, { recursive: true });
    let v = (ultima?.version ?? 0) + 1;
    while (fs.existsSync(path.join(dir.data, nombreGuia(v)))) v += 1;
    fs.writeFileSync(path.join(dir.data, nombreGuia(v)), texto, { encoding: 'utf8', flag: 'wx' });
    return ok({ ruta: `${carpeta}/${nombreGuia(v)}`, nueva: true });
  } catch (err) {
    return fail('io_error', `No se pudo guardar la guía del DEUC en Salidas: ${errorMessage(err).slice(0, 300)}`);
  }
}

function criteriosDe(raices: Raices, ruta: string): Criterio[] {
  const abs = documentoEnDisco(raices, ruta);
  if (abs.error) return [];
  try {
    if (fs.statSync(abs.data).size > MAX_PETICION) return [];
    return criteriosDePeticion(fs.readFileSync(abs.data, 'utf8'));
  } catch (err) {
    log.warn('petición del DEUC sin leer para la guía', { error: errorMessage(err).slice(0, 200) });
    return [];
  }
}

// Las filas del DEUC que pueden llevar la guía: sin documento, o con una guía anterior. Un XML
// preparado, un documento puesto a mano o una fila «preparado» no se tocan.
function filasParaGuia(db: Db, id: string): FilaDocumento[] {
  return documentosDe(db, id)
    .documentos.filter((d) => d.tipo === 'deuc' && d.estado !== 'no_aplica')
    .map((d) => filaDocumento(db, id, d.clave))
    .filter(
      (f): f is FilaDocumento =>
        f !== null && !f.oculto && f.estado !== 'preparado' && (f.ruta === null || GUIA_DEUC.test(f.ruta)),
    );
}

// La bandeja de revisión (revisionHermes.ts) encuentra la guía por la ruta de la fila del DEUC.
// Con la hora de quien la pide: el paquete que la prepara (paquete.ts) no puede salir desfasado
// por su propia guía, apuntada unos milisegundos después de su creado_en.
function apuntarFilas(db: Db, id: string, filas: FilaDocumento[], g: { ruta: string; ahoraMs: number }): void {
  const ts = new Date(g.ahoraMs).toISOString();
  const ruta = g.ruta;
  for (const f of filas.filter((x) => x.ruta !== ruta)) {
    db.prepare(
      "UPDATE oferta_documentos SET estado = 'borrador', ruta = ?, ruta_pdf = NULL, anexo_en = ?, actualizado_en = ? WHERE licitacion_id = ? AND clave = ?",
    ).run(ruta, ts, ts, id, f.clave);
    emitir(db, {
      tipo: 'licitacion.documentos',
      dominio: 'licitaciones',
      recurso: id,
      datos: { accion: 'deuc_guia', clave: f.clave },
    });
  }
}

type Licitacion = { id: string; expediente: string; organo_nombre: string };

function entradaDe(db: Db, dbNucleo: DbNucleo, raices: Raices, l: Licitacion): Result<EntradaGuia> {
  const hoja = hojaDeDatos(db, dbNucleo, l.id);
  if (hoja.error) return hoja;
  const peticion = peticionDeuc(db, l.id);
  const decisiones = decisionesDe(db, l.id)?.datos ?? null;
  return ok({
    perfil: leerPerfilEmpresa(dbNucleo)?.perfil ?? null,
    hoja: hoja.data,
    criterios: peticion ? criteriosDe(raices, peticion.ruta) : [],
    lotes: [...lotesDecididos(db, l.id, decisiones?.lotes ?? [])].sort(),
    licitacion: { expediente: l.expediente, organo: l.organo_nombre },
    subcontratacion_servidores: decisiones?.datos_anexo?.subcontratacion_servidores ?? null,
  });
}

export type EntornoGuia = { db: Db; dbNucleo: DbNucleo; raices: Raices };

/** Escribe DEUC_GUIA.md (o DEUC_GUIA-vN.md) en la carpeta de Salidas de la oferta y lo apunta en la fila del DEUC. */
export function escribirGuiaDeuc(c: EntornoGuia, id: string, ahoraMs = Date.now()): Result<{ ruta: string }> {
  const { db, dbNucleo, raices } = c;
  if (!raices.salidas)
    return fail('no_configurado', 'Falta SALIDAS_DIR en el servidor: la guía del DEUC se escribe en Salidas.');
  const l = db.prepare('SELECT id, expediente, organo_nombre FROM licitaciones WHERE id = ?').get(id) as
    Licitacion | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const pide =
    documentosDe(db, id).documentos.some((d) => d.tipo === 'deuc' && d.estado !== 'no_aplica') ||
    peticionDeuc(db, id) !== null;
  if (!pide) return fail('conflicto', 'Esta oferta no pide DEUC: no hay guía que preparar.');
  const e = entradaDe(db, dbNucleo, raices, l);
  if (e.error) return e;
  const w = escribirSinPisar(raices, carpetaSalidas(l), guiaDeuc(e.data));
  if (w.error) return w;
  apuntarFilas(db, id, filasParaGuia(db, id), { ruta: w.data.ruta, ahoraMs });
  if (w.data.nueva) log.info('guía del DEUC preparada', { licitacion: id, ruta: w.data.ruta });
  return ok({ ruta: w.data.ruta });
}

export type GuiaLeida = { ruta: string | null; texto: string | null; peticion: string | null };

/** La última guía escrita y la petición del órgano (para «Descargar Deuc.xml»). */
export function leerGuiaDeuc(db: Db, raices: Raices, id: string): Result<GuiaLeida> {
  const l = db.prepare('SELECT id, expediente FROM licitaciones WHERE id = ?').get(id) as
    { id: string; expediente: string } | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const peticion = peticionDeuc(db, id)?.ruta ?? null;
  const carpeta = carpetaSalidas(l);
  const dir = raices.salidas ? documentoEnDisco(raices, carpeta) : null;
  const ultima = dir?.data ? guiasEn(dir.data).at(-1) : undefined;
  if (!dir?.data || !ultima) return ok({ ruta: null, texto: null, peticion });
  try {
    return ok({
      ruta: `${carpeta}/${ultima.nombre}`,
      texto: fs.readFileSync(path.join(dir.data, ultima.nombre), 'utf8'),
      peticion,
    });
  } catch (err) {
    return fail('io_error', `No se pudo leer la guía del DEUC: ${errorMessage(err).slice(0, 200)}`);
  }
}

/** GET y POST /licitaciones/:id/oferta/deuc/guia: leer la última guía o preparar una (sin pisar la anterior). */
export function rutasGuiaDeuc(r: Router): void {
  r.get(
    '/licitaciones/:id/oferta/deuc/guia',
    conId((id, _req, res) => responder(res, leerGuiaDeuc(dbLicitaciones(), raicesActuales(), id))),
  );
  r.post(
    '/licitaciones/:id/oferta/deuc/guia',
    conId((id, _req, res) =>
      responder(
        res,
        escribirGuiaDeuc({ db: dbLicitaciones(), dbNucleo: nucleo().db, raices: raicesActuales() }, id),
        201,
      ),
    ),
  );
}
