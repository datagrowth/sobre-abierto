// Análisis de los modelos de anexo que vienen en PDF, hecho una vez por archivo y modelo y guardado en modelos_pdf.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { carpetaConversiones } from '../../../nucleo/documentos/conversiones.js';
import { camposDePdf, type CampoPdf } from '../../../nucleo/documentos/formularioPdf.js';
import {
  docxDeParrafos,
  paginasDePdf,
  parrafosDePaginas,
  type ParrafoPdf,
} from '../../../nucleo/documentos/modeloPdf.js';
import { huecosDe, type Parrafo } from '../../../nucleo/documentos/rellenar.js';
import { logger } from '../../../nucleo/log.js';
import { errorMessage, fail, ok, type Result } from '../../../nucleo/result.js';
import type { Raices } from '../../../nucleo/salidas.js';
import type { Db } from '../store.js';
import { textoComparable } from '../temas.js';
import { modeloBuscado, modeloDe } from './anexosModelo.js';
import { AVISO_TABLA, docxDeTablaRequisitos, tablaDeRequisitos } from './tablaRequisitos.js';
import { documentosDelGuion, type DocumentoConClave } from './documentos.js';
import { guionVigente } from './guion.js';
import { licitacionesEnPreparacion } from './plazo.js';

const log = logger('licitaciones');
const comparable = (t: string) => textoComparable(t).replace(/\s+/g, ' ').trim();

/** Cuántos modelos PDF se analizan como mucho en una vuelta: cada uno cuesta segundos. */
export const MAX_ANALISIS_POR_VUELTA = 5;
// Se hace en la vuelta de la oferta. El resultado es «campos» (formulario AcroForm que se rellena campo a
// campo), «transcrito» (sin campos, pero el tramo del modelo tiene huecos: se transcribe a un .docx que se
// rellena como un Word; también una tabla de requisitos sin huecos, rehecha como .docx propio en
// tablaRequisitos.ts) o «a_mano» con el motivo. Leer y transcribir un PDF cuesta segundos, así que la checklist
// (GET /oferta/documentos) solo lee lo guardado.
/** Un tramo más largo no es un modelo que rellenar (suele ser un pliego entero o una tabla de requisitos). */
const MAX_PAGINAS_TRAMO = 6;

/**
 * Versión del análisis: súbela cuando cambie lo que sale de analizar un PDF (p. ej. la tabla de
 * requisitos) y las filas guardadas con una anterior se vuelven a analizar solas.
 */
export const VERSION_ANALISIS_MODELOS = 2;

export type TipoModeloPdf = 'campos' | 'transcrito' | 'a_mano';
export type ModeloPdf = {
  // motivo: por qué va a mano o, en un transcrito de una tabla de requisitos, AVISO_TABLA.
  ruta: string;
  sha256: string;
  modelo: string;
  tipo: TipoModeloPdf;
  motivo: string | null;
  desde_pagina: number | null;
  hasta_pagina: number | null;
  docx: string | null;
  analizado_en: string;
  version_analisis: number;
};

// ── Los campos del formulario y el tramo del modelo ──

// Leer los campos de un PDF cuesta y la checklist los pide en cada carga: se recuerdan mientras el archivo no cambie.
const camposPorArchivo = new Map<string, { mtimeMs: number; size: number; campos: Result<CampoPdf[]> }>();

export async function camposDelModelo(abs: string): Promise<Result<CampoPdf[]>> {
  try {
    const st = await fsp.stat(abs);
    const previo = camposPorArchivo.get(abs);
    if (previo && previo.mtimeMs === st.mtimeMs && previo.size === st.size) return previo.campos;
    const campos = await camposDePdf(await fsp.readFile(abs));
    if (camposPorArchivo.size >= 200) camposPorArchivo.clear();
    camposPorArchivo.set(abs, { mtimeMs: st.mtimeMs, size: st.size, campos });
    return campos;
  } catch (err) {
    return fail('io_error', `No se pudo leer el modelo: ${errorMessage(err)}`);
  }
}

/** Un campo que se puede rellenar: ni firma ni de solo lectura. */
export const rellenable = (c: CampoPdf) => !c.es_firma && !c.solo_lectura && c.tipo !== 'boton';

// La clave del número («Anexo III Bis» → «iii bis»): el «Anexo III» no es el «Anexo III Bis».
const NUMERO = /^anexo\s+([ivxlcdm]+|\d+)((?:\.\d+)*)(\s*bis)?\b/;
const numeroDe = (t: string) => {
  const m = NUMERO.exec(comparable(t));
  return m ? `${m[1]}${m[2] ?? ''}${m[3] ? ' bis' : ''}` : null;
};

