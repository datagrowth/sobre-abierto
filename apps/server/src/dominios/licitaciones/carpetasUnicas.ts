// Dónde está la carpeta única de cada licitación: Licitaciones/Ofertas/<expediente> · <título corto> (<id>)/.
import type { Db } from './store.js';

// Ver docs/operacion.md, sección «Carpeta de cada licitación». Se guarda al crear la carpeta (tabla
// carpetas_unicas) y no se recalcula: si cambia el título en la PLACSP, la carpeta sigue siendo la misma.
// Mientras una licitación no tiene la suya, todo sigue donde estaba (Radar o Presentadas para los pliegos,
// Salidas para la oferta).
export const CARPETA_OFERTAS = 'Licitaciones/Ofertas';
// Todo se indexa en la Biblioteca para aprender de lo pasado; solo las copias de CV se ocultan a quien no puede ver colaboradores.
export const SUBCARPETAS_UNICA = {
  pliegos: 'Pliegos',
  oferta: 'Oferta',
  sobres: 'Sobres',
  presentada: 'Presentada',
  resolucion: 'Resolución',
} as const;

// Las rutas se piden desde muchos sitios sin la base a mano (carpetaSalidas(l)): por eso hay un registro en
// memoria que se carga al arrancar y se apunta al crear cada carpeta.
const registradas = new Map<string, string>();

/** Al arrancar: el registro con lo que dice la base. */
export function cargarCarpetasUnicas(db: Db): number {
  registradas.clear();
  const filas = db.prepare('SELECT licitacion_id, ruta FROM carpetas_unicas').all() as {
    licitacion_id: string;
    ruta: string;
  }[];
  for (const f of filas) registradas.set(f.licitacion_id, f.ruta);
  return filas.length;
}

/** La licitación ya tiene su carpeta única en `ruta` (relativa a Conocimiento). */
export function apuntarCarpetaUnica(db: Db, id: string, ruta: string): void {
  db.prepare(
    `INSERT INTO carpetas_unicas (licitacion_id, ruta, creada_en) VALUES (?, ?, ?)
    ON CONFLICT(licitacion_id) DO UPDATE SET ruta = excluded.ruta`,
  ).run(id, ruta, new Date().toISOString());
  registradas.set(id, ruta);
}

/** La carpeta única de la licitación (relativa a Conocimiento) o null si aún no la tiene. */
export function carpetaUnicaDe(id: string): string | null {
  return registradas.get(id) ?? null;
}

/** Lo mismo leyendo la base (para quien la tiene a mano y puede correr en otro hilo). */
export function carpetaUnicaEnDb(db: Db, id: string): string | null {
  return (
    (db.prepare('SELECT ruta FROM carpetas_unicas WHERE licitacion_id = ?').get(id) as { ruta: string } | undefined)
      ?.ruta ?? null
  );
}

/** «Conocimiento/<carpeta>/Oferta»: donde se escribe lo que genera la oferta. */
export const ofertaEnUnica = (ruta: string): string => `Conocimiento/${ruta}/${SUBCARPETAS_UNICA.oferta}`;
/** «Conocimiento/<carpeta>/Sobres»: los paquetes de presentación por versión, lote y sobre. */
export const sobresEnUnica = (ruta: string): string => `Conocimiento/${ruta}/${SUBCARPETAS_UNICA.sobres}`;
