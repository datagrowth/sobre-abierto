// Paquete de presentación: lo que se sube a la sede, ya ordenado, en Salidas/…/PRESENTACION/v<n> <fecha>/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import type { Db as DbNucleo } from '../../../nucleo/db.js';
import { formaDePdf } from '../../../nucleo/documentos/formaPdf.js';
import { formaDeDocx } from '../../../nucleo/documentos/formaDocx.js';
import { camposDePdf, textoDeCampos } from '../../../nucleo/documentos/formularioPdf.js';
import { pdfDeDocx } from '../../../nucleo/documentos/libreoffice.js';
import { localizarHuecos } from '../../../nucleo/documentos/rellenar.js';
import { leerPerfilEmpresa, municipioDe } from '../../../nucleo/empresa.js';
import { nucleo } from '../../../nucleo/contexto.js';
import { emitir } from '../../../nucleo/eventos.js';
import { horaLocalEspana } from '../../../nucleo/fechas.js';
import { logger } from '../../../nucleo/log.js';
import { limpiarNombre } from '../../../nucleo/nombres.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import { documentoEnDisco, textoDe, type Raices } from '../../../nucleo/salidas.js';
import { carpetaSalidas } from '../propuestas/borrador.js';
import type { Db } from '../store.js';
import { comprobacionesDe } from './comprobaciones.js';
import { coherenciaOferta } from './coherencia.js';
import { decisionesDe, lotesDecididos, presupuestosDeLotes, type DecisionesGuardadas } from './decisiones.js';
import { infoDeuc } from './deuc.js';
import { escribirGuiaDeuc, GUIA_DEUC } from './deucGuia.js';
import { documentosDe, sincronizarDocumentos, type DocumentoOferta } from './documentos.js';
import { detectarFugas, importesSueltos } from './fugas.js';
import { contextoFugasDe } from './fugasMemoria.js';
import { guionVigente, type GuionGuardado } from './guion.js';
import { resumenMemoria } from './resumenMemoria.js';
import type { OfertaEconomicaLoteData } from './guion.js';
import { archivosEconomicos, ofertaDeLote } from './guionLotes.js';
import { lotesDeMemoria } from './memoriaLote.js';
import {
  comprobarPaquete,
  type AnuladasMemoria,
  type CarpetaPlan,
  type Comprobacion,
  type DocumentoPlan,
  type LecturaDocumento,
  type MemoriaPorLotePaquete,
} from './paqueteComprobaciones.js';
import { indiceDocx } from './paqueteIndice.js';
import {
  comprobadoDelPaquete,
  NO_COMPROBABLE,
  textoCompromisos,
  textoInstrucciones,
  textoValores,
  valoresATeclear,
  type CompromisosDeLote,
  type ValorATeclear,
} from './paqueteTextos.js';
import { Manifiesto, paqueteVigente, type ManifiestoData, type PaqueteVigente } from './paqueteManifiesto.js';
import { estadoPlazo } from './plazo.js';
import { carpetaUnicaDe, sobresEnUnica } from '../carpetasUnicas.js';
import { faltaMemoria } from './preparacion.js';
import { importeDeLote, problemasDePrecios } from './preciosOferta.js';

// Una carpeta por lote y sobre con los archivos numerados en el orden de subida, el índice del sobre si el
// pliego lo pide (generado con lo que de verdad va dentro), MANIFIESTO.json con el sha256 de cada archivo,
// INSTRUCCIONES.md, VALORES_A_TECLEAR.md, la hoja de compromisos de la memoria y la guía del DEUC. Antes de
// escribir se comprueba todo (paqueteComprobaciones.ts); con bloqueos se genera igual, marcado «NO PRESENTABLE
// TODAVÍA». Nunca se pisa una versión: la carpeta se crea sin «recursive» y cada archivo con «wx». Se prepara,
// no se firma ni se presenta.
const log = logger('licitaciones');

type Licitacion = {
  id: string;
  expediente: string;
  titulo: string;
  organo_nombre: string;
  fecha_limite: string | null;
};
export type Plan = {
  l: Licitacion;
  guion: GuionGuardado;
  decisiones: DecisionesGuardadas | null;
  lotes: string[];
  carpetas: CarpetaPlan[];
};

const dos = (n: number) => String(n).padStart(2, '0');
const esEnlace = (r: string) => /^https?:\/\//i.test(r);
// La guía del DEUC (DEUC_GUIA.md) va en la fila del DEUC hasta que haya DEUC, pero no se sube: es para teclearlo.
const subible = (r: string | null): r is string => Boolean(r) && !esEnlace(r!) && !GUIA_DEUC.test(r!);

// El archivo que va: el PDF si lo hay; si no, el documento tal cual (un enlace no se puede copiar).
function origenDe(f: DocumentoOferta): string | null {
  if (f.ruta_pdf) return f.ruta_pdf;
  return subible(f.ruta) ? f.ruta : null;
}