/** Si el texto empieza por el nombre del modelo («ANEXO VII. Proposición…» para «Anexo VII»), sin confundir el VII con el VI ni el III con el III Bis. */
export function empiezaPor(texto: string, modelo: string): boolean {
  const t = comparable(texto);
  const m = comparable(modelo);
  if (!t.startsWith(m) || /[a-z0-9]/.test(t.charAt(m.length))) return false;
  const n = numeroDe(modelo);
  return n === null || numeroDe(texto) === n;
}

type Tramo = { desde: number; hasta: number; huecos: number };

/** Cada tramo que empieza por el nombre del modelo, hasta antes del siguiente «ANEXO …» (el índice también da uno). */
function tramosDelModelo(parrafos: Parrafo[], modelo: string): Tramo[] {
  return parrafos
    .filter((p) => empiezaPor(p.texto, modelo))
    .map((p) => {
      const siguiente = parrafos.find(
        (x) => x.indice > p.indice && /^anexo\b/.test(comparable(x.texto)) && !empiezaPor(x.texto, modelo),
      );
      const dentro = parrafos.filter((x) => x.indice >= p.indice && (!siguiente || x.indice < siguiente.indice));
      return { desde: p.indice, hasta: dentro.at(-1)!.indice, huecos: dentro.reduce((n, x) => n + x.huecos.length, 0) };
    });
}

/**
 * Dónde está un modelo en el documento de anexos: desde un párrafo que empieza por su nombre
 * («ANEXO VII») hasta antes del siguiente «ANEXO …». Si el nombre sale también en el índice,
 * gana el tramo con más huecos.
 */
export function localizarModelo(parrafos: Parrafo[], modelo: string): { desde: number; hasta: number } | null {
  const mejor = tramosDelModelo(parrafos, modelo).reduce<Tramo | null>(
    (m, t) => (!m || t.huecos >= m.huecos ? t : m),
    null,
  );
  return mejor ? { desde: mejor.desde, hasta: mejor.hasta } : null;
}

// ── El tramo del modelo en un PDF sin campos ──

// La entrada de índice («ANEXO II DECLARACIÓN …… 98») no es un hueco: sus puntos llevan al número de página.
const ENTRADA_DE_INDICE = /\s*[.…]{4,}\s*\d{1,4}\s*$/u;
const comoParrafo = (p: ParrafoPdf): Parrafo => ({
  indice: p.indice,
  texto: p.texto,
  en_tabla: false,
  huecos: huecosDe(p.texto.replace(ENTRADA_DE_INDICE, '')),
});

type Elegido = { parrafos: ParrafoPdf[]; desde: number; hasta: number; huecos: number };

// La cabecera de la página donde empieza el anexo siguiente («Expediente …», «- 99 -») no es del modelo.
function sinCabeceraSiguiente(dentro: ParrafoPdf[], siguiente: ParrafoPdf | undefined): ParrafoPdf[] {
  if (!siguiente || dentro[0]!.pagina === siguiente.pagina) return dentro;
  return dentro.filter((p) => p.pagina !== siguiente.pagina);
}

// Cada tramo del modelo con sus párrafos del PDF y sus páginas.
function tramosConPaginas(parrafos: ParrafoPdf[], modelo: string): Elegido[] {
  return tramosDelModelo(parrafos.map(comoParrafo), modelo).map((t) => {
    const dentro = sinCabeceraSiguiente(
      parrafos.filter((p) => p.indice >= t.desde && p.indice <= t.hasta),
      parrafos.find((p) => p.indice === t.hasta + 1),
    );
    return { parrafos: dentro, desde: dentro[0]!.pagina, hasta: dentro.at(-1)!.pagina, huecos: t.huecos };
  });
}

const contiene = (t: Elegido, pagina: number | null) => pagina !== null && t.desde <= pagina && pagina <= t.hasta;

// El tramo con huecos que contiene la página que cita el guion o, si no, el de más huecos: la
// página citada puede ser la del índice, cuya entrada no tiene huecos.
function tramoElegido(conPaginas: Elegido[], pagina: number | null): Elegido | null {
  const citado = conPaginas.find((t) => t.huecos > 0 && contiene(t, pagina));
  return citado ?? conPaginas.reduce<Elegido | null>((m, t) => (!m || t.huecos >= m.huecos ? t : m), null);
}

const slug = (t: string) =>
  comparable(t)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'modelo';

