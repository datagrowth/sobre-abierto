// Lo que Hermes lee de la Biblioteca: el texto de una nota o documento por partes
// y qué documentos aún no tienen una nota hecha a partir de ellos.
import path from 'node:path';
import { obtenerRutaBiblioteca } from '../configuracion.js';
import { listarPendientes } from '../bandeja.js';
import { leerArchivoRegular } from '../rutaReal.js';
import { resolverRutaSegura, ErrorBiblioteca } from '../notas.js';
import { enCarpetas } from './busquedaHibrida.js';
import { abrirIndiceLectura } from './servicioIndice.js';
import * as store from './almacen.js';

export const MAX_CARACTERES_LECTURA = 20_000;
// Por páginas se lee una cláusula o el cuadro de características entero: hasta 15 páginas
// y 40.000 caracteres (un cuadro denso ocupa ~2.500 por página).
export const MAX_PAGINAS_LECTURA = 15;
const MAX_CHARS_PAGINAS = 40_000;
// Y como mucho 50.000 ya escapados: la respuesta MCP se recorta a 60.000 caracteres después de
// serializarla, y cada salto, tabulador o comilla ocupa dos (una hoja de Excel de celdas cortas
// pasa de 60.000 con 40.000 sin escapar). Si el recorte se comiera la cola, «siguiente» saltaría
// por encima de ese texto.
const MAX_ESCAPADO_PAGINAS = 50_000;

export type FragmentoTexto = {
  ruta: string;
  titulo: string;
  tipo: store.TipoArchivo;
  estado: store.EstadoArchivo;
  paginas: number | null;
  total: number;
  desde: number;
  hasta: number;
  texto: string;
  // Solo al leer por páginas: las pedidas y si el texto se cortó por el tope de caracteres.
  pagina_desde?: number;
  pagina_hasta?: number;
  recortado?: boolean;
  // Si el texto empieza a mitad de una página (seguido con desde_caracter), cuál es: no lleva su marca.
  empieza_en_pagina?: number;
  // Si quedan páginas por leer: la llamada que continúa, y una nota para que el modelo no dé por leído el rango entero.
  siguiente?: { pagina_desde: number; pagina_hasta: number; desde_caracter?: number };
  nota?: string;
  // Hasta qué página el texto está entero: con recorte, la anterior a la que quedó a medias.
  ultima_pagina_completa?: number | null;
  // Con sinMembretes, cuántas líneas de cabecera o pie se quitaron: que se vea qué se tocó.
  membretes_quitados?: number;
};

// desdeCaracter: dónde seguir dentro del texto de esas páginas cuando una sola no cabe en una lectura.
// sinMembretes quita las cabeceras y pies repetidos (un 20-25 % del cupo en un pliego con
// membrete). Va desactivado por defecto: un falso membrete quitaría texto del pliego. desdeCaracter
// cuenta sobre el texto ya limpio: la cadena de «siguiente» tiene que repetir sinMembretes.
export type Paginas = { desde: number; hasta: number; desdeCaracter?: number; sinMembretes?: boolean };
// Dónde empieza en el texto la marca [pág. N] de cada página (las pone el lector, no se buscan en
// el texto: un «[pág. 9]» literal dentro de un documento no puede hacer saltar páginas).
type Marca = { pagina: number; pos: number };
export type TextoPaginado = { texto: string; marcas: Marca[] };
export type Trozo = { page: number | null; text: string };

/** Ruta relativa a la bóveda a partir de lo que mande un agente (relativa o absoluta dentro de ella). */
export function aRelativaBiblioteca(crudo: string): string {
  const raiz = obtenerRutaBiblioteca() ?? '';
  let relativa = crudo.trim().replace(/\\/g, '/');
  const raizPosix = raiz.replace(/\\/g, '/').replace(/\/$/, '');
  if (raizPosix && relativa.startsWith(`${raizPosix}/`)) relativa = relativa.slice(raizPosix.length + 1);
  relativa = relativa.replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const absoluta = resolverRutaSegura(relativa);
  return path.relative(raiz, absoluta).split(path.sep).join('/');
}