function documentosDeCarpeta(filas: DocumentoOferta[]): DocumentoPlan[] {
  let n = 0;
  return filas
    .filter((f) => f.estado !== 'no_aplica')
    .map((f) => {
      const origen = origenDe(f);
      const orden = origen ? ++n : 0;
      const destino = origen
        ? `${dos(orden)} ${limpiarNombre(f.nombre, 80)}${path.extname(origen).toLowerCase()}`
        : null;
      return {
        orden,
        nombre: f.nombre,
        clave: f.clave,
        tipo: f.tipo,
        obligatorio: f.obligatorio,
        estado: f.estado,
        origen,
        editable: subible(f.ruta) ? f.ruta : null,
        con_pdf: Boolean(origen?.toLowerCase().endsWith('.pdf')),
        archivo_destino: destino,
      };
    });
}

type Archivo = GuionGuardado['datos']['archivos'][number];
type ContextoCarpetas = { lotes: string[]; filas: DocumentoOferta[]; economicos: Set<string> };

// Dónde va cada archivo: por lote si va por lote; con un solo lote, todo en su carpeta; con varios, lo común en «Comun».
function carpetasDeArchivo(a: Archivo, i: number, ctx: ContextoCarpetas): CarpetaPlan[] {
  const porLote = ctx.lotes.length > 0 && (a.ambito === 'por_lote' || a.documentos.some((d) => d.lotes?.length));
  const nombre = `${i + 1} ${limpiarNombre(a.nombre, 80)}`;
  const base = {
    archivo: a.nombre,
    firma: a.firma ?? null,
    indice: a.indice === true,
    economica: ctx.economicos.has(a.nombre),
  };
  const filas = ctx.filas.filter((f) => f.archivo === a.nombre);
  if (porLote)
    return ctx.lotes.map((lote) => ({
      ...base,
      ruta: `Lote ${lote}/${nombre}`,
      lote,
      documentos: documentosDeCarpeta(filas.filter((f) => f.lote === lote || f.lote === null)),
    }));
  const unico = ctx.lotes.length === 1 ? ctx.lotes[0]! : null;
  const prefijo = unico ? `Lote ${unico}/` : ctx.lotes.length > 1 ? 'Comun/' : '';
  return [{ ...base, ruta: `${prefijo}${nombre}`, lote: unico, documentos: documentosDeCarpeta(filas) }];
}

/** El plan del paquete: carpetas en el orden del guion, documentos de la checklist en el orden de subida y el origen de cada uno. */
export function planDePaquete(db: Db, id: string): Result<Plan> {
  const l = db
    .prepare('SELECT id, expediente, titulo, organo_nombre, fecha_limite FROM licitaciones WHERE id = ?')
    .get(id) as Licitacion | undefined;
  if (!l) return fail('not_found', `No hay ninguna licitación con id «${id}».`);
  const { guion, documentos } = documentosDe(db, id);
  if (!guion) return fail('conflicto', 'Esta licitación aún no tiene guion de la oferta: el paquete se monta con él.');
  const decisiones = decisionesDe(db, id);
  const lotes = lotesDecididos(db, id, decisiones?.datos.lotes ?? []);
  const memoria = guion.datos.memoria?.archivo;
  const economicos = new Set(
    [...archivosEconomicos(guion.datos), ...guion.datos.automaticos.map((a) => a.archivo)].filter((a) => a !== memoria),
  );
  const carpetas = guion.datos.archivos.flatMap((a, i) =>
    carpetasDeArchivo(a, i, { lotes, filas: documentos, economicos }),
  );
  return ok({ l, guion, decisiones, lotes, carpetas });
}

// ── Lectura y comprobaciones ──

const AMARILLO = /<w:highlight w:val="yellow"\s*\/>/;
const DE_FIRMA = /firma|fdo\b|lugar y fecha/i;

// El XML del cuerpo de un .docx, para buscar el resaltado amarillo.
function xmlDe(bytes: Buffer): string {
  try {
    const f = unzipSync(new Uint8Array(bytes), { filter: (x) => x.name === 'word/document.xml' })['word/document.xml'];
    return f ? strFromU8(f) : '';
  } catch {
    return '';
  }
}

// Del .docx editable (el PDF no los dice): resaltado amarillo, huecos sin rellenar salvo los de
// firma y el formato del texto normal (fuente, tamaño, interlineado).
async function marcasDelDocx(
  raices: Raices,
  editable: string | null,
): Promise<Pick<LecturaDocumento, 'amarillo' | 'huecos' | 'formato'>> {
  const abs = editable?.toLowerCase().endsWith('.docx') ? documentoEnDisco(raices, editable) : null;
  if (!abs || abs.error || !fs.existsSync(abs.data)) return { amarillo: false, huecos: 0, formato: null };
  const bytes = await fsp.readFile(abs.data);
  const h = localizarHuecos(bytes);
  const huecos = h.data
    ? h.data.parrafos.filter((p) => !DE_FIRMA.test(p.texto)).flatMap((p) => p.huecos.filter((x) => x.tipo === 'puntos'))
        .length
    : 0;
  return { amarillo: AMARILLO.test(xmlDe(bytes)), huecos, formato: formaDeDocx(new Uint8Array(bytes)) };
}

