// Documentos que bajan los dominios a la Biblioteca (pliegos, bases de convocatorias), registrados con su hash.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ahora, type Db } from './db.js';
import { errorMessage, fail, ok, type Result } from './result.js';
import { ErrorBandeja, reubicarPropuestasPendientes } from '../biblioteca/motor/bandeja.js';
import { enCarpetas } from '../biblioteca/motor/documentos/busquedaHibrida.js';

// Se escriben sin pisar nunca un archivo ajeno y quedan registrados en nucleo.documentos con su hash, su dominio
// y su origen.
// Carpetas cuyos documentos ya analiza un dominio con su ficha (pliegos del radar, bases
// de las ayudas): no salen en «documentos sin nota» ni se proponen notas a partir de
// ellos, porque serían una copia peor de la ficha y llenarían Propuestas.
const conFicha = new Map<string, string>();

export function registrarCarpetaConFicha(carpeta: string, dominio: string): void {
  conFicha.set(carpeta, dominio);
}

export function carpetasConFicha(): string[] {
  return [...conFicha.keys()];
}

/** El dominio que analiza el documento con su ficha, o null si se puede convertir en nota. */
export function dominioConFicha(ruta: string): string | null {
  for (const [carpeta, dominio] of conFicha) if (enCarpetas(ruta, [carpeta])) return dominio;
  return null;
}

export type DocumentoGuardado = { ruta: string; sha256: string; nuevo: boolean };

async function existe(abs: string): Promise<boolean> {
  return fs.access(abs).then(
    () => true,
    () => false,
  );
}

// Mismo archivo (mismo hash) ya bajado por la plataforma: se reutiliza. Cualquier otro
// archivo con ese nombre se respeta y el nuevo lleva sufijo -1, -2…
async function rutaLibre(db: Db, raiz: string, rel: string, sha256: string): Promise<{ rel: string; nuevo: boolean }> {
  const ext = path.posix.extname(rel);
  const base = rel.slice(0, rel.length - ext.length);
  for (let i = 0; i < 100; i++) {
    const candidato = i === 0 ? rel : `${base}-${i}${ext}`;
    if (!(await existe(path.join(raiz, candidato)))) return { rel: candidato, nuevo: true };
    const nuestro = db.prepare('SELECT sha256 FROM documentos WHERE ruta = ?').get(candidato) as
      { sha256: string } | undefined;
    if (nuestro?.sha256 === sha256) return { rel: candidato, nuevo: false };
  }
  return { rel: `${base}-${crypto.randomUUID().slice(0, 8)}${ext}`, nuevo: true };
}

export type DocumentoNuevo = { rel: string; bytes: Buffer; dominio: string; origenUrl: string | null };

/**
 * Escribe los bytes en `raiz/rel` (o en una variante libre con sufijo) y lo registra.
 * `db` es nucleo.db o una base de dominio con nucleo.db adjunta: «documentos» solo existe allí.
 */
export async function guardarDocumentoNuevo(
  db: Db,
  raiz: string,
  doc: DocumentoNuevo,
): Promise<Result<DocumentoGuardado>> {
  const { rel, bytes } = doc;
  try {
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const destino = await rutaLibre(db, raiz, rel, sha256);
    await fs.mkdir(path.dirname(path.join(raiz, destino.rel)), { recursive: true });
    // «wx»: si otro proceso creó el archivo entre medias, falla en vez de pisarlo.
    if (destino.nuevo) await fs.writeFile(path.join(raiz, destino.rel), bytes, { flag: 'wx' });
    db.prepare(
      `INSERT INTO documentos (ruta, dominio, origen_url, sha256, bytes, registrado_en) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(ruta) DO NOTHING`,
    ).run(destino.rel, doc.dominio, doc.origenUrl, sha256, bytes.length, ahora());
    return ok({ ruta: destino.rel, sha256, nuevo: destino.nuevo });
  } catch (err) {
    return fail('io_error', errorMessage(err));
  }
}

/**
 * Una carpeta de la Biblioteca cambió de sitio: las propuestas de nota pendientes que salen
 * de ella pasan a apuntar a la ruta nueva (rutas relativas a la bóveda). Sin bóveda, 0.
 */
export async function moverFuentesPropuestas(de: string, a: string): Promise<Result<number>> {
  try {
    return ok(await reubicarPropuestasPendientes(de, a));
  } catch (err) {
    if (err instanceof ErrorBandeja && err.code === 'not_configured') return ok(0);
    return fail('io_error', errorMessage(err));
  }
}
