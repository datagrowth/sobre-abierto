// Bandeja de propuestas de la Biblioteca: crea, lista, edita, aprueba y rechaza las notas que propone Hermes.
import path from 'node:path';
import fs from 'node:fs/promises';
import { obtenerRutaBiblioteca } from './configuracion.js';
import { CARPETA_GDOCS, CARPETA_PROPUESTAS } from './carpetas.js';
import { frontmatterOVacio, leerFrontmatter, serializarFrontmatter } from './frontmatter.js';
import { comprobarRutaReal, leerArchivoRegular } from './rutaReal.js';

export type ElementoBandeja = {
  path: string;
  title: string;
  mtime: string;
  size: number;
  preview: string;
  frontmatter: Record<string, unknown>;
};

export class ErrorBandeja extends Error {
  constructor(
    mensaje: string,
    public readonly code: 'not_configured' | 'not_found' | 'invalid_state' | 'io_error',
  ) {
    super(mensaje);
    this.name = 'ErrorBandeja';
  }
}

function exigirRutaBiblioteca(): string {
  const p = obtenerRutaBiblioteca();
  if (!p) {
    throw new ErrorBandeja(
      'No hay bóveda configurada. Ve a Biblioteca de Conocimiento → Ajustes y apunta a la carpeta de tus notas.',
      'not_configured',
    );
  }
  return p;
}

// Ruta dentro de la bóveda también al resolver enlaces: Hermes podría cambiar
// _Propuestas (o una carpeta de destino) por un enlace a otra parte del servidor.
function dentroDeLaBoveda(absoluta: string): string {
  const rutaReal = comprobarRutaReal(exigirRutaBiblioteca(), absoluta);
  if (rutaReal.error) throw new ErrorBandeja(`Ruta no permitida: ${rutaReal.error.message}`, 'not_found');
  return absoluta;
}

function carpetaBandeja(): string {
  return dentroDeLaBoveda(path.join(exigirRutaBiblioteca(), CARPETA_PROPUESTAS));
}

function carpetaRechazadas(): string {
  return dentroDeLaBoveda(path.join(carpetaBandeja(), '.rejected'));
}

function resolverEnBandeja(nombreArchivo: string): string {
  // Sin separadores de carpeta no hay forma de salir de _Propuestas: «..» dentro del
  // nombre es legítimo (un título acabado en punto da «… S.A..md») y no se rechaza.
  if (
    nombreArchivo.includes('/') ||
    nombreArchivo.includes('\\') ||
    nombreArchivo.includes('\0') ||
    nombreArchivo === '..' ||
    nombreArchivo === '.'
  ) {
    throw new ErrorBandeja(`Ruta no permitida: ${nombreArchivo}`, 'not_found');
  }
  if (!nombreArchivo.toLowerCase().endsWith('.md')) {
    throw new ErrorBandeja(`Solo se aceptan archivos .md: ${nombreArchivo}`, 'not_found');
  }
  return dentroDeLaBoveda(path.join(carpetaBandeja(), nombreArchivo));
}

function vistaPreviaDeCuerpo(cuerpo: string, maxCaracteres = 180): string {
  const sinMarcas = cuerpo
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sinMarcas.length > maxCaracteres ? sinMarcas.slice(0, maxCaracteres).trimEnd() + '…' : sinMarcas;
}

