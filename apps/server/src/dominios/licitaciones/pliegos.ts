// Pliegos de las oportunidades que pasan la criba: se bajan de la PLACSP a Conocimiento/Licitaciones/Radar.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { esUrlDePliego } from './placsp/fuentes.js';
import type { Db, FilaLicitacion } from './store.js';
import { ahora } from '../../nucleo/db.js';
import { errorMessage, fail, ok, type Result } from '../../nucleo/result.js';
import { logger } from '../../nucleo/log.js';
import { limpiarNombre } from '../../nucleo/nombres.js';
import { guardarDocumentoNuevo, type DocumentoGuardado } from '../../nucleo/documentos.js';
import { carpetaDe } from './carpetas.js';
import { CARPETA_PLIEGOS, esperaPorCarpeta, rutaPresentada } from './presentadas.js';
import { anotarDescarte, descartarSola, QUIEN_AUTOMATICO } from './gonogo.js';
import { TIPO_FICHA } from './ficha.js';
import { emitir } from '../../nucleo/eventos.js';
import { horaLocalEspana } from '../../nucleo/fechas.js';
import { USER_AGENT } from '../../nucleo/http.js';
import { leerConTope, pedirPermitida } from './placsp/descarga.js';
import { carpetaUnicaEnDb, SUBCARPETAS_UNICA } from './carpetasUnicas.js';

// Se bajan a Conocimiento/Licitaciones/Radar/<año>/<expediente> (id)/ (o a la carpeta PLIEGOS de lo presentado,
// si ya la tiene, o junto a los que ya bajó), desde donde drive-sync los sube a Drive y la Biblioteca los
// indexa. Nunca se pisa un archivo que ya esté en la carpeta (tampoco datos.json: se escribe solo si no
// existe); cada pliego queda registrado con su hash y su origen. Un ZIP publicado se descomprime: cada documento
// de dentro es un pliego más (origen «zip», con la URL del ZIP).
// Los anexos que la descarga básica acepta por su nombre: los que la Biblioteca lee.
const EXTENSIONES = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.odt', '.ods', '.odp']);
// Lo que tipoDeDocumento reconoce por los bytes: si el nombre dice otra de estas, manda lo que es.
const TIPOS_POR_BYTES = new Set([...EXTENSIONES, '.xml', '.zip', '.rtf', '.png', '.jpg', '.jpeg', '.7z', '.rar']);
// Una extensión de verdad («.bc3», «.xml»), no el final de «v1.2 informe» ni de «Exp.2026».
const EXTENSION_REAL = /^\.[a-z][a-z0-9]{0,4}$/;
const POR_CONTENT_TYPE: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};
const MAX_POR_LICITACION = 8;
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_INTENTOS = 3;
const TIMEOUT_MS = 5 * 60_000;
const log = logger('licitaciones.pliegos');

export type ClaseDocumento = 'pcap' | 'ppt' | 'adicional' | 'otro' | 'anuncio';
export type DocumentoFeed = { clase: ClaseDocumento; nombre: string; url: string };

function extension(nombre: string): string {
  return path.extname(nombre).toLowerCase();
}

const ORDEN_CLASE: Record<ClaseDocumento, number> = { pcap: 0, ppt: 1, adicional: 2, otro: 3, anuncio: 4 };

/** Lo que publica el feed de una licitación, cada URL una vez (también lo que no se puede bajar). */
export function documentosDelFeed(datos: string): DocumentoFeed[] {
  const docs = (JSON.parse(datos) as { documentos?: DocumentoFeed[] }).documentos ?? [];
  return docs.filter((d, i) => d.url && docs.findIndex((x) => x.url === d.url) === i);
}

/**
 * Los pliegos que se bajan de una licitación (de la PLACSP o de una plataforma admitida). En
 * la descarga básica (lo nuevo, lo justo para la ficha): PCAP y PPT primero, luego los anexos
 * con extensión legible, hasta MAX_POR_LICITACION. En la completa (en preparación o con la
 * ficha pedida): todo lo publicado, sin tope y con cualquier extensión (el tipo lo dicen los
 * bytes al bajarlo). La misma elegibilidad decide qué entra en cola y si hay algo que bajar.
 */
function pliegosElegibles(datos: string, completa = false): DocumentoFeed[] {
  const docs = documentosDelFeed(datos)
    .filter((d) => esUrlDePliego(d.url))
    .sort((a, b) => (ORDEN_CLASE[a.clase] ?? 9) - (ORDEN_CLASE[b.clase] ?? 9));
  if (completa) return docs;
  return docs
    .filter(
      (d) =>
        d.clase === 'pcap' || d.clase === 'ppt' || (d.clase === 'adicional' && EXTENSIONES.has(extension(d.nombre))),
    )
    .slice(0, MAX_POR_LICITACION);
}