// El PDF del paquete se exportó antes de la última edición del .docx (margen: relojes de la sincronización).
const MARGEN_PDF_MS = 5_000;

function pdfAntiguo(raices: Raices, d: DocumentoPlan, pdfAbs: string): boolean {
  if (!d.origen?.toLowerCase().endsWith('.pdf') || !d.editable?.toLowerCase().endsWith('.docx')) return false;
  const docx = documentoEnDisco(raices, d.editable);
  try {
    return !docx.error && fs.statSync(docx.data).mtimeMs > fs.statSync(pdfAbs).mtimeMs + MARGEN_PDF_MS;
  } catch {
    return false;
  }
}

const MAX_PDF_CON_CAMPOS = 5 * 1024 * 1024;

// Un PDF con formulario guarda lo rellenado en los campos, no en su texto: se añade para que las
// fugas, los importes y el lote ajeno se comprueben también ahí.
async function valoresDeCampos(abs: string): Promise<string> {
  try {
    if (!abs.toLowerCase().endsWith('.pdf') || fs.statSync(abs).size > MAX_PDF_CON_CAMPOS) return '';
    const campos = await camposDePdf(fs.readFileSync(abs));
    return campos.data ? textoDeCampos(campos.data) : '';
  } catch {
    return '';
  }
}

// Páginas y firma del PDF que va; null en lo que no es un PDF legible (no se juzga).
async function formaDe(abs: string): Promise<Pick<LecturaDocumento, 'paginas' | 'firmado'>> {
  if (!abs.toLowerCase().endsWith('.pdf')) return { paginas: null, firmado: null };
  const f = await fsp
    .readFile(abs)
    .then((b) => formaDePdf(b))
    .catch(() => null);
  return f?.data ? f.data : { paginas: null, firmado: null };
}

async function lecturaDe(raices: Raices, d: DocumentoPlan): Promise<LecturaDocumento | null> {
  const abs = d.origen ? documentoEnDisco(raices, d.origen) : null;
  if (!abs || abs.error || !fs.existsSync(abs.data)) return null;
  const texto = await textoDe(abs.data).catch(() => null);
  const campos = await valoresDeCampos(abs.data);
  return {
    texto: `${texto?.data ?? ''}${campos ? `\n${campos}` : ''}`,
    ...(await marcasDelDocx(raices, d.editable)),
    pdf_antiguo: pdfAntiguo(raices, d, abs.data),
    ...(await formaDe(abs.data)),
  };
}

async function lecturas(raices: Raices, plan: Plan): Promise<Map<string, LecturaDocumento>> {
  const out = new Map<string, LecturaDocumento>();
  for (const d of plan.carpetas.flatMap((c) => c.documentos)) {
    if (!d.origen || out.has(d.origen)) continue;
    const l = await lecturaDe(raices, d);
    if (l) out.set(d.origen, l);
  }
  return out;
}

// Lo que anuló quien dio por buena la memoria aceptada (con su motivo): sus fugas ya no bloquean el paquete.
function fugasAnuladas(db: Db, id: string): AnuladasMemoria | null {
  const f = db
    .prepare(
      `SELECT m.anulacion_fugas AS a FROM borradores b JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND b.origen = 'ensamblado' AND b.estado = 'aceptada' ORDER BY b.version DESC, b.id DESC LIMIT 1`,
    )
    .get(id) as { a: string | null } | undefined;
  return f?.a ? (JSON.parse(f.a) as AnuladasMemoria) : null;
}

/** Si el pliego pide una memoria por lote: sus lotes y las rutas de las memorias comunes (un borrador sin memoria cuenta como común). */
export function memoriaPorLoteDe(db: Db, plan: Plan): MemoriaPorLotePaquete | null {
  const lotes = lotesDeMemoria(plan.guion.datos, plan.lotes);
  if (!lotes) return null;
  const filas = db
    .prepare(
      `SELECT b.ruta, b.ruta_pdf FROM borradores b LEFT JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND b.origen = 'ensamblado' AND m.lote IS NULL`,
    )
    .all(plan.l.id) as { ruta: string; ruta_pdf: string | null }[];
  return { lotes, comunes: filas.flatMap((f) => (f.ruta_pdf ? [f.ruta, f.ruta_pdf] : [f.ruta])) };
}