// A un temporal y renombrado, como las conversiones: nadie lee un .docx a medio escribir.
async function guardarTranscrito(bytes: Buffer, sha256: string, modelo: string): Promise<Result<string>> {
  const carpeta = path.join(carpetaConversiones(), 'transcritos');
  const destino = path.join(carpeta, `${sha256.slice(0, 16)}-${slug(modelo)}.docx`);
  try {
    await fsp.mkdir(carpeta, { recursive: true });
    const parcial = `${destino}.${process.pid}.tmp`;
    await fsp.writeFile(parcial, bytes);
    await fsp.rename(parcial, destino);
    return ok(destino);
  } catch (err) {
    return fail('io_error', `No se pudo guardar la transcripción del modelo: ${errorMessage(err)}`);
  }
}

type Analisis = Pick<ModeloPdf, 'tipo' | 'motivo' | 'desde_pagina' | 'hasta_pagina' | 'docx'>;
const aMano = (motivo: string): Analisis => ({
  tipo: 'a_mano',
  motivo,
  desde_pagina: null,
  hasta_pagina: null,
  docx: null,
});

type AnalizarTramo = { modelo: string; pagina: number | null; documento: string; sha256: string };

// Un tramo sin huecos o demasiado largo puede ser una tabla de requisitos: se rehace como .docx
// propio (antes el tramo de la página citada). Si ninguno lo es, va a mano con su motivo.
async function comoTabla(tramos: Elegido[], x: AnalizarTramo, motivo: string): Promise<Result<Analisis>> {
  const orden = [...tramos].sort((a, b) => Number(contiene(b, x.pagina)) - Number(contiene(a, x.pagina)));
  const t = orden.map((tramo) => ({ tramo, tabla: tablaDeRequisitos(tramo.parrafos) })).find((c) => c.tabla);
  if (!t?.tabla) return ok(aMano(motivo));
  const docx = await docxDeTablaRequisitos(t.tabla, x.modelo);
  if (docx.error)
    return ok(
      aMano(
        `No se pudo rehacer la tabla de «${x.modelo}» de «${x.documento}» (${docx.error.message}): rellénalo a mano.`,
      ),
    );
  const ruta = await guardarTranscrito(docx.data, x.sha256, x.modelo);
  if (ruta.error) return ruta;
  return ok({
    tipo: 'transcrito',
    motivo: AVISO_TABLA,
    desde_pagina: t.tramo.desde,
    hasta_pagina: t.tramo.hasta,
    docx: ruta.data,
  });
}

async function transcribir(bytes: Uint8Array, x: AnalizarTramo): Promise<Result<Analisis>> {
  const paginas = await paginasDePdf(bytes);
  if (paginas.error) return ok(aMano(paginas.error.message));
  const tramos = tramosConPaginas(parrafosDePaginas(paginas.data), x.modelo);
  const t = tramoElegido(tramos, x.pagina);
  if (!t || t.huecos === 0)
    return comoTabla(tramos, x, `No encuentro «${x.modelo}» con huecos en «${x.documento}»: rellénalo a mano.`);
  if (t.hasta - t.desde + 1 > MAX_PAGINAS_TRAMO)
    return comoTabla(
      tramos,
      x,
      `El tramo de «${x.modelo}» ocupa más de ${MAX_PAGINAS_TRAMO} páginas: rellénalo a mano.`,
    );
  const docx = await docxDeParrafos(
    t.parrafos.map((p, i) => ({ ...p, indice: i + 1 })),
    x.modelo,
  );
  // Un tramo que no se puede escribir como .docx no saldrá mejor en la vuelta siguiente.
  if (docx.error)
    return ok(
      aMano(`No se pudo transcribir «${x.modelo}» de «${x.documento}» (${docx.error.message}): rellénalo a mano.`),
    );
  const ruta = await guardarTranscrito(docx.data, x.sha256, x.modelo);
  if (ruta.error) return ruta;
  return ok({ tipo: 'transcrito', motivo: null, desde_pagina: t.desde, hasta_pagina: t.hasta, docx: ruta.data });
}

// ── Guardado ──

const claveModelo = (modelo: string) => comparable(modelo);

function guardar(db: Db, m: ModeloPdf): void {
  db.prepare(
    `INSERT INTO modelos_pdf (ruta, sha256, modelo, tipo, motivo, desde_pagina, hasta_pagina, docx, analizado_en, version_analisis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (ruta, sha256, modelo) DO UPDATE SET tipo = excluded.tipo, motivo = excluded.motivo, desde_pagina = excluded.desde_pagina,
      hasta_pagina = excluded.hasta_pagina, docx = excluded.docx, analizado_en = excluded.analizado_en, version_analisis = excluded.version_analisis`,
  ).run(
    m.ruta,
    m.sha256,
    m.modelo,
    m.tipo,
    m.motivo,
    m.desde_pagina,
    m.hasta_pagina,
    m.docx,
    m.analizado_en,
    m.version_analisis,
  );
}