// Descarga completa: lo que la empresa prepara y lo que tiene la ficha pedida (Hermes la está leyendo o
// ya la leyó, y una nota de rectificación o un anexo con criterios cambian lo que dice). Los
// trabajos de ficha se buscan por rango de su clave única, como en ficha.ts: corre cada minuto.
const SQL_COMPLETA = `(o.estado = 'en_preparacion'
  OR EXISTS (SELECT 1 FROM fichas f WHERE f.licitacion_id = o.licitacion_id)
  OR EXISTS (SELECT 1 FROM nucleo.trabajos_ia t WHERE t.tipo = @tipoFicha
    AND ((t.clave >= 'ficha-' || o.licitacion_id || '-' AND t.clave < 'ficha-' || o.licitacion_id || '.')
      OR (t.clave >= 'ficha-auto-' || o.licitacion_id AND t.clave < 'ficha-auto-' || o.licitacion_id || '.'))))`;

/** Si a una licitación le toca la descarga completa: todo lo que publica, sin tope. */
export function descargaCompleta(db: Db, id: string): boolean {
  return Boolean(
    db
      .prepare(`SELECT 1 FROM oportunidades o WHERE o.licitacion_id = @id AND ${SQL_COMPLETA}`)
      .get({ id, tipoFicha: TIPO_FICHA }),
  );
}

// Para encolar muchas licitaciones en una vuelta: los statements se preparan una vez por llamada.
function encoladorDePliegos(db: Db): (id: string) => number {
  const leer =
    db.prepare(`SELECT l.datos, EXISTS (SELECT 1 FROM oportunidades o WHERE o.licitacion_id = l.id AND ${SQL_COMPLETA}) AS completa
    FROM licitaciones l WHERE l.id = @id`);
  const insertar = db.prepare(`INSERT OR IGNORE INTO pliegos (licitacion_id, url, clase, nombre, estado, actualizado_en)
    VALUES (?, ?, ?, ?, 'pendiente', ?)`);
  return (id) => {
    const row = leer.get({ id, tipoFicha: TIPO_FICHA }) as { datos: string; completa: number } | undefined;
    if (!row) return 0;
    return pliegosElegibles(row.datos, row.completa === 1).reduce(
      (n, d) => n + insertar.run(id, d.url, d.clase, d.nombre, ahora()).changes,
      0,
    );
  };
}

/** Deja en cola los pliegos de una licitación: PCAP y PPT primero, luego el resto (todo, si le toca la descarga completa). */
export function encolarPliegos(db: Db, id: string): number {
  return encoladorDePliegos(db)(id);
}

/**
 * Pone en cola los pliegos de lo que sigue la empresa que aún no lo estén: los que la PLACSP publica
 * después de la criba y los de oportunidades que no pasaron por ella (seguidas o recuperadas
 * a mano). Solo nueva en plazo y en preparación: lo descartado, lo cerrado y lo presentado
 * (su plazo ya pasó; si no, la lista crecería para siempre) no. Devuelve cuántos entran.
 */
export function encolarPliegosNuevos(db: Db, ahoraIso = new Date().toISOString()): number {
  const ids = db
    .prepare(
      `SELECT o.licitacion_id AS id FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'en_preparacion' OR (o.estado = 'nueva' AND (l.fecha_limite IS NULL OR l.fecha_limite > ?))`,
    )
    .all(horaLocalEspana(Date.parse(ahoraIso))) as { id: string }[];
  const encolar = encoladorDePliegos(db);
  return ids.reduce((n, { id }) => n + encolar(id), 0);
}

// El texto marca el descarte para poder deshacerlo cuando aparezcan los pliegos.
export const MOTIVO_SIN_PLIEGOS =
  'Sin pliegos que bajar: la plataforma no los publica en sus datos abiertos (o están en una de la que no se bajan). Si los publica, vuelve sola a Nuevas.';
const EVENTO_PLIEGOS_PUBLICADOS = 'licitacion.pliegos_publicados';

/**
 * Nuevas sin nada que bajar: sin pliegos no hay ficha y se quedarían en Nuevas para siempre.
 * Solo las que el código puede mover (nadie las tocó a mano) y sin ficha.
 */
export function descartarSinPliegos(db: Db): number {
  const filas = db
    .prepare(
      `SELECT o.licitacion_id AS id, l.datos FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'nueva' AND o.cambiada_a_mano = 0
      AND NOT EXISTS (SELECT 1 FROM fichas f WHERE f.licitacion_id = o.licitacion_id AND f.estado = 'aprobada')
      AND NOT EXISTS (SELECT 1 FROM pliegos p WHERE p.licitacion_id = o.licitacion_id)`,
    )
    .all() as { id: string; datos: string }[];
  return filas.filter(
    (f) => pliegosElegibles(f.datos).length === 0 && descartarSola(db, f.id, MOTIVO_SIN_PLIEGOS, 'pliegos'),
  ).length;
}

