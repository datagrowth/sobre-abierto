// Caché de conversiones .doc/.rtf → .docx.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { obtenerRutaBiblioteca } from '../../biblioteca/motor/configuracion.js';
import { logger } from '../log.js';
import { errorMessage, fail, ok, type Result } from '../result.js';
import { convertir } from './libreoffice.js';

const log = logger('documentos.conversiones');
// Convertir cuesta segundos y el mismo pliego se lee muchas veces (indexado, lectura por páginas, pasajes): se
// guarda por ruta, fecha y tamaño, así que un archivo que cambia en Drive se convierte otra vez y el viejo
// caduca.
const DIAS_POR_DEFECTO = 60;
const MAX_BYTES_POR_DEFECTO = 2 * 1024 * 1024 * 1024;

/** `CONVERSIONES_DIR` o, en local, una carpeta oculta junto al índice de la bóveda. */
export function carpetaConversiones(): string {
  const configurada = process.env.CONVERSIONES_DIR?.trim();
  if (configurada) return path.resolve(configurada);
  return path.join(obtenerRutaBiblioteca() ?? os.tmpdir(), '.hermes-vault', 'cache', 'conversiones');
}

function claveDe(abs: string, mtimeMs: number, size: number): string {
  return crypto
    .createHash('sha256')
    .update(`${abs}|${Math.floor(mtimeMs)}|${size}`)
    .digest('hex');
}

async function esArchivo(abs: string): Promise<boolean> {
  const st = await fs.stat(abs).catch(() => null);
  return Boolean(st?.isFile());
}

/** Ruta del .docx equivalente al documento (de la caché o recién convertido). */
export async function docxConvertido(absOrigen: string, carpeta = carpetaConversiones()): Promise<Result<string>> {
  const st = await fs.stat(absOrigen).catch(() => null);
  if (!st?.isFile()) return fail('io_error', 'No existe el documento que convertir.');
  const destino = path.join(carpeta, `${claveDe(absOrigen, st.mtimeMs, st.size)}.docx`);
  if (await esArchivo(destino)) return ok(destino);
  const convertido = await convertir(absOrigen, 'docx');
  if (convertido.error) return convertido;
  try {
    await fs.mkdir(carpeta, { recursive: true });
    // Copia a un temporal en la misma carpeta y renombra: nadie lee un .docx a medio escribir.
    const parcial = `${destino}.${process.pid}.tmp`;
    await fs.copyFile(convertido.data, parcial);
    await fs.rename(parcial, destino);
    return ok(destino);
  } catch (err) {
    return fail('io_error', `No se pudo guardar la conversión: ${errorMessage(err)}`);
  } finally {
    await fs.rm(path.dirname(convertido.data), { recursive: true, force: true }).catch(() => undefined);
  }
}

type Entrada = { abs: string; mtimeMs: number; size: number };

async function entradasDe(carpeta: string): Promise<Entrada[]> {
  const nombres = await fs.readdir(carpeta).catch(() => [] as string[]);
  const out: Entrada[] = [];
  for (const nombre of nombres) {
    const abs = path.join(carpeta, nombre);
    const st = await fs.stat(abs).catch(() => null);
    if (st?.isFile()) out.push({ abs, mtimeMs: st.mtimeMs, size: st.size });
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

export type OpcionesLimpieza = { dias?: number; maxBytes?: number; ahoraMs?: number };

/** Borra las conversiones de más de `dias` y, si aun así pasan de `maxBytes`, las más viejas. */
export async function limpiarConversiones(
  carpeta = carpetaConversiones(),
  { dias = DIAS_POR_DEFECTO, maxBytes = MAX_BYTES_POR_DEFECTO, ahoraMs = Date.now() }: OpcionesLimpieza = {},
): Promise<{ borrados: number }> {
  const entradas = await entradasDe(carpeta);
  let total = entradas.reduce((n, e) => n + e.size, 0);
  let borrados = 0;
  for (const e of entradas) {
    const caducada = ahoraMs - e.mtimeMs > dias * 86_400_000;
    if (!caducada && total <= maxBytes) break;
    await fs.rm(e.abs, { force: true }).catch(() => undefined);
    total -= e.size;
    borrados++;
  }
  if (borrados) log.info('conversiones limpiadas', { borrados, quedan: entradas.length - borrados });
  return { borrados };
}
