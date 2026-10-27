// Acceso a la bóveda de notas: listar, leer, crear, escribir, renombrar y borrar notas dentro de rutas seguras.
import path from 'node:path';
import { catalogoDe, type Catalogo } from './catalogo.js';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { obtenerRutaBiblioteca } from './configuracion.js';
import { entorno } from '../entorno.js';
import { iniciarSesionRespaldo, respaldarNota, type SesionRespaldo } from './respaldo.js';
import { CARPETAS_EXCLUIDAS, CARPETA_PROPUESTAS } from './carpetas.js';
import { frontmatterOVacio } from './frontmatter.js';
import { comprobarRutaReal, leerArchivoRegular } from './rutaReal.js';
import { wikilinkTargets } from './wikilinks.js';

// Con el catálogo (tipo, sector, revisión: catalogo.ts) en las del listado.
export type ResumenNota = Partial<Catalogo> & {
  path: string;
  title: string;
  mtime: string;
  size: number;
};

export type Nota = ResumenNota & {
  frontmatter: Record<string, unknown>;
  body: string;
  wikilinks: string[];
};

export type EstadisticasBiblioteca = {
  total_notes: number;
  total_inbox: number;
  last_modified: string | null;
  vault_label: string;
};

// Límite de tamaño al escribir una nota (2 MB). Evita que un PUT enorme llene el disco.
export const MAX_BYTES_NOTA = 2 * 1024 * 1024;

export class ErrorBiblioteca extends Error {
  constructor(
    mensaje: string,
    public readonly code:
      | 'not_configured'
      | 'not_found'
      | 'unsafe_path'
      | 'read_error'
      | 'write_error'
      | 'exists'
      | 'read_only'
      | 'invalid_content'
      | 'invalid_input'
      | 'conflict',
  ) {
    super(mensaje);
    this.name = 'ErrorBiblioteca';
  }
}

function exigirRutaBiblioteca(): string {
  const p = obtenerRutaBiblioteca();
  if (!p) {
    throw new ErrorBiblioteca(
      'No hay bóveda configurada. Ve a Biblioteca de Conocimiento → Ajustes y apunta a la carpeta de tus notas.',
      'not_configured',
    );
  }
  return p;
}

export function resolverRutaSegura(rutaRelativa: string): string {
  const raiz = exigirRutaBiblioteca();
  const relativaNormalizada = path.normalize(rutaRelativa).replace(/\\/g, '/');
  if (relativaNormalizada.startsWith('..') || path.isAbsolute(relativaNormalizada)) {
    throw new ErrorBiblioteca(`Ruta no permitida: ${rutaRelativa}`, 'unsafe_path');
  }
  const resolved = path.resolve(raiz, relativaNormalizada);
  const raizConSeparador = raiz.endsWith(path.sep) ? raiz : raiz + path.sep;
  if (resolved !== raiz && !resolved.startsWith(raizConSeparador)) {
    throw new ErrorBiblioteca(`Ruta fuera de la bóveda: ${rutaRelativa}`, 'unsafe_path');
  }
  const rutaReal = comprobarRutaReal(raiz, resolved);
  if (rutaReal.error) {
    throw new ErrorBiblioteca(
      `${rutaReal.error.message} (${rutaRelativa})`,
      rutaReal.error.code === 'not_found' ? 'not_found' : 'unsafe_path',
    );
  }
  return resolved;
}

function aRelativaPosix(rutaAbsoluta: string, raiz: string): string {
  return path.relative(raiz, rutaAbsoluta).split(path.sep).join('/');
}

function tituloDeRuta(rutaRelativa: string): string {
  const base = rutaRelativa.split('/').pop() ?? rutaRelativa;
  return base.replace(/\.md$/i, '');
}

function extraerTitulo(frontmatter: Record<string, unknown>, rutaRelativa: string): string {
  const crudo = frontmatter['title'];
  if (typeof crudo === 'string' && crudo.trim() !== '') return crudo.trim();
  return tituloDeRuta(rutaRelativa);
}

function extraerWikilinks(cuerpo: string): string[] {
  const hallados = new Set<string>();
  for (const crudo of wikilinkTargets(cuerpo)) {
    const destino = crudo.trim();
    if (destino) hallados.add(destino);
  }
  return Array.from(hallados);
}

