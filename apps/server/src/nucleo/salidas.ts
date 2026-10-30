// Documentos de trabajo fuera de la Biblioteca: la carpeta Salidas de Drive y, para elegir uno, también Conocimiento.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { extraerDocumento } from '../biblioteca/motor/documentos/extraccion.js';
import { obtenerRutaBiblioteca } from '../biblioteca/motor/configuracion.js';
import { nucleo } from './contexto.js';
import { enColaboradores } from './colaboradores/cvs.js';
import { logger } from './log.js';
import { errorMessage, fail, ok, type Result } from './result.js';

// Son borradores y entregables. Las rutas llegan de personas y agentes como «Salidas/…» o «Conocimiento/…»: se
// validan y nunca salen de su carpeta. Leer de Salidas es del núcleo porque la usará cualquier dominio.
const RAICES = ['Salidas', 'Conocimiento'] as const;
type Raiz = (typeof RAICES)[number];
export type Raices = { salidas: string | null; conocimiento: string | null };

/**
 * Conocimiento es la bóveda que lee la Biblioteca: la elegida en los ajustes de la web o, si
 * no hay, VAULT_PATH. Si pliegos y documentos usaran solo VAULT_PATH, al cambiar la bóveda
 * en la web se escribirían donde biblioteca_leer ya no mira.
 */
export function raicesActuales(): Raices {
  return { salidas: nucleo().config.salidasDir, conocimiento: obtenerRutaBiblioteca() };
}

// Los Google Docs se leen de su copia en .gdocs/: es la única carpeta oculta admitida.
const CARPETA_GDOCS = '.gdocs';
// eslint-disable-next-line no-control-regex -- los caracteres de control son justo lo que se descarta
const PROHIBIDOS = /[\\:\u0000-\u001f]/;
// .doc y .rtf se leen por su conversión a .docx (LibreOffice): los anexos de la PLACSP llegan así.
export const EXTENSIONES_DOCUMENTO = new Set([
  '.md',
  '.txt',
  '.pdf',
  '.docx',
  '.doc',
  '.rtf',
  '.odt',
  '.pptx',
  '.odp',
  '.xlsx',
  '.ods',
]);
const MAX_TEXTO_PLANO = 5 * 1024 * 1024;
export const MAX_LECTURA = 20_000;
const log = logger('salidas');

function partesValidas(partes: string[]): boolean {
  return partes.every((p) => p !== '' && p !== '.' && p !== '..' && (!p.startsWith('.') || p === CARPETA_GDOCS));
}

/** ¿«Salidas/…» o «Conocimiento/…» sin escapes, carpetas ocultas ni CV de colaboradores? */
export function esRutaDocumento(ruta: string): boolean {
  const [raiz, ...resto] = ruta.split('/');
  if (!(RAICES as readonly string[]).includes(raiz ?? '') || resto.length === 0 || PROHIBIDOS.test(ruta)) return false;
  // Los CV son datos personales: no se eligen como documento de propuesta.
  return partesValidas(resto) && !(raiz === 'Conocimiento' && enColaboradores(resto.join('/')));
}

export const RutaDocumento = z
  .string()
  .trim()
  .min(10)
  .max(500)
  .refine(esRutaDocumento, 'ruta «Salidas/…» o «Conocimiento/…», sin «..», carpetas ocultas ni CV de Colaboradores/')
  .describe(
    'Documento en Drive, p. ej. «Salidas/Licitaciones/2026-123 (p-12345678)/memoria.docx» o «Conocimiento/Licitaciones/Presentadas/…/DOCUMENTACION PRESENTADA/propuesta.pdf»',
  );