/** Como aRelativaBiblioteca, pero si la ruta no se puede resolver la devuelve tal cual (para comprobar permisos). */
export function relativaBibliotecaOCruda(crudo: string): string {
  try {
    return aRelativaBiblioteca(crudo);
  } catch {
    return crudo;
  }
}

/** Texto de los trozos con una marca «[pág. N]» al empezar cada página, y dónde queda cada marca. */
export function textoConMarcas(trozos: { page: number | null; text: string }[]): TextoPaginado {
  const marcas: Marca[] = [];
  let texto = '';
  let ultimaPagina: number | null = null;
  trozos.forEach((c, i) => {
    if (i > 0) texto += '\n\n';
    if (c.page !== null && c.page !== ultimaPagina) {
      marcas.push({ pagina: c.page, pos: texto.length });
      texto += `[pág. ${c.page}]\n`;
    }
    ultimaPagina = c.page;
    texto += c.text;
  });
  return { texto, marcas };
}

function textoDocumento(db: store.BaseDatos, relativa: string): string {
  return textoConMarcas(store.trozosDeArchivo(db, relativa)).texto;
}

async function textoCompleto(
  relativa: string,
  archivo: store.FilaArchivo | null,
  db: store.BaseDatos | null,
): Promise<string> {
  if (relativa.toLowerCase().endsWith('.md')) {
    const leido = await leerArchivoRegular(resolverRutaSegura(relativa));
    if (leido.error) throw new ErrorBiblioteca(`No encontrado: ${relativa}`, 'not_found');
    return leido.data.contenido.toString('utf8');
  }
  if (!archivo || !db) throw new ErrorBiblioteca('Documento aún sin indexar: prueba en unos minutos.', 'not_found');
  if (archivo.status === 'error')
    throw new ErrorBiblioteca(`No se pudo leer el documento: ${archivo.error ?? 'error desconocido'}`, 'read_error');
  return textoDocumento(db, relativa);
}

/**
 * Unas páginas de un documento con páginas (PDF, PowerPoint, Excel): para leer entera una
 * cláusula o un cuadro que la búsqueda ha localizado, sin leer el documento desde el principio.
 */
export function leerPaginasDocumento(rutaCruda: string, paginas: Paginas): FragmentoTexto {
  const relativa = aRelativaBiblioteca(rutaCruda);
  const db = abrirIndiceLectura();
  const archivo = db ? store.obtenerArchivo(db, relativa) : null;
  if (!archivo || !db) throw new ErrorBiblioteca('Documento aún sin indexar: prueba en unos minutos.', 'not_found');
  if (archivo.status === 'error')
    throw new ErrorBiblioteca(`No se pudo leer el documento: ${archivo.error ?? 'error desconocido'}`, 'read_error');
  if (!archivo.pages)
    throw new ErrorBiblioteca(
      'Este documento no tiene páginas (Word, texto o nota): léelo por caracteres con «desde».',
      'invalid_input',
    );
  if (paginas.desde > archivo.pages)
    throw new ErrorBiblioteca(`El documento tiene ${archivo.pages} páginas.`, 'invalid_input');
  const pedidoHasta = Math.min(paginas.hasta, archivo.pages);
  const fin = Math.min(pedidoHasta, paginas.desde + MAX_PAGINAS_LECTURA - 1);
  const crudos = store.trozosDeArchivoPorPagina(db, relativa, paginas.desde, fin);
  // Se quitan antes de medir el tope: lo que se ahorra deja sitio a más texto del pliego.
  const limpio = paginas.sinMembretes
    ? quitarMembretes(crudos, store.trozosDeArchivo(db, relativa))
    : { trozos: crudos, quitadas: 0 };
  const paginado = textoConMarcas(limpio.trozos);
  const t = trozoDePaginas(paginado, { desde: paginas.desde, fin, pedidoHasta, desdeCaracter: paginas.desdeCaracter });
  const total = paginado.texto.length;
  return {
    ruta: relativa,
    titulo: archivo.title,
    tipo: 'document',
    estado: archivo.status,
    paginas: archivo.pages,
    total,
    desde: t.inicio,
    hasta: t.hasta,
    pagina_desde: paginas.desde,
    pagina_hasta: fin,
    recortado: t.hasta < total,
    ultima_pagina_completa: t.hasta < total ? ultimaCompleta(paginado.marcas, t.hasta, paginas.desde) : fin,
    ...(t.empieza_en_pagina !== undefined ? { empieza_en_pagina: t.empieza_en_pagina } : {}),
    ...(paginas.sinMembretes ? { membretes_quitados: limpio.quitadas } : {}),
    ...(t.siguiente ? { siguiente: t.siguiente, nota: notaSiguiente(t.siguiente) } : {}),
    texto: paginado.texto.slice(t.inicio, t.hasta),
  };
}