export async function listarPendientes(): Promise<ElementoBandeja[]> {
  const directorio = carpetaBandeja();
  let entradas: import('node:fs').Dirent[];
  try {
    entradas = await fs.readdir(directorio, { withFileTypes: true });
  } catch {
    return [];
  }
  const elementos: ElementoBandeja[] = [];
  for (const entrada of entradas) {
    if (!entrada.isFile() || !entrada.name.toLowerCase().endsWith('.md')) continue;
    const absoluta = path.join(directorio, entrada.name);
    try {
      const leido = await leerArchivoRegular(absoluta);
      if (leido.error) continue;
      const { stat } = leido.data;
      const analizado = frontmatterOVacio(leido.data.contenido.toString('utf8'));
      const fm = analizado.data;
      const estado = fm['estado'];
      if (typeof estado !== 'string' || estado.toLowerCase() !== 'pendiente') continue;
      const tituloCrudo = fm['title'];
      const titulo =
        typeof tituloCrudo === 'string' && tituloCrudo.trim() !== ''
          ? tituloCrudo.trim()
          : entrada.name.replace(/\.md$/i, '');
      elementos.push({
        path: entrada.name,
        title: titulo,
        mtime: stat.mtime.toISOString(),
        size: stat.size,
        preview: vistaPreviaDeCuerpo(analizado.content),
        frontmatter: fm,
      });
    } catch {
      // ignorar archivos que fallen
    }
  }
  elementos.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return elementos;
}

async function asegurarDestinoUnico(carpetaDestino: string, nombreArchivo: string): Promise<string> {
  const base = nombreArchivo.replace(/\.md$/i, '');
  let candidato = path.join(carpetaDestino, nombreArchivo);
  let intento = 0;
  while (true) {
    try {
      await fs.access(candidato);
      intento += 1;
      candidato = path.join(carpetaDestino, `${base}-${intento}.md`);
    } catch {
      return candidato;
    }
  }
}

// Carpeta relativa segura (sin «..», ni absoluta, ni oculta), o null.
function carpetaSegura(crudo: unknown): string | null {
  if (typeof crudo !== 'string') return null;
  const partesZip = crudo
    .replace(/\\/g, '/')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (partesZip.some((p) => p === '..' || p.startsWith('.') || p === CARPETA_PROPUESTAS)) return null;
  return partesZip.join('/');
}

/**
 * Dónde queda una propuesta al aprobarla: la carpeta que pide («carpeta»), o la
 * del documento del que sale («fuente»), para que la nota de una licitación
 * quede junto a sus pliegos. Si no, la raíz.
 */
export function carpetaAprobacion(fm: Record<string, unknown>): string {
  const explicita = carpetaSegura(fm['carpeta']);
  if (explicita !== null) return explicita;
  const fuente = typeof fm['fuente'] === 'string' ? fm['fuente'].replace(/\\/g, '/') : '';
  const desdeFuente = fuente.startsWith(`${CARPETA_GDOCS}/`) ? fuente.slice(CARPETA_GDOCS.length + 1) : fuente;
  return carpetaSegura(path.posix.dirname(desdeFuente)) ?? '';
}

export async function aprobar(nombreArchivo: string): Promise<{ moved_to: string }> {
  const origen = resolverEnBandeja(nombreArchivo);
  const leido = await leerArchivoRegular(origen);
  if (leido.error) throw new ErrorBandeja(`Nota no encontrada en inbox: ${nombreArchivo}`, 'not_found');
  const analizado = leerFrontmatter(leido.data.contenido.toString('utf8'));
  if (analizado.error)
    throw new ErrorBandeja(`La propuesta no se puede aprobar: ${analizado.error.message}`, 'invalid_state');
  const fm = analizado.data.data;
  fm['estado'] = 'aprobada';
  fm['aprobada_en'] = new Date().toISOString();
  const actualizada = serializarFrontmatter(analizado.data.content, fm);
  if (actualizada.error) throw new ErrorBandeja(actualizada.error.message, 'invalid_state');
  const raiz = exigirRutaBiblioteca();
  const carpetaDestino = dentroDeLaBoveda(path.join(raiz, carpetaAprobacion(fm)));
  await fs.mkdir(carpetaDestino, { recursive: true });
  const destino = await asegurarDestinoUnico(carpetaDestino, nombreArchivo);
  try {
    await fs.writeFile(destino, actualizada.data, { encoding: 'utf8', flag: 'wx' });
    await fs.unlink(origen);
  } catch (err) {
    throw new ErrorBandeja(`Error moviendo nota: ${(err as Error).message}`, 'io_error');
  }
  const relativa = path.relative(raiz, destino).split(path.sep).join('/');
  return { moved_to: relativa };
}

