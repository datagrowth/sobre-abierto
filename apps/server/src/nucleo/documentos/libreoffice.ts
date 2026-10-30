// LibreOffice sin interfaz (soffice) como conversor de documentos: .doc/.rtf → .docx y .docx → PDF.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { logger } from '../log.js';
import { errorMessage, fail, ok, type Result } from '../result.js';

// Convierte .doc/.rtf → .docx para leerlos en la Biblioteca y .docx → PDF para contar páginas reales. Es
// opcional: sin él, todo lo demás funciona y quien lo necesita recibe un error como valor.
const ejecutar = promisify(execFile);
const log = logger('documentos.libreoffice');

export type Destino = 'docx' | 'pdf';
type EstadoConversor = 'ok' | 'ausente' | 'apagado';
export type Conversor = { estado: EstadoConversor; binario: string | null; version: string | null };
export type ResumenConversor = {
  estado: EstadoConversor | 'sin_comprobar';
  version: string | null;
  en_cola: number;
  hechas: number;
  fallidas: number;
  ultima_ms: number | null;
};
type Entorno = { LIBREOFFICE_BIN?: string | undefined; LIBREOFFICE_ACTIVO?: string | undefined };

const RUTA_DEBIAN = '/usr/lib/libreoffice/program/soffice.bin';
const RUTA_WINDOWS = 'C:\\Program Files\\LibreOffice\\program\\soffice.exe';
// Perfil de usuario y cerrojo propios, fuera de HOME (el servidor corre con un uid sin home).
const BASE = path.join(os.tmpdir(), 'lo');
const PERFIL = path.join(BASE, 'perfil');
const LOCK = path.join(BASE, 'lock');
const TIMEOUT_MS = 120_000;
const ESPERA_LOCK_MS = 250;
const MAX_ENTRADA_BYTES = 100 * 1024 * 1024;
const FILTROS: Record<Destino, string> = { docx: 'docx:MS Word 2007 XML', pdf: 'pdf:writer_pdf_Export' };

const contadores = { en_cola: 0, hechas: 0, fallidas: 0, ultima_ms: null as number | null };

function argumentosBase(): string[] {
  return [
    `-env:UserInstallation=${pathToFileURL(PERFIL).href}`,
    '--headless',
    '--norestore',
    '--nologo',
    '--nodefault',
    '--nolockcheck',
  ];
}

function candidatos(entorno: Entorno): string[] {
  const bin = entorno.LIBREOFFICE_BIN?.trim();
  return [...new Set([bin, RUTA_DEBIAN, 'soffice', RUTA_WINDOWS].filter((r): r is string => Boolean(r)))];
}