// Comparar el texto de la ruta no basta: un enlace simbólico o una unión de Windows dentro
// de la carpeta (Hermes escribe en Salidas y tiene terminal) apuntaría a cualquier archivo
// del servidor. Si el destino existe, su ruta real debe seguir dentro de la ruta real de la base.
export function sinSalirPorEnlaces(base: string, destino: string): boolean {
  try {
    const real = fs.realpathSync.native(destino);
    return real.startsWith(fs.realpathSync.native(base) + path.sep);
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

/** Ruta en disco de un documento «Salidas/…» o «Conocimiento/…», sin salir de su carpeta. */
export function documentoEnDisco(raices: Raices, ruta: string): Result<string> {
  if (!esRutaDocumento(ruta))
    return fail('invalid_input', `«${ruta}» no es una ruta válida de Salidas o Conocimiento.`);
  const [raiz, ...resto] = ruta.split('/') as [Raiz, ...string[]];
  const dir = raiz === 'Salidas' ? raices.salidas : raices.conocimiento;
  if (!dir)
    return fail(
      'no_configurado',
      `La carpeta ${raiz} no está configurada en el servidor (${raiz === 'Salidas' ? 'SALIDAS_DIR' : 'VAULT_PATH'}).`,
    );
  const base = path.resolve(dir);
  const destino = path.resolve(base, ...resto);
  if (!destino.startsWith(base + path.sep) || !sinSalirPorEnlaces(base, destino))
    return fail('invalid_input', `«${ruta}» sale de la carpeta ${raiz}.`);
  return ok(destino);
}

/** Como documentoEnDisco, pero además exige que sea un archivo que existe. */
export function archivoExistente(raices: Raices, ruta: string): Result<string> {
  const abs = documentoEnDisco(raices, ruta);
  if (abs.error) return abs;
  const stat = fs.statSync(abs.data, { throwIfNoEntry: false });
  return stat?.isFile()
    ? abs
    : fail('not_found', `No existe el documento «${ruta}» (si acaba de crearse en Drive, espera un minuto).`);
}

/**
 * Normaliza lo que manda un agente para Salidas («Salidas/x», «x» o la ruta absoluta
 * dentro de SALIDAS_DIR) a «Salidas/x». Una ruta «Conocimiento/…» se deja tal cual: con la
 * carpeta única de cada licitación, su oferta está en Conocimiento.
 */
export function rutaDeSalidas(salidasDir: string | null, raw: string): string {
  let rel = raw.trim().replace(/\\/g, '/');
  const base = salidasDir ? path.resolve(salidasDir).replace(/\\/g, '/').replace(/\/$/, '') : null;
  if (base && rel.startsWith(`${base}/`)) rel = rel.slice(base.length + 1);
  // Una carpeta llega a menudo con la barra final («…/(p-XXXXXXXX)/»): sin quitarla, la parte
  // vacía hace que la ruta no sea válida y el error no dice que es una carpeta.
  rel = rel
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
  return rel === 'Salidas' || rel.startsWith('Salidas/') || rel.startsWith('Conocimiento/') ? rel : `Salidas/${rel}`;
}

const MAX_LISTADO = 100;

// Se recoge uno más del tope para saber si el listado se ha recortado.
function listar(dir: string, rel: string, profundidad: number, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length > MAX_LISTADO || (e.name.startsWith('.') && e.name !== CARPETA_GDOCS)) continue;
    const hijo = `${rel}/${e.name}`;
    if (e.isDirectory() && profundidad > 0) listar(path.join(dir, e.name), hijo, profundidad - 1, out);
    else if (e.isFile() && EXTENSIONES_DOCUMENTO.has(path.extname(e.name).toLowerCase())) out.push(hijo);
  }
}

function carpetaEnDisco(raices: Raices, carpeta: string): Result<string> {
  const abs = documentoEnDisco(raices, carpeta);
  if (abs.error) return abs;
  return fs.statSync(abs.data, { throwIfNoEntry: false })?.isDirectory()
    ? abs
    : fail('not_found', `No existe la carpeta «${carpeta}».`);
}

/** ¿Es una carpeta que existe? Para que quien pide leerla sepa que se lista, no se lee. */
export function esCarpeta(raices: Raices, ruta: string): boolean {
  return carpetaEnDisco(raices, ruta).error === null;
}

/** Hasta 101 rutas (una más del tope) de los documentos de una carpeta ya validada. */
function rutasDe(abs: string, carpeta: string, profundidad: number): string[] {
  const out: string[] = [];
  // Una subcarpeta sin permiso de lectura no debe tumbar el bloque: se lista lo que se pueda.
  try {
    listar(abs, carpeta, profundidad, out);
  } catch (err) {
    log.warn('carpeta de documentos ilegible: se lista lo leído hasta el fallo', {
      codigo: (err as NodeJS.ErrnoException).code ?? 'desconocido',
    });
  }
  return out;
}

/** Documentos de una carpeta («Salidas/…» o «Conocimiento/…») y sus subcarpetas (dos niveles por defecto, máx. 100). */
export function documentosDe(raices: Raices, carpeta: string, profundidad = 2): string[] {
  const abs = carpetaEnDisco(raices, carpeta);
  return abs.error ? [] : rutasDe(abs.data, carpeta, profundidad).slice(0, MAX_LISTADO).sort();
}

type DocumentoListado = { ruta: string; tamano: number; modificado: string };
export type Listado = { carpeta: string; documentos: DocumentoListado[]; recortado: boolean };