/** Las descartadas por no tener pliegos que ya los tienen (y siguen en plazo) vuelven a Nuevas como novedad. */
export function recuperarConPliegos(db: Db, ahoraIso = new Date().toISOString()): number {
  const filas = db
    .prepare(
      `SELECT o.licitacion_id AS id, l.datos FROM oportunidades o JOIN licitaciones l ON l.id = o.licitacion_id
    WHERE o.estado = 'descartada' AND o.descarte_automatico = 1 AND o.cambiada_a_mano = 0 AND o.motivo_descarte = ?
      AND (l.fecha_limite IS NULL OR l.fecha_limite > ?)`,
    )
    .all(MOTIVO_SIN_PLIEGOS, horaLocalEspana(Date.parse(ahoraIso))) as { id: string; datos: string }[];
  const volver =
    db.prepare(`UPDATE oportunidades SET estado = 'nueva', motivo_descarte = NULL, descarte_automatico = 0, reaparecida_en = ?, actualizada_en = ?
    WHERE licitacion_id = ? AND estado = 'descartada'`);
  const encolar = encoladorDePliegos(db);
  let n = 0;
  // La vuelta deja su fila en el historial, junto con el cambio: como el descarte que deshace.
  const recuperar = db.transaction((id: string) => {
    volver.run(ahoraIso, ahoraIso, id);
    anotarDescarte(db, id, {
      accion: 'recuperada',
      categoria: null,
      motivo: MOTIVO_SIN_PLIEGOS,
      automatico: true,
      quien: QUIEN_AUTOMATICO,
      ts: ahoraIso,
    });
  });
  for (const f of filas.filter((x) => pliegosElegibles(x.datos).length > 0)) {
    recuperar(f.id);
    encolar(f.id);
    emitir(db, {
      tipo: EVENTO_PLIEGOS_PUBLICADOS,
      dominio: 'licitaciones',
      recurso: f.id,
      datos: { de: 'descartada' },
    });
    n += 1;
  }
  return n;
}

const OFFICE_POR_CARPETA: [RegExp, string][] = [
  [/^word\//, '.docx'],
  [/^xl\//, '.xlsx'],
  [/^ppt\//, '.pptx'],
];
// Un OpenDocument empieza por la entrada «mimetype» sin comprimir: su tipo se lee tal cual.
const ODF_POR_MIME: [string, string][] = [
  ['opendocument.text', '.odt'],
  ['opendocument.spreadsheet', '.ods'],
  ['opendocument.presentation', '.odp'],
];
const MAX_ENTRADAS_MIRADAS = 2_000;

// Qué hay dentro de un ZIP sin descomprimir nada: los nombres de sus entradas.
function entradasZip(bytes: Uint8Array): string[] {
  const nombres: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        nombres.push(f.name);
        if (nombres.length >= MAX_ENTRADAS_MIRADAS) throw new Error('basta');
        return false;
      },
    });
  } catch {
    /* ZIP roto o con miles de entradas: se juzga con lo leído */
  }
  return nombres;
}

// Un ZIP que no es un documento de Office ni OpenDocument trae otros documentos dentro.
function tipoZip(bytes: Uint8Array, cabeza: string): string {
  const odf = ODF_POR_MIME.find(([mime]) => cabeza.includes(mime));
  if (odf) return odf[1];
  const nombres = entradasZip(bytes);
  return OFFICE_POR_CARPETA.find(([re]) => nombres.some((n) => re.test(n)))?.[1] ?? '.zip';
}

const FIRMAS: [string, string][] = [
  ['{\\rtf', '.rtf'],
  ['\x89PNG', '.png'],
  ['\xFF\xD8\xFF', '.jpg'],
  ['7z\xBC\xAF\x27\x1C', '.7z'],
  ['Rar!\x1A\x07', '.rar'],
];
const HTML = /<!doctype html|<html[\s>]/i;
const PROLOGO_XML = /^(\xEF\xBB\xBF)?\s*<\?xml/;
const PAGINAS_WEB = new Set(['.htm', '.html', '.php', '.asp', '.aspx', '.jsp']);
const NO_ES_DOCUMENTO =
  'Lo descargado no es un PDF ni un documento de Office (parece una página web): la plataforma devolvió un aviso o un error en vez del pliego.';
// Lo que vale por su extensión cuando los bytes no lo reconocen: documentos que no se ejecutan
// (presupuestos, planos, cartografía, texto, imágenes, firmas). Una lista cerrada: con «cualquier
// extensión» un «Anexo II modelo.pdf.js» o un .scf llegaban al Drive de la empresa.
const POR_NOMBRE = new Set([
  '.bc3',
  '.dwg',
  '.dxf',
  '.dgn',
  '.dwf',
  '.ifc',
  '.txt',
  '.csv',
  '.odg',
  '.tif',
  '.tiff',
  '.gif',
  '.bmp',
  '.webp',
  '.kml',
  '.kmz',
  '.shp',
  '.shx',
  '.dbf',
  '.prj',
  '.gml',
  '.gpx',
  '.xsig',
  '.csig',
  '.p7s',
  '.p7m',
]);
const NO_ADMITIDO =
  'Es un tipo de archivo que no se guarda solo (podría ejecutarse): bájalo de la PLACSP y, si es un documento del pliego, déjalo a mano en la carpeta.';
// «modelo.pdf.js»: dice ser un documento y es otra cosa.
const DOBLE_SUFIJO = new RegExp(
  `(${[...TIPOS_POR_BYTES].map((e) => e.replace('.', '\\.')).join('|')})\\.[a-z0-9]{1,5}$`,
  'i',
);

// Sin prólogo cuenta como XML solo si así se llama (la petición del DEUC como «Deuc.xml»).
function esXml(cabeza: string, nombre: string): boolean {
  return !HTML.test(cabeza) && (PROLOGO_XML.test(cabeza) || (extension(nombre) === '.xml' && /^\s*</.test(cabeza)));
}