async function probar(bin: string): Promise<Conversor | null> {
  try {
    const { stdout } = await ejecutar(bin, [...argumentosBase(), '--version'], {
      timeout: 30_000,
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    // En Windows soffice.exe no escribe en la consola: con salir bien basta.
    return { estado: 'ok', binario: bin, version: /LibreOffice\s+([\d.]+)/.exec(stdout)?.[1] ?? null };
  } catch {
    return null;
  }
}

/** Sin caché: comprueba el entorno dado probando cada binario candidato (los tests pasan el suyo). */
export async function comprobarConversor(
  entorno: Entorno = process.env,
  rutas = candidatos(entorno),
): Promise<Conversor> {
  if (entorno.LIBREOFFICE_ACTIVO === '0') return { estado: 'apagado', binario: null, version: null };
  await fs.mkdir(PERFIL, { recursive: true }).catch(() => undefined);
  for (const bin of rutas) {
    const c = await probar(bin);
    if (c) return c;
  }
  return { estado: 'ausente', binario: null, version: null };
}

let comprobacion: Promise<Conversor> | null = null;
let ultimo: Conversor | null = null;

/** Si hay LibreOffice (cacheado por proceso: el binario no aparece ni desaparece en caliente). */
export function disponible(): Promise<Conversor> {
  comprobacion ??= comprobarConversor().then((c) => {
    ultimo = c;
    return c;
  });
  return comprobacion;
}

/** Estado y contadores de este proceso, para plataforma_estado. */
export function estadoConversor(): ResumenConversor {
  return { estado: ultimo?.estado ?? 'sin_comprobar', version: ultimo?.version ?? null, ...contadores };
}

async function edadMs(dir: string): Promise<number | null> {
  const st = await fs.stat(dir).catch(() => null);
  return st ? Date.now() - st.mtimeMs : null;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tomarLock(lock: string, timeoutMs: number): Promise<boolean> {
  const limite = Date.now() + timeoutMs * 1.5;
  while (Date.now() < limite) {
    try {
      await fs.mkdir(lock, { recursive: false });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    // Un soffice matado a mitad deja el cerrojo puesto: pasado el doble del tiempo máximo
    // de una conversión nadie lo está usando.
    const edad = await edadMs(lock);
    if (edad !== null && edad > timeoutMs * 2) await fs.rm(lock, { recursive: true, force: true });
    else await dormir(ESPERA_LOCK_MS);
  }
  return false;
}

export type OpcionesLock = { lock?: string; timeoutMs?: number };

/**
 * Un soffice a la vez: el indexador es otro hilo y, con el mismo perfil, el segundo soffice
 * sale con código 0 sin producir nada. El cerrojo es una carpeta (mkdir es atómico).
 */
export async function conLock<T>(
  fn: () => Promise<Result<T>>,
  { lock = LOCK, timeoutMs = TIMEOUT_MS }: OpcionesLock = {},
): Promise<Result<T>> {
  await fs.mkdir(path.dirname(lock), { recursive: true });
  if (!(await tomarLock(lock, timeoutMs)))
    return fail('conversion_timeout', 'LibreOffice sigue ocupado con otra conversión.');
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { recursive: true, force: true }).catch(() => undefined);
  }
}

function sinConversor(c: Conversor): Result<never> {
  if (c.estado === 'apagado')
    return fail('conversor_apagado', 'LibreOffice está apagado en el servidor (LIBREOFFICE_ACTIVO=0).');
  return fail('conversor_ausente', 'No hay LibreOffice en el servidor.');
}

function errorDeSoffice(err: unknown): Result<never> {
  const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: string | number };
  if (e.killed || e.signal === 'SIGKILL')
    return fail('conversion_timeout', 'LibreOffice tardó demasiado en convertir el documento.');
  return fail(
    'conversion_fallida',
    `LibreOffice no pudo convertir el documento (código ${String(e.code ?? 'desconocido')}).`,
  );
}

/**
 * Código 81: soffice pide reiniciarse. Lo hace la primera vez con un perfil nuevo, y el perfil
 * vive en /tmp: tras cada despliegue, la primera conversión salía así. Se repite una vez.
 */
export function pideReinicio(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 81;
}

async function ejecutarSoffice(
  bin: string,
  entrada: string,
  destino: Destino,
  outDir: string,
  timeoutMs: number,
): Promise<Result<string>> {
  const args = [...argumentosBase(), '--convert-to', FILTROS[destino], '--outdir', outDir, entrada];
  // Convierte documentos de fuera: sin las claves y tokens del entorno del monitor, solo lo que soffice usa.
  const env = Object.fromEntries(
    ['PATH', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']
      .filter((k) => process.env[k] !== undefined)
      .map((k) => [k, process.env[k]]),
  );
  env.HOME = process.env.HOME || os.tmpdir();
  const opciones = {
    timeout: timeoutMs,
    killSignal: 'SIGKILL' as const,
    windowsHide: true,
    env,
    maxBuffer: 4 * 1024 * 1024,
  };
  try {
    await ejecutar(bin, args, opciones).catch((err: unknown) =>
      pideReinicio(err) ? ejecutar(bin, args, opciones) : Promise.reject(err),
    );
  } catch (err) {
    return errorDeSoffice(err);
  }
  const salida = path.join(outDir, `${path.basename(entrada, path.extname(entrada))}.${destino}`);
  const st = await fs.stat(salida).catch(() => null);
  if (!st?.isFile() || st.size === 0)
    return fail(
      'sin_salida',
      'LibreOffice terminó sin producir el archivo (suele ser un perfil corrupto: ver docs/operacion.md → Documentos: LibreOffice).',
    );
  return ok(salida);
}

export type OpcionesConversion = { timeoutMs?: number; outDir?: string };

function anotar(destino: Destino, inicio: number, r: Result<string>, bytes: number): Result<string> {
  const ms = Date.now() - inicio;
  contadores.ultima_ms = ms;
  if (r.error) contadores.fallidas++;
  else contadores.hechas++;
  log.info('conversión', { destino, ms, codigo: r.error?.code ?? 'ok', bytes });
  return r;
}

/**
 * Convierte un archivo y devuelve la ruta del resultado: en `outDir` o, si no se da, en una
 * carpeta temporal que borra quien llama (`fs.rm(path.dirname(ruta))`). La entrada se copia
 * antes a esa carpeta: soffice deja un «.~lock#» junto a ella y drive-sync lo subiría a Drive.
 */
export async function convertir(
  rutaAbs: string,
  destino: Destino,
  { timeoutMs = TIMEOUT_MS, outDir }: OpcionesConversion = {},
): Promise<Result<string>> {
  const c = await disponible();
  if (c.estado !== 'ok' || !c.binario) return sinConversor(c);
  const st = await fs.stat(rutaAbs).catch(() => null);
  if (!st?.isFile()) return fail('io_error', 'No existe el documento que convertir.');
  if (st.size > MAX_ENTRADA_BYTES)
    return fail('too_large', 'Documento demasiado grande para convertirlo (más de 100 MB).');
  const bin = c.binario;
  const inicio = Date.now();
  contadores.en_cola++;
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lo-conv-'));
    const entrada = path.join(tmp, `documento${path.extname(rutaAbs).toLowerCase()}`);
    await fs.copyFile(rutaAbs, entrada);
    const r = await conLock(() => ejecutarSoffice(bin, entrada, destino, outDir ?? tmp, timeoutMs), { timeoutMs });
    if (outDir || r.error) await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    return anotar(destino, inicio, r, st.size);
  } catch (err) {
    return anotar(destino, inicio, fail('io_error', errorMessage(err)), st.size);
  } finally {
    contadores.en_cola--;
  }
}

/** Convierte unos bytes (con su extensión de origen, «.docx») y devuelve los del resultado. */
export async function convertirBytes(
  bytes: Buffer,
  ext: string,
  destino: Destino,
  opciones: Pick<OpcionesConversion, 'timeoutMs'> = {},
): Promise<Result<Buffer>> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lo-bytes-'));
  try {
    const origen = path.join(tmp, `origen${ext.toLowerCase()}`);
    await fs.writeFile(origen, bytes);
    const r = await convertir(origen, destino, { ...opciones, outDir: tmp });
    if (r.error) return r;
    return ok(await fs.readFile(r.data));
  } catch (err) {
    return fail('io_error', errorMessage(err));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * El PDF de un .docx, si hay LibreOffice: sin conversor, ni PDF ni aviso (no es un fallo);
 * si la conversión falla, el aviso con el motivo.
 */
export async function pdfDeDocx(docx: Buffer): Promise<{ pdf: Buffer | null; aviso: string | null }> {
  if ((await disponible()).estado !== 'ok') return { pdf: null, aviso: null };
  const r = await convertirBytes(docx, '.docx', 'pdf');
  return r.error ? { pdf: null, aviso: `No se pudo generar el PDF: ${r.error.message}` } : { pdf: r.data, aviso: null };
}