/** Documentos de una carpeta con su tamaño y fecha, para que un agente elija cuál leer. */
export function listarSalidas(raices: Raices, carpeta: string, profundidad: number): Result<Listado> {
  const abs = carpetaEnDisco(raices, carpeta);
  if (abs.error) return abs;
  const rutas = rutasDe(abs.data, carpeta, profundidad);
  const documentos = rutas
    .slice(0, MAX_LISTADO)
    .sort()
    .flatMap((ruta) => {
      const stat = fs.statSync(path.join(abs.data, ...ruta.slice(carpeta.length + 1).split('/')), {
        throwIfNoEntry: false,
      });
      return stat ? [{ ruta, tamano: stat.size, modificado: stat.mtime.toISOString() }] : [];
    });
  return ok({ carpeta, documentos, recortado: rutas.length > MAX_LISTADO });
}

// Un documento de 100 páginas se lee en varias partes: se guarda el texto de los últimos
// para no extraerlo entero en cada llamada.
const cache = new Map<string, string>();
const MAX_CACHE = 4;

async function extraer(abs: string, stat: fs.Stats): Promise<Result<string>> {
  const clave = `${abs}:${stat.mtimeMs}:${stat.size}`;
  const guardado = cache.get(clave);
  if (guardado !== undefined) return ok(guardado);
  const r = await extraerDocumento(abs);
  if (r.error || !r.data)
    return fail('read_error', `No se pudo leer el documento: ${r.error ?? 'formato no soportado'}`);
  const { pages, paged } = r.data;
  const texto = paged ? pages.map((p, i) => `[pág. ${i + 1}]\n${p}`).join('\n\n') : pages.join('\n\n');
  cache.set(clave, texto);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return ok(texto);
}

/** Todo el texto de un documento en disco (con marcas [pág. N] si el formato tiene páginas). */
export async function textoDe(abs: string): Promise<Result<string>> {
  const stat = await fsp.stat(abs);
  const ext = path.extname(abs).toLowerCase();
  if (!EXTENSIONES_DOCUMENTO.has(ext))
    return fail('invalid_input', `Formato no soportado (${ext || 'sin extensión'}).`);
  if (ext !== '.md' && ext !== '.txt') return extraer(abs, stat);
  if (stat.size > MAX_TEXTO_PLANO) return fail('invalid_input', 'Documento de texto demasiado grande (más de 5 MB).');
  return ok(await fsp.readFile(abs, 'utf8'));
}

export type Trozo = { ruta: string; total: number; desde: number; hasta: number; texto: string };

/** Texto de un documento por partes (con marcas [pág. N] si el formato tiene páginas). */
export async function leerDocumento(
  raices: Raices,
  ruta: string,
  desde = 0,
  max = MAX_LECTURA,
): Promise<Result<Trozo>> {
  const abs = archivoExistente(raices, ruta);
  if (abs.error) return abs;
  const texto = await textoDe(abs.data).catch((err: unknown) =>
    fail<string>('read_error', `No se pudo leer el documento: ${errorMessage(err)}`),
  );
  if (texto.error) return texto;
  const inicio = Math.max(0, Math.min(desde, texto.data.length));
  const fin = Math.min(texto.data.length, inicio + Math.max(1, Math.min(max, MAX_LECTURA)));
  return ok({ ruta, total: texto.data.length, desde: inicio, hasta: fin, texto: texto.data.slice(inicio, fin) });
}

export const MAX_PAGINAS_LECTURA = 15;
// aviso: la página `desde` sola no cabía en una respuesta y se cortó (no se puede seguir dentro de ella).
export type Paginas = {
  ruta: string;
  total_paginas: number;
  desde: number;
  hasta: number;
  siguiente_pagina_desde: number | null;
  texto: string;
  aviso?: string;
};
// desde/hasta: posición en el documento entero; siguiente_desde, con qué «desde» seguir si la sección no cupo.
export type Seccion = {
  ruta: string;
  seccion: number;
  secciones: number[];
  total: number;
  desde: number;
  hasta: number;
  siguiente_desde: number | null;
  texto: string;
};
/** Lo que cabe de una sección en una respuesta (RESPUESTA_LECTURA es 60.000 con el JSON alrededor). */
export const MAX_SECCION = 40_000;

// Las marcas las pone extraer(): una línea «[pág. N]» antes del texto de cada página.
function partirPaginas(texto: string): string[] {
  const trozos = texto.split(/^\[pág\. (\d+)\]\n/m);
  const paginas: string[] = [];
  for (let i = 1; i < trozos.length; i += 2)
    paginas[Number(trozos[i]) - 1] = (trozos[i + 1] ?? '').replace(/\n\n$/, '');
  return paginas;
}