/** El análisis guardado de un modelo dentro de un PDF (por su ruta en Conocimiento, su sha256 y el nombre del modelo), o null. Solo lee. */
export function modeloPdfGuardado(db: Db, ruta: string, sha256: string, modelo: string): ModeloPdf | null {
  return (
    (db
      .prepare(
        'SELECT ruta, sha256, modelo, tipo, motivo, desde_pagina, hasta_pagina, docx, analizado_en, version_analisis FROM modelos_pdf WHERE ruta = ? AND sha256 = ? AND modelo = ?',
      )
      .get(ruta, sha256, claveModelo(modelo)) as ModeloPdf | undefined) ?? null
  );
}

/** Analiza el modelo del documento dentro de su PDF (formulario, tramo transcrito o a mano) y lo guarda. */
export async function analizarModeloPdf(
  db: Db,
  x: { id: string; d: DocumentoConClave; abs: string; ruta: string; sha256: string },
): Promise<Result<ModeloPdf>> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await fsp.readFile(x.abs));
  } catch (err) {
    return fail('io_error', `No se pudo leer el modelo: ${errorMessage(err)}`);
  }
  const modelo = modeloBuscado(x.d);
  const campos = await camposDelModelo(x.abs);
  const analisis: Result<Analisis> = campos.data?.some(rellenable)
    ? ok({ tipo: 'campos', motivo: null, desde_pagina: null, hasta_pagina: null, docx: null })
    : await transcribir(bytes, {
        modelo,
        pagina: x.d.doc.origen?.pagina ?? null,
        documento: path.posix.basename(x.ruta),
        sha256: x.sha256,
      });
  if (analisis.error) return analisis;
  const m: ModeloPdf = {
    ruta: x.ruta,
    sha256: x.sha256,
    modelo: claveModelo(modelo),
    ...analisis.data,
    analizado_en: new Date().toISOString(),
    version_analisis: VERSION_ANALISIS_MODELOS,
  };
  guardar(db, m);
  if (analizadosAhora.size >= 500) analizadosAhora.clear();
  analizadosAhora.add(claveFallo(x.ruta, x.sha256, modelo));
  log.info('modelo PDF analizado', {
    licitacion: x.id,
    clave: x.d.clave,
    tipo: m.tipo,
    desde: m.desde_pagina,
    hasta: m.hasta_pagina,
  });
  return ok(m);
}

// ── La vuelta ──

// El sha256 del archivo, recordado mientras no cambie: la vuelta lo mira cada minuto.
const huellas = new Map<string, { mtimeMs: number; size: number; sha256: string }>();

/** El sha256 que calculó la vuelta si el archivo no cambió desde entonces, o null. Síncrono y sin leer el archivo: es para la checklist y la cadena. */
export function huellaRecordada(abs: string): string | null {
  const previa = huellas.get(abs);
  const st = previa ? fs.statSync(abs, { throwIfNoEntry: false }) : undefined;
  return previa && st && previa.mtimeMs === st.mtimeMs && previa.size === st.size ? previa.sha256 : null;
}

/** El sha256 de un archivo (recordado mientras no cambien su fecha ni su tamaño). */
export async function huellaDeArchivo(abs: string): Promise<Result<string>> {
  try {
    const st = await fsp.stat(abs);
    const previa = huellas.get(abs);
    if (previa && previa.mtimeMs === st.mtimeMs && previa.size === st.size) return ok(previa.sha256);
    const sha256 = crypto
      .createHash('sha256')
      .update(await fsp.readFile(abs))
      .digest('hex');
    if (huellas.size >= 500) huellas.clear();
    huellas.set(abs, { mtimeMs: st.mtimeMs, size: st.size, sha256 });
    return ok(sha256);
  } catch (err) {
    return fail('io_error', `No se pudo leer el modelo: ${errorMessage(err)}`);
  }
}

type Pendiente = { id: string; d: DocumentoConClave; abs: string; ruta: string; sha256: string };

// Un fallo pasajero (leer el PDF, escribir la transcripción) se reintenta pasado un rato: mientras,
// ese modelo sale de la cola para que no ocupe el cupo de la vuelta de los de otras licitaciones.
export const REINTENTO_MS = 15 * 60_000;
const fallos = new Map<string, { hastaMs: number; motivo: string }>();
const claveFallo = (ruta: string, sha256: string, modelo: string) => `${ruta}|${sha256}|${claveModelo(modelo)}`;
// Los modelos analizados en este proceso, con el código de ahora (ver yaAnalizado).
const analizadosAhora = new Set<string>();