/** Las comprobaciones del paquete sobre el plan, sin escribir nada. */
export async function comprobacionesDelPaquete(
  db: Db,
  raices: Raices,
  plan: Plan,
  ahoraMs = Date.now(),
): Promise<Comprobacion[]> {
  const id = plan.l.id;
  const d = plan.decisiones?.datos ?? null;
  const fugas = contextoFugasDe(db, plan.guion);
  return comprobarPaquete(plan.carpetas, {
    plazo: estadoPlazo(db, id, ahoraMs),
    coherencia: coherenciaOferta(db, id),
    memoria: faltaMemoria(db, id, plan.guion),
    precios: d ? problemasDePrecios(d, plan.guion.datos, { presupuestos: presupuestosDeLotes(db, id) }) : [],
    pendientes: d ? d.ofertas.filter((o) => o.pendiente).map((o) => o.lote) : plan.lotes.length ? plan.lotes : [null],
    lecturas: await lecturas(raices, plan),
    fugas: (t) => detectarFugas(t, fugas),
    importes: importesSueltos,
    anuladas: fugasAnuladas(db, id),
    memoria_por_lote: memoriaPorLoteDe(db, plan),
    limite_paginas: plan.guion.datos.memoria?.limite_paginas ?? null,
    formato: plan.guion.datos.memoria?.formato ?? null,
  });
}

// ── Escritura ──

export type PaqueteGenerado = {
  version: number;
  ruta: string;
  bloqueos: number;
  avisos: number;
  manifiesto: ManifiestoConTextos;
};
type Escritura = { dir: string; rel: string };
type DocEscrito = ManifiestoData['carpetas'][number]['documentos'][number];

const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

function escribirArchivo(dir: string, nombre: string, bytes: Buffer): { sha256: string; bytes: number } {
  fs.writeFileSync(path.join(dir, nombre), bytes, { flag: 'wx' });
  return { sha256: sha256(bytes), bytes: bytes.length };
}

// v<n> <fecha>: la primera versión libre, en la tabla y en el disco.
function versionLibre(db: Db, id: string, base: string): number {
  const enTabla =
    (
      db.prepare('SELECT MAX(version) AS v FROM paquetes_presentacion WHERE licitacion_id = ?').get(id) as {
        v: number | null;
      }
    ).v ?? 0;
  const enDisco = fs.existsSync(base) ? fs.readdirSync(base).map((n) => Number(/^v(\d+) /.exec(n)?.[1] ?? 0)) : [];
  return Math.max(enTabla, ...enDisco) + 1;
}

function carpetaVersion(
  raices: Raices,
  plan: Plan,
  db: Db,
  ahoraMs: number,
): Result<Escritura & { version: number; nombre: string }> {
  const unica = carpetaUnicaDe(plan.l.id);
  const rel = unica ? sobresEnUnica(unica) : `${carpetaSalidas(plan.l)}/PRESENTACION`;
  const base = documentoEnDisco(raices, rel);
  if (base.error) return base;
  fs.mkdirSync(base.data, { recursive: true });
  const version = versionLibre(db, plan.l.id, base.data);
  const nombre = `v${version} ${horaLocalEspana(ahoraMs).slice(0, 16).replace('T', ' ').replace(':', '')}`;
  const dir = path.join(base.data, nombre);
  fs.mkdirSync(dir);
  return ok({ dir, rel: `${rel}/${nombre}`, version, nombre });
}

async function copiarDocumentos(raices: Raices, c: CarpetaPlan, dir: string): Promise<DocEscrito[]> {
  const out: DocEscrito[] = [];
  for (const d of c.documentos.filter((x) => x.origen && x.archivo_destino)) {
    const abs = documentoEnDisco(raices, d.origen!);
    if (abs.error || !fs.existsSync(abs.data)) continue;
    const h = escribirArchivo(dir, d.archivo_destino!, await fsp.readFile(abs.data));
    out.push({
      orden: d.orden,
      nombre: d.nombre,
      clave: d.clave,
      archivo: d.archivo_destino!,
      origen: d.origen!,
      ...h,
      estado_checklist: d.estado,
      firma: 'pendiente',
    });
  }
  return out;
}

type DatosEmpresa = { nombre: string | null; nif: string | null; municipio: string | null };

// El índice del sobre con lo que de verdad va en la carpeta: .docx y, con LibreOffice, su PDF.
async function escribirIndice(
  plan: Plan,
  c: CarpetaPlan,
  dir: string,
  ctx: { docs: DocEscrito[]; empresa: DatosEmpresa },
): Promise<DocEscrito[]> {
  if (!c.indice || !ctx.docs.length) return [];
  const docx = await indiceDocx({
    archivo: c.archivo,
    expediente: plan.l.expediente,
    titulo: plan.l.titulo,
    lote: c.lote,
    empresa: ctx.empresa,
    documentos: ctx.docs.map((d) => ({ orden: d.orden, nombre: d.nombre, archivo: d.archivo })),
  });
  const { pdf } = await pdfDeDocx(docx);
  const archivo = pdf ? '00 Indice del sobre.pdf' : '00 Indice del sobre.docx';
  const h = escribirArchivo(dir, archivo, pdf ?? docx);
  return [
    {
      orden: 0,
      nombre: `Índice del ${c.archivo}`,
      clave: 'indice',
      archivo,
      origen: 'generado',
      ...h,
      estado_checklist: 'generado',
      firma: 'pendiente',
    },
  ];
}