// Lo que no se reconoce por los bytes vale por su extensión si es de la lista cerrada (un
// presupuesto .bc3, un plano .dwg); una página web o un tipo que sus bytes desmienten no es un
// documento, y lo demás (ejecutables, scripts, accesos directos) no se guarda solo.
function porNombre(cabeza: string, nombre: string): Result<string> {
  const ext = extension(nombre);
  if (
    !cabeza.length ||
    HTML.test(cabeza) ||
    !EXTENSION_REAL.test(ext) ||
    TIPOS_POR_BYTES.has(ext) ||
    PAGINAS_WEB.has(ext)
  )
    return fail('no_es_documento', NO_ES_DOCUMENTO);
  return POR_NOMBRE.has(ext) && !DOBLE_SUFIJO.test(nombre) ? ok(ext) : fail('tipo_no_admitido', NO_ADMITIDO);
}

/**
 * Qué es de verdad lo que se bajó, por sus primeros bytes y no por el nombre ni el
 * Content-Type: algunas plataformas devuelven una página HTML de error con 200 o un DOCX
 * llamado «.pdf», y la Biblioteca lo leería mal («Invalid PDF structure»). Devuelve la
 * extensión que le corresponde («.zip» si trae otros documentos dentro).
 */
export function tipoDeDocumento(bytes: Uint8Array, nombre: string): Result<string> {
  const cabeza = Buffer.from(bytes.subarray(0, 1024)).toString('latin1');
  if (cabeza.startsWith('%PDF-')) return ok('.pdf');
  // La firma del ZIP va antes que «%PDF-» en cualquier sitio: un ZIP que guarda sin comprimir
  // un PDF lleva «%PDF-» en su primer KB y se tomaba por PDF (caso Vall d'Hebron).
  if (cabeza.startsWith('PK\x03\x04')) return ok(tipoZip(bytes, cabeza));
  if (cabeza.startsWith('\xD0\xCF\x11\xE0'))
    return ok(['.doc', '.xls'].includes(extension(nombre)) ? extension(nombre) : '.doc');
  const firma = FIRMAS.find(([f]) => cabeza.startsWith(f));
  if (firma) return ok(firma[1]);
  // Un PDF con basura delante (un BOM, restos de cabeceras) sigue siendo un PDF.
  if (cabeza.includes('%PDF-')) return ok('.pdf');
  return esXml(cabeza, nombre) ? ok('.xml') : porNombre(cabeza, nombre);
}

/** Si es la petición del DEUC que publica el órgano (XML con raíz ESPDRequest): se importa en el servicio DEUC. */
export function esPeticionDeuc(bytes: Uint8Array): boolean {
  return /<(?:[\w.-]+:)?ESPDRequest[\s>]/.test(Buffer.from(bytes.subarray(0, 8192)).toString('latin1'));
}

/** El nombre con la extensión de lo que el archivo es de verdad. */
export function conExtension(nombre: string, ext: string): string {
  const actual = extension(nombre);
  return actual === ext ? nombre : `${TIPOS_POR_BYTES.has(actual) ? nombre.slice(0, -actual.length) : nombre}${ext}`;
}

/** Nombre de archivo seguro y con extensión (la suya o la de su Content-Type). */
export function nombreSeguro(nombre: string, contentType: string | null): string {
  const base = limpiarNombre(nombre) || 'documento';
  if (EXTENSION_REAL.test(extension(base))) return base;
  const tipo = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return `${base}${POR_CONTENT_TYPE[tipo] ?? '.pdf'}`;
}

/**
 * Donde van los pliegos: Pliegos/ de su carpeta única si la tiene; si no, PLIEGOS de su
 * carpeta de presentada; si no, junto a los
 * que ya bajó (aunque sigan en la estructura anterior o cambie el año de la fecha límite: así
 * una licitación nunca queda partida en dos carpetas); si no tiene ninguno, la del radar.
 */
export function carpetaPliegos(db: Db, l: FilaLicitacion): string {
  const unica = carpetaUnicaEnDb(db, l.id);
  if (unica) return path.posix.join(unica, SUBCARPETAS_UNICA.pliegos);
  const presentada = rutaPresentada(db, l.id);
  if (presentada) return path.posix.join(presentada, CARPETA_PLIEGOS);
  const previo = db
    .prepare('SELECT ruta FROM pliegos WHERE licitacion_id = ? AND ruta IS NOT NULL ORDER BY rowid LIMIT 1')
    .get(l.id) as { ruta: string } | undefined;
  return previo ? path.posix.dirname(previo.ruta) : carpetaDe(l);
}