/** Por qué falló hace poco el análisis de ese modelo (se reintenta en la vuelta pasado REINTENTO_MS), o null. */
export function falloDeAnalisis(ruta: string, sha256: string, modelo: string, ahoraMs = Date.now()): string | null {
  const f = fallos.get(claveFallo(ruta, sha256, modelo));
  return f && f.hastaMs > ahoraMs ? f.motivo : null;
}

function anotarFallo(p: Pendiente, motivo: string, ahoraMs: number): void {
  if (fallos.size >= 500) fallos.clear();
  fallos.set(claveFallo(p.ruta, p.sha256, modeloBuscado(p.d)), { hastaMs: ahoraMs + REINTENTO_MS, motivo });
}

// El documento con su modelo .pdf y su huella, o null si no es un PDF (o no se puede leer).
async function conHuella(db: Db, raices: Raices, id: string, d: DocumentoConClave): Promise<Pendiente | null> {
  const m = d.doc.tipo === 'deuc' ? null : modeloDe(db, raices, id, d);
  if (!m?.data || m.data.ext !== '.pdf') return null;
  const sha256 = await huellaDeArchivo(m.data.abs);
  return sha256.error ? null : { id, d, abs: m.data.abs, ruta: m.data.ruta, sha256: sha256.data };
}

// Una fila analizada con una versión anterior del análisis se vuelve a analizar sola (un anexo
// pudo quedar «a_mano» antes de probarlo como tabla de requisitos), sin borrar filas a mano.
// Además, un «a_mano» por falta de huecos o por largo se repite una vez por proceso: la versión no
// distingue lo guardado por otro proceso con el mismo código. Si sigue sin ser tabla, queda «a_mano».
const MOTIVOS_DE_TABLA = [/^No encuentro «.*» con huecos en «/u, /^El tramo de «.*» ocupa más de \d+ páginas/u];

function yaAnalizado(db: Db, p: Pendiente, clave: string): boolean {
  const m = modeloPdfGuardado(db, p.ruta, p.sha256, modeloBuscado(p.d));
  if (!m) return false;
  if (m.version_analisis < VERSION_ANALISIS_MODELOS) return false;
  return m.tipo !== 'a_mano' || !MOTIVOS_DE_TABLA.some((r) => r.test(m.motivo ?? '')) || analizadosAhora.has(clave);
}

// Los documentos del guion vigente con un modelo .pdf sin analizar ni fallido hace poco (uno por archivo y modelo).
async function pendientesDe(db: Db, raices: Raices, id: string, ahoraMs: number): Promise<Pendiente[]> {
  const g = guionVigente(db, id);
  const vistos = new Set<string>();
  const out: Pendiente[] = [];
  for (const d of g ? documentosDelGuion(g.datos) : []) {
    const p = await conHuella(db, raices, id, d);
    const clave = p ? claveFallo(p.ruta, p.sha256, modeloBuscado(d)) : '';
    if (
      !p ||
      vistos.has(clave) ||
      falloDeAnalisis(p.ruta, p.sha256, modeloBuscado(d), ahoraMs) ||
      yaAnalizado(db, p, clave)
    )
      continue;
    vistos.add(clave);
    out.push(p);
  }
  return out;
}

/**
 * En cada vuelta: analiza los modelos PDF de las licitaciones en preparación que aún no están
 * en modelos_pdf (un archivo cambiado tiene otro sha256 y se analiza de nuevo), como mucho
 * MAX_ANALISIS_POR_VUELTA; uno que falló espera REINTENTO_MS. Devuelve cuántos intentó.
 */
export async function prepararModelosPdf(dbLic: Db, raices: Raices, ahoraMs = Date.now()): Promise<number> {
  if (!raices.conocimiento) return 0;
  const cola: Pendiente[] = [];
  for (const l of licitacionesEnPreparacion(dbLic, ahoraMs)) {
    if (cola.length >= MAX_ANALISIS_POR_VUELTA) break;
    cola.push(...(await pendientesDe(dbLic, raices, l.id, ahoraMs)));
  }
  const lote = cola.slice(0, MAX_ANALISIS_POR_VUELTA);
  for (const p of lote) {
    const r = await analizarModeloPdf(dbLic, p);
    if (!r.error) continue;
    anotarFallo(p, r.error.message, ahoraMs);
    log.warn('modelo PDF sin analizar: se reintenta más tarde', {
      licitacion: p.id,
      clave: p.d.clave,
      error: r.error.message,
    });
  }
  if (lote.length) log.info('modelos PDF analizados', { modelos: lote.length });
  return lote.length;
}