async function escribirCarpetas(
  raices: Raices,
  plan: Plan,
  raiz: string,
  empresa: DatosEmpresa,
): Promise<ManifiestoData['carpetas']> {
  const out: ManifiestoData['carpetas'] = [];
  for (const c of plan.carpetas) {
    const dir = path.join(raiz, ...c.ruta.split('/'));
    fs.mkdirSync(dir, { recursive: true });
    const docs = await copiarDocumentos(raices, c, dir);
    const indice = await escribirIndice(plan, c, dir, { docs, empresa });
    out.push({ ruta: c.ruta, lote: c.lote, archivo: c.archivo, firma: c.firma, documentos: [...indice, ...docs] });
  }
  return out;
}

type DatosManifiesto = {
  version: number;
  ahoraMs: number;
  plazo: string | null;
  carpetas: ManifiestoData['carpetas'];
  valores: ValorATeclear[];
  comprobaciones: Comprobacion[];
};

function manifiestoDe(plan: Plan, e: DatosManifiesto): ManifiestoData {
  const plazo = { fecha_limite: plan.l.fecha_limite, texto: e.plazo, canal: plan.guion.datos.plazo.canal };
  return Manifiesto.parse({
    licitacion: { id: plan.l.id, expediente: plan.l.expediente, titulo: plan.l.titulo, organo: plan.l.organo_nombre },
    version: e.version,
    generado_en: new Date(e.ahoraMs).toISOString(),
    guion: { id: plan.guion.id, version: plan.guion.version },
    decisiones_en: plan.decisiones?.actualizada_en ?? null,
    plazo,
    lotes: plan.lotes,
    carpetas: e.carpetas,
    valores: e.valores,
    comprobaciones: e.comprobaciones,
  });
}

// Los textos del paquete (no se suben ni se firman): el manifiesto los lista con su sha256.
type TextoEscrito = { archivo: string; sha256: string; bytes: number };
type ManifiestoConTextos = ManifiestoData & { textos: TextoEscrito[] };
type Extra = { nombre: string; texto: string };
type Extras = { deuc: { sin_responder: number | null }; comprobado: string[]; no_comprobado: string[]; otros: Extra[] };

// Nunca se pisa un archivo: si el nombre ya está, «-2», «-3»…
function nombreLibre(dir: string, nombre: string): string {
  const ext = path.extname(nombre);
  const base = nombre.slice(0, nombre.length - ext.length);
  let out = nombre;
  for (let n = 2; fs.existsSync(path.join(dir, out)); n++) out = `${base}-${n}${ext}`;
  return out;
}

function escribirTexto(dir: string, nombre: string, texto: string): TextoEscrito {
  const archivo = nombreLibre(dir, nombre);
  return { archivo, ...escribirArchivo(dir, archivo, Buffer.from(texto, 'utf8')) };
}

async function escribirTextos(dir: string, m: ManifiestoData, e: Extras): Promise<ManifiestoConTextos> {
  const carpetas = m.carpetas.map((c) => ({
    ruta: c.ruta,
    firma: c.firma,
    documentos: c.documentos.map((d) => ({ archivo: d.archivo, nombre: d.nombre })),
  }));
  const instrucciones = textoInstrucciones({
    licitacion: { expediente: m.licitacion.expediente, titulo: m.licitacion.titulo, organo: m.licitacion.organo },
    version: m.version,
    plazo: m.plazo.texto,
    canal: m.plazo.canal,
    carpetas,
    comprobaciones: m.comprobaciones as Comprobacion[],
    deuc: e.deuc,
    comprobado: e.comprobado,
    no_comprobado: e.no_comprobado,
  });
  const textos = [
    escribirTexto(dir, 'INSTRUCCIONES.md', instrucciones),
    escribirTexto(dir, 'VALORES_A_TECLEAR.md', textoValores(m.valores)),
    ...e.otros.map((x) => escribirTexto(dir, x.nombre, x.texto)),
  ];
  const conTextos = { ...m, textos };
  escribirArchivo(dir, 'MANIFIESTO.json', Buffer.from(`${JSON.stringify(conTextos, null, 2)}\n`, 'utf8'));
  return conTextos;
}