async function textoLeido(raices: Raices, ruta: string): Promise<Result<string>> {
  const abs = archivoExistente(raices, ruta);
  if (abs.error) return abs;
  return textoDe(abs.data).catch((err: unknown) =>
    fail<string>('read_error', `No se pudo leer el documento: ${errorMessage(err)}`),
  );
}

// Páginas enteras hasta MAX_SECCION: lo que pasara de ahí lo recortaría la respuesta y el agente,
// que sigue desde «siguiente_pagina_desde», se saltaría el final. La primera va siempre (cortada si sola no cabe).
function paginasQueCaben(
  paginas: string[],
  desde: number,
  fin: number,
): { hasta: number; texto: string; cortada: boolean } {
  const trozos: string[] = [];
  let largo = 0;
  for (let n = desde; n <= fin; n += 1) {
    const t = `[pág. ${n}]\n${paginas[n - 1] ?? ''}`;
    const suma = largo + (trozos.length ? 2 : 0) + t.length;
    if (trozos.length && suma > MAX_SECCION) break;
    trozos.push(t);
    largo = suma;
  }
  const texto = trozos.join('\n\n');
  return { hasta: desde + trozos.length - 1, texto: texto.slice(0, MAX_SECCION), cortada: texto.length > MAX_SECCION };
}

/** Hasta 15 páginas enteras de un documento con páginas (las que quepan en una respuesta); si quedan más, dice desde qué página seguir. */
export async function leerPaginas(
  raices: Raices,
  ruta: string,
  desde: number,
  hasta = desde,
): Promise<Result<Paginas>> {
  if (hasta < desde) return fail('invalid_input', 'pagina_hasta no puede ser menor que pagina_desde.');
  const texto = await textoLeido(raices, ruta);
  if (texto.error) return texto;
  const paginas = partirPaginas(texto.data);
  if (paginas.length === 0) return fail('invalid_input', 'Este documento no tiene páginas: usa seccion o desde/max');
  if (desde > paginas.length)
    return fail('invalid_input', `El documento tiene ${paginas.length} páginas: pagina_desde ${desde} no existe.`);
  const c = paginasQueCaben(paginas, desde, Math.min(hasta, paginas.length, desde + MAX_PAGINAS_LECTURA - 1));
  const siguiente = c.hasta < Math.min(hasta, paginas.length) ? c.hasta + 1 : null;
  const aviso = c.cortada
    ? { aviso: `La página ${desde} sola no cabe en una respuesta: llega hasta el carácter ${MAX_SECCION}.` }
    : {};
  return ok({
    ruta,
    total_paginas: paginas.length,
    desde,
    hasta: c.hasta,
    siguiente_pagina_desde: siguiente,
    texto: c.texto,
    ...aviso,
  });
}

type Parte = { n: number; inicio: number; texto: string };

// Cada «## N.» con su posición en el documento, hasta el siguiente «## ».
function seccionesDe(texto: string): Parte[] {
  const inicios = [...texto.matchAll(/^## /gm)].map((m) => m.index);
  return inicios.flatMap((inicio, i) => {
    const n = /^## (\d+)\./.exec(texto.slice(inicio, inicio + 12))?.[1];
    return n ? [{ n: Number(n), inicio, texto: texto.slice(inicio, inicios[i + 1] ?? texto.length).trimEnd() }] : [];
  });
}

/** Una sección «## N.» de un Markdown, hasta el siguiente «## »; si pasa de MAX_SECCION, dice con qué «desde» seguir. */
export async function leerSeccion(raices: Raices, ruta: string, seccion: number): Promise<Result<Seccion>> {
  if (!ruta.toLowerCase().endsWith('.md'))
    return fail('invalid_input', 'Las secciones solo se leen en documentos Markdown (.md): usa desde/max.');
  const texto = await textoLeido(raices, ruta);
  if (texto.error) return texto;
  const partes = seccionesDe(texto.data);
  const hallada = partes.find((p) => p.n === seccion);
  const numeros = partes.map((p) => p.n);
  if (!hallada) return fail('not_found', `No hay sección ${seccion}. Secciones: ${numeros.join(', ') || 'ninguna'}`);
  const cabe = hallada.texto.slice(0, MAX_SECCION);
  const hasta = hallada.inicio + cabe.length;
  const siguiente = cabe.length < hallada.texto.length ? hasta : null;
  return ok({
    ruta,
    seccion,
    secciones: numeros,
    total: hallada.texto.length,
    desde: hallada.inicio,
    hasta,
    siguiente_desde: siguiente,
    texto: cabe,
  });
}
