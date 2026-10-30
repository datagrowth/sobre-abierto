// Conocimiento en Google Drive a través de su API: buscar y crear carpetas por ruta y mover carpetas enteras.
import fs from 'node:fs';
import path from 'node:path';
import {
  connectedFolder,
  createFolder,
  lastSyncRound,
  listChildren,
  moveItem,
  syncReady,
  type DriveItem,
} from './driveGoogle.js';
import { fail, ok, type Result } from './result.js';

// Es la frontera con Drive para los dominios: los errores vuelven como valor. Mover en Drive (y no en el disco)
// lleva también los Google Docs, que bisync no ve, y bisync trae el cambio al disco en su siguiente vuelta.
// Un archivo escrito mientras corría la vuelta puede quedar fuera de ella: solo cuenta como
// subido lo que es anterior al final de la vuelta con este margen.
const MARGEN_VUELTA_MS = 5 * 60_000;

function algunoDespuesDe(dir: string, limiteMs: number): boolean {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  return entradas.some((e) => {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return algunoDespuesDe(abs, limiteMs);
    try {
      return fs.statSync(abs).mtimeMs > limiteMs;
    } catch {
      return false;
    }
  });
}

/** ¿Hay algún archivo dentro de `dir` (en el disco), a cualquier profundidad? */
export function tieneArchivos(dir: string): boolean {
  return algunoDespuesDe(dir, -Infinity);
}

/**
 * ¿Tiene `dir` (en el disco) archivos que drive-sync quizá aún no ha subido? Mover en Drive
 * una carpeta así haría que bisync los subiera después a la ruta vieja y la carpeta
 * reapareciera allí. Sin marca de vuelta, cualquier archivo cuenta como pendiente.
 */
export function pendienteDeSubir(dir: string): boolean {
  const vuelta = lastSyncRound();
  return algunoDespuesDe(dir, vuelta ? vuelta.getTime() - MARGEN_VUELTA_MS : -Infinity);
}

// Nombre de la carpeta Conocimiento dentro de la raíz elegida: el del par de GDRIVE_SYNC
// de drive-sync («Conocimiento=/opt/data/conocimiento»).
const CARPETA_CONOCIMIENTO = 'Conocimiento';
// Y la de Salidas («Salidas=/opt/data/salidas»).
const CARPETA_SALIDAS = 'Salidas';

export type ElementoDrive = DriveItem;

/** ¿Hay conexión con Drive y carpeta elegida? Sin ella, drive-sync tampoco sincroniza. */
export function driveConectado(): boolean {
  return connectedFolder() !== null;
}

/**
 * ¿Se puede mover en Drive? Hace falta conexión y que drive-sync tenga Conocimiento al día:
 * mientras prepara un --resync (la primera vez con una carpeta), lo movido volvería a
 * aparecer en el sitio viejo con la copia del disco.
 */
export function driveListo(): { listo: boolean; motivo: string } {
  if (!driveConectado()) return { listo: false, motivo: 'Drive no está conectado (o falta elegir la carpeta)' };
  if (!syncReady(CARPETA_CONOCIMIENTO))
    return { listo: false, motivo: 'drive-sync aún no ha terminado de unir Conocimiento con Drive' };
  return { listo: true, motivo: '' };
}

export function hijosDe(id: string): Promise<Result<ElementoDrive[]>> {
  return listChildren(id);
}

export async function crearCarpeta(padre: string, nombre: string): Promise<Result<ElementoDrive>> {
  const r = await createFolder(padre, nombre);
  return r.error ? r : ok({ ...r.data, folder: true });
}

/** Mueve `id` de la carpeta `de` a la carpeta `a`, con otro nombre si se indica. */
export function mover(id: string, de: string, a: string, nombre?: string): Promise<Result<ElementoDrive>> {
  return moveItem(id, de, a, nombre);
}

async function subcarpeta(padre: string, nombre: string, crear: boolean): Promise<Result<string | null>> {
  const r = await listChildren(padre);
  if (r.error) return r;
  const hallada = r.data.find((h) => h.folder && h.name === nombre);
  if (hallada) return ok(hallada.id);
  if (!crear) return ok(null);
  const c = await createFolder(padre, nombre);
  return c.error ? c : ok(c.data.id);
}

// Id de la carpeta con esas partes desde la raíz elegida (cada par de drive-sync cuelga de ella).
async function carpetaDesdeRaiz(partes: string[], crear: boolean): Promise<Result<string | null>> {
  const raiz = connectedFolder();
  if (!raiz) return fail('NOT_CONNECTED', 'Drive no está conectado o falta elegir la carpeta');
  let actual = raiz.id;
  for (const nombre of partes) {
    const r = await subcarpeta(actual, nombre, crear);
    if (r.error || r.data === null) return r;
    actual = r.data;
  }
  return ok(actual);
}

const partesDe = (ruta: string) => ruta.split('/').filter(Boolean);

/**
 * Id de la carpeta «Conocimiento/<ruta>» en Drive. Sin `crear`, null si alguna parte no
 * existe; con `crear`, crea las que falten. Error NOT_CONNECTED si no hay conexión.
 */
export function carpetaPorRuta(ruta: string, crear = false): Promise<Result<string | null>> {
  return carpetaDesdeRaiz([CARPETA_CONOCIMIENTO, ...partesDe(ruta)], crear);
}

/** Id de una carpeta de Salidas en Drive («Salidas/<ruta>», con o sin el prefijo); null si aún no existe. */
export function carpetaDeSalidasPorRuta(ruta: string): Promise<Result<string | null>> {
  return carpetaDesdeRaiz([CARPETA_SALIDAS, ...partesDe(ruta.replace(/^Salidas\//, ''))], false);
}

/** Enlace para abrir una carpeta de Drive en el navegador. */
export const enlaceCarpetaDrive = (id: string): string =>
  `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