// La memoria que se presenta: la del último borrador aceptado (el que memoriaPreparada pone en la
// checklist), nunca una de ensayo. Un borrador sin revisar o descartado no promete nada.
function versionAceptada(db: Db, id: string): number | null {
  const f = db
    .prepare(
      `SELECT m.version AS version FROM borradores b JOIN memorias m ON m.id = b.memoria_id
    WHERE b.licitacion_id = ? AND b.origen = 'ensamblado' AND b.estado = 'aceptada' AND m.ensayo = 0
    ORDER BY b.version DESC, b.id DESC LIMIT 1`,
    )
    .get(id) as { version: number } | undefined;
  return f?.version ?? null;
}

// Sin memoria aceptada, no hay hoja: se escribiría con promesas de una memoria que no se sube.
function hojaCompromisos(c: ContextoPaquete, plan: Plan): Extra | null {
  const version = versionAceptada(c.db, plan.l.id);
  if (version === null) return null;
  const lotes: CompromisosDeLote[] = [];
  for (const lote of plan.lotes.length ? plan.lotes : [null]) {
    const r = resumenMemoria(c.db, c.dbNucleo, plan.l.id, version, lote);
    if (r.error) {
      log.warn('hoja de compromisos sin preparar', { licitacion: plan.l.id, version, codigo: r.error.code });
      return null;
    }
    lotes.push({ lote, compromisos: r.data.compromisos });
  }
  return { nombre: `memoria-v${version}-compromisos.md`, texto: textoCompromisos(version, lotes) };
}

// La guía va también en la carpeta de la versión, junto al orden de subida, para teclear el DEUC con ella delante.
function copiaGuia(raices: Raices, ruta: string | null): Extra | null {
  const abs = ruta ? documentoEnDisco(raices, ruta) : null;
  if (!abs || abs.error || !fs.existsSync(abs.data)) return null;
  return { nombre: 'DEUC_GUIA.md', texto: fs.readFileSync(abs.data, 'utf8') };
}

// Criterios cuyas marcas se vigilan en la memoria (los automáticos de otro archivo), para «0 fugas contra N criterios».
const criteriosVigilados = (db: Db, plan: Plan): number =>
  new Set(contextoFugasDe(db, plan.guion).automaticos.map((a) => a.criterio)).size;

// Lo comprobado: lo del paquete y lo que las comprobaciones ya dan por bueno; lo no comprobado, sus filas «no comprobado» abiertas.
function comprobadoDe(
  c: ContextoPaquete,
  plan: Plan,
  cs: Comprobacion[],
  archivos: number,
): Pick<Extras, 'comprobado' | 'no_comprobado'> {
  const propio = comprobadoDelPaquete(cs, { criterios: criteriosVigilados(c.db, plan), archivos });
  const comprobaciones = comprobacionesDe(c.db, c.dbNucleo, plan.l.id);
  if (comprobaciones.error) return { comprobado: propio, no_comprobado: [NO_COMPROBABLE] };
  const abiertas = comprobaciones.data.bloqueos.filter(
    (b) => b.gravedad === 'no_comprobado' && (b.estado === 'abierto' || b.estado === 'propuesta'),
  );
  return {
    comprobado: [...propio, ...comprobaciones.data.comprobado.map((x) => x.texto)],
    no_comprobado: [NO_COMPROBABLE, ...abiertas.map((b) => b.titulo)],
  };
}