/** Con recorte por caracteres, la anterior a la página en la que cae el corte; null si ninguna queda acabada. */
function ultimaCompleta(marcas: Marca[], corteEn: number, desde: number): number | null {
  const ultima = marcaEn(marcas, corteEn, desde).pagina;
  return ultima - 1 >= desde ? ultima - 1 : null;
}

function notaSiguiente(s: NonNullable<FragmentoTexto['siguiente']>): string {
  const caracter = s.desde_caracter === undefined ? '' : `, desde_caracter=${s.desde_caracter}`;
  return `Se devuelven como mucho ${MAX_PAGINAS_LECTURA} páginas o ${MAX_CHARS_PAGINAS} caracteres: sigue con pagina_desde=${s.pagina_desde}, pagina_hasta=${s.pagina_hasta}${caracter}`;
}

const LINEAS_BORDE = 3;
const MIN_CHARS_MEMBRETE = 8;
const MIN_PAGINAS_MEMBRETE = 3;
const PROPORCION_MEMBRETE = 0.6;

/** Une los trozos seguidos de una misma página como los junta textoConMarcas (con «\n\n»): el texto no cambia. */
function porPagina(trozos: Trozo[]): Trozo[] {
  const salida: Trozo[] = [];
  for (const t of trozos) {
    const ultimo = salida.at(-1);
    if (ultimo && t.page !== null && ultimo.page === t.page) ultimo.text += `\n\n${t.text}`;
    else salida.push({ ...t });
  }
  return salida;
}

/** Índices de las 3 primeras y las 3 últimas líneas con texto de una página. */
function lineasDeBorde(lineas: string[]): number[] {
  const conTexto = lineas.flatMap((l, i) => (l.trim() ? [i] : []));
  return [...new Set([...conTexto.slice(0, LINEAS_BORDE), ...conTexto.slice(-LINEAS_BORDE)])];
}

/** Líneas de borde que aparecen en al menos el 60 % de las páginas (y en 3 o más): cabeceras y pies. */
function membretesDe(paginas: string[][]): Set<string> {
  if (paginas.length < MIN_PAGINAS_MEMBRETE) return new Set();
  const veces = new Map<string, number>();
  for (const lineas of paginas) {
    const deEsta = new Set(
      lineasDeBorde(lineas)
        .map((i) => lineas[i]!.trim())
        .filter((l) => l.length >= MIN_CHARS_MEMBRETE),
    );
    for (const l of deEsta) veces.set(l, (veces.get(l) ?? 0) + 1);
  }
  const minimo = PROPORCION_MEMBRETE * paginas.length;
  return new Set([...veces].filter(([, n]) => n >= minimo).map(([l]) => l));
}

/**
 * Quita de los trozos de unas páginas las cabeceras y pies que se repiten. Solo mira los bordes de
 * cada página y exige al menos 3 páginas: una línea del cuerpo que se repita (el título de una
 * cláusula) no se toca. Se detectan en `todas` (el documento entero al leer), no solo en las
 * leídas: así cada página sale igual en cualquier lectura, desde_caracter cae siempre en el mismo
 * sitio y también vale al leer una sola página.
 */
