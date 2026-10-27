// Versión del servidor que corre: huella de su código de servidor y de la web desplegada.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db.js';
import { guardarOperacion, leerOperacion } from './operaciones.js';
import { errorMessage, fail, ok, type Result } from './result.js';

// La cola la usa para el freno (trabajos.ts): tres fallos seguidos de un tipo lo frenan 6 h, pero si los causaba
// un error de código y se despliega el arreglo, esos fallos ya no dicen nada de la versión nueva. En la imagen
// no hay .git ni commit, y X-Web-Version solo cambia si cambia la web: por eso se hashea el propio código del
// servidor (dist en producción, src en desarrollo).
const CODIGO = /\.(?:js|mjs|cjs|ts)$/;
const CLAVE = 'nucleo.version_servidor';

/** Huella (sha256) de los archivos de código bajo `dir`, por ruta relativa y contenido, en orden fijo. */
export function huellaCodigo(dir: string): Result<string> {
  try {
    const archivos = fs
      .readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => CODIGO.test(f))
      .map((f) => f.split(path.sep).join('/'))
      .sort();
    if (!archivos.length) return fail('sin_codigo', `No hay código en ${dir}.`);
    const h = crypto.createHash('sha256');
    for (const f of archivos)
      h.update(f)
        .update('\0')
        .update(fs.readFileSync(path.join(dir, f)))
        .update('\0');
    return ok(h.digest('hex'));
  } catch (e) {
    return fail('huella_ilegible', errorMessage(e));
  }
}

/** La del servidor y la de la web juntas: un despliegue que cambie cualquiera de las dos es otra versión. */
export function huellaVersion(codigo: string, web: string | null): string {
  return crypto
    .createHash('sha256')
    .update(`${codigo}\0${web ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

// desde: cuándo arrancó por primera vez esta versión (un reinicio sin cambios lo conserva).
// nueva: este arranque es el primero de la versión.
export type VersionServidor = { huella: string; desde: string; nueva: boolean; anterior: string | null };
type Guardada = { huella: string; desde: string; anterior: string | null };

const leerGuardada = (raw: unknown): Guardada | null => {
  const g = raw as Partial<Guardada> | null;
  return typeof g?.huella === 'string' && typeof g.desde === 'string'
    ? { huella: g.huella, desde: g.desde, anterior: g.anterior ?? null }
    : null;
};

let actual: VersionServidor | null = null;

/**
 * Al arrancar: compara la huella con la del arranque anterior (operaciones_unicas). Si cambió (o
 * no había), esta versión empieza ahora; si es la misma, conserva su `desde`: un reinicio sin
 * despliegue no levanta ningún freno.
 */
export function anotarVersionServidor(db: Db, huella: string, ahora = new Date().toISOString()): VersionServidor {
  const previa = leerOperacion(db, CLAVE, leerGuardada)?.datos ?? null;
  if (previa?.huella === huella) {
    actual = { huella, desde: previa.desde, nueva: false, anterior: previa.anterior };
    return actual;
  }
  const guardada: Guardada = { huella, desde: ahora, anterior: previa?.huella ?? null };
  guardarOperacion(db, CLAVE, 'arrancada', guardada);
  actual = { ...guardada, nueva: true };
  return actual;
}

/** La versión anotada en este arranque (null hasta anotarla, p. ej. en los tests). */
export function versionServidor(): VersionServidor | null {
  return actual;
}