function guardarFila(db: Db, plan: Plan, v: { version: number; ruta: string; m: ManifiestoConTextos }): void {
  const cuenta = (g: string) => v.m.comprobaciones.filter((c) => c.gravedad === g).length;
  db.prepare(
    `INSERT INTO paquetes_presentacion (licitacion_id, version, ruta, guion_id, decisiones_en, manifiesto, bloqueos, avisos, creado_en)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    plan.l.id,
    v.version,
    v.ruta,
    plan.guion.id,
    plan.decisiones?.actualizada_en ?? null,
    JSON.stringify(v.m),
    cuenta('bloquea'),
    cuenta('aviso'),
    v.m.generado_en,
  );
}

export type ContextoPaquete = { db: Db; dbNucleo: DbNucleo; raices: Raices };

function empresaDe(dbNucleo: DbNucleo): DatosEmpresa {
  const p = leerPerfilEmpresa(dbNucleo)?.perfil;
  return { nombre: p?.nombre ?? null, nif: p?.nif ?? null, municipio: municipioDe(p?.domicilio) };
}

// Escribe la versión entera en su carpeta (ya creada) y guarda la fila.
type EntradaVersion = { comprobaciones: Comprobacion[]; ahoraMs: number; guia: string | null };

async function escribirVersion(
  c: ContextoPaquete,
  plan: Plan,
  v: Escritura & { version: number },
  e: EntradaVersion,
): Promise<ManifiestoConTextos> {
  const carpetas = await escribirCarpetas(c.raices, plan, v.dir, empresaDe(c.dbNucleo));
  const valores = plan.decisiones ? valoresATeclear(plan.decisiones.datos, plan.guion.datos) : [];
  const plazo = estadoPlazo(c.db, plan.l.id, e.ahoraMs)?.texto ?? null;
  const m = manifiestoDe(plan, {
    version: v.version,
    ahoraMs: e.ahoraMs,
    plazo,
    carpetas,
    valores,
    comprobaciones: e.comprobaciones,
  });
  const archivos = carpetas.reduce((n, x) => n + x.documentos.length, 0);
  const otros = [hojaCompromisos(c, plan), copiaGuia(c.raices, e.guia)].filter((x): x is Extra => x !== null);
  const conTextos = await escribirTextos(v.dir, m, {
    deuc: { sin_responder: infoDeuc(c.db, plan.l.id).sin_responder?.length ?? null },
    ...comprobadoDe(c, plan, e.comprobaciones, archivos),
    otros,
  });
  guardarFila(c.db, plan, { version: v.version, ruta: v.rel, m: conTextos });
  return conTextos;
}

// Sin guía (la oferta no pide DEUC, falta Salidas…) el paquete sale igual: la guía no es parte de lo que se sube.
function guiaAntesDelPaquete(c: ContextoPaquete, id: string, ahoraMs: number): string | null {
  const g = escribirGuiaDeuc(c, id, ahoraMs);
  if (g.error && g.error.code !== 'conflicto')
    log.warn('guía del DEUC sin preparar', { licitacion: id, codigo: g.error.code });
  return g.data?.ruta ?? null;
}

const cuantas = (cs: Comprobacion[], g: Comprobacion['gravedad']) => cs.filter((x) => x.gravedad === g).length;

/**
 * Genera una versión nueva del paquete (también con bloqueos, marcada «NO PRESENTABLE
 * TODAVÍA»). Ante un error de disco borra solo la carpeta de esta versión.
 */
export async function generarPaquete(
  c: ContextoPaquete,
  id: string,
  ahoraMs = Date.now(),
): Promise<Result<PaqueteGenerado>> {
  if (!c.raices.salidas)
    return fail('no_configurado', 'Falta SALIDAS_DIR en el servidor: el paquete se escribe en Salidas.');
  // Generar escribe: la checklist se pone al día con el guion antes de montar el plan (que solo lee).
  const vigente = guionVigente(c.db, id);
  if (vigente) sincronizarDocumentos(c.db, id, vigente);
  const guia = guiaAntesDelPaquete(c, id, ahoraMs);
  const plan = planDePaquete(c.db, id);
  if (plan.error) return plan;
  const comprobaciones = await comprobacionesDelPaquete(c.db, c.raices, plan.data, ahoraMs);
  let dir: string | null = null;
  try {
    const v = carpetaVersion(c.raices, plan.data, c.db, ahoraMs);
    if (v.error) return v;
    dir = v.data.dir;
    const m = await escribirVersion(c, plan.data, v.data, { comprobaciones, ahoraMs, guia });
    const bloqueos = cuantas(comprobaciones, 'bloquea');
    emitir(c.db, {
      tipo: 'licitacion.guion',
      dominio: 'licitaciones',
      recurso: id,
      datos: { accion: 'paquete', version: m.version, bloqueos },
    });
    log.info('paquete de presentación generado', {
      licitacion: id,
      version: m.version,
      carpetas: m.carpetas.length,
      bloqueos,
    });
    return ok({
      version: m.version,
      ruta: v.data.rel,
      bloqueos,
      avisos: cuantas(comprobaciones, 'aviso'),
      manifiesto: m,
    });
  } catch (err) {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    return fail('io_error', `No se pudo escribir el paquete en Salidas: ${errorMessage(err).slice(0, 300)}`);
  }
}

export { Manifiesto, paqueteVigente, type PaqueteVigente } from './paqueteManifiesto.js';

// ── Lo que ven la web y los agentes ──

// Lo que precarga «Registrar presentación del paquete»: una fila por lote con precio decidido y aún sin propuesta.
type FilaRegistro = {
  lote: string;
  importe_ofertado: number | null;
  presupuesto: number | null;
  unidad: string | null;
  precio_unitario: number | null;
};
export type EstadoPaquete = {
  vigente: PaqueteVigente | null;
  comprobaciones: Comprobacion[];
  registro: FilaRegistro[];
};

// Contra qué se mide la baja al registrar: el precio máximo (una línea), Σ máximo × cantidad (varias) o el presupuesto del lote.
function referenciaRegistro(
  oe: OfertaEconomicaLoteData | null,
  lote: string | null,
  presupuestos: Record<string, number | null>,
): number | null {
  const lineas = oe?.precios_unitarios ?? [];
  if (lineas.length === 1) return lineas[0]!.maximo;
  if (lineas.length)
    return lineas.reduce<number | null>(
      (t, l) => (t === null || l.maximo === null || l.cantidad === null ? null : t + l.maximo * l.cantidad),
      0,
    );
  const propia = lote !== null && oe?.lotes.length === 1 && oe.lotes[0] === lote ? oe.presupuesto_base : null;
  return propia ?? (lote !== null ? (presupuestos[lote] ?? null) : null) ?? oe?.presupuesto_base ?? null;
}

function registroDe(db: Db, plan: Plan): FilaRegistro[] {
  const d = plan.decisiones?.datos;
  if (!d) return [];
  const presupuestos = presupuestosDeLotes(db, plan.l.id);
  // Los lotes que ya tienen propuesta no se vuelven a ofrecer: un registro a medias se puede terminar.
  const hechos = new Set(
    (db.prepare('SELECT lote FROM propuestas WHERE licitacion_id = ?').all(plan.l.id) as { lote: string | null }[]).map(
      (p) => p.lote ?? '',
    ),
  );
  return d.ofertas
    .filter((o) => !o.pendiente && !hechos.has(o.lote ?? ''))
    .map((o) => {
      const oe = ofertaDeLote(plan.guion.datos, o.lote);
      const una = oe?.precios_unitarios.length === 1 ? oe.precios_unitarios[0]! : null;
      const precio = una ? (o.unitarios.find((u) => u.concepto === una.concepto)?.precio ?? null) : null;
      return {
        lote: o.lote ?? '',
        importe_ofertado: importeDeLote(o, oe),
        presupuesto: referenciaRegistro(oe, o.lote, presupuestos),
        unidad: una && precio !== null ? una.unidad : null,
        precio_unitario: precio,
      };
    });
}

/** El paquete vigente, las comprobaciones recalculadas (sin escribir nada) y la precarga del registro de la presentación. */
export async function estadoPaquete(
  db: Db,
  raices: Raices,
  id: string,
  ahoraMs = Date.now(),
): Promise<Result<EstadoPaquete>> {
  const plan = planDePaquete(db, id);
  if (plan.error) return plan;
  return ok({
    vigente: paqueteVigente(db, id),
    comprobaciones: await comprobacionesDelPaquete(db, raices, plan.data, ahoraMs),
    registro: registroDe(db, plan.data),
  });
}

const SIN_IMPORTE = 'ver VALORES_A_TECLEAR.md';

type ConteoLote = { bloquea: number; avisos: number };

/** Bloqueos y avisos por lote, agrupados por la carpeta de «donde» («Lote 3/…»); lo demás es «comun». */
export function conteoPorLote(comprobaciones: readonly Comprobacion[]): Record<string, ConteoLote> {
  const out: Record<string, ConteoLote> = {};
  for (const c of comprobaciones) {
    const lote = c.donde?.match(/^Lote ([^/]+)\//)?.[1] ?? 'comun';
    const fila = (out[lote] ??= { bloquea: 0, avisos: 0 });
    if (c.gravedad === 'bloquea') fila.bloquea += 1;
    else fila.avisos += 1;
  }
  return out;
}

// El veredicto de las comprobaciones viaja con el paquete para que el agente no tenga que pedirla aparte;
// si no se puede calcular, el paquete sale igual sin él.
function veredictoComprobaciones(db: Db, id: string): { tipo: string; texto: string } | null {
  const c = comprobacionesDe(db, nucleo().db, id);
  return c.error ? null : c.data.veredicto;
}

/**
 * El paquete para un agente: el manifiesto vigente sin importes (los valores económicos dicen
 * dónde están), las comprobaciones de ahora y el texto de INSTRUCCIONES.md.
 */
export async function paqueteParaAgente(db: Db, raices: Raices, id: string): Promise<Result<unknown>> {
  const e = await estadoPaquete(db, raices, id);
  if (e.error) return e;
  const v = e.data.vigente;
  const veredicto = veredictoComprobaciones(db, id);
  const por_lote = conteoPorLote(e.data.comprobaciones);
  if (!v)
    return ok({
      id,
      veredicto,
      por_lote,
      vigente: null,
      comprobaciones: e.data.comprobaciones,
      nota: 'Aún no hay paquete de presentación: lo genera una persona en el paso 4 de la web.',
    });
  const valores = v.manifiesto.valores.map((x) => (x.economico ? { ...x, valor: SIN_IMPORTE } : x));
  const abs = documentoEnDisco(raices, `${v.ruta}/INSTRUCCIONES.md`);
  const instrucciones = !abs.error && fs.existsSync(abs.data) ? await fsp.readFile(abs.data, 'utf8') : null;
  return ok({
    id,
    veredicto,
    por_lote,
    vigente: { ...v, manifiesto: { ...v.manifiesto, valores } },
    comprobaciones: e.data.comprobaciones,
    instrucciones,
  });
}