export function quitarMembretes(trozos: Trozo[], todas: Trozo[] = trozos): { trozos: Trozo[]; quitadas: number } {
  const membretes = membretesDe(
    porPagina(todas)
      .filter((t) => t.page !== null)
      .map((t) => t.text.split('\n')),
  );
  if (membretes.size === 0) return { trozos, quitadas: 0 };
  let quitadas = 0;
  const limpios = porPagina(trozos).map((t) => {
    if (t.page === null) return t;
    const lineas = t.text.split('\n');
    const fuera = new Set(lineasDeBorde(lineas).filter((i) => membretes.has(lineas[i]!.trim())));
    quitadas += fuera.size;
    return { page: t.page, text: lineas.filter((_, i) => !fuera.has(i)).join('\n') };
  });
  return { trozos: limpios, quitadas };
}

export type TrozoPaginas = {
  inicio: number;
  hasta: number;
  empieza_en_pagina?: number;
  siguiente: FragmentoTexto['siguiente'] | null;
};

/**
 * Qué parte del texto de unas páginas se devuelve y por dónde seguir. Si se corta por el tope de
 * caracteres, se sigue desde la página en la que cae el corte con desde_caracter relativo a su
 * marca: la siguiente lectura empieza justo donde acabó esta (ni repite ni salta texto), también
 * dentro de una página de más de 40.000 caracteres. Se conserva el final pedido: la siguiente
 * llamada vuelve a limitar a 15 y da su propio «siguiente».
 */
export function trozoDePaginas(
  p: TextoPaginado,
  r: { desde: number; fin: number; pedidoHasta: number; desdeCaracter?: number | undefined },
): TrozoPaginas {
  const inicio = Math.min(r.desdeCaracter ?? 0, p.texto.length);
  const hasta = corte(p.texto, inicio);
  const empezada = marcaEn(p.marcas, inicio, r.desde);
  const empieza_en_pagina = inicio > empezada.pos ? empezada.pagina : undefined;
  if (hasta >= p.texto.length) {
    return {
      inicio,
      hasta,
      empieza_en_pagina,
      siguiente: r.fin < r.pedidoHasta ? { pagina_desde: r.fin + 1, pagina_hasta: r.pedidoHasta } : null,
    };
  }
  const marca = marcaEn(p.marcas, hasta, r.desde);
  const dentro = hasta - marca.pos;
  return {
    inicio,
    hasta,
    empieza_en_pagina,
    siguiente: {
      pagina_desde: marca.pagina,
      pagina_hasta: r.pedidoHasta,
      ...(dentro > 0 ? { desde_caracter: dentro } : {}),
    },
  };
}

// La página en la que cae una posición: la de la última marca que empieza en ella o antes.
function marcaEn(marcas: Marca[], pos: number, desde: number): Marca {
  let m: Marca = { pagina: desde, pos: 0 };
  for (const x of marcas) if (x.pos <= pos) m = x;
  return m;
}

// Lo que ocupa un carácter dentro de una cadena JSON.
function costeJson(c: number): number {
  if (c === 0x22 || c === 0x5c || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x08 || c === 0x0c) return 2;
  return c < 0x20 ? 6 : 1;
}

/**
 * Dónde cortar desde `inicio`: hasta 40.000 caracteres y 50.000 escapados, en un salto de línea
 * si lo hay en la segunda mitad (así una marca [pág. N] nunca queda partida: va entre saltos) y,
 * si no, sin partir un par sustituto. Siempre avanza.
 */