const MAX_PROPUESTA = 2 * 1024 * 1024;

async function pendiente(nombreArchivo: string): Promise<{ abs: string; fm: Record<string, unknown>; body: string }> {
  const absoluta = resolverEnBandeja(nombreArchivo);
  const leido = await leerArchivoRegular(absoluta);
  if (leido.error) throw new ErrorBandeja(`Nota no encontrada en inbox: ${nombreArchivo}`, 'not_found');
  const analizado = leerFrontmatter(leido.data.contenido.toString('utf8'));
  if (analizado.error)
    throw new ErrorBandeja(`La propuesta no se puede leer: ${analizado.error.message}`, 'invalid_state');
  if (analizado.data.data['estado'] !== 'pendiente')
    throw new ErrorBandeja('Esa propuesta ya no está pendiente.', 'invalid_state');
  return { abs: absoluta, fm: analizado.data.data, body: analizado.data.content };
}

/** «Editar antes» de aprobar: el título y el cuerpo; el frontmatter (origen, fuente…) es de la plataforma. */
export async function leerPropuesta(
  nombreArchivo: string,
): Promise<{ title: string; body: string; frontmatter: Record<string, unknown> }> {
  const p = await pendiente(nombreArchivo);
  return {
    title: typeof p.fm['title'] === 'string' ? p.fm['title'] : nombreArchivo.replace(/\.md$/i, ''),
    body: p.body,
    frontmatter: p.fm,
  };
}

export async function editarPropuesta(nombreArchivo: string, cambio: { title: string; body: string }): Promise<void> {
  if (Buffer.byteLength(cambio.body, 'utf8') > MAX_PROPUESTA)
    throw new ErrorBandeja('La nota pasa de 2 MB.', 'invalid_state');
  const p = await pendiente(nombreArchivo);
  const texto = serializarFrontmatter(cambio.body, {
    ...p.fm,
    title: cambio.title,
    editada_en: new Date().toISOString(),
  });
  if (texto.error) throw new ErrorBandeja(texto.error.message, 'invalid_state');
  try {
    await fs.writeFile(p.abs, texto.data, 'utf8');
  } catch (err) {
    throw new ErrorBandeja(`Error guardando la propuesta: ${(err as Error).message}`, 'io_error');
  }
}

export async function rechazar(nombreArchivo: string): Promise<{ moved_to: string }> {
  const origen = resolverEnBandeja(nombreArchivo);
  try {
    await fs.access(origen);
  } catch {
    throw new ErrorBandeja(`Nota no encontrada en inbox: ${nombreArchivo}`, 'not_found');
  }
  const rechazada = carpetaRechazadas();
  try {
    await fs.mkdir(rechazada, { recursive: true });
  } catch (err) {
    throw new ErrorBandeja(`Error creando carpeta .rejected: ${(err as Error).message}`, 'io_error');
  }
  const marca = new Date().toISOString().replace(/[:.]/g, '-');
  const nombreConMarca = nombreArchivo.replace(/\.md$/i, `-${marca}.md`);
  const destino = path.join(rechazada, nombreConMarca);
  try {
    await fs.rename(origen, destino);
  } catch (err) {
    throw new ErrorBandeja(`Error moviendo nota a .rejected: ${(err as Error).message}`, 'io_error');
  }
  const raiz = exigirRutaBiblioteca();
  const relativa = path.relative(raiz, destino).split(path.sep).join('/');
  return { moved_to: relativa };
}

export type EntradaPropuesta = {
  title: string;
  body: string;
  source?: string;
  folder?: string;
  reason?: string;
  /** Quién la propone (el agente); por defecto «hermes». */
  origin?: string;
};

// Nombre de archivo a partir del título: sin caracteres que Drive, Windows o una
// ruta no admiten, y corto.
export function nombreArchivoPropuesta(titulo: string): string {
  const base = titulo
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- los caracteres de control son justo lo que se descarta
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 100)
    .trim();
  return `${base || 'Propuesta'}.md`;
}