// Una redirección no puede sacar la descarga de las plataformas admitidas (cada salto se
// valida antes de pedirlo) y el cuerpo se deja de leer en cuanto pasa del tope.
async function bajar(url: string): Promise<Result<{ bytes: Buffer; contentType: string | null }>> {
  if (!esUrlDePliego(url))
    return fail(
      'url_no_permitida',
      'Solo se descargan pliegos de la PLACSP y de las plataformas autonómicas admitidas.',
    );
  const r = await pedirPermitida(
    url,
    { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    esUrlDePliego,
  );
  if (r.error) return r;
  const res = r.data;
  const rechazo = !res.ok
    ? fail(`placsp_http_${res.status}`, res.statusText)
    : Number(res.headers.get('content-length') ?? 0) > MAX_BYTES
      ? fail('demasiado_grande', 'El documento supera 100 MB.')
      : null;
  if (rechazo) {
    await res.body?.cancel().catch(() => undefined);
    return rechazo;
  }
  const bytes = await leerConTope(res, MAX_BYTES);
  return bytes.error ? bytes : ok({ bytes: bytes.data, contentType: res.headers.get('content-type') });
}

// datos.json lo escribe la primera descarga y no se vuelve a tocar: si ya existe (de una
// vuelta anterior o puesto por una persona), no se pisa.
async function escribirDatos(raiz: string, carpeta: string, l: FilaLicitacion): Promise<void> {
  const { datos, ...resto } = l;
  const contenido = JSON.stringify(
    { ...resto, ...(JSON.parse(datos) as object), fuente_datos: 'PLACSP (datos abiertos)' },
    null,
    2,
  );
  try {
    await fs.writeFile(path.join(raiz, carpeta, 'datos.json'), contenido, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
}

export type Pendiente = {
  licitacion_id: string;
  url: string;
  nombre: string;
  clase: string;
  intentos: number;
  fecha_limite: string | null;
};
type Archivo = { nombre: string; bytes: Uint8Array; ext: string };

const MAX_ENTRADAS_ZIP = 200;
const MAX_DESCOMPRIMIDO = 300 * 1024 * 1024;
// Carpetas, la basura de macOS y de Windows y lo oculto no son documentos del órgano.
const NO_ES_ENTRADA = /\/$|(^|\/)(__MACOSX\/|\.)|(^|\/)(thumbs\.db|desktop\.ini)$/i;

// Lo gastado entre el ZIP de fuera y los de dentro: cada ZIP anidado con su propio tope
// juntaba en memoria diez veces 300 MB (OOM del contenedor). vistas cuenta también lo ignorado:
// un zip64 que declara 2^32 entradas tenía el event loop parado diez minutos.
type PresupuestoZip = { bytes: number; entradas: number; vistas: number };
class ZipExcedido extends Error {
  constructor(
    readonly codigo: 'zip_demasiado_grande' | 'zip_demasiadas_entradas',
    mensaje: string,
  ) {
    super(mensaje);
  }
}
const presupuestoNuevo = (): PresupuestoZip => ({ bytes: 0, entradas: 0, vistas: 0 });

function contarEntrada(p: PresupuestoZip, nombre: string, tamano: number): boolean {
  p.vistas += 1;
  if (p.vistas > MAX_ENTRADAS_MIRADAS)
    throw new ZipExcedido(
      'zip_demasiadas_entradas',
      `El ZIP trae más de ${MAX_ENTRADAS_MIRADAS} entradas: bájalo y revísalo a mano.`,
    );
  if (NO_ES_ENTRADA.test(nombre)) return false;
  p.entradas += 1;
  p.bytes += tamano;
  if (p.entradas > MAX_ENTRADAS_ZIP)
    throw new ZipExcedido(
      'zip_demasiadas_entradas',
      `El ZIP trae más de ${MAX_ENTRADAS_ZIP} documentos: no se descomprime a medias; bájalo y revísalo a mano.`,
    );
  if (p.bytes > MAX_DESCOMPRIMIDO)
    throw new ZipExcedido('zip_demasiado_grande', 'El ZIP descomprimido pasa de 300 MB.');
  return true;
}

// Con tope de entradas y de tamaño descomprimido (el que declara cada entrada, que es lo que
// fflate reserva), común con los ZIP de dentro: un ZIP bomba no llena la memoria y uno con más
// documentos de la cuenta no queda «descomprimido» a medias sin que nadie lo sepa.
function abrirZip(bytes: Uint8Array, p: PresupuestoZip): Result<Record<string, Uint8Array>> {
  try {
    return ok(unzipSync(bytes, { filter: (f) => contarEntrada(p, f.name, f.originalSize) }));
  } catch (err) {
    return err instanceof ZipExcedido
      ? fail(err.codigo, err.message)
      : fail('zip_roto', `El ZIP no se puede abrir: ${errorMessage(err)}`);
  }
}

/**
 * Los documentos de un ZIP con la extensión de lo que es cada uno, y los de un ZIP dentro de
 * otro (un nivel), con un mismo presupuesto. Lo que no es un documento (una página web, un
 * archivo sin tipo) o es de un tipo que no se guarda (un ejecutable) se deja, con un aviso.
 */
function documentosDelZip(
  bytes: Uint8Array,
  p: PresupuestoZip = presupuestoNuevo(),
  profundidad = 0,
): Result<Archivo[]> {
  const zip = abrirZip(bytes, p);
  if (zip.error) return zip;
  const out: Archivo[] = [];
  for (const [nombre, contenido] of Object.entries(zip.data)) {
    const tipo = tipoDeDocumento(contenido, nombre);
    if (tipo.error) {
      if (tipo.error.code === 'tipo_no_admitido')
        log.warn('entrada de ZIP no guardada', { extension: extension(nombre) });
      continue;
    }
    if (tipo.data !== '.zip') {
      out.push({ nombre, bytes: contenido, ext: tipo.data });
      continue;
    }
    if (profundidad > 0) continue;
    const dentro = documentosDelZip(contenido, p, 1);
    if (dentro.error && dentro.error.code !== 'zip_vacio' && dentro.error.code !== 'zip_roto') return dentro;
    out.push(...(dentro.data ?? []).map((e) => ({ ...e, nombre: `${nombre}/${e.nombre}` })));
  }
  return out.length ? ok(out) : fail('zip_vacio', 'El ZIP no trae ningún documento que se pueda guardar.');
}

const sinExtension = (n: string) => (EXTENSION_REAL.test(extension(n)) ? n.slice(0, -extension(n).length) : n);

// «<zip> - <entrada>.<ext>»: en Drive se ve de qué ZIP salió, y el recorte no se come la extensión.
function nombreDeEntrada(zip: string, entrada: string, ext: string): string {
  return `${limpiarNombre(`${sinExtension(zip)} - ${sinExtension(path.posix.basename(entrada))}`, 110) || 'documento'}${ext}`;
}

const tipoMarcado = (a: Archivo): string | null => (a.ext === '.xml' && esPeticionDeuc(a.bytes) ? 'deuc' : null);

async function guardar(
  db: Db,
  raiz: string,
  rel: string,
  bytes: Uint8Array,
  origenUrl: string,
): Promise<Result<DocumentoGuardado>> {
  return guardarDocumentoNuevo(db, raiz, { rel, bytes: Buffer.from(bytes), dominio: 'licitaciones', origenUrl });
}

/**
 * Cada documento del ZIP (sus bytes, ya en memoria) queda como un pliego más, con la clase del
 * ZIP y su URL como padre; el ZIP no se guarda (la Biblioteca no lo lee): queda «descomprimido».
 * Vale igual para lo recién bajado que para un ZIP que ya estaba guardado en disco.
 */
export async function guardarEntradasZip(
  db: Db,
  raiz: string,
  carpeta: string,
  p: Pendiente,
  bytes: Uint8Array,
): Promise<Result<string>> {
  const entradas = documentosDelZip(bytes);
  if (entradas.error) return entradas;
  const registrar =
    db.prepare(`INSERT INTO pliegos (licitacion_id, url, clase, nombre, estado, ruta, sha256, origen, padre_url, tipo, actualizado_en)
    VALUES (@id, @url, @clase, @nombre, 'descargado', @ruta, @sha256, 'zip', @padre, @tipo, @ts)
    ON CONFLICT(licitacion_id, url) DO UPDATE SET estado = 'descargado', ruta = excluded.ruta, sha256 = excluded.sha256, tipo = excluded.tipo, error = NULL, actualizado_en = excluded.actualizado_en`);
  const zip = nombreSeguro(p.nombre, null);
  for (const e of entradas.data) {
    const g = await guardar(db, raiz, path.posix.join(carpeta, nombreDeEntrada(zip, e.nombre, e.ext)), e.bytes, p.url);
    if (g.error) return g;
    registrar.run({
      id: p.licitacion_id,
      url: `${p.url}#${e.nombre}`,
      clase: p.clase,
      nombre: path.posix.basename(e.nombre),
      ruta: g.data.ruta,
      sha256: g.data.sha256,
      padre: p.url,
      tipo: tipoMarcado(e),
      ts: ahora(),
    });
  }
  db.prepare(
    "UPDATE pliegos SET estado = 'descomprimido', ruta = NULL, error = NULL, proximo_intento_en = NULL, actualizado_en = ? WHERE licitacion_id = ? AND url = ?",
  ).run(ahora(), p.licitacion_id, p.url);
  return ok(`${entradas.data.length} documentos del ZIP`);
}

// El mismo documento publicado con otra URL (en el feed y en la página del expediente): se
// apunta al que ya está en Drive en vez de guardar una copia con otro nombre.
function yaGuardado(db: Db, p: Pendiente, sha256: string): string | null {
  const f = db
    .prepare(
      'SELECT ruta FROM pliegos WHERE licitacion_id = ? AND sha256 = ? AND ruta IS NOT NULL AND url <> ? ORDER BY rowid LIMIT 1',
    )
    .get(p.licitacion_id, sha256, p.url) as { ruta: string } | undefined;
  return f?.ruta ?? null;
}

async function guardarPliego(db: Db, raiz: string, carpeta: string, p: Pendiente, a: Archivo): Promise<Result<string>> {
  const sha256 = crypto.createHash('sha256').update(a.bytes).digest('hex');
  const previo = yaGuardado(db, p, sha256);
  const g = previo
    ? ok({ ruta: previo, sha256 })
    : await guardar(db, raiz, path.posix.join(carpeta, conExtension(a.nombre, a.ext)), a.bytes, p.url);
  if (g.error) return g;
  db.prepare(
    `UPDATE pliegos SET estado = 'descargado', ruta = ?, sha256 = ?, tipo = ?, error = NULL, proximo_intento_en = NULL, actualizado_en = ?
    WHERE licitacion_id = ? AND url = ?`,
  ).run(g.data.ruta, g.data.sha256, tipoMarcado(a), ahora(), p.licitacion_id, p.url);
  return ok(g.data.ruta);
}

async function descargarUno(db: Db, raiz: string, p: Pendiente): Promise<Result<string>> {
  const l = db.prepare('SELECT * FROM licitaciones WHERE id = ?').get(p.licitacion_id) as FilaLicitacion | undefined;
  if (!l) return fail('not_found', 'La licitación ya no existe.');
  const r = await bajar(p.url);
  if (r.error) return r;
  const nombre = nombreSeguro(p.nombre, r.data.contentType);
  const tipo = tipoDeDocumento(r.data.bytes, nombre);
  if (tipo.error) return tipo;
  const carpeta = carpetaPliegos(db, l);
  const g =
    tipo.data === '.zip'
      ? await guardarEntradasZip(db, raiz, carpeta, p, r.data.bytes)
      : await guardarPliego(db, raiz, carpeta, p, { nombre, bytes: r.data.bytes, ext: tipo.data });
  if (g.error) return g;
  await escribirDatos(raiz, carpeta, l);
  return g;
}

type GuardadoComoPdf = Pendiente & { ruta: string };

// Solo los 4 primeros bytes: casi todos los .pdf guardados son PDF y no hace falta leerlos enteros.
async function empiezaComoZip(abs: string): Promise<boolean> {
  const f = await fs.open(abs, 'r');
  try {
    const { bytesRead, buffer } = await f.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && buffer.toString('latin1') === 'PK\x03\x04';
  } finally {
    await f.close();
  }
}

// Un DOCX llamado .pdf también empieza por PK: solo se descomprime lo que de verdad es un ZIP
// de documentos. El ZIP se deja en su sitio (los pliegos nunca se borran).
async function repararUno(db: Db, raiz: string, fila: GuardadoComoPdf): Promise<Result<boolean>> {
  const abs = path.join(raiz, fila.ruta);
  try {
    if (!(await empiezaComoZip(abs))) return ok(false);
    const bytes = await fs.readFile(abs);
    if (tipoDeDocumento(bytes, fila.nombre).data !== '.zip') return ok(false);
    const g = await guardarEntradasZip(db, raiz, path.posix.dirname(fila.ruta), fila, bytes);
    return g.error ? g : ok(true);
  } catch (err) {
    return fail('io_error', errorMessage(err));
  }
}

/**
 * Una sola vez al arrancar (idempotente): los ZIP que se guardaron como «.pdf» antes de mirar
 * la firma del ZIP primero se descomprimen como si se acabaran de bajar. Devuelve cuántos.
 */
export async function repararZipsComoPdf(db: Db, raiz: string): Promise<Result<number>> {
  try {
    const filas = db
      .prepare(
        `SELECT p.licitacion_id, p.url, p.nombre, p.clase, p.intentos, p.ruta, l.fecha_limite FROM pliegos p
      LEFT JOIN licitaciones l ON l.id = p.licitacion_id WHERE p.estado = 'descargado' AND p.ruta LIKE '%.pdf'`,
      )
      .all() as GuardadoComoPdf[];
    let reparados = 0;
    for (const fila of filas) {
      const r = await repararUno(db, raiz, fila);
      if (r.error) log.warn('ZIP guardado como PDF sin reparar', { codigo: r.error.code });
      else if (r.data) reparados += 1;
    }
    log.info('ZIP guardados como PDF reparados', { reparados });
    return ok(reparados);
  } catch (err) {
    return fail('db_error', errorMessage(err));
  }
}

// Los `max` siguientes que no esperan, por prioridad: lo que la empresa prepara o presenta (y, de lo
// resuelto, lo que la PLACSP publica después en el expediente, como el acta de valoración); luego
// el PCAP y el PPT de lo que está en nueva (lo que lee la ficha), por plazo más
// cercano; los anexos, al final. Lo descartado y lo ya cerrado no se baja
// (sigue en cola por si vuelve), ni lo que espera su reintento. El filtro de espera de carpeta
// va antes del límite: los que esperan no cambian de sitio y, si no, ocuparían siempre la
// cabeza y no bajaría nada de nadie.
export function colaDePliegos(db: Db, raiz: string, max: number, ahoraMs: number): Pendiente[] {
  const filas = db
    .prepare(
      `SELECT p.licitacion_id, p.url, p.nombre, p.clase, p.intentos, l.fecha_limite FROM pliegos p
    JOIN oportunidades o ON o.licitacion_id = p.licitacion_id JOIN licitaciones l ON l.id = p.licitacion_id
    WHERE p.estado = 'pendiente' AND (p.proximo_intento_en IS NULL OR p.proximo_intento_en <= @ahora)
      AND p.licitacion_id NOT IN (SELECT licitacion_id FROM carpetas_presentadas WHERE estado <> 'hecha')
      AND (o.estado IN ('en_preparacion', 'presentada') OR (o.estado = 'nueva' AND (l.fecha_limite IS NULL OR l.fecha_limite > @hoy))
        OR (o.estado IN ('ganada', 'perdida') AND p.origen = 'expediente'))
    ORDER BY CASE WHEN o.estado IN ('en_preparacion', 'presentada') THEN 0 ELSE 1 END,
      CASE p.clase WHEN 'pcap' THEN 0 WHEN 'ppt' THEN 1 ELSE 2 END,
      COALESCE(l.fecha_limite, '9999'), p.actualizado_en`,
    )
    .all({ hoy: horaLocalEspana(ahoraMs), ahora: new Date(ahoraMs).toISOString() }) as Pendiente[];
  const espera = new Map<string, boolean>();
  const out: Pendiente[] = [];
  for (const p of filas) {
    if (out.length >= max) break;
    if (!espera.has(p.licitacion_id)) espera.set(p.licitacion_id, esperaPorCarpeta(db, raiz, p.licitacion_id));
    if (!espera.get(p.licitacion_id)) out.push(p);
  }
  return out;
}

// Lo que no es un documento no va a cambiar al pedirlo otra vez: error a la primera.
const SIN_REINTENTO = new Set([
  'no_es_documento',
  'tipo_no_admitido',
  'zip_vacio',
  'zip_roto',
  'zip_demasiado_grande',
  'zip_demasiadas_entradas',
]);
// Lo que puede salir bien más tarde: el servidor caído o saturado, la red, el tiempo de espera o el disco.
const TRANSITORIO = /^(placsp_http_(5\d\d|408|429)|placsp_inalcanzable|io_error)$/;
const ESPERA_INICIAL_MS = 60_000;
const ESPERA_MAX_MS = 60 * 60_000;
const MAX_INTENTOS_SIN_PLAZO = 12;

export type TrasFallo = { definitivo: boolean; proximo: string | null };

/**
 * Qué se hace con un pliego que falló: lo que no va a cambiar, error ya; un fallo pasajero se
 * reintenta con espera creciente (1, 2, 4… hasta 60 min) mientras no venza el plazo (sin
 * plazo, doce veces); el resto, hasta tres veces, como lo pasajero una vez vencido.
 */
export function trasFallo(p: Pick<Pendiente, 'intentos' | 'fecha_limite'>, codigo: string, ahoraMs: number): TrasFallo {
  const intentos = p.intentos + 1;
  if (SIN_REINTENTO.has(codigo)) return { definitivo: true, proximo: null };
  if (!TRANSITORIO.test(codigo)) return { definitivo: intentos >= MAX_INTENTOS, proximo: null };
  const enPlazo = p.fecha_limite ? p.fecha_limite > horaLocalEspana(ahoraMs) : intentos < MAX_INTENTOS_SIN_PLAZO;
  if (!enPlazo && intentos >= MAX_INTENTOS) return { definitivo: true, proximo: null };
  const espera = Math.min(ESPERA_INICIAL_MS * 2 ** (intentos - 1), ESPERA_MAX_MS);
  return { definitivo: false, proximo: new Date(ahoraMs + espera).toISOString() };
}

async function bajarYRegistrar(db: Db, raiz: string, p: Pendiente, ahoraMs: number): Promise<boolean> {
  const r = await descargarUno(db, raiz, p).catch((err: unknown) => fail<string>('io_error', errorMessage(err)));
  if (!r.error) return true;
  const { definitivo, proximo } = trasFallo(p, r.error.code, ahoraMs);
  db.prepare(
    'UPDATE pliegos SET estado = ?, intentos = ?, error = ?, proximo_intento_en = ?, actualizado_en = ? WHERE licitacion_id = ? AND url = ?',
  ).run(
    definitivo ? 'error' : 'pendiente',
    p.intentos + 1,
    `${r.error.code}: ${r.error.message}`.slice(0, 300),
    proximo,
    ahora(),
    p.licitacion_id,
    p.url,
  );
  log.warn('pliego no descargado', {
    licitacion: p.licitacion_id,
    intentos: p.intentos + 1,
    error: r.error.code,
    reintento: proximo,
  });
  return false;
}

// La PLACSP sirve lento (~120 KB/s por conexión): varias a la vez y tantas como quepan en la
// vuelta de un minuto, sin que una vuelta empiece mientras la anterior sigue bajando.
const PARALELAS = 3;
const PRESUPUESTO_MS = 50_000;
let bajando = false;

/**
 * Baja hasta `max` pliegos pendientes (los que quepan en el presupuesto de tiempo). Devuelve
 * cuántos se bajaron. Los de una licitación cuya carpeta de presentada aún no está en el
 * disco esperan (sin gastar intentos): bajarlos al sitio viejo los separaría del resto.
 */
export async function descargarPendientes(db: Db, raiz: string, max = 24, ahoraMs = Date.now()): Promise<number> {
  if (bajando) return 0;
  bajando = true;
  try {
    const pendientes = colaDePliegos(db, raiz, max, ahoraMs);
    const fin = Date.now() + PRESUPUESTO_MS;
    let siguiente = 0;
    let bajados = 0;
    const trabajador = async () => {
      while (siguiente < pendientes.length && Date.now() < fin) {
        const p = pendientes[siguiente++]!;
        if (await bajarYRegistrar(db, raiz, p, ahoraMs)) bajados += 1;
      }
    };
    await Promise.all(Array.from({ length: PARALELAS }, trabajador));
    return bajados;
  } finally {
    bajando = false;
  }
}