function corte(texto: string, inicio: number): number {
  const tope = Math.min(texto.length, inicio + MAX_CHARS_PAGINAS);
  let i = inicio;
  for (let escapado = 0; i < tope; i++) {
    escapado += costeJson(texto.charCodeAt(i));
    if (escapado > MAX_ESCAPADO_PAGINAS) break;
  }
  if (i >= texto.length) return texto.length;
  const salto = texto.lastIndexOf('\n', i - 1);
  if (salto >= inicio + (i - inicio) / 2) return salto + 1;
  const alto = texto.charCodeAt(i - 1);
  return alto >= 0xd800 && alto <= 0xdbff && i - 1 > inicio ? i - 1 : i;
}

/** Texto de una nota (tal cual) o documento (extraído, con marcas de página), por partes. */
export async function leerTexto(
  rutaCruda: string,
  desdeRuta = 0,
  max = MAX_CARACTERES_LECTURA,
): Promise<FragmentoTexto> {
  const relativa = aRelativaBiblioteca(rutaCruda);
  const db = abrirIndiceLectura();
  const archivo = db ? store.obtenerArchivo(db, relativa) : null;
  let texto: string;
  try {
    texto = await textoCompleto(relativa, archivo, db);
  } catch (err) {
    if (err instanceof ErrorBiblioteca) throw err;
    throw new ErrorBiblioteca(`No encontrado: ${relativa}`, 'not_found');
  }
  const desde = Math.max(0, Math.min(desdeRuta, texto.length));
  const hasta = Math.min(texto.length, desde + Math.max(1, Math.min(max, MAX_CARACTERES_LECTURA)));
  return {
    ruta: relativa,
    titulo: archivo?.title ?? path.basename(relativa, path.extname(relativa)),
    tipo: relativa.toLowerCase().endsWith('.md') ? 'note' : 'document',
    estado: archivo?.status ?? 'ok',
    paginas: archivo?.pages ?? null,
    total: texto.length,
    desde,
    hasta,
    texto: texto.slice(desde, hasta),
  };
}

export type EntradaDocumento = {
  ruta: string;
  titulo: string;
  estado: store.EstadoArchivo;
  error: string | null;
  paginas: number | null;
  modificado: string;
  con_nota: boolean;
  propuesta_pendiente: boolean;
};

function fuentesDe(valores: (string | null)[]): Set<string> {
  const salida = new Set<string>();
  for (const value of valores) {
    for (const line of (value ?? '').split('\n')) {
      try {
        if (line.trim()) salida.add(aRelativaBiblioteca(line));
      } catch {
        /* fuera de la bóveda */
      }
    }
  }
  return salida;
}

/**
 * Documentos indexados, los más recientes primero; con `sinNotaPrevia`, solo los que aún no
 * tienen nota ni propuesta. `excluidas`: carpetas que no se listan (p. ej. los CV).
 */
export async function listarDocumentos(
  sinNotaPrevia: boolean,
  limite: number,
  excluidas: readonly string[] = [],
): Promise<{ total: number; documentos: EntradaDocumento[] }> {
  const db = abrirIndiceLectura();
  if (!db) return { total: 0, documentos: [] };
  const conNota = fuentesDe(store.listarArchivos(db, 'note').map((n) => n.source));
  const pendientes = fuentesDe(
    (await listarPendientes()).map((p) =>
      typeof p.frontmatter['fuente'] === 'string' ? p.frontmatter['fuente'] : null,
    ),
  );
  const documentos = store
    .listarArchivos(db, 'document')
    .filter((d) => !enCarpetas(d.path, excluidas))
    .map((d): EntradaDocumento & { mtime: number } => ({
      ruta: d.path,
      titulo: d.title,
      estado: d.status,
      error: d.error,
      paginas: d.pages,
      modificado: new Date(d.mtime_ms).toISOString(),
      mtime: d.mtime_ms,
      con_nota: conNota.has(d.path),
      propuesta_pendiente: pendientes.has(d.path),
    }))
    .filter((d) => !sinNotaPrevia || (!d.con_nota && !d.propuesta_pendiente))
    .sort((a, b) => b.mtime - a.mtime);
  return { total: documentos.length, documentos: documentos.slice(0, limite).map(({ mtime: _mtime, ...d }) => d) };
}