// Claves que pone la propuesta. «carpeta» y «fuente» deciden dónde queda la nota al
// aprobarla: si el agente las mete en su propio frontmatter se saltaría la validación de
// la ruta, la exclusión de Colaboradores/ y la de las carpetas con ficha.
const CLAVES_RESERVADAS = ['title', 'estado', 'origen', 'creada_en', 'fuente', 'carpeta', 'motivo', 'aprobada_en'];

// El frontmatter que traiga la nota (tipo, organismo, importe…) se conserva salvo las
// claves reservadas; el de la propuesta manda. Si no se puede leer, el texto va tal cual.
function contenidoPropuesta(entrada: EntradaPropuesta): string {
  const { data: propio, content: cuerpo } = frontmatterOVacio(entrada.body);
  for (const clave of CLAVES_RESERVADAS) delete propio[clave];
  const fm: Record<string, unknown> = {
    ...propio,
    title: entrada.title,
    estado: 'pendiente',
    origen: entrada.origin ?? 'hermes',
    creada_en: new Date().toISOString(),
  };
  if (entrada.source) fm['fuente'] = entrada.source;
  if (entrada.folder) fm['carpeta'] = entrada.folder;
  if (entrada.reason) fm['motivo'] = entrada.reason;
  const salida = serializarFrontmatter(cuerpo, fm);
  if (salida.error) throw new ErrorBandeja(salida.error.message, 'io_error');
  return salida.data;
}

// «fuente» o «carpeta» dentro de `from` (o de su copia en .gdocs/) pasan a `to`.
function reubicada(value: unknown, desdeRuta: string, to: string): string | null {
  if (typeof value !== 'string') return null;
  const v = value.replace(/\\/g, '/');
  for (const [a, b] of [
    [desdeRuta, to],
    [`${CARPETA_GDOCS}/${desdeRuta}`, `${CARPETA_GDOCS}/${to}`],
  ] as const) {
    if (v === a || v.startsWith(`${a}/`)) return b + v.slice(a.length);
  }
  return null;
}

/**
 * Cuando una carpeta cambia de sitio (p. ej. la reorganización de Licitaciones), las
 * propuestas pendientes que salen de ella apuntan a la ruta nueva: al aprobarlas, la nota
 * queda junto a su documento y no vuelve a crear la carpeta vieja. Devuelve cuántas cambió.
 */
export async function reubicarPropuestasPendientes(desdeRuta: string, to: string): Promise<number> {
  const pendientes = await listarPendientes();
  let cambiado = 0;
  for (const elemento of pendientes) {
    const fm = { ...elemento.frontmatter };
    const fuente = reubicada(fm['fuente'], desdeRuta, to);
    const carpeta = reubicada(fm['carpeta'], desdeRuta, to);
    if (fuente === null && carpeta === null) continue;
    if (fuente !== null) fm['fuente'] = fuente;
    if (carpeta !== null) fm['carpeta'] = carpeta;
    const absoluta = resolverEnBandeja(elemento.path);
    const leido = await leerArchivoRegular(absoluta);
    if (leido.error) continue;
    const salida = serializarFrontmatter(frontmatterOVacio(leido.data.contenido.toString('utf8')).content, fm);
    if (salida.error) continue;
    await fs.writeFile(absoluta, salida.data, 'utf8');
    cambiado += 1;
  }
  return cambiado;
}

/** Deja una propuesta de nota en _Propuestas, pendiente de aprobar. */
export async function crearPropuesta(entrada: EntradaPropuesta): Promise<{ path: string }> {
  const directorio = carpetaBandeja();
  try {
    await fs.mkdir(directorio, { recursive: true });
    const destino = await asegurarDestinoUnico(directorio, nombreArchivoPropuesta(entrada.title));
    await fs.writeFile(destino, contenidoPropuesta(entrada), { encoding: 'utf8', flag: 'wx' });
    return { path: `${CARPETA_PROPUESTAS}/${path.basename(destino)}` };
  } catch (err) {
    throw new ErrorBandeja(`No se pudo guardar la propuesta: ${(err as Error).message}`, 'io_error');
  }
}