async function recorrerMarkdown(raiz: string, actual: string, salida: string[]): Promise<void> {
  let entradas;
  try {
    entradas = await fs.readdir(actual, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entrada of entradas) {
    if (entrada.isDirectory()) {
      // Las carpetas ocultas (.git, .trash, .hermes-vault, .gdocs…) se saltan siempre.
      if (CARPETAS_EXCLUIDAS.has(entrada.name) || entrada.name.startsWith('.')) continue;
      await recorrerMarkdown(raiz, path.join(actual, entrada.name), salida);
    } else if (entrada.isFile() && entrada.name.toLowerCase().endsWith('.md')) {
      salida.push(path.join(actual, entrada.name));
    }
  }
}

// null si entre el recorrido y la lectura dejó de ser un archivo normal (p. ej. se
// cambió por un enlace): se omite en vez de tumbar el listado entero.
async function resumir(rutaAbsoluta: string, raiz: string): Promise<ResumenNota | null> {
  const leido = await leerArchivoRegular(rutaAbsoluta);
  if (leido.error) return null;
  const rutaRelativa = aRelativaPosix(rutaAbsoluta, raiz);
  const analizado = frontmatterOVacio(leido.data.contenido.toString('utf8'));
  const modificadoEn = leido.data.stat.mtime.toISOString();
  return {
    path: rutaRelativa,
    title: extraerTitulo(analizado.data, rutaRelativa),
    mtime: modificadoEn,
    size: leido.data.stat.size,
    ...catalogoDe(analizado.data, rutaRelativa, modificadoEn),
  };
}

export async function listarNotas(): Promise<ResumenNota[]> {
  const raiz = exigirRutaBiblioteca();
  const rutasAbsolutas: string[] = [];
  await recorrerMarkdown(raiz, raiz, rutasAbsolutas);
  const resumenes = (await Promise.all(rutasAbsolutas.map((p) => resumir(p, raiz)))).filter(
    (s): s is ResumenNota => s !== null,
  );
  resumenes.sort((a, b) => a.path.localeCompare(b.path));
  return resumenes;
}

export async function leerNota(rutaRelativa: string): Promise<Nota> {
  const rutaAbsoluta = resolverRutaSegura(rutaRelativa);
  const leido = await leerArchivoRegular(rutaAbsoluta);
  if (leido.error) {
    if (leido.error.code === 'read_error')
      throw new ErrorBiblioteca(`Error leyendo nota: ${leido.error.message}`, 'read_error');
    throw new ErrorBiblioteca(`Nota no encontrada: ${rutaRelativa}`, 'not_found');
  }
  const { stat } = leido.data;
  const analizado = frontmatterOVacio(leido.data.contenido.toString('utf8'));
  const raiz = exigirRutaBiblioteca();
  const relativaNormalizada = aRelativaPosix(rutaAbsoluta, raiz);
  const frontmatter = analizado.data;
  return {
    path: relativaNormalizada,
    title: extraerTitulo(frontmatter, relativaNormalizada),
    mtime: stat.mtime.toISOString(),
    size: stat.size,
    frontmatter,
    body: analizado.content,
    wikilinks: extraerWikilinks(analizado.content),
  };
}

export async function obtenerRecientes(limite = 10): Promise<ResumenNota[]> {
  const todas = await listarNotas();
  todas.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return todas.slice(0, Math.max(0, limite));
}

export async function obtenerEstadisticas(): Promise<EstadisticasBiblioteca> {
  const raiz = exigirRutaBiblioteca();
  const todas = await listarNotas();
  const ultimaModificacion = todas.reduce<string | null>(
    (acumulado, n) => (acumulado === null || n.mtime > acumulado ? n.mtime : acumulado),
    null,
  );
  let cuentaBandeja = 0;
  try {
    const carpetaBandeja = path.join(raiz, CARPETA_PROPUESTAS);
    const entradas = await fs.readdir(carpetaBandeja, { withFileTypes: true });
    for (const entrada of entradas) {
      if (!entrada.isFile() || !entrada.name.toLowerCase().endsWith('.md')) continue;
      const leido = await leerArchivoRegular(path.join(carpetaBandeja, entrada.name));
      if (leido.error) continue;
      const estado = frontmatterOVacio(leido.data.contenido.toString('utf8')).data['estado'];
      if (typeof estado === 'string' && estado.toLowerCase() === 'pendiente') {
        cuentaBandeja += 1;
      }
    }
  } catch {
    cuentaBandeja = 0;
  }
  return {
    total_notes: todas.length,
    total_inbox: cuentaBandeja,
    last_modified: ultimaModificacion,
    vault_label: path.basename(raiz),
  };
}

function exigirEscribible(): void {
  if (entorno.HERMES_VAULT_MODE === 'server') {
    throw new ErrorBiblioteca('En modo servidor las notas son de solo lectura.', 'read_only');
  }
}

function exigirMd(rutaRelativa: string): void {
  if (!rutaRelativa.toLowerCase().endsWith('.md')) {
    throw new ErrorBiblioteca(`Solo se permiten archivos .md: ${rutaRelativa}`, 'unsafe_path');
  }
}

function exigirContenido(contenido: unknown): asserts contenido is string {
  if (typeof contenido !== 'string') {
    throw new ErrorBiblioteca('El contenido de la nota debe ser texto.', 'invalid_content');
  }
  if (Buffer.byteLength(contenido, 'utf8') > MAX_BYTES_NOTA) {
    throw new ErrorBiblioteca(`La nota supera el límite de ${MAX_BYTES_NOTA} bytes.`, 'invalid_content');
  }
}

async function rutaExiste(rutaAbsoluta: string): Promise<boolean> {
  try {
    await fs.stat(rutaAbsoluta);
    return true;
  } catch {
    return false;
  }
}

// Huella del contenido: el editor la guarda al abrir la nota y la devuelve al
// guardar, para detectar si la nota cambió fuera del editor entretanto (p. ej. al
// sincronizar desde Google Drive).
function hashContenido(contenido: string): string {
  return createHash('sha256').update(contenido, 'utf8').digest('hex');
}

export async function leerNotaCruda(rutaRelativa: string): Promise<{ path: string; content: string; hash: string }> {
  exigirEscribible();
  exigirMd(rutaRelativa);
  const rutaAbsoluta = resolverRutaSegura(rutaRelativa);
  const raiz = exigirRutaBiblioteca();
  const leido = await leerArchivoRegular(rutaAbsoluta);
  if (leido.error) {
    if (leido.error.code === 'read_error')
      throw new ErrorBiblioteca(`Error leyendo nota: ${leido.error.message}`, 'read_error');
    throw new ErrorBiblioteca(`Nota no encontrada: ${rutaRelativa}`, 'not_found');
  }
  const crudo = leido.data.contenido.toString('utf8');
  return { path: aRelativaPosix(rutaAbsoluta, raiz), content: crudo, hash: hashContenido(crudo) };
}

export async function crearNota(
  rutaRelativa: string,
  contenido: unknown = '',
): Promise<{ path: string; content: string; hash: string }> {
  exigirEscribible();
  exigirMd(rutaRelativa);
  exigirContenido(contenido);
  const rutaAbsoluta = resolverRutaSegura(rutaRelativa);
  const raiz = exigirRutaBiblioteca();
  if (await rutaExiste(rutaAbsoluta)) {
    throw new ErrorBiblioteca('Ya existe una nota en esa ruta.', 'exists');
  }
  try {
    await fs.mkdir(path.dirname(rutaAbsoluta), { recursive: true });
    // «wx»: si entretanto apareció algo (o un enlace) en esa ruta, no se sigue ni se pisa.
    await fs.writeFile(rutaAbsoluta, contenido, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    throw new ErrorBiblioteca(`No se pudo crear la nota: ${(err as Error).message}`, 'write_error');
  }
  return { path: aRelativaPosix(rutaAbsoluta, raiz), content: contenido, hash: hashContenido(contenido) };
}

async function escribirArchivoAtomico(rutaAbsoluta: string, contenido: string): Promise<void> {
  const directorio = path.dirname(rutaAbsoluta);
  const temporal = path.join(directorio, `.${path.basename(rutaAbsoluta)}.${Date.now()}.tmp`);
  try {
    // «wx»: el nombre del temporal se puede adivinar y alguien podría dejar ahí un enlace.
    await fs.writeFile(temporal, contenido, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporal, rutaAbsoluta);
  } catch {
    try {
      await fs.unlink(temporal);
    } catch {
      // ignore cleanup errors
    }
    await fs.writeFile(rutaAbsoluta, contenido, 'utf8');
  }
}

/**
 * Sobrescribe (o crea) una nota, respaldando antes la versión anterior. Con
 * `huellaBase` (la huella que el editor leyó), falla con `conflict` sin escribir si
 * la nota cambió o desapareció desde entonces.
 */
export async function escribirNotaCruda(
  rutaRelativa: string,
  contenido: unknown,
  huellaBase?: unknown,
): Promise<{ path: string; content: string; hash: string }> {
  exigirEscribible();
  exigirMd(rutaRelativa);
  exigirContenido(contenido);
  const rutaAbsoluta = resolverRutaSegura(rutaRelativa);
  const raiz = exigirRutaBiblioteca();
  const relativaPosix = aRelativaPosix(rutaAbsoluta, raiz);
  if (typeof huellaBase === 'string' && huellaBase !== '') {
    const leido = await leerArchivoRegular(rutaAbsoluta);
    const actual = leido.data ? leido.data.contenido.toString('utf8') : null;
    if (actual === null || hashContenido(actual) !== huellaBase) {
      throw new ErrorBiblioteca(
        actual === null
          ? 'La nota ya no existe: se borró o se movió fuera del editor mientras la editabas.'
          : 'La nota ha cambiado fuera del editor (p. ej. al sincronizar desde Google Drive) desde que empezaste a editarla.',
        'conflict',
      );
    }
  }
  try {
    if (await rutaExiste(rutaAbsoluta)) {
      const sesion = iniciarSesionRespaldo();
      await respaldarNota(sesion, relativaPosix);
    }
    await fs.mkdir(path.dirname(rutaAbsoluta), { recursive: true });
    await escribirArchivoAtomico(rutaAbsoluta, contenido);
  } catch (err) {
    if (err instanceof ErrorBiblioteca) throw err;
    throw new ErrorBiblioteca(`No se pudo escribir la nota: ${(err as Error).message}`, 'write_error');
  }
  return { path: relativaPosix, content: contenido, hash: hashContenido(contenido) };
}

export async function borrarNota(rutaRelativa: string): Promise<{ path: string; deleted: true }> {
  exigirEscribible();
  exigirMd(rutaRelativa);
  const rutaAbsoluta = resolverRutaSegura(rutaRelativa);
  const raiz = exigirRutaBiblioteca();
  const relativaPosix = aRelativaPosix(rutaAbsoluta, raiz);
  if (!(await rutaExiste(rutaAbsoluta))) {
    throw new ErrorBiblioteca('Nota no encontrada.', 'not_found');
  }
  try {
    const sesion = iniciarSesionRespaldo();
    await respaldarNota(sesion, relativaPosix);
    await fs.unlink(rutaAbsoluta);
  } catch (err) {
    if (err instanceof ErrorBiblioteca) throw err;
    throw new ErrorBiblioteca(`No se pudo eliminar la nota: ${(err as Error).message}`, 'write_error');
  }
  return { path: relativaPosix, deleted: true };
}

// True si dos rutas son el mismo archivo (p. ej. solo cambian mayúsculas en un
// disco que no las distingue, como en Windows o macOS).
async function mismoArchivo(a: string, b: string): Promise<boolean> {
  try {
    const [sa, sb] = await Promise.all([fs.stat(a), fs.stat(b)]);
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
}

export async function renombrarNota(
  origenRelativa: string,
  relativaDestino: string,
  sesion: SesionRespaldo = iniciarSesionRespaldo(),
): Promise<{ from: string; to: string }> {
  exigirEscribible();
  exigirMd(origenRelativa);
  exigirMd(relativaDestino);
  const origenAbsoluta = resolverRutaSegura(origenRelativa);
  const destinoAbsoluta = resolverRutaSegura(relativaDestino);
  const raiz = exigirRutaBiblioteca();
  const origenPosix = aRelativaPosix(origenAbsoluta, raiz);
  const destinoPosix = aRelativaPosix(destinoAbsoluta, raiz);
  if (origenPosix === destinoPosix) {
    throw new ErrorBiblioteca('La ruta nueva es igual a la actual.', 'exists');
  }
  if (!(await rutaExiste(origenAbsoluta))) {
    throw new ErrorBiblioteca('Nota no encontrada.', 'not_found');
  }
  if ((await rutaExiste(destinoAbsoluta)) && !(await mismoArchivo(origenAbsoluta, destinoAbsoluta))) {
    throw new ErrorBiblioteca('Ya existe una nota en esa ruta.', 'exists');
  }
  try {
    await respaldarNota(sesion, origenPosix);
    await fs.mkdir(path.dirname(destinoAbsoluta), { recursive: true });
    await fs.rename(origenAbsoluta, destinoAbsoluta);
  } catch (err) {
    if (err instanceof ErrorBiblioteca) throw err;
    throw new ErrorBiblioteca(`No se pudo renombrar la nota: ${(err as Error).message}`, 'write_error');
  }
  return { from: origenPosix, to: destinoPosix };
}

async function recorrerCarpetas(raiz: string, actual: string, salida: Set<string>): Promise<void> {
  let entradas;
  try {
    entradas = await fs.readdir(actual, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entrada of entradas) {
    if (!entrada.isDirectory()) continue;
    if (entrada.name.startsWith('.') || CARPETAS_EXCLUIDAS.has(entrada.name)) {
      continue;
    }
    const absoluta = path.join(actual, entrada.name);
    salida.add(aRelativaPosix(absoluta, raiz));
    await recorrerCarpetas(raiz, absoluta, salida);
  }
}

export async function listarCarpetas(): Promise<string[]> {
  const raiz = exigirRutaBiblioteca();
  const hallados = new Set<string>();
  await recorrerCarpetas(raiz, raiz, hallados);
  const carpetas = Array.from(hallados).sort((a, b) => a.localeCompare(b));
  return ['', ...carpetas];
}
